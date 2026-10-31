/**
 * Heracles Training Load, read once in the main process and carried on the
 * payloads the screens already receive (docs/heracles-training-load.md).
 *
 * Every figure is recomputed from what is stored — the cached breakdowns, the
 * strength activities' COROS load, the Hevy workouts, the body weight — and
 * never stored itself. One run scores every strength session oldest first and
 * is kept until any of those inputs moves.
 */

import {
  bodyWeightHistoryVersion,
  getSetting,
  heraclesLoadInputsVersion,
  listBodyWeights,
  listRunLoads,
  listStoredStrengthSessions,
  listStrengthActivityLoads,
  listStrengthActivitiesWithoutBreakdown,
  setSetting,
  type BodyWeightReading
} from "./database";
import { dayKey } from "./chatDayKeys";
import {
  estimatePlannedLoad,
  isCorosExerciseKey,
  runHeraclesLoads,
  type HeraclesLoadRun,
  type PlannedStrengthExercise,
  type PlannedStrengthSession
} from "./heraclesLoad";
import { HERACLES_FACTORS_VERSION } from "./heraclesLoadFactors";
import { heraclesDeltaSeries, type HeraclesDaySurplus } from "./heraclesFitness";
import { getStoredHevyStrengthSessions } from "./hevyService";
import { combineStrengthSessions } from "./strengthSessionMerge";
import { lastKnownCorosWeightKg } from "./trainingHubService";
import type {
  HeraclesDayDelta,
  HeraclesLoad,
  HeraclesLoadInfo,
  HeraclesRunEquivalent,
  HeraclesSessionLoad,
  PlanLoadEntry,
  RunWorkoutCreateStep,
  StrengthLoadSource,
  StrengthSession,
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledExercise
} from "./types";

export const STRENGTH_LOAD_SOURCE_SETTING = "strength.loadSource";
const STRENGTH_LOAD_SPORT_TYPES: ReadonlySet<number> = new Set([400, 402]);
/** As far back as a lift's capacity reaches. */
const HISTORY_DAYS = 3650;
const SECONDS_PER_DAY = 86_400;
/** A run set beside a strength session is from the eight weeks before it… */
const EQUIVALENT_WINDOW_DAYS = 56;
/** …and within this share of its load, or none is named. */
const EQUIVALENT_TOLERANCE = 0.15;

export interface HeraclesLoadDeps {
  /** Every cached strength session, COROS's and Hevy's. */
  strengthSessions(): StrengthSession[];
  /** Strength activities stored with no breakdown. */
  withoutBreakdown(): string[];
  /** COROS's strength activities, for the days Heracles adds to its fitness figures. */
  strengthActivities(): Pick<TrainingHubActivity, "activityId" | "sportType" | "startTime" | "trainingLoad">[];
  /** Runs with a COROS load, for the run a strength session is set beside; read when asked, never cached. */
  runs(): HeraclesRunEquivalent[];
  /** The weight of a session's day; `now()` for today's. */
  bodyWeightKg(startTime: number | undefined): number | undefined;
  /** Changes whenever anything the sessions are scored from does; running activities are not among it. */
  inputsVersion(): string;
  /** Epoch seconds. */
  now(): number;
}

/**
 * The weight of a session's day from the readings kept (oldest first): the
 * newest on or before it, else the first — a session older than every
 * reading is nearest the earliest one. Undefined with no reading at all.
 */
export function bodyWeightOn(readings: readonly BodyWeightReading[], startTime: number | undefined): number | undefined {
  if (!readings.length) return undefined;
  if (startTime === undefined) return readings[readings.length - 1]!.weightKg;
  const day = dayKey(new Date(startTime * 1000));
  let low = 0;
  let high = readings.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (readings[middle]!.day <= day) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return readings[Math.max(0, found)]!.weightKg;
}

