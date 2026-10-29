import type {
  StrengthDetail,
  StrengthExercise,
  StrengthSet,
  StrengthSummary
} from "./types";
import { strengthExerciseMetadata, type StrengthExerciseContext } from "./strengthExerciseMetadata";

export const REST_MARKER_KEY = "S3618";
const MODE_SET = 14;
const MODE_REST = 15;
/** A set's target type when it is held for a time rather than counted. */
const TARGET_TIME = 2;

/**
 * Bumped when the parse changes what it keeps, so `strength_sessions` rows
 * written by an older one are parsed again. 2: sets read by `mode`, timed
 * sets kept, exercises told apart by name as well as index. 3: preserve the
 * catalog identity and per-exercise muscle metadata for body attribution.
 * 4: a step found by position must carry the lap's own key when it has one.
 */
export const STRENGTH_DETAIL_VERSION = 4;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function getLapItems(raw: Record<string, unknown>): Record<string, unknown>[] {
  const lapList = raw.lapList;
  if (!Array.isArray(lapList) || lapList.length === 0) {
    return [];
  }
  const first = lapList[0];
  if (!first || typeof first !== "object") {
    return [];
  }
  const items = (first as Record<string, unknown>).lapItemList;
  return Array.isArray(items)
    ? (items.filter((i) => i && typeof i === "object") as Record<string, unknown>[])
    : [];
}

/**
 * What a lap item is. COROS marks each with a `mode` — 14 a set, 15 the rest
 * after it, 16 the exercise's roll-up, 17 the rest between exercises — and
 * that decides wherever it is present: on Hybrid Fitness a rest carries its
 * set's reps, and a plank carries none. A run's laps carry exercise keys too
 * (`S4208`) under modes 0–2, and are neither. Only an item with no mode at all
 * is told by its reps, as every item was before the mode was read.
 */
export function lapItemKind(item: Record<string, unknown>): "set" | "rest" | undefined {
  if (item.exerciseNameKey === REST_MARKER_KEY) return undefined;
  const mode = num(item.mode);
  if (mode !== undefined) {
    return mode === MODE_SET ? "set" : mode === MODE_REST ? "rest" : undefined;
  }
  if ((num(item.sets) ?? 0) > 0) return undefined;
  return (num(item.reps) ?? 0) > 0 ? "set" : "rest";
}

/**
 * Which exercise a lap item belongs to: its index and its name, since COROS
 * gives two exercises one index now and then (Squat Jumps and the minute after
 * them), and by index alone the second read as a set of the first.
 */
export function exerciseGroupKey(item: Record<string, unknown>): string {
  return `${num(item.exerciseIndex) ?? -1}:${
    item.exerciseNameKey === REST_MARKER_KEY ? "" : String(item.exerciseNameKey ?? "")
  }`;
}

/**
 * A set held for a time — a plank, a stretch, a minute of high knees — is read
 * in time, whatever the watch counted through it.
 */
export function isTimedSet(item: Record<string, unknown>): boolean {
  return num(item.targetType) === TARGET_TIME || (num(item.reps) ?? 0) <= 0;
}

/** Group lap items by exercise (`exerciseGroupKey`), in first-seen order. */
function groupByExercise(
  items: Record<string, unknown>[]
): Record<string, unknown>[][] {
  const order: string[] = [];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const key = exerciseGroupKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  return order.map((key) => groups.get(key)!);
}

function buildExercise(
  group: Record<string, unknown>[],
  context: StrengthExerciseContext
): StrengthExercise | undefined {
  // Drop section-rest marker laps entirely.
  const laps = group.filter((l) => l.exerciseNameKey !== REST_MARKER_KEY);
  if (laps.length === 0) {
    return undefined;
  }

  const nameKey =
    (laps.find((l) => typeof l.exerciseNameKey === "string")
      ?.exerciseNameKey as string | undefined) ?? "";
  const rawNameValue = laps.find((l) => typeof l.name === "string")?.name;
  const rawName = typeof rawNameValue === "string" ? rawNameValue : undefined;

  const aggregate = laps.find((l) => (num(l.sets) ?? 0) > 0);

  const entries: StrengthSet[] = [];
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];
    if (lapItemKind(lap) !== "set") {
      continue; // rests and the aggregate lap are not work sets
    }
    const timed = isTimedSet(lap);
    const next = laps[i + 1];
    const nextIsRest = next !== undefined && lapItemKind(next) === "rest";
    entries.push({
      reps: timed ? 0 : (num(lap.reps) ?? 0),
      weightKg: round((num(lap.weight) ?? 0) / 1000, 2),
      workSec: round((num(lap.time) ?? 0) / 100, 2),
      restSec: nextIsRest ? round((num(next!.time) ?? 0) / 100, 2) : 0,
      calories: Math.round((num(lap.calories) ?? 0) / 1000),
      ...(timed ? { timed } : {})
    });
  }

  // COROS's roll-up counts what the watch counted, timed sets included; the
  // entries are what is shown, so they decide once a set is read in time.
  const anyTimed = entries.some((entry) => entry.timed);
  const sets = aggregate && !anyTimed
    ? num(aggregate.sets) ?? entries.length
    : entries.length;
  const totalReps = aggregate && !anyTimed
    ? num(aggregate.reps) ?? entries.reduce((s, e) => s + e.reps, 0)
    : entries.reduce((s, e) => s + e.reps, 0);

  return { nameKey, rawName, sets, totalReps, entries, ...strengthExerciseMetadata(laps, context) };
}

function parseSummary(raw: Record<string, unknown>): StrengthSummary {
  const s =
    raw.summary && typeof raw.summary === "object"
      ? (raw.summary as Record<string, unknown>)
      : raw;
  // Activity time, like every other duration in the app; `totalTime` keeps the
  // pauses in. A zero `workoutTime` is COROS's not-recorded.
  const durationCs = num(s.workoutTime) || num(s.totalTime) || 0;
  return {
    sets: num(s.sets) ?? 0,
    totalReps: num(s.totalReps) ?? 0,
    totalWeightKg: round((num(s.totalWeight) ?? 0) / 1000, 0),
    exercises: num(s.exercises) ?? 0,
    calories: Math.round((num(s.calories) ?? 0) / 1000),
    durationSec: Math.round(durationCs / 100),
    avgHr: num(s.avgHr),
    maxHr: num(s.maxHr),
    trainingLoad: num(s.trainingLoad),
    aerobicEffect: num(s.aerobicEffect),
    anaerobicEffect: num(s.anaerobicEffect)
  };
}

/**
 * Build a StrengthDetail from a raw /activity/detail/query payload.
 * Returns undefined when the payload has no strength exercise breakdown.
 */
export function parseStrengthDetail(
  raw: Record<string, unknown>,
  context: StrengthExerciseContext = {}
): StrengthDetail | undefined {
  const items = getLapItems(raw);
  const hasExerciseData = items.some(
    (i) => typeof i.exerciseNameKey === "string" && i.exerciseNameKey
  );
  if (!hasExerciseData) {
    return undefined;
  }
  const exercises = groupByExercise(items)
    .map((group) => buildExercise(group, context))
    .filter((e): e is StrengthExercise => e !== undefined && e.entries.length > 0);
  if (exercises.length === 0) {
    return undefined;
  }
  return { summary: parseSummary(raw), exercises };
}
