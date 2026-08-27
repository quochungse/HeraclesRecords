import { BrowserWindow, app, safeStorage, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { deleteSettings, getSetting, setSetting } from "./database";
import { applyCoachAutomationSessionDeleted } from "./coachAutomationStore";
import {
  formatScheduledExercisesForChat,
  getTrainingHubStatus,
  listTrainingHubActivities,
  getTrainingDashboard,
  getUpcomingWorkouts
} from "./trainingHubService";
import {
  callMcpTool,
  ensureAllMcpConnected,
  getAllMcpTools,
  getMcpServerCachedTools
} from "./mcpClientManager";
import { prefixToolName, splitToolName } from "./mcpToolNames";
import {
  getChatWorkoutTools,
  handleChatWorkoutTool,
  isChatWorkoutTool,
  uploadPlanDraftById,
  confirmWorkoutDeleteById,
  type ChatWorkoutToolName
} from "./chatWorkoutTools";
import {
  getChatActivityTools,
  handleChatActivityTool,
  isChatActivityTool,
  type ChatActivityToolName
} from "./chatActivityTools";
import {
  getChatAnalyticsTools,
  handleChatAnalyticsTool,
  isChatAnalyticsTool,
  type ChatAnalyticsToolName
} from "./chatAnalyticsTools";
import {
  getChatInteractionTools,
  handleChatInteractionTool,
  isChatInteractionTool,
  type ChatInteractionToolName
} from "./chatInteractionTools";
import { parseFunctionCallArguments } from "./chatToolArguments";
import {
  buildResponsesRequest,
  extractReasoningSummaryDelta,
  extractResponseUsage,
  extractResponseTextDelta
} from "./chatResponsesProtocol";
import {
  detectLocalChatServersRequest,
  streamLocalChatCompletion,
  testLocalChatConnectionRequest,
  type LocalChatRuntimeConfig
} from "./localChatProvider";
import {
  streamOpenRouterChatCompletion,
  testOpenRouterConnectionRequest
} from "./openRouterProvider";
import {
  AnthropicProviderError,
  streamAnthropicChatCompletion,
  testAnthropicApiConnectionRequest,
  type AnthropicRuntimeConfig
} from "./anthropicChatProvider";
import {
  ClaudeCodeProviderError,
  getClaudeCodeStatus as inspectClaudeCodeStatus,
  listClaudeCodeModels,
  logoutClaudeCode,
  startClaudeCodeLogin,
  streamClaudeCodeCompletion,
  testClaudeCodeConnection as runClaudeCodeConnectionTest,
  type ClaudeCodeLoginSession
} from "./claudeCodeProvider";
import {
  CHAT_SETTINGS_KEYS,
  readChatSettingsFromStore,
  saveChatSettingsToStore,
  type ChatApiKeyStore,
  type ChatApiKeyStores,
  type ChatSettingsStore
} from "./chatSettingsStore";
import { getChatGptModelCandidates } from "./chatModels";
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  saveChatSession,
  setChatSessionPinned
} from "./chatHistoryStore";
import type {
  ActivityVisualPreview,
  AutomationRuntime,
  AnthropicApiConfig,
  AnthropicApiConnectionTest,
  ChatAuthStatus,
  ChatEntryAutomationMarker,
  ChatSettings,
  ChatProvider,
  ChatTokenUsage,
  ChatToolPolicy,
  ClaudeCodeConfig,
  ClaudeCodeConnectionTest,
  ClaudeCodeLoginStart,
  ClaudeCodePermissions,
  ClaudeCodeStatus,
  CoachInputPrompt,
  CorosMcpTool,
  FitnessTrendPreview,
  HrZonePreview,
  LocalChatDiscovery,
  LocalChatConfig,
  LocalChatConnectionTest,
  OpenRouterConfig,
  OpenRouterConnectionTest,
  ChatMessage,
  PersistedChatEntry,
  PersistedChatSource,
  SaveChatSessionOptions,
  StoredChatToken,
  TrainingHubActivity,
  TrainingHubDashboard,
  TrainingHubUpcomingWorkout,
  UploadPlanResult,
  PlanDraftPreview,
  DeleteWorkoutResult,
  UnitSystem,
  WorkoutDeletePreview
} from "./types";
import {
  formatDistanceValue,
  formatElevationValue,
  normalizeUnitSystem
} from "./unitSystem.js";
import {
  buildCoachInstructions,
  buildCoachSportCapabilityGuide,
  formatCoachDashboard,
  formatRecentActivityMix,
  formatUpcomingWorkoutSport
} from "./chatCoachContext";