export function createDefaultDeps(): HeraclesLoadDeps {
  const since = () => Math.floor(Date.now() / 1000) - HISTORY_DAYS * SECONDS_PER_DAY;
  // Read again only when the history moves, a sync's rows included: a run
  // asks for every session's weight.
  let weights: { version: string; readings: BodyWeightReading[] } | undefined;
  const readings = () => {
    const version = bodyWeightHistoryVersion();
    if (weights?.version !== version) weights = { version, readings: listBodyWeights() };
    return weights.readings;
  };
  return {
    strengthSessions: () =>
      combineStrengthSessions(listStoredStrengthSessions(since()), getStoredHevyStrengthSessions(HISTORY_DAYS)),
    withoutBreakdown: () => listStrengthActivitiesWithoutBreakdown(),
    strengthActivities: () => listStrengthActivityLoads(since()),
    runs: () => listRunLoads(since()),
    bodyWeightKg: (startTime) => bodyWeightOn(readings(), startTime) ?? lastKnownCorosWeightKg(),
    inputsVersion: () => heraclesLoadInputsVersion(),
    now: () => Math.floor(Date.now() / 1000)
  };
}

let defaultDeps: HeraclesLoadDeps | undefined;
function depsOrDefault(deps: HeraclesLoadDeps | undefined): HeraclesLoadDeps {
  if (deps) return deps;
  defaultDeps ??= createDefaultDeps();
  return defaultDeps;
}

interface HeraclesLoadSnapshot {
  version: string;
  run: HeraclesLoadRun;
  /** By every id a session goes by: its own, COROS's, Hevy's. */
  byId: Map<string, StrengthSession>;
  withoutBreakdown: ReadonlySet<string>;
  /** What Heracles adds to COROS's daily figures, worked out when first asked. */
  deltas?: Map<string, HeraclesDayDelta>;
}

const snapshots = new WeakMap<HeraclesLoadDeps, HeraclesLoadSnapshot>();

function snapshotFor(deps: HeraclesLoadDeps): HeraclesLoadSnapshot {
  const now = deps.now();
  const weight = deps.bodyWeightKg(now);
  // The day is part of it: the capacities' window moves daily.
  const version = [
    deps.inputsVersion(),
    weight ?? "",
    HERACLES_FACTORS_VERSION,
    Math.floor(now / SECONDS_PER_DAY)
  ].join("#");
  const cached = snapshots.get(deps);
  if (cached?.version === version) return cached;

  const sessions = deps.strengthSessions();
  const run = runHeraclesLoads(sessions, { bodyWeightKg: (startTime) => deps.bodyWeightKg(startTime) });
  const byId = new Map<string, StrengthSession>();
  for (const session of sessions) {
    byId.set(session.activityId, session);
    if (session.sourceIds?.coros) byId.set(session.sourceIds.coros, session);
    if (session.sourceIds?.hevy) byId.set(`hevy:${session.sourceIds.hevy}`, session);
  }
  const snapshot: HeraclesLoadSnapshot = {
    version,
    run,
    byId,
    withoutBreakdown: new Set(deps.withoutBreakdown())
  };
  snapshots.set(deps, snapshot);
  return snapshot;
}

/**
 * The run in the eight weeks before a session whose COROS load is closest to
 * the session's own; between two as close, the more recent.
 */
function runEquivalentFor(
  scored: HeraclesSessionLoad,
  startTime: number | undefined,
  runs: readonly HeraclesRunEquivalent[]
): HeraclesRunEquivalent | undefined {
  if (startTime === undefined || scored.value <= 0) return undefined;
  const since = startTime - EQUIVALENT_WINDOW_DAYS * SECONDS_PER_DAY;
  let best: HeraclesRunEquivalent | undefined;
  for (const run of runs) {
    const at = run.startTime ?? 0;
    if (at < since || at >= startTime) continue;
    const gap = Math.abs(run.trainingLoad - scored.value);
    if (gap > scored.value * EQUIVALENT_TOLERANCE) continue;
    const bestGap = best ? Math.abs(best.trainingLoad - scored.value) : Number.POSITIVE_INFINITY;
    if (gap < bestGap || (gap === bestGap && at > (best?.startTime ?? 0))) best = run;
  }
  return best;
}

export function getStrengthLoadSource(): StrengthLoadSource {
  return getSetting(STRENGTH_LOAD_SOURCE_SETTING) === "heracles" ? "heracles" : "coros";
}

export function setStrengthLoadSource(source: StrengthLoadSource): void {
  setSetting(STRENGTH_LOAD_SOURCE_SETTING, source === "heracles" ? "heracles" : "coros");
}

export function getHeraclesLoadInfo(): HeraclesLoadInfo {
  return { source: getStrengthLoadSource() };
}

