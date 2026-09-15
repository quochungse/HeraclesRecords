import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubActivityFileType,
  TrainingHubSportType
} from "../../../electron/types";
import {
  activityWeekHeading,
  groupActivitiesByWeek
} from "../activityFilters";
import { activityRowFacts } from "../activityFacts";
import { epochMsFromCorosTime } from "../activityWindow";
import { formatDurationSpan } from "../formatters";
import { sportColorCategory } from "../sportColors";
import { resolveSportName } from "../sportTypes";
import { FEEL_LABELS, type ActivityFeelMap } from "../useActivityFeelTypes";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { ActivityExportMenu } from "./ActivityExportMenu";

interface ActivityJournalListProps {
  activities: TrainingHubActivity[];
  sportTypes: TrainingHubSportType[];
  selectedActivityId: string | null;
  busy: string | null;
  /** Clock pinned by the caller, so headings cannot drift mid-render. */
  nowMs: number;
  /** COROS's end-of-activity feeling, where this machine has read one. */
  feel: ActivityFeelMap;
  /**
   * Stored detail summaries by activity id. They arrive after the list does
   * and fill in as they are computed, so a row reads what it has rather than
   * holding the list back.
   */
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  onLoadDetail: (activity: TrainingHubActivity) => void;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

/** "Wed" over "12" — the block that lets a week be read down its left edge. */
function DateBlock({ startTime }: { startTime?: number }) {
  const at = epochMsFromCorosTime(startTime);

  if (at === undefined) {
    return (
      <span className="activity-row-date" aria-hidden="true">
        <em>—</em>
      </span>
    );
  }

  const date = new Date(at);
  return (
    <span className="activity-row-date" aria-hidden="true">
      <em>{date.toLocaleDateString(undefined, { weekday: "short" })}</em>
      <strong>{date.getDate()}</strong>
      <i>
        {date.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit"
        })}
      </i>
    </span>
  );
}

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
 * The row is one button with the actions beside it rather than inside it: a
 * button nested in a button is invalid, and the old table put the export menu
 * inside a `<tr role="button">`.
 */
export function ActivityJournalList({
  activities,
  sportTypes,
  selectedActivityId,
  busy,
  nowMs,
  feel,
  summaries,
  onLoadDetail,
  onExportFile
}: ActivityJournalListProps) {
  const { unitSystem } = useUnitSystem();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const sportTypeMap = useMemo(
    () => new Map(sportTypes.map((item) => [item.sportType, item.sportName])),
    [sportTypes]
  );

  const groups = useMemo(() => groupActivitiesByWeek(activities), [activities]);

  // The pane is the full history and the selection can come from outside it —
  // the screen opens on the newest activity — so the chosen row is scrolled to
  // rather than left for the athlete to find.
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
                {group.count} {group.count === 1 ? "session" : "sessions"}
              </span>
              {group.duration > 0 ? (
                <span>{formatDurationSpan(group.duration)}</span>
              ) : null}
            </span>
            {/*
             * The week's own mix, on the same scale as the summary's. A week
             * of five runs and a week of three runs and two lifts read as
             * different shapes before either heading is read.
             */}
            {group.duration > 0 ? (
              <span className="activity-journal-week-mix" aria-hidden="true">
                {group.sports.map((sport) => (
                  <i
                    key={sport.category}
                    data-sport={sport.category}
                    style={{ flexGrow: sport.duration / group.duration }}
                  />
                ))}
              </span>
            ) : null}
          </h3>

          <ul>
            {group.activities.map((activity) => {
              const sportName = resolveSportName(activity, sportTypeMap);
              const activityName =
                activity.name?.trim() || sportName || "Activity";
              const selected = selectedActivityId === activity.activityId;
              const loading = busy === `training-detail:${activity.activityId}`;
              const facts = activityRowFacts(
                activity,
                unitSystem,
                summaries.get(activity.activityId)
              );
              const rating = feel.rating.get(activity.activityId);

              return (
                <li
                  className={`activity-row${selected ? " is-selected" : ""}${
                    loading ? " is-loading" : ""
                  }`}
                  key={activity.activityId}
                >
                  <button
                    type="button"
                    ref={selected ? selectedRef : undefined}
                    className="activity-row-open"
                    data-activity-id={activity.activityId}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onLoadDetail(activity)}
                  >
                    <DateBlock startTime={activity.startTime} />
                    <span className="activity-row-main">
                      <span className="activity-row-title">
                        <strong title={activityName}>{activityName}</strong>
                        <span
                          className="sport-chip"
                          data-sport={sportColorCategory(activity.sportType)}
                        >
                          {sportName}
                        </span>
                        {/*
                          * How the session felt, as the athlete rated it in the
                          * COROS app. It is what every RPE figure in the app is
                          * built from and no screen showed it.
                          */}
                        {rating !== undefined ? (
                          <span
                            className="activity-row-feel"
                            data-feel={rating}
                            title={`Felt ${FEEL_LABELS[rating]?.toLowerCase() ?? rating}`}
                          >
                            {rating}
                          </span>
                        ) : null}
                      </span>
                      <span className="activity-row-facts">
                        {facts.map((fact) => (
                          <span key={fact.key} title={fact.title}>
                            {fact.value}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>

                  <div className="activity-row-actions">
                    <ActivityExportMenu
                      activity={activity}
                      activityName={activityName}
                      busy={busy}
                      onExportFile={onExportFile}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
