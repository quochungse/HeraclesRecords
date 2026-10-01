import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Bot,
  CircleCheck,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  Terminal,
  UserRound
} from "lucide-react";
import { OptionGroup } from "../components/OptionGroup";
import type {
  AnthropicApiConnectionTest,
  ChatAuthStatus,
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  ModelCatalogRefresh,
  OpenRouterConnectionTest
} from "../../electron/types";
import {
  effortForModel,
  effortOptionsFor,
  formatEffortOption,
  formatModelOptionLabel,
  providerModelOptions,
  withCurrentModel,
  type ChatModelOption
} from "../../electron/chatModels";
import { ClaudeCodeLoginCard } from "./ClaudeCodeLoginCard";
import { detectAndAdoptLocalServer } from "./localModelDetection";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";

function claudeStatusLabel(status: ClaudeCodeStatus | null): string {
  if (!status) return "Not checked";
  if (status.state === "not-installed") return "Not installed";
  if (status.state === "sign-in-required") return "Installed, sign-in required";
  if (status.state === "connecting") return "Connecting";
  if (status.state === "connected") return "Connected";
  if (status.state === "usage-limit-reached") return "Usage limit reached";
  return "Connection failed";
}

/** Section order in the panel, which is also the skeleton's row count. */
const COACH_PROVIDER_ORDER: ChatProvider[] = [
  "chatgpt",
  "claude-code",
  "claude-api",
  "openrouter",
  "local"
];

/** "plus" → "Plus", "prolite" stays readable: the claim is a lowercase slug. */
function chatGptPlanLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export const COACH_PROVIDER_LABELS: Record<ChatProvider, string> = {
  chatgpt: "ChatGPT",
  "claude-code": "Claude subscription",
  "claude-api": "Claude API key",
  openrouter: "OpenRouter",
  local: "Local model"
};

export interface CoachModelsSummary {
  /** The provider Coach will actually use. */
  active: ChatProvider;
  activeLabel: string;
  /** Whether that provider is usable right now. */
  activeReady: boolean;
  connected: number;
  total: number;
}

/**
 * Whether each provider is usable, by the rule `summarizeCoachModels` states
 * below. A status not read yet (`null`) counts as not ready.
 */
export function coachProviderReadiness(
  chatSettings: ChatSettings,
  authStatus: ChatAuthStatus | null,
  claudeStatus: ClaudeCodeStatus | null
): Record<ChatProvider, boolean> {
  return {
    chatgpt: authStatus?.signedIn === true,
    "claude-code": claudeStatus?.state === "connected",
    "claude-api": chatSettings.anthropic.hasApiKey === true,
    openrouter: chatSettings.openRouter.hasApiKey === true,
    local: chatSettings.local.model.trim().length > 0
  };
}

/**
 * Which providers are actually usable, for the Connections row that opens this
 * panel. "Connected" means the credential each provider needs is in place — a
 * signed-in account, a stored key, or a chosen local model — not that a request
 * has been made with it.
 */
export function summarizeCoachModels(
  chatSettings: ChatSettings,
  authStatus: ChatAuthStatus | null,
  claudeStatus: ClaudeCodeStatus | null
): CoachModelsSummary {
  const ready = coachProviderReadiness(chatSettings, authStatus, claudeStatus);
  const providers = Object.keys(ready) as ChatProvider[];

  return {
    active: chatSettings.provider,
    activeLabel: COACH_PROVIDER_LABELS[chatSettings.provider],
    activeReady: ready[chatSettings.provider],
    connected: providers.filter((provider) => ready[provider]).length,
    total: providers.length
  };
}

/**
 * The summary as one line, shared by the Connections row in Settings and the
 * row at the top of Coach settings so the two never word it differently.
 */
export function coachModelsSummaryLine(
  summary: CoachModelsSummary | null
): string {
  if (!summary) {
    return "Checking connections…";
  }
  if (summary.connected === 0) {
    return "Nothing connected yet. Add an account or key to start coaching.";
  }

  const active = summary.activeReady
    ? `${summary.activeLabel} in use`
    : `${summary.activeLabel} selected but not connected`;
  return `${active} · ${summary.connected} of ${summary.total} providers connected`;
}

/**
 * Where a provider's model list stands: read from the account and when, or the
 * shipped one. There is no refresh button of its own — `readBy` names the
 * provider's own action that reads it (Check, a key's Save or Test).
 */
