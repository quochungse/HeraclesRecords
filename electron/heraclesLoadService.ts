/**
 * Heracles Training Load, read once in the main process and carried on the
 * payloads the screens already receive (docs/heracles-training-load.md).
 *
 * Every figure is recomputed from what is stored — the cached breakdowns, the
 * rated runs, the body weight — and never stored itself. One run scores every
 * strength session oldest first and is kept until any of those inputs moves.
 */

import {
  getSetting,
  heraclesLoadInputsVersion,
  listRatedActivityLoads,
  listRunLoads,
  listStoredStrengthSessions,
  listStrengthActivitiesWithoutBreakdown,
  setSetting
} from "./database";
import {
  bridgeFactor,
  estimatePlannedLoad,
  runHeraclesLoads,
  type HeraclesBridge,
  type HeraclesLoadRun,
  type PlannedStrengthExercise,
  type PlannedStrengthSession,
  type RatedRun
} from "./heraclesLoad";
import { HERACLES_FACTORS_VERSION } from "./heraclesLoadFactors";
import { getStoredHevyStrengthSessions } from "./hevyService";
import { combineStrengthSessions } from "./strengthSessionMerge";
import { lastKnownCorosWeightKg } from "./trainingHubService";
import type {
  HeraclesLoad,
  HeraclesLoadInfo,
  HeraclesRunEquivalent,
  HeraclesSessionLoad,
  PlanLoadEntry,
  RunWorkoutCreateStep,
  StrengthLoadSource,
  StrengthSession,
  TrainingHubActivity,
  TrainingHubScheduledExercise
} from "./types";

export const STRENGTH_LOAD_SOURCE_SETTING = "strength.loadSource";
export const STRENGTH_LOAD_SPORT_TYPES: ReadonlySet<number> = new Set([400, 402]);
/** As far back as a lift's capacity reaches, and the bridge's runs. */
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
  ratedRuns(): RatedRun[];
  /** Runs with a COROS load, for the run a strength session is set beside. */
  runs(): HeraclesRunEquivalent[];
  bodyWeightKg(startTime: number | undefined): number | undefined;
  /** Changes whenever the inputs do. */
  inputsVersion(): string;
  /** Epoch seconds. */
  now(): number;
}

export function createDefaultDeps(): HeraclesLoadDeps {
  const since = () => Math.floor(Date.now() / 1000) - HISTORY_DAYS * SECONDS_PER_DAY;
  return {
    strengthSessions: () =>
      combineStrengthSessions(listStoredStrengthSessions(since()), getStoredHevyStrengthSessions(HISTORY_DAYS)),
    withoutBreakdown: () => listStrengthActivitiesWithoutBreakdown(),
    ratedRuns: () => listRatedActivityLoads(since()),
    runs: () => listRunLoads(since()),
    bodyWeightKg: () => lastKnownCorosWeightKg(),
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
  bridge: HeraclesBridge;
  run: HeraclesLoadRun;
  /** By every id a session goes by: its own, COROS's, Hevy's. */
  byId: Map<string, StrengthSession>;
  withoutBreakdown: ReadonlySet<string>;
  /** Oldest first. */
  runs: HeraclesRunEquivalent[];
}

const snapshots = new WeakMap<HeraclesLoadDeps, HeraclesLoadSnapshot>();

function snapshotFor(deps: HeraclesLoadDeps): HeraclesLoadSnapshot {
  const now = deps.now();
  const weight = deps.bodyWeightKg(now);
  // The day is part of it: the bridge's window and the capacities' move daily.
  const version = [
    deps.inputsVersion(),
    weight ?? "",
    HERACLES_FACTORS_VERSION,
    Math.floor(now / SECONDS_PER_DAY)
  ].join("#");
  const cached = snapshots.get(deps);
  if (cached?.version === version) return cached;

  const bridge = bridgeFactor(deps.ratedRuns(), now);
  const sessions = deps.strengthSessions();
  const run = runHeraclesLoads(sessions, { k: bridge.k, bodyWeightKg: (startTime) => deps.bodyWeightKg(startTime) });
  const byId = new Map<string, StrengthSession>();
  for (const session of sessions) {
    byId.set(session.activityId, session);
    if (session.sourceIds?.coros) byId.set(session.sourceIds.coros, session);
    if (session.sourceIds?.hevy) byId.set(`hevy:${session.sourceIds.hevy}`, session);
  }
  const snapshot: HeraclesLoadSnapshot = {
    version,
    bridge,
    run,
    byId,
    withoutBreakdown: new Set(deps.withoutBreakdown()),
    runs: [...deps.runs()].sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0))
  };
  snapshots.set(deps, snapshot);
  return snapshot;
}

