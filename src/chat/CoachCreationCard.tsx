import { CircleCheck, Maximize2 } from "lucide-react";
import type {
  PlanDraftPreview,
  PlanDraftSaveOptions,
  TrainingPlanDestination,
  TrainingPlanDocument,
  UploadPlanResult,
  WorkoutSport
} from "../../electron/types";
import { mondayOf, parsePlanDay, formatPlanDay } from "../../electron/trainingPlanDomain";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import {
  RIDGE_UNITS,
  formatRidgeValue,
  readPlan,
  ridgeMeasure,
  weekRidgeValues,
  type PlanReaderWeek
} from "../training-library/planReaderModel";
import { PlanWeekRidge } from "../training-library/PlanWeekRidge";
import { sportChipStyle } from "../training-library/sportTheme";
import { CreationActions } from "./CreationActions";
import type { CreationCalendar } from "./creationCalendar";
import { creationStatus } from "./creationChoices";

export interface CreationFigures {
  weeks: number;
  /** "4–5", or "4" when every week holds the same. */
  sessionsPerWeek: string;
  /** "6.5 hr", "180 load" or "5 sessions" — whatever every week states. */
  peakWeek: string;
  sports: string;
  reading: PlanReaderWeek[];
  /** The first week with a session in it, for the strip under the ridge. */
  firstWeek?: PlanReaderWeek;
}

/**
 * A plan whose every session is dated, read as starting on the Monday of its
 * first date, so a drawing names the days it will fall on. The date is only
 * for the drawing: a plan has no start date of its own.
 */
export function datedForReading(document: TrainingPlanDocument): TrainingPlanDocument {
  const dated = document.entries
    .map((entry) => parsePlanDay(entry.workout.schedule_date))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.valueOf() - right.valueOf());
  return dated.length === document.entries.length && dated[0]
    ? { ...document, startDate: formatPlanDay(mondayOf(dated[0]), true) }
    : document;
}

/**
 * The card's figures, read off the plan document the draft becomes — the same
 * `readPlan` the Library's reader draws from, so a plan's weeks, days and
 * peak cannot say one thing here and another there.
 *
 * A plan whose sessions are dated is read as starting on the Monday of its
 * first date, so the strip names the days it will actually fall on. That date
 * is only for the drawing: a plan has no start date of its own.
 */
export function creationFigures(document: TrainingPlanDocument): CreationFigures {
  const weeks = readPlan(datedForReading(document)).weeks;
  const busy = weeks.filter((week) => week.summary.workouts > 0);
  const counts = busy.map((week) => week.summary.workouts);
  const low = counts.length ? Math.min(...counts) : 0;
  const high = counts.length ? Math.max(...counts) : 0;
  const measure = ridgeMeasure(weeks);
  const peak = Math.max(0, ...weekRidgeValues(weeks, measure));
  const sports = [
    ...new Set(document.entries.map((entry) => (entry.workout.sport ?? "run") as WorkoutSport))
  ];
  return {
    weeks: weeks.length,
    sessionsPerWeek: low === high ? `${high}` : `${low}–${high}`,
    peakWeek: `${formatRidgeValue(peak, measure)} ${RIDGE_UNITS[measure]}`,
    sports: sports.map((sport) => formatWorkoutSport(sport)).join(", "),
    reading: weeks,
    firstWeek: busy[0]
  };
}

