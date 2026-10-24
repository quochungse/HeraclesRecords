import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type RefObject
} from "react";
import type {
  TrainingHubActivity,
  TrainingHubSportType,
  UnitSystem
} from "../../../electron/types";
import {
  activityWeekHeading,
  groupActivitiesByWeek
} from "../activityFilters";
import { activityRowFacts } from "../activityFacts";
import { epochMsFromCorosTime } from "../activityWindow";
import { formatDurationSpan, formatTrainingTimestamp } from "../formatters";
import { resolveSportName } from "../sportTypes";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { useI18n } from "../../i18n/useI18n";
import { getIntlLocale, plural, t } from "../../i18n/core";
import { ActivitySportBadge } from "./ActivitySportBadge";

interface ActivityJournalListProps {
  activities: TrainingHubActivity[];
  sportTypes: TrainingHubSportType[];
  selectedActivityId: string | null;
  busy: string | null;
  /** Clock pinned by the caller, so headings cannot drift mid-render. */
  nowMs: number;
  onLoadDetail: (activity: TrainingHubActivity) => void;
}

/**
 * One formatter per language, kept: a list of two hundred rows built one each
 * on every render, and a selection re-renders the list.
 */
let dayFormat: { locale: string; format: Intl.DateTimeFormat } | null = null;

/**
 * "Fri 23", "ven. 23", "23日(金)": each language's own order — except English,
 * where Intl writes "23 Fri", a pairing no English reader writes.
 */
function weekdayAndDay(at: number): string {
  const locale = getIntlLocale();
  if (dayFormat?.locale !== locale) {
    dayFormat = {
      locale,
      format: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" })
    };
  }
  const parts = dayFormat.format.formatToParts(at);
  if (locale.toLowerCase().startsWith("en")) {
    const weekday = parts.find((part) => part.type === "weekday")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (weekday && day) {
      return `${weekday} ${day}`;
    }
  }
  return parts.map((part) => part.value).join("");
}

/**
 * "Fri 23" at the end of the name line, with the clock time on hover.
 *
 * It used to be a block of its own down the row's left edge — weekday, date
 * and time stacked in a grey well — which cost every row 54px of a narrow
 * column, the second session of a day included, where it said the same thing
 * again. At the end of the name it takes only the width it needs, on the one
 * line that has room to spare.
 */
function RowDate({ startTime }: { startTime?: number }) {
  const at = epochMsFromCorosTime(startTime);
  if (at === undefined) {
    return null;
  }

  return (
    <span className="activity-row-date" title={formatTrainingTimestamp(startTime)}>
      {weekdayAndDay(at)}
    </span>
  );
}

interface ActivityRowProps {
  activity: TrainingHubActivity;
  sportName: string | undefined;
  selected: boolean;
  loading: boolean;
  unitSystem: UnitSystem;
  /** Only to redraw a row's words when the language changes. */
  locale: string;
  buttonRef: RefObject<HTMLButtonElement | null> | undefined;
  onOpen: (activity: TrainingHubActivity) => void;
}

/**
 * One session. Memoised, because choosing a session re-renders the list and
 * only the two rows whose selection changed have anything new to draw; the
 * rest were formatting their figures and dates again for nothing.
 */
