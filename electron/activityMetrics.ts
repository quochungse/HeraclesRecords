// What one activity's detail payload says, reduced to the few numbers a list
// can hold.
//
// This module lives in `electron/` but is written for both layers, like
// `unitSystem.ts`: the main process computes a summary
// once when it has the payload, and the renderer computes the same figures live
// for the run it has open. Two implementations of a drift percentage would
// disagree the first time either was touched, and the disagreement would show
// as a list column that contradicts the page it opens. So there is one, and it
// imports nothing from `node:` — anything added here must keep that property or
// the renderer build breaks.

import type {
  ActivityDetailSummary,
  BestEffort,
  TrainingHubActivityDetail,
  TrainingHubActivityPause,
  TrainingHubActivitySeriesPoint,
  TrainingHubTrackPoint
} from "./types";

const METERS_PER_KM = 1000;
const SECONDS_PER_MINUTE = 60;

/** COROS's HR distribution has six buckets, one per entry in the zone list. */
const HR_BUCKET_COUNT = 6;

/**
 * Bump when the figures below change shape or meaning. Every stored summary
 * carries it, and one written by an older version is recomputed rather than
 * read — a drift percentage from a formula nobody uses any more is worse than
 * no drift percentage, because nothing about it looks wrong.
 */
export const ACTIVITY_SUMMARY_VERSION = 2;

/**
 * The Hall of Records' share of a summary — best efforts and a start point —
 * versioned apart from the figures above. Bumping `ACTIVITY_SUMMARY_VERSION`
 * to add them would have withheld every stored zone split and drift figure on
 * Running, Cycling and Activities until each run was fetched again; this way a
 * row keeps serving those while the records backfill fills in the rest.
 */
// 2: a stretch no longer crosses a GPS jump (`MAX_PLAUSIBLE_STEP_SPEED`).
export const RECORDS_SUMMARY_VERSION = 2;

/** 1K, 5K, 10K, half and full marathon, in metres. */
export const BEST_EFFORT_DISTANCES: readonly number[] = [
  1000, 5000, 10000, 21097.5, 42195
];

/**
 * Faster than this over a stretch is the GPS jumping, not the athlete running:
 * 7.6 m/s is 2:12/km, the world record over 1 000 m. A watch that loses its fix
 * under a bridge and finds it 300 m on would otherwise hand that run a 1K no
 * one has ever run.
 */
const MAX_PLAUSIBLE_RUN_SPEED = 7.6;

/**
 * And faster than this from one sample to the next is a fix jumping, wherever
 * it lands: 12 m/s is past the fastest 100 m ever run. The stretch test above
 * only sees an average, so a 300 m jump inside an honest 5:00/km kilometre
 * still read as a 3:30 1K; a stretch may not cross a step like this at all.
 */
const MAX_PLAUSIBLE_STEP_SPEED = 12;

/**
 * Outdoor runs, track included. An indoor run's distance is the footpod's or
 * the wrist's estimate, which is a calibration rather than a measurement, so a
 * treadmill session never sets a record here.
 */
const BEST_EFFORT_SPORT_TYPES: ReadonlySet<number> = new Set([100, 102, 103]);

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
 * Indexed by COROS's own `zoneIndex`, which is the index of the zone entry whose
 * range the time was spent in: bucket k runs from entry k−1's ceiling (exclusive)
 * to entry k's — so on a heart-rate-reserve account with ceilings 133/154/168,
 * bucket 2 is 155–168 bpm. Counting "bucket 0 is below zone 1" from there is how
 * a band table once landed a zone off.
 *
 * Scored against the model the *account* uses, which is the whole reason this
 * is worth keeping: the dashboard only ever carries LTHR
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

/**
 * The fastest stretch over each distance, on activity time.
 *
 * Two pointers over the cumulative distance: for every sample taken as the end
 * of a stretch, the start moves up to the last sample that still leaves the
 * distance covered, and the exact start is interpolated between it and the
 * next. Interpolating the start alone keeps the figure a whisker generous on a
 * sparse series rather than a whole sample interval slow.
 *
 * Pass the series on activity time (`withPausesRemoved`) — on the wall clock a
 * wait at a crossing is part of the stretch. A distance the run never covered
 * has no entry, and neither has one the GPS could only have covered by jumping.
 */
