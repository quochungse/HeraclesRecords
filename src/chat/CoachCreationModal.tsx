import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, MessageCircle, Trash2, X } from "lucide-react";
import type { PlanDraftPreview } from "../../electron/types";

/**
 * One Coach creation, opened from the Creations panel.
 *
 * The panel used to widen to twice its size and show this in place. That put
 * the card in the narrowest column on screen — a plan is a week grid and a
 * workout is a step list, and both were being read through a slot sized for a
 * list of titles. A dialog is the shape the content already wanted, and it
 * also means the panel stays one width, so opening an item no longer shoves
 * the conversation sideways.
 *
 * The card itself is passed in as `children`: it lives in `ChatView` beside
 * the upload state it drives, and hoisting it here would have moved that state
 * with it.
 */
export function CoachCreationModal({
  draft,
  kicker,
  onClose,
  onViewInChat,
  onRemove,
  children
}: {
  /** null is closed. */
  draft: PlanDraftPreview | null;
  /** "One-off workout", or "Plan 2 of 3" — worked out by the caller. */
  kicker: string;
  onClose: () => void;
  onViewInChat: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  // Two-step rather than a second dialog on top of this one. Removing is
  // undoable only by asking the coach again, so it asks — but a dialog opened
  // over a dialog gives Escape two meanings and the athlete no way to tell
  // which one it just used.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The confirmation is a step inside this dialog, so Escape backs out of
      // it first rather than closing everything at once.
      if (confirming) {
        setConfirming(false);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [draft, confirming, onClose]);

  // Reopening on another creation must never land mid-confirmation.
  useEffect(() => {
    setConfirming(false);
  }, [draft?.draftId]);

  if (!draft) return null;

  const isWorkout = draft.artifactType === "workout";
  const title =
    draft.name || (isWorkout ? "Untitled workout" : "Untitled plan");

  return (
    <div
      className="chat-settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-creation-title"
      onClick={onClose}
    >
      <section
        className="panel chat-settings-modal chat-creation-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-settings-modal-header">
          <div className="chat-settings-modal-title chat-creation-modal-title">
            <BookOpen size={16} aria-hidden="true" />
            <div>
              <h2 id="coach-creation-title" title={title}>
                {title}
              </h2>
              <span>{kicker}</span>
            </div>
          </div>
          <div className="chat-creation-modal-tools">
            <button
              type="button"
              className="chat-plan-panel-chat-link"
              onClick={onViewInChat}
              title="View the generated response in chat"
            >
              <MessageCircle size={14} aria-hidden="true" />
              View in chat
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="chat-settings-modal-body chat-creation-modal-body">
          {children}
        </div>

        <footer className="chat-creation-modal-footer">
          {confirming ? (
            <>
              <span className="chat-creation-modal-confirm">
                Remove this from Creations? Anything already saved to COROS or
                your library stays.
              </span>
              <button
                type="button"
                className="chat-local-action"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="chat-local-action is-danger"
                onClick={onRemove}
              >
                <Trash2 size={14} aria-hidden="true" />
                Remove
              </button>
            </>
          ) : (
            <button
              type="button"
              className="chat-local-action is-danger chat-creation-modal-remove"
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
