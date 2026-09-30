import { execFile, spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { constants as fsConstants } from "node:fs";
import { z } from "zod";
import { isSummaryContextMessage } from "./chatContextCompaction";
import { formatClaudeModelName } from "./chatModels";
import type { ChatModelOption } from "./chatModels";
import type {
  AnthropicEffort,
  ChatMessage,
  ChatTokenUsage,
  ClaudeCodeConnectionTest,
  ClaudeCodeStatus,
  CorosMcpTool
} from "./types";

const execFileAsync = promisify(execFile);
const DETECTION_TIMEOUT_MS = 5_000;
const AUTH_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 45_000;
const LOGIN_URL_TIMEOUT_MS = 30_000;
const LOGIN_COMPLETION_TIMEOUT_MS = 10 * 60_000;
const LOGIN_POLL_INTERVAL_MS = 2_000;

// `claude --version` costs a process spawn per status read, and the answer only
// changes when the CLI is upgraded — which rewrites the file, so the answer is
// kept per path *and* modification time. Keyed by path alone, an upgrade in
// place (npm, `claude update`) went on reporting the old version, and choosing
// the newest install compared against it, until the app was restarted.
// Failures are not cached: a binary that could not launch may launch later.
const versionCache = new Map<string, string | undefined>();
const REQUEST_TIMEOUT_MS = 3 * 60_000;

const SUBSCRIPTION_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS"
] as const;

export type ClaudeCodeFailureKind =
  | "not-installed"
  | "auth"
  | "usage-limit"
  | "timeout"
  | "cancelled"
  | "connection";

export class ClaudeCodeProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ClaudeCodeFailureKind
  ) {
    super(message);
    this.name = "ClaudeCodeProviderError";
  }
}

export interface ClaudeCodeToolCallbacks {
  onToken(delta: string): void;
  onThinking?(delta: string): void;
  onToolCallStart?(toolName: string): void;
  onToolCallError?(toolName: string, message: string): void;
  onToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string>;
}

export interface StreamClaudeCodeOptions extends ClaudeCodeToolCallbacks {
  executablePath: string;
  instructions: string;
  messages: ChatMessage[];
  tools: CorosMcpTool[];
  signal: AbortSignal;
  timeoutMs?: number;
  /** Model alias (opus/sonnet/haiku) or full id. Omit for the account default. */
  model?: string;
  /** Private CLAUDE_CONFIG_DIR so the app uses its own subscription login. */
  configDir?: string;
  /** Reasoning effort; the SDK downgrades a level the model cannot serve. */
  effort?: AnthropicEffort;
  /**
   * A fixed thinking budget, for a model that takes no effort (Haiku 4.5). Left
   * to itself Claude Code thinks for 5–13k tokens to write a 400-character
   * digest (measured), and an effort does not reach a model that takes none.
   */
  thinkingBudget?: number;
  /** Send the last message as the prompt, without the Coach conversation's framing (a text job). */
  plainPrompt?: boolean;
  /**
   * Receives the model Claude Code actually ran. Only meaningful as "the
   * account default" when `model` was left unset, since otherwise it just
   * echoes the requested one.
   */
  onModelResolved?(model: string): void;
}

interface ClaudeAuthStatusPayload {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
  email?: string;
  orgName?: string;
}