export function bestEfforts(
  series: readonly TrainingHubActivitySeriesPoint[] | undefined,
  distances: readonly number[] = BEST_EFFORT_DISTANCES
): BestEffort[] {
  const times: number[] = [];
  const dists: number[] = [];
  let furthest = 0;
  for (const point of series ?? []) {
    const elapsed = point.elapsed;
    const distance = point.distance;
    if (
      typeof elapsed !== "number" ||
      typeof distance !== "number" ||
      !Number.isFinite(elapsed) ||
      !Number.isFinite(distance) ||
      elapsed < 0 ||
      distance < 0
    ) {
      continue;
    }
    if (times.length > 0 && elapsed < times[times.length - 1]) {
      continue;
    }
    // Cumulative distance never goes back; a sample that reads less than one
    // before it is a correction, and holding the furthest keeps the pointers
    // honest.
    furthest = Math.max(furthest, distance);
    times.push(elapsed);
    dists.push(furthest);
  }

  if (times.length < 2) {
    return [];
  }

  // A step no runner could take breaks the series: the stretches either side
  // of it are measured on their own, so the best honest one is still found.
  const jumpsAt = new Set<number>();
  for (let index = 1; index < times.length; index += 1) {
    const covered = dists[index] - dists[index - 1];
    const took = times[index] - times[index - 1];
    if (covered > 0 && covered > took * MAX_PLAUSIBLE_STEP_SPEED) {
      jumpsAt.add(index);
    }
  }

  const efforts: BestEffort[] = [];
  for (const target of distances) {
    if (dists[dists.length - 1] - dists[0] < target) {
      continue;
    }
    let best = Number.POSITIVE_INFINITY;
    let start = 0;
    for (let end = 1; end < times.length; end += 1) {
      if (jumpsAt.has(end)) {
        start = end;
        continue;
      }
      while (start + 1 < end && dists[end] - dists[start + 1] >= target) {
        start += 1;
      }
      const covered = dists[end] - dists[start];
      if (covered < target) {
        continue;
      }
      // The start lies between `start` and `start + 1`: as late as it can be
      // while the stretch still measures the whole distance.
      const from = dists[end] - target;
      const next = start + 1;
      const span = dists[next] - dists[start];
      const startTime =
        next <= end && span > 0
          ? times[start] + ((from - dists[start]) / span) * (times[next] - times[start])
          : times[start];
      const seconds = times[end] - startTime;
      if (seconds > 0 && seconds < best) {
        best = seconds;
      }
    }
    if (Number.isFinite(best) && target / best <= MAX_PLAUSIBLE_RUN_SPEED) {
      efforts.push({ distance: target, seconds: Math.round(best * 10) / 10 });
    }
  }

  return efforts;
}

/** Two decimals of a degree: about a kilometre, which names a town and not a door. */
function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Where an activity began, as coarsely as the Hall of Records needs it: which
 * town, and how far from home. The first located point of the track, rounded.
 */
export function activityStartPoint(
  points: readonly TrainingHubTrackPoint[] | undefined
): { lat: number; lon: number } | undefined {
  for (const point of points ?? []) {
    const { lat, lon } = point;
    if (
      typeof lat === "number" &&
      typeof lon === "number" &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      // 0,0 is where a missing fix lands, not a place anyone trained.
      (lat !== 0 || lon !== 0)
    ) {
      return { lat: roundCoordinate(lat), lon: roundCoordinate(lon) };
    }
  }
  return undefined;
}

export interface ActivityDetailSummaryInput {
  activityId: string;
  fingerprint: string;
  detail: Pick<TrainingHubActivityDetail, "hrZones" | "series" | "pauses"> &
    Partial<Pick<TrainingHubActivityDetail, "sportType" | "track">>;
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
  const active = withPausesRemoved(detail.series ?? [], detail.pauses);
  const drift = paceHrDecoupling(active);
  const lastUpload = raw?.lastUploadTime;
  const efforts =
    detail.sportType !== undefined && BEST_EFFORT_SPORT_TYPES.has(detail.sportType)
      ? bestEfforts(active)
      : [];
  const startPoint = activityStartPoint(detail.track?.points);

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
    recordsVersion: RECORDS_SUMMARY_VERSION,
    ...(efforts.length > 0 ? { bestEfforts: efforts } : {}),
    ...(startPoint ? { startPoint } : {}),
    computedAt: now ?? Date.now()
  };
}

