/**
 * Heracles Training Load: a strength session's load on the scale of COROS's
 * running Training Load (docs/heracles-training-load.md).
 *
 * COROS scores every session from heart rate (Banister's TRIMP), which reads a
 * strength session a third to a quarter as heavy per minute as a run the
 * athlete rates the same. This scores the session from its sets instead:
 *
 *   kg, reps, body weight → share of the athlete's own capacity at that lift
 *   → reps left in reserve → set RPE (Zourdos 2016) → RPE × minutes
 *   (Foster's session-RPE) → × k, COROS's load per RPE-minute on the
 *   athlete's own runs.
 *
 * The feeling an athlete records after a session is never an input. It is
 * read only off runs, to measure k. A set's RPE logged in Hevy is, over the
 * prediction. Node-free: the renderer imports the types.
 */

import { HERACLES_EXERCISE_FACTORS, heraclesFactorByName, type HeraclesExerciseFactor } from "./heraclesLoadFactors";
import type {
  HeraclesLoad,
  HeraclesLoadQuality,
  HeraclesSessionLoad,
  HeraclesSetLoad,
  StrengthExercise,
  StrengthSession,
  StrengthSet
} from "./types";

export interface HeraclesBridge {
  /** COROS Training Load per RPE-minute. */
  k: number;
  /** Runs it was measured on. */
  runs: number;
  /** False when too few rated runs: `k` is the default. */
  measured: boolean;
}

export interface RatedRun {
  sportType: number;
  /** Epoch seconds. */
  startTime?: number;
  /** Seconds. */
  duration?: number;
  trainingLoad?: number;
  /** COROS feelType, 1..5. */
  feelType?: number | null;
}

export interface HeraclesLoadContext {
  k: number;
  /** Body weight on the day of a session (epoch seconds), when known. */
  bodyWeightKg: (startTime: number | undefined) => number | undefined;
}

export const HERACLES_DEFAULT_K = 0.5;
const MIN_BRIDGE_RUNS = 8;
const BRIDGE_WINDOW_DAYS = 120;
/** Runs rated easier than this sit off the line strength sessions are rated on. */
const MIN_BRIDGE_FEEL = 3;
const RUN_SPORT_TYPES: ReadonlySet<number> = new Set([100, 101, 102, 103]);

const CAPACITY_WINDOW_DAYS = 120;
/** The best set of a lift is taken to have stopped one rep short of failure. */
const BEST_SET_RIR = 1;
/** Epley's line is read only where it holds. */
const MAX_CAPACITY_REPS = 20;
/** A new best counts only when a second set of the session backs it. */
const CAPACITY_JUMP = 1.15;
/** More reps than this in one lap is a lap the watch never split. */
const MERGED_LAP_REPS = 40;
const REST_CAP_SEC = 180;
/** CR-10 "very easy": warm-up, changing lifts, stretching, a watch left running. */
const NON_SET_RPE = 1.5;
const DEFAULT_BODY_WEIGHT_KG = 75;
const REFERENCE_BODY_WEIGHT_KG = 70;
/** Strength grows with body mass to the 2/3 power (Jaric 2002). */
const STRENGTH_ALLOMETRY = 0.67;
const DEFAULT_BODY_SHARE = 0.6;
const DEFAULT_REPS_AT_BODYWEIGHT = 15;
const DEFAULT_MAX_HOLD_SEC = 60;
/** A hold past this is a stretch. */
const STRETCH_HOLD_SEC = 180;
const MEDIAN_WINDOW_DAYS = 56;
const DEFAULT_SESSION_RPE = 6.5;
const SECONDS_PER_REP = 3;
const DEFAULT_REST_SEC = 90;
const SECONDS_PER_DAY = 86_400;
/** COROS body-region codes (Shoulders … Legs & Hips) and its generic Full Body. */
const UNREADABLE_KEYS: ReadonlySet<string> = new Set(["S4208", "S4209", "S4210", "S4211", "S4212", "S4213", "S4214"]);

/** Zourdos et al. 2016, as Helms et al. 2016 lay it out: 9 is one rep left, 7 three, 5–6 four to six. */
export function rpeFromRir(rir: number): number {
  if (rir <= 3) return 10 - rir;
  if (rir <= 6) return 7 - ((rir - 3) * 2) / 3;
  return 2 + 3 * Math.exp(-(rir - 6) / 6);
}

