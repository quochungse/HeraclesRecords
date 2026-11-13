/**
 * One session of a plan, opened.
 *
 * The reader's row says what a session asks for in one line — a name, a
 * distance, "3 steps". What it cannot say is *which* three: the warm-up's
 * heart-rate band, the five strides and the jog between them. That is the
 * thing an athlete opens a session to find out, and the plan already holds it
 * (`entry.workout.steps`), so this draws it without asking COROS for it; the
 * account's thresholds (`useAthleteContext`, read once an hour) only turn its
 * heart-rate steps into a distance.
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
import { MentorIcon } from "../chat/mentorIcon";
import { useMemo } from "react";
import type {
  TrainingPlanEntry,
  UnitSystem,
  WorkoutEditorContext
} from "../../electron/types";
import { planWorkoutInputToEditorDraft } from "../../electron/planWorkoutEditor";
import { planEntryEstimate } from "../../electron/trainingPlanDomain";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { WorkoutReadOnlyBody } from "../calendar/WorkoutViewModal";
import { useWorkoutExerciseCatalog } from "../calendar/useWorkoutExerciseCatalog";
import { useAthleteContextRead } from "../calendar/useAthleteContext";
import { markFigure } from "../../electron/workoutFigures";
import { formatDurationSeconds, formatHappenDayLabel } from "../training/formatters";
import { formatDistanceValue } from "../units/units";
import {
  formatPlannedDuration,
  statusLabel,
  statusTone,
  type PlanSessionRef
} from "./planReaderModel";
import { sportChipStyle, sportTheme } from "./sportTheme";
import { workoutSportLabel } from "../training/workoutSport";
import { t } from "../i18n/core";

interface PlanSessionViewProps {
  session: PlanSessionRef;
  /** The stored entry, for its step list — the facts carry only the figures. */
  entry: TrainingPlanEntry | undefined;
  planName: string;
  position: { index: number; of: number };
  unitSystem: UnitSystem;
  api?: HeraclesRecordsApi;
  /** Leaves the library for the activity this session became. */
  onOpenActivity?: (activityId: string) => void;
  /** Opens Coach with this session beside the composer (P3.5); absent for a session COROS has no id for yet. */
  onAskCoach?: () => void;
  /** Absent where the session is the whole of what is shown — a one-off workout. */
  onBack?: () => void;
  /**
   * What the way back says; the plan's name by default. Coach's Workbench
   * names the plan right above the session, so it says where it goes instead.
   */
  backLabel?: string;
  onStep: (direction: -1 | 1) => void;
}

/**
 * What the session is drawn on until the account's context arrives: the pool
 * length and grade system a draft states nothing of, and no thresholds — so a
 * heart-rate step's distance waits for the account (`workoutFigures`).
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
  backLabel,
  onStep,
  onAskCoach
}: PlanSessionViewProps) {
  const facts = session.entry;
  const workout = entry?.workout;
  const hasStructure = Boolean(workout?.steps?.length || workout?.distance_km);
  const draft = useMemo(
    () => (workout && hasStructure ? planWorkoutInputToEditorDraft(workout) : undefined),
    [hasStructure, workout]
  );
  const { byId: exercises } = useWorkoutExerciseCatalog(api, workout?.sport);

  const athlete = useAthleteContextRead(api, unitSystem);
  const context = athlete.context ?? LOCAL_CONTEXT;

  const tone = statusTone(facts.status);
  const label = statusLabel(facts.status);
  const where = [
    t("library.session.week", { n: session.weekIndex + 1 }),
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
          {t("library.session.onCoros", { day: dayLabel(facts.scheduledDate) })}
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
  const plannedDuration = facts.durationPending ? 0 : facts.durationSeconds;
  const comparison = outcome
    ? [
        {
          label: t("library.session.duration"),
          planned: plannedDuration ? markFigure(formatPlannedDuration(plannedDuration) ?? "", facts.durationMark, "end") : null,
          done: outcome.durationSeconds ? formatDurationSeconds(outcome.durationSeconds) : null
        },
        {
          label: t("library.session.distance"),
          planned: facts.distanceMeters && !facts.distancePending
            ? markFigure(formatDistanceValue(facts.distanceMeters, unitSystem, { digits: 1 }), facts.distanceMark)
            : null,
          done: outcome.distanceMeters
            ? formatDistanceValue(outcome.distanceMeters, unitSystem, { digits: 1 })
            : null
        },
        {
          label: t("library.session.load"),
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
            <ArrowLeft size={14} /> <span>{backLabel ?? planName}</span>
          </button>
        ) : null}
        {onAskCoach ? (
          <button
            type="button"
            className="ghost-button plan-session-ask"
            title={t("library.session.askTitle")}
            onClick={onAskCoach}
          >
            <MentorIcon size={14} aria-hidden="true" /> <span>{t("activity.askCoach")}</span>
          </button>
        ) : null}
        <div className="plan-session-pager">
          <span aria-live="polite">
            {t("library.session.position", { n: position.index + 1, total: position.of })}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t("library.session.prev")}
            disabled={position.index === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("library.session.next")}
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
          contextPending={athlete.pending}
          exercisesById={exercises}
          estimate={entry ? planEntryEstimate(entry) : undefined}
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
                  <b>{facts.sport ? workoutSportLabel(facts.sport) : t("workout.untitled")}</b>
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
                ? t("library.session.noSteps")
                : t("library.session.noStructure")}
            </p>
          </div>
        </div>
      )}

      {comparison.length ? (
        <section className="plan-session-outcome" aria-label={t("library.session.plannedDone")}>
          <header>
            <h3>
              {t("library.session.plannedDone")}
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
                {t("library.session.openActivity")} <ArrowUpRight size={14} aria-hidden="true" />
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
    durationSeconds ? { label: t("library.session.duration"), value: formatPlannedDuration(durationSeconds) } : null,
    distanceMeters
      ? { label: t("library.session.distance"), value: formatDistanceValue(distanceMeters, unitSystem, { digits: 1 }) }
      : null,
    trainingLoad ? { label: t("library.session.plannedLoad"), value: String(Math.round(trainingLoad)) } : null,
    strengthSets ? { label: t("library.session.sets"), value: String(strengthSets) } : null
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
