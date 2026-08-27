import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const providerUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "claudeCodeProvider.js")
).href;

const {
  createClaudeSubscriptionEnvironment,
  extractLoginUrl,
  logoutClaudeCode,
  startClaudeCodeLogin,
  toClaudeModelOption,
  getClaudeCodeStatus,
  getClaudeExecutableCandidates,
  normalizeClaudeCodeError,
  parseClaudeAuthStatusOutput,
  stripAnsi
} = await import(`${providerUrl}?cacheBust=${Date.now()}`);

assert.deepEqual(
  parseClaudeAuthStatusOutput(
    JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      subscriptionType: "pro"
    })
  ),
  {
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "pro"
  }
);
// The account identity is what tells the athlete which of the two credential
// stores is live, so it must survive parsing.
const identified = parseClaudeAuthStatusOutput(
  JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "athlete@example.com",
    orgName: "Example Org",
    subscriptionType: "max"
  })
);
assert.equal(identified.email, "athlete@example.com");
assert.equal(identified.orgName, "Example Org");
assert.equal(parseClaudeAuthStatusOutput("not-json"), undefined);
assert.equal(
  parseClaudeAuthStatusOutput('status:\n{"loggedIn":false}')?.loggedIn,
  false
);

const macCandidates = getClaudeExecutableCandidates(undefined, "darwin", {
  HOME: "/Users/tester"
});
assert.ok(macCandidates.includes("/Users/tester/.local/bin/claude"));
assert.ok(macCandidates.includes("/opt/homebrew/bin/claude"));

const windowsCandidates = getClaudeExecutableCandidates(undefined, "win32", {
  USERPROFILE: "C:\\Users\\tester",
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local"
});
assert.ok(
  windowsCandidates.some((candidate) =>
    candidate.endsWith(path.join("Programs", "Claude", "claude.exe"))
  )
);

const previousApiKey = process.env.ANTHROPIC_API_KEY;
const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
process.env.ANTHROPIC_API_KEY = "must-not-leak";
process.env.ANTHROPIC_BASE_URL = "https://example.invalid";
const subscriptionEnv = createClaudeSubscriptionEnvironment();
assert.equal(subscriptionEnv.ANTHROPIC_API_KEY, undefined);
assert.equal(subscriptionEnv.ANTHROPIC_BASE_URL, undefined);
assert.equal(subscriptionEnv.CLAUDE_AGENT_SDK_CLIENT_APP, "coroslink-coach");
// Without an explicit dir, Claude Code keeps using the machine-wide login.
assert.equal(subscriptionEnv.CLAUDE_CONFIG_DIR, undefined);
const scopedEnv = createClaudeSubscriptionEnvironment("/tmp/coroslink-claude");
assert.equal(scopedEnv.CLAUDE_CONFIG_DIR, "/tmp/coroslink-claude");
assert.equal(scopedEnv.ANTHROPIC_API_KEY, undefined);
assert.equal(
  createClaudeSubscriptionEnvironment("   ").CLAUDE_CONFIG_DIR,
  undefined
);
if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
else process.env.ANTHROPIC_API_KEY = previousApiKey;
if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;

assert.equal(normalizeClaudeCodeError(new Error("rate limit 429")).kind, "usage-limit");
assert.equal(
  normalizeClaudeCodeError(new Error("Not logged in · Please run /login")).kind,
  "auth"
);
assert.equal(normalizeClaudeCodeError(new Error("spawn ENOENT")).kind, "not-installed");

// `claude auth login` only prints the authorize URL as a browser fallback, so
// the sign-in flow depends on scraping it back out of the CLI output.
const loginOutput =
  "Opening browser to sign in\u2026\n" +
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz\n" +
  "Paste code here if prompted > ";
assert.equal(
  extractLoginUrl(loginOutput),
  "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz"
);
assert.equal(
  extractLoginUrl("\u001b[1mvisit: https://claude.com/cai/oauth/authorize?a=1\u001b[0m"),
  "https://claude.com/cai/oauth/authorize?a=1"
);
// A URL closing a sentence must not swallow the punctuation.
assert.equal(
  extractLoginUrl("go to https://claude.com/cai/oauth/authorize?a=1."),
  "https://claude.com/cai/oauth/authorize?a=1"
);
assert.equal(extractLoginUrl("no link here"), undefined);
assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red");

// Signing out must never fall through to the machine-wide login in ~/.claude.
await assert.rejects(
  () => logoutClaudeCode({ executablePath: "/bin/true", configDir: "   " }),
  (error) => error.kind === "connection"
);