/**
 * A strength activity's Heracles load; undefined for any other sport. A
 * strength session whose sets have not been read yet carries COROS's figure,
 * marked as pending; one COROS kept no sets for is gym cardio, and COROS's
 * heart-rate figure is what it is.
 */
export function heraclesLoadFor(
  activity: Pick<TrainingHubActivity, "activityId" | "sportType" | "trainingLoad">,
  deps?: HeraclesLoadDeps
): HeraclesLoad | undefined {
  if (!STRENGTH_LOAD_SPORT_TYPES.has(activity.sportType)) return undefined;
  return strengthLoadOf(activity, snapshotFor(depsOrDefault(deps)));
}

function strengthLoadOf(
  activity: Pick<TrainingHubActivity, "activityId" | "trainingLoad">,
  snapshot: HeraclesLoadSnapshot
): HeraclesLoad {
  const session = snapshot.byId.get(activity.activityId);
  const scored = session ? snapshot.run.sessions.get(session.activityId) : undefined;
  if (scored) {
    const { sets: _sets, sessionRpe: _rpe, ...load } = scored;
    return load;
  }
  const cardio = activity.trainingLoad;
  const quality = snapshot.withoutBreakdown.has(activity.activityId) ? "conditioning" : "pending";
  return {
    value: cardio ?? 0,
    ...(cardio !== undefined ? { cardio } : {}),
    muscular: 0,
    quality
  };
}

/** The list as COROS sent it, each strength session carrying its Heracles load. */
export function withHeraclesLoads<T extends TrainingHubActivity>(activities: T[], deps?: HeraclesLoadDeps): T[] {
  if (!activities.some((activity) => STRENGTH_LOAD_SPORT_TYPES.has(activity.sportType))) return activities;
  // One snapshot for the list: asking whether the inputs moved costs a query.
  const snapshot = snapshotFor(depsOrDefault(deps));
  return activities.map((activity) =>
    STRENGTH_LOAD_SPORT_TYPES.has(activity.sportType)
      ? { ...activity, heraclesLoad: strengthLoadOf(activity, snapshot) }
      : activity
  );
}

function sameShape(left: StrengthSession, right: StrengthSession): boolean {
  const a = left.detail.exercises;
  const b = right.detail.exercises;
  return a.length === b.length && a.every((exercise, index) => exercise.entries.length === b[index].entries.length);
}

/**
 * Strength sessions as a source selection returned them, each with its
 * Heracles load. The sets are scored on the session the run read — the
 * merged one when COROS and Hevy logged the same workout — and are carried
 * only when they line up with the session handed in.
 */
export function withStrengthSessionLoads(sessions: StrengthSession[], deps?: HeraclesLoadDeps): StrengthSession[] {
  if (sessions.length === 0) return sessions;
  const resolved = depsOrDefault(deps);
  const snapshot = snapshotFor(resolved);
  // Read here rather than kept with the scoring: a new run moves no strength session's load.
  let runs: HeraclesRunEquivalent[] | undefined;
  return sessions.map((session) => {
    const scoredSession =
      snapshot.byId.get(session.activityId) ??
      (session.sourceIds?.coros ? snapshot.byId.get(session.sourceIds.coros) : undefined) ??
      (session.sourceIds?.hevy ? snapshot.byId.get(`hevy:${session.sourceIds.hevy}`) : undefined);
    const scored = scoredSession ? snapshot.run.sessions.get(scoredSession.activityId) : undefined;
    if (!scored || !scoredSession) return session;
    const runEquivalent = scored.quality === "sets" || scored.quality === "estimate"
      ? runEquivalentFor(scored, session.startTime, (runs ??= resolved.runs()))
      : undefined;
    const withRun = runEquivalent ? { ...scored, runEquivalent } : scored;
    if (sameShape(scoredSession, session)) return { ...session, heracles: withRun };
    const { sets: _sets, ...withoutSets } = withRun;
    return { ...session, heracles: withoutSets };
  });
}

/** A strength session still on the plan; undefined when the plan states neither sets nor a length. */
export function plannedHeraclesLoad(plan: PlannedStrengthSession, deps?: HeraclesLoadDeps): HeraclesLoad | undefined {
  return plannedEstimator(deps)(plan);
}

/**
 * `plannedHeraclesLoad` for a batch, over one snapshot. `atSec` reads a plan
 * against the athlete as they were then (a session already behind them);
 * nothing later than now.
 */