function WeekStrip({ week }: { week: PlanReaderWeek }) {
  return (
    <div className="chat-creation-week">
      <span className="chat-creation-week-label">Week {week.weekIndex + 1}</span>
      <ol className="chat-creation-days">
        {week.days.map((day) => (
          <li key={day.dayIndex} className={day.entries.length ? "" : "is-rest"}>
            <b>{day.label}</b>
            {day.entries.length ? (
              day.entries.map((entry) => (
                <span key={entry.id} style={sportChipStyle(entry.sport)}>
                  {entry.title}
                </span>
              ))
            ) : (
              <span>Rest</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A coach's plan or workout, under the answer that proposed it — read-only,
 * with the way to save it and a way into the full view. Editing is never done
 * here: Edit opens the plan editor (docs/coach-plan-canvas.md, D10).
 *
 * One copy at every window width. The card used to be drawn inline only when
 * the window was too narrow for the creations panel, and the width test that
 * chose also decided whether the panel's button existed.
 */
export function CoachCreationCard({
  draft,
  version,
  document,
  uploading,
  uploaded,
  onUpload,
  onEdit,
  editing = false,
  onCoros = false,
  calendar,
  onCalendar,
  onOpen
}: {
  draft: PlanDraftPreview;
  /** Which version of its creation this is; shown from the second on. */
  version?: number;
  /** The plan the draft becomes; absent while it loads, or for a workout. */
  document?: TrainingPlanDocument;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: (
    destination: TrainingPlanDestination,
    scheduleDate?: string,
    keepInLibrary?: boolean,
    options?: PlanDraftSaveOptions
  ) => void;
  onEdit?: () => void;
  /** Its editor is open: the way on is back into it. */
  editing?: boolean;
  /** Another version of it is a COROS plan, which saving this one updates. */
  onCoros?: boolean;
  /** Where the plan stands on the calendar, when COROS is running it (P1.6). */
  calendar?: CreationCalendar;
  /** Opens the calendar dialog for this version. */
  onCalendar?: () => void;
  onOpen: () => void;
}) {
  const isWorkout = draft.artifactType === "workout";
  const status = creationStatus(
    uploaded && !draft.uploadResult
      ? {
          ...draft,
          uploadResult: {
            workoutsScheduled: uploaded.workoutsScheduled,
            workoutsCreated: uploaded.workoutsCreated,
            destination: uploaded.destination
          }
        }
      : draft,
    onCoros
  );
  const figures = !isWorkout && document ? creationFigures(document) : undefined;
  const entry = draft.entries[0];
  // The line says what the figures below cannot: when a dated plan runs. For
  // an undated one it would repeat them, so it stands in only until they load.
  const dated = draft.entries.length > 0 && draft.entries.every((item) => item.scheduleDate);
  const showSummary = !figures || dated;

  return (
    <article className="chat-plan-card chat-creation-card" data-draft-id={draft.draftId}>
      <header className="chat-creation-head">
        <div>
          <span className="chat-creation-kicker">
            {isWorkout ? "Workout" : "Training plan"}
            {version && version > 1 ? ` · v${version}` : ""}
          </span>
          <h4>{draft.name}</h4>
          {showSummary ? (
            <span className="chat-plan-card-summary">{draft.summary}</span>
          ) : null}
        </div>
        <div className="chat-creation-head-aside">
          <span className="chat-creation-status" data-saved={status.saved ? "true" : "false"}>
            {calendar?.running && status.saved ? "On calendar" : status.label}
          </span>
          <button
            type="button"
            className="chat-creation-open"
            onClick={onOpen}
            aria-label={`Open ${draft.name}`}
            title="Open"
          >
            <Maximize2 size={13} aria-hidden="true" />
            Open
          </button>
        </div>
      </header>

      {figures ? (
        <dl className="chat-creation-figures">
          <div>
            <dt>Weeks</dt>
            <dd>{figures.weeks}</dd>
          </div>
          <div>
            <dt>Sessions a week</dt>
            <dd>{figures.sessionsPerWeek}</dd>
          </div>
          <div>
            <dt>Peak week</dt>
            <dd>{figures.peakWeek}</dd>
          </div>
          <div>
            <dt>Sports</dt>
            <dd title={figures.sports}>{figures.sports}</dd>
          </div>
        </dl>
      ) : null}

      {figures && figures.reading.length > 2 ? (
        <PlanWeekRidge weeks={figures.reading} onJump={() => onOpen()} />
      ) : null}
      {figures?.firstWeek ? <WeekStrip week={figures.firstWeek} /> : null}

      {isWorkout && entry?.stepsSummary ? (
        <p className="chat-creation-steps">{entry.stepsSummary}</p>
      ) : null}

      {status.saved ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {calendar?.running && status.saved
              ? `On your COROS calendar${calendar.line ? ` · ${calendar.line}` : ""}.`
              : status.label === "On COROS"
              ? `Saved to your COROS plans as “${draft.name}”.`
              : status.label === "In library"
                ? "Saved to your COROS Workout Library."
                : `${status.label}.`}
          </span>
        </p>
      ) : null}
      <CreationActions
        draft={
          status.saved && !draft.uploadResult && uploaded
            ? { ...draft, uploadedAt: draft.uploadedAt ?? 1 }
            : draft
        }
        uploading={uploading}
        onUpload={onUpload}
        onEdit={onEdit}
        editing={editing}
        onCoros={onCoros || (status.saved && status.label === "On COROS")}
        onCalendar={onCalendar}
        onCalendarNow={calendar?.running ?? false}
      />

    </article>
  );
}