export function getClaudeExecutableCandidates(
  customPath?: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const candidates = [customPath?.trim()].filter(
    (value): value is string => Boolean(value)
  );
  // Joined for the platform being asked about, not for the one asking. Both
  // extra parameters exist so a suite can ask about the other platform, and
  // bare `path` is whichever host is running — so a Windows machine answered
  // the darwin question with `\Users\me\.local\bin\claude`, a path that names
  // nothing anywhere. At run time `platform` is `process.platform` and the two
  // are the same module.
  const join = platform === "win32" ? path.win32.join : path.posix.join;

  if (platform === "win32") {
    if (env.LOCALAPPDATA) {
      candidates.push(
        join(env.LOCALAPPDATA, "Programs", "Claude", "claude.exe"),
        join(env.LOCALAPPDATA, "Claude", "claude.exe")
      );
    }
    // `npm install -g` puts a shell shim and a .cmd on PATH, neither of which
    // execFile can start; the binary they run is inside the package.
    if (env.APPDATA) {
      candidates.push(
        join(env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
      );
    }
    candidates.push(
      join(home, ".local", "bin", "claude.exe"),
      join(home, ".claude", "local", "claude.exe")
    );
  } else {
    candidates.push(
      join(home, ".local", "bin", "claude"),
      join(home, ".claude", "local", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude"
    );
  }

  return [...new Set(candidates)];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(
      filePath,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

// Status is read every few seconds while a sign-in is pending; asking the
// shell where `claude` is costs a process each time, and PATH rarely changes.
const PATH_LOOKUP_TTL_MS = 60_000;
let pathLookup: { at: number; found: string[] } | undefined;

/**
 * Every `claude` on PATH that can be started directly. On Windows that is the
 * `.exe` entries only: `where` also lists npm's extensionless shell shim and
 * its `.cmd`, which execFile cannot run.
 */
async function findClaudeOnPath(platform = process.platform): Promise<string[]> {
  if (pathLookup && Date.now() - pathLookup.at < PATH_LOOKUP_TTL_MS) return pathLookup.found;
  let found: string[] = [];
  try {
    const command = platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(command, platform === "win32" ? ["claude"] : ["-a", "claude"], {
      timeout: DETECTION_TIMEOUT_MS,
      windowsHide: true
    });
    found = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => platform !== "win32" || /\.exe$/i.test(value));
  } catch {
    found = [];
  }
  pathLookup = { at: Date.now(), found };
  return found;
}

function samePath(a: string, b: string, platform = process.platform): boolean {
  const normal = (value: string) =>
    platform === "win32" ? path.win32.normalize(value).toLowerCase() : path.posix.normalize(value);
  return normal(a) === normal(b);
}

/**
 * Whether a path is one detection looks at on its own. A path stored there
 * was not a choice: builds before this one saved whatever detection found
 * into the setting, and from then on every read used that install — so a CLI
 * upgraded somewhere else (npm, beside a native install) was never seen, and
 * neither were the models it added. Only a path detection would not find is
 * honoured as the athlete's.
 */
export function isStandardClaudeLocation(
  filePath: string | undefined,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = filePath?.trim();
  if (!value) return false;
  return getClaudeExecutableCandidates(undefined, platform, env).some((candidate) =>
    samePath(candidate, value, platform)
  );
}

/** `2.1.283 (Claude Code)` → [2, 1, 283]; anything else → undefined. */
export function parseClaudeVersion(output: string | undefined): number[] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output ?? "");
  return match ? match.slice(1, 4).map(Number) : undefined;
}

/** Positive when `a` is newer. An unreadable version sorts below any readable one. */
export function compareClaudeVersions(a: string | undefined, b: string | undefined): number {
  const left = parseClaudeVersion(a);
  const right = parseClaudeVersion(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** `claude --version` for one install, cached per path and modification time. */
async function readClaudeVersion(
  executablePath: string,
  configDir?: string
): Promise<string | undefined> {
  let key = executablePath;
  try {
    key = `${executablePath}@${(await stat(executablePath)).mtimeMs}`;
  } catch {
    // Unstattable yet executable: fall back to the path alone.
  }
  if (versionCache.has(key)) return versionCache.get(key);
  const result = await execClaude(executablePath, ["--version"], {
    timeout: DETECTION_TIMEOUT_MS,
    configDir
  });
  const version = result.stdout.trim() || undefined;
  versionCache.set(key, version);
  return version;
}

/**
 * The Claude Code to run. A path the athlete chose wins, as long as it is not
 * one detection looks at anyway (`isStandardClaudeLocation`). Otherwise every
 * install found — the usual places and PATH — is a candidate, and **the newest
 * wins**: a machine with a native install and an npm one runs whichever was
 * upgraded last, which is the one whose model list is current. One install is
 * returned without asking its version.
 */
export async function detectClaudeCodeExecutable(
  customPath?: string
): Promise<string | undefined> {
  const explicitPath = customPath?.trim();
  if (explicitPath && !isStandardClaudeLocation(explicitPath)) {
    return (await isExecutable(explicitPath)) ? explicitPath : undefined;
  }

  const found: string[] = [];
  for (const candidate of [
    ...getClaudeExecutableCandidates(undefined),
    ...(await findClaudeOnPath())
  ]) {
    if (found.some((known) => samePath(known, candidate))) continue;
    if (await isExecutable(candidate)) found.push(candidate);
  }
  if (found.length <= 1) return found[0];

  const versions = await Promise.all(
    found.map((candidate) => readClaudeVersion(candidate).catch(() => undefined))
  );
  let best = 0;
  for (let index = 1; index < found.length; index++) {
    if (compareClaudeVersions(versions[index], versions[best]) > 0) best = index;
  }
  return found[best];
}

/**
 * Builds the environment every Claude Code invocation runs under.
 *
 * `configDir` points Claude Code at a private credential store via
 * CLAUDE_CONFIG_DIR, so Heracles Records can hold its own subscription login without
 * reading or disturbing the account the user is signed into elsewhere on this
 * computer. Omit it to share the machine-wide login in ~/.claude.
 */
export function createClaudeSubscriptionEnvironment(
  configDir?: string
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of SUBSCRIPTION_ENV_KEYS) {
    delete env[key];
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "coroslink-coach";
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = "1";
  if (configDir?.trim()) {
    env.CLAUDE_CONFIG_DIR = configDir.trim();
  }
  return env;
}

/** Strips terminal control sequences so CLI output can be pattern-matched. */
export function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\u001b\][^\u0007]*\u0007/g, "");
}

