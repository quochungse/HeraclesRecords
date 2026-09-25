import { useEffect, useId, useRef, useState } from "react";

export interface PromptDialogProps {
  title: string;
  /** Sits under the title; says what the value is for, not how to type it. */
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  /** A date prompt gets a real date control rather than a typed string. */
  type?: "text" | "date";
  /** Earliest acceptable day for a date prompt, as YYYY-MM-DD. */
  min?: string;
  /**
   * What the field will accept, applied to every keystroke and to the value
   * it opens with — so a limit is a thing the athlete watches happen rather
   * than a refusal read after the fact. `clampTagInput` is the one caller.
   */
  sanitize?: (value: string) => string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * The in-app replacement for `window.prompt`, which **Electron does not
 * implement** — it throws `prompt() is not supported.` from the renderer, so
 * every flow that reached for it (tagging a workout or a plan, naming a
 * duplicate, rescheduling a missed session) did nothing at all when clicked.
 * Built on the same `tl-dialog` chrome as the delete confirmations so it costs
 * no new design vocabulary.
 */
export function PromptDialog({
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  type = "text",
  min,
  sanitize,
  confirmLabel,
  onConfirm,
  onCancel
}: PromptDialogProps) {
  const [value, setValue] = useState(() =>
    sanitize ? sanitize(initialValue) : initialValue
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    if (type === "text") inputRef.current?.select();
  }, [type]);

  /*
   * Captured, for the reason OptionGroup catches Escape in the capture phase:
   * this dialog can open over a surface that closes on Escape from its own
   * document listener, and two listeners on one node are not separated by
   * stopPropagation().
   */
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [onCancel]);

  const confirmable = type === "date" ? Boolean(value) : true;

  return (
    <div className="tl-dialog-backdrop" onMouseDown={onCancel}>
      <form
        className="tl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmable) onConfirm(value);
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}
        <label className="tl-prompt-field">
          <span className="sr-only">{label}</span>
          <input
            ref={inputRef}
            type={type}
            min={type === "date" ? min : undefined}
            value={value}
            placeholder={placeholder}
            aria-label={label}
            onChange={(event) =>
              setValue(
                sanitize ? sanitize(event.target.value) : event.target.value
              )
            }
          />
        </label>
        <footer>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!confirmable}>
            {confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
