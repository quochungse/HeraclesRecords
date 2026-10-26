// Exercise the real Manage providers → conversation AI flow. ChatGPT must
// become selectable without remounting Coach, including after visiting Settings.
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const settings = {
  provider: "claude-code",
  chatgpt: {},
  anthropic: { model: "claude-opus-5", effort: "high", hasApiKey: false },
  claudeCode: { effort: "high", permissions: {
    recentActivities: true, trainingMetrics: true, upcomingWorkouts: true,
    sleepData: false, fullActivityFiles: false
  } },
  local: { baseUrl: "http://localhost:11434/v1", model: "", hasApiKey: false, toolsEnabled: true },
  openRouter: { model: "openrouter/auto", hasApiKey: false },
  sidebarOpen: true,
  visualizationsEnabled: true,
  customInstructions: ""
};
const account = {
  signedIn: true,
  name: "Coach Athlete",
  email: "athlete.with.a.long.account.name.for.training.notifications@example.test",
  plan: "plus"
};
const script = {
  getChatAuthStatus: { signedIn: false },
  getChatSettings: settings,
  getClaudeCodeStatus: { state: "connected", version: "2.0.0", newerVersion: "2.1.0" },
  refreshChatModels: { settings, errors: {} },
  getCorosMcpStatus: { connected: false },
  getMcpStatuses: [],
  listChatSessions: [{ id: "s1", title: "Training", provider: "claude-code",
    createdAt: "2026-10-26T06:00:00.000Z", updatedAt: "2026-10-26T06:00:00.000Z" }],
  getChatSession: [],
  listCoachAnalysisSessionAttention: [],
  listCoachAnalysesForSession: []
};
let win;
const evaluate = (source) => win.webContents.executeJavaScript(source, true);
const harness = (method, ...args) => evaluate(`window.__harness.${method}(${args.map((arg) => JSON.stringify(arg)).join(",")})`);
async function waitFor(read, description) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(`Timed out: ${description}; console: ${JSON.stringify(await harness("consoleErrors"))}`);
}
const chatGptRow = () => evaluate(`Array.from(document.querySelectorAll('.plan-generator-provider-option')).find(row => row.textContent.includes('ChatGPT'))?.textContent ?? null`);
async function openProviders() {
  assert.equal(await harness("clickText", ".plan-generator-sheet-link", "Manage providers"), true);
  await waitFor(() => harness("exists", ".chatgpt-account-card"), "ChatGPT account card");
}
async function closeProviders() {
  await harness("click", ".app-modal-header .icon-button");
  await waitFor(() => harness("exists", ".plan-generator-provider-list"), "return to conversation AI");
}