/** The run in the eight weeks before a session whose COROS load is closest to the session's own. */
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
    // The closer load wins; between two as close, the more recent run.
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

export function getHeraclesLoadInfo(deps?: HeraclesLoadDeps): HeraclesLoadInfo {
  const resolved = depsOrDefault(deps);
  const { bridge } = snapshotFor(resolved);
  const bodyWeightKg = resolved.bodyWeightKg(resolved.now());
  return {
    source: getStrengthLoadSource(),
    k: bridge.k,
    bridgeRuns: bridge.runs,
    bridgeMeasured: bridge.measured,
    ...(bodyWeightKg !== undefined ? { bodyWeightKg } : {})
  };
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
  const snapshot = snapshotFor(depsOrDefault(deps));
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
  return activities.map((activity) => {
    const heraclesLoad = heraclesLoadFor(activity, deps);
    return heraclesLoad ? { ...activity, heraclesLoad } : activity;
  });
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
  const snapshot = snapshotFor(depsOrDefault(deps));
  return sessions.map((session) => {
    const scoredSession =
      snapshot.byId.get(session.activityId) ??
      (session.sourceIds?.coros ? snapshot.byId.get(session.sourceIds.coros) : undefined) ??
      (session.sourceIds?.hevy ? snapshot.byId.get(`hevy:${session.sourceIds.hevy}`) : undefined);
    const scored = scoredSession ? snapshot.run.sessions.get(scoredSession.activityId) : undefined;
    if (!scored || !scoredSession) return session;
    const runEquivalent = scored.quality === "sets" || scored.quality === "estimate"
      ? runEquivalentFor(scored, session.startTime, snapshot.runs)
      : undefined;
    const withRun = runEquivalent ? { ...scored, runEquivalent } : scored;
    if (sameShape(scoredSession, session)) return { ...session, heracles: withRun };
    const { sets: _sets, ...withoutSets } = withRun;
    return { ...session, heracles: withoutSets };
  });
}

/** A strength session still on the plan; undefined when the plan states neither sets nor a length. */
export function plannedHeraclesLoad(plan: PlannedStrengthSession, deps?: HeraclesLoadDeps): HeraclesLoad | undefined {
  const resolved = depsOrDefault(deps);
  const snapshot = snapshotFor(resolved);
  return estimatePlannedLoad(plan, snapshot.run.state, resolved.now());
}

/** COROS's workout sport for strength. */
const PLANNED_STRENGTH_SPORT = 4;

/** A planned session's steps, as the schedule parse reads them, in the engine's terms. */
export function plannedStrengthSession(
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
 * the raw program's `estimatedTime` (scheduled entries) is the session's length.
 */
export function withPlannedHeraclesLoads<
  T extends {
    sportType?: number;
    trainingLoad?: number;
    exercises?: TrainingHubScheduledExercise[];
    durationSeconds?: number;
    rawProgram?: Record<string, unknown>;
  }
>(workouts: T[], deps?: HeraclesLoadDeps): T[] {
  if (!workouts.some((workout) => workout.sportType === PLANNED_STRENGTH_SPORT)) return workouts;
  return workouts.map((workout) => {
    if (workout.sportType !== PLANNED_STRENGTH_SPORT) return workout;
    const estimated = workout.durationSeconds ?? estimatedSecondsOf(workout.rawProgram);
    const heraclesLoad = plannedHeraclesLoad(
      plannedStrengthSession(workout.exercises, estimated, workout.trainingLoad),
      deps
    );
    return heraclesLoad ? { ...workout, heraclesLoad } : workout;
  });
}

const COROS_EXERCISE_KEY = /^[TS]\d{4}$/;
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
    key: name && COROS_EXERCISE_KEY.test(name) ? name : undefined,
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
  for (const entry of entries) {
    if (entry.workout.sport !== "strength") continue;
    const load = plannedHeraclesLoad(plannedPlanSession(entry), deps);
    if (load) loads[entry.key] = load;
  }
  return loads;
}