/**
 * Pulls the OAuth authorize URL out of `claude auth login` output. The CLI
 * prints it as a fallback for when it cannot open a browser itself, which is
 * exactly the case inside a packaged app.
 */
export function extractLoginUrl(output: string): string | undefined {
  const match = stripAnsi(output).match(/https:\/\/\S*oauth\/authorize\S*/);
  if (!match) return undefined;
  // Trailing punctuation is not part of the URL when the CLI wraps a sentence.
  return match[0].replace(/[.,)\]]+$/, "");
}

export function parseClaudeAuthStatusOutput(
  output: string
): ClaudeAuthStatusPayload | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as ClaudeAuthStatusPayload;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as ClaudeAuthStatusPayload;
    } catch {
      return undefined;
    }
  }
}

function hasSubscriptionLogin(payload?: ClaudeAuthStatusPayload): boolean {
  return (
    payload?.loggedIn === true &&
    (payload.authMethod === "claude.ai" || Boolean(payload.subscriptionType))
  );
}

/**
 * One `auth status` call, used while polling a pending sign-in. Deliberately
 * lighter than getClaudeCodeStatus, which also shells out for --version.
 */
async function isSignedIn(
  executablePath: string,
  configDir?: string
): Promise<boolean> {
  try {
    const result = await execClaude(executablePath, ["auth", "status"], {
      timeout: AUTH_TIMEOUT_MS,
      configDir
    });
    return hasSubscriptionLogin(parseClaudeAuthStatusOutput(result.stdout));
  } catch {
    return false;
  }
}

