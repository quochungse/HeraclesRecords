/**
 * A plan as something to read: weeks, the days inside them, and what each
 * session actually is.
 *
 * This is the answer to "a plan item is not a workout". A workout row says
 * sport, load and how often it has been used, because a workout is a thing
 * you own. A plan session says *when* — which week, which day, which date once
 * the plan is on the calendar — what it asks for, and, once it is there,
 * whether it happened. None of those four apply to a library workout, and none
 * of a workout's apply here.
 *
 * The per-session status is the payoff of the compliance join: the row says
 * "72%", and this says which sessions. A plan on the calendar is an instance
 * whose sessions COROS keys as `instance:idInPlan`, which is what a match
 * records too — so the join needs nothing of the app's own.
 *
 * Pure and outside the component for the reason `planFilters.ts` is.
 */
import type {
  RunWorkoutStepInput,
  TrainingActivityMatch,
  TrainingPlanDocument,
  TrainingPlanEntry,
  WorkoutSport
} from "../../electron/types";
import {
  COROS_WEEK_STAGES,
  planEntryMetrics,
  summarizeTrainingPlan,
  weekStageOf,
  type CorosWeekStageSlug,
  type TrainingPlanWeekSummary
} from "../../electron/trainingPlanDomain";
import { WORKOUT_SPORTS } from "../../electron/workoutCapabilities";

/** Where a planned session stands, once its plan is on the calendar. */
export type PlanEntryStatus = TrainingActivityMatch["status"];

export interface PlanEntryFacts {
  id: string;
  title: string;
  sport?: WorkoutSport;
  durationSeconds: number;
  /**
   * Whether `durationSeconds` is the whole session or only its timed steps.
   *
   * The figure is a sum of `target_duration_seconds`, so a run written as a
   * 1 km warm-up, 6.5 km easy and a 500 m cool-down comes to zero, and one with
   * five 90 s jogs between strides comes to nine minutes. Drawn beside "8 km"
   * that read as a nine-minute session, and summed over a 31 km week it read as
   * "0.1 hours". A duration is only stated when every step carries one.
   */
  durationComplete: boolean;
  distanceMeters: number;
  trainingLoad: number;
  strengthSets: number;
  /** How many steps the structure holds, a repeat's counted once; 0 when COROS served none. */
  stepCount: number;
  /**
   * What became of this session. `undefined` means the question does not
   * apply — the plan is not on the calendar — which is not the same as
   * "upcoming" and must not draw as a state.
   */
  status?: PlanEntryStatus;
  /** The calendar day COROS put this session on (yyyyMMdd), for a plan on the calendar. */
  scheduledDate?: string;
  /**
   * What the matched activity actually did, where the matcher recorded it.
   * Only figures it has: a strength session has no distance to report.
   */
  outcome?: PlanEntryOutcome;
}

export interface PlanEntryOutcome {
  activityId?: string;
  happenDay: string;
  durationSeconds?: number;
  distanceMeters?: number;
  trainingLoad?: number;
}

export interface PlanReaderDay {
  dayIndex: number;
  /** "Mon", or "Mon 2 Mar" for a plan on the calendar. */
  label: string;
  /** `YYYY-MM-DD`, only for a plan on the calendar. */
  date?: string;
  entries: PlanEntryFacts[];
}

export interface PlanReaderWeek {
  weekIndex: number;
  /** The week's COROS stage, when one is set. */
  stage?: string;
  /** What the stylesheet colours it by (`[data-stage]`). */
  stageSlug?: CorosWeekStageSlug;
  /**
   * How the week's scheduled sessions went, for the one line a folded week
   * is reduced to. `ahead` counts every tracked session not yet settled.
   */
  outcomes: { done: number; missed: number; ahead: number };
  summary: TrainingPlanWeekSummary;
  /** Every session this week states its whole duration — see `durationComplete`. */
  timed: boolean;
  days: PlanReaderDay[];
}

