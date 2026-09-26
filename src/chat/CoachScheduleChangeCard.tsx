import { Loader2 } from "lucide-react";
import type { ScheduleChangeLine, ScheduleChangeSet } from "../../electron/types";
import { changeSetHead, lineStatusLabel, proposedLines } from "./scheduleChangeModel";

/**
 * Coach's proposal to the calendar or the workout library, under the answer
 * that made it (P3.2–P3.3 of docs/coach-plan-canvas.md): a line per change,
 * each applied or dismissed on its own, and Apply all when there is more than
 * one to apply. The set is a row of its own, so the card reads the same after
 * a restart and on the other machine; every line is checked against COROS
 * again when it is applied.
 */
export function CoachScheduleChangeCard({
  changeSet,
  busyLine,
  disabled = false,
  onApply,
  onDismiss
}: {
  changeSet: ScheduleChangeSet;
  /** The line being applied, `"*"` for the whole set; the card waits while it runs. */
  busyLine?: string | null;
  /** Something else is being applied, or a turn is running. */
  disabled?: boolean;
  onApply?: (lineId?: string) => void;
  onDismiss?: (lineId?: string) => void;
}) {
  const open = proposedLines(changeSet);
  const busy = Boolean(busyLine) || disabled;
  const deletion = changeSet.lines.every((line) => line.op === "remove" || line.op === "deleteWorkout");
  return (
    <article className="chat-plan-card chat-creation-card chat-change-card" data-change-set-id={changeSet.changeSetId}>
      <header className="chat-creation-head">
        <div>
          <span className="chat-creation-kicker">{deletion ? "Delete" : "Calendar changes"}</span>
          <h4>{changeSet.summary}</h4>
          <span className="chat-plan-card-summary">{changeSetHead(changeSet)}</span>
        </div>
      </header>

      <ul className="chat-change-lines">
        {changeSet.lines.map((line) => (
          <ChangeLine
            key={line.lineId}
            line={line}
            busy={busyLine === line.lineId || (busyLine === "*" && line.status === "proposed")}
            disabled={busy}
            onApply={onApply ? () => onApply(line.lineId) : undefined}
            onDismiss={onDismiss ? () => onDismiss(line.lineId) : undefined}
          />
        ))}
      </ul>

      {open.length > 1 && (onApply || onDismiss) ? (
        <div className="chat-plan-actions">
          {onApply ? (
            <button type="button" className="chat-plan-upload" disabled={busy} onClick={() => onApply()}>
              {busyLine === "*" ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : null}
              Apply all {open.length}
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="chat-plan-review" disabled={busy} onClick={() => onDismiss()}>
              Dismiss all
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ChangeLine({
  line,
  busy,
  disabled,
  onApply,
  onDismiss
}: {
  line: ScheduleChangeLine;
  busy: boolean;
  disabled: boolean;
  onApply?: () => void;
  onDismiss?: () => void;
}) {
  const destructive = line.op === "remove" || line.op === "deleteWorkout";
  return (
    <li className="chat-change-line" data-status={line.status} data-op={line.op}>
      <div className="chat-change-line-text">
        <span className="chat-change-line-label">{line.label}</span>
        {line.status !== "proposed" ? (
          <span className="chat-change-line-status">
            {lineStatusLabel(line)}
            {line.reason ? ` — ${line.reason}` : ""}
          </span>
        ) : null}
      </div>
      {line.status === "proposed" && (onApply || onDismiss) ? (
        <div className="chat-change-line-actions">
          {onApply ? (
            <button
              type="button"
              className={destructive ? "chat-change-apply is-destructive" : "chat-change-apply"}
              disabled={disabled}
              onClick={onApply}
            >
              {busy ? <Loader2 className="chat-spinner" size={12} aria-hidden="true" /> : null}
              {line.op === "remove" ? "Remove" : line.op === "deleteWorkout" ? "Delete" : "Apply"}
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="chat-change-dismiss" disabled={disabled} onClick={onDismiss}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