export async function getClaudeCodeStatus(
  customPath?: string,
  configDir?: string
): Promise<ClaudeCodeStatus> {
  const checkedAt = new Date().toISOString();
  const executablePath = await detectClaudeCodeExecutable(customPath);
  if (!executablePath) {
    return {
      state: "not-installed",
      installed: false,
      authenticated: false,
      checkedAt,
      message:
        "Claude Code is not installed. Install it to use your Claude subscription with Heracles Records."
    };
  }

  let version: string | undefined;
  try {
    version = await readClaudeVersion(executablePath, configDir);
  } catch (caught) {
    return {
      state: "connection-failed",
      installed: true,
      authenticated: false,
      executablePath,
      checkedAt,
      message: `Claude Code was found but could not launch: ${safeErrorMessage(caught)}`
    };
  }

  try {
    const result = await execClaude(executablePath, ["auth", "status"], {
      timeout: AUTH_TIMEOUT_MS,
      configDir
    });
    const payload = parseClaudeAuthStatusOutput(result.stdout);
    if (!hasSubscriptionLogin(payload)) {
      return {
        state: "sign-in-required",
        installed: true,
        authenticated: false,
        executablePath,
        version,
        authMethod: payload?.authMethod,
        subscriptionType: payload?.subscriptionType,
        email: payload?.email,
        orgName: payload?.orgName,
        checkedAt,
        message: payload?.loggedIn
          ? "Claude Code is signed in without a Claude subscription. Sign in again and choose your Claude account subscription."
          : "Claude Code is installed, but sign-in is required."
      };
    }

    return {
      state: "connected",
      installed: true,
      authenticated: true,
      executablePath,
      version,
      authMethod: payload?.authMethod,
      subscriptionType: payload?.subscriptionType,
      email: payload?.email,
      orgName: payload?.orgName,
      checkedAt,
      message: payload?.subscriptionType
        ? `Claude Code is connected with your ${payload.subscriptionType} subscription.`
        : "Claude Code is connected with your Claude subscription."
    };
  } catch {
    return {
      state: "sign-in-required",
      installed: true,
      authenticated: false,
      executablePath,
      version,
      checkedAt,
      message: "Claude Code is installed, but sign-in is required."
    };
  }
}

/**
 * A running `claude auth login`.
 *
 * The CLI is never given a terminal, so the authorize URL has to be scraped
 * from its output. Sign-in then finishes one of two ways: the browser flow
 * completes on its own, or the athlete pastes the code the callback page shows.
 * Either way the CLI exits, so `completion` watches the process rather than
 * waiting on a pasted code that may never come.
 */
export interface ClaudeCodeLoginSession {
  /** Authorize URL to open in the athlete's own browser. */
  url: string;
  /** Settles when the CLI exits: signed in, or cancelled by us. */
  completion: Promise<"signed-in" | "cancelled">;
  /** Fallback path: feeds the code from the callback page to the CLI. */
  submitCode(code: string): void;
  /** Kills the pending login. */
  cancel(): void;
}

