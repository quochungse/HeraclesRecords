import { AlertTriangle } from "lucide-react";
import type { McpServerStatus } from "../../electron/types";
import { plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

interface McpSessionPromptProps {
  /**
   * Enabled servers that were connected before and whose stored session no
   * longer works. Servers that were never connected are not listed here.
   */
  servers: McpServerStatus[];
  busy: boolean;
  /** Clear the stored session for every listed server. */
  onSkip: () => void;
  /** Leave the stored session alone and ask again next visit. */
  onLater: () => void;
  /** Open the authorization window for each listed server, in turn. */
  onAuthorize: () => void;
}

export function McpSessionPrompt({
  servers,
  busy,
  onSkip,
  onLater,
  onAuthorize
}: McpSessionPromptProps) {
  const { rich } = useI18n();
  if (servers.length === 0) {
    return null;
  }

  return (
    <div
      className="mcp-session-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mcp-session-title"
    >
      <div className="mcp-session-modal">
        <header className="mcp-session-modal-header">
          <AlertTriangle size={18} aria-hidden="true" />
          <h2 id="mcp-session-title">
            {servers.length === 1
              ? t("chat.mcpSession.titleOne", { name: servers[0].name })
              : plural("chat.mcpSession.titleMany", servers.length)}
          </h2>
        </header>

        <div className="mcp-session-modal-body">
          <p>{plural("chat.mcpSession.body", servers.length)}</p>

          <ul className="mcp-session-servers">
            {servers.map((server) => (
              <li key={server.id}>
                <span className="mcp-session-server-name">{server.name}</span>
                <span className="mcp-session-server-state">
                  {server.error ?? t("chat.mcpSession.invalid")}
                </span>
              </li>
            ))}
          </ul>

          <p className="mcp-session-hint">
            {rich("chat.mcpSession.hint", { b: (chunk) => <b>{chunk}</b> })}
          </p>
        </div>

        <footer className="mcp-session-actions">
          <button
            type="button"
            className="mcp-session-button"
            disabled={busy}
            onClick={onSkip}
          >
            {t("chat.mcpSession.skip")}
          </button>
          <button
            type="button"
            className="mcp-session-button"
            disabled={busy}
            onClick={onLater}
          >
            {t("chat.mcpSession.later")}
          </button>
          <button
            type="button"
            className="mcp-session-button is-primary"
            disabled={busy}
            onClick={onAuthorize}
          >
            {t("chat.mcpSession.authorize")}
          </button>
        </footer>
      </div>
    </div>
  );
}
