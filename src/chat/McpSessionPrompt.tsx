import { AlertTriangle } from "lucide-react";
import type { McpServerStatus } from "../../electron/types";

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
              ? `${servers[0].name} needs to be connected again`
              : `${servers.length} MCP sessions need to be connected again`}
          </h2>
        </header>

        <div className="mcp-session-modal-body">
          <p>
            The stored session for{" "}
            {servers.length === 1 ? "this server" : "these servers"} has stopped
            working, so Coach cannot reach{" "}
            {servers.length === 1 ? "its" : "their"} tools. Coach still answers
            without them, just with less of your COROS data.
          </p>

          <ul className="mcp-session-servers">
            {servers.map((server) => (
              <li key={server.id}>
                <span className="mcp-session-server-name">{server.name}</span>
                <span className="mcp-session-server-state">
                  {server.error ?? "Stored session is no longer valid."}
                </span>
              </li>
            ))}
          </ul>

          <p className="mcp-session-hint">
            <b>Skip</b> clears the stored session, so it stops being retried and
            this stops being asked. <b>Later</b> changes nothing and asks again
            next time you open Coach.
          </p>
        </div>

        <footer className="mcp-session-actions">
          <button
            type="button"
            className="mcp-session-button"
            disabled={busy}
            onClick={onSkip}
          >
            Skip
          </button>
          <button
            type="button"
            className="mcp-session-button"
            disabled={busy}
            onClick={onLater}
          >
            Later
          </button>
          <button
            type="button"
            className="mcp-session-button is-primary"
            disabled={busy}
            onClick={onAuthorize}
          >
            Authorize
          </button>
        </footer>
      </div>
    </div>
  );
}