function plannedEstimator(
  deps: HeraclesLoadDeps | undefined
): (plan: PlannedStrengthSession, atSec?: number) => HeraclesLoad | undefined {
  const resolved = depsOrDefault(deps);
  const { state } = snapshotFor(resolved).run;
  const now = resolved.now();
  return (plan, atSec) => estimatePlannedLoad(plan, state, atSec !== undefined ? Math.min(atSec, now) : now);
}

/**
 * The last second of a `YYYYMMDD` day, local, in epoch seconds; undefined for
 * anything else. The day's own sets count: read at its start, a movement first
 * lifted that day had no capacity and its plan fell to the usual effort (a
 * real session read 204% of its plan, 109% with that day's sets).
 */
function happenDayEndSec(happenDay: string | undefined): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(happenDay ?? "");
  return match
    ? Math.floor(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59).valueOf() / 1000)
    : undefined;
}

/** COROS's workout sport for strength. */
const PLANNED_STRENGTH_SPORT = 4;

/** A planned session's steps, as the schedule parse reads them, in the engine's terms. */
function plannedStrengthSession(
  exercises: readonly TrainingHubScheduledExercise[] | undefined,
  estimatedSeconds: number | undefined,
  corosLoad: number | undefined
): PlannedStrengthSession {
  return {
    exercises: (exercises ?? []).map((exercise) => ({
      key: exercise.key,
      corosExerciseType: exercise.corosExerciseType,
      sets: exercise.sets ?? 1,
      reps: exercise.reps,
      weightKg: exercise.weight,
      holdSec: exercise.holdSec,
      restSec: exercise.restSec
    })),
    estimatedSeconds,
    corosLoad
  };
}

/** COROS's `estimatedTime` of a raw program, in seconds; COROS writes 0 for a field not filled in. */
function estimatedSecondsOf(rawProgram: Record<string, unknown> | undefined): number | undefined {
  const value = Number(rawProgram?.estimatedTime);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Planned sessions as the schedule returned them, each strength one carrying
 * Heracles Training Load's estimate. `durationSeconds` (upcoming workouts) or
 * the raw program's `estimatedTime` (scheduled entries) is the session's length,
 * and `trainingLoad` is the program's own (the parse never hands it the load of
 * the activity that did the session, which floored the plan at it). A session
 * already behind the athlete is read against them as they were that day, so its
 * plan does not move as they grow stronger.
 */
export function withPlannedHeraclesLoads<
  T extends {
    sportType?: number;
    trainingLoad?: number;
    exercises?: TrainingHubScheduledExercise[];
    durationSeconds?: number;
    rawProgram?: Record<string, unknown>;
    happenDay?: string;
  }
>(workouts: T[], deps?: HeraclesLoadDeps): T[] {
  if (!workouts.some((workout) => workout.sportType === PLANNED_STRENGTH_SPORT)) return workouts;
  const estimate = plannedEstimator(deps);
  return workouts.map((workout) => {
    if (workout.sportType !== PLANNED_STRENGTH_SPORT) return workout;
    const estimated = workout.durationSeconds ?? estimatedSecondsOf(workout.rawProgram);
    const heraclesLoad = estimate(
      plannedStrengthSession(workout.exercises, estimated, workout.trainingLoad),
      happenDayEndSec(workout.happenDay)
    );
    return heraclesLoad ? { ...workout, heraclesLoad } : workout;
  });
}

const POUNDS_TO_KG = 0.45359237;
const STEP_TYPES: Partial<Record<RunWorkoutCreateStep["kind"], number>> = {
  warmup: 1,
  training: 2,
  interval: 2,
  cooldown: 3
};

function plannedExerciseOf(step: RunWorkoutCreateStep, repeat: number): PlannedStrengthExercise | undefined {
  // A step with no kind is a training step: older plans lack it.
  const corosExerciseType = STEP_TYPES[step.kind ?? "training"];
  if (corosExerciseType === undefined) return undefined;
  const name = step.exercise_name?.trim();
  const intensity = step.intensity;
  const weightKg =
    intensity?.type === "weight" && intensity.mode === "weight"
      ? intensity.unit === "lb" ? intensity.value * POUNDS_TO_KG : intensity.value
      : undefined;
  const timed = step.target_type === "time" && (step.target_duration_seconds ?? 0) > 0;
  return {
    key: name && isCorosExerciseKey(name) ? name.toUpperCase() : undefined,
    corosExerciseType,
    sets: Math.max(1, step.sets ?? 1) * repeat,
    reps: step.target_type === "reps" ? step.target_reps : undefined,
    weightKg,
    holdSec: timed ? step.target_duration_seconds : undefined,
    restSec: step.rest_type === 1 ? step.rest_value : undefined
  };
}

