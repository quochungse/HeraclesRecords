import type { Theme } from "../theme/theme";
import type { TrainingHubActivitySeriesPoint } from "../../electron/types";

/**
 * The channels a run's chart can draw, and what each one is.
 *
 * Every entry here was verified present on a live COROS road run before it was
 * offered: `frequencyList` carries all of them, at very nearly full coverage,
 * once the parser stops discarding a channel over its warm-up gaps. A chip is
 * still only shown when *this* run has the readings, because a wrist-only easy
 * run carries heart rate and pace and none of the running-form group.
 */
export type RunChannelKey =
  | "pace"
  | "adjustedPace"
  | "hr"
  | "cadence"
  | "power"
  | "strideLength"
  | "groundTime"
  | "verticalOscillation"
  | "verticalRatio"
  | "altitude";

export interface RunChannelDefinition {
  key: RunChannelKey;
  label: string;
  /** Axis label — short enough to sit in a 40px gutter. */
  short: string;
  /** Metric unit as parsed; pace and altitude are converted at render time. */
  unit: string;
  decimals: number;
  /**
   * Faster is a *smaller* number of seconds, so a pace axis that runs the usual
   * way puts the athlete's best effort at the bottom of the chart.
   */
  reversed?: boolean;
  /**
   * Altitude is the ground the other channels are read against, not a series
   * competing for an axis: it draws as a filled area behind everything and
   * never takes a gutter.
   */
  background?: boolean;
}

export const RUN_CHANNELS: readonly RunChannelDefinition[] = [
  { key: "pace", label: "Pace", short: "Pace", unit: "/km", decimals: 0, reversed: true },
  {
    key: "adjustedPace",
    label: "Grade-adjusted pace",
    short: "GAP",
    unit: "/km",
    decimals: 0,
    reversed: true
  },
  { key: "hr", label: "Heart rate", short: "bpm", unit: "bpm", decimals: 0 },
  { key: "cadence", label: "Cadence", short: "spm", unit: "spm", decimals: 0 },
  { key: "power", label: "Power", short: "W", unit: "W", decimals: 0 },
  { key: "strideLength", label: "Stride length", short: "m", unit: "m", decimals: 2 },
  { key: "groundTime", label: "Ground contact", short: "ms", unit: "ms", decimals: 0 },
  {
    key: "verticalOscillation",
    label: "Vertical oscillation",
    short: "cm",
    unit: "cm",
    decimals: 1
  },
  { key: "verticalRatio", label: "Vertical ratio", short: "%", unit: "%", decimals: 1 },
  { key: "altitude", label: "Elevation", short: "m", unit: "m", decimals: 0, background: true }
];

export function runChannel(key: RunChannelKey): RunChannelDefinition {
  return RUN_CHANNELS.find((channel) => channel.key === key) ?? RUN_CHANNELS[0]!;
}

/**
 * Two axes and no more. A third gutter leaves the plot narrower than the labels
 * around it, and three differently-scaled lines on shared gridlines cannot be
 * read against each other anyway — which is the only reason to overlay them.
 */
export const MAX_SELECTED_CHANNELS = 2;

/** A channel with fewer readings than this cannot be drawn as a line. */
const MIN_CHANNEL_SAMPLES = 2;

/**
 * How much a run has to rise and fall before its elevation is terrain.
 *
 * A barometric altimeter wanders a metre or two over an hour, and the readings
 * arrive as whole metres — so a flat city run draws a backdrop that steps
 * between 4 m and 6 m and reads as a bar chart of nothing, right under the
 * lines it is supposed to sit behind. Below this the backdrop is not offered
 * at all, which is also the honest answer: that run had no elevation profile.
 */
const MIN_ALTITUDE_RANGE_METERS = 10;