/**
 * `rpeFromRir` read back, for an RPE the athlete logged: only from 5 up, where
 * the scale still counts reps left; an easier set says too little about the
 * lift's best to read a capacity off it.
 */
function rirFromRpe(rpe: number): number | undefined {
  if (rpe >= 7) return 10 - rpe;
  if (rpe >= 5) return 3 + ((7 - rpe) * 3) / 2;
  return undefined;
}

/** The RPE the athlete logged for a set (Hevy), when it is on the scale. */
function loggedRpe(set: StrengthSet): number | undefined {
  return set.rpe !== undefined && Number.isFinite(set.rpe) && set.rpe >= 1 && set.rpe <= 10 ? set.rpe : undefined;
}

/** Epley's reps to failure at a share of the one-rep max. */
function repsToFailure(intensity: number): number {
  return Math.max(0, 30 * (1 / intensity - 1));
}

/** A one-rep max from a set, the set taken to stop `rir` reps short of failure. */
function capacityEstimate(load: number, reps: number, rir: number): number {
  return load * (1 + (reps + rir) / 30);
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * COROS load per RPE-minute on the athlete's rated runs, feel × 2 standing for
 * CR-10. Only runs rated 3 and up: this athlete's runs carry 2.3–3.3 TL a minute
 * whatever they are rated, so the easy ratings pull k up, and strength sessions
 * are rated 3–4.
 */
export function bridgeFactor(runs: readonly RatedRun[], nowSec: number): HeraclesBridge {
  const since = nowSec - BRIDGE_WINDOW_DAYS * SECONDS_PER_DAY;
  let load = 0;
  let rpeMinutes = 0;
  let count = 0;
  for (const run of runs) {
    const feel = run.feelType ?? 0;
    const duration = positive(run.duration);
    const trainingLoad = positive(run.trainingLoad);
    if (
      !RUN_SPORT_TYPES.has(run.sportType) ||
      feel < MIN_BRIDGE_FEEL ||
      feel > 5 ||
      duration === undefined ||
      trainingLoad === undefined ||
      (run.startTime ?? 0) < since
    ) {
      continue;
    }
    load += trainingLoad;
    rpeMinutes += feel * 2 * (duration / 60);
    count += 1;
  }
  if (count < MIN_BRIDGE_RUNS || rpeMinutes <= 0) {
    return { k: HERACLES_DEFAULT_K, runs: count, measured: false };
  }
  return { k: load / rpeMinutes, runs: count, measured: true };
}

interface ResolvedFactor {
  kind: HeraclesExerciseFactor["kind"] | "unreadable";
  bodyShare: number;
  repsAtBodyweight: number;
  maxHoldSec?: number;
}

const COROS_KEY = /^[TS]\d{4}$/;

/** The movement's identity: COROS's key, or Hevy's template. */
function heraclesExerciseKey(exercise: StrengthExercise): string | undefined {
  if (exercise.corosKey) return exercise.corosKey.toUpperCase();
  if (/^[TS]\d{4}$/i.test(exercise.nameKey)) return exercise.nameKey.toUpperCase();
  if (exercise.externalId) return `hevy:${exercise.externalId}`;
  return undefined;
}

function resolveFactor(exercise: StrengthExercise, key: string | undefined): ResolvedFactor {
  const base = { bodyShare: 0, repsAtBodyweight: DEFAULT_REPS_AT_BODYWEIGHT };
  const type = exercise.corosExerciseType;
  if (type === 1 || type === 3 || type === 4) return { ...base, kind: "skip" };
  if (!key || UNREADABLE_KEYS.has(key)) return { ...base, kind: "unreadable" };
  // A movement with no COROS key (Hevy's) is known by its name.
  const listed = COROS_KEY.test(key)
    ? HERACLES_EXERCISE_FACTORS[key]
    : heraclesFactorByName(exercise.rawName ?? exercise.nameKey);
  if (listed) {
    return {
      kind: listed.kind,
      bodyShare: listed.bodyShare ?? (listed.kind === "bodyweight" ? DEFAULT_BODY_SHARE : 0),
      repsAtBodyweight: listed.repsAtBodyweight ?? DEFAULT_REPS_AT_BODYWEIGHT,
      maxHoldSec: listed.maxHoldSec
    };
  }
  // Hevy's template types.
  switch (exercise.exerciseType) {
    case "duration":
      return { ...base, kind: "hold" };
    case "distance_duration":
    case "short_distance_weight":
      return { ...base, kind: "plyo" };
    case "reps_only":
    case "bodyweight_reps":
    case "bodyweight_assisted_reps":
      return { ...base, kind: "bodyweight", bodyShare: DEFAULT_BODY_SHARE };
    default:
      return { ...base, kind: "load" };
  }
}

interface CapacityPoint {
  day: number;
  estimate: number;
}

interface PreparedSet {
  set: StrengthSet;
  seconds: number;
  role: "work" | "hold" | "between";
}

interface PreparedExercise {
  exercise: StrengthExercise;
  key?: string;
  factor: ResolvedFactor;
  /** Scored by how long it is held: a hold, or a movement only ever timed. */
  held: boolean;
  sets: PreparedSet[];
}

/** What the run leaves behind for estimating sessions still on the plan. */
export interface HeraclesLoadState {
  context: HeraclesLoadContext;
  capacity: ReadonlyMap<string, readonly CapacityPoint[]>;
  holds: ReadonlyMap<string, number>;
  weightedKeys: ReadonlySet<string>;
  /** Readable sessions' RPE, with their day. */
  sessionRpes: readonly { day: number; rpe: number }[];
}

export interface HeraclesLoadRun {
  /** By the session's own `activityId`. */
  sessions: Map<string, HeraclesSessionLoad>;
  state: HeraclesLoadState;
}

function dayOf(startTime: number | undefined): number {
  return Math.floor((startTime ?? 0) / SECONDS_PER_DAY);
}

function setSeconds(set: StrengthSet): { work: number; rest: number } {
  if (set.workSec > 0) return { work: set.workSec, rest: Math.max(0, set.restSec) };
  // Hevy keeps no clock for a set.
  return {
    work: set.timed ? 0 : set.reps * SECONDS_PER_REP,
    rest: set.restSec > 0 ? set.restSec : DEFAULT_REST_SEC
  };
}

function capacityAt(points: readonly CapacityPoint[] | undefined, day: number): number | undefined {
  let best: number | undefined;
  for (const point of points ?? []) {
    if (point.day > day || point.day < day - CAPACITY_WINDOW_DAYS) continue;
    if (best === undefined || point.estimate > best) best = point.estimate;
  }
  return best;
}

function bodyweightPrior(factor: ResolvedFactor, bodyWeightKg: number): number {
  return (
    factor.bodyShare *
    REFERENCE_BODY_WEIGHT_KG *
    (1 + factor.repsAtBodyweight / 30) *
    Math.pow(bodyWeightKg / REFERENCE_BODY_WEIGHT_KG, STRENGTH_ALLOMETRY)
  );
}

/** The body's share, plus the weight lifted, less any assistance (Hevy's assisted movements). */
function systemLoad(set: Pick<StrengthSet, "weightKg" | "assistKg">, factor: ResolvedFactor, bodyWeightKg: number): number {
  return factor.bodyShare * bodyWeightKg + set.weightKg - (set.assistKg ?? 0);
}

/**
 * The factor a set is scored with, or "missing" for a set of a weighted lift
 * logged with no weight. A movement the table does not know is bodyweight
 * until a set of it carries a weight.
 */
function setFactor(
  factor: ResolvedFactor,
  key: string | undefined,
  weightKg: number,
  weightedKeys: ReadonlySet<string>
): ResolvedFactor | "missing" {
  if (factor.kind !== "load" || weightKg > 0 || factor.bodyShare > 0) return factor;
  if (key === undefined || weightedKeys.has(key)) return "missing";
  return { ...factor, kind: "bodyweight", bodyShare: DEFAULT_BODY_SHARE };
}

/** Capacity for a set: the lift's history, or what a body this heavy manages without one. */
function capacityFor(
  factor: ResolvedFactor,
  weightKg: number,
  points: readonly CapacityPoint[] | undefined,
  day: number,
  bodyWeightKg: number
): number {
  const prior = factor.bodyShare > 0 && (factor.kind === "bodyweight" || weightKg <= 0)
    ? bodyweightPrior(factor, bodyWeightKg)
    : 0;
  return Math.max(capacityAt(points, day) ?? 0, prior);
}

function sessionDurationSec(session: StrengthSession): number | undefined {
  return positive(session.duration) ?? positive(session.detail.summary.durationSec);
}

function corosLoadOf(session: StrengthSession): number | undefined {
  const load = session.trainingLoad ?? session.detail.summary.trainingLoad;
  return load !== undefined && Number.isFinite(load) && load >= 0 ? load : undefined;
}

function finish(value: number, cardio: number | undefined, quality: HeraclesLoadQuality): HeraclesLoad {
  const total = Math.max(value, cardio ?? 0);
  return {
    value: total,
    ...(cardio !== undefined ? { cardio } : {}),
    muscular: Math.max(0, total - (cardio ?? 0)),
    quality
  };
}

/**
 * Every session's load, oldest first, each read against the capacity its
 * lifts had shown up to that day — so a new best never rewrites an old
 * session.
 */
export function runHeraclesLoads(
  sessions: readonly StrengthSession[],
  context: HeraclesLoadContext
): HeraclesLoadRun {
  const capacity = new Map<string, CapacityPoint[]>();
  const holds = new Map<string, number>();
  const weightedKeys = new Set<string>();
  const sessionRpes: { day: number; rpe: number }[] = [];
  const results = new Map<string, HeraclesSessionLoad>();

  const ordered = [...sessions].sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));
  for (const session of ordered) {
    const day = dayOf(session.startTime);
    const bodyWeightKg = context.bodyWeightKg(session.startTime) ?? DEFAULT_BODY_WEIGHT_KG;
    const cardio = corosLoadOf(session);

    const exercises: PreparedExercise[] = session.detail.exercises.map((exercise) => {
      const key = heraclesExerciseKey(exercise);
      const factor = resolveFactor(exercise, key);
      // A timed lap inside a lift is a set the watch counted no reps for, not
      // a hold: it takes the session's median RPE.
      const held =
        factor.kind === "hold" ||
        (factor.kind !== "skip" && factor.kind !== "plyo" && exercise.entries.length > 0 &&
          exercise.entries.every((set) => set.timed));
      const sets = exercise.entries.map((set): PreparedSet => {
        const { work, rest } = setSeconds(set);
        const seconds = work + Math.min(rest, REST_CAP_SEC);
        const isBetween =
          factor.kind === "skip" ||
          factor.kind === "plyo" ||
          (set.timed === true && work >= STRETCH_HOLD_SEC);
        return { set, seconds, role: isBetween ? "between" : set.timed && held ? "hold" : "work" };
      });
      return { exercise, key, factor, held, sets };
    });

    // Drills and jumps: heart rate measures them, so COROS's figure stands.
    const allSeconds = exercises.reduce((sum, entry) => sum + entry.sets.reduce((inner, set) => inner + set.seconds, 0), 0);
    const drillSeconds = exercises
      .filter((entry) => entry.factor.kind === "plyo")
      .reduce((sum, entry) => sum + entry.sets.reduce((inner, set) => inner + set.seconds, 0), 0);
    if (allSeconds > 0 && drillSeconds * 2 > allSeconds) {
      results.set(session.activityId, finish(cardio ?? 0, cardio, "conditioning"));
      continue;
    }

    // Seventy high knees are a drill; seventy curls are laps the watch never split.
    const merged = exercises.some(
      (entry) =>
        entry.factor.kind !== "plyo" &&
        entry.factor.kind !== "skip" &&
        entry.sets.some(({ set }) => !set.timed && set.reps > MERGED_LAP_REPS)
    );
    const counted = exercises.filter((entry) => entry.factor.kind !== "skip");
    const countedSets = counted.reduce((sum, entry) => sum + entry.sets.length, 0);
    const unreadableSets = counted
      .filter((entry) => entry.factor.kind === "unreadable")
      .reduce((sum, entry) => sum + entry.sets.length, 0);
    const readable = !merged && countedSets > 0 && unreadableSets * 2 <= countedSets;

    // The session's own sets join the history before it is read, so its best
    // set is what it is read against.
    if (readable) {
      for (const entry of exercises) {
        const kind = entry.factor.kind;
        if (!entry.key || kind === "skip" || kind === "plyo" || kind === "unreadable") continue;
        const estimates: number[] = [];
        for (const { set } of entry.sets) {
          if (set.timed) {
            if (entry.held && set.workSec > 0 && set.workSec < STRETCH_HOLD_SEC) {
              holds.set(entry.key, Math.max(holds.get(entry.key) ?? 0, set.workSec * 1.15, entry.factor.maxHoldSec ?? 0));
            }
            continue;
          }
          if (kind === "hold" || set.type === "warmup") continue;
          if (set.weightKg > 0) weightedKeys.add(entry.key);
          const factor = setFactor(entry.factor, entry.key, set.weightKg, weightedKeys);
          if (factor === "missing") continue;
          const load = systemLoad(set, factor, bodyWeightKg);
          if (load <= 0 || set.reps < 1 || set.reps > MAX_CAPACITY_REPS) continue;
          // A logged RPE says how far from failure the set stopped; without
          // one, the best set is taken to have stopped one rep short.
          const logged = loggedRpe(set);
          const rir = set.type === "failure" ? 0 : logged !== undefined ? rirFromRpe(logged) : BEST_SET_RIR;
          if (rir === undefined) continue;
          estimates.push(capacityEstimate(load, set.reps, rir));
        }
        if (estimates.length === 0) continue;
        const previous = capacityAt(capacity.get(entry.key), day);
        const ceiling = previous !== undefined ? previous * CAPACITY_JUMP : Number.POSITIVE_INFINITY;
        // A rep count misread by the watch can claim a best no lift backs.
        const beyond = estimates.filter((estimate) => estimate > ceiling);
        const kept = beyond.length === 1 ? estimates.filter((estimate) => estimate <= ceiling) : estimates;
        // Sessions come oldest first, so a point past the window is past it for
        // every session after this one, and for a plan read today.
        const points = (capacity.get(entry.key) ?? []).filter(
          (point) => point.day >= day - CAPACITY_WINDOW_DAYS
        );
        for (const estimate of kept) points.push({ day, estimate });
        capacity.set(entry.key, points);
      }
    }

    if (!readable) {
      const minutes = (sessionDurationSec(session) ?? 0) / 60;
      const recent = sessionRpes.filter((entry) => entry.day >= day - MEDIAN_WINDOW_DAYS && entry.day <= day);
      const rpe = median(recent.map((entry) => entry.rpe)) ?? DEFAULT_SESSION_RPE;
      results.set(session.activityId, { ...finish(context.k * rpe * minutes, cardio, "estimate"), sessionRpe: rpe });
      continue;
    }

    const scored: (HeraclesSetLoad | null)[][] = exercises.map((entry) =>
      entry.sets.map(({ set, seconds, role }): HeraclesSetLoad | null => {
        if (role === "between") return null;
        // The athlete's own rating outranks the prediction.
        const logged = loggedRpe(set);
        if (logged !== undefined) return { load: 0, rpe: logged, seconds, logged: true };
        if (role === "hold") {
          const maxHold = (entry.key ? holds.get(entry.key) : undefined) ?? entry.factor.maxHoldSec ?? DEFAULT_MAX_HOLD_SEC;
          const share = Math.min(1, set.workSec / maxHold);
          return { load: 0, rpe: 2 + 8 * share, seconds };
        }
        const filled: HeraclesSetLoad = { load: 0, rpe: Number.NaN, seconds, filled: true };
        if (entry.factor.kind === "unreadable" || set.reps < 1) return filled;
        const factor = setFactor(entry.factor, entry.key, set.weightKg, weightedKeys);
        if (factor === "missing") return filled;
        const load = systemLoad(set, factor, bodyWeightKg);
        const capacityKg = capacityFor(factor, set.weightKg, entry.key ? capacity.get(entry.key) : undefined, day, bodyWeightKg);
        if (load <= 0 || capacityKg <= 0) return filled;
        const intensity = Math.min(1, load / capacityKg);
        const rir = set.type === "failure" ? 0 : Math.max(0, repsToFailure(intensity) - set.reps);
        return { load: 0, rpe: rpeFromRir(rir), rir, intensity, seconds };
      })
    );

    const known = scored.flat().filter((set): set is HeraclesSetLoad => set !== null && !set.filled);
    const fill = median(known.map((set) => set.rpe));
    if (fill === undefined) {
      const minutes = (sessionDurationSec(session) ?? 0) / 60;
      results.set(session.activityId, { ...finish(context.k * DEFAULT_SESSION_RPE * minutes, cardio, "estimate"), sessionRpe: DEFAULT_SESSION_RPE });
      continue;
    }

    let rpeSeconds = 0;
    let workSeconds = 0;
    for (const exerciseSets of scored) {
      for (const set of exerciseSets) {
        if (!set) continue;
        if (set.filled) set.rpe = fill;
        set.load = (context.k * set.rpe * set.seconds) / 60;
        rpeSeconds += set.rpe * set.seconds;
        workSeconds += set.seconds;
      }
    }
    const duration = sessionDurationSec(session) ?? workSeconds;
    const between = Math.max(0, duration - workSeconds);
    const total = rpeSeconds + NON_SET_RPE * between;
    const sessionRpe = total / Math.max(1, workSeconds + between);
    sessionRpes.push({ day, rpe: sessionRpe });
    results.set(session.activityId, {
      ...finish((context.k * total) / 60, cardio, "sets"),
      sessionRpe,
      sets: scored
    });
  }

  return { sessions: results, state: { context, capacity, holds, weightedKeys, sessionRpes } };
}

