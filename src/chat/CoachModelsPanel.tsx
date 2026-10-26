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
  Sparkles,
  Terminal,
  UserRound
} from "lucide-react";
import { OptionGroup } from "../components/OptionGroup";
import type {
  AnthropicApiConnectionTest,
  ChatAuthStatus,
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
import { ProviderIcon } from "./ProviderIcon";
import { ClaudeCodeLoginCard } from "./ClaudeCodeLoginCard";
import { detectAndAdoptLocalServer } from "./localModelDetection";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { getIntlLocale, plural, t } from "../i18n/core";
import { CoachModelsSkeleton } from "./CoachModelsSkeleton";

function claudeStatusLabel(status: ClaudeCodeStatus | null): string {
  if (!status) return t("chat.models.status.notChecked");
  if (status.state === "not-installed") return t("chat.models.status.notInstalled");
  if (status.state === "sign-in-required") return t("chat.models.status.signIn");
  if (status.state === "connecting") return t("chat.models.status.connecting");
  if (status.state === "connected") return t("chat.models.status.connected");
  if (status.state === "usage-limit-reached") return t("chat.models.status.limit");
  return t("chat.models.status.failed");
}

/** "plus" → "Plus", "prolite" stays readable: the claim is a lowercase slug. */
function chatGptPlanLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * Where a provider's model list stands: read from the account and when, or the
 * shipped one. There is no refresh button of its own — `readBy` names the
 * provider's own action that reads it (Refresh, a key's Save or Test).
 */