/** A plan's strength session in the engine's terms: its steps, a repeat counted per round. */
function plannedPlanSession(entry: PlanLoadEntry): PlannedStrengthSession {
  const exercises: PlannedStrengthExercise[] = [];
  for (const node of entry.workout.steps ?? []) {
    const steps = "repeat" in node ? node.steps : [node];
    const repeat = "repeat" in node ? Math.max(1, node.repeat) : 1;
    for (const step of steps) {
      const planned = plannedExerciseOf(step, repeat);
      if (planned) exercises.push(planned);
    }
  }
  return {
    exercises,
    estimatedSeconds: entry.plannedDurationSeconds,
    corosLoad: entry.plannedTrainingLoad
  };
}

/**
 * Heracles Training Load's estimate of each strength session in the plans a
 * screen is reading, by the key the screen sent. A session of another sport,
 * or one stating neither sets nor a length, has no entry.
 */
export function planEntryHeraclesLoads(
  entries: readonly PlanLoadEntry[],
  deps?: HeraclesLoadDeps
): Record<string, HeraclesLoad> {
  const loads: Record<string, HeraclesLoad> = {};
  const strength = entries.filter((entry) => entry.workout?.sport === "strength");
  if (!strength.length) return loads;
  const estimate = plannedEstimator(deps);
  for (const entry of strength) {
    const load = estimate(plannedPlanSession(entry));
    if (load) loads[entry.key] = load;
  }
  return loads;
}

/**
 * What Heracles Training Load adds to COROS's daily fitness figures, by day
 * (`heraclesFitness.ts`): each strength session's Heracles load over COROS's,
 * run through COROS's own averages. Once per snapshot.
 */
function dayDeltas(snapshot: HeraclesLoadSnapshot, deps: HeraclesLoadDeps): Map<string, HeraclesDayDelta> {
  if (snapshot.deltas) return snapshot.deltas;
  const byDay = new Map<string, HeraclesDaySurplus>();
  for (const activity of deps.strengthActivities()) {
    if (!STRENGTH_LOAD_SPORT_TYPES.has(activity.sportType) || activity.startTime === undefined) continue;
    const load = strengthLoadOf(activity, snapshot);
    const day = dayKey(new Date(activity.startTime * 1000));
    const entry = byDay.get(day) ?? { surplus: 0, pending: 0 };
    entry.surplus += Math.max(0, load.value - (activity.trainingLoad ?? 0));
    if (load.quality === "pending") entry.pending += 1;
    byDay.set(day, entry);
  }
  snapshot.deltas = heraclesDeltaSeries(byDay, dayKey(new Date(deps.now() * 1000)));
  return snapshot.deltas;
}

/**
 * COROS's daily and weekly figures as it sent them, each day carrying what
 * Heracles Training Load adds to it (`heracles`) and each week what it adds to
 * the recommended range (`heraclesRange`). The screens and Coach choose; a
 * failure to work it out leaves the payload as COROS sent it.
 */
export function withHeraclesDayDeltas<
  T extends { dayList: TrainingHubDailyMetric[]; weekList: Record<string, unknown>[] }
>(payload: T, deps?: HeraclesLoadDeps): T {
  try {
    const resolved = depsOrDefault(deps);
    const deltas = dayDeltas(snapshotFor(resolved), resolved);
    if (!deltas.size) return payload;
    return {
      ...payload,
      dayList: payload.dayList.map((day) => {
        const heracles = deltas.get(day.happenDay);
        return heracles ? { ...day, heracles } : day;
      }),
      weekList: payload.weekList.map((week) => {
        const range = deltas.get(String(week.firstDayOfWeek ?? ""))?.range;
        return range ? { ...week, heraclesRange: range } : week;
      })
    };
  } catch {
    return payload;
  }
}