async function chooseConversationModel(value) {
  await harness("click", ".plan-generator-sheet-models .app-select-trigger");
  await waitFor(() => harness("exists", ".app-select-menu"), "conversation model menu");
  await harness("click", `.app-select-menu [data-value="${value}"]`);
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1200, height: 900,
    webPreferences: { backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness/index.html"));
  await harness("mount", "ChatView", { styles: true }, script);
  await waitFor(() => harness("exists", ".chat-ai-chip"), "conversation AI control");
  await waitFor(() => harness("appStylesReady"), "app styles");
  await harness("click", ".chat-ai-chip");
  await waitFor(() => harness("exists", ".plan-generator-provider-list"), "conversation AI sheet");
  assert.equal(await chatGptRow(), null, "signed-out, nonselected ChatGPT is initially hidden");

  // A failed login stays local to the account card and can be retried.
  await openProviders();
  assert.doesNotMatch(await harness("text", ".app-modal-body"), /claude update|Claude Code 2\.1\.0 is available/,
    "provider settings omit the Claude upgrade reminder even when an update is available");
  await harness("setScript", { loginChat: { __reject: "Sign-in cancelled" } });
  await harness("click", ".chat-settings-signin");
  await waitFor(() => harness("exists", ".chatgpt-account-card [role='alert']"), "inline login error");
  assert.match(await harness("text", ".chatgpt-account-card [role='alert']"), /Sign-in cancelled/);

  // The new login updates Coach's state while the modal is still open.
  await harness("setScript", { loginChat: "__pending" });
  await harness("click", ".chat-settings-signin");
  await waitFor(() => harness("attr", ".chat-settings-signin", "disabled").then((value) => value !== null), "pending login disables duplicate attempts");
  await harness("setScript", { getChatAuthStatus: account });
  await harness("resolvePending", "loginChat", account);
  await waitFor(() => harness("exists", ".chatgpt-account-status.is-connected"), "connected account");
  assert.equal(await harness("text", ".chatgpt-account-identity .chat-settings-email"), account.name);
  assert.ok((await harness("text", ".chatgpt-account-identity")).includes(account.email));
  assert.equal(await harness("text", ".chatgpt-account-plan"), "ChatGPT Plus");
  assert.equal(await harness("exists", ".chatgpt-account-card [role='alert']"), false);

  // Check the card in both themes and in a narrow dialog with a long email.
  for (const width of [1200, 420]) {
    win.setSize(width, 900);
    for (const theme of ["dark", "paper"]) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      assert.ok((await harness("overflowX", ".chatgpt-account-card")) <= 1, `${width}px ${theme}: card fits`);
      assert.ok((await harness("overflowX", ".chatgpt-account-footer")) <= 1, `${width}px ${theme}: actions fit`);
    }
  }
  win.setSize(1200, 900);
  await closeProviders();
  await waitFor(async () => /Connected/.test(await chatGptRow() ?? ""), "new ChatGPT item appears as connected");
  // Refreshing connections must preserve the conversation's chosen provider.
  assert.match(await harness("text", ".plan-generator-provider-option[aria-pressed='true']"), /Claude/);

  // Signing out removes the nonselected provider without restarting Coach.
  await openProviders();
  await harness("setScript", { logoutChat: "__pending" });
  await harness("click", ".chatgpt-account-signout");
  await waitFor(() => harness("attr", ".chatgpt-account-signout", "disabled").then((value) => value !== null), "pending logout disables duplicate attempts");
  await harness("setScript", { getChatAuthStatus: { signedIn: false } });
  await harness("resolvePending", "logoutChat", { signedIn: false });
  await waitFor(() => harness("exists", ".chat-settings-signin"), "signed-out account");
  await closeProviders();
  await waitFor(async () => (await chatGptRow()) === null, "signed-out ChatGPT disappears");

  // Visiting app Settings keeps Coach mounted; returning must re-read auth too.
  await harness("click", ".plan-generator-sheet header .icon-button");
  await harness("setProps", { active: false });
  await harness("setScript", { getChatAuthStatus: account,
    getClaudeCodeStatus: { __reject: "Claude status unavailable" } });
  await harness("setProps", { active: true });
  await harness("click", ".chat-ai-chip");
  await waitFor(async () => /Connected/.test(await chatGptRow() ?? ""), "returning to Coach refreshes ChatGPT even if Claude status fails");

  // A manual refresh forces a new list, updates the account, and keeps drafts
  // in the other provider cards while credentials are being re-read.
  await openProviders();
  const draftField = ".chat-claude-section input[type='password']";
  await harness("setValue", draftField, "unsaved-provider-key");
  await harness("setScript", {
    refreshChatModels: "__pending",
    getChatAuthStatus: { ...account, plan: "pro" }
  });
  await harness("clearCalls");
  await harness("click", ".chatgpt-account-refresh");
  await waitFor(() => harness("callCount", "refreshChatModels"), "manual model refresh");
  assert.deepEqual((await harness("calls", "refreshChatModels"))[0].args, [{ provider: "chatgpt", force: true }]);
  assert.notEqual(await harness("attr", ".chatgpt-account-refresh", "disabled"), null);
  assert.notEqual(await harness("attr", ".chatgpt-account-signout", "disabled"), null);
  await harness("click", ".chatgpt-account-refresh");
  assert.equal(await harness("callCount", "refreshChatModels"), 1, "duplicate refresh is blocked");
  await harness("resolvePending", "refreshChatModels", { settings, errors: {} });
  await waitFor(async () => (await harness("attr", ".chatgpt-account-refresh", "disabled")) === null, "refresh completes");
  assert.equal(await harness("text", ".chatgpt-account-plan"), "ChatGPT Pro");
  assert.equal(await harness("value", draftField), "unsaved-provider-key");

  await harness("setScript", { refreshChatModels: { __reject: "Network unavailable" } });
  await harness("click", ".chatgpt-account-refresh");
  await waitFor(() => harness("exists", ".chatgpt-account-card [role='alert']"), "inline refresh error");
  assert.match(await harness("text", ".chatgpt-account-card [role='alert']"), /Network unavailable/);
  assert.equal(await harness("exists", ".chatgpt-account-status.is-connected"), true, "network failure keeps the account");

  // Refresh also detects a removed login, without requesting a model list
  // using missing credentials, and passes the change back to the AI picker.
  await harness("setScript", { getChatAuthStatus: { signedIn: false } });
  await harness("clearCalls");
  await harness("click", ".chatgpt-account-refresh");
  await waitFor(() => harness("exists", ".chat-settings-signin"), "refresh discovers signed-out account");
  await waitFor(async () => (await harness("attr", ".chatgpt-account-refresh", "disabled")) === null, "signed-out refresh completes");
  assert.equal(await harness("callCount", "refreshChatModels"), 0);
  assert.equal(await harness("exists", ".chatgpt-account-card [role='alert']"), false);
  await closeProviders();
  await waitFor(async () => (await chatGptRow()) === null, "manual refresh updates conversation AI");
  assert.deepEqual(await harness("consoleErrors"), [], "no renderer errors");

  // ChatGPT offers exactly the levels from its catalog, including values the
  // application has never heard of. Changes belong to this conversation.
  const chatGptSettings = { ...settings, provider: "chatgpt",
    chatgpt: { model: "gpt-test", effort: "none" },
    modelCatalogs: { chatgpt: { fetchedAt: "2026-10-26T00:00:00.000Z", models: [
      { value: "gpt-test", label: "Test model", reasoning: {
        defaultEffort: "future-depth", efforts: [
          { value: "none", description: "No reasoning" },
          { value: "future-depth", description: "A new depth supplied by ChatGPT" }
        ] } },
      { value: "gpt-other", label: "Other model", reasoning: {
        defaultEffort: "alternate-depth", efforts: [{ value: "alternate-depth" }] } }
    ] } }
  };
  const conversation = { sessionId: "s1", sources: { activities: true, sleep: true, zones: true },
    runtime: { provider: "chatgpt" } };
  await harness("mount", "ChatView", { styles: true }, { ...script,
    getChatSettings: chatGptSettings, getChatAuthStatus: account,
    refreshChatModels: { settings: chatGptSettings, errors: {} },
    listChatSessions: script.listChatSessions.map((session) => ({ ...session, provider: "chatgpt" })),
    getConversationSettings: conversation, setConversationSettings: "__pending"
  });
  await waitFor(() => harness("callCount", "getConversationSettings"), "conversation configuration loaded");
  await waitFor(() => harness("exists", ".chat-ai-chip"), "ChatGPT conversation");
  await harness("click", ".chat-ai-chip");
  const effortTrigger = ".plan-generator-sheet-effort .app-select-trigger";
  await waitFor(() => harness("exists", effortTrigger), "ChatGPT effort picker");
  await harness("click", effortTrigger);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.app-select-menu [role="option"]')).map(row => row.dataset.value)`),
    ["", "none", "future-depth"], "no hardcoded effort levels are injected");
  assert.match(await harness("text", ".app-select-menu"), /A new depth supplied by ChatGPT/);
  await harness("click", '.app-select-menu [data-value="future-depth"]');
  await waitFor(() => harness("callCount", "setConversationSettings"), "effort persisted");
  assert.equal((await harness("calls", "setConversationSettings")).at(-1).args[0].runtime.effort, "future-depth");
  await harness("resolvePending", "setConversationSettings", { ...conversation, runtime: { provider: "chatgpt", effort: "future-depth" } });
  await waitFor(async () => /Future-depth/.test(await harness("text", effortTrigger) ?? ""), "selected effort retained");

  await harness("click", effortTrigger);
  await harness("click", '.app-select-menu [data-value=""]');
  await waitFor(async () => (await harness("calls", "setConversationSettings")).at(-1)?.args[0].runtime.effort === "", "Auto clears the saved effort override");
  await harness("resolvePending", "setConversationSettings", { ...conversation, runtime: { provider: "chatgpt", effort: "" } });
  await waitFor(async () => /Auto/.test(await harness("text", effortTrigger) ?? ""), "model default shown");
  await chooseConversationModel("gpt-other");
  await waitFor(async () => /Alternate-depth/.test(await harness("text", effortTrigger) ?? ""), "model change loads its own reasoning configuration");
  await harness("click", effortTrigger);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.app-select-menu [role="option"]')).map(row => row.dataset.value)`),
    ["", "alternate-depth"]);
  assert.deepEqual(await harness("consoleErrors"), [], "no effort renderer errors");

  // An explicit Auto belongs to the conversation even when provider settings
  // still name a model. Changing it stores the complete choice for future chats.
  const autoSettings = { ...chatGptSettings, chatgpt: { model: "gpt-other", effort: "future-depth" } };
  const autoConversation = { ...conversation, runtime: { provider: "chatgpt", model: "", effort: "" } };
  await harness("mount", "ChatView", { styles: true }, { ...script,
    getChatSettings: autoSettings, getChatAuthStatus: account,
    refreshChatModels: { settings: autoSettings, errors: {} },
    listChatSessions: script.listChatSessions.map((session) => ({ ...session, provider: "chatgpt" })),
    getConversationSettings: autoConversation, setConversationSettings: "__pending"
  });
  await waitFor(() => harness("callCount", "getConversationSettings"), "Auto conversation loaded");
  await harness("click", ".chat-ai-chip");
  await waitFor(() => harness("exists", '.plan-generator-sheet-models[data-value=""]'), "conversation Auto overrides saved provider model");
  await chooseConversationModel("gpt-test");
  await waitFor(() => harness("callCount", "setConversationSettings"), "complete runtime persisted");
  assert.deepEqual((await harness("calls", "setConversationSettings")).at(-1).args[0].runtime,
    { provider: "chatgpt", model: "gpt-test", effort: "" });
  await harness("resolvePending", "setConversationSettings", { ...autoConversation, runtime: { provider: "chatgpt", model: "gpt-test", effort: "" } });
  await waitFor(() => harness("exists", '.plan-generator-sheet-models[data-value="gpt-test"]'), "chosen model retained");
  await chooseConversationModel("");
  await waitFor(async () => (await harness("calls", "setConversationSettings")).at(-1)?.args[0].runtime.model === "", "Auto is explicitly persisted");
  assert.deepEqual(await harness("consoleErrors"), [], "no Auto runtime renderer errors");

  // Coach settings offers Manage without listing or loading provider connections.
  const allConnected = { ...settings,
    anthropic: { ...settings.anthropic, hasApiKey: true },
    openRouter: { ...settings.openRouter, hasApiKey: true },
    local: { ...settings.local, model: "local-test-model" }
  };
  for (const scenario of [
    { settings: allConnected, auth: account, claude: script.getClaudeCodeStatus },
    { settings: allConnected, auth: { signedIn: false }, claude: { state: "sign-in-required" } },
    { settings, auth: { signedIn: false }, claude: { state: "sign-in-required" } }
  ]) {
    await harness("mount", "ChatSettingsModal", { styles: true }, { ...script,
      getChatSettings: scenario.settings, getChatAuthStatus: scenario.auth,
      getClaudeCodeStatus: scenario.claude,
      getCoachAnalysisPause: null, getCoachAnalysisSpend: null
    });
    await waitFor(() => harness("exists", ".chat-settings-nav-row button"), "provider management button");
    assert.equal(await harness("text", ".chat-settings-nav-row button"), "Manage");
    assert.equal(await harness("exists", ".chat-settings-nav-row .coach-provider-summary"), false);
    assert.equal(await harness("exists", ".chat-settings-nav-row .settings-nav-row-copy"), false);
    assert.equal(await harness("callCount", "getChatSettings"), 0, "connections load only when Manage opens");
    await waitFor(() => harness("appStylesReady"), "Coach settings styles");
    for (const width of [1200, 420]) {
      win.setSize(width, 900);
      for (const theme of ["dark", "paper"]) {
        await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        assert.ok((await harness("overflowX", ".chat-settings-nav-row")) <= 1, `${width}px ${theme}: Manage row fits`);
      }
    }
    assert.doesNotMatch(await harness("text", ".chat-settings-modal-body"), /claude update|Claude Code 2\.1\.0 is available/,
      "Coach settings omit the Claude upgrade reminder");
    assert.deepEqual(await harness("consoleErrors"), [], "no settings renderer errors");
  }
  // Claude's one Refresh action checks the runtime, tests the signed-in
  // connection and updates model lists without overwriting another card's draft.
  const claudeAccount = { state: "connected", installed: true, authenticated: true,
    email: account.email, orgName: "Training team", subscriptionType: "max",
    message: "Ready for coaching." };
  await harness("mount", "ChatSettingsModal", { styles: true }, { ...script,
    getChatAuthStatus: account, getClaudeCodeStatus: claudeAccount,
    getCoachAnalysisPause: null, getCoachAnalysisSpend: null
  });
  await harness("click", ".chat-settings-nav-row .settings-row-button");
  await waitFor(() => harness("exists", ".claude-account-card"), "Claude account card");
  assert.equal(await harness("text", ".claude-account-card .chat-settings-email"), account.email);
  assert.equal(await harness("text", ".claude-account-card .provider-account-plan"), "Claude Max");
  assert.doesNotMatch(await harness("text", ".claude-account-card"), /Test connection|Press Check/);
  assert.equal(await harness("exists", ".claude-account-card details"), false, "connection card has no model or data-access settings");
  assert.equal(await harness("exists", ".claude-account-card .app-select-trigger, .claude-account-card input[type='checkbox']"), false);
  await harness("setValue", ".chat-openrouter-section input[type='password']", "unsaved-key");
  await harness("setScript", { testClaudeCodeConnection: "__pending" });
  await harness("clearCalls");
  await harness("click", ".claude-account-refresh");
  await waitFor(() => harness("callCount", "testClaudeCodeConnection"), "combined connection test");
  assert.equal(await harness("callCount", "getClaudeCodeStatus"), 1);
  assert.notEqual(await harness("attr", ".claude-account-refresh", "disabled"), null);
  assert.notEqual(await harness("attr", ".claude-account-signout", "disabled"), null);
  await harness("click", ".claude-account-refresh");
  assert.equal(await harness("callCount", "testClaudeCodeConnection"), 1, "duplicate refresh is blocked");
  await harness("resolvePending", "testClaudeCodeConnection", { ok: true, status: claudeAccount });
  await waitFor(async () => (await harness("attr", ".claude-account-refresh", "disabled")) === null, "Claude refresh finishes");
  assert.ok((await harness("callCount", "getChatSettings")) > 0, "test rereads model lists");
  assert.equal(await harness("value", ".chat-openrouter-section input[type='password']"), "unsaved-key");

  // Errors remain in Claude's own card and the same action can retry.
  await harness("setScript", { testClaudeCodeConnection: { __reject: "Claude temporarily unavailable" } });
  await harness("click", ".claude-account-refresh");
  await waitFor(() => harness("exists", ".claude-account-card [role='alert']"), "inline Claude error");
  assert.match(await harness("text", ".claude-account-card [role='alert']"), /Claude temporarily unavailable/);
  assert.equal(await harness("exists", ".coach-models-panel > [role='alert']"), false);
  await harness("setScript", { testClaudeCodeConnection: { ok: true, status: claudeAccount } });
  await harness("click", ".claude-account-refresh");
  await waitFor(async () => (await harness("attr", ".claude-account-refresh", "disabled")) === null, "Claude retry finishes");
  assert.equal(await harness("exists", ".claude-account-card [role='alert']"), false);

  // All five connection cards fit both dialog sizes/themes.
  await waitFor(() => harness("appStylesReady"), "provider card styles");
  for (const width of [1200, 420]) {
    win.setSize(width, 900);
    for (const theme of ["dark", "paper"]) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('.provider-account-card, .provider-card-footer, .provider-account-header, .provider-account-footer')).every(card => card.scrollWidth <= card.clientWidth + 1)`),
        true, `${width}px ${theme}: provider cards and actions fit`);
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('.provider-account-card button, .provider-account-card input')).filter(el => el.getClientRects().length).every(el => {
        const card = el.closest('.provider-account-card').getBoundingClientRect();
        const bounds = el.getBoundingClientRect();
        return bounds.left >= card.left && bounds.right <= card.right + 1;
      })`), true, `${width}px ${theme}: controls stay inside their card`);
    }
  }
  win.setSize(1200, 900);

  // Signed-out and missing-runtime refreshes must never send a model request.
  for (const state of ["sign-in-required", "not-installed"]) {
    await harness("setScript", { getClaudeCodeStatus: { state,
      installed: state !== "not-installed", authenticated: false, message: "Connect Claude." } });
    await harness("clearCalls");
    await harness("click", ".claude-account-refresh");
    await waitFor(async () => (await harness("attr", ".claude-account-refresh", "disabled")) === null, `${state} refresh finishes`);
    assert.equal(await harness("callCount", "testClaudeCodeConnection"), 0);
    assert.equal(await harness("exists", ".claude-account-signout"), false);
    assert.equal(await harness("exists", ".chat-claude-path-row"), state === "not-installed");
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.claude-account-card button')).some(button => button.textContent.includes('Sign in'))`),
      state === "sign-in-required");
  }
  assert.deepEqual(await harness("consoleErrors"), [], "no provider renderer errors");

  console.log("coach providers renderer OK — login, logout, retry, manual refresh, return from Settings, responsive themes");
}

main().then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