function channelRange(
  series: readonly TrainingHubActivitySeriesPoint[],
  key: RunChannelKey
): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of series) {
    const value = point[key];
    if (typeof value === "number") {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
}

/** How many samples a channel actually has in this run. */
export function countChannelSamples(
  series: readonly TrainingHubActivitySeriesPoint[],
  key: RunChannelKey
): number {
  let count = 0;
  for (const point of series) {
    if (typeof point[key] === "number") {
      count += 1;
    }
  }
  return count;
}

/** The channels this run can actually draw, in the order they are offered. */
export function availableRunChannels(
  series: readonly TrainingHubActivitySeriesPoint[]
): RunChannelDefinition[] {
  return RUN_CHANNELS.filter((channel) => {
    if (countChannelSamples(series, channel.key) < MIN_CHANNEL_SAMPLES) {
      return false;
    }
    return (
      channel.key !== "altitude" ||
      channelRange(series, "altitude") >= MIN_ALTITUDE_RANGE_METERS
    );
  });
}

/**
 * What the chart opens on: pace against heart rate, the pair that says whether
 * the run went the way it was meant to. Falls back to whatever the watch did
 * record, so an indoor run with no pace still opens on something.
 */
const PREFERRED_CHANNELS: readonly RunChannelKey[] = ["pace", "hr"];

export function defaultSelectedChannels(
  available: readonly RunChannelDefinition[]
): RunChannelKey[] {
  const axisKeys = available
    .filter((channel) => !channel.background)
    .map((channel) => channel.key);

  const chosen = PREFERRED_CHANNELS.filter((key) => axisKeys.includes(key));

  // Pace and heart rate are not a fixed pair — they are the pair *worth*
  // opening on. Whatever the watch did record fills any gap, so an indoor run
  // with neither still opens on something rather than on an empty plot.
  for (const key of axisKeys) {
    if (chosen.length >= MAX_SELECTED_CHANNELS) {
      break;
    }
    if (!chosen.includes(key)) {
      chosen.push(key);
    }
  }

  return chosen;
}

/**
 * Toggling a channel, with the two-axis cap applied by **dropping the oldest**
 * rather than refusing the press. A chip that does nothing when clicked reads
 * as broken; one that quietly replaces what it has to is understood at once.
 */
export function toggleRunChannel(
  selected: readonly RunChannelKey[],
  key: RunChannelKey
): RunChannelKey[] {
  if (selected.includes(key)) {
    return selected.filter((entry) => entry !== key);
  }

  const next = [...selected, key];
  return next.length > MAX_SELECTED_CHANNELS
    ? next.slice(next.length - MAX_SELECTED_CHANNELS)
    : next;
}

export interface RunChannelColors {
  stroke: string;
  /** Translucent fill for the elevation backdrop. */
  fill: string;
}

const DARK_CHANNEL_COLORS: Record<RunChannelKey, RunChannelColors> = {
  pace: { stroke: "#74c08f", fill: "rgba(116, 192, 143, 0.18)" },
  adjustedPace: { stroke: "#4fd1c5", fill: "rgba(79, 209, 197, 0.18)" },
  hr: { stroke: "#f87171", fill: "rgba(248, 113, 113, 0.18)" },
  cadence: { stroke: "#b79bff", fill: "rgba(183, 155, 255, 0.18)" },
  power: { stroke: "#f3bf5c", fill: "rgba(243, 191, 92, 0.18)" },
  strideLength: { stroke: "#7ab8ff", fill: "rgba(122, 184, 255, 0.18)" },
  groundTime: { stroke: "#fb923c", fill: "rgba(251, 146, 60, 0.18)" },
  verticalOscillation: { stroke: "#f472b6", fill: "rgba(244, 114, 182, 0.18)" },
  verticalRatio: { stroke: "#a3e635", fill: "rgba(163, 230, 53, 0.18)" },
  altitude: { stroke: "rgba(255, 255, 255, 0.22)", fill: "rgba(255, 255, 255, 0.07)" }
};

const PAPER_CHANNEL_COLORS: Record<RunChannelKey, RunChannelColors> = {
  pace: { stroke: "#1f7a55", fill: "rgba(31, 122, 85, 0.16)" },
  adjustedPace: { stroke: "#0f766e", fill: "rgba(15, 118, 110, 0.16)" },
  hr: { stroke: "#c2410c", fill: "rgba(194, 65, 12, 0.16)" },
  cadence: { stroke: "#6d28d9", fill: "rgba(109, 40, 217, 0.16)" },
  power: { stroke: "#a16207", fill: "rgba(161, 98, 7, 0.16)" },
  strideLength: { stroke: "#1d4ed8", fill: "rgba(29, 78, 216, 0.16)" },
  groundTime: { stroke: "#b45309", fill: "rgba(180, 83, 9, 0.16)" },
  verticalOscillation: { stroke: "#be185d", fill: "rgba(190, 24, 93, 0.16)" },
  verticalRatio: { stroke: "#4d7c0f", fill: "rgba(77, 124, 15, 0.16)" },
  altitude: { stroke: "rgba(60, 50, 35, 0.2)", fill: "rgba(60, 50, 35, 0.08)" }
};

export function runChannelColors(theme: Theme): Record<RunChannelKey, RunChannelColors> {
  return theme === "paper" ? PAPER_CHANNEL_COLORS : DARK_CHANNEL_COLORS;
}
