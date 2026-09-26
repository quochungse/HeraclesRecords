/**
 * One session of a plan, opened.
 *
 * The reader's row says what a session asks for in one line — a name, a
 * distance, "3 steps". What it cannot say is *which* three: the warm-up's
 * heart-rate band, the five strides and the jog between them. That is the
 * thing an athlete opens a session to find out, and the plan already holds it
 * (`entry.workout.steps`), so this draws it without asking COROS for anything.
 *
 * **The body is the workout view the Workouts tab and the Calendar draw**
 * (`WorkoutReadOnlyBody`), fed a draft converted from the plan's own step
 * list. A third renderer for the same steps is the drift that component
 * exists to prevent. What a plan session has and a library workout does not —
 * a place in a week and an outcome — rides in the hero's slots and in the
 * block under it.
 *
 * It opens inside the reader rather than over it: a second dialog on the
 * first is two scrims and two Escapes, and the thing a reader does next is
 * the next session, which is a button here rather than a trip back.
 */
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  ListChecks
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  TrainingPlanEntry,
  UnitSystem,
  WorkoutEditorContext
} from "../../electron/types";
import { planWorkoutInputToEditorDraft } from "../../electron/planWorkoutEditor";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import type { CorosLinkApi } from "../coroslink-api";
import { WorkoutReadOnlyBody } from "../calendar/WorkoutEditorModal";
import { useWorkoutExerciseCatalog } from "../calendar/useWorkoutExerciseCatalog";
import { formatDurationSeconds, formatHappenDayLabel } from "../training/formatters";
import { formatDistanceValue } from "../units/units";
import {
  formatPlannedDuration,
  statusLabel,
  statusTone,
  type PlanSessionRef
} from "./planReaderModel";
import { sportChipStyle, sportTheme } from "./sportTheme";

interface PlanSessionViewProps {
  session: PlanSessionRef;
  /** The stored entry, for its step list — the facts carry only the figures. */
  entry: TrainingPlanEntry | undefined;
  planName: string;
  position: { index: number; of: number };
  unitSystem: UnitSystem;
  api?: CorosLinkApi;
  /** Leaves the library for the activity this session became. */
  onOpenActivity?: (activityId: string) => void;
  /** Absent where the session is the whole of what is shown — a one-off workout. */
  onBack?: () => void;
  onStep: (direction: -1 | 1) => void;
}

/**
 * The two fields `WorkoutReadOnlyBody` reads off a context are the pool length
 * and the climbing grade system, and both are only a fallback for a draft that
 * does not state its own. Everything else here is never read, so a session
 * that states both — or is neither a swim nor a climb — needs no COROS round
 * trip to be drawn.
 */
const LOCAL_CONTEXT: WorkoutEditorContext = {
  distanceUnit: "metric",
  paceUnit: "km",
  heartRateBasis: "maxHr",
  zones: {},
  lthrZones: [],
  defaultPoolLength: { value: 25, unit: "m" },
  climbSystems: {}
};

function needsAccountContext(entry: TrainingPlanEntry | undefined): boolean {
  const workout = entry?.workout;
  if (!workout) return false;
  if (workout.sport === "swim") return !workout.sport_options?.poolLength;
  if (workout.sport === "indoorClimb" || workout.sport === "bouldering") {
    return !workout.sport_options?.gradingSystem;
  }
  return false;
}

/** `2026-09-15` or COROS's `20260915`, as the day it names. */
function dayLabel(value: string): string {
  return formatHappenDayLabel(value.replace(/-/g, ""));
}

