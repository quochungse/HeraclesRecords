import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export interface ConfirmDialogProps {
  title: string;
  /** What the action does, in the words of the thing it does it to. */
  description?: string;
  /** A consequence the athlete would not expect, set apart from the description. */
  warning?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Marks the action as destructive: the confirm button turns. */
  danger?: boolean;
  /** A third answer, between keeping things as they are and the action. */
  alternative?: { label: string; onSelect: () => void };
  /**
   * The answer being carried out: its button says what is happening now, and
   * the dialog stays up and cannot be answered again or dismissed until it is
   * done — closing it first left a slow save with nothing on screen.
   */
  busy?: { target: "confirm" | "alternative"; label: string };
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The in-app replacement for `window.confirm`.
 *
 * Unlike `window.prompt`, which **Electron does not implement at all**,
 * `confirm` works — it opens a native OS dialog and blocks the renderer
 * thread until it is answered. That is the problem rather than a crash: an
 * unstyled system box appears over the app, it cannot say what it is about
 * beyond one line of plain text, it is not themeable, and nothing in it can
 * be tested. Verified against a real BrowserWindow rather than assumed: the
 * call blocks past three seconds with no way to answer it from script.
 *
 * Built on the same `tl-dialog` chrome as `PromptDialog` and the delete
 * confirmation it replaces, so it costs no new design vocabulary.
 *
 * Cancel takes focus, not confirm. Every use of this is a question whose
 * destructive answer is the one being warned about, and a dialog that opens
 * with the destructive button focused turns a reflexive Enter into the thing
 * the dialog exists to prevent.
 */
export function ConfirmDialog({
  title,
  description,
  warning,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  alternative,
  busy,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const dismiss = () => {
    if (!busy) onCancel();
  };
  const working = (target: "confirm" | "alternative", label: string) =>
    busy?.target === target ? (
      <>
        <LoaderCircle size={14} className="is-spinning" aria-hidden="true" /> {busy.label}
      </>
    ) : (
      label
    );
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  /*
   * Captured, for the reason PromptDialog and OptionGroup capture it: this
   * opens over surfaces with their own document-level Escape listener, and
   * two listeners on one node are not separated by stopPropagation().
   */
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onCancel();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [onCancel, busy]);

  return (
    <div className="tl-dialog-backdrop" onMouseDown={dismiss}>
      <section
        className="tl-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-busy={busy ? true : undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        /* A mousedown on the panel bubbles to the backdrop, so without this
           selecting the text of the question would dismiss it. */
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}
        {warning ? <p className="tl-dialog-warning" role="note">{warning}</p> : null}
        <footer>
          <button ref={cancelRef} type="button" className="ghost-button" disabled={Boolean(busy)} onClick={onCancel}>
            {cancelLabel}
          </button>
          {alternative ? (
            <button
              type="button"
              className={`ghost-button${busy?.target === "alternative" ? " is-busy" : ""}`}
              disabled={Boolean(busy)}
              onClick={alternative.onSelect}
            >
              {working("alternative", alternative.label)}
            </button>
          ) : null}
          <button
            type="button"
            className={`primary-button${danger ? " danger" : ""}${busy?.target === "confirm" ? " is-busy" : ""}`}
            disabled={Boolean(busy)}
            onClick={onConfirm}
          >
            {working("confirm", confirmLabel)}
          </button>
        </footer>
      </section>
    </div>
  );
}
