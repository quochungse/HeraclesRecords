import type { TrainingHubActivitySeriesPoint } from "./types";

/**
 * Reducing an activity's recorded samples to a drawable number of them.
 *
 * Shared rather than owned by either caller: `parseActivitySeries` returns
 * every sample COROS recorded — thousands on a long run — and two very
 * different readers need fewer. The chat tools print ~60 rows into a prompt;
 * the Running chart draws a few hundred points per channel. The bucket rules
 * below are what must not diverge between them: a second copy that averaged
 * `distance` instead of taking the bucket's last value would quietly redraw the
 * x-axis, and nothing would fail.
 */

/**
 * Channels that progress rather than fluctuate. A bucket takes its **last**
 * value so the axis still reads as a progression. Altitude is cumulative in
 * neither sense but is a position, not a rate, so the last reading is the one
 * that belongs at the bucket's distance.
 */
const SERIES_LAST_VALUE_CHANNELS = [
  "elapsed",
  "distance",
  "altitude"
] as const satisfies readonly (keyof TrainingHubActivitySeriesPoint)[];

/** Measured channels, averaged over the bucket, each with its own precision. */
const SERIES_MEAN_CHANNELS = [
  ["hr", 0],
  ["pace", 0],
  ["adjustedPace", 0],
  ["power", 0],
  ["cadence", 0],
  ["strideLength", 2],
  ["groundTime", 0],
  ["verticalOscillation", 1],
  ["verticalRatio", 1]
] as const satisfies readonly [keyof TrainingHubActivitySeriesPoint, number][];

function roundTo(value: number | undefined, decimals: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function bucketChannel(
  bucket: TrainingHubActivitySeriesPoint[],
  channel: keyof TrainingHubActivitySeriesPoint
): number[] {
  return bucket
    .map((item) => item[channel])
    .filter((value): value is number => value !== undefined);
}

export function downsampleActivitySeries(
  points: TrainingHubActivitySeriesPoint[],
  maxPoints = 60
): TrainingHubActivitySeriesPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const bucketSize = points.length / maxPoints;
  const sampled: TrainingHubActivitySeriesPoint[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    const start = Math.floor(index * bucketSize);
    const end = Math.min(points.length, Math.floor((index + 1) * bucketSize));
    const bucket = points.slice(start, end);
    if (bucket.length === 0) {
      continue;
    }

    const point: TrainingHubActivitySeriesPoint = {};

    for (const channel of SERIES_LAST_VALUE_CHANNELS) {
      const value = bucketChannel(bucket, channel).at(-1);
      if (value !== undefined) {
        point[channel] = value;
      }
    }

    for (const [channel, decimals] of SERIES_MEAN_CHANNELS) {
      const values = bucketChannel(bucket, channel);
      if (values.length > 0) {
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        point[channel] = roundTo(mean, decimals);
      }
    }

    if (Object.values(point).some((value) => value !== undefined)) {
      sampled.push(point);
    }
  }

  return sampled;
}

/**
 * The chart's reduction, which keeps every peak and trough instead of averaging
 * them away.
 *
 * `downsampleActivitySeries` answers a prompt, where a bucket's mean is the
 * figure worth printing. A chart is read by its shape, and a mean flattens it:
 * a five-second surge inside a nine-second bucket came out a ripple, and so
 * did every stop. Here each bucket becomes two rows — its first sample's
 * position and its last's — and each measured channel puts its lowest and
 * highest readings on them in the order they happened. Every value drawn was
 * recorded; what moves is only where inside its bucket it is drawn, by under
 * one bucket's width.
 *
 * A series no longer than `maxPoints` is returned as it is.
 */
export function envelopeActivitySeries(
  points: readonly TrainingHubActivitySeriesPoint[],
  maxPoints: number
): TrainingHubActivitySeriesPoint[] {
  if (points.length <= maxPoints) {
    return [...points];
  }

  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = points.length / buckets;
  const rows: TrainingHubActivitySeriesPoint[] = [];

  for (let index = 0; index < buckets; index += 1) {
    const start = Math.floor(index * bucketSize);
    const end = Math.min(points.length, Math.floor((index + 1) * bucketSize));
    if (end <= start) {
      continue;
    }
    const opening = positionAt(points, start, start, end);
    const closing = positionAt(points, end - 1, start, end);

    for (const [channel] of SERIES_MEAN_CHANNELS) {
      let low: { at: number; value: number } | undefined;
      let high: { at: number; value: number } | undefined;
      for (let at = start; at < end; at += 1) {
        const value = points[at]![channel];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (low === undefined || value < low.value) low = { at, value };
        if (high === undefined || value > high.value) high = { at, value };
      }
      if (low === undefined || high === undefined) continue;
      const [first, second] = low.at <= high.at ? [low, high] : [high, low];
      opening[channel] = first.value;
      closing[channel] = second.value;
    }

    rows.push(opening, closing);
  }

  return rows;
}

