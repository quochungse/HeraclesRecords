// What one activity's detail payload says, reduced to the few numbers a list
// can hold.
//
// This module lives in `electron/` but is written for both layers, like
// `unitSystem.ts` and `watchModels.ts`: the main process computes a summary
// once when it has the payload, and the renderer computes the same figures live
// for the run it has open. Two implementations of a drift percentage would
// disagree the first time either was touched, and the disagreement would show
// as a list column that contradicts the page it opens. So there is one, and it
// imports nothing from `node:` — anything added here must keep that property or
// the renderer build breaks.

import type {
  ActivityDetailSummary,
  TrainingHubActivityDetail,
  TrainingHubActivityPause,
  TrainingHubActivitySeriesPoint
} from "./types";

const METERS_PER_KM = 1000;
const SECONDS_PER_MINUTE = 60;

/** COROS's HR distribution has six buckets: below zone 1, then zones 1-5. */
const HR_BUCKET_COUNT = 6;

/**
 * Bump when the figures below change shape or meaning. Every stored summary
 * carries it, and one written by an older version is recomputed rather than
 * read — a drift percentage from a formula nobody uses any more is worse than
 * no drift percentage, because nothing about it looks wrong.
 */
export const ACTIVITY_SUMMARY_VERSION = 2;

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export interface RunDecoupling {
  /** Metres per minute per beat over the first half. */
  firstHalf: number;
  secondHalf: number;
  /** Percent the ratio fell by. Positive means drift — the run cost more. */
  percent: number;
}

/** Samples needed in each half before a decoupling figure means anything. */
const MIN_DECOUPLING_SAMPLES_PER_HALF = 10;

/**
 * The opening stretch a decoupling figure leaves out. Heart rate lags the pace
 * at the start of every run, so a first half that includes it buys more ground
 * per beat than the running did. On real 10–15 km runs the first ten minutes
 * averaged 10–19 bpm under the rest, and a run that held within 2.4% read as
 * 7.8% drift with them in.
 */
const DECOUPLING_WARMUP_SECONDS = 600;

/** Running left after the warm-up before two halves of it say anything — the
 *  same twenty minutes the efficiency chart asks of a run. */
const MIN_DECOUPLING_SPAN_SECONDS = 1200;

function halfEfficiency(
  points: readonly TrainingHubActivitySeriesPoint[]
): number | undefined {
  let speedTotal = 0;
  let hrTotal = 0;
  let samples = 0;

  for (const point of points) {
    const pace = positive(point.pace);
    const hr = positive(point.hr);
    if (pace === undefined || hr === undefined) {
      continue;
    }
    // pace is seconds per km, so metres per minute is 1000 / (pace / 60).
    speedTotal += (METERS_PER_KM * SECONDS_PER_MINUTE) / pace;
    hrTotal += hr;
    samples += 1;
  }

  if (samples < MIN_DECOUPLING_SAMPLES_PER_HALF) {
    return undefined;
  }

  return speedTotal / samples / (hrTotal / samples);
}

/**
 * Aerobic decoupling: how much further apart pace and heart rate drifted over
 * the run. Above roughly 5% the athlete was running beyond what they could hold.
 *
 * Measured after the warm-up (`DECOUPLING_WARMUP_SECONDS`) and split on elapsed
 * time, because splitting an array in half splits on *samples* — and a watch
 * that samples on distance puts more of them in the fast half. Pass the series
 * on activity time (`withPausesRemoved`): on the wall clock a long stop moves
 * both the warm-up's end and the midpoint.
 */