// =========================================================================
// OpenAI "Sign in with ChatGPT" provider details.
//
// ⚠️ These reuse OpenAI's Codex OAuth client + undocumented ChatGPT backend
// endpoints. They are a grey area under OpenAI's Terms and can change without
// notice. Everything provider-specific (endpoints, headers, request body,
// SSE extraction) is deliberately confined to this section + buildResponses
// Request/extractDelta so it can be adapted or swapped for a BYOK path.
// =========================================================================
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OAUTH_SCOPE = "openid profile email offline_access";
const LOOPBACK_PORT = 1455;
const LOOPBACK_REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/auth/callback`;

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
// Max agent rounds: each round is one model response; if it calls COROS tools
// we execute them and loop, until it answers with no further tool calls.
const MAX_TOOL_ROUNDS = 10;
const RESPONSES_ORIGINATOR = "codex_cli_rs";
const RESPONSES_USER_AGENT = "codex_cli_rs";

// Settings keys (encrypted blob + a plaintext timestamp).
const SETTINGS = {
  token: "chat.oauthToken",
  authUpdatedAt: "chat.authUpdatedAt",
  model: "chat.model"
} as const;

// requestId -> AbortController for in-flight streams.
const activeStreams = new Map<string, AbortController>();

// ----- Provider settings -----

export function getChatSettings(): ChatSettings {
  return readChatSettingsFromStore(chatSettingsStore, chatApiKeyStores);
}

export function saveChatSettings(settings: ChatSettings): ChatSettings {
  return saveChatSettingsToStore(chatSettingsStore, chatApiKeyStores, settings);
}

export async function testAnthropicApiConnection(
  config?: Partial<AnthropicApiConfig>
): Promise<AnthropicApiConnectionTest> {
  const saved = getChatSettings().anthropic;
  return testAnthropicApiConnectionRequest(
    getAnthropicRuntimeConfig({ ...saved, ...config })
  );
}

/**
 * Directory Claude Code keeps CorosLink's own credentials in. Returning
 * undefined lets Claude Code fall back to the machine-wide ~/.claude login.
 */
function getClaudeCodeConfigDir(
  settings = getChatSettings()
): string | undefined {
  if (settings.claudeCode.useAppScopedAuth === false) {
    return undefined;
  }
  const dir = path.join(app.getPath("userData"), "claude-code");
  // The CLI writes credentials here, so keep it owner-only.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function getClaudeCodeConnectionStatus(): Promise<ClaudeCodeStatus> {
  const settings = getChatSettings();
  const status = await inspectClaudeCodeStatus(
    settings.claudeCode.executablePath,
    getClaudeCodeConfigDir(settings)
  );
  // Only a real turn reports the model, so carry the cached one through. Without
  // this the renderer never learns a default discovered during a chat.
  const merged: ClaudeCodeStatus = {
    ...status,
    defaultModel: status.defaultModel || settings.claudeCode.defaultModel,
    availableModels:
      status.availableModels || settings.claudeCode.availableModels
  };
  const configDir = getClaudeCodeConfigDir(settings);
  if (
    !merged.availableModels?.length &&
    merged.executablePath &&
    merged.authenticated &&
    !probedModelDirs.has(configDir ?? "machine")
  ) {
    probedModelDirs.add(configDir ?? "machine");
    merged.availableModels = await readClaudeCodeModels(
      merged.executablePath,
      configDir
    );
  }
  recordClaudeCodeStatus(merged);
  return merged;
}

// listClaudeCodeModels spawns the CLI and takes over a second, so it must never
// run on the status polls that fire every 1.5-3s. One attempt per credential
// store per run; Test connection forces a fresh read.
const probedModelDirs = new Set<string>();

async function readClaudeCodeModels(
  executablePath: string,
  configDir?: string
): Promise<ClaudeCodeStatus["availableModels"]> {
  try {
    const models = await listClaudeCodeModels({ executablePath, configDir });
    return models.length > 0 ? models : undefined;
  } catch {
    // The static list still covers the picker; retry on the next status read.
    return undefined;
  }
}

// Only one sign-in can be in flight; a second attempt replaces the first.
let claudeLoginSession: ClaudeCodeLoginSession | null = null;

/**
 * Re-opens the pending sign-in page, for when Claude Code's own browser launch
 * did not land. Exposed instead of a general "open this URL" bridge so the
 * renderer can never ask the main process to launch a URL of its own choosing.
 */
export async function openClaudeCodeLoginUrl(): Promise<void> {
  const url = claudeLoginSession?.url;
  if (url) {
    await shell.openExternal(url);
  }
}

export async function beginClaudeCodeLogin(): Promise<ClaudeCodeLoginStart> {
  const settings = getChatSettings();
  const configDir = getClaudeCodeConfigDir(settings);
  const status = await inspectClaudeCodeStatus(
    settings.claudeCode.executablePath,
    configDir
  );
  recordClaudeCodeStatus(status);
  if (!status.installed || !status.executablePath) {
    throw new ClaudeCodeProviderError(status.message, "not-installed");
  }

  cancelClaudeCodeLogin();
  const session = await startClaudeCodeLogin({
    executablePath: status.executablePath,
    configDir
  });
  claudeLoginSession = session;
  // Claude Code opens the sign-in page itself as soon as it prints the URL.
  // Opening it here as well produced two browser tabs, so the automatic open is
  // left to the CLI and the app only re-opens it on request.
  return { url: session.url, scope: configDir ? "app" : "machine" };
}

/**
 * Resolves once the pending sign-in finishes, however it finishes.
 *
 * The browser flow often completes without the athlete pasting anything, so the
 * renderer awaits this instead of treating the code box as the only way out.
 */
export async function awaitClaudeCodeLogin(): Promise<ClaudeCodeStatus> {
  const session = claudeLoginSession;
  if (!session) {
    throw new ClaudeCodeProviderError(
      "Start the Claude sign-in again — the pending request expired.",
      "auth"
    );
  }
  try {
    await session.completion;
  } finally {
    if (claudeLoginSession === session) {
      claudeLoginSession = null;
    }
  }
  return getClaudeCodeConnectionStatus();
}

/** Fallback for when Claude shows a code instead of finishing in the browser. */
export function submitClaudeCodeLoginCode(code: string): void {
  const session = claudeLoginSession;
  if (!session) {
    throw new ClaudeCodeProviderError(
      "Start the Claude sign-in again — the pending request expired.",
      "auth"
    );
  }
  session.submitCode(code);
}

export function cancelClaudeCodeLogin(): void {
  claudeLoginSession?.cancel();
  claudeLoginSession = null;
}

/**
 * Clears the app's own Claude credentials so a different account can sign in.
 *
 * Deliberately refuses when the athlete opted into the machine-wide login: that
 * store is shared with their terminal and is not ours to sign out.
 */
export async function revokeClaudeCodeLogin(): Promise<ClaudeCodeStatus> {
  const settings = getChatSettings();
  const configDir = getClaudeCodeConfigDir(settings);
  if (!configDir) {
    throw new ClaudeCodeProviderError(
      "Revoking only applies to the CorosLink-only Claude login. Turn that on first, or sign out from your terminal.",
      "auth"
    );
  }

  // Any half-finished sign-in is against the credentials we are about to drop.
  cancelClaudeCodeLogin();

  const executablePath = (
    await inspectClaudeCodeStatus(settings.claudeCode.executablePath, configDir)
  ).executablePath;
  if (executablePath) {
    try {
      await logoutClaudeCode({ executablePath, configDir });
    } catch {
      // Fall through: the credential file is removed below either way.
    }
  }

  // The directory belongs to this app, so clearing anything the CLI left behind
  // cannot affect another Claude login on this computer.
  fs.rmSync(path.join(configDir, ".credentials.json"), { force: true });

  return getClaudeCodeConnectionStatus();
}

export async function testClaudeCodeConnection(): Promise<ClaudeCodeConnectionTest> {
  const settings = getChatSettings();
  const configDir = getClaudeCodeConfigDir(settings);
  const result = await runClaudeCodeConnectionTest(
    settings.claudeCode.executablePath,
    configDir
  );
  // An explicit connection test is the one moment worth re-reading the list.
  probedModelDirs.delete(configDir ?? "machine");
  const status: ClaudeCodeStatus = {
    ...result.status,
    availableModels: result.status.executablePath
      ? ((await readClaudeCodeModels(result.status.executablePath, configDir)) ??
        settings.claudeCode.availableModels)
      : settings.claudeCode.availableModels
  };
  recordClaudeCodeStatus(status);
  return { ...result, status };
}

function recordClaudeCodeStatus(status: ClaudeCodeStatus): void {
  const current = getChatSettings();
  const next: ClaudeCodeConfig = {
    ...current.claudeCode,
    executablePath: current.claudeCode.executablePath || status.executablePath,
    // Sticky: a status read that did not observe a turn reports no model, and
    // forgetting it would blank the picker's "Default (…)" label.
    defaultModel: status.defaultModel || current.claudeCode.defaultModel,
    availableModels:
      status.availableModels || current.claudeCode.availableModels,
    lastConnectionStatus: status.state,
    lastCheckedAt: status.checkedAt
  };
  // Status is re-read every few seconds while a sign-in is pending, and each
  // save is a dozen SQLite writes. Only the timestamp usually differs, so
  // compare everything else and skip the write when nothing really moved.
  if (isSameClaudeCodeRecord(current.claudeCode, next)) {
    return;
  }
  saveChatSettings({ ...current, claudeCode: next });
}

function isSameClaudeCodeRecord(
  a: ClaudeCodeConfig,
  b: ClaudeCodeConfig
): boolean {
  return (
    a.executablePath === b.executablePath &&
    a.defaultModel === b.defaultModel &&
    a.lastConnectionStatus === b.lastConnectionStatus &&
    JSON.stringify(a.availableModels) === JSON.stringify(b.availableModels)
  );
}

export function listChatSessionsForProvider(provider: ChatProvider) {
  return listChatSessions(provider);
}

export function getChatSessionEntries(id: string) {
  return getChatSession(id);
}

export function createChatSessionForProvider(provider: ChatProvider) {
  return createChatSession(provider);
}

export function saveChatSessionEntries(
  id: string,
  entries: PersistedChatEntry[],
  options?: SaveChatSessionOptions
) {
  return saveChatSession(id, entries, undefined, options);
}

export function setChatSessionPinnedById(id: string, pinned: boolean) {
  return setChatSessionPinned(id, pinned);
}

export function deleteChatSessionById(id: string): void {
  deleteChatSession(id);
  // Section 2.4: bindings pointing at this conversation have to react now, not
  // the next time a trigger happens to fire. A "dedicated" binding rebuilds its
  // conversation on its next run; an "existing" one is disabled, because only
  // the athlete knows which thread it should point at instead.
  applyCoachAutomationSessionDeleted(id);
}

export async function testLocalChatConnection(
  config?: LocalChatConfig
): Promise<LocalChatConnectionTest> {
  const saved = getLocalConfig();
  const runtime = getLocalRuntimeConfig({
    ...saved,
    ...config,
    baseUrl: config?.baseUrl ?? saved.baseUrl,
    model: config?.model ?? saved.model,
    toolsEnabled: config?.toolsEnabled ?? saved.toolsEnabled,
    hasApiKey: saved.hasApiKey,
    apiKey:
      typeof config?.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : readStoredLocalApiKey()
  });
  return testLocalChatConnectionRequest(runtime);
}

export async function detectLocalChatServers(
  apiKey?: string
): Promise<LocalChatDiscovery> {
  return detectLocalChatServersRequest(
    typeof apiKey === "string" && apiKey.trim()
      ? apiKey.trim()
      : readStoredLocalApiKey()
  );
}

export async function testOpenRouterConnection(
  config?: OpenRouterConfig
): Promise<OpenRouterConnectionTest> {
  const saved = getChatSettings().openRouter;
  return testOpenRouterConnectionRequest({
    ...saved,
    ...config,
    model: config?.model ?? saved.model,
    hasApiKey: saved.hasApiKey,
    apiKey:
      typeof config?.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : readStoredOpenRouterApiKey()
  });
}

function getLocalConfig(): LocalChatConfig {
  return getChatSettings().local;
}

function getLocalRuntimeConfig(config = getLocalConfig()): LocalChatRuntimeConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey:
      typeof config.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : readStoredLocalApiKey(),
    toolsEnabled: config.toolsEnabled
  };
}

function getAnthropicRuntimeConfig(
  config = getChatSettings().anthropic
): AnthropicRuntimeConfig {
  return {
    model: config.model,
    effort: config.effort,
    apiKey:
      typeof config.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : readEncryptedSecret(CHAT_SETTINGS_KEYS.anthropicApiKey)
  };
}

function storeEncryptedSecret(key: string, secret: string, label: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(`Secure ${label} storage is not available on this system.`);
  }
  setSetting(key, safeStorage.encryptString(secret).toString("base64"));
}

function readEncryptedSecret(key: string): string | undefined {
  const encoded = getSetting(key);
  if (!encoded || !safeStorage.isEncryptionAvailable()) {
    return undefined;
  }
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return undefined;
  }
}

function readStoredLocalApiKey(): string | undefined {
  return readEncryptedSecret(CHAT_SETTINGS_KEYS.localApiKey);
}

function readStoredOpenRouterApiKey(): string | undefined {
  return readEncryptedSecret(CHAT_SETTINGS_KEYS.openRouterApiKey);
}

const chatSettingsStore: ChatSettingsStore = {
  get: getSetting,
  set: setSetting,
  delete: deleteSettings
};

const localApiKeyStore: ChatApiKeyStore = {
  hasApiKey: () => Boolean(getSetting(CHAT_SETTINGS_KEYS.localApiKey)),
  saveApiKey: (apiKey) =>
    storeEncryptedSecret(
      CHAT_SETTINGS_KEYS.localApiKey,
      apiKey,
      "local API key"
    ),
  clearApiKey: () => deleteSettings([CHAT_SETTINGS_KEYS.localApiKey])
};

const anthropicApiKeyStore: ChatApiKeyStore = {
  hasApiKey: () => Boolean(getSetting(CHAT_SETTINGS_KEYS.anthropicApiKey)),
  saveApiKey: (apiKey) =>
    storeEncryptedSecret(
      CHAT_SETTINGS_KEYS.anthropicApiKey,
      apiKey,
      "Anthropic API key"
    ),
  clearApiKey: () => deleteSettings([CHAT_SETTINGS_KEYS.anthropicApiKey])
};

const openRouterApiKeyStore: ChatApiKeyStore = {
  hasApiKey: () => Boolean(getSetting(CHAT_SETTINGS_KEYS.openRouterApiKey)),
  saveApiKey: (apiKey) =>
    storeEncryptedSecret(
      CHAT_SETTINGS_KEYS.openRouterApiKey,
      apiKey,
      "OpenRouter API key"
    ),
  clearApiKey: () => deleteSettings([CHAT_SETTINGS_KEYS.openRouterApiKey])
};

const chatApiKeyStores: ChatApiKeyStores = {
  local: localApiKeyStore,
  anthropic: anthropicApiKeyStore,
  openRouter: openRouterApiKeyStore
};

// ----- Auth status -----

export function getChatAuthStatus(): ChatAuthStatus {
  const token = getStoredToken();
  if (!token) {
    return { signedIn: false };
  }
  return { signedIn: true, email: token.email, expiresAt: token.expires_at };
}

export function logoutChat(): ChatAuthStatus {
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();
  deleteSettings([SETTINGS.token, SETTINGS.authUpdatedAt, SETTINGS.model]);
  return { signedIn: false };
}

// ----- OAuth (Authorization Code + PKCE, loopback redirect) -----

export async function loginChat(
  parentWindow?: BrowserWindow
): Promise<ChatAuthStatus> {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier).digest()
  );
  const state = base64Url(crypto.randomBytes(16));

  const authUrl = new URL(OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", LOOPBACK_REDIRECT_URI);
  authUrl.searchParams.set("scope", OAUTH_SCOPE);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authUrl.searchParams.set("state", state);

  const code = await waitForAuthorizationCode(
    authUrl.toString(),
    state,
    parentWindow
  );
  const token = await exchangeAuthorizationCode(code, verifier);
  storeToken(token);
  return getChatAuthStatus();
}

function waitForAuthorizationCode(
  authUrl: string,
  state: string,
  parentWindow?: BrowserWindow
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let authWindow: BrowserWindow | undefined;

    const server = http.createServer((request, response) => {
      if (!request.url) {
        return;
      }
      const callbackUrl = new URL(request.url, LOOPBACK_REDIRECT_URI);
      if (callbackUrl.pathname !== "/auth/callback") {
        response.writeHead(404);
        response.end();
        return;
      }

      const error = callbackUrl.searchParams.get("error");
      const receivedState = callbackUrl.searchParams.get("state");
      const code = callbackUrl.searchParams.get("code");

      response.writeHead(200, { "Content-Type": "text/html" });
      if (error) {
        response.end("<p>ChatGPT sign-in failed. You can close this window.</p>");
        rejectOnce(new Error(error));
        return;
      }
      if (receivedState !== state || !code) {
        response.end("<p>ChatGPT sign-in failed. You can close this window.</p>");
        rejectOnce(new Error("ChatGPT OAuth state mismatch."));
        return;
      }
      response.end("<p>Signed in to ChatGPT. You can close this window.</p>");
      resolveOnce(code);
    });

    const cleanup = () => {
      try {
        server.close();
      } catch {
        // Already closing after an error path.
      }
      if (authWindow && !authWindow.isDestroyed()) {
        setTimeout(() => authWindow?.close(), 300);
      }
    };
    const resolveOnce = (code: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    server.on("error", (error) => rejectOnce(error as Error));
    server.listen(LOOPBACK_PORT, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      if (address.port !== LOOPBACK_PORT) {
        rejectOnce(new Error("ChatGPT OAuth callback port did not bind."));
        return;
      }
      authWindow = new BrowserWindow({
        width: 520,
        height: 720,
        title: "Sign in with ChatGPT",
        parent: parentWindow,
        modal: Boolean(parentWindow),
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      authWindow.on("closed", () => {
        authWindow = undefined;
        rejectOnce(new Error("ChatGPT sign-in window was closed."));
      });
      // Some OpenAI flows hop to an external verification page; keep it in-window.
      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: "deny" };
      });
      void authWindow.loadURL(authUrl);
    });
  });
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string
): Promise<StoredChatToken> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: LOOPBACK_REDIRECT_URI,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: verifier
    }).toString()
  });
  const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse & {
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `ChatGPT token exchange failed (${response.status}).`
    );
  }
  return toStoredToken(payload, undefined);
}

async function refreshAccessToken(
  existing: StoredChatToken
): Promise<StoredChatToken> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: existing.refresh_token,
      client_id: OAUTH_CLIENT_ID,
      scope: OAUTH_SCOPE
    }).toString()
  });
  const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse & {
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    // invalid_grant => the session is dead; force a fresh login.
    const err = new Error("ChatGPT session expired. Please sign in again.");
    (err as Error & { authError?: boolean }).authError = true;
    throw err;
  }
  return toStoredToken(payload, existing);
}

function toStoredToken(
  payload: OAuthTokenResponse,
  previous?: StoredChatToken
): StoredChatToken {
  const claims = payload.id_token
    ? decodeJwtClaims(payload.id_token)
    : undefined;
  const authClaim = claims?.["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string }
    | undefined;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || previous?.refresh_token || "",
    id_token: payload.id_token ?? previous?.id_token,
    account_id: authClaim?.chatgpt_account_id ?? previous?.account_id,
    email: (claims?.email as string | undefined) ?? previous?.email,
    token_type: payload.token_type ?? previous?.token_type ?? "Bearer",
    expires_at:
      Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600)
  };
}

/** Returns a non-expired access token, refreshing proactively when close. */
async function getValidToken(): Promise<StoredChatToken> {
  const token = getStoredToken();
  if (!token) {
    const err = new Error("Sign in with ChatGPT first.");
    (err as Error & { authError?: boolean }).authError = true;
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at - now < 60 && token.refresh_token) {
    const refreshed = await refreshAccessToken(token);
    storeToken(refreshed);
    return refreshed;
  }
  return token;
}

// ----- Encrypted token persistence (safeStorage, like trainingHubService) -----

function storeToken(token: StoredChatToken): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Degrade rather than crash; the user stays signed in for this session only
    // via the in-memory return values, but nothing persists.
    return;
  }
  const encrypted = safeStorage
    .encryptString(JSON.stringify(token))
    .toString("base64");
  setSetting(SETTINGS.token, encrypted);
  setSetting(SETTINGS.authUpdatedAt, new Date().toISOString());
}

function getStoredToken(): StoredChatToken | null {
  const encoded = getSetting(SETTINGS.token);
  if (!encoded || !safeStorage.isEncryptionAvailable()) {
    return null;
  }
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    const parsed = JSON.parse(decrypted) as StoredChatToken;
    return parsed.access_token ? parsed : null;
  } catch {
    return null;
  }
}

// ----- Streaming chat -----

/**
 * Where a stream's events go. Interactive chat pushes them at a renderer;
 * headless automation runs will accumulate them in the main process instead,
 * so `streamChat` must not know which it is talking to.
 */
export interface ChatStreamSink {
  emit(channel: string, payload: unknown): void;
  /**
   * Optional abort wiring, returning a teardown callback. The window sink uses
   * it to abort when the window closes; a headless sink leaves it undefined so
   * a run survives having no window.
   */
  bindAbort?(controller: AbortController): () => void;
}

/**
 * A usage report that can be counted, or nothing.
 *
 * "Nobody reported" and "it was free" are different facts (13), and a number
 * that is negative, NaN or infinite is neither — it is a third thing, and the
 * only honest reading of it is the first. Guarded here rather than only where
 * the run row is read, because this is where the number *enters*: a `local`
 * provider is whatever OpenAI-compatible server the athlete pointed the app at,
 * and a negative round would quietly reduce a total the month's budget trusts.
 */
export function countableUsage(
  value: ChatTokenUsage | undefined
): ChatTokenUsage | undefined {
  if (!value) return undefined;
  const { inputTokens, outputTokens } = value;
  const usable = (count: unknown): count is number =>
    typeof count === "number" && Number.isFinite(count) && count >= 0;
  return usable(inputTokens) && usable(outputTokens)
    ? { inputTokens, outputTokens }
    : undefined;
}

export interface StreamChatOptions {
  unitSystem?: UnitSystem;
  /** Automation runs override the saved provider/model/effort (decision 2). */
  runtime?: AutomationRuntime;
  /** Automation runs narrow the tool set (decision 3). Defaults to interactive. */
  toolPolicy?: ChatToolPolicy;
  /** Automation role, injected as its own hardened instruction block. */
  roleInstructions?: string;
}

/**
 * The interactive sink: sends every event to the renderer and aborts the
 * stream when the window goes away, which is what an athlete closing the
 * window means.
 */
export function createWindowSink(
  mainWindow: BrowserWindow | null | undefined
): ChatStreamSink {
  return {
    emit(channel, payload) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    },
    bindAbort(controller) {
      const onClosed = () => controller.abort();
      mainWindow?.once("closed", onClosed);
      return () => mainWindow?.removeListener("closed", onClosed);
    }
  };
}

/**
 * The headless sink: turns the same stream events into the
 * `PersistedChatEntry[]` an interactive turn would have produced in the
 * renderer, mirroring how ChatView handles `chat:streamInfo` and
 * `chat:streamDone`. An automation run has no renderer to assemble its
 * transcript, so this is where that assembly moves to.
 *
 * It deliberately omits `bindAbort`: closing the window must not abort an
 * automation run.
 */
export interface ChatStreamCollectorSink extends ChatStreamSink {
  /** The transcript so far. Complete once `chat:streamDone` has arrived. */
  entries(): PersistedChatEntry[];
  /** True once the run finished, whether it succeeded, cancelled or failed. */
  finished(): boolean;
  /** Set when the stream ended with `finishReason: "cancelled"`. */
  cancelled(): boolean;
  /** The `chat:streamError` message, when the stream failed. */
  error(): string | undefined;
  /** True when that failure was an authentication problem, not a model error. */
  authError(): boolean;
  /** The assistant's final text, for the run's one-line summary. */
  text(): string;
  /** What the turn cost, when the provider reported it (13). */
  usage(): ChatTokenUsage | undefined;
}

function upsertEntry(
  entries: PersistedChatEntry[],
  entry: PersistedChatEntry,
  matches: (candidate: PersistedChatEntry) => boolean
): void {
  const index = entries.findIndex(matches);
  if (index >= 0) {
    entries[index] = entry;
    return;
  }
  entries.push(entry);
}

export function createCollectorSink(
  automation?: ChatEntryAutomationMarker
): ChatStreamCollectorSink {
  const entries: PersistedChatEntry[] = [];
  let pendingCoachPrompts: CoachInputPrompt[] = [];
  let source: PersistedChatSource | null = null;
  let thinking = "";
  let streamedText = "";
  let finalText = "";
  let isFinished = false;
  let wasCancelled = false;
  let failure: string | undefined;
  let failureWasAuth = false;
  let tokenUsage: ChatTokenUsage | undefined;

  const reset = () => {
    pendingCoachPrompts = [];
    source = null;
    thinking = "";
    streamedText = "";
  };

  const handleInfo = (payload: Record<string, unknown>) => {
    const kind = payload.kind;

    if (kind === "context") {
      source = {
        snapshotIncluded: Boolean(payload.snapshotIncluded),
        mcpEnabled: Boolean(payload.mcpEnabled),
        mcpUsed: false,
        mcpTools: []
      };
      return;
    }

    if (kind === "thinking") {
      if (typeof payload.delta === "string") {
        thinking += payload.delta;
      }
      return;
    }

    if (kind === "mcp") {
      const base: PersistedChatSource = source ?? {
        snapshotIncluded: false,
        mcpEnabled: true,
        mcpUsed: false,
        mcpTools: []
      };
      const tool = typeof payload.tool === "string" ? payload.tool : undefined;
      const status = typeof payload.status === "string" ? payload.status : "";
      const message =
        typeof payload.message === "string" ? payload.message : undefined;
      const mcpError =
        /fail|error/i.test(status) || message
          ? message ?? status
          : base.mcpError;
      source = {
        ...base,
        mcpUsed: true,
        mcpTools: tool ? [...base.mcpTools, tool] : base.mcpTools,
        // Omitted rather than set to undefined so the collected source matches
        // what `parseSource` rebuilds on reload.
        ...(mcpError ? { mcpError } : {})
      };
      return;
    }

    if (kind === "coachPrompt") {
      const prompt = payload.prompt as CoachInputPrompt | undefined;
      if (!prompt?.promptId) return;
      pendingCoachPrompts = [
        ...pendingCoachPrompts.filter(
          (entry) => entry.promptId !== prompt.promptId
        ),
        prompt
      ];
      return;
    }

    if (kind === "planDraft") {
      const draft = payload.draft as PlanDraftPreview | undefined;
      if (!draft?.draftId) return;
      upsertEntry(
        entries,
        { kind: "planDraft", draft },
        (candidate) =>
          candidate.kind === "planDraft" &&
          candidate.draft.draftId === draft.draftId
      );
      return;
    }

    if (kind === "workoutDelete") {
      const preview = payload.preview as WorkoutDeletePreview | undefined;
      if (!preview?.requestId) return;
      upsertEntry(
        entries,
        { kind: "workoutDelete", preview },
        (candidate) =>
          candidate.kind === "workoutDelete" &&
          candidate.preview.requestId === preview.requestId
      );
      return;
    }

    // The visualization cards are collected whichever way the athlete has the
    // display toggle set: ChatView filters them out of its *timeline*, but a
    // headless run has to persist everything the turn produced, and the
    // renderer decides what to show when it opens the conversation.
    if (kind === "activityVisual") {
      const preview = payload.preview as ActivityVisualPreview | undefined;
      if (!preview?.previewId) return;
      upsertEntry(
        entries,
        { kind: "activityVisual", preview },
        (candidate) =>
          candidate.kind === "activityVisual" &&
          candidate.preview.previewId === preview.previewId
      );
      return;
    }

    if (kind === "fitnessTrend") {
      const preview = payload.preview as FitnessTrendPreview | undefined;
      if (!preview?.previewId) return;
      upsertEntry(
        entries,
        { kind: "fitnessTrend", preview },
        (candidate) =>
          candidate.kind === "fitnessTrend" &&
          candidate.preview.previewId === preview.previewId
      );
      return;
    }

    if (kind === "hrZoneSummary") {
      const preview = payload.preview as HrZonePreview | undefined;
      if (!preview?.previewId) return;
      upsertEntry(
        entries,
        { kind: "hrZoneSummary", preview },
        (candidate) =>
          candidate.kind === "hrZoneSummary" &&
          candidate.preview.previewId === preview.previewId
      );
    }
  };

  /**
   * What the turn cost, from whichever event carried it. Recorded even on a
   * cancelled turn and even on a failed one: the tokens were spent before the
   * athlete pressed Stop or before the provider broke, and a budget that
   * forgave either would let a fan-out stopped halfway — or a provider that
   * always throws — cost nothing on paper (13).
   */
  const recordUsage = (value: unknown): void => {
    const counted = countableUsage(value as ChatTokenUsage | undefined);
    if (counted) {
      tokenUsage = counted;
    }
  };

  const handleDone = (payload: Record<string, unknown>) => {
    isFinished = true;
    recordUsage(payload.usage);
    // ChatView reads the final text off the done payload; fall back to the
    // accumulated tokens so a provider that omits it cannot lose the answer.
    const fullText =
      typeof payload.fullText === "string" && payload.fullText
        ? payload.fullText
        : streamedText;
    const reasoningSummary = thinking.trim() || undefined;

    if (payload.finishReason === "cancelled") {
      wasCancelled = true;
      reset();
      return;
    }

    finalText = fullText;
    const prompts = pendingCoachPrompts;
    const turnSource = source ?? undefined;

    if (fullText) {
      entries.push({
        kind: "message",
        role: "assistant",
        content: fullText,
        ...(turnSource ? { source: turnSource } : {}),
        ...(reasoningSummary ? { reasoningSummary } : {}),
        ...(automation ? { automation } : {})
      });
    }
    for (const prompt of prompts) {
      upsertEntry(
        entries,
        { kind: "coachPrompt", prompt },
        (candidate) =>
          candidate.kind === "coachPrompt" &&
          candidate.prompt.promptId === prompt.promptId
      );
    }
    reset();
  };

  return {
    emit(channel, payload) {
      const record = (payload ?? {}) as Record<string, unknown>;
      if (channel === "chat:streamStart") {
        reset();
        return;
      }
      if (channel === "chat:streamToken") {
        if (typeof record.delta === "string") {
          streamedText += record.delta;
        }
        return;
      }
      if (channel === "chat:streamInfo") {
        handleInfo(record);
        return;
      }
      if (channel === "chat:streamDone") {
        handleDone(record);
        return;
      }
      if (channel === "chat:streamError") {
        isFinished = true;
        failure =
          typeof record.message === "string"
            ? record.message
            : "Chat request failed.";
        failureWasAuth = record.authError === true;
        // A failed turn spent whatever its completed rounds spent, and 13 says
        // it is recorded on every exit that reached the model — not only the
        // ones that got as far as `chat:streamDone`. Without this a provider
        // that always breaks runs through the month's ceiling for free.
        recordUsage(record.usage);
        reset();
      }
    },
    entries: () => [...entries],
    usage: () => tokenUsage,
    finished: () => isFinished,
    cancelled: () => wasCancelled,
    error: () => failure,
    authError: () => failureWasAuth,
    text: () => finalText
  };
}

export async function streamChat(
  sink: ChatStreamSink,
  requestId: string,
  messages: ChatMessage[],
  options: StreamChatOptions = {}
): Promise<void> {
  const unitSystem = normalizeUnitSystem(options.unitSystem);
  const toolPolicy: ChatToolPolicy =
    options.toolPolicy === "read-only" || options.toolPolicy === "none"
      ? options.toolPolicy
      : "interactive";
  const roleInstructions = options.roleInstructions;
  const runtime = options.runtime ?? {};
  // What this turn cost, summed across its tool rounds and across whichever
  // provider answered. Left undefined when nobody reported: a run that cost
  // nothing and a run nobody counted are different facts, and a budget that
  // reads the second as the first undercounts in silence (13).
  let usage: ChatTokenUsage | undefined;
  const addUsage = (round: ChatTokenUsage | undefined) => {
    const counted = countableUsage(round);
    if (!counted) return;
    usage = {
      inputTokens: (usage?.inputTokens ?? 0) + counted.inputTokens,
      outputTokens: (usage?.outputTokens ?? 0) + counted.outputTokens
    };
  };
  const send = (channel: string, payload: unknown) => {
    sink.emit(channel, payload);
  };
  /**
   * The one way this turn reports a failure. Everything it spent before it
   * broke rides along: 13 records a cost on every exit that reached the model,
   * and a failed turn is not a refund — a provider that reliably breaks would
   * otherwise run an automation through the month's ceiling for free.
   *
   * It is a function rather than a rule to remember at each throw site because
   * dropping the usage on one of them type-checks and compiles into a send that
   * quietly under-reports.
   */
  const sendStreamError = (payload: {
    message: string;
    authError?: boolean;
  }): void => {
    send("chat:streamError", {
      requestId,
      ...payload,
      ...(usage ? { usage } : {})
    });
  };

  const controller = new AbortController();
  activeStreams.set(requestId, controller);
  const releaseAbort = sink.bindAbort?.(controller);

  let fullText = "";
  try {
    const settings = getChatSettings();
    // An automation may run on a different provider than the interactive chat
    // without touching the saved settings (decision 2).
    const provider = runtime.provider ?? settings.provider;
    if (provider === "claude-code") {
      const claudeConfigDir = getClaudeCodeConfigDir(settings);
      const status = await inspectClaudeCodeStatus(
        settings.claudeCode.executablePath,
        claudeConfigDir
      );
      recordClaudeCodeStatus(status);
      if (!status.authenticated || !status.executablePath) {
        throw new ClaudeCodeProviderError(
          status.message,
          status.installed ? "auth" : "not-installed"
        );
      }

      await ensureAllMcpConnected();
      const chatTools = getClaudeCodeTools(
        settings.claudeCode.permissions,
        toolPolicy
      );
      const { text: instructions, hasData } = await buildTrainingContext(
        settings.claudeCode.permissions,
        unitSystem,
        settings.customInstructions,
        roleInstructions
      );
      const effectiveInstructions = withLiveToolInstructions(
        instructions,
        chatTools
      );

      send("chat:streamStart", { requestId });
      send("chat:streamInfo", {
        requestId,
        kind: "context",
        snapshotIncluded: hasData,
        mcpEnabled: chatTools.length > 0
      });

      const result = await streamClaudeCodeCompletion({
        executablePath: status.executablePath,
        instructions: effectiveInstructions,
        messages,
        tools: chatTools,
        signal: controller.signal,
        model: runtime.model ?? settings.claudeCode.model,
        effort: runtime.effort ?? settings.claudeCode.effort,
        configDir: claudeConfigDir,
        onModelResolved: (model) => {
          // An automation's override says nothing about the interactive
          // default, so never let one overwrite the saved defaultModel.
          if (runtime.model?.trim() || settings.claudeCode.model?.trim()) return;
          const current = getChatSettings();
          if (current.claudeCode.defaultModel === model) return;
          saveChatSettings({
            ...current,
            claudeCode: { ...current.claudeCode, defaultModel: model }
          });
        },
        onToken: (delta) => {
          fullText += delta;
          send("chat:streamToken", { requestId, delta });
        },
        onThinking: (delta) => {
          send("chat:streamInfo", { requestId, kind: "thinking", delta });
        },
        onToolCallStart: (toolName) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: toolName,
            status: "call"
          });
        },
        onToolCallError: (toolName, message) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: toolName,
            status: "failed",
            message
          });
        },
        onToolCall: async (toolName, args) => {
          if (!chatTools.some((tool) => tool.name === toolName)) {
            throw new Error(`Claude attempted an unapproved tool: ${toolName}`);
          }
          return executeChatTool(
            toolName,
            args,
            send,
            requestId,
            unitSystem,
            settings.claudeCode.permissions,
            toolPolicy
          );
        }
      });
      fullText = result.fullText;
      addUsage(result.usage);
      recordClaudeCodeStatus({
        ...status,
        state: "connected",
        checkedAt: new Date().toISOString(),
        message: "Claude Code is connected and ready for Coach conversations."
      });
      send("chat:streamDone", { requestId, fullText, ...(usage ? { usage } : {}) });
      return;
    }

    if (provider === "openrouter") {
      const apiKey = readStoredOpenRouterApiKey();
      if (!apiKey) {
        throw new Error("Add an OpenRouter API key in Coach settings first.");
      }
      const { text: instructions, hasData } = await buildTrainingContext(
        undefined,
        unitSystem,
        settings.customInstructions,
        roleInstructions
      );

      await ensureAllMcpConnected();
      const chatTools = applyChatToolPolicy(getAllChatTools(), toolPolicy);
      const effectiveInstructions = withLiveToolInstructions(
        instructions,
        chatTools
      );

      send("chat:streamStart", { requestId });
      send("chat:streamInfo", {
        requestId,
        kind: "context",
        snapshotIncluded: hasData,
        mcpEnabled: chatTools.length > 0
      });

      const result = await streamOpenRouterChatCompletion({
        config: {
          model: runtime.model ?? settings.openRouter.model,
          apiKey
        },
        instructions: effectiveInstructions,
        fallbackInstructions: instructions,
        messages,
        tools: chatTools,
        maxToolRounds: MAX_TOOL_ROUNDS,
        signal: controller.signal,
        onToken: (delta) => {
          fullText += delta;
          send("chat:streamToken", { requestId, delta });
        },
        onToolCallStart: (call) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "call"
          });
        },
        onToolCallError: (call, message) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "failed",
            message
          });
        },
        onToolCall: async (call) => {
          const tool = findChatTool(call.name);
          const args = parseFunctionCallArguments(call, tool);
          console.log("[chat] OpenRouter tool call:", call.name);
          return executeChatTool(
            call.name,
            args,
            send,
            requestId,
            unitSystem,
            undefined,
            toolPolicy
          );
        }
      });
      fullText = result.fullText;
      addUsage(result.usage);
      send("chat:streamDone", { requestId, fullText, ...(usage ? { usage } : {}) });
      return;
    }

    if (provider === "claude-api") {
      const runtimeConfig = {
        ...getAnthropicRuntimeConfig(settings.anthropic),
        ...(runtime.model ? { model: runtime.model } : {}),
        ...(runtime.effort ? { effort: runtime.effort } : {})
      };
      if (!runtimeConfig.apiKey) {
        throw new AnthropicProviderError(
          "Add your Anthropic API key in Settings to use Claude directly.",
          "no-key"
        );
      }

      await ensureAllMcpConnected();
      const chatTools = applyChatToolPolicy(getAllChatTools(), toolPolicy);
      const { text: instructions, hasData } = await buildTrainingContext(
        undefined,
        unitSystem,
        settings.customInstructions,
        roleInstructions
      );
      const effectiveInstructions = withLiveToolInstructions(
        instructions,
        chatTools
      );

      send("chat:streamStart", { requestId });
      send("chat:streamInfo", {
        requestId,
        kind: "context",
        snapshotIncluded: hasData,
        mcpEnabled: chatTools.length > 0
      });

      const result = await streamAnthropicChatCompletion({
        config: runtimeConfig,
        instructions: effectiveInstructions,
        messages,
        tools: chatTools,
        maxToolRounds: MAX_TOOL_ROUNDS,
        signal: controller.signal,
        onToken: (delta) => {
          fullText += delta;
          send("chat:streamToken", { requestId, delta });
        },
        onThinking: (delta) => {
          send("chat:streamInfo", { requestId, kind: "thinking", delta });
        },
        onToolCallStart: (toolName) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: toolName,
            status: "call"
          });
        },
        onToolCallError: (toolName, message) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: toolName,
            status: "failed",
            message
          });
        },
        onToolCall: async (toolName, args) => {
          console.log("[chat] tool call:", toolName);
          return executeChatTool(
            toolName,
            args,
            send,
            requestId,
            unitSystem,
            undefined,
            toolPolicy
          );
        }
      });
      fullText = result.fullText;
      addUsage(result.usage);
      send("chat:streamDone", { requestId, fullText, ...(usage ? { usage } : {}) });
      return;
    }

    if (provider === "local") {
      const { text: instructions, hasData } = await buildTrainingContext(
        undefined,
        unitSystem,
        settings.customInstructions,
        roleInstructions
      );
      const runtimeConfig = {
        ...getLocalRuntimeConfig(settings.local),
        ...(runtime.model ? { model: runtime.model } : {})
      };

      if (runtimeConfig.toolsEnabled) {
        await ensureAllMcpConnected();
      }
      const chatTools = applyChatToolPolicy(
        runtimeConfig.toolsEnabled
          ? getAllChatTools()
          : [...getChatWorkoutTools(), ...getChatInteractionTools()],
        toolPolicy
      );
      const effectiveInstructions = withLiveToolInstructions(
        instructions,
        chatTools
      );

      send("chat:streamStart", { requestId });
      send("chat:streamInfo", {
        requestId,
        kind: "context",
        snapshotIncluded: hasData,
        mcpEnabled: chatTools.length > 0
      });

      const result = await streamLocalChatCompletion({
        config: runtimeConfig,
        instructions: effectiveInstructions,
        fallbackInstructions: instructions,
        messages,
        tools: chatTools,
        maxToolRounds: MAX_TOOL_ROUNDS,
        signal: controller.signal,
        onToken: (delta) => {
          fullText += delta;
          send("chat:streamToken", { requestId, delta });
        },
        onToolsDisabled: () => {
          send("chat:streamInfo", {
            requestId,
            kind: "context",
            snapshotIncluded: hasData,
            mcpEnabled: false
          });
        },
        onToolCallStart: (call) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "call"
          });
        },
        onToolCallError: (call, message) => {
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "failed",
            message
          });
        },
        onToolCall: async (call) => {
          const tool = findChatTool(call.name);
          const args = parseFunctionCallArguments(call, tool);
          console.log("[chat] tool call:", call.name);
          return executeChatTool(
            call.name,
            args,
            send,
            requestId,
            unitSystem,
            undefined,
            toolPolicy
          );
        }
      });
      fullText = result.fullText;
      addUsage(result.usage);
      send("chat:streamDone", { requestId, fullText, ...(usage ? { usage } : {}) });
      return;
    }

    const token = await getValidToken();
    const { text: instructions, hasData } = await buildTrainingContext(
      undefined,
      unitSystem,
      settings.customInstructions,
      roleInstructions
    );

    // Reconnect a previously-authorized COROS MCP session, then expose its tools
    // to the model as function tools so it can pull data on demand.
    await ensureAllMcpConnected();
    const tools = buildChatFunctionTools();

    // When live tools are available, steer the model to use them rather than
    // leaning on the brief snapshot in `instructions`.
    const effectiveInstructions = withLiveToolInstructions(
      instructions,
      applyChatToolPolicy(getAllChatTools(), toolPolicy)
    );

    send("chat:streamStart", { requestId });
    send("chat:streamInfo", {
      requestId,
      kind: "context",
      snapshotIncluded: hasData,
      mcpEnabled: tools.length > 0
    });

    // Responses-API input items, extended each round with the model's tool calls
    // and our tool results.
    const input: Record<string, unknown>[] = messages.map(toInputMessageItem);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const opened = await resolveModelAndOpenStream(
        token,
        requestId,
        effectiveInstructions,
        input,
        tools,
        controller.signal,
        settings.chatgpt.model
      );
      if ("error" in opened) {
        sendStreamError({ message: opened.error, authError: opened.authError });
        return;
      }

      const reader = opened.response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const functionCalls: FunctionCall[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; keep the trailing partial.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = extractSseData(frame);
          if (data === null || data === "[DONE]") continue;
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            continue; // ignore partial/non-JSON frames
          }
          // Diagnostic: confirm the backend accepted our tools (echoed back on
          // the response.created event) rather than silently stripping them.
          if (
            (event as { type?: string }).type === "response.created" &&
            tools.length > 0
          ) {
            const echoed = (event as { response?: { tools?: unknown[] } }).response
              ?.tools;
            console.log(
              "[chat] tools sent:",
              tools.length,
              "· accepted by backend:",
              Array.isArray(echoed) ? echoed.length : "unknown"
            );
          }
          const reasoningDelta = extractReasoningSummaryDelta(event);
          if (reasoningDelta) {
            send("chat:streamInfo", {
              requestId,
              kind: "thinking",
              delta: reasoningDelta
            });
            continue;
          }
          const delta = extractResponseTextDelta(event);
          if (delta) {
            fullText += delta;
            send("chat:streamToken", { requestId, delta });
            continue;
          }
          addUsage(extractResponseUsage(event));
          const call = extractFunctionCall(event);
          if (call) functionCalls.push(call);
        }
      }

      // No tool calls this round → the model answered; we're done.
      if (functionCalls.length === 0) break;

      // Echo the calls back into the conversation, execute each against COROS,
      // append the results, and loop for the model to use them.
      for (const call of functionCalls) {
        input.push({
          type: "function_call",
          call_id: call.call_id,
          name: call.name,
          arguments: call.arguments
        });
      }
      for (const call of functionCalls) {
        send("chat:streamInfo", {
          requestId,
          kind: "mcp",
          tool: call.name,
          status: "call"
        });
        let output: string;
        try {
          const sourceTool = findChatTool(call.name);
          const args = parseFunctionCallArguments(call, sourceTool);
          output = await executeChatTool(
            call.name,
            args,
            send,
            requestId,
            unitSystem,
            undefined,
            toolPolicy
          );
        } catch (toolError) {
          output =
            "Error: " +
            (toolError instanceof Error ? toolError.message : "tool call failed");
          send("chat:streamInfo", {
            requestId,
            kind: "mcp",
            tool: call.name,
            status: "failed",
            message: output
          });
        }
        console.log("[chat] COROS tool call:", call.name);
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output
        });
      }
    }

    send("chat:streamDone", { requestId, fullText, ...(usage ? { usage } : {}) });
  } catch (error) {
    if (controller.signal.aborted) {
      send("chat:streamDone", {
        requestId,
        fullText,
        finishReason: "cancelled",
        ...(usage ? { usage } : {})
      });
    } else {
      if (getChatSettings().provider === "claude-code") {
        const current = getChatSettings().claudeCode;
        const failure =
          error instanceof ClaudeCodeProviderError ? error.kind : "connection";
        recordClaudeCodeStatus({
          state:
            failure === "usage-limit"
              ? "usage-limit-reached"
              : failure === "auth"
                ? "sign-in-required"
                : failure === "not-installed"
                  ? "not-installed"
                  : "connection-failed",
          installed: failure !== "not-installed",
          authenticated: failure !== "auth" && failure !== "not-installed",
          executablePath: current.executablePath,
          checkedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : "Claude request failed."
        });
      }
      const authError = Boolean(
        (error as Error & { authError?: boolean }).authError
      );
      sendStreamError({
        message: error instanceof Error ? error.message : "Chat request failed.",
        authError
      });
    }
  } finally {
    releaseAbort?.();
    activeStreams.delete(requestId);
  }
}

export function cancelChat(requestId: string): void {
  activeStreams.get(requestId)?.abort();
  activeStreams.delete(requestId);
}

export async function uploadTrainingPlanDraft(
  draftId: string,
  unitSystem: UnitSystem = "metric",
  destination: import("./types").TrainingPlanDestination = "workoutLibrary",
  scheduleDate?: string
): Promise<UploadPlanResult> {
  return uploadPlanDraftById(
    draftId,
    normalizeUnitSystem(unitSystem),
    destination,
    scheduleDate
  );
}

export async function confirmWorkoutDelete(
  requestId: string
): Promise<DeleteWorkoutResult> {
  return confirmWorkoutDeleteById(requestId);
}

function getAllChatTools(): CorosMcpTool[] {
  return [
    ...getAllMcpTools(),
    ...getChatActivityTools(),
    ...getChatAnalyticsTools(),
    ...getChatWorkoutTools(),
    ...getChatInteractionTools()
  ];
}

const CLAUDE_REMOTE_READ_TOOLS: Record<
  keyof ClaudeCodePermissions,
  readonly string[]
> = {
  recentActivities: [
    "get_recent_activities",
    "get_activity_details",
    "get_activity_detail"
  ],
  trainingMetrics: [
    "get_training_metrics",
    "get_fitness_metrics",
    "get_recovery_metrics",
    "get_training_load"
  ],
  upcomingWorkouts: ["get_upcoming_workouts", "get_training_calendar"],
  sleepData: ["get_sleep_summary", "get_sleep_data"],
  fullActivityFiles: []
};

/**
 * Section 6, decision 3: an auto run may draft and propose, never write.
 * `upload_training_plan` and `delete_workout` are the write surface today; any
 * future write tool must be added here as well.
 */
/**
 * Section 6's read-only set, as an **allowlist**.
 *
 * It was a blocklist of the two known write tools, and that cannot deliver what
 * 6 promises — *"Blocked: `upload_training_plan`, `delete_workout`, and any
 * future write tool."* A blocklist makes a tool added tomorrow **allowed**, so
 * decision 3 ("auto runs may draft and propose, never write to COROS") held
 * only for as long as everybody who adds a tool remembers this file exists.
 * Inverting it moves the default to the safe side: a new tool is unreachable
 * from an unattended run until somebody says otherwise, which is the same rule
 * already applied to non-COROS MCP servers one line down.
 *
 * `request_coach_input` is on the list deliberately: nobody is there to answer,
 * so it returns "state your assumption and continue" and leaves a `coachPrompt`
 * card the athlete can answer later (6).
 *
 * Drafting stays allowed because it is already non-destructive — the draft
 * tools return a preview and the real write only happens from the athlete's
 * confirmation card.
 */
const READ_ONLY_ALLOWED_TOOLS = new Set([
  "list_recent_activities",
  "get_activity_detail",
  "get_fitness_trends",
  "get_hr_zone_summary",
  "list_scheduled_workouts",
  "search_coros_exercises",
  "draft_workout",
  "draft_training_plan",
  "request_coach_input"
]);

/**
 * Narrows a tool set to what an automation run may call. Beyond the allowlist
 * this drops every non-COROS MCP server the athlete configured: their write
 * surface is unknown, so they are excluded by default rather than inspected.
 */
export function isToolAllowedUnderPolicy(
  name: string,
  policy: ChatToolPolicy = "interactive"
): boolean {
  if (policy === "none") {
    return false;
  }
  if (policy !== "read-only") {
    return true;
  }
  const remote = splitToolName(name);
  // A remote tool's write surface is its server's business, and only the COROS
  // one is known — those are already permission-gated by name before they get
  // here (6).
  if (remote) {
    return remote.serverId === "coros";
  }
  // A local tool the app owns. Not on the list means not decided, and not
  // decided means not reachable from a run nobody is watching.
  return READ_ONLY_ALLOWED_TOOLS.has(name);
}

export function applyChatToolPolicy(
  tools: CorosMcpTool[],
  policy: ChatToolPolicy = "interactive"
): CorosMcpTool[] {
  return policy === "interactive"
    ? tools
    : tools.filter((tool) => isToolAllowedUnderPolicy(tool.name, policy));
}

export function getClaudeCodeTools(
  permissions: ClaudeCodePermissions,
  toolPolicy: ChatToolPolicy = "interactive"
): CorosMcpTool[] {
  const remoteAllowedNames = new Set<string>();
  for (const [permission, names] of Object.entries(CLAUDE_REMOTE_READ_TOOLS)) {
    if (permissions[permission as keyof ClaudeCodePermissions]) {
      for (const name of names) remoteAllowedNames.add(name);
    }
  }

  // COROS remote tools are permission-gated by their (unprefixed) names, then
  // exposed prefixed. Other MCP servers the user configured are exposed in full.
  const remoteTools = [
    ...getMcpServerCachedTools("coros")
      .filter((tool) => remoteAllowedNames.has(tool.name))
      .map((tool) => ({ ...tool, name: prefixToolName("coros", tool.name) })),
    ...getAllMcpTools().filter((tool) => !tool.name.startsWith("coros__"))
  ];
  const activityTools = permissions.recentActivities
    ? getChatActivityTools()
    : [];
  const analyticsTools = permissions.trainingMetrics
    ? getChatAnalyticsTools()
    : [];
  const workoutTools = getChatWorkoutTools().filter((tool) => {
    if (
      tool.name === "upload_training_plan" ||
      tool.name === "list_scheduled_workouts" ||
      tool.name === "delete_workout"
    ) {
      return permissions.upcomingWorkouts;
    }
    return (
      tool.name === "draft_workout" ||
      tool.name === "draft_training_plan" ||
      tool.name === "search_coros_exercises"
    );
  });

  return applyChatToolPolicy(
    [
      ...remoteTools,
      ...activityTools,
      ...analyticsTools,
      ...workoutTools,
      ...getChatInteractionTools()
    ],
    toolPolicy
  );
}

async function executeChatTool(
  name: string,
  args: Record<string, unknown>,
  send: (channel: string, payload: unknown) => void,
  requestId: string,
  unitSystem: UnitSystem,
  claudePermissions?: ClaudeCodePermissions,
  toolPolicy: ChatToolPolicy = "interactive"
): Promise<string> {
  // Every provider branch converges here, so this is the one place the
  // read-only boundary cannot be routed around by a model that names a tool it
  // was never offered.
  if (!isToolAllowedUnderPolicy(name, toolPolicy)) {
    throw new Error(
      `${name} is not available to an automation run; it may only read, analyse and draft.`
    );
  }

  if (isChatInteractionTool(name)) {
    return handleChatInteractionTool(
      name as ChatInteractionToolName,
      args,
      (prompt) => {
        send("chat:streamInfo", {
          requestId,
          kind: "coachPrompt",
          prompt
        });
      },
      toolPolicy
    );
  }
  if (isChatWorkoutTool(name)) {
    return handleChatWorkoutTool(name as ChatWorkoutToolName, args, {
      onPlanDraft: (preview: PlanDraftPreview) => {
        send("chat:streamInfo", {
          requestId,
          kind: "planDraft",
          draft: preview
        });
      },
      onWorkoutDelete: (preview) => {
        send("chat:streamInfo", {
          requestId,
          kind: "workoutDelete",
          preview
        });
      },
      allowUpcomingWorkouts: claudePermissions?.upcomingWorkouts !== false,
      unitSystem
    });
  }
  if (isChatActivityTool(name)) {
    try {
      return await handleChatActivityTool(name as ChatActivityToolName, args, {
        requestId,
        onActivityVisual: (preview) => {
          send("chat:streamInfo", {
            requestId,
            kind: "activityVisual",
            preview
          });
        },
        unitSystem
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught);
      send("chat:streamInfo", {
        requestId,
        kind: "mcp",
        tool: name,
        status: "failed",
        message
      });
      throw caught;
    }
  }
  if (isChatAnalyticsTool(name)) {
    try {
      return await handleChatAnalyticsTool(name as ChatAnalyticsToolName, args, {
        requestId,
        onFitnessTrend: (preview) => {
          send("chat:streamInfo", {
            requestId,
            kind: "fitnessTrend",
            preview
          });
        },
        onHrZoneSummary: (preview) => {
          send("chat:streamInfo", {
            requestId,
            kind: "hrZoneSummary",
            preview
          });
        },
        unitSystem
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught);
      send("chat:streamInfo", {
        requestId,
        kind: "mcp",
        tool: name,
        status: "failed",
        message
      });
      throw caught;
    }
  }
  try {
    return await callMcpTool(name, args);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    send("chat:streamInfo", {
      requestId,
      kind: "mcp",
      tool: name,
      status: "failed",
      message
    });
    throw caught;
  }
}

function findChatTool(name: string): CorosMcpTool | undefined {
  return getAllChatTools().find((tool) => tool.name === name);
}

// ----- Provider request/response shape (isolated) -----

/**
 * Sends the request with the selected model. Auto mode tries candidates until
 * the account accepts one (the ChatGPT-plan codex endpoint rejects unsupported
 * models with a 400 before streaming), then caches the working model.
 */
async function resolveModelAndOpenStream(
  token: StoredChatToken,
  requestId: string,
  instructions: string,
  input: Record<string, unknown>[],
  tools: Record<string, unknown>[],
  signal: AbortSignal,
  selectedModel?: string
): Promise<{ response: Response } | { error: string; authError: boolean }> {
  const cached = getSetting(SETTINGS.model);
  const candidates = getChatGptModelCandidates(selectedModel, cached);

  let lastDetail = "";
  for (const model of candidates) {
    const open = (includeReasoningSummary: boolean) =>
      fetch(RESPONSES_URL, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "OpenAI-Beta": "responses=experimental",
          originator: RESPONSES_ORIGINATOR,
          "User-Agent": RESPONSES_USER_AGENT,
          session_id: requestId,
          ...(token.account_id ? { "chatgpt-account-id": token.account_id } : {})
        },
        body: JSON.stringify(
          buildResponsesRequest(
            model,
            instructions,
            input,
            tools,
            includeReasoningSummary
          )
        )
      });

    let response = await open(true);
    let responseDetail = "";
    if (!response.ok && response.status === 400) {
      responseDetail = await response.text().catch(() => "");
      if (/reasoning|summary/i.test(responseDetail)) {
        // Some plan/model combinations do not expose summaries. Preserve the
        // Coach response and tool progress rather than failing the whole turn.
        response = await open(false);
        responseDetail = "";
      }
    }

    if (response.ok && response.body) {
      if (model !== cached) setSetting(SETTINGS.model, model);
      return { response };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        error: "ChatGPT session rejected. Please sign in again.",
        authError: true
      };
    }

    lastDetail =
      responseDetail || (await response.text().catch(() => ""));
    // Unsupported-model rejection: drop a stale cached choice and try the next.
    if (response.status === 400 && /is not supported/i.test(lastDetail)) {
      if (model === cached) deleteSettings([SETTINGS.model]);
      continue;
    }
    return {
      error: `Chat request failed (${response.status}). ${truncate(lastDetail, 600)}`,
      authError: false
    };
  }

  return {
    error: selectedModel?.trim()
      ? `The selected model (${selectedModel.trim()}) is not available for this ChatGPT account. ${truncate(lastDetail, 600)}`
      : `No supported chat model for this ChatGPT account. ${truncate(lastDetail, 600)}`,
    authError: false
  };
}

/** A COROS message turned into a Responses-API input item. */
function toInputMessageItem(message: ChatMessage): Record<string, unknown> {
  return {
    type: "message",
    role: message.role,
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content
      }
    ]
  };
}

/** Exposes connected MCP and local workout tools to the model as functions. */
function buildChatFunctionTools(): Record<string, unknown>[] {
  return getAllChatTools().map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
    strict: false
  }));
}

function withLiveToolInstructions(
  instructions: string,
  tools: CorosMcpTool[]
): string {
  if (tools.length === 0) {
    return instructions;
  }
  const activityTools = tools.filter((tool) => isChatActivityTool(tool.name));
  const analyticsTools = tools.filter((tool) => isChatAnalyticsTool(tool.name));
  const interactionTools = tools.filter((tool) =>
    isChatInteractionTool(tool.name)
  );
  const mcpTools = tools.filter(
    (tool) =>
      !isChatWorkoutTool(tool.name) &&
      !isChatActivityTool(tool.name) &&
      !isChatAnalyticsTool(tool.name) &&
      !isChatInteractionTool(tool.name)
  );
  const corosMcpTools = mcpTools.filter((tool) =>
    tool.name.startsWith("coros__")
  );
  const otherMcpTools = mcpTools.filter(
    (tool) => !tool.name.startsWith("coros__")
  );
  const planTools = tools.filter((tool) => isChatWorkoutTool(tool.name));
  const sections = [instructions, "", "## Live training data and tools"];
  if (activityTools.length > 0) {
    sections.push(
      `Local Training Hub tools (preferred for laps/splits): ${activityTools
        .map((tool) => tool.name)
        .join(", ")}. ` +
        "Use list_recent_activities to find activity_id and sport_type, then " +
        "get_activity_detail for lap tables. Set include_series=true for HR/pace/power trends. " +
        "Inline activity charts (HR, pace, power, elevation, laps) appear automatically when data is available."
    );
  }
  if (analyticsTools.length > 0) {
    sections.push(
      `Training analytics tools: ${analyticsTools.map((tool) => tool.name).join(", ")}. ` +
        "Use get_fitness_trends for 7-day load, resting HR, and HRV recovery trends. " +
        "Use get_hr_zone_summary for threshold heart rate zone distribution. " +
        "Inline charts are shown automatically when these tools return data."
    );
  }
  if (corosMcpTools.length > 0) {
    sections.push(
      `COROS MCP tools: ${corosMcpTools.map((tool) => tool.name).join(", ")}. ` +
        "Use these for sleep, HRV, recovery, and other MCP-only metrics. " +
        "For lap splits and interval breakdowns, prefer get_activity_detail."
    );
  }
  if (otherMcpTools.length > 0) {
    sections.push(
      `Other connected MCP server tools: ${otherMcpTools
        .map((tool) => tool.name)
        .join(", ")}. ` +
        "Use each tool according to its own name, description, and schema. " +
        "Do not assume these tools return COROS data."
    );
  }
  if (planTools.length > 0) {
    sections.push(
      "",
      "## Workout and training plan tools",
      `Authoring tools: ${planTools.map((tool) => tool.name).join(", ")}. ` +
        "Use draft_workout for exactly one standalone workout. Its card lets the athlete choose Workout Library or Calendar; set calendar_date only when the athlete names a date. " +
        "Use draft_training_plan only for multi-day or multi-week schedules. Never wrap a one-off workout in a plan. " +
        "Before drafting Strength or HYROX workouts, call search_coros_exercises once with all intended " +
        "exercise queries, or with target muscles, movement patterns, and known equipment; then use the " +
        "returned exact exercise IDs and names. A COROS naming mismatch alone never requires an athlete question. " +
        "For Strength exercises, set sets explicitly, use target_reps or target_duration_seconds per set, " +
        "and set rest_type=1 plus rest_value in seconds. Do not hide the prescription only in the step name. " +
        "Always provide sport on every new workout, including sport=run. " +
        "Use distance_km only for a simple Run or Trail Run; use steps for anything structured. " +
        "Pick each step's target " +
        "deliberately: distance for easy/long/tempo blocks, time for duration-based reps " +
        "and recovery jogs, load only when prescribing by training-load budget, and open " +
        "(no value, run-until-lap) for by-feel warmups/cooldowns or fartlek surges. Put every " +
        "prescribed HR, pace, effort pace, power, cadence, stroke, weight, RPE, or grade in " +
        "the typed intensity field; do not leave it only in workout prose or the name. " +
        "For draft_training_plan entries intended for calendar placement, include schedule_date " +
        "(YYYYMMDD). A multi-workout draft is saved as a grouped local Training Plan by default; the athlete may instead choose individual COROS workouts or Calendar. " +
        "The athlete must confirm the destination and any one-off workout date before saving. " +
        "Use list_scheduled_workouts + delete_workout to stage deletions. " +
        "The athlete confirms via the Delete from COROS button in chat.",
      "",
      "Supported workout capabilities (generated from the validator):",
      buildCoachSportCapabilityGuide()
    );
  }
  if (interactionTools.length > 0) {
    sections.push(
      "",
      "## Athlete questions",
      "When you need an answer before continuing, call request_coach_input with one concise question and 2–5 distinct choices. " +
        "Put the recommended choice first and explain important tradeoffs in each choice description. " +
        "Do not ask a clarification question only in prose. After calling request_coach_input, stop and wait for the athlete's next message."
    );
  }
  return sections.join("\n");
}

interface FunctionCall {
  call_id: string;
  name: string;
  arguments: string;
}

/** Detects a completed function tool call in a Responses-API SSE event. */
function extractFunctionCall(event: unknown): FunctionCall | null {
  if (!event || typeof event !== "object") return null;
  const evt = event as {
    type?: string;
    item?: { type?: string; call_id?: string; name?: string; arguments?: string };
  };
  if (
    evt.type === "response.output_item.done" &&
    evt.item?.type === "function_call" &&
    evt.item.call_id &&
    evt.item.name
  ) {
    return {
      call_id: evt.item.call_id,
      name: evt.item.name,
      arguments: evt.item.arguments ?? ""
    };
  }
  return null;
}

function extractSseData(frame: string): string | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return dataLines.join("");
}

// ----- Training-data context assembly -----

async function buildTrainingContext(
  permissions?: ClaudeCodePermissions,
  unitSystem: UnitSystem = "metric",
  customInstructions?: string,
  roleInstructions?: string
): Promise<{ text: string; hasData: boolean }> {
  // Rebuilt per request so edits to the athlete's custom instructions apply live.
  const coachInstructions = buildCoachInstructions(
    customInstructions,
    roleInstructions
  );
  const unitInstruction =
    `The athlete selected ${unitSystem === "imperial" ? "Imperial" : "Metric"} units. ` +
    `Use ${unitSystem === "imperial" ? "miles, feet, min/mi, mph, pounds, and yards for swims" : "kilometres, metres, min/km, km/h, and kilograms"} in every user-facing answer and tool summary. ` +
    "Keep tool-schema distance, elevation, pace, and weight fields canonical internally; do not reinterpret their numeric values.";
  let status: Awaited<ReturnType<typeof getTrainingHubStatus>>;
  try {
    status = getTrainingHubStatus();
  } catch {
    status = { authenticated: false };
  }
  if (!status.authenticated) {
    return {
      hasData: false,
      text:
        `${coachInstructions}\n\n${unitInstruction}\n\n` +
        "NOTE: The athlete is not signed in to COROS Training Hub, so no training " +
        "data is available. Encourage them to connect it for personalised advice."
    };
  }

  const includeActivities = permissions?.recentActivities !== false;
  const includeMetrics = permissions?.trainingMetrics !== false;
  const includeUpcoming = permissions?.upcomingWorkouts !== false;
  const [activities, dashboard, upcoming] = await Promise.allSettled([
    includeActivities
      ? listTrainingHubActivities(1, 25)
      : Promise.resolve([] as TrainingHubActivity[]),
    includeMetrics
      ? getTrainingDashboard()
      : Promise.resolve(null as TrainingHubDashboard | null),
    includeUpcoming
      ? getUpcomingWorkouts(14)
      : Promise.resolve([] as TrainingHubUpcomingWorkout[])
  ]);

  const sections: string[] = [coachInstructions, "", unitInstruction, ""];
  let hasData = false;

  if (activities.status === "fulfilled" && activities.value.length > 0) {
    sections.push(`## Recent activity mix (latest ${activities.value.length})`);
    sections.push(formatRecentActivityMix(activities.value, unitSystem));
    sections.push("");
    sections.push("## Recent activities");
    sections.push(formatActivities(activities.value.slice(0, 8), unitSystem));
    sections.push("");
    hasData = true;
  }
  if (dashboard.status === "fulfilled" && dashboard.value) {
    const fitness = formatCoachDashboard(dashboard.value);
    if (fitness) {
      sections.push("## Fitness & recovery");
      sections.push(fitness);
      sections.push("");
      hasData = true;
    }
  }
  if (upcoming.status === "fulfilled" && upcoming.value.length > 0) {
    sections.push("## Upcoming workouts");
    sections.push(formatUpcoming(upcoming.value, unitSystem));
    sections.push("");
    hasData = true;
  }

  if (permissions && !hasData) {
    sections.push(
      "The athlete's current Claude privacy settings did not include a training " +
        "snapshot for this request. Do not infer private COROS values."
    );
  }

  return { text: sections.join("\n").trim(), hasData };
}