/**
 * A row standing at one sample's place on both axes. Elevation is a position
 * too, so it is read where the row stands, or from the bucket's nearest reading
 * when that sample has none.
 */
function positionAt(
  points: readonly TrainingHubActivitySeriesPoint[],
  at: number,
  start: number,
  end: number
): TrainingHubActivitySeriesPoint {
  const row: TrainingHubActivitySeriesPoint = {};
  for (const channel of SERIES_LAST_VALUE_CHANNELS) {
    for (let offset = 0; offset < end - start; offset += 1) {
      const candidates = [at - offset, at + offset];
      const found = candidates
        .filter((near) => near >= start && near < end)
        .map((near) => points[near]![channel])
        .find((value): value is number => typeof value === "number");
      if (found !== undefined) {
        row[channel] = found;
        break;
      }
    }
  }
  return row;
}

/**
 * How many seconds a channel is averaged over before the chart draws it, for
 * the channels whose one-second readings are noisier than what they measure.
 *
 * Pace and effort pace come off GPS, which places each second a few metres
 * off, so a steady run read second by second jumps 20 s/km either way. Power
 * swings with every stride and every pedal stroke — five seconds is what bike
 * computers show. The form figures are per-step estimates and wobble the same
 * way; cadence a little, so it takes less. Heart rate is left as recorded: the
 * sensor already averages, and a smoothed peak is a peak that never happened.
 * Elevation is drawn as a curve of its own, and the climbing rate is already a
 * two-minute rate.
 */
const SMOOTHING_SECONDS: readonly [keyof TrainingHubActivitySeriesPoint, number][] = [
  ["pace", 5],
  ["adjustedPace", 5],
  ["power", 5],
  ["cadence", 3],
  ["strideLength", 5],
  ["groundTime", 5],
  ["verticalOscillation", 5],
  ["verticalRatio", 5]
];

/** Paces are averaged as speeds: the mean of 4:00 and 6:00 /km is not 5:00 of running. */
const AVERAGED_AS_SPEED = new Set<keyof TrainingHubActivitySeriesPoint>(["pace", "adjustedPace"]);

/**
 * Each noisy channel as a centred moving average over its window on the
 * series' own clock, so a jump in `elapsed` — a dropout, or a pause on the wall
 * clock — is never averaged across, and a stop that carries no pace stays a gap
 * rather than being filled in. On activity time, which the sport pages hand it,
 * a pause is already taken out, and the few seconds either side of one are
 * averaged together as the watch recorded them: back to back. A series without
 * a clock is averaged over that many samples instead, a sample a second being
 * what COROS records.
 *
 * For the chart only: every figure the screen states is worked out from the
 * recorded samples.
 */
export function smoothActivitySeries(
  points: readonly TrainingHubActivitySeriesPoint[]
): TrainingHubActivitySeriesPoint[] {
  if (points.length < 3) {
    return [...points];
  }
  let clock = points.map((point) =>
    typeof point.elapsed === "number" && Number.isFinite(point.elapsed) ? point.elapsed : Number.NaN
  );
  const timed = clock.every((at, index) => Number.isFinite(at) && (index === 0 || at >= clock[index - 1]!));
  if (!timed) {
    clock = points.map((_, index) => index);
  }

  const smoothed = points.map((point) => ({ ...point }));
  for (const [channel, seconds] of SMOOTHING_SECONDS) {
    const half = seconds / 2;
    const asSpeed = AVERAGED_AS_SPEED.has(channel);
    const read = (index: number): number | undefined => {
      const value = points[index]![channel];
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      if (asSpeed) return value > 0 ? 1 / value : undefined;
      return value;
    };

    let low = 0;
    let high = -1;
    let sum = 0;
    let count = 0;
    for (let index = 0; index < points.length; index += 1) {
      while (high + 1 < points.length && clock[high + 1]! <= clock[index]! + half) {
        high += 1;
        const value = read(high);
        if (value !== undefined) {
          sum += value;
          count += 1;
        }
      }
      while (clock[low]! < clock[index]! - half) {
        const value = read(low);
        if (value !== undefined) {
          sum -= value;
          count -= 1;
        }
        low += 1;
      }
      if (read(index) === undefined || count === 0) {
        continue;
      }
      const mean = sum / count;
      smoothed[index]![channel] = asSpeed ? 1 / mean : mean;
    }
  }
  return smoothed;
}