export function paceHrDecoupling(
  series: readonly TrainingHubActivitySeriesPoint[] | undefined
): RunDecoupling | undefined {
  if (!series || series.length < MIN_DECOUPLING_SAMPLES_PER_HALF * 2) {
    return undefined;
  }

  // Zero is a real elapsed reading — the first sample of every activity — so
  // this cannot go through `positive`, which would drop it and start the
  // warm-up late. A loop, not `Math.min(...values)`: a long ultra is tens of
  // thousands of samples, past what a spread can pass as arguments.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const stamped: TrainingHubActivitySeriesPoint[] = [];
  for (const point of series) {
    const value = point.elapsed;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      stamped.push(point);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  // Without a clock over most of the run there is no telling where the warm-up
  // ends, and a figure with it left in is the one this function exists to not
  // give. Up to half may be missing — the parser keeps a channel any sample
  // carries, so a timestamp that drops out over the closing kilometres leaves
  // holes — and those samples sit out rather than land at elapsed 0, which
  // scored the end of the run into its first half.
  if (stamped.length < series.length / 2) {
    return undefined;
  }

  const warmupEnd = min + DECOUPLING_WARMUP_SECONDS;
  if (max - warmupEnd < MIN_DECOUPLING_SPAN_SECONDS) {
    return undefined;
  }

  const midpoint = (warmupEnd + max) / 2;
  const first: TrainingHubActivitySeriesPoint[] = [];
  const second: TrainingHubActivitySeriesPoint[] = [];
  for (const point of stamped) {
    const value = point.elapsed as number;
    if (value < warmupEnd) {
      continue;
    }
    (value <= midpoint ? first : second).push(point);
  }

  const firstHalf = halfEfficiency(first);
  const secondHalf = halfEfficiency(second);
  if (firstHalf === undefined || secondHalf === undefined || firstHalf <= 0) {
    return undefined;
  }

  return {
    firstHalf,
    secondHalf,
    percent: ((firstHalf - secondHalf) / firstHalf) * 100
  };
}

/**
 * Where a wall-clock moment lands on the activity clock: the time elapsed less
 * every pause that had begun by then. A moment inside a pause lands on the
 * instant it began, so the line resumes where it stopped instead of leaving a
 * gap the width of the wait. `pauses` must be in order, as the parser leaves them.
 */
export function activeElapsed(
  elapsed: number,
  pauses: readonly TrainingHubActivityPause[]
): number {
  let paused = 0;
  for (const pause of pauses) {
    if (pause.start >= elapsed) {
      break;
    }
    paused += Math.min(pause.duration, elapsed - pause.start);
  }
  return elapsed - paused;
}

/**
 * A run's samples on activity time.
 *
 * The series is stamped by the wall clock and simply stops while the watch is
 * paused, so plotted as sent a pause is a flat stretch as long as the wait, the
 * laps — which COROS times without pauses — drift off their own boundaries, and
 * a selection across it reports a duration nobody ran.
 */
export function withPausesRemoved(
  series: readonly TrainingHubActivitySeriesPoint[],
  pauses: readonly TrainingHubActivityPause[] | undefined
): TrainingHubActivitySeriesPoint[] {
  const ordered = (pauses ?? [])
    .filter((pause) => pause.start >= 0 && pause.duration > 0)
    .sort((left, right) => left.start - right.start);
  if (ordered.length === 0) {
    return [...series];
  }

  return series.map((point) =>
    point.elapsed === undefined
      ? point
      : { ...point, elapsed: activeElapsed(point.elapsed, ordered) }
  );
}

/**
 * The six HR buckets as plain seconds, or nothing when COROS scored none.
 *
 * Indexed by COROS's own `zoneIndex`, so bucket 0 is the time below zone 1 and
 * the rest are zones 1-5. Scored against the model the *account* uses, which is
 * the whole reason this is worth keeping: the dashboard only ever carries LTHR
 * zones, so an account on heart-rate reserve cannot be placed from the list.
 */
export function hrZoneSeconds(
  detail: Pick<TrainingHubActivityDetail, "hrZones">
): number[] | undefined {
  const buckets = detail.hrZones;
  if (buckets.length === 0) {
    return undefined;
  }

  const seconds = new Array<number>(HR_BUCKET_COUNT).fill(0);
  let scored = false;
  for (const bucket of buckets) {
    const index = bucket.index;
    const value = bucket.seconds;
    if (
      index < 0 ||
      index >= HR_BUCKET_COUNT ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      continue;
    }
    seconds[index] = value;
    if (value > 0) {
      scored = true;
    }
  }

  return scored ? seconds : undefined;
}

export interface ActivityDetailSummaryInput {
  activityId: string;
  fingerprint: string;
  detail: Pick<TrainingHubActivityDetail, "hrZones" | "series" | "pauses">;
  /** The payload as COROS sent it, for the fields the parser has no use for. */
  raw?: Record<string, unknown>;
  now?: number;
}

/**
 * The ~130 bytes worth keeping out of a 2.5 MB payload.
 *
 * Everything else a run list shows — distance, time, pace, average heart rate —
 * already arrives with the activity list. These two do not: COROS's own zone
 * scoring, and a drift figure that needs every sample to compute and none to
 * store.
 */
export function summarizeActivityDetail(
  input: ActivityDetailSummaryInput
): ActivityDetailSummary {
  const { activityId, fingerprint, detail, raw, now } = input;
  const drift = paceHrDecoupling(
    withPausesRemoved(detail.series ?? [], detail.pauses)
  );
  const lastUpload = raw?.lastUploadTime;

  return {
    activityId,
    fingerprint,
    summaryVersion: ACTIVITY_SUMMARY_VERSION,
    zoneSeconds: hrZoneSeconds(detail),
    decouplingPercent: drift?.percent,
    lastUploadTime:
      typeof lastUpload === "number" && Number.isFinite(lastUpload) && lastUpload > 0
        ? lastUpload
        : undefined,
    computedAt: now ?? Date.now()
  };
}
