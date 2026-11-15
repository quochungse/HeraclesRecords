import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import type { ScheduleChangeLine, ScheduleChangeSet, UnitSystem, WorkoutEditorContext } from "../../electron/types";
import { compareWorkoutInputs, comparisonLines, type CompareLine, type CompareOptions } from "../calendar/workoutCompare";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  canApply,
  changeDayLabel,
  changeLineLabel,
  changeLineReason,
  changeSetDays,
  changeSetHead,
  groupChangeLines,
  lineStatusLabel,
  lineViews,
  proposedLines,
  sincePreviousSummary,
  type LineSincePrevious,
  type SincePrevious
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
  onDismiss,
  onView,
  since,
  context
}: {
  changeSet: ScheduleChangeSet;
  /** What this proposal changes of the one before it (`changesSincePrevious`); absent when it revises none. */
  since?: SincePrevious;
  /** The account's context, for a session's distance and time before and after. */
  context?: WorkoutEditorContext;
  /** The line being applied, `"*"` for the whole set; the card waits while it runs. */
  busyLine?: string | null;
  /** Something else is being applied, or a turn is running. */
  disabled?: boolean;
  onApply?: (lineId?: string) => void;
  onDismiss?: (lineId?: string) => void;
  /** Opens a line on the session it acts on and the workout it would write. */
  onView?: (line: ScheduleChangeLine) => void;
}) {
  const { unitSystem } = useUnitSystem();
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
          since={since?.lines[line.lineId]}
          unitSystem={unitSystem}
          context={context}
          busy={busyLine === line.lineId || (busyLine === "*" && line.status === "proposed")}
          disabled={busy}
          onApply={onApply ? () => onApply(line.lineId) : undefined}
          onDismiss={onDismiss ? () => onDismiss(line.lineId) : undefined}
          onView={onView && lineViews(line).length ? () => onView(line) : undefined}
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
          {since ? (
            <span className="chat-plan-card-summary chat-change-since">
              {t("chat.change.prev.head", { parts: sincePreviousSummary(since.counts) })}
            </span>
          ) : null}
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

      {since?.dropped.length ? (
        <section className="chat-change-group chat-change-dropped" aria-label={t("chat.change.prev.dropped")}>
          <span className="chat-creation-kicker">{t("chat.change.prev.dropped")}</span>
          <ul className="chat-change-lines">
            {since.dropped.map((line) => (
              <li key={line.lineId} className="chat-change-gone">
                <span className="chat-change-line-label">{changeLineLabel(line)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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

const NO_LINES: CompareLine[] = [];

/** How many differences a line states before the rest wait in its details. */
const DIFF_ROWS = 3;

/** What a line changes of the session it acts on: the workout it would write against the one there. */
function lineDiff(line: ScheduleChangeLine, compare: CompareOptions): CompareLine[] {
  if (!line.before || !line.workout || (line.op !== "patch" && line.op !== "replace")) return [];
  const comparison = compareWorkoutInputs(line.before, line.workout, compare);
  return comparison ? comparisonLines(comparison) : [];
}

/** What a line changes of the earlier proposal's line for the same session. */
function previousDiff(line: ScheduleChangeLine, since: LineSincePrevious | undefined, compare: CompareOptions): CompareLine[] {
  const was = since?.mark === "changed" ? since.previous : undefined;
  if (!was) return [];
  // Another kind of change to the same session: the line says what it is now, so only what it was is added.
  if (was.op !== line.op) return [{ status: "removed", from: changeLineLabel(was) }];
  const lines: CompareLine[] = [];
  if (was.toDay && line.toDay && was.toDay !== line.toDay) {
    lines.push({ status: "changed", from: changeDayLabel(was.toDay), to: changeDayLabel(line.toDay) });
  }
  const comparison = was.workout && line.workout ? compareWorkoutInputs(was.workout, line.workout, compare) : undefined;
  return comparison ? [...lines, ...comparisonLines(comparison)] : lines;
}

function DiffRows({
  lines,
  caption,
  onMore
}: {
  lines: CompareLine[];
  caption: string;
  onMore?: () => void;
}) {
  if (!lines.length) return null;
  const more = lines.length - DIFF_ROWS;
  return (
    <div className="chat-change-diff">
      <span className="chat-creation-kicker">{caption}</span>
      <dl>
        {lines.slice(0, DIFF_ROWS).map((line, index) => (
          <div key={index} data-status={line.status}>
            {line.name ? <dt>{line.name}</dt> : null}
            <dd>
              {line.from ? <s>{line.from}</s> : null}
              {line.from && line.to ? <span aria-hidden="true">→</span> : null}
              {line.to ? <b>{line.to}</b> : null}
            </dd>
          </div>
        ))}
      </dl>
      {more > 0 ? (
        onMore ? (
          <button type="button" className="chat-change-diff-more" onClick={onMore}>
            {t("chat.change.diff.more", { count: more })}
          </button>
        ) : (
          <span className="chat-change-diff-more">{t("chat.change.diff.more", { count: more })}</span>
        )
      ) : null}
    </div>
  );
}

function ChangeLine({
  line,
  since,
  unitSystem,
  context,
  busy,
  disabled,
  onApply,
  onDismiss,
  onView
}: {
  line: ScheduleChangeLine;
  since?: LineSincePrevious;
  unitSystem: UnitSystem;
  context?: WorkoutEditorContext;
  busy: boolean;
  disabled: boolean;
  onApply?: () => void;
  onDismiss?: () => void;
  onView?: () => void;
}) {
  const destructive = line.op === "remove" || line.op === "deleteWorkout";
  // A line that came to nothing states no difference: nothing of it will be written.
  const live = line.status !== "dismissed" && line.status !== "stale";
  // The card is drawn again with every token of a turn; a comparison is worked out when its line changes.
  const [diff, revised] = useMemo(() => {
    const compare = { unitSystem, context };
    return live ? [lineDiff(line, compare), previousDiff(line, since, compare)] : [NO_LINES, NO_LINES];
  }, [live, line, since, unitSystem, context]);
  return (
    <li
      className="chat-change-line"
      data-status={line.status}
      data-op={line.op}
      data-line-id={line.lineId}
      data-since={live ? since?.mark : undefined}
    >
      <div className="chat-change-line-text">
        {/* The words are the way in, as a title is elsewhere: a separate
            Open button on every line would double the row's controls. */}
        {onView ? (
          <button
            type="button"
            className="chat-change-line-label chat-change-line-open"
            title={t("chat.change.viewDetails")}
            onClick={onView}
          >
            {changeLineLabel(line)}
          </button>
        ) : (
          <span className="chat-change-line-label">{changeLineLabel(line)}</span>
        )}
        {live && since ? (
          <span className="chat-change-since-mark" data-mark={since.mark}>
            {t(`chat.change.prev.mark.${since.mark}`)}
          </span>
        ) : null}
        <DiffRows
          lines={diff}
          caption={line.status === "applied" ? t("chat.change.diff.was") : t("chat.change.diff.now")}
          onMore={onView}
        />
        {/* The line's details set it against the calendar, not against the earlier proposal: no way in from here. */}
        <DiffRows lines={revised} caption={t("chat.change.diff.previous")} />
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