const ActivityRow = memo(function ActivityRow({
  activity,
  sportName,
  selected,
  loading,
  unitSystem,
  buttonRef,
  onOpen
}: ActivityRowProps) {
  const activityName =
    activity.name?.trim() || sportName || t("activity.untitled");
  const facts = activityRowFacts(activity, unitSystem);

  return (
    <li
      className={`activity-row${selected ? " is-selected" : ""}${
        loading ? " is-loading" : ""
      }`}
    >
      <button
        type="button"
        ref={buttonRef}
        className="activity-row-open"
        data-activity-id={activity.activityId}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(activity)}
      >
        {/*
          * The sport on the name's own line, ahead of it, and the figures on
          * the line below from the row's edge: the icon takes no column of its
          * own down the list.
          */}
        <ActivitySportBadge sportType={activity.sportType} label={sportName} />
        <span className="activity-row-title">
          <strong title={activityName}>{activityName}</strong>
          <RowDate startTime={activity.startTime} />
        </span>
        <span className="activity-row-facts">
          {facts.map((fact) => (
            <span key={fact.key} title={fact.title}>
              {fact.value}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
});

/**
 * The athlete's history as a journal: one row per session, grouped by the week
 * it happened in.
 *
 * It replaced a four-column `<table>` whose widest column was the export
 * button. A table wants every row to answer the same questions, and these rows
 * do not: a strength session has no distance and a bike ride has no pace, so
 * the old `Dist` column read "0 km" down half the screen. Each row now carries
 * the figures its own sport is read by — all of them already on the list
 * payload, none of them costing a request.
 *
 * The row is one button and nothing else. Export used to hang off every row,
 * a column of download icons for the rarest action on the screen; it lives in
 * the detail pane's header now, beside the session it exports.
 *
 * The sport is its icon in its colour on a grey disc, ahead of the name,
 * rather than its name in a coloured capitals chip: a chip on every row in one
 * of five colours made the list a rainbow, and so did the same icons on discs
 * washed in their sports' hues. The name it spelled out is on the pane. The
 * figures are three, on one line — a fourth and a fifth wrapped the line in a
 * column this narrow, and the pane beside it carries every one of them. How
 * the session felt is the pane's too: a coloured face on every rated row was
 * one more hue in a list already wearing five.
 */
export function ActivityJournalList({
  activities,
  sportTypes,
  selectedActivityId,
  busy,
  nowMs,
  onLoadDetail
}: ActivityJournalListProps) {
  const { unitSystem } = useUnitSystem();
  const { locale } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const sportTypeMap = useMemo(
    () => new Map(sportTypes.map((item) => [item.sportType, item.sportName])),
    [sportTypes]
  );

  const groups = useMemo(() => groupActivitiesByWeek(activities), [activities]);

  // The pane is the full history and the selection can come from outside it —
  // the screen opens on the newest activity — so the chosen row is scrolled to
  // rather than left for the athlete to find. The row's `scroll-margin-top`
  // keeps it clear of the week heading stuck over the list.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedActivityId]);

  /**
   * Arrow keys walk the rows the way they walk any list of documents. The move
   * both selects and focuses: a selection the eye can see but the keyboard has
   * left behind makes the next press jump back to where it started.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) {
      return;
    }

    event.preventDefault();
    const order = groups.flatMap((group) => group.activities);
    const current = order.findIndex(
      (activity) => activity.activityId === selectedActivityId
    );
    const next = order[Math.min(order.length - 1, Math.max(0, current + step))];
    if (!next || next.activityId === selectedActivityId) {
      return;
    }

    onLoadDetail(next);
    listRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-activity-id="${CSS.escape(next.activityId)}"]`
      )
      ?.focus();
  }

  return (
    <div
      className="activity-journal"
      ref={listRef}
      onKeyDown={handleKeyDown}
    >
      {groups.map((group) => (
        <section
          className="activity-journal-week"
          key={group.weekStartMs ?? "undated"}
        >
          <h3 className="activity-journal-week-head">
            <span>{activityWeekHeading(group.weekStartMs, nowMs)}</span>
            <span className="activity-journal-week-facts">
              <span>
                {plural("activity.sessions", group.count)}
              </span>
              {group.duration > 0 ? (
                <span>{formatDurationSpan(group.duration)}</span>
              ) : null}
            </span>
          </h3>

          <ul>
            {group.activities.map((activity) => {
              const selected = selectedActivityId === activity.activityId;
              return (
                <ActivityRow
                  key={activity.activityId}
                  activity={activity}
                  sportName={resolveSportName(activity, sportTypeMap)}
                  selected={selected}
                  loading={busy === `training-detail:${activity.activityId}`}
                  unitSystem={unitSystem}
                  locale={locale}
                  buttonRef={selected ? selectedRef : undefined}
                  onOpen={onLoadDetail}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
