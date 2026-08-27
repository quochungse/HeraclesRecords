import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type { CoachAutomationBindingView } from "../../../electron/types";

/**
 * Deleting a coach also removes every place it runs, so the athlete sees that
 * list before confirming. The conversations themselves survive — they are the
 * athlete's chat history, not the automation's.
 */
export function DeleteAutomationDialog({
  api,
  automationId,
  automationName,
  bindings,
  onClose,
  onDeleted
}: {
  api: CorosLinkApi | undefined;
  automationId: string;
  automationName: string;
  bindings: CoachAutomationBindingView[];
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  const remove = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteCoachAutomation(automationId);
      await onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <div
      className="coach-automation-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-automation-title"
      onClick={busy ? undefined : onClose}
    >
      <section
        className="panel coach-automation-dialog coach-automation-confirm"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="coach-automation-dialog-header">
          <h3 id="delete-automation-title">Delete “{automationName}”?</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {error ? <p className="coach-automation-error">{error}</p> : null}

        <div className="coach-automation-dialog-body">
          <p className="coach-automation-confirm-lead">
            <AlertTriangle size={15} aria-hidden="true" />
            This cannot be undone.
          </p>

          {bindings.length === 0 ? (
            <p className="chat-settings-copy">
              It is not attached anywhere, so nothing else changes.
            </p>
          ) : (
            <>
              <p className="chat-settings-copy">
                It will stop running in {bindings.length} place
                {bindings.length === 1 ? "" : "s"}:
              </p>
              <ul className="coach-automation-confirm-list">
                {bindings.map((binding) => (
                  <li key={binding.id}>
                    {binding.mode === "per-run" ? (
                      <Sparkles size={13} aria-hidden="true" />
                    ) : (
                      <MessageSquare size={13} aria-hidden="true" />
                    )}
                    <span className="coach-automation-confirm-name">
                      {binding.mode === "per-run"
                        ? "A new conversation each run"
                        : binding.sessionTitle ?? "Untitled conversation"}
                    </span>
                    {binding.sessionMissing ? (
                      <span className="coach-automation-confirm-note">
                        conversation already deleted
                      </span>
                    ) : !binding.enabled ? (
                      <span className="coach-automation-confirm-note">paused</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="chat-settings-copy">
                The conversations themselves are kept, along with everything this
                coach already wrote in them.
              </p>
            </>
          )}
        </div>

        <div className="coach-automation-confirm-actions">
          <button
            type="button"
            className="chat-local-action"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="chat-local-action is-danger"
            disabled={busy || !api}
            onClick={() => void remove()}
          >
            {busy ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : null}
            Delete automation
          </button>
        </div>
      </section>
    </div>
  );
}