// Sign-in completes in the browser with no code pasted, so the session must
// detect it without help from the athlete. Two shapes have to work.
if (process.platform !== "win32") {
  // The fake CLIs are written at run time rather than committed, so no stub
  // scripts linger in the repo. Each one stands in for a real `claude auth
  // login` shape that has already broken the sign-in flow.
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-stub-"));
  const stub = (name, loginBody) => {
    const file = path.join(stubDir, name);
    fs.writeFileSync(
      file,
      [
        "#!/bin/sh",
        'DIR="${CLAUDE_CONFIG_DIR:-/tmp}"',
        'case "$1 $2" in',
        '  "auth status")',
        '    if [ -f "$DIR/.credentials.json" ]; then',
        `      echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}'`,
        "    else",
        `      echo '{"loggedIn":false,"authMethod":"none"}'`,
        "    fi",
        "    ;;",
        '  "auth login")',
        loginBody,
        "    ;;",
        '  *) echo "2.1.187 (fake)" ;;',
        "esac",
        ""
      ].join("\n"),
      { mode: 0o755 }
    );
    return file;
  };

  const writesCredentials =
    '    mkdir -p "$DIR"; echo \'{}\' > "$DIR/.credentials.json"';

  // 1. The CLI writes credentials and exits.
  const exitDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-exit-"));
  const exiting = await startClaudeCodeLogin({
    executablePath: stub(
      "writes-then-exits",
      [
        '    echo "If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=abc"',
        "    sleep 1",
        writesCredentials,
        "    exit 0"
      ].join("\n")
    ),
    configDir: exitDir
  });
  assert.equal(
    exiting.url,
    "https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=abc"
  );
  assert.equal(await exiting.completion, "signed-in");
  fs.rmSync(exitDir, { recursive: true, force: true });

  // 2. Exit code 0 is not proof of a sign-in: the CLI also exits 0 when it gives
  //    up. Trusting it reported success while no credentials existed.
  const abandonedDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-gone-"));
  const abandoned = await startClaudeCodeLogin({
    executablePath: stub(
      "exits-without-signing-in",
      [
        '    echo "If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&state=gone"',
        "    sleep 1",
        "    exit 0"
      ].join("\n")
    ),
    configDir: abandonedDir
  });
  await assert.rejects(
    () => abandoned.completion,
    (error) => error.kind === "auth"
  );
  fs.rmSync(abandonedDir, { recursive: true, force: true });

  // 3. The real shape: credentials are written but the CLI stays parked on its
  //    paste-code prompt forever. Waiting on the process alone spins here, which
  //    is what left the sign-in card stuck on "Waiting for your browser…".
  const parkedDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-parked-"));
  const parked = await startClaudeCodeLogin({
    executablePath: stub(
      "writes-then-parks",
      [
        '    echo "If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&state=parked"',
        `    ( sleep 1; ${writesCredentials.trim()} ) >/dev/null 2>&1 &`,
        `    printf 'Paste code here if prompted > '`,
        "    exec sleep 120"
      ].join("\n")
    ),
    configDir: parkedDir
  });
  assert.match(parked.url, /state=parked$/);
  assert.equal(await parked.completion, "signed-in");
  fs.rmSync(parkedDir, { recursive: true, force: true });
  fs.rmSync(stubDir, { recursive: true, force: true });
}

// The CLI is the only source for the version behind an alias, and it hides it in
// the description: "Sonnet 4.6 · Efficient for routine tasks". The version leads
// the pill; the rest qualifies the row only once the menu is open.
assert.deepEqual(
  toClaudeModelOption({
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 4.6 · Efficient for routine tasks"
  }),
  { value: "sonnet", label: "Sonnet 4.6", detail: "Efficient for routine tasks" }
);
// Trailing segments stay together rather than being dropped.
assert.deepEqual(
  toClaudeModelOption({
    value: "opus",
    displayName: "Opus",
    description: "Opus 4.8 · Best for everyday, complex tasks · ~2× usage vs Sonnet"
  }),
  {
    value: "opus",
    label: "Opus 4.8",
    detail: "Best for everyday, complex tasks · ~2× usage vs Sonnet"
  }
);
// "default" maps onto the empty value both pickers persist, and carries no
// qualifier because its label already spends the parentheses on the model name.
assert.deepEqual(
  toClaudeModelOption({
    value: "default",
    displayName: "Default (recommended)",
    description: "Sonnet 4.6 · Efficient for routine tasks"
  }),
  { value: "", label: "Default (Sonnet 4.6)" }
);
// No description: fall back to the resolved id, then to the display name.
assert.deepEqual(
  toClaudeModelOption({
    value: "sonnet",
    displayName: "Sonnet",
    resolvedModel: "claude-sonnet-4-6"
  }),
  { value: "sonnet", label: "Sonnet 4.6", detail: undefined }
);
assert.deepEqual(
  toClaudeModelOption({ value: "mystery", displayName: "Mystery" }),
  { value: "mystery", label: "Mystery", detail: undefined }
);

const missing = await getClaudeCodeStatus(
  path.join(repoRoot, "scripts", "fixtures", "missing-claude")
);
assert.equal(missing.state, "not-installed");
assert.equal(missing.installed, false);
assert.equal(missing.authenticated, false);

console.log("claude code provider tests passed");