export function PlanSessionView({
  session,
  entry,
  planName,
  position,
  unitSystem,
  api,
  onOpenActivity,
  onBack,
  onStep
}: PlanSessionViewProps) {
  const facts = session.entry;
  const workout = entry?.workout;
  const hasStructure = Boolean(workout?.steps?.length || workout?.distance_km);
  const draft = useMemo(
    () => (workout && hasStructure ? planWorkoutInputToEditorDraft(workout) : undefined),
    [hasStructure, workout]
  );
  const { byId: exercises } = useWorkoutExerciseCatalog(api, workout?.sport);

  const [context, setContext] = useState<WorkoutEditorContext>(LOCAL_CONTEXT);
  const wantsContext = needsAccountContext(entry);
  useEffect(() => {
    if (!wantsContext || !api) return;
    let live = true;
    void api
      .getWorkoutEditorContext(unitSystem)
      .then((next) => {
        if (live) setContext(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, unitSystem, wantsContext]);

  const tone = statusTone(facts.status);
  const label = statusLabel(facts.status);
  const where = [
    `Week ${session.weekIndex + 1}`,
    session.stage,
    session.dayLabel
  ].filter(Boolean);

  const statusChip =
    label && tone ? (
      <em className="plan-entry-status" data-tone={tone}>
        {label}
      </em>
    ) : null;

  /*
   * Where the session sits in the plan, and — on a plan running on the
   * calendar — the day COROS has it on. The two cannot drift: moving the
   * session on the calendar moves it in the running copy too.
   */
  const placement = (
    <p className="plan-session-where">
      <span>{where.join(" · ")}</span>
      {facts.scheduledDate ? (
        <span className="plan-session-scheduled">
          <CalendarCheck size={12} aria-hidden="true" />
          On the COROS calendar {dayLabel(facts.scheduledDate)}
        </span>
      ) : null}
    </p>
  );

  /*
   * Planned beside done, one line per figure the session states. Only figures
   * both sides could have: a planned distance with no recorded one is left to
   * say what was asked, and a recorded load against no planned load has
   * nothing to be compared with.
   */
  const outcome = facts.outcome;
  const plannedDuration = facts.durationComplete ? facts.durationSeconds : 0;
  const comparison = outcome
    ? [
        {
          label: "Duration",
          planned: plannedDuration ? formatPlannedDuration(plannedDuration) : null,
          done: outcome.durationSeconds ? formatDurationSeconds(outcome.durationSeconds) : null
        },
        {
          label: "Distance",
          planned: facts.distanceMeters
            ? formatDistanceValue(facts.distanceMeters, unitSystem, { digits: 1 })
            : null,
          done: outcome.distanceMeters
            ? formatDistanceValue(outcome.distanceMeters, unitSystem, { digits: 1 })
            : null
        },
        {
          label: "Load",
          planned: facts.trainingLoad ? String(Math.round(facts.trainingLoad)) : null,
          done: outcome.trainingLoad ? String(Math.round(outcome.trainingLoad)) : null
        }
      ].filter((row) => row.done)
    : [];

  const Icon = sportTheme(facts.sport).icon;

  return (
    <div className="plan-session" aria-label={`${facts.title}, ${where.join(", ")}`}>
      {onBack || position.of > 1 ? (
      <header className="plan-reader-head plan-session-head">
        {onBack ? (
          <button type="button" className="ghost-button plan-session-back" onClick={onBack}>
            <ArrowLeft size={14} /> <span>{planName}</span>
          </button>
        ) : null}
        <div className="plan-session-pager">
          <span aria-live="polite">
            Session {position.index + 1} of {position.of}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Previous session"
            disabled={position.index === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next session"
            disabled={position.index >= position.of - 1}
            onClick={() => onStep(1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </header>
      ) : null}

      {draft ? (
        <WorkoutReadOnlyBody
          draft={draft}
          context={context}
          exercisesById={exercises}
          title={facts.title}
          subtitleAside={statusChip}
          heroFooter={placement}
        />
      ) : (
        /*
         * No steps to draw. A COROS plan often arrives like this — its list
         * endpoint names each session and leaves the program out — and a
         * hand-written session can state a target with nothing behind it.
         * Either way the page says what the plan does state, rather than an
         * empty structure box.
         */
        <div className="sched-detail workout-view plan-session-bare">
          <div className="sched-hero">
            <div className="sched-hero-top">
              <span className="sched-hero-icon" aria-hidden="true" style={sportChipStyle(facts.sport)}>
                <Icon size={20} />
              </span>
              <div className="sched-hero-title">
                <div className="sched-hero-heading">
                  <h2 className="sched-hero-name">{facts.title}</h2>
                </div>
                <span className="sched-hero-context">
                  <b>{facts.sport ? formatWorkoutSport(facts.sport) : "Workout"}</b>
                  {statusChip}
                </span>
              </div>
            </div>
            <PlannedFigures
              durationSeconds={plannedDuration}
              distanceMeters={facts.distanceMeters}
              trainingLoad={facts.trainingLoad}
              strengthSets={facts.strengthSets}
              unitSystem={unitSystem}
            />
            {placement}
          </div>
          <div className="sched-empty">
            <ListChecks size={18} aria-hidden="true" />
            <p>
              {entry?.idInPlan
                ? "COROS sent this session's name without its steps."
                : "This session has no step structure — only the targets above."}
            </p>
          </div>
        </div>
      )}

      {comparison.length ? (
        <section className="plan-session-outcome" aria-label="Planned and done">
          <header>
            <h3>
              Planned and done
              {outcome ? <small>{dayLabel(outcome.happenDay)}</small> : null}
            </h3>
            {/* The figures say how it compared; the activity says how it went —
                the route, the heart rate, the laps. */}
            {outcome?.activityId && onOpenActivity ? (
              <button
                type="button"
                className="ghost-button plan-session-activity"
                onClick={() => onOpenActivity(outcome.activityId!)}
              >
                Open activity <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            ) : null}
          </header>
          <dl>
            {comparison.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  {/* The planned figure only where the plan stated one: a dash
                      and an arrow into the real figure read as "from nothing". */}
                  {row.planned ? <span>{row.planned}</span> : null}
                  <b>{row.done}</b>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/** The figures a session without steps states, and only those. */
function PlannedFigures({
  durationSeconds,
  distanceMeters,
  trainingLoad,
  strengthSets,
  unitSystem
}: {
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
  strengthSets: number;
  unitSystem: UnitSystem;
}) {
  const stats = [
    durationSeconds ? { label: "Duration", value: formatPlannedDuration(durationSeconds) } : null,
    distanceMeters
      ? { label: "Distance", value: formatDistanceValue(distanceMeters, unitSystem, { digits: 1 }) }
      : null,
    trainingLoad ? { label: "Planned load", value: String(Math.round(trainingLoad)) } : null,
    strengthSets ? { label: "Sets", value: String(strengthSets) } : null
  ].filter((stat): stat is { label: string; value: string } => Boolean(stat?.value));

  if (!stats.length) return null;
  return (
    <dl className={`sched-hero-stats is-${stats.length}`}>
      {stats.map((stat) => (
        <div className="sched-stat" key={stat.label}>
          <dt className="sched-stat-label">{stat.label}</dt>
          <dd className="sched-stat-value">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