export interface PlannedStrengthExercise {
  /** COROS key of the movement. */
  key?: string;
  /** COROS step type: 1 warm-up, 2 work, 3 cool-down, 4 rest. */
  corosExerciseType?: number;
  sets: number;
  reps?: number;
  weightKg?: number;
  holdSec?: number;
  restSec?: number;
}

export interface PlannedStrengthSession {
  exercises: readonly PlannedStrengthExercise[];
  /** COROS's estimate of the session's length, in seconds. */
  estimatedSeconds?: number;
  /** COROS's planned Training Load, usually 0 for strength. */
  corosLoad?: number;
}

/**
 * A strength session still on the plan, read against the capacity the athlete
 * has shown so far: its sets when the plan states them, else its length at
 * the athlete's usual session RPE. Undefined when the plan says neither.
 */
export function estimatePlannedLoad(
  plan: PlannedStrengthSession,
  state: HeraclesLoadState,
  nowSec: number
): HeraclesLoad | undefined {
  const day = dayOf(nowSec);
  const { k } = state.context;
  const bodyWeightKg = state.context.bodyWeightKg(nowSec) ?? DEFAULT_BODY_WEIGHT_KG;
  const recent = state.sessionRpes.filter((entry) => entry.day >= day - MEDIAN_WINDOW_DAYS);
  const usual = median(recent.map((entry) => entry.rpe)) ?? DEFAULT_SESSION_RPE;
  const cardio = positive(plan.corosLoad);

  let rpeSeconds = 0;
  let workSeconds = 0;
  for (const planned of plan.exercises) {
    const exercise: StrengthExercise = {
      nameKey: planned.key ?? "",
      corosKey: planned.key,
      corosExerciseType: planned.corosExerciseType,
      sets: planned.sets,
      totalReps: 0,
      entries: []
    };
    const factor = resolveFactor(exercise, planned.key);
    if (factor.kind === "skip" || factor.kind === "plyo" || planned.sets <= 0) continue;
    const rest = Math.min(planned.restSec ?? DEFAULT_REST_SEC, REST_CAP_SEC);
    if (planned.holdSec !== undefined && planned.holdSec > 0) {
      const maxHold = (planned.key ? state.holds.get(planned.key) : undefined) ?? factor.maxHoldSec ?? DEFAULT_MAX_HOLD_SEC;
      const seconds = planned.holdSec + rest;
      rpeSeconds += planned.sets * (2 + 8 * Math.min(1, planned.holdSec / maxHold)) * seconds;
      workSeconds += planned.sets * seconds;
      continue;
    }
    const reps = planned.reps ?? 0;
    if (reps <= 0) continue;
    const seconds = reps * SECONDS_PER_REP + rest;
    const weightKg = planned.weightKg ?? 0;
    const setScoring = setFactor(factor, planned.key, weightKg, state.weightedKeys);
    let rpe = usual;
    if (setScoring !== "missing") {
      const load = systemLoad({ weightKg }, setScoring, bodyWeightKg);
      const points = planned.key ? state.capacity.get(planned.key) : undefined;
      const capacityKg = capacityFor(setScoring, weightKg, points, day, bodyWeightKg);
      if (load > 0 && capacityKg > 0) {
        rpe = rpeFromRir(Math.max(0, repsToFailure(Math.min(1, load / capacityKg)) - reps));
      }
    }
    rpeSeconds += planned.sets * rpe * seconds;
    workSeconds += planned.sets * seconds;
  }

  const estimated = positive(plan.estimatedSeconds);
  if (workSeconds > 0) {
    const between = Math.max(0, (estimated ?? workSeconds) - workSeconds);
    return finish((k * (rpeSeconds + NON_SET_RPE * between)) / 60, cardio, "planned");
  }
  if (estimated !== undefined) {
    return finish((k * usual * estimated) / 60, cardio, "planned");
  }
  return undefined;
}