function formatActivities(
  activities: TrainingHubActivity[],
  unitSystem: UnitSystem
): string {
  return activities
    .map((activity) => {
      const parts = [
        `id=${activity.activityId}`,
        `sport_type=${activity.sportType}`,
        activity.startTime ? isoDate(activity.startTime) : "",
        activity.sportName ?? "",
        activity.name ?? "",
        activity.distance
          ? formatDistanceValue(activity.distance, unitSystem, {
              swim:
                activity.sportType === 300 ||
                activity.sportType === 301 ||
                /swim/i.test(activity.sportName ?? "")
            })
          : "",
        activity.duration ? formatDurationSeconds(activity.duration) : "",
        activity.avgHr ? `avg HR ${activity.avgHr}` : "",
        activity.trainingLoad ? `load ${activity.trainingLoad}` : "",
        activity.elevationGain
          ? `+${formatElevationValue(activity.elevationGain, unitSystem)}`
          : ""
      ].filter(Boolean);
      return `- ${parts.join(" · ")}`;
    })
    .join("\n");
}

function formatUpcomingVolume(
  volume: string | undefined,
  unitSystem: UnitSystem
): string {
  const value = volume?.trim() ?? "";
  const match = value.match(/^([\d.]+)\s*(km|m)$/i);
  if (!match) return value;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return value;
  return formatDistanceValue(
    amount * (match[2]?.toLowerCase() === "km" ? 1_000 : 1),
    unitSystem,
    { swim: match[2]?.toLowerCase() === "m" }
  );
}

function formatUpcoming(
  workouts: TrainingHubUpcomingWorkout[],
  unitSystem: UnitSystem
): string {
  return workouts
    .map((workout) => {
      const exerciseDetail = workout.exercises?.length
        ? formatScheduledExercisesForChat(
            workout.exercises,
            unitSystem,
            Number(workout.sportType) === 3
          )
        : undefined;
      const parts = [
        workout.happenDay,
        formatUpcomingWorkoutSport(workout.sportType),
        workout.name,
        formatUpcomingVolume(workout.volume, unitSystem),
        workout.trainingLoad ? `load ${workout.trainingLoad}` : "",
        exerciseDetail ? `exercises: ${exerciseDetail}` : ""
      ].filter(Boolean);
      return `- ${parts.join(" · ")}`;
    })
    .join("\n");
}

// ----- Small helpers -----

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeJwtClaims(jwt: string): Record<string, unknown> | undefined {
  const segment = jwt.split(".")[1];
  if (!segment) return undefined;
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isoDate(epochSeconds: number): string {
  // COROS start times are unix seconds.
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function formatDurationSeconds(value: number): string {
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
