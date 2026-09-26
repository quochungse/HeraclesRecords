import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Plus } from "lucide-react";
import type { ChatSessionSummary } from "../../electron/types";
// The dialog chrome is the library's `tl-dialog`, as ConfirmDialog's is.
import "../training-library/trainingLibrary.css";

/** Conversations offered besides a new one: enough to find the one meant, few enough to read. */
const LISTED = 6;

/**
 * Where a question asked from outside Coach goes (the Calendar, the Library):
 * a conversation the athlete picks, or a new one. It used to join whichever
 * conversation happened to be open, so asking about next week landed in the
 * middle of an unrelated thread the athlete had last left open.
 *
 * `suggested` is the conversation the question is about — the one a Coach
 * plan was made in — and leads the list; then the pinned, then the most recent.
 */
export function CoachAskPicker({
  subject,
  sessions,
  suggestedId,
  activeId,
  onPick,
  onCancel
}: {
  /** What the question is about, as its chip will read. */
  subject: string;
  sessions: readonly ChatSessionSummary[];
  suggestedId?: string | null;
  activeId?: string | null;
  /** A conversation's id, or null for a new one. */
  onPick: (sessionId: string | null) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  // Captured, as ConfirmDialog does: Coach has document-level Escape listeners of its own.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, []);

  const suggested = suggestedId ? sessions.find((session) => session.id === suggestedId) : undefined;
  // Pinned first, as the sidebar lists them: a pinned conversation is where
  // the athlete keeps asking, however long ago it last moved.
  const time = (value: string | null) => (value ? new Date(value).getTime() : 0);
  const recent = [...sessions]
    .filter((session) => session.id !== suggested?.id)
    .sort(
      (left, right) =>
        Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt)) ||
        time(right.pinnedAt) - time(left.pinnedAt) ||
        time(right.updatedAt) - time(left.updatedAt)
    )
    .slice(0, suggested ? LISTED - 1 : LISTED);
  const listed = suggested ? [suggested, ...recent] : recent;

  const note = (session: ChatSessionSummary) =>
    session.id === suggested?.id
      ? "Where this plan was made"
      : session.id === activeId
        ? "Open now"
        : session.pinnedAt
          ? "Pinned"
          : updatedLabel(session.updatedAt);

  return createPortal(
    <div className="tl-dialog-backdrop" onMouseDown={onCancel}>
      <section
        className="tl-dialog coach-ask-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>Ask Coach in…</h2>
        <p>{subject}</p>
        <ul className="coach-ask-list">
          <li>
            <button ref={firstRef} type="button" className="coach-ask-option is-new" onClick={() => onPick(null)}>
              <Plus size={15} aria-hidden="true" />
              <strong>New conversation</strong>
            </button>
          </li>
          {listed.map((session) => (
            <li key={session.id}>
              <button type="button" className="coach-ask-option" onClick={() => onPick(session.id)}>
                <MessageCircle size={15} aria-hidden="true" />
                <strong>{session.title || "Untitled conversation"}</strong>
                <span>{note(session)}</span>
              </button>
            </li>
          ))}
        </ul>
        <footer>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

function updatedLabel(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