export async function startClaudeCodeLogin(options: {
  executablePath: string;
  configDir?: string;
  timeoutMs?: number;
}): Promise<ClaudeCodeLoginSession> {
  const child = spawn(options.executablePath, ["auth", "login", "--claudeai"], {
    // Pipes on all three streams: closing stdin makes the CLI exit before it
    // prints anything, and without stdout we never see the authorize URL.
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: createClaudeSubscriptionEnvironment(options.configDir)
  });

  let output = "";
  let settled = false;
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const url = await new Promise<string>((resolve, reject) => {
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        child.kill();
        reject(
          new ClaudeCodeProviderError(
            "Claude did not return a sign-in link. Try again.",
            "timeout"
          )
        );
      });
    }, options.timeoutMs ?? LOGIN_URL_TIMEOUT_MS);

    const check = () => {
      const found = extractLoginUrl(output);
      if (found) finish(() => resolve(found));
    };
    child.stdout?.on("data", check);
    child.stderr?.on("data", check);
    child.on("error", (error) =>
      finish(() => reject(normalizeClaudeCodeError(error)))
    );
    child.on("exit", () =>
      finish(() =>
        reject(
          new ClaudeCodeProviderError(
            `Claude sign-in ended before returning a link. ${truncate(stripAnsi(output).trim(), 300)}`,
            "connection"
          )
        )
      )
    );
  });

  // Completion is detected by asking the CLI whether it is signed in, not by
  // waiting for it to exit: after the browser flow writes credentials the
  // process stays parked on its "paste code" prompt, so an exit may never come.
  // The exit handler remains for the paths that do end the process.
  let cancelled = false;
  const completion = new Promise<"signed-in" | "cancelled">(
    (resolve, reject) => {
      let finished = false;
      const finish = (action: () => void) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearInterval(poll);
        action();
      };

      const timer = setTimeout(() => {
        cancelled = true;
        child.kill();
        finish(() =>
          reject(
            new ClaudeCodeProviderError(
              "Claude sign-in timed out. Try again.",
              "timeout"
            )
          )
        );
      }, LOGIN_COMPLETION_TIMEOUT_MS);

      const poll = setInterval(() => {
        void isSignedIn(options.executablePath, options.configDir).then(
          (signedIn) => {
            if (signedIn) {
              child.kill();
              finish(() => resolve("signed-in"));
            }
          }
        );
      }, LOGIN_POLL_INTERVAL_MS);

      child.once("exit", (_exitCode) => {
        void (async () => {
          if (cancelled) {
            finish(() => resolve("cancelled"));
            return;
          }
          // The exit code is not proof either way: the CLI exits 0 when it
          // gives up as well as when it signs in, and a non-zero exit can still
          // follow a successful sign-in. Ask it instead.
          const signedIn = await isSignedIn(
            options.executablePath,
            options.configDir
          );
          finish(() =>
            signedIn
              ? resolve("signed-in")
              : reject(
                  new ClaudeCodeProviderError(
                    `Claude sign-in did not complete. ${truncate(stripAnsi(output).trim(), 300)}`,
                    "auth"
                  )
                )
          );
        })();
      });

      child.once("error", (error) =>
        finish(() => reject(normalizeClaudeCodeError(error)))
      );
    }
  );

  return {
    url,
    completion,
    submitCode: (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) {
        throw new ClaudeCodeProviderError(
          "Paste the code from the Claude sign-in page.",
          "auth"
        );
      }
      // The tail is reset so a failure message reflects this attempt only.
      output = "";
      child.stdin?.write(`${trimmed}\n`);
    },
    cancel: () => {
      cancelled = true;
      child.kill();
    }
  };
}

/**
 * Signs Claude Code out of a private credential store.
 *
 * `configDir` is required rather than optional: an accidental omission would
 * log the user out of the machine-wide account in ~/.claude, which is exactly
 * what the app-scoped login exists to avoid.
 */
export async function logoutClaudeCode(options: {
  executablePath: string;
  configDir: string;
}): Promise<void> {
  if (!options.configDir.trim()) {
    throw new ClaudeCodeProviderError(
      "Refusing to sign out without a Heracles Records-only credential directory.",
      "connection"
    );
  }
  await execClaude(options.executablePath, ["auth", "logout"], {
    timeout: AUTH_TIMEOUT_MS,
    configDir: options.configDir
  });
}

/**
 * Asks Claude Code which models this account can use.
 *
 * Costs no tokens: `supportedModels()` is a control request, so the query is
 * aborted before any turn runs. The CLI is the only source that knows the
 * concrete version behind an alias — `sonnet` is "Sonnet 4.6" on one account and
 * something else on the next — and it reports that in each row's description.
 */
export async function listClaudeCodeModels(options: {
  executablePath: string;
  configDir?: string;
}): Promise<ChatModelOption[]> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const controller = new AbortController();
  try {
    const query = sdk.query({
      prompt: "",
      options: {
        abortController: controller,
        pathToClaudeCodeExecutable: options.executablePath,
        permissionMode: "dontAsk",
        tools: [],
        allowedTools: [],
        settingSources: [],
        persistSession: false,
        env: createClaudeSubscriptionEnvironment(options.configDir)
      }
    });
    return (await query.supportedModels()).map(toClaudeModelOption);
  } finally {
    controller.abort();
  }
}