/**
 * A stretch of an activity, measured from its start in minutes of activity time
 * or kilometres; a negative `from` counts back from the end, so `{ unit: "km",
 * from: -5 }` is the last five kilometres.
 */
export interface ActivityWindow {
  unit: "minutes" | "km";
  from: number;
  to?: number;
}

export interface ActivityWindowSummary {
  /** Activity time, pauses taken out, where the stretch starts and ends. */
  startSeconds: number;
  endSeconds: number;
  startMeters?: number;
  endMeters?: number;
  durationSeconds: number;
  distanceMeters?: number;
  paceSecondsPerKm?: number;
  adjustedPaceSecondsPerKm?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgPower?: number;
  ascentMeters?: number;
  descentMeters?: number;
  samples: number;
}

function meanOf(values: (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) / present.length : undefined;
}

/**
 * The figures of one stretch of an activity, read off its recorded samples on
 * activity time — the answer to "how was my last 5 km", which the lap table
 * only gives when a lap happens to end there. Undefined when the samples do not
 * cover the stretch (no series, or no distance channel for a `km` window).
 */
export function summarizeActivityWindow(
  series: readonly TrainingHubActivitySeriesPoint[],
  pauses: readonly TrainingHubActivityPause[] | undefined,
  window: ActivityWindow
): ActivityWindowSummary | undefined {
  const byKm = window.unit === "km";
  const scale = byKm ? 1000 : 60;
  const axis = (point: TrainingHubActivitySeriesPoint) => (byKm ? point.distance : point.elapsed);
  const points = withPausesRemoved(series, pauses).filter(
    (point) => point.elapsed !== undefined && axis(point) !== undefined
  );
  if (points.length < 2) {
    return undefined;
  }

  const total = axis(points[points.length - 1]!)!;
  const edge = (value: number) => Math.min(Math.max(value < 0 ? total + value * scale : value * scale, 0), total);
  const from = edge(window.from);
  const to = window.to === undefined ? total : edge(window.to);
  const inside = points.filter((point) => axis(point)! >= Math.min(from, to) && axis(point)! <= Math.max(from, to));
  if (inside.length < 2) {
    return undefined;
  }

  const first = inside[0]!;
  const last = inside[inside.length - 1]!;
  const durationSeconds = last.elapsed! - first.elapsed!;
  const distanceMeters =
    first.distance !== undefined && last.distance !== undefined ? last.distance - first.distance : undefined;
  let ascentMeters = 0;
  let descentMeters = 0;
  let climbKnown = false;
  for (let index = 1; index < inside.length; index += 1) {
    const before = inside[index - 1]!.altitude;
    const after = inside[index]!.altitude;
    if (before === undefined || after === undefined) continue;
    climbKnown = true;
    if (after > before) ascentMeters += after - before;
    else descentMeters += before - after;
  }
  const hrs = inside.map((point) => point.hr).filter((value): value is number => value !== undefined && value > 0);

  return {
    startSeconds: first.elapsed!,
    endSeconds: last.elapsed!,
    ...(first.distance !== undefined ? { startMeters: first.distance } : {}),
    ...(last.distance !== undefined ? { endMeters: last.distance } : {}),
    durationSeconds,
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(distanceMeters !== undefined && distanceMeters > 0 && durationSeconds > 0
      ? { paceSecondsPerKm: durationSeconds / (distanceMeters / 1000) }
      : {}),
    // Paces average by their speeds: the mean of seconds-per-km over samples
    // even in time weighs the slow ones up, and read 11:17 against a 9:50 pace.
    ...optional("adjustedPaceSecondsPerKm", harmonicMeanOf(inside.map((point) => point.adjustedPace))),
    ...optional("avgHr", meanOf(hrs)),
    ...(hrs.length > 0 ? { maxHr: Math.max(...hrs) } : {}),
    ...optional("avgCadence", meanOf(inside.map((point) => point.cadence))),
    ...optional("avgPower", meanOf(inside.map((point) => point.power))),
    ...(climbKnown ? { ascentMeters, descentMeters } : {}),
    samples: inside.length
  };
}

function harmonicMeanOf(values: (number | undefined)[]): number | undefined {
  const speeds = meanOf(values.map((value) => (value !== undefined && value > 0 ? 1 / value : undefined)));
  return speeds === undefined ? undefined : 1 / speeds;
}

function optional<Key extends string>(key: Key, value: number | undefined): Partial<Record<Key, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, number>);
}
