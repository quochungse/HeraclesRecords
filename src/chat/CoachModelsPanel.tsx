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
import type {
  AnthropicApiConnectionTest,
  AnthropicEffort,
  ChatAuthStatus,
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  OpenRouterConnectionTest
} from "../../electron/types";
import {
  ANTHROPIC_MODEL_OPTIONS,
  CLAUDE_MODEL_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  formatEffortOption,
  formatModelOptionLabel,
  withNamedDefaultModel
} from "../../electron/chatModels";
import { ClaudeAuthScopeToggle } from "./ClaudeAuthScopeToggle";
import { ClaudeCodeLoginCard } from "./ClaudeCodeLoginCard";
import { detectAndAdoptLocalServer } from "./localModelDetection";
import type { CorosLinkApi } from "../coroslink-api";

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
  const ready: Record<ChatProvider, boolean> = {
    chatgpt: authStatus?.signedIn === true,
    "claude-code": claudeStatus?.state === "connected",
    "claude-api": chatSettings.anthropic.hasApiKey === true,
    openrouter: chatSettings.openRouter.hasApiKey === true,
    local: chatSettings.local.model.trim().length > 0
  };
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

export interface CoachModelsPanelProps {
  api: CorosLinkApi | undefined;
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

  const [localApiKey, setLocalApiKey] = useState("");
  const [localConnection, setLocalConnection] =
    useState<LocalChatConnectionTest | null>(null);
  const [localDiscovery, setLocalDiscovery] =
    useState<LocalChatDiscovery | null>(null);
  const [testingLocal, setTestingLocal] = useState(false);
  const [detectingLocal, setDetectingLocal] = useState(false);

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

  const refreshClaudeCodeStatus = async () => {
    if (checkingClaude) return;
    setCheckingClaude(true);
    setError(null);
    try {
      setClaudeStatus(await api.getClaudeCodeStatus());
      await onChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Claude Code detection failed."
      );
    } finally {
      setCheckingClaude(false);
    }
  };

  const handleClaudeSignedIn = (status: ClaudeCodeStatus) => {
    setClaudeStatus(status);
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
    setError(null);
    try {
      const result = await api.testClaudeCodeConnection();
      setClaudeStatus(result.status);
      if (!result.ok) setError(result.message);
      await onChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Claude connection test failed."
      );
    } finally {
      setTestingClaude(false);
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
      const result = await api.testOpenRouterConnection({
        ...chatSettings.openRouter,
        apiKey: openRouterApiKey.trim() || undefined
      });
      setOpenRouterConnection(result);
      if (!result.ok) setError(result.message);
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
      setAnthropicConnection(
        await api.testAnthropicConnection({
          model: chatSettings.anthropic.model,
          effort: chatSettings.anthropic.effort,
          apiKey: anthropicApiKey.trim() || undefined
        })
      );
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

  const appScopedAuth = chatSettings.claudeCode.useAppScopedAuth !== false;
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
            <span className="chat-settings-email">Signed in</span>
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
        <div className="chat-settings-section-title">
          <h3>Claude subscription</h3>
          <span className="chat-beta-badge">Beta</span>
        </div>
        <p className="chat-settings-copy">
          Runs the Claude Code CLI installed on this computer against your Claude
          subscription. Heracles Records never sees your Claude password — sign-in
          happens in your browser and Claude Code stores the credentials.
        </p>

        <strong className="chat-claude-group-title">Claude session</strong>
        <ClaudeAuthScopeToggle
          appScoped={appScopedAuth}
          disabled={busy}
          onChange={(next) => updateClaudeCode({ useAppScopedAuth: next })}
        />
        <p className="chat-settings-copy">
          {appScopedAuth
            ? "Heracles Records keeps its own Claude credentials in its app data folder. Any Claude account you use elsewhere on this computer — including in a terminal — is left alone."
            : "Heracles Records will use the machine-wide Claude login in your home folder, shared with the terminal. Signing in here replaces that login."}
        </p>

        {/* Only offered alongside the machine-wide login: pointing at a
            specific CLI is a "which Claude on this device" question, and it is
            the device side of the switch that raises it. A path saved here
            stays in effect either way — the app-scoped runtime spawns the same
            binary, just against its own credential directory. */}
        {!appScopedAuth ? (
          <label className="chat-local-field">
            <span>Claude executable</span>
            <div className="chat-claude-path-row">
              <Terminal size={15} aria-hidden="true" />
              <input
                value={chatSettings.claudeCode.executablePath ?? ""}
                onChange={(event) =>
                  updateClaudeCode({ executablePath: event.target.value })
                }
                placeholder="Auto-detect Claude Code"
                spellCheck={false}
              />
            </div>
          </label>
        ) : null}

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
          {appScopedAuth && claudeStatus?.authenticated ? (
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
              Revoke
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
            <select
              value={chatSettings.claudeCode.model ?? ""}
              onChange={(event) =>
                updateClaudeCode({ model: event.target.value })
              }
            >
              {(
                claudeStatus?.availableModels?.length
                  ? claudeStatus.availableModels
                  : chatSettings.claudeCode.availableModels?.length
                    ? chatSettings.claudeCode.availableModels
                    : withNamedDefaultModel(
                        CLAUDE_MODEL_OPTIONS,
                        chatSettings.claudeCode.defaultModel
                      )
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {formatModelOptionLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="chat-local-field">
            <span>Reasoning effort</span>
            <select
              value={chatSettings.claudeCode.effort}
              onChange={(event) =>
                updateClaudeCode({
                  effort: event.target.value as AnthropicEffort
                })
              }
            >
              {REASONING_EFFORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {formatEffortOption(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
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
          <label className="chat-local-tools is-disabled">
            <input type="checkbox" checked={false} disabled />
            <span>Full activity files (not available in beta)</span>
          </label>
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
            <select
              value={chatSettings.anthropic.model}
              onChange={(event) =>
                updateAnthropic({ model: event.target.value })
              }
            >
              {ANTHROPIC_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="chat-local-field">
            <span>Reasoning effort</span>
            <select
              value={chatSettings.anthropic.effort}
              onChange={(event) =>
                updateAnthropic({
                  effort: event.target.value as AnthropicEffort
                })
              }
            >
              {REASONING_EFFORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {formatEffortOption(option)}
                </option>
              ))}
            </select>
          </label>
          <p className="chat-settings-copy">
            Higher effort spends more tokens on reasoning before answering.
            Lower effort is cheaper and faster for routine questions.
          </p>

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
              {(openRouterConnection?.models ?? []).map((model) => (
                <option key={model.id} value={model.id} label={model.name} />
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
                <select
                  value={selectedLocalServer?.baseUrl ?? chatSettings.local.baseUrl}
                  onChange={(event) => {
                    const server = availableLocalServers.find(
                      (entry) => entry.baseUrl === event.target.value
                    );
                    if (!server) return;
                    updateLocalDraft({
                      baseUrl: server.baseUrl,
                      model: server.models.includes(chatSettings.local.model)
                        ? chatSettings.local.model
                        : server.models[0] ?? ""
                    });
                  }}
                >
                  {availableLocalServers.map((server) => (
                    <option key={server.baseUrl} value={server.baseUrl}>
                      {server.label} · {server.models.length} model
                      {server.models.length === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
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
                <select
                  value={
                    discoveredLocalModels.includes(chatSettings.local.model)
                      ? chatSettings.local.model
                      : discoveredLocalModels[0]
                  }
                  onChange={(event) =>
                    updateLocalDraft({ model: event.target.value })
                  }
                >
                  {discoveredLocalModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
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