/**
 * `default` is the CLI's name for "you choose"; ours is the empty string, which
 * is what the settings store and both pickers already persist.
 *
 * The effort levels come with the row: the CLI says which a model takes, so a
 * picker can stop offering "Max" to one that silently serves "High".
 */
export function toClaudeModelOption(model: {
  value: string;
  displayName: string;
  description?: string;
  resolvedModel?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: AnthropicEffort[];
}): ChatModelOption {
  const efforts =
    model.supportsEffort === false
      ? []
      : model.supportedEffortLevels?.length
        ? [...model.supportedEffortLevels]
        : undefined;
  return {
    value: model.value === "default" ? "" : model.value,
    ...claudeModelLabel(model),
    ...(efforts ? { efforts } : {})
  };
}

/**
 * Splits a CLI model description into its parts. They arrive as
 * "Sonnet 4.6 · Efficient for routine tasks · ~2× usage vs Sonnet": the version
 * leads, and the rest qualifies it.
 */
function claudeModelLabel(model: {
  value: string;
  displayName: string;
  description?: string;
  resolvedModel?: string;
}): { label: string; detail?: string } {
  const [versioned, ...rest] = (model.description ?? "")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const named =
    versioned ||
    (model.resolvedModel ? formatClaudeModelName(model.resolvedModel) : "") ||
    model.displayName;
  // The default row already spends its parentheses naming the model, so a second
  // parenthesised qualifier would read as "Default (Sonnet 4.6) (Efficient …)".
  if (model.value === "default") {
    return { label: `Default (${named})` };
  }
  return { label: named, detail: rest.join(" · ") || undefined };
}

export async function testClaudeCodeConnection(
  customPath?: string,
  configDir?: string
): Promise<ClaudeCodeConnectionTest> {
  const status = await getClaudeCodeStatus(customPath, configDir);
  if (!status.authenticated || !status.executablePath) {
    return { ok: false, status, message: status.message };
  }

  const controller = new AbortController();
  try {
    let reply = "";
    // No model is passed below, so whatever comes back is the account default.
    let defaultModel: string | undefined;
    await streamClaudeCodeCompletion({
      executablePath: status.executablePath,
      instructions:
        "You are performing a connection check. Reply with exactly: Connected",
      messages: [{ role: "user", content: "Test the connection." }],
      tools: [],
      signal: controller.signal,
      timeoutMs: TEST_TIMEOUT_MS,
      configDir,
      onToken: (delta) => {
        reply += delta;
      },
      onModelResolved: (model) => {
        defaultModel = model;
      },
      onToolCall: async () => ""
    });
    const connectedStatus: ClaudeCodeStatus = {
      ...status,
      state: "connected",
      checkedAt: new Date().toISOString(),
      defaultModel: defaultModel ?? status.defaultModel,
      message: "Claude Code is connected and ready for Coach conversations."
    };
    return {
      ok: true,
      status: connectedStatus,
      message: reply.trim()
        ? "Claude Code is connected and responded successfully."
        : "Claude Code is connected and ready."
    };
  } catch (caught) {
    const error = normalizeClaudeCodeError(caught);
    const failedStatus: ClaudeCodeStatus = {
      ...status,
      state:
        error.kind === "usage-limit"
          ? "usage-limit-reached"
          : error.kind === "auth"
            ? "sign-in-required"
            : "connection-failed",
      authenticated: error.kind !== "auth",
      checkedAt: new Date().toISOString(),
      message: error.message
    };
    return { ok: false, status: failedStatus, message: error.message };
  }
}