export function modelListLine(
  source: { fetchedAt?: string; count: number } | undefined,
  readBy: string,
  now = new Date()
): string {
  if (!source) {
    return t("chat.models.list.builtIn", { action: readBy });
  }
  const models = plural("chat.models.list.count", source.count);
  // A list kept by a build that did not record when it was read.
  if (!source.fetchedAt) return t("chat.models.list.plain", { models });
  const at = new Date(source.fetchedAt);
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay
    ? t("chat.models.list.readToday", {
        models,
        time: at.toLocaleTimeString(getIntlLocale(), { hour: "2-digit", minute: "2-digit" })
      })
    : t("chat.models.list.readOn", { models, date: at.toLocaleDateString(getIntlLocale()) });
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
  const [signingOut, setSigningOut] = useState(false);
  const [refreshingChatGpt, setRefreshingChatGpt] = useState(false);
  const [chatGptError, setChatGptError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [checkingClaude, setCheckingClaude] = useState(false);
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

  // Per provider: a key's Save and Claude's Refresh can each be reading a list at once.
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
        setError(t("chat.models.err.load"));
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
        await onChange?.();
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
      error ? (
        <div className="chat-settings-panel coach-models-panel" aria-busy="false">
          <p className="mcp-servers-error" role="alert">{error}</p>
        </div>
      ) : <CoachModelsSkeleton />
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
        [provider]: caught instanceof Error ? caught.message : t("chat.models.err.list")
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
        ? t("chat.models.reading")
        : (modelListErrors[provider] ?? modelListLine(modelListSource(provider), readBy))}
    </p>
  );

  /** A dropdown's rows for a provider, the chosen model kept even when no longer listed. */
  const pickerRows = (options: ChatModelOption[], model: string) =>
    withCurrentModel(options, model).map((option) => ({
      value: option.value,
      label: formatModelOptionLabel(option)
    }));
  const anthropicModels = providerModelOptions("claude-api", chatSettings);
  const anthropicModel = anthropicModels.find(
    (option) => option.value === chatSettings.anthropic.model
  );
  const openRouterModels =
    chatSettings.modelCatalogs?.openrouter?.models ??
    (openRouterConnection?.models ?? []).map((model) => ({ value: model.id, label: model.name }));

  const handleSignIn = async () => {
    if (signingIn || signingOut || refreshingChatGpt) return;
    setSigningIn(true);
    setChatGptError(null);
    try {
      setAuthStatus(await api.loginChat());
      await onChange?.();
    } catch (caught) {
      setChatGptError(
        caught instanceof Error ? caught.message : t("chat.err.chatgptSignIn")
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (signingIn || signingOut || refreshingChatGpt) return;
    setSigningOut(true);
    setChatGptError(null);
    try {
      setAuthStatus(await api.logoutChat());
      await onChange?.();
    } catch (caught) {
      setChatGptError(
        caught instanceof Error ? caught.message : t("chat.models.err.chatgptSignOut")
      );
    } finally {
      setSigningOut(false);
    }
  };

  const refreshChatGptAccount = async () => {
    if (refreshingChatGpt || signingIn || signingOut || busy) return;
    setRefreshingChatGpt(true);
    setChatGptError(null);
    try {
      const status = await api.getChatAuthStatus();
      setAuthStatus(status);
      try {
        if (status.signedIn) {
          const result = await api.refreshChatModels({ provider: "chatgpt", force: true });
          takeModelLists(result.settings);
          setChatGptError(result.errors.chatgpt ?? null);
        }
      } finally {
        // Reading models can renew or invalidate the saved credentials. Keep
        // the account and conversation picker current even if that read fails.
        setAuthStatus(await api.getChatAuthStatus());
        await onChange?.();
      }
    } catch (caught) {
      setChatGptError(caught instanceof Error ? caught.message : t("chat.models.err.list"));
    } finally {
      setRefreshingChatGpt(false);
    }
  };

  /** One refresh discovers the runtime, verifies sign-in and tests an authenticated account. */
  const refreshClaudeCodeStatus = async () => {
    if (checkingClaude || revokingClaude) return;
    setCheckingClaude(true);
    setRefreshing("claude-code", true);
    setClaudeLoginError(null);
    try {
      const status = await api.getClaudeCodeStatus();
      setClaudeStatus(status);
      if (status.authenticated) {
        // The connection test also refreshes the account's model list.
        const result = await api.testClaudeCodeConnection();
        setClaudeStatus(result.status);
        if (!result.ok) setClaudeLoginError(result.message);
        await rereadModelLists();
      }
      setModelListErrors((current) => ({ ...current, "claude-code": undefined }));
      await onChange?.();
    } catch (caught) {
      setClaudeLoginError(
        caught instanceof Error ? caught.message : t("chat.models.err.claudeTest")
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
    setClaudeLoginError(null);
    try {
      setClaudeStatus(await api.revokeClaudeCodeLogin());
      await onChange?.();
    } catch (caught) {
      setClaudeLoginError(
        caught instanceof Error
          ? caught.message
          : t("chat.models.err.claudeSignOut")
      );
    } finally {
      setRevokingClaude(false);
    }
  };

  const updateClaudeCode = (patch: Partial<ChatSettings["claudeCode"]>) => {
    void persist({
      ...chatSettings,
      claudeCode: { ...chatSettings.claudeCode, ...patch }
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : t("chat.err.settings"));
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
        message: t("chat.models.openrouterSaved"),
        models: current?.models ?? []
      }));
      if (apiKey) void refreshModels("openrouter");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("chat.models.err.openrouterSave")
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
        message: t("chat.models.openrouterCleared"),
        models: []
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("chat.models.err.openrouterClear")
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
          : t("chat.models.err.openrouterTest")
      );
    } finally {
      setTestingOpenRouter(false);
    }
  };

  const updateAnthropic = (patch: Partial<ChatSettings["anthropic"]>) => {
    void persist({
      ...chatSettings,
      anthropic: { ...chatSettings.anthropic, ...patch }
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : t("chat.err.settings"));
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
          ? t("chat.models.anthropicSaved")
          : t("chat.models.savedNoKey")
      });
      if (apiKey && saved?.anthropic.hasApiKey) void refreshModels("claude-api");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("chat.models.err.anthropicSave")
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
      setAnthropicConnection({ ok: true, message: t("chat.models.anthropicCleared") });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("chat.models.err.clearKey")
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
            : t("chat.models.err.anthropicTest")
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
        message: t("chat.models.localSaved"),
        normalizedBaseUrl: saved?.local.baseUrl
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("chat.models.err.localSave")
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
        message: t("chat.models.localCleared"),
        normalizedBaseUrl: saved?.local.baseUrl
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("chat.models.err.clearKey")
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
          : t("chat.models.err.localDetect")
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
        caught instanceof Error ? caught.message : t("chat.models.err.localTest")
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

      <section className="chat-settings-section chatgpt-account-card provider-account-card" aria-busy={signingIn || signingOut || refreshingChatGpt}>
        <header className="chatgpt-account-header provider-account-header">
          <div className="chatgpt-account-brand provider-account-brand">
            <Sparkles size={16} aria-hidden="true" />
            <h3>{t("chat.models.chatgptAccount")}</h3>
          </div>
          <div className="chatgpt-account-actions provider-account-actions">
            <span className={`chatgpt-account-status provider-account-status${authStatus?.signedIn ? " is-connected" : ""}`} role="status">
              {authStatus?.signedIn ? <CircleCheck size={13} aria-hidden="true" /> : null}
              {authStatus?.signedIn ? t("chat.models.status.connected") : t("library.ai.notSetUp")}
            </span>
            <button
              type="button"
              className="chat-local-action chatgpt-account-refresh"
              onClick={() => void refreshChatGptAccount()}
              disabled={signingIn || signingOut || refreshingChatGpt || busy}
            >
              <RefreshCw size={13} className={refreshingChatGpt ? "chat-spinner" : undefined} aria-hidden="true" />
              {t("common.refresh")}
            </button>
          </div>
        </header>
        {authStatus?.signedIn ? (
          <>
            <div className="chatgpt-account-identity provider-account-identity">
              <span className="chatgpt-account-avatar provider-account-avatar" aria-hidden="true"><UserRound size={22} /></span>
              <div className="chat-settings-account-who">
                <strong className="chat-settings-email">
                  {authStatus.name || authStatus.email || t("chat.models.signedIn")}
                </strong>
                {authStatus.name && authStatus.email ? <small>{authStatus.email}</small> : null}
              </div>
              {authStatus.plan ? <span className="chatgpt-account-plan provider-account-plan">ChatGPT {chatGptPlanLabel(authStatus.plan)}</span> : null}
            </div>
            <footer className="chatgpt-account-footer provider-account-footer">
              <p className="chat-settings-copy">{t("chat.models.chatgptReady")}</p>
              <button
                type="button"
                className="chat-local-action chatgpt-account-signout provider-account-signout"
                onClick={() => void handleSignOut()}
                disabled={signingIn || signingOut || refreshingChatGpt || busy}
              >
                {signingOut ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <LogOut size={14} aria-hidden="true" />}
                {t("chat.signOut")}
              </button>
            </footer>
          </>
        ) : (
          <>
            <p className="chat-settings-copy">
              {t("chat.models.chatgptHint")}
            </p>
            <footer className="chatgpt-account-footer provider-account-footer">
              <p className="chat-settings-copy" role="status">{t(signingIn ? "chat.models.chatgptWaiting" : "chat.models.chatgptSignInHint")}</p>
              <button
                type="button"
                className="primary-button chat-settings-signin"
                onClick={() => void handleSignIn()}
                disabled={signingIn || signingOut || refreshingChatGpt || busy}
              >
                {signingIn ? <Loader2 className="chat-spinner" size={15} aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}
                {t("chat.gate.chatgpt.signIn")}
              </button>
            </footer>
          </>
        )}
        {chatGptError ? <p className="mcp-servers-error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{chatGptError}</span></p> : null}
      </section>

      <section className="chat-settings-section chat-claude-section claude-account-card provider-account-card" aria-busy={checkingClaude || revokingClaude}>
        <header className="provider-account-header">
          <div className="provider-account-brand">
            <ProviderIcon provider="claude-code" />
            <h3>{t("chat.provider.claude-code")}</h3>
          </div>
          <div className="provider-account-actions">
            <span className={`provider-account-status${claudeStatus?.state === "connected" ? " is-connected" : ""}`} data-state={claudeStatus?.state} role="status">
              {claudeStatus?.state === "connected" ? <CircleCheck size={13} aria-hidden="true" /> : null}
              {claudeStatusLabel(claudeStatus)}
            </span>
            <button
              type="button"
              className="chat-local-action claude-account-refresh"
              onClick={() => void refreshClaudeCodeStatus()}
              disabled={checkingClaude || revokingClaude || busy}
            >
              <RefreshCw size={13} className={checkingClaude ? "chat-spinner" : undefined} aria-hidden="true" />
              {t("common.refresh")}
            </button>
          </div>
        </header>
        {claudeStatus?.authenticated ? (
          <div className="provider-account-identity">
            <span className="provider-account-avatar" aria-hidden="true"><UserRound size={22} /></span>
            <div className="chat-settings-account-who">
              <strong className="chat-settings-email">{claudeStatus.email || t("chat.models.signedIn")}</strong>
              {claudeStatus.orgName ? <small>{claudeStatus.orgName}</small> : null}
            </div>
            {claudeStatus.subscriptionType ? <span className="provider-account-plan">Claude {chatGptPlanLabel(claudeStatus.subscriptionType)}</span> : null}
          </div>
        ) : (
          <p className="chat-settings-copy">{t("chat.models.claudeHint")}</p>
        )}
        {claudeStatus && claudeStatus.state !== "connected" && !claudeLoginError ? (
          <p className="chat-settings-copy" role="status">{claudeStatus.message}</p>
        ) : null}

        {showClaudeExecutable ? (
          <label className="chat-local-field">
            <span>{t("chat.models.executable")}</span>
            <div className="chat-claude-path-row">
              <Terminal size={15} aria-hidden="true" />
              <input
                value={chatSettings.claudeCode.executablePath ?? ""}
                onChange={(event) => {
                  setClaudeExecutableEdited(true);
                  updateClaudeCode({ executablePath: event.target.value });
                }}
                placeholder={t("chat.models.autoDetect")}
                spellCheck={false}
              />
            </div>
          </label>
        ) : null}

        <footer className="provider-account-footer">
          <p className="chat-settings-copy">{t("chat.models.claudeAccountNote")}</p>
          <div className="chat-local-actions chat-claude-actions">
            {claudeStatus?.state === "not-installed" ? (
              <button
                type="button"
                className="chat-local-action"
                onClick={() => void api.openClaudeCodeSetupGuide()}
              >
                <ExternalLink size={14} aria-hidden="true" />
                {t("chat.gate.claude.install")}
              </button>
            ) : null}
            {claudeStatus?.installed && !claudeStatus.authenticated ? (
              <ClaudeCodeLoginCard
                api={api}
                disabled={checkingClaude || revokingClaude || busy}
                onSignedIn={handleClaudeSignedIn}
                onError={(message) => setClaudeLoginError(message)}
              />
            ) : null}
            {claudeStatus?.authenticated ? (
              <button
                type="button"
                className="chat-local-action claude-account-signout provider-account-signout"
                onClick={() => {
                  if (
                    window.confirm(
                      t("chat.models.signOutConfirm")
                    )
                  ) {
                    void handleRevokeClaudeCode();
                  }
                }}
                disabled={revokingClaude || checkingClaude || busy}
              >
                {revokingClaude ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <LogOut size={14} aria-hidden="true" />
                )}
                {t("chat.signOut")}
              </button>
            ) : null}
          </div>
        </footer>

        {claudeLoginError ? (
          <p className="mcp-servers-error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{claudeLoginError}</span></p>
        ) : null}

      </section>

      <section className="chat-settings-section chat-claude-section provider-account-card provider-api-card">
        <header className="provider-account-header">
          <div className="provider-account-brand"><ProviderIcon provider="claude-api" /><h3>{t("chat.provider.claude-api")}</h3></div>
          <span className="provider-account-status">{t(chatSettings.anthropic.hasApiKey ? "chat.models.savedKey" : "library.ai.notSetUp")}</span>
        </header>
        <p className="chat-settings-copy">
          {t("chat.models.anthropicNote")}
        </p>

        <div className="chat-local-settings chat-local-settings-panel">
          <label className="chat-local-field chat-local-field-key">
            <span>{t("chat.models.apiKey")}</span>
            <div className="chat-local-key-row">
              <KeyRound size={14} aria-hidden="true" />
              <input
                value={anthropicApiKey}
                onChange={(event) =>
                  setAnthropicApiKey(event.target.value)
                }
                placeholder={
                  chatSettings.anthropic.hasApiKey ? t("chat.models.savedKey") : "sk-ant-…"
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
                  {t("chat.models.clear")}
                </button>
              ) : null}
            </div>
          </label>

          <label className="chat-local-field">
            <span>{t("chat.models.model")}</span>
            <OptionGroup
              label={t("chat.models.model")}
              mode="dropdown"
              size="md"
              value={chatSettings.anthropic.model}
              options={pickerRows(anthropicModels, chatSettings.anthropic.model)}
              onChange={(model) => updateAnthropic({ model })}
            />
          </label>

          <label className="chat-local-field">
            <span>{t("chat.models.effort")}</span>
            <OptionGroup
              label={t("chat.models.effort")}
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
              ? t("chat.models.noEffort", { model: anthropicModel.label })
              : t("chat.models.effortNote")}
          </p>
          {renderModelListStatus("claude-api", t("chat.models.saveOrTest"))}

          <div className="chat-local-actions provider-card-footer">
            <div className="provider-card-links">
              <button
                type="button"
                className="chat-inline-link provider-card-help"
                onClick={() => void api.openAnthropicKeyGuide()}
              >
                <ExternalLink size={14} aria-hidden="true" />
                {t("chat.gate.getKey")}
              </button>
            </div>
            <div className="provider-card-controls">
              <button
                type="button"
                className="chat-local-action"
                onClick={() => void handleTestAnthropicConnection()}
                disabled={testingAnthropic || busy || (!anthropicApiKey.trim() && !chatSettings.anthropic.hasApiKey)}
              >
                {testingAnthropic ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <Bot size={14} aria-hidden="true" />
                )}
                {t("chat.models.test")}
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
                {t("chat.set.save")}
              </button>
            </div>
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

      <section className="chat-settings-section chat-openrouter-section provider-account-card provider-api-card">
        <header className="provider-account-header">
          <div className="provider-account-brand"><ProviderIcon provider="openrouter" /><h3>{t("chat.models.openrouterApi")}</h3></div>
          <span className="provider-account-status">{t(chatSettings.openRouter.hasApiKey ? "chat.models.savedKey" : "library.ai.notSetUp")}</span>
        </header>
        <p className="chat-settings-copy">
          {t("chat.models.openrouterNote")}
        </p>

        <div className="chat-local-settings chat-local-settings-panel">
          <div className="chat-local-field chat-local-field-key">
            <label htmlFor="chat-openrouter-api-key">
              <span>{t("chat.models.apiKey")}</span>
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
                    ? t("chat.models.savedKey")
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
                  {t("chat.models.clear")}
                </button>
                ) : null}
            </div>
          </div>
          <label className="chat-local-field">
            <span>{t("chat.models.model")}</span>
            <input
              value={chatSettings.openRouter.model}
              onChange={(event) =>
                updateOpenRouterDraft({ model: event.target.value })
              }
              list="chat-openrouter-models"
              placeholder="openrouter/auto" // i18n-ignore: a model id
              spellCheck={false}
            />
            <datalist id="chat-openrouter-models">
              {openRouterModels.map((model) => (
                <option key={model.value} value={model.value} label={model.label} />
              ))}
            </datalist>
          </label>
          <div className="chat-local-actions chat-openrouter-actions provider-card-footer">
            <div className="provider-card-links">
              <button
                type="button"
                className="chat-inline-link provider-card-help"
                onClick={() => void api.openOpenRouterKeys()}
                disabled={!api}
              >
                <ExternalLink size={14} aria-hidden="true" />
                {t("chat.models.getApiKey")}
              </button>
              <button
                type="button"
                className="chat-inline-link provider-card-help"
                onClick={() => void api.openOpenRouterModels()}
                disabled={!api}
              >
                <ExternalLink size={14} aria-hidden="true" />
                {t("chat.models.browse")}
              </button>
            </div>
            <div className="provider-card-controls">
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
                {t("chat.models.test")}
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
                {t("chat.set.save")}
              </button>
            </div>
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
          {renderModelListStatus("openrouter", t("chat.models.saveOrTest"))}
        </div>
        <p className="chat-settings-copy">
          {t("chat.models.openrouterPrivacy")}
        </p>
      </section>

      <section className="chat-settings-section provider-account-card provider-local-card">
        <header className="provider-account-header">
          <div className="provider-account-brand"><ProviderIcon provider="local" /><h3>{t("chat.provider.local")}</h3></div>
          <button type="button" className="chat-local-action" onClick={() => void handleDetectLocalServers()} disabled={detectingLocal || busy}>
            <RefreshCw size={13} className={detectingLocal ? "chat-spinner" : undefined} aria-hidden="true" />
            {t("chat.models.detect")}
          </button>
        </header>
        <p className="chat-settings-copy">{t("chat.models.localNote")}</p>
        <div className="chat-local-settings chat-local-settings-panel">
            <label className="chat-local-field">
              <span>{t("chat.models.server")}</span>
              {availableLocalServers.length > 0 ? (
                <OptionGroup
                  label={t("chat.models.localServer")}
                  mode="dropdown"
                  size="md"
                  value={
                    selectedLocalServer?.baseUrl ?? chatSettings.local.baseUrl
                  }
                  options={availableLocalServers.map((server) => ({
                    value: server.baseUrl,
                    label: `${server.label} · ${plural("chat.models.serverModels", server.models.length)}`
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
                  placeholder="http://localhost:11434/v1" // i18n-ignore: an address
                  spellCheck={false}
                />
              )}
            </label>
            <label className="chat-local-field">
              <span>{t("chat.models.model")}</span>
              {discoveredLocalModels.length > 0 ? (
                <OptionGroup
                  label={t("chat.provider.local")}
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
                  placeholder={t("chat.models.detectPh")}
                  spellCheck={false}
                />
              )}
            </label>
            <label className="chat-local-field chat-local-field-key">
              <span>{t("chat.models.apiKey")}</span>
              <div className="chat-local-key-row">
                <KeyRound size={14} aria-hidden="true" />
                <input
                  value={localApiKey}
                  onChange={(event) => setLocalApiKey(event.target.value)}
                  placeholder={
                    chatSettings.local.hasApiKey ? t("chat.models.savedKey") : t("chat.models.optional")
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
                    {t("chat.models.clear")}
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
              <span>{t("chat.models.useTools")}</span>
            </label>
            <div className="chat-local-actions provider-card-footer provider-card-local-actions">
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
                {t("chat.models.test")}
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
                {t("chat.set.save")}
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
