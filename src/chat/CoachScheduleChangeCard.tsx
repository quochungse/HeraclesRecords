import { Loader2 } from "lucide-react";
import type { ScheduleChangeLine, ScheduleChangeSet } from "../../electron/types";
import {
  canApply,
  changeDayLabel,
  changeLineLabel,
  changeLineReason,
  changeSetDays,
  changeSetHead,
  groupChangeLines,
  lineStatusLabel,
  proposedLines
} from "./scheduleChangeModel";
import { t } from "../i18n/core";

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
  const { toDecide, retry, done } = groupChangeLines(changeSet);
  const days = changeSetDays(changeSet);
  // What is over folds under one line while anything is still open; with
  // nothing left to decide it is the whole card, so it stands open.
  const groups = [
    { title: t("chat.change.group.toDecide"), lines: toDecide, folded: false },
    { title: t("chat.change.group.retry"), lines: retry, folded: false },
    { title: t("chat.change.group.done"), lines: done, folded: toDecide.length + retry.length > 0 }
  ];
  const doneSummary = done
    .map((line) => lineStatusLabel(line).toLowerCase())
    .reduce<Record<string, number>>((counts, label) => ({ ...counts, [label]: (counts[label] ?? 0) + 1 }), {});
  const doneText = Object.entries(doneSummary)
    .map(([label, count]) => t("chat.change.countOf", { count, label }))
    .join(" · ");
  const renderLines = (lines: ScheduleChangeLine[]) => (
    <ul className="chat-change-lines">
      {lines.map((line) => (
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
  );
  // One kicker for every set: a set of removals read "Delete", which named an
  // operation as though it were the kind of card.
  return (
    <article className="chat-plan-card chat-creation-card chat-change-card" data-change-set-id={changeSet.changeSetId}>
      <header className="chat-creation-head">
        <div>
          <span className="chat-creation-kicker">{t("chat.change.kicker")}</span>
          <h4>{changeSet.summary}</h4>
          <span className="chat-plan-card-summary">{changeSetHead(changeSet)}</span>
        </div>
      </header>

      {days.length ? (
        <ol className="chat-change-days" aria-label={t("chat.change.daysAria")}>
          {days.map((day) => (
            <li key={day.day}>
              <b>{changeDayLabel(day.day)}</b>
              {day.marks.map((mark, index) => (
                <span key={index} className="chat-change-mark" data-kind={mark.kind}>
                  {mark.name}
                </span>
              ))}
            </li>
          ))}
        </ol>
      ) : null}

      {groups.map((group) =>
        group.lines.length ? (
          group.folded ? (
            <details key={group.title} className="chat-change-group chat-change-done">
              <summary>
                <span className="chat-creation-kicker">{group.title}</span>
                <span>{doneText}</span>
              </summary>
              {renderLines(group.lines)}
            </details>
          ) : (
            <section key={group.title} className="chat-change-group" aria-label={group.title}>
              {groups.filter((item) => item.lines.length).length > 1 ? (
                <span className="chat-creation-kicker">{group.title}</span>
              ) : null}
              {renderLines(group.lines)}
            </section>
          )
        ) : null
      )}

      {open.length > 1 && (onApply || onDismiss) ? (
        <div className="chat-plan-actions">
          {onApply ? (
            <button type="button" className="chat-plan-upload" disabled={busy} onClick={() => onApply()}>
              {busyLine === "*" ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : null}
              {t("chat.change.applyAll", { n: open.length })}
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="chat-plan-review" disabled={busy} onClick={() => onDismiss()}>
              {t("chat.change.dismissAll")}
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
    <li className="chat-change-line" data-status={line.status} data-op={line.op} data-line-id={line.lineId}>
      <div className="chat-change-line-text">
        <span className="chat-change-line-label">{changeLineLabel(line)}</span>
        {line.status !== "proposed" ? (
          <span className="chat-change-line-status">
            {lineStatusLabel(line)}
            {line.reason ? ` — ${changeLineReason(line)}` : ""}
          </span>
        ) : null}
      </div>
      {line.status === "failed" && line.retry !== false && canApply(line) && onApply ? (
        <div className="chat-change-line-actions">
          <button type="button" className="chat-change-dismiss" disabled={disabled} onClick={onApply}>
            {busy ? <Loader2 className="chat-spinner" size={12} aria-hidden="true" /> : null}
            {t("chat.change.tryAgain")}
          </button>
        </div>
      ) : null}
      {line.status === "proposed" && canApply(line) && (onApply || onDismiss) ? (
        <div className="chat-change-line-actions">
          {onApply ? (
            <button
              type="button"
              className={destructive ? "chat-change-apply is-destructive" : "chat-change-apply"}
              disabled={disabled}
              onClick={onApply}
            >
              {busy ? <Loader2 className="chat-spinner" size={12} aria-hidden="true" /> : null}
              {line.op === "remove"
                ? t("chat.canvas.remove")
                : line.op === "deleteWorkout"
                  ? t("chat.row.delete")
                  : t("chat.change.apply")}
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="chat-change-dismiss" disabled={disabled} onClick={onDismiss}>
              {t("chat.change.dismiss")}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
