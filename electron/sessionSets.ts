import type {
  ActivityVisualStrengthExercise,
  SessionSet,
  SessionSetExercise,
  TrainingHubActivitySeriesPoint
} from "./types";
import { downsampleActivitySeries } from "./activitySeries";
import { exerciseGroupKey, isTimedSet, lapItemKind, REST_MARKER_KEY } from "./strengthDetail";

/**
 * The sets of a session COROS records exercise by exercise — a strength
 * session, a Hybrid Fitness one — read for the Coach's card and the text its
 * tools hand the model.
 *
 * `parseStrengthDetail` reads the same lap items for the Strength screen, and
 * both tell a set from a rest by `lapItemKind`. This one keeps what a card and
 * the coach need beside it: where each set sits on the session's clock, its
 * heart rate, and the reps the watch counted through a timed set.
 *
 * The renderer imports this directly — it redraws a card stored before the
 * sets were kept — so it must stay free of `node:` imports.
 */

/** Heart-rate points a card draws under its sets: one every ~15 s of an hour. */
export const SETS_HR_POINTS = 240;

type LapItem = Record<string, unknown>;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const figure = num(value);
  return figure !== undefined && figure > 0 ? figure : undefined;
}

/** The lap list whose items carry exercises; a run's first list is its auto laps. */
function exerciseItems(raw: Record<string, unknown>): LapItem[] {
  const lapList = Array.isArray(raw.lapList) ? raw.lapList : [];
  for (const lap of lapList) {
    const items =
      lap && typeof lap === "object" ? (lap as Record<string, unknown>).lapItemList : undefined;
    if (!Array.isArray(items)) continue;
    const objects = items.filter((item): item is LapItem => Boolean(item) && typeof item === "object");
    if (objects.some((item) => typeof item.exerciseNameKey === "string" && item.exerciseNameKey)) {
      return objects;
    }
  }
  return [];
}

export function parseSessionSets(raw: Record<string, unknown>): SessionSetExercise[] | undefined {
  const items = exerciseItems(raw);
  if (items.length === 0) return undefined;

  const summary =
    raw.summary && typeof raw.summary === "object" ? (raw.summary as Record<string, unknown>) : raw;
  const stamps = items.map((item) => positive(item.startTimestamp)).filter((stamp) => stamp !== undefined);
  // Hundredths of a second, as the samples are stamped.
  const base = positive(summary.startTimestamp) ?? (stamps.length > 0 ? Math.min(...stamps) : undefined);

  const order: string[] = [];
  const groups = new Map<string, SessionSetExercise>();
  let cursor = 0;
  let last: SessionSet | undefined;

  for (const item of items) {
    const kind = lapItemKind(item);
    // The rest between two exercises is no set, but it is time on the clock
    // the sets are placed on where COROS stamped none; a roll-up is not.
    const between = !kind && item.exerciseNameKey === REST_MARKER_KEY;
    if (!kind && !between) {
      last = undefined;
      continue;
    }
    const seconds = Math.round((num(item.time) ?? 0) / 100);
    const stamp = positive(item.startTimestamp);
    const start = stamp !== undefined && base !== undefined ? Math.max(0, Math.round((stamp - base) / 100)) : cursor;
    cursor = start + seconds;

    if (kind !== "set") {
      if (kind === "rest" && last && seconds > 0) last.restSeconds = seconds;
      last = undefined;
      continue;
    }

    const nameKey = typeof item.exerciseNameKey === "string" ? item.exerciseNameKey : "";
    const key = exerciseGroupKey(item);
    let exercise = groups.get(key);
    if (!exercise) {
      const rawName = typeof item.name === "string" && item.name.trim() ? item.name : undefined;
      exercise = { nameKey, ...(rawName ? { rawName } : {}), sets: [] };
      groups.set(key, exercise);
      order.push(key);
    }

    // A timed set keeps the reps the watch counted through it — a minute of
    // high knees is 74 — which the coach is told beside its time.
    const reps = positive(item.reps);
    const timed = isTimedSet(item);
    const weight = positive(item.weight);
    const avgHr = positive(item.avgHr);
    const maxHr = positive(item.maxHr);
    const set: SessionSet = {
      start,
      seconds: Math.max(1, seconds),
      ...(reps !== undefined ? { reps } : {}),
      ...(timed ? { timed } : {}),
      // Grams.
      ...(weight !== undefined ? { weightKg: Math.round(weight / 10) / 100 } : {}),
      ...(avgHr !== undefined ? { avgHr } : {}),
      ...(maxHr !== undefined ? { maxHr } : {})
    };
    exercise.sets.push(set);
    last = set;
  }

  const exercises = order.map((key) => groups.get(key)!).filter((exercise) => exercise.sets.length > 0);
  return exercises.length > 0 ? exercises : undefined;
}

/** The card's row for each exercise, carrying its sets. */
export function sessionSetsCardExercises(
  exercises: SessionSetExercise[] | undefined
): ActivityVisualStrengthExercise[] {
  return (exercises ?? []).map((exercise) => {
    const loads = exercise.sets.flatMap((set) => (set.weightKg ? [set.weightKg] : []));
    const counted = exercise.sets.filter((set) => !set.timed);
    const volumeKg = counted.reduce(
      (sum, set) => sum + (set.weightKg && set.reps ? set.weightKg * set.reps : 0),
      0
    );
    return {
      nameKey: exercise.nameKey,
      ...(exercise.rawName ? { rawName: exercise.rawName } : {}),
      sets: exercise.sets.length,
      reps: counted.reduce((sum, set) => sum + (set.reps ?? 0), 0),
      ...(loads.length > 0 ? { minWeightKg: Math.min(...loads), maxWeightKg: Math.max(...loads) } : {}),
      ...(volumeKg > 0 ? { volumeKg: Math.round(volumeKg * 10) / 10 } : {}),
      setList: exercise.sets
    };
  });
}

/**
 * Heart rate on the session's clock, for the chart its sets are drawn on: a
 * set lasts half a minute, so the 60 points a run's card draws would average
 * every set into the rest beside it. Empty when the samples carry no clock.
 */
export function sessionSetsHeartRate(
  series: TrainingHubActivitySeriesPoint[] | undefined
): TrainingHubActivitySeriesPoint[] {
  const timed = (series ?? []).filter(
    (point) => point.elapsed !== undefined && point.hr !== undefined && Number.isFinite(point.hr)
  );
  return downsampleActivitySeries(timed, SETS_HR_POINTS).flatMap((point) =>
    point.elapsed !== undefined && point.hr !== undefined ? [{ elapsed: point.elapsed, hr: point.hr }] : []
  );
}