export function modelListLine(
  source: { fetchedAt?: string; count: number } | undefined,
  readBy: string,
  now = new Date()
): string {
  if (!source) {
    return `Showing the built-in list. ${readBy} to read the models your account offers.`;
  }
  const models = `${source.count} model${source.count === 1 ? "" : "s"} from your account`;
  // A list kept by a build that did not record when it was read.
  if (!source.fetchedAt) return `${models}.`;
  const at = new Date(source.fetchedAt);
  const sameDay = at.toDateString() === now.toDateString();
  const when = sameDay
    ? `today at ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : `on ${at.toLocaleDateString()}`;
  return `${models}, read ${when}. Read again daily.`;
}

type ModelListProvider = "claude-code" | "claude-api" | "openrouter";

export interface CoachModelsPanelProps {
  api: HeraclesRecordsApi | undefined;
  /** Fired after anything is persisted, so callers can re-read what changed. */
  onChange?: () => void | Promise<void>;
}

/**
 * Every AI-provider connection the coach can run on, in the order they are
 * shown: the ChatGPT account, the Claude subscription, a Claude API key,
 * OpenRouter, and a local model.
 *
 * Self-contained on purpose. It used to be five sections of the Coach settings
 * panel, reading state Coach owned; Coach is lazy-mounted and Settings can be
 * opened without ever visiting it, so the panel reads its own settings and
 * statuses from `api` — the same shape `McpServersPanel` already uses. Coach
 * keeps its own copies for the provider picker and re-reads them when it
 * becomes active again.
 */
export function CoachModelsPanel({ api, onChange }: CoachModelsPanelProps) {
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null);
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [signingIn, setSigningIn] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [testingClaude, setTestingClaude] = useState(false);
  const [revokingClaude, setRevokingClaude] = useState(false);

  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [openRouterConnection, setOpenRouterConnection] =
    useState<OpenRouterConnectionTest | null>(null);
  const [testingOpenRouter, setTestingOpenRouter] = useState(false);

  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicConnection, setAnthropicConnection] =
    useState<AnthropicApiConnectionTest | null>(null);
  const [testingAnthropic, setTestingAnthropic] = useState(false);

  const [claudeLoginError, setClaudeLoginError] = useState<string | null>(null);
  const [claudeExecutableEdited, setClaudeExecutableEdited] = useState(false);

  const [localApiKey, setLocalApiKey] = useState("");
  const [localConnection, setLocalConnection] =
    useState<LocalChatConnectionTest | null>(null);
  const [localDiscovery, setLocalDiscovery] =
    useState<LocalChatDiscovery | null>(null);
  const [testingLocal, setTestingLocal] = useState(false);
  const [detectingLocal, setDetectingLocal] = useState(false);

  // Per provider: a key's Save and Claude's Check can each be reading a list at once.
  const [refreshingModels, setRefreshingModels] = useState<
    Partial<Record<ModelListProvider, boolean>>
  >({});
  const [modelListErrors, setModelListErrors] = useState<
    Partial<Record<ModelListProvider, string>>
  >({});

  // Settings and both account statuses in one pass, so the panel opens with
  // real values rather than filling in field by field.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    void (async () => {
      const [settings, auth, claude] = await Promise.allSettled([
        api.getChatSettings(),
        api.getChatAuthStatus(),
        api.getClaudeCodeStatus()
      ]);
      if (cancelled) return;
      if (settings.status === "fulfilled") setChatSettings(settings.value);
      if (auth.status === "fulfilled") setAuthStatus(auth.value);
      if (claude.status === "fulfilled") setClaudeStatus(claude.value);
      if (settings.status === "rejected") {
        setError("Could not load coach settings.");
        return;
      }
      // Lists a day old are read again; only the lists are taken back, so a
      // field being edited meanwhile keeps what was typed.
      try {
        const refreshed = await api.refreshChatModels();
        // Read before the updater: a throw inside one is a throw in render.
        const modelCatalogs = refreshed?.settings?.modelCatalogs;
        if (cancelled || !modelCatalogs) return;
        setChatSettings((current) => (current ? { ...current, modelCatalogs } : current));
      } catch {
        // The lists already held stay on screen.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const persist = useCallback(
    async (next: ChatSettings): Promise<ChatSettings | null> => {
      if (!api) return null;
      const saved = await api.saveChatSettings(next);
      setChatSettings(saved);
      await onChange?.();
      return saved;
    },
    [api, onChange]
  );

  // A skeleton the shape of the real sections, not a one-line spinner: the
  // dialog is sized by its content, so a short loading state made it open
  // small and jump to full height once the settings arrived.
  if (!api || !chatSettings) {
    return (
      <div className="chat-settings-panel coach-models-panel" aria-busy="true">
        {COACH_PROVIDER_ORDER.map((provider) => (
          <div className="coach-models-skeleton" key={provider}>
            <i className="coach-models-skeleton-title" />
            <i className="coach-models-skeleton-line" />
            <i className="coach-models-skeleton-field" />
          </div>
        ))}
      </div>
    );
  }

  const busy = savingSettings;

  const setRefreshing = (provider: ModelListProvider, refreshing: boolean) =>
    setRefreshingModels((current) => ({ ...current, [provider]: refreshing }));

  /** Only the lists are taken from fresh settings: the panel may hold an unsaved field. */
  const takeModelLists = (settings: ChatSettings) => {
    const { modelCatalogs, claudeCode } = settings;
    setChatSettings((current) =>
      current
        ? {
            ...current,
            modelCatalogs,
            claudeCode: {
              ...current.claudeCode,
              availableModels: claudeCode.availableModels,
              availableModelsAt: claudeCode.availableModelsAt
            }
          }
        : current
    );
  };

  const applyModelRefresh = (provider: ModelListProvider, result: ModelCatalogRefresh) => {
    takeModelLists(result.settings);
    if (result.claudeStatus) setClaudeStatus(result.claudeStatus);
    setModelListErrors((current) => ({ ...current, [provider]: result.errors[provider] }));
  };

  /** Lists the main process read on its own (a sign-in, a connection test). */
  const rereadModelLists = async () => {
    try {
      takeModelLists(await api.getChatSettings());
    } catch {
      // The lists already held stay on screen.
    }
  };

  /**
   * Reads one provider's model list again now, whatever its age — after a
   * key is saved or tested, since there is no button for it alone.
   */
  const refreshModels = async (provider: ModelListProvider) => {
    if (refreshingModels[provider]) return;
    setRefreshing(provider, true);
    try {
      applyModelRefresh(provider, await api.refreshChatModels({ provider, force: true }));
      await onChange?.();
    } catch (caught) {
      setModelListErrors((current) => ({
        ...current,
        [provider]: caught instanceof Error ? caught.message : "Could not read the model list."
      }));
    } finally {
      setRefreshing(provider, false);
    }
  };

  const modelListSource = (provider: ModelListProvider) => {
    if (provider === "claude-code") {
      const listed = chatSettings.claudeCode.availableModels;
      return listed?.length
        ? { fetchedAt: chatSettings.claudeCode.availableModelsAt, count: listed.length }
        : undefined;
    }
    const catalog = chatSettings.modelCatalogs?.[provider];
    return catalog ? { fetchedAt: catalog.fetchedAt, count: catalog.models.length } : undefined;
  };

  const renderModelListStatus = (provider: ModelListProvider, readBy: string) => (
    <p
      className={`chat-model-list-status ${
        modelListErrors[provider] && !refreshingModels[provider]
          ? "chat-local-result is-error"
          : "chat-settings-copy"
      }`}
    >
      {refreshingModels[provider]
        ? "Reading the models your account offers…"
        : (modelListErrors[provider] ?? modelListLine(modelListSource(provider), readBy))}
    </p>
  );

  /** A dropdown's rows for a provider, the chosen model kept even when no longer listed. */
  const pickerRows = (options: ChatModelOption[], model: string) =>
    withCurrentModel(options, model).map((option) => ({
      value: option.value,
      label: formatModelOptionLabel(option)
    }));
  const claudeCodeModels = providerModelOptions("claude-code", chatSettings, claudeStatus);
  const claudeCodeModel = claudeCodeModels.find(
    (option) => option.value === (chatSettings.claudeCode.model ?? "")
  );
  const anthropicModels = providerModelOptions("claude-api", chatSettings);
  const anthropicModel = anthropicModels.find(
    (option) => option.value === chatSettings.anthropic.model
  );
  const openRouterModels =
    chatSettings.modelCatalogs?.openrouter?.models ??
    (openRouterConnection?.models ?? []).map((model) => ({ value: model.id, label: model.name }));

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      setAuthStatus(await api.loginChat());
      await onChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ChatGPT sign-in failed."
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try {
      setAuthStatus(await api.logoutChat());
      await onChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ChatGPT sign-out failed."
      );
    }
  };

  /** Check also reads the account's model list again — it is the section's refresh. */
  const refreshClaudeCodeStatus = async () => {
    if (checkingClaude) return;
    setCheckingClaude(true);
    setRefreshing("claude-code", true);
    setError(null);
    try {
      applyModelRefresh(
        "claude-code",
        await api.refreshChatModels({ provider: "claude-code", force: true })
      );
      await onChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Claude Code detection failed."
      );
    } finally {
      setCheckingClaude(false);
      setRefreshing("claude-code", false);
    }
  };

  const handleClaudeSignedIn = (status: ClaudeCodeStatus) => {
    setClaudeStatus(status);
    // Signing in reads the list on the main side; show it here.
    void rereadModelLists();
    void onChange?.();
  };

  const handleRevokeClaudeCode = async () => {
    if (revokingClaude) return;
    setRevokingClaude(true);
    setError(null);
    try {
      setClaudeStatus(await api.revokeClaudeCodeLogin());
      await onChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not sign Heracles Records out of Claude."
      );
    } finally {
      setRevokingClaude(false);
    }
  };

  const handleTestClaudeCode = async () => {
    if (testingClaude) return;
    setTestingClaude(true);
    setRefreshing("claude-code", true);
    setError(null);
    try {
      // The test reads the model list again on the main side as well.
      const result = await api.testClaudeCodeConnection();
      setClaudeStatus(result.status);
      setModelListErrors((current) => ({ ...current, "claude-code": undefined }));
      if (!result.ok) setError(result.message);
      await rereadModelLists();
      await onChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Claude connection test failed."
      );
    } finally {
      setTestingClaude(false);
      setRefreshing("claude-code", false);
    }
  };

  const updateClaudeCode = (patch: Partial<ChatSettings["claudeCode"]>) => {
    void persist({
      ...chatSettings,
      claudeCode: { ...chatSettings.claudeCode, ...patch }
    });
  };

  const updateOpenRouterDraft = (patch: Partial<ChatSettings["openRouter"]>) => {
    setChatSettings((current) =>
      current
        ? { ...current, openRouter: { ...current.openRouter, ...patch } }
        : current
    );
    setOpenRouterConnection(null);
  };

  const handleSaveOpenRouterSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      const apiKey = openRouterApiKey.trim();
      await persist({
        ...chatSettings,
        openRouter: { ...chatSettings.openRouter, apiKey: apiKey || undefined }
      });
      setOpenRouterApiKey("");
      setOpenRouterConnection((current) => ({
        ok: true,
        message: "OpenRouter settings saved.",
        models: current?.models ?? []
      }));
      if (apiKey) void refreshModels("openrouter");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save OpenRouter settings."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClearOpenRouterApiKey = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      await persist({
        ...chatSettings,
        openRouter: { ...chatSettings.openRouter, clearApiKey: true }
      });
      setOpenRouterApiKey("");
      setOpenRouterConnection({
        ok: true,
        message: "OpenRouter API key cleared.",
        models: []
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not clear the OpenRouter API key."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestOpenRouterConnection = async () => {
    if (testingOpenRouter) return;
    setTestingOpenRouter(true);
    setOpenRouterConnection(null);
    setError(null);
    try {
      const typedKey = openRouterApiKey.trim();
      const result = await api.testOpenRouterConnection({
        ...chatSettings.openRouter,
        apiKey: typedKey || undefined
      });
      setOpenRouterConnection(result);
      if (!result.ok) setError(result.message);
      // The list is read with the saved key; a typed one is read once saved.
      if (result.ok && !typedKey && chatSettings.openRouter.hasApiKey) {
        void refreshModels("openrouter");
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "OpenRouter connection test failed."
      );
    } finally {
      setTestingOpenRouter(false);
    }
  };

  const updateAnthropic = (patch: Partial<ChatSettings["anthropic"]>) => {
    void persist({
      ...chatSettings,
      anthropic: { ...chatSettings.anthropic, ...patch }
    });
  };

  const handleSaveAnthropicSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      const apiKey = anthropicApiKey.trim();
      const saved = await persist({
        ...chatSettings,
        anthropic: { ...chatSettings.anthropic, apiKey: apiKey || undefined }
      });
      setAnthropicApiKey("");
      setAnthropicConnection({
        ok: true,
        message: saved?.anthropic.hasApiKey
          ? "Claude API settings saved."
          : "Settings saved. Add an API key to start coaching."
      });
      if (apiKey && saved?.anthropic.hasApiKey) void refreshModels("claude-api");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save Claude API settings."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClearAnthropicApiKey = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      await persist({
        ...chatSettings,
        anthropic: { ...chatSettings.anthropic, clearApiKey: true }
      });
      setAnthropicApiKey("");
      setAnthropicConnection({ ok: true, message: "Anthropic API key cleared." });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not clear the API key."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestAnthropicConnection = async () => {
    if (testingAnthropic) return;
    setTestingAnthropic(true);
    setAnthropicConnection(null);
    setError(null);
    try {
      // An unsaved key in the field is tested as typed so the athlete can
      // verify it before committing it to storage.
      const typedKey = anthropicApiKey.trim();
      const result = await api.testAnthropicConnection({
        model: chatSettings.anthropic.model,
        effort: chatSettings.anthropic.effort,
        apiKey: typedKey || undefined
      });
      setAnthropicConnection(result);
      // The list is read with the saved key; a typed one is read once saved.
      if (result.ok && !typedKey && chatSettings.anthropic.hasApiKey) {
        void refreshModels("claude-api");
      }
    } catch (caught) {
      setAnthropicConnection({
        ok: false,
        message:
          caught instanceof Error
            ? caught.message
            : "Claude API connection test failed."
      });
    } finally {
      setTestingAnthropic(false);
    }
  };

  const updateLocalDraft = (patch: Partial<ChatSettings["local"]>) => {
    setChatSettings((current) =>
      current ? { ...current, local: { ...current.local, ...patch } } : current
    );
    setLocalConnection(null);
  };

  const handleSaveLocalSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      const apiKey = localApiKey.trim();
      const saved = await persist({
        ...chatSettings,
        local: { ...chatSettings.local, apiKey: apiKey || undefined }
      });
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: "Local model settings saved.",
        normalizedBaseUrl: saved?.local.baseUrl
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Local settings failed."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClearLocalApiKey = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      const saved = await persist({
        ...chatSettings,
        local: { ...chatSettings.local, clearApiKey: true }
      });
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: "Local API key cleared.",
        normalizedBaseUrl: saved?.local.baseUrl
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not clear API key."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDetectLocalServers = async () => {
    if (detectingLocal) return;
    setDetectingLocal(true);
    setLocalConnection(null);
    setError(null);
    try {
      const result = await detectAndAdoptLocalServer(
        api,
        chatSettings,
        localApiKey
      );
      setLocalDiscovery(result.discovery);
      setLocalConnection(result.connection);
      if (result.settings) {
        setChatSettings(result.settings);
        setLocalApiKey("");
        await onChange?.();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Local model detection failed."
      );
    } finally {
      setDetectingLocal(false);
    }
  };

  const handleTestLocalConnection = async () => {
    setTestingLocal(true);
    setLocalConnection(null);
    setError(null);
    try {
      const result = await api.testLocalChatConnection({
        ...chatSettings.local,
        apiKey: localApiKey.trim() || undefined
      });
      setLocalConnection(result);
      if (result.normalizedBaseUrl) {
        setChatSettings((current) =>
          current
            ? {
                ...current,
                local: {
                  ...current.local,
                  baseUrl: result.normalizedBaseUrl ?? current.local.baseUrl
                }
              }
            : current
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Local connection test failed."
      );
    } finally {
      setTestingLocal(false);
    }
  };

  // Asked only when detection finds nothing, or a path is already set: an
  // install the usual places miss is the one case it is for. Once typed in, it
  // stays on screen even when emptied, so clearing it does not make it vanish.
  const showClaudeExecutable =
    claudeStatus?.state === "not-installed" ||
    Boolean(chatSettings.claudeCode.executablePath) ||
    claudeExecutableEdited;
  const availableLocalServers =
    localDiscovery?.servers.filter(
      (server) => server.ok && server.models.length > 0
    ) ?? [];
  const selectedLocalServer =
    availableLocalServers.find(
      (server) => server.baseUrl === chatSettings.local.baseUrl
    ) ?? availableLocalServers[0];
  const discoveredLocalModels = selectedLocalServer?.models ?? [];

  return (
    <div className="chat-settings-panel coach-models-panel">
      {error ? (
        <p className="mcp-servers-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}

      <section className="chat-settings-section">
        <h3>ChatGPT account</h3>
        {authStatus?.signedIn ? (
          <div className="chat-settings-account">
            {/* Which account is signed in (UAT), not only that one is. */}
            <span className="chat-settings-account-who">
              <strong className="chat-settings-email">
                {authStatus.name ?? authStatus.email ?? "Signed in"}
              </strong>
              <small>
                {[
                  authStatus.name && authStatus.email ? authStatus.email : null,
                  authStatus.plan ? `ChatGPT ${chatGptPlanLabel(authStatus.plan)}` : null,
                  "Signed in"
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <button
              type="button"
              className="chat-signout chat-signout-settings"
              onClick={() => void handleSignOut()}
              disabled={busy}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : (
          <div className="chat-settings-account">
            <p className="chat-settings-copy">
              Sign in with your ChatGPT account to use cloud coaching.
            </p>
            <button
              type="button"
              className="primary-button chat-settings-signin"
              onClick={() => void handleSignIn()}
              disabled={signingIn || busy}
            >
              {signingIn ? (
                <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
              ) : null}
              Sign in with ChatGPT
            </button>
          </div>
        )}
      </section>

      <section className="chat-settings-section chat-claude-section">
        <h3>Claude subscription</h3>
        <p className="chat-settings-copy">
          Runs the Claude Code CLI installed on this computer against your Claude
          subscription. Heracles Records signs in with a Claude login of its own,
          so any Claude account you use elsewhere on this computer — including in
          a terminal — is left alone. Sign-in happens in your browser; Heracles
          Records never sees your Claude password.
        </p>

        <div className="chat-claude-status" data-state={claudeStatus?.state}>
          {checkingClaude ? (
            <Loader2 className="chat-spinner" size={15} aria-hidden="true" />
          ) : claudeStatus?.state === "connected" ? (
            <CircleCheck size={15} aria-hidden="true" />
          ) : (
            <Terminal size={15} aria-hidden="true" />
          )}
          <div>
            <strong>{claudeStatusLabel(claudeStatus)}</strong>
            <span>
              {claudeStatus?.message ??
                "Check this computer for an installed Claude Code runtime."}
            </span>
            {claudeStatus?.email ? (
              <span className="chat-claude-account">
                <UserRound size={12} aria-hidden="true" />
                {claudeStatus.email}
                {claudeStatus.orgName ? ` · ${claudeStatus.orgName}` : ""}
                {claudeStatus.subscriptionType
                  ? ` · ${claudeStatus.subscriptionType}`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        {showClaudeExecutable ? (
          <label className="chat-local-field">
            <span>Claude executable</span>
            <div className="chat-claude-path-row">
              <Terminal size={15} aria-hidden="true" />
              <input
                value={chatSettings.claudeCode.executablePath ?? ""}
                onChange={(event) => {
                  setClaudeExecutableEdited(true);
                  updateClaudeCode({ executablePath: event.target.value });
                }}
                placeholder="Auto-detect Claude Code"
                spellCheck={false}
              />
            </div>
          </label>
        ) : null}

        <div className="chat-local-actions chat-claude-actions">
          <button
            type="button"
            className="chat-local-action"
            onClick={() => void refreshClaudeCodeStatus()}
            disabled={checkingClaude || testingClaude || busy}
          >
            {checkingClaude ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            Check
          </button>
          {claudeStatus?.state === "not-installed" ? (
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void api.openClaudeCodeSetupGuide()}
            >
              <ExternalLink size={14} aria-hidden="true" />
              Install Claude Code
            </button>
          ) : null}
          {claudeStatus?.installed && claudeStatus.state !== "connected" ? (
            <ClaudeCodeLoginCard
              api={api}
              disabled={busy}
              onSignedIn={handleClaudeSignedIn}
              onError={(message) => setClaudeLoginError(message)}
            />
          ) : null}
          {claudeStatus?.state === "connected" ? (
            <button
              type="button"
              className="chat-local-action primary"
              onClick={() => void handleTestClaudeCode()}
              disabled={testingClaude || busy}
            >
              {testingClaude ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Bot size={14} aria-hidden="true" />
              )}
              Test connection
            </button>
          ) : null}
          {claudeStatus?.authenticated ? (
            <button
              type="button"
              className="chat-local-action is-danger"
              onClick={() => {
                if (
                  window.confirm(
                    "Sign Heracles Records out of Claude? Your Claude login elsewhere on this computer is not affected."
                  )
                ) {
                  void handleRevokeClaudeCode();
                }
              }}
              disabled={revokingClaude || busy}
            >
              {revokingClaude ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <LogOut size={14} aria-hidden="true" />
              )}
              Sign out
            </button>
          ) : null}
          <button
            type="button"
            className="chat-local-action"
            onClick={() => void api.openClaudeCodeSetupGuide()}
          >
            <ExternalLink size={14} aria-hidden="true" />
            Setup guide
          </button>
        </div>

        {claudeLoginError ? (
          <p className="chat-local-result is-error">{claudeLoginError}</p>
        ) : null}

        <strong className="chat-claude-group-title">Model</strong>
        <div className="chat-claude-model-row">
          <label className="chat-local-field">
            <span>Claude model</span>
            <OptionGroup
              label="Claude model"
              mode="dropdown"
              size="md"
              value={chatSettings.claudeCode.model ?? ""}
              options={pickerRows(claudeCodeModels, chatSettings.claudeCode.model ?? "")}
              onChange={(model) => updateClaudeCode({ model })}
            />
          </label>

          <label className="chat-local-field">
            <span>Reasoning effort</span>
            <OptionGroup
              label="Reasoning effort"
              mode="dropdown"
              size="md"
              value={
                effortForModel(chatSettings.claudeCode.effort, claudeCodeModel?.efforts) ??
                chatSettings.claudeCode.effort
              }
              options={effortOptionsFor(claudeCodeModel).map((option) => ({
                value: option.value,
                label: formatEffortOption(option)
              }))}
              onChange={(effort) => updateClaudeCode({ effort })}
            />
          </label>
        </div>
        {renderModelListStatus(
          "claude-code",
          claudeStatus?.authenticated ? "Press Check" : "Sign in"
        )}
        <p className="chat-settings-copy">
          Higher effort means deeper reasoning per answer and more of your
          subscription usage. Claude quietly drops to the highest level your
          selected model supports.
        </p>

        <div className="chat-claude-permissions">
          <strong>Claude can access</strong>
          {(
            [
              ["recentActivities", "Recent activities"],
              ["trainingMetrics", "Training metrics"],
              ["upcomingWorkouts", "Upcoming workouts"],
              ["sleepData", "Sleep data"]
            ] as const
          ).map(([permission, label]) => (
            <label key={permission} className="chat-local-tools">
              <input
                type="checkbox"
                checked={chatSettings.claudeCode.permissions[permission]}
                onChange={(event) =>
                  updateClaudeCode({
                    permissions: {
                      ...chatSettings.claudeCode.permissions,
                      [permission]: event.target.checked
                    }
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="chat-settings-copy">
          These selections control built-in COROS and Training Hub data.
          Connected custom MCP servers are trusted separately and can expose
          their tools to Claude — add and remove them in Settings, under
          Connections. Drafts stay local until you click an upload or delete
          button.
        </p>
      </section>

      <section className="chat-settings-section chat-claude-section">
        <h3>Claude API key</h3>
        <p className="chat-settings-copy">
          Talks to the Anthropic API directly with your own key, billed per
          token to your Anthropic account. Nothing needs to be installed, and
          the key is stored encrypted on this computer only.
        </p>

        <div className="chat-local-settings chat-local-settings-panel">
          <label className="chat-local-field chat-local-field-key">
            <span>API key</span>
            <div className="chat-local-key-row">
              <KeyRound size={14} aria-hidden="true" />
              <input
                value={anthropicApiKey}
                onChange={(event) =>
                  setAnthropicApiKey(event.target.value)
                }
                placeholder={
                  chatSettings.anthropic.hasApiKey ? "Saved key" : "sk-ant-…"
                }
                type="password"
                spellCheck={false}
              />
              {chatSettings.anthropic.hasApiKey ? (
                <button
                  type="button"
                  onClick={() => void handleClearAnthropicApiKey()}
                  disabled={savingSettings}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </label>

          <label className="chat-local-field">
            <span>Model</span>
            <OptionGroup
              label="Model"
              mode="dropdown"
              size="md"
              value={chatSettings.anthropic.model}
              options={pickerRows(anthropicModels, chatSettings.anthropic.model)}
              onChange={(model) => updateAnthropic({ model })}
            />
          </label>

          <label className="chat-local-field">
            <span>Reasoning effort</span>
            <OptionGroup
              label="Reasoning effort"
              mode="dropdown"
              size="md"
              value={
                effortForModel(chatSettings.anthropic.effort, anthropicModel?.efforts) ??
                chatSettings.anthropic.effort
              }
              options={effortOptionsFor(anthropicModel).map((option) => ({
                value: option.value,
                label: formatEffortOption(option)
              }))}
              onChange={(effort) => updateAnthropic({ effort })}
            />
          </label>
          <p className="chat-settings-copy">
            {anthropicModel?.efforts?.length === 0
              ? `${anthropicModel.label} takes no effort setting; it answers the same at every level.`
              : "Higher effort spends more tokens on reasoning before answering. Lower effort is cheaper and faster for routine questions. A level the model does not offer is sent as the nearest one below it."}
          </p>
          {renderModelListStatus("claude-api", "Save or test your key")}

          <div className="chat-local-actions">
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void api.openAnthropicKeyGuide()}
            >
              <ExternalLink size={14} aria-hidden="true" />
              Get a key
            </button>
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void handleTestAnthropicConnection()}
              disabled={testingAnthropic || busy}
            >
              {testingAnthropic ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Bot size={14} aria-hidden="true" />
              )}
              Test
            </button>
            <button
              type="button"
              className="chat-local-action primary"
              onClick={() => void handleSaveAnthropicSettings()}
              disabled={savingSettings || busy}
            >
              {savingSettings ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              Save
            </button>
          </div>
          {anthropicConnection ? (
            <p
              className={
                anthropicConnection.ok
                  ? "chat-local-result is-ready"
                  : "chat-local-result is-error"
              }
            >
              {anthropicConnection.message}
            </p>
          ) : null}
        </div>
      </section>

      <section className="chat-settings-section chat-openrouter-section">
        <div className="chat-settings-section-title">
          <h3>OpenRouter API</h3>
          <span className="chat-beta-badge">BYOK</span>
        </div>
        <p className="chat-settings-copy">
          Use your OpenRouter account and credits for coaching. Heracles Records stores
          the key encrypted on this computer and only sends it to OpenRouter.
        </p>

        <div className="chat-local-settings chat-local-settings-panel">
          <label className="chat-local-field">
            <span>Model</span>
            <input
              value={chatSettings.openRouter.model}
              onChange={(event) =>
                updateOpenRouterDraft({ model: event.target.value })
              }
              list="chat-openrouter-models"
              placeholder="openrouter/auto"
              spellCheck={false}
            />
            <datalist id="chat-openrouter-models">
              {openRouterModels.map((model) => (
                <option key={model.value} value={model.value} label={model.label} />
              ))}
            </datalist>
          </label>
          <div className="chat-local-field chat-local-field-key">
            <label htmlFor="chat-openrouter-api-key">
              <span>API key</span>
            </label>
            <div className="chat-local-key-row">
              <KeyRound size={14} aria-hidden="true" />
              <input
                id="chat-openrouter-api-key"
                value={openRouterApiKey}
                onChange={(event) =>
                  setOpenRouterApiKey(event.target.value)
                }
                placeholder={
                  chatSettings.openRouter.hasApiKey
                    ? "Saved key"
                    : "sk-or-v1-…"
                }
                type="password"
                spellCheck={false}
                autoComplete="off"
              />
              {chatSettings.openRouter.hasApiKey ? (
                <button
                  type="button"
                  onClick={() => void handleClearOpenRouterApiKey()}
                  disabled={savingSettings}
                >
                  Clear
                </button>
                ) : null}
            </div>
          </div>
          <div className="chat-local-actions chat-openrouter-actions">
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void api.openOpenRouterKeys()}
              disabled={!api}
            >
              <ExternalLink size={14} aria-hidden="true" />
              Get API key
            </button>
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void api.openOpenRouterModels()}
              disabled={!api}
            >
              <ExternalLink size={14} aria-hidden="true" />
              Browse models
            </button>
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void handleTestOpenRouterConnection()}
              disabled={
                testingOpenRouter ||
                busy ||
                (!openRouterApiKey.trim() &&
                  !chatSettings.openRouter.hasApiKey)
              }
            >
              {testingOpenRouter ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Bot size={14} aria-hidden="true" />
              )}
              Test
            </button>
            <button
              type="button"
              className="chat-local-action primary"
              onClick={() => void handleSaveOpenRouterSettings()}
              disabled={
                savingSettings ||
                busy ||
                !chatSettings.openRouter.model.trim() ||
                (!openRouterApiKey.trim() &&
                  !chatSettings.openRouter.hasApiKey)
              }
            >
              {savingSettings ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              Save
            </button>
          </div>
          {openRouterConnection ? (
            <p
              className={
                openRouterConnection.ok
                  ? "chat-local-result is-ready"
                  : "chat-local-result is-error"
              }
            >
              {openRouterConnection.message}
            </p>
          ) : null}
          {renderModelListStatus("openrouter", "Save or test your key")}
        </div>
        <p className="chat-settings-copy">
          Coaching prompts and requested COROS data are sent through OpenRouter
          to the selected model provider. OpenRouter bills usage to your account.
          Choose a model with tool calling so workout and activity tools work.
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>Local model</h3>
        <div className="chat-local-settings chat-local-settings-panel">
            <label className="chat-local-field">
              <span>Server</span>
              {availableLocalServers.length > 0 ? (
                <OptionGroup
                  label="Local server"
                  mode="dropdown"
                  size="md"
                  value={
                    selectedLocalServer?.baseUrl ?? chatSettings.local.baseUrl
                  }
                  options={availableLocalServers.map((server) => ({
                    value: server.baseUrl,
                    label: `${server.label} · ${server.models.length} model${
                      server.models.length === 1 ? "" : "s"
                    }`
                  }))}
                  onChange={(baseUrl) => {
                    const server = availableLocalServers.find(
                      (entry) => entry.baseUrl === baseUrl
                    );
                    if (!server) return;
                    updateLocalDraft({
                      baseUrl: server.baseUrl,
                      model: server.models.includes(chatSettings.local.model)
                        ? chatSettings.local.model
                        : server.models[0] ?? ""
                    });
                  }}
                />
              ) : (
                <input
                  value={chatSettings.local.baseUrl}
                  onChange={(event) =>
                    updateLocalDraft({ baseUrl: event.target.value })
                  }
                  placeholder="http://localhost:11434/v1"
                  spellCheck={false}
                />
              )}
            </label>
            <label className="chat-local-field">
              <span>Model</span>
              {discoveredLocalModels.length > 0 ? (
                <OptionGroup
                  label="Local model"
                  mode="dropdown"
                  size="md"
                  value={
                    discoveredLocalModels.includes(chatSettings.local.model)
                      ? chatSettings.local.model
                      : discoveredLocalModels[0] ?? ""
                  }
                  options={discoveredLocalModels.map((model) => ({
                    value: model,
                    label: model
                  }))}
                  onChange={(model) => updateLocalDraft({ model })}
                />
              ) : (
                <input
                  value={chatSettings.local.model}
                  onChange={(event) =>
                    updateLocalDraft({ model: event.target.value })
                  }
                  placeholder="Detect models or enter a model id"
                  spellCheck={false}
                />
              )}
            </label>
            <label className="chat-local-field chat-local-field-key">
              <span>API key</span>
              <div className="chat-local-key-row">
                <KeyRound size={14} aria-hidden="true" />
                <input
                  value={localApiKey}
                  onChange={(event) => setLocalApiKey(event.target.value)}
                  placeholder={
                    chatSettings.local.hasApiKey ? "Saved key" : "Optional"
                  }
                  type="password"
                  spellCheck={false}
                />
                {chatSettings.local.hasApiKey ? (
                  <button
                    type="button"
                    onClick={() => void handleClearLocalApiKey()}
                    disabled={savingSettings}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </label>
            <label className="chat-local-tools">
              <input
                type="checkbox"
                checked={chatSettings.local.toolsEnabled}
                onChange={(event) =>
                  updateLocalDraft({ toolsEnabled: event.target.checked })
                }
              />
              <span>Use COROS tools when supported</span>
            </label>
            <div className="chat-local-actions">
              <button
                type="button"
                className="chat-local-action"
                onClick={() => void handleDetectLocalServers()}
                disabled={detectingLocal || busy}
              >
                {detectingLocal ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <RefreshCw size={14} aria-hidden="true" />
                )}
                Detect
              </button>
              <button
                type="button"
                className="chat-local-action"
                onClick={() => void handleTestLocalConnection()}
                disabled={testingLocal || busy}
              >
                {testingLocal ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <Bot size={14} aria-hidden="true" />
                )}
                Test
              </button>
              <button
                type="button"
                className="chat-local-action primary"
                onClick={() => void handleSaveLocalSettings()}
                disabled={savingSettings || busy}
              >
                {savingSettings ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <Save size={14} aria-hidden="true" />
                )}
                Save
              </button>
            </div>
            {localConnection ? (
              <p
                className={
                  localConnection.ok
                    ? "chat-local-result is-ready"
                    : "chat-local-result is-error"
                }
              >
                {localConnection.message}
              </p>
            ) : null}
        </div>
      </section>
    </div>
  );
}