export async function streamClaudeCodeCompletion(
  options: StreamClaudeCodeOptions
): Promise<{ fullText: string; usage?: ChatTokenUsage }> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const controller = new AbortController();
  let externallyCancelled = false;
  let timedOut = false;
  // Undefined rather than zero when the SDK says nothing: "this run cost
  // nothing" and "nobody told us" are different facts, and a budget that
  // conflates them undercounts in silence.
  let counted = false;
  const usage: ChatTokenUsage = { inputTokens: 0, outputTokens: 0 };
  const onAbort = () => {
    externallyCancelled = true;
    controller.abort();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  // A signal aborted before this was called never fires its event, so a Stop
  // pressed while the turn was being prepared would run the whole turn.
  if (options.signal.aborted) {
    options.signal.removeEventListener("abort", onAbort);
    throw new ClaudeCodeProviderError("Claude request cancelled.", "cancelled");
  }
  // Inactivity timeout: long agent turns (tool calls, plan drafting) are fine
  // as long as the stream keeps producing; only abort when it goes quiet.
  const idleTimeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  armIdleTimeout();

  let fullText = "";
  let resultText = "";

  try {
    const definitions = options.tools.map((sourceTool) => {
      const inputShape = jsonSchemaToZodShape(sourceTool.inputSchema);
      return sdk.tool(
        sourceTool.name,
        sourceTool.description ?? "Heracles Records Coach tool",
        inputShape,
        async (args) => {
          const parsedArgs = args as Record<string, unknown>;
          options.onToolCallStart?.(sourceTool.name);
          armIdleTimeout();
          try {
            const output = await options.onToolCall(sourceTool.name, parsedArgs);
            return { content: [{ type: "text" as const, text: output }] };
          } catch (caught) {
            const message = safeErrorMessage(caught);
            options.onToolCallError?.(sourceTool.name, message);
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true
            };
          } finally {
            armIdleTimeout();
          }
        }
      );
    });
    const mcpServer = sdk.createSdkMcpServer({
      name: "coroslink",
      version: "1.0.0",
      instructions:
        "Use only these Heracles Records tools for approved training data, plan drafts, and calendar changes. Uploads and deletions always require explicit athlete confirmation via the buttons in chat.",
      tools: definitions,
      alwaysLoad: true
    });
    const allowedTools = options.tools.map(
      (sourceTool) => `mcp__coroslink__${sourceTool.name}`
    );

    const stream = sdk.query({
      prompt: options.plainPrompt
        ? options.messages.map((message) => message.content).join("\n\n")
        : formatClaudePrompt(options.messages),
      options: {
        abortController: controller,
        pathToClaudeCodeExecutable: options.executablePath,
        systemPrompt: options.instructions,
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort ? { effort: options.effort } : {}),
        ...(options.thinkingBudget
          ? { thinking: { type: "enabled" as const, budgetTokens: options.thinkingBudget } }
          : {}),
        tools: [],
        allowedTools,
        permissionMode: "dontAsk",
        mcpServers: { coroslink: mcpServer },
        strictMcpConfig: true,
        settingSources: [],
        includePartialMessages: true,
        maxTurns: 10,
        persistSession: false,
        env: createClaudeSubscriptionEnvironment(options.configDir)
      }
    });

    for await (const message of stream) {
      armIdleTimeout();
      if (message.type === "system" && message.subtype === "init") {
        // The only place Claude Code reports which model it settled on.
        options.onModelResolved?.(message.model);
        continue;
      }
      if (message.type === "stream_event") {
        const event = message.event;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          const delta = event.delta.text;
          fullText += delta;
          options.onToken(delta);
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "thinking_delta"
        ) {
          options.onThinking?.(event.delta.thinking);
        }
        continue;
      }
      if (message.type === "rate_limit_event") {
        if (message.rate_limit_info.status === "rejected") {
          throw new ClaudeCodeProviderError(
            "Your Claude usage limit may have been reached. Try again later or choose another provider.",
            "usage-limit"
          );
        }
        continue;
      }
      if (message.type === "assistant" && message.error) {
        throw new Error(message.error);
      }
      if (message.type === "result") {
        // The SDK reports the whole query's usage on its result message, tool
        // rounds included, so there is nothing to accumulate here. Cache reads
        // and writes are input the athlete is billed for.
        const reported = (message as { usage?: Record<string, unknown> }).usage;
        if (reported) {
          const count = (key: string): number => {
            const value = reported[key];
            return typeof value === "number" && Number.isFinite(value) ? value : 0;
          };
          counted = true;
          usage.inputTokens =
            count("input_tokens") +
            count("cache_creation_input_tokens") +
            count("cache_read_input_tokens");
          usage.outputTokens = count("output_tokens");
        }
        if (message.subtype === "success") {
          resultText = message.result;
          if (message.api_error_status === 429) {
            throw new ClaudeCodeProviderError(
              "Your Claude usage limit may have been reached. Try again later or choose another provider.",
              "usage-limit"
            );
          }
        } else {
          throw new Error(message.errors.join("\n") || message.subtype);
        }
      }
    }

    if (!fullText && resultText) {
      fullText = resultText;
      options.onToken(resultText);
    }
    return { fullText, ...(counted ? { usage } : {}) };
  } catch (caught) {
    if (timedOut) {
      throw new ClaudeCodeProviderError(
        "Claude Code stopped responding. Try again.",
        "timeout"
      );
    }
    if (externallyCancelled || options.signal.aborted) {
      throw new ClaudeCodeProviderError("Claude request cancelled.", "cancelled");
    }
    throw normalizeClaudeCodeError(caught);
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", onAbort);
  }
}

