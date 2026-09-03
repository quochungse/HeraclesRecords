import { useEffect } from "react";
import { Server, X } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import { McpServersPanel } from "../chat/McpServersPanel";

export interface McpServersModalProps {
  api: CorosLinkApi | undefined;
  open: boolean;
  onClose: () => void;
  /** Re-runs the panel's fetch; bumped by the caller after an external change. */
  refreshVersion?: number;
  onChange?: () => void | Promise<void>;
}

/**
 * MCP server management, lifted out of Coach settings so it sits with the other
 * connections. The panel inside is the same one Coach used to render — servers
 * are app-wide, not per-conversation, so there is one place to manage them and
 * Coach reads the result.
 */
export function McpServersModal({
  api,
  open,
  onClose,
  refreshVersion = 0,
  onChange
}: McpServersModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="app-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mcp-servers-title"
      onClick={onClose}
    >
      <section
        className="panel app-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="app-modal-header">
          <div className="app-modal-title">
            <Server size={16} aria-hidden="true" />
            <h2 id="mcp-servers-title">MCP servers</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close MCP servers"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="app-modal-body">
          <p className="app-modal-copy">
            Connect additional Model Context Protocol servers so the coach can
            call their tools. Their tools appear alongside COROS, namespaced per
            server. Only add servers you trust, because tool descriptions and
            returned data are shared with the selected coach provider.
          </p>
          <McpServersPanel
            api={api}
            refreshVersion={refreshVersion}
            onChange={onChange}
          />
        </div>
      </section>
    </div>
  );
}
