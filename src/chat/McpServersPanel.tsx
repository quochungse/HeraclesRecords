import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CircleCheck,
  KeyRound,
  Loader2,
  Plus,
  Plug,
  PlugZap,
  Server,
  ShieldCheck,
  Trash2,
  Unplug,
  UserRound
} from "lucide-react";
import { OptionGroup } from "../components/OptionGroup";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import {
  corosMcpRegion
} from "../../electron/corosMcpRegions";
import type {
  CorosMcpAccount,
  CorosMcpRegion,
  McpServerConfig,
  McpServerInput,
  McpServerStatus
} from "../../electron/types";
import { plural, t, type MessageKey } from "../i18n/core";

// One-click presets: hosted URL + OAuth MCP servers (scope discovered from the
// server's own auth metadata by the MCP SDK).
const PRESETS: Array<McpServerInput & { descriptionKey: MessageKey }> = [
  {
    id: "freddy",
    name: "Freddy", // i18n-ignore: a name
    url: "https://freddy.coach/mcp",
    authType: "oauth",
    descriptionKey: "chat.mcp.freddy"
  },
  {
    id: "strava",
    name: "Strava",
    url: "https://mcp.strava.com/mcp",
    authType: "oauth",
    descriptionKey: "chat.mcp.strava"
  }
];

/**
 * Roll the raw statuses into the counts a summary line needs. The panel itself
 * no longer shows them — the Connections row in Settings that opens this panel
 * does, so the numbers sit next to the thing you click rather than being
 * repeated once the panel is already open.
 */
export function summarizeMcpStatuses(
  servers: { id: string }[],
  statuses: McpServerStatus[]
): { total: number; connected: number; tools: number } {
  return {
    total: servers.length,
    connected: statuses.filter((status) => status.connected).length,
    tools: statuses.reduce(
      (total, status) => total + (status.connected ? status.toolCount : 0),
      0
    )
  };
}