export function normalizeClaudeCodeError(
  caught: unknown
): ClaudeCodeProviderError {
  if (caught instanceof ClaudeCodeProviderError) {
    return caught;
  }
  const detail = safeErrorMessage(caught);
  if (/not logged in|login|authentication_failed|oauth_org_not_allowed|401|403/i.test(detail)) {
    return new ClaudeCodeProviderError(
      "Claude is installed, but you are not signed in. Sign in with Claude to continue.",
      "auth"
    );
  }
  if (/usage limit|rate.?limit|credits_required|hit your .*limit|429/i.test(detail)) {
    return new ClaudeCodeProviderError(
      "Your Claude usage limit may have been reached. Try again later or choose another provider.",
      "usage-limit"
    );
  }
  if (/enoent|not found|does not exist/i.test(detail)) {
    return new ClaudeCodeProviderError(
      "Claude Code is not installed or its executable path is no longer valid.",
      "not-installed"
    );
  }
  return new ClaudeCodeProviderError(
    `Claude connection failed: ${truncate(detail, 500)}`,
    "connection"
  );
}

function jsonSchemaToZodShape(
  schema: Record<string, unknown>
): Record<string, z.ZodType> {
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : []
  );
  const shape: Record<string, z.ZodType> = {};

  for (const [name, propertySchema] of Object.entries(properties)) {
    let validator: z.ZodType;
    try {
      validator = z.fromJSONSchema(
        propertySchema as Parameters<typeof z.fromJSONSchema>[0]
      );
    } catch {
      validator = z.unknown();
    }
    shape[name] = required.has(name) ? validator : validator.optional();
  }
  return shape;
}

function formatClaudePrompt(messages: ChatMessage[]): string {
  // The summary a compacted conversation opens with stands in for everything
  // before the tail, so the cut to the recent messages must not take it: a
  // tail of 29 messages or more used to drop it, and the coach lost the whole
  // head of the conversation for most of the stretch between two rolls.
  const summary = messages[0] && isSummaryContextMessage(messages[0]) ? [messages[0]] : [];
  const transcript = [...summary, ...messages.slice(summary.length).slice(-30)]
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "Athlete"}: ${message.content}`
    )
    .join("\n\n");
  return (
    "Continue the Heracles Records Coach conversation below. Answer the athlete's latest " +
    "message, using approved tools only when they materially help.\n\n" +
    transcript
  );
}

async function execClaude(
  executablePath: string,
  args: string[],
  options: { timeout: number; configDir?: string }
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(executablePath, args, {
    timeout: options.timeout,
    windowsHide: true,
    env: createClaudeSubscriptionEnvironment(options.configDir),
    maxBuffer: 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function safeErrorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught || "Unknown error");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