export interface PlanReading {
  weeks: PlanReaderWeek[];
  /** True once any entry has a status — i.e. the plan is on the calendar. */
  tracked: boolean;
  /** Every session in the plan states its whole duration. */
  timed: boolean;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Midday, not midnight: parsed as UTC, a date west of Greenwich reads as the day before. */
function planDate(startDate: string | undefined, dayOffset: number): Date | undefined {
  if (!startDate) return undefined;
  const date = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return undefined;
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function isoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The label of a week's stage, when one is set. */
export function stageForWeek(
  plan: Pick<TrainingPlanDocument, "weekStages">,
  weekIndex: number
): { label: string; slug: CorosWeekStageSlug } | undefined {
  const stage = weekStageOf(plan, weekIndex);
  const known = COROS_WEEK_STAGES.find((item) => item.value === stage);
  return stage && known ? { label: known.label, slug: known.slug } : undefined;
}

/**
 * Whether every step of a session names a duration. A session with no steps
 * is timed when the plan states a planned duration for it, which is the one
 * figure it has.
 */
function stepsAreTimed(steps: readonly RunWorkoutStepInput[]): boolean {
  return steps.every((node) =>
    "repeat" in node
      ? stepsAreTimed(node.steps)
      : (node.target_duration_seconds ?? 0) > 0
  );
}

function durationIsComplete(entry: TrainingPlanEntry, durationSeconds: number): boolean {
  if (!durationSeconds) return false;
  const steps = entry.workout.steps;
  return steps?.length ? stepsAreTimed(steps) : Boolean(entry.plannedDurationSeconds);
}

/**
 * Steps as the session view counts them: a repeat group's children once each,
 * the group itself not at all. Counting top-level nodes made a warm-up, five
 * strides and a cool-down "4 steps" on the row and "5 steps" one press later.
 */
function leafStepCount(steps: readonly RunWorkoutStepInput[]): number {
  return steps.reduce((total, node) => total + ("repeat" in node ? node.steps.length : 1), 0);
}

function outcomeOf(match: TrainingActivityMatch | undefined): PlanEntryOutcome | undefined {
  if (!match?.activityId) return undefined;
  return {
    activityId: match.activityId,
    happenDay: match.happenDay,
    ...(match.completedDurationSeconds ? { durationSeconds: match.completedDurationSeconds } : {}),
    ...(match.completedDistanceMeters ? { distanceMeters: match.completedDistanceMeters } : {}),
    ...(match.completedTrainingLoad ? { trainingLoad: match.completedTrainingLoad } : {})
  };
}

function entryFacts(
  plan: TrainingPlanDocument,
  entry: TrainingPlanEntry,
  matchByKey: Map<string, TrainingActivityMatch>
): PlanEntryFacts {
  const metrics = planEntryMetrics(entry);
  const onCalendar = plan.calendar !== "unscheduled" && plan.remoteId && entry.idInPlan;
  const match = onCalendar ? matchByKey.get(`${plan.remoteId}:${entry.idInPlan}`) : undefined;
  return {
    id: entry.id,
    title: entry.title.trim() || entry.workout.name.trim() || "Untitled session",
    sport: entry.workout.sport,
    durationSeconds: metrics.durationSeconds,
    durationComplete: durationIsComplete(entry, metrics.durationSeconds),
    distanceMeters: metrics.distanceMeters,
    trainingLoad: metrics.trainingLoad,
    strengthSets: metrics.strengthSets,
    stepCount: leafStepCount(entry.workout.steps ?? []),
    status: match?.status,
    scheduledDate: onCalendar ? entry.happenDay : undefined,
    outcome: outcomeOf(match)
  };
}

/**
 * The plan, week by week.
 *
 * Every week the plan declares gets a row even when it holds nothing — a gap
 * in a training block is a fact about the plan, and dropping empty weeks
 * renumbers everything after them.
 */
export function readPlan(
  plan: TrainingPlanDocument,
  matches: readonly TrainingActivityMatch[] = []
): PlanReading {
  const summary = summarizeTrainingPlan(plan);
  const matchByKey = new Map(
    matches.map((match) => [`${match.schedulePlanId}:${match.scheduleIdInPlan}`, match])
  );

  const ordered = [...plan.entries].sort((left, right) => left.sortOrder - right.sortOrder);
  let tracked = false;

  const weeks = Array.from({ length: plan.weekCount }, (_, weekIndex): PlanReaderWeek => {
    const inWeek = ordered.filter((entry) => entry.weekIndex === weekIndex);
    const days = DAY_NAMES.map((name, dayIndex): PlanReaderDay => {
      const date = planDate(plan.startDate, weekIndex * 7 + dayIndex);
      return {
        dayIndex,
        label: date
          ? `${name} ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
          : name,
        date: date ? isoDay(date) : undefined,
        entries: inWeek
          .filter((entry) => entry.dayIndex === dayIndex)
          .map((entry) => entryFacts(plan, entry, matchByKey))
      };
    });

    const all = days.flatMap((day) => day.entries);
    const outcomes = { done: 0, missed: 0, ahead: 0 };
    for (const facts of all) {
      if (facts.status) tracked = true;
      const tone = statusTone(facts.status);
      if (tone === "done") outcomes.done += 1;
      else if (tone === "missed") outcomes.missed += 1;
      else if (tone === "quiet") outcomes.ahead += 1;
    }
    const stage = stageForWeek(plan, weekIndex);

    return {
      weekIndex,
      ...(stage ? { stage: stage.label, stageSlug: stage.slug } : {}),
      outcomes,
      summary: summary.weekly[weekIndex] ?? {
        weekIndex,
        workouts: 0,
        durationSeconds: 0,
        distanceMeters: 0,
        trainingLoad: 0
      },
      timed: all.length > 0 && all.every((facts) => facts.durationComplete),
      days
    };
  });

  const populated = weeks.filter((week) => week.summary.workouts > 0);
  return {
    weeks,
    tracked,
    timed: populated.length > 0 && populated.every((week) => week.timed)
  };
}

/**
 * What a week ridge measures — the reader's and the editor's, and the tile's
 * small one: load, then hours, then a count of sessions — the first that every
 * week holding a session actually states.
 *
 * Load whenever *any* week had some drew the wrong chart: COROS prices only a
 * session with an intensity target (`/training/program/calculate`; the list
 * rows answer `0`), so a plan built from library workouts drew one bar for the
 * one week that held a priced session and a stub for every other week of
 * training. A bar the height of zero under a week of sessions is the chart
 * contradicting the plan. Hours come next because a library row carries
 * `estimatedTime` even where it carries no load.
 */
export type RidgeMeasure = "load" | "hours" | "sessions";

export const RIDGE_CAPTIONS: Readonly<Record<RidgeMeasure, string>> = {
  load: "Weekly load",
  hours: "Hours a week",
  sessions: "Sessions a week"
};

export const RIDGE_UNITS: Readonly<Record<RidgeMeasure, string>> = {
  load: "load",
  hours: "hr",
  sessions: "sessions"
};

export function formatRidgeValue(value: number, measure: RidgeMeasure): string {
  return measure === "hours" ? String(Math.round(value * 10) / 10) : String(Math.round(value));
}

function weekWorkouts(week: PlanReaderWeek): PlanEntryFacts[] {
  return week.days.flatMap((day) => day.entries);
}

export function ridgeMeasure(weeks: readonly PlanReaderWeek[]): RidgeMeasure {
  const busy = weeks.filter((week) => weekWorkouts(week).length > 0);
  if (!busy.length) return "sessions";
  if (busy.every((week) => week.summary.trainingLoad > 0)) return "load";
  if (busy.every((week) => week.timed && week.summary.durationSeconds > 0)) return "hours";
  return "sessions";
}

export interface RidgeSegment {
  sport?: WorkoutSport;
  value: number;
}

/**
 * A week's bar, split by sport, in one fixed sport order so a colour sits at
 * the same height of the stack from week to week. Sport is data, and the
 * sessions on the cards below are drawn in the same hues — a single accent
 * bar over green and red sessions read as some other quantity.
 */
export function weekRidgeSegments(week: PlanReaderWeek, measure: RidgeMeasure): RidgeSegment[] {
  const bySport = new Map<WorkoutSport | undefined, number>();
  for (const entry of weekWorkouts(week)) {
    const value =
      measure === "load"
        ? entry.trainingLoad
        : measure === "hours"
          ? entry.durationSeconds / 3600
          : 1;
    if (value > 0) bySport.set(entry.sport, (bySport.get(entry.sport) ?? 0) + value);
  }
  const rank = (sport: WorkoutSport | undefined) =>
    sport ? WORKOUT_SPORTS.indexOf(sport) : WORKOUT_SPORTS.length;
  return [...bySport.entries()]
    .map(([sport, value]) => ({ sport, value }))
    .sort((left, right) => rank(left.sport) - rank(right.sport));
}

/** Each week's bar under `measure`: its sport segments, summed. */
export function weekRidgeValues(weeks: readonly PlanReaderWeek[], measure: RidgeMeasure): number[] {
  return weeks.map((week) =>
    weekRidgeSegments(week, measure).reduce((sum, segment) => sum + segment.value, 0)
  );
}

/** "3 sessions · 4.5 hr · 180 load": the figures a week states, and no zeros. */
export function formatWeekLine(week: PlanReaderWeek): string {
  const load = Math.round(week.summary.trainingLoad);
  const hours = week.timed ? Math.round(week.summary.durationSeconds / 360) / 10 : 0;
  const count = week.summary.workouts;
  return [
    count === 1 ? "1 session" : `${count} sessions`,
    hours ? `${hours} hr` : "",
    load ? `${load} load` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One session, with the place in the plan the reader drew it at. */
export interface PlanSessionRef {
  entry: PlanEntryFacts;
  weekIndex: number;
  stage?: string;
  /** "Tue", or "Tue 15 Sep" on the calendar. */
  dayLabel: string;
  date?: string;
}

/**
 * The plan's sessions in reading order — week by week, day by day. It is the
 * order the session view steps through, so "next" is the next thing the
 * reader would have seen below.
 */
export function planSessions(reading: PlanReading): PlanSessionRef[] {
  return reading.weeks.flatMap((week) =>
    week.days.flatMap((day) =>
      day.entries.map((entry) => ({
        entry,
        weekIndex: week.weekIndex,
        stage: week.stage,
        dayLabel: day.label,
        date: day.date
      }))
    )
  );
}

/** `1:12` for an hour and twelve, `48m` under the hour, nothing at zero. */
export function formatPlannedDuration(seconds: number): string | null {
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}:${`${minutes % 60}`.padStart(2, "0")}`;
}

const STATUS_LABELS: Record<PlanEntryStatus, string> = {
  completed: "Done",
  partial: "Partial",
  missed: "Missed",
  skipped: "Skipped",
  rescheduled: "Moved",
  upcoming: "Ahead"
};

/** The word on a session's badge, or nothing when the question does not apply. */
export function statusLabel(status: PlanEntryStatus | undefined): string | null {
  return status ? STATUS_LABELS[status] : null;
}

/**
 * Which of the three ways a session can read.
 *
 * "Ahead" is deliberately quiet rather than positive: a session that has not
 * happened yet is not a success, and drawing it in the same green as a kept
 * one makes a plan look complete before it has started.
 */
export function statusTone(
  status: PlanEntryStatus | undefined
): "done" | "missed" | "quiet" | null {
  if (!status) return null;
  if (status === "completed" || status === "partial") return "done";
  if (status === "missed") return "missed";
  return "quiet";
}
