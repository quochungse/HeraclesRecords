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
