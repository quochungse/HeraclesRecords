import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, X, Zap } from "lucide-react";
import type { ChatProvider } from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import { CoachAutomationsPanel } from "./CoachAutomationsPanel";
import { AutomationsNavProvider } from "./automationsNav";
import type { AutomationsNav } from "./automationsNav";

/**
 * Automations live behind the Coaches control in the conversation header rather
 * than in Settings: they are something the athlete manages per conversation,
 * not a preference they set once.
 */
export function CoachAutomationsModal({
  api,
  open,
  provider,
  onClose,
  onChanged,
  onOpenConversation
}: {
  api: CorosLinkApi | undefined;
  open: boolean;
  provider: ChatProvider;
  onClose: () => void;
  /** Fired after any change, so the conversation header stays in step. */
  onChanged?: () => void;
  /** Opens the conversation a run wrote into, from the run log. */
  onOpenConversation?: (sessionId: string) => void;
}) {
  // A definition is a paragraph of coaching instructions plus a trigger and
  // guard rails. Clicking the backdrop — or tapping Escape — while writing one
  // must not discard it; the header's X and the screen's own Cancel stay as the
  // deliberate ways out.
  const [editing, setEditing] = useState(false);
  /** Set by whichever sub-screen is open, so its back action lives up here. */
  const [nav, setNav] = useState<AutomationsNav | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editing) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, editing, onClose]);

  // Reset when the modal is dismissed, so reopening never starts out guarded.
  useEffect(() => {
    if (!open) {
      setEditing(false);
      setNav(null);
    }
  }, [open]);

  const handleEditingChange = useCallback((value: boolean) => {
    setEditing(value);
  }, []);

  if (!open) return null;

  return (
    <div
      className="chat-settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-automations-title"
      onClick={editing ? undefined : onClose}
    >
      <section
        className="panel chat-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-settings-modal-header">
          <div className="chat-settings-modal-title">
            {nav ? (
              <button
                type="button"
                className="icon-button coach-automations-back"
                aria-label="Back"
                title="Back"
                onClick={nav.onBack}
              >
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            ) : (
              <Zap size={16} aria-hidden="true" />
            )}
            <h2 id="coach-automations-title">{nav ? nav.title : "Automations"}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close automations"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-settings-modal-body coach-automations-modal-body">
          {nav ? null : (
            <p className="chat-settings-copy">
            An automation is a coach that runs on its own — after an activity, for
            example — and writes what it finds into one or more conversations.
            Runs are read-only: they can read, analyse and draft, but never write
              to COROS. They only run while CorosLink is open.
            </p>
          )}
          <AutomationsNavProvider value={setNav}>
            <CoachAutomationsPanel
              api={api}
              provider={provider}
              onChanged={onChanged}
              onEditingChange={handleEditingChange}
              {...(onOpenConversation ? { onOpenConversation } : {})}
            />
          </AutomationsNavProvider>
        </div>
      </section>
    </div>
  );
}