export function McpServersPanel({
  api,
  refreshVersion = 0,
  onChange
}: {
  api: HeraclesRecordsApi | undefined;
  refreshVersion?: number;
  onChange?: () => void | Promise<void>;
}) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({});
  const [corosAccount, setCorosAccount] = useState<CorosMcpAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addAuth, setAddAuth] = useState<"oauth" | "bearer" | "none">("oauth");

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const [list, statusList, account] = await Promise.all([
        api.listMcpServers(),
        api.getMcpStatuses(),
        loadCorosAccount(api)
      ]);
      setServers(list);
      setStatuses(Object.fromEntries(statusList.map((s) => [s.id, s])));
      setCorosAccount(account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshVersion]);

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      if (!api) return;
      setBusyId(id);
      setError(null);
      try {
        await action();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusyId(null);
        await refresh();
        await onChange?.();
      }
    },
    [api, onChange, refresh]
  );

  if (!api) return null;

  const existingIds = new Set(servers.map((s) => s.id));
  const availablePresets = PRESETS.filter((p) => !existingIds.has(p.id ?? ""));

  return (
    <div className="mcp-servers-panel">
      {error ? (
        <p className="mcp-servers-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}

      {loading ? (
        <div className="mcp-servers-list" aria-hidden="true">
          <div className="mcp-server-skeleton" />
          <div className="mcp-server-skeleton" />
        </div>
      ) : servers.length > 0 ? (
        <ul className="mcp-servers-list">
          {servers.map((server) => {
            const status = statuses[server.id];
            const busy = busyId === server.id;
            const state =
              status?.enabled === false
                ? "disabled"
                : status?.connected
                  ? "connected"
                  : status?.authenticated
                    ? "authorized"
                    : "disconnected";
            const StatusIcon =
              state === "connected"
                ? CircleCheck
                : state === "authorized"
                  ? ShieldCheck
                  : Unplug;
            const statusLabel =
              state === "connected"
                ? plural("chat.mcp.toolsReady", status.toolCount)
                : state === "authorized"
                  ? t("chat.mcp.readyToConnect")
                  : state === "disabled"
                    ? t("chat.mcp.disabled")
                    : t("chat.mcp.notConnected");
            // Only a first authorization opens COROS sign-in.
            const corosRegion =
              status?.connected || status?.authenticated
                ? null
                : corosMcpRegion(server.url);

            return (
              <li
                key={server.id}
                className="mcp-server-row"
                data-state={state}
              >
                <span className="mcp-server-icon" aria-hidden="true">
                  <Server size={17} />
                </span>
                <div className="mcp-server-info">
                  <div className="mcp-server-title">
                    <strong>{server.name}</strong>
                    <span className={`mcp-server-pill is-${state}`}>
                      <StatusIcon size={12} aria-hidden="true" />
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mcp-server-meta">
                    <code className="mcp-server-url">{server.url}</code>
                    <span>{authLabel(server.authType)}</span>
                  </div>
                  {corosRegion && corosAccount ? (
                    <CorosAccountNote
                      account={corosAccount}
                      builtin={server.builtin}
                      serverRegion={corosRegion}
                    />
                  ) : null}
                  {status?.error ? (
                    <span className="mcp-server-row-error">
                      <AlertCircle size={13} aria-hidden="true" />
                      {status.error}
                    </span>
                  ) : null}
                  {server.authType === "bearer" ? (
                    <BearerField
                      disabled={busy}
                      onSave={(token) =>
                        run(server.id, () => api.setMcpBearer(server.id, token))
                      }
                    />
                  ) : null}
                </div>
                <div className="mcp-server-actions">
                  {status?.connected ? (
                    <button
                      type="button"
                      className="mcp-server-action"
                      disabled={busy}
                      onClick={() =>
                        run(server.id, () => api.disconnectMcpServer(server.id))
                      }
                    >
                      {busy ? (
                        <Loader2 size={14} className="spin" aria-hidden="true" />
                      ) : (
                        <Plug size={14} aria-hidden="true" />
                      )}
                      {t("common.disconnect")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mcp-server-action is-primary"
                      disabled={busy}
                      onClick={() =>
                        run(server.id, () => api.connectMcpServer(server.id))
                      }
                    >
                      {busy ? (
                        <Loader2 size={14} className="spin" aria-hidden="true" />
                      ) : (
                        <PlugZap size={14} aria-hidden="true" />
                      )}
                      {t("common.connect")}
                    </button>
                  )}
                  {server.builtin ? null : (
                    <button
                      type="button"
                      className="mcp-server-remove"
                      disabled={busy}
                      title={t("chat.mcp.remove")}
                      aria-label={t("chat.mcp.removeName", { name: server.name })}
                      onClick={() =>
                        run(server.id, () => api.removeMcpServer(server.id))
                      }
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mcp-servers-empty">
          <Server size={20} aria-hidden="true" />
          <div>
            <strong>{t("chat.mcp.none")}</strong>
            <span>{t("chat.mcp.noneHint")}</span>
          </div>
        </div>
      )}

      {availablePresets.length > 0 ? (
        <section className="mcp-servers-presets" aria-labelledby="mcp-quick-add">
          <div className="mcp-servers-subheading">
            <div>
              <strong id="mcp-quick-add">{t("chat.mcp.quick")}</strong>
              <span>{t("chat.mcp.quickHint")}</span>
            </div>
          </div>
          <div className="mcp-servers-preset-grid">
            {availablePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={busyId !== null}
                onClick={() =>
                  run(preset.id ?? preset.name, async () => {
                    const added = await api.addMcpServer(preset);
                    await api.connectMcpServer(added.id);
                  })
                }
              >
                <span className="mcp-server-preset-icon" aria-hidden="true">
                  <PlugZap size={16} />
                </span>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{t(preset.descriptionKey)}</small>
                </span>
                {busyId === preset.id ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <Plus size={15} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <form
        className="mcp-servers-add"
        aria-labelledby="mcp-custom-server"
        onSubmit={(event) => {
          event.preventDefault();
          if (!addName.trim() || !addUrl.trim()) return;
          void run("__add__", async () => {
            const added = await api.addMcpServer({
              name: addName.trim(),
              url: addUrl.trim(),
              authType: addAuth
            });
            setAddName("");
            setAddUrl("");
            if (added.authType === "oauth") {
              await api.connectMcpServer(added.id);
            }
          });
        }}
      >
        <div className="mcp-servers-subheading">
          <div>
            <strong id="mcp-custom-server">{t("chat.mcp.custom")}</strong>
            <span>{t("chat.mcp.customHint")}</span>
          </div>
        </div>
        <div className="mcp-servers-add-fields">
          <label className="mcp-server-field">
            <span>{t("chat.mcp.name")}</span>
            <input
              type="text"
              placeholder={t("chat.mcp.namePh")}
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              required
            />
          </label>
          <label className="mcp-server-field is-url">
            <span>{t("chat.mcp.endpoint")}</span>
            <input
              type="url"
              placeholder="https://server.example/mcp" // i18n-ignore: an address
              value={addUrl}
              onChange={(event) => setAddUrl(event.target.value)}
              required
            />
          </label>
          <label className="mcp-server-field">
            <span>{t("chat.mcp.auth")}</span>
            <OptionGroup
              label={t("chat.mcp.auth")}
              size="md"
              fill
              value={addAuth}
              options={[
                { value: "oauth", label: "OAuth" }, // i18n-ignore: a protocol
                { value: "bearer", label: t("chat.models.apiKey") },
                { value: "none", label: t("chat.mcp.authNone") }
              ]}
              onChange={setAddAuth}
            />
          </label>
          <button
            type="submit"
            className="mcp-servers-add-submit"
            disabled={busyId !== null || !addName.trim() || !addUrl.trim()}
          >
            {busyId === "__add__" ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            {t("chat.mcp.add")}
          </button>
        </div>
      </form>
    </div>
  );
}

function authLabel(authType: McpServerConfig["authType"]): string {
  if (authType === "oauth") return "OAuth"; // i18n-ignore: a protocol
  if (authType === "bearer") return t("chat.models.apiKey");
  return t("chat.mcp.noAuth");
}

async function loadCorosAccount(
  api: HeraclesRecordsApi
): Promise<CorosMcpAccount | null> {
  try {
    return await api.getCorosMcpAccount();
  } catch {
    // It only personalises COROS sign-in, so it must never hide the list.
    return null;
  }
}

function CorosAccountNote({
  account,
  builtin,
  serverRegion
}: {
  account: CorosMcpAccount;
  builtin: boolean;
  serverRegion: CorosMcpRegion;
}) {
  if (!account.email && !account.region) return null;
  // The built-in server moves to the account's region when it connects.
  const region = builtin ? account.region ?? serverRegion : serverRegion;
  const regionLabel = t(`chat.mcp.region.${region}` as MessageKey);
  const accountElsewhere =
    account.region && account.region !== region ? account.region : null;
  return (
    <div className="mcp-server-coros-account">
      <UserRound size={15} aria-hidden="true" />
      <div>
        <span>{t("profile.eyebrow")}</span>
        {account.email ? <strong>{account.email}</strong> : null}
        <small>
          {account.email
            ? t("chat.mcp.signInEmail", { region: regionLabel })
            : accountElsewhere
              ? t("chat.mcp.signIn", { region: regionLabel })
              : t("chat.mcp.signInRegion", { region: regionLabel })}
        </small>
        {accountElsewhere ? (
          <small className="is-warning">
            {t("chat.mcp.accountElsewhere", { region: t(`chat.mcp.region.${accountElsewhere}` as MessageKey) })}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function BearerField({
  disabled,
  onSave
}: {
  disabled: boolean;
  onSave: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  return (
    <label className="mcp-server-bearer-field">
      <span>{t("chat.models.apiKey")}</span>
      <span className="mcp-server-bearer">
        <KeyRound size={14} aria-hidden="true" />
        <input
          type="password"
          placeholder={t("chat.mcp.bearerPh")}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          disabled={disabled || !token.trim()}
          onClick={() => {
            onSave(token.trim());
            setToken("");
          }}
        >
          {t("chat.mcp.saveKey")}
        </button>
      </span>
    </label>
  );
}
