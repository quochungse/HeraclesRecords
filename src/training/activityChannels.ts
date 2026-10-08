import type { Theme } from "../theme/theme";
import type { TrainingHubActivitySeriesPoint } from "../../electron/types";

import { t } from "../i18n/core";
/**
 * The channels an activity's chart can draw, and what each one is.
 *
 * Every entry here was verified present on a live COROS road run before it was
 * offered: `frequencyList` carries all of them, at very nearly full coverage,
 * once the parser stops discarding a channel over its warm-up gaps. A chip is
 * still only shown when *this* activity has the readings, which is also what
 * makes the list sport-agnostic: a ride offers power and no stride length, a
 * wrist-only easy run offers heart rate and pace and none of the form group,
 * and a strength session offers heart rate alone.
 *
 * It lived under `src/running/` and only Running drew it, while the Activities
 * detail pane — reading the same payload — drew elevation and nothing else.
 */
export type ActivityChannelKey =
  | "pace"
  | "adjustedPace"
  | "speed"
  | "hr"
  | "cadence"
  | "power"
  | "strideLength"
  | "groundTime"
  | "verticalOscillation"
  | "verticalRatio"
  | "verticalSpeed"
  | "altitude";

/**
 * How an activity's movement is read: as a pace, the way a run is, as a
 * speed, the way a ride is, or as a hike — a speed along the trail and a rate
 * up it. The samples are the same — COROS sends every sport a `pace` in
 * seconds per kilometre — but a cyclist reads 32 km/h, not 1:52/km, and a
 * pace axis also runs the wrong way for them; a walker reads 3 km/h and
 * 450 m an hour, and a 19:40/km pace says nothing to them at all. Speed and
 * the climbing rate are worked out from the samples (`withSpeed`,
 * `withVerticalSpeed`), so no parser has to know about either.
 *
 * A trail run is read as a run — pace and grade-adjusted pace, which is still
 * how a runner speaks — with a hike's climbing rate beside them, because on a
 * trail the pace mostly says how steep the ground was.
 */
export type ActivityMotion = "pace" | "speed" | "hike" | "trail";

/** A sample as the chart reads it: the series point, plus what the chart derives from it. */
export type ActivityChannelPoint = TrainingHubActivitySeriesPoint & {
  /** Kilometres per hour, from `pace`. Only set by `withSpeed`. */
  speed?: number;
  /** Metres gained an hour, negative on the way down. Only set by `withVerticalSpeed`. */
  verticalSpeed?: number;
};

export interface ActivityChannelDefinition {
  key: ActivityChannelKey;
  label: string;
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

// `unit` is the fixed suffix for a channel whose unit does not follow the
// athlete. Pace, altitude and every other unit-bearing channel are formatted by
// `ActivitySeriesChart` from `unitSystem` and never read this field — so the
// "/km" that used to sit on the two pace rows was a second, frozen answer to a
// question already answered elsewhere, one edit away from being shown.
/** A channel whose label is read in the language on screen each time it is asked for. */
function channel(
  key: ActivityChannelKey,
  rest: Omit<ActivityChannelDefinition, "key" | "label">
): ActivityChannelDefinition {
  return {
    key,
    get label() {
      return t(`activity.channel.${key}` as const);
    },
    ...rest
  };
}

const ACTIVITY_CHANNELS: readonly ActivityChannelDefinition[] = [
  channel("pace", { unit: "", decimals: 0, reversed: true }),
  channel("adjustedPace", { unit: "", decimals: 0, reversed: true }),
  channel("speed", { unit: "", decimals: 1 }),
  channel("hr", { unit: "bpm", decimals: 0 }),
  channel("cadence", { unit: "spm", decimals: 0 }),
  channel("power", { unit: "W", decimals: 0 }),
  channel("strideLength", { unit: "m", decimals: 2 }),
  channel("groundTime", { unit: "ms", decimals: 0 }),
  channel("verticalOscillation", { unit: "cm", decimals: 1 }),
  channel("verticalRatio", { unit: "%", decimals: 1 }),
  channel("verticalSpeed", { unit: "", decimals: 0 }),
  channel("altitude", { unit: "m", decimals: 0, background: true })
];

export function activityChannel(key: ActivityChannelKey): ActivityChannelDefinition {
  return ACTIVITY_CHANNELS.find((channel) => channel.key === key) ?? ACTIVITY_CHANNELS[0]!;
}

/**
 * Two axes and no more. A third gutter leaves the plot narrower than the labels
 * around it, and three differently-scaled lines on shared gridlines cannot be
 * read against each other anyway — which is the only reason to overlay them.
 */
const MAX_SELECTED_CHANNELS = 2;

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

/**
 * The channels that belong to one way of reading movement and no other. Pace
 * is read one way, speed the other, never both on one chart; the climbing rate
 * is read on foot in the hills. A channel not listed here is offered whenever
 * it was recorded.
 */
const MOTION_ONLY: Partial<Record<ActivityChannelKey, readonly ActivityMotion[]>> = {
  pace: ["pace", "trail"],
  adjustedPace: ["pace", "trail"],
  speed: ["speed", "hike"],
  verticalSpeed: ["hike", "trail"]
};

function isOtherMotion(key: ActivityChannelKey, motion: ActivityMotion): boolean {
  const owners = MOTION_ONLY[key];
  return owners !== undefined && !owners.includes(motion);
}

/**
 * Kilometres per hour on every sample that has a pace. A sample stopped at a
 * junction carries no pace, and gets no speed rather than a zero: the line
 * bridges it the way it bridges a heart-rate dropout.
 */
export function withSpeed(
  series: readonly TrainingHubActivitySeriesPoint[]
): ActivityChannelPoint[] {
  return series.map((point) =>
    typeof point.pace === "number" && Number.isFinite(point.pace) && point.pace > 0
      ? { ...point, speed: 3600 / point.pace }
      : point
  );
}

/** At least this far either side of a sample, its climbing rate is taken over. */
const VERTICAL_SPEED_WINDOW_SECONDS = 60;

/**
 * Metres gained an hour on every sample, over at least two minutes centred on
 * it. A barometer steps in whole metres, so a rate from one second to the next
 * is either 0 or 3,600 m/h; over a minute it is still every breather on the
 * pitch; over two it is the climb. The window reaches to the first sample at
 * least a minute either side, so the chart's downsampled rows
 * — one every fifty seconds on a long day — are read against their
 * neighbours rather than not at all. Standing still reads 0, which is what it
 * was; a gap in the clock several times the usual step (a dropout) is never
 * spanned, since a climb read across it would be a climb made in no time.
 */
export function withVerticalSpeed(
  series: readonly ActivityChannelPoint[]
): ActivityChannelPoint[] {
  const timed = series.flatMap((point, index) =>
    typeof point.elapsed === "number" &&
    Number.isFinite(point.elapsed) &&
    typeof point.altitude === "number" &&
    Number.isFinite(point.altitude)
      ? [{ index, elapsed: point.elapsed, altitude: point.altitude }]
      : []
  );
  if (timed.length < 3) {
    return [...series];
  }
  const steps = timed
    .slice(1)
    .map((point, at) => point.elapsed - timed[at]!.elapsed)
    .filter((step) => step > 0)
    .sort((left, right) => left - right);
  const usualStep = steps[Math.floor(steps.length / 2)] ?? 1;
  const longestSpan = VERTICAL_SPEED_WINDOW_SECONDS * 2 + usualStep * 3;

  const rates = new Map<number, number>();
  let low = 0;
  let high = 0;
  for (let at = 0; at < timed.length; at += 1) {
    const here = timed[at]!;
    while (low < at && timed[low + 1]!.elapsed <= here.elapsed - VERTICAL_SPEED_WINDOW_SECONDS) {
      low += 1;
    }
    if (high < at) high = at;
    while (high < timed.length - 1 && timed[high]!.elapsed < here.elapsed + VERTICAL_SPEED_WINDOW_SECONDS) {
      high += 1;
    }
    const from = timed[low]!;
    const to = timed[high]!;
    const span = to.elapsed - from.elapsed;
    if (span <= 0 || span > longestSpan) {
      continue;
    }
    rates.set(here.index, ((to.altitude - from.altitude) / span) * 3600);
  }
  return series.map((point, index) => {
    const rate = rates.get(index);
    return rate === undefined ? point : { ...point, verticalSpeed: rate };
  });
}

function channelRange(
  series: readonly ActivityChannelPoint[],
  key: ActivityChannelKey
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
function countChannelSamples(
  series: readonly ActivityChannelPoint[],
  key: ActivityChannelKey
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
export function availableActivityChannels(
  series: readonly ActivityChannelPoint[],
  motion: ActivityMotion = "pace"
): ActivityChannelDefinition[] {
  return ACTIVITY_CHANNELS.filter((channel) => {
    if (isOtherMotion(channel.key, motion)) {
      return false;
    }
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
 *
 * A ride opens on power against heart rate where a power meter was fitted —
 * speed on a bike is as much the road and the wind as the rider — and on speed
 * against heart rate where it was not, which the fallback below arrives at on
 * its own because speed is offered ahead of heart rate.
 */
const PREFERRED_CHANNELS: Record<
  ActivityMotion,
  readonly (ActivityChannelKey | readonly ActivityChannelKey[])[]
> = {
  pace: ["pace", "hr"],
  speed: ["power", "hr"],
  // A hike opens on how fast height was gained against what it cost, over the
  // elevation backdrop: the climbs are where the day was decided, and a speed
  // along the trail mostly says how steep it was.
  hike: ["verticalSpeed", "hr"],
  // A trail run opens on grade-adjusted pace against heart rate, over the
  // elevation: whether the effort held across the hills, which raw pace hides
  // under the gradient. Raw pace stands in where the watch sent no GAP — a
  // list entry is one slot, filled by the first of its keys the run has.
  trail: [["adjustedPace", "pace"], "hr"]
};

export function defaultSelectedChannels(
  available: readonly ActivityChannelDefinition[],
  motion: ActivityMotion = "pace"
): ActivityChannelKey[] {
  const axisKeys = available
    .filter((channel) => !channel.background)
    .map((channel) => channel.key);

  const chosen = PREFERRED_CHANNELS[motion].flatMap((slot) => {
    const key = (typeof slot === "string" ? [slot] : slot).find((option) =>
      axisKeys.includes(option)
    );
    return key === undefined ? [] : [key];
  });

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
export function toggleActivityChannel(
  selected: readonly ActivityChannelKey[],
  key: ActivityChannelKey
): ActivityChannelKey[] {
  if (selected.includes(key)) {
    return selected.filter((entry) => entry !== key);
  }

  const next = [...selected, key];
  return next.length > MAX_SELECTED_CHANNELS
    ? next.slice(next.length - MAX_SELECTED_CHANNELS)
    : next;
}

export interface ActivityChannelColors {
  stroke: string;
  /** Translucent fill for the elevation backdrop. */
  fill: string;
}

const DARK_CHANNEL_COLORS: Record<ActivityChannelKey, ActivityChannelColors> = {
  pace: { stroke: "#74c08f", fill: "rgba(116, 192, 143, 0.18)" },
  adjustedPace: { stroke: "#4fd1c5", fill: "rgba(79, 209, 197, 0.18)" },
  // Speed takes pace's colour: the two are one channel read two ways, and are
  // never offered together.
  speed: { stroke: "#74c08f", fill: "rgba(116, 192, 143, 0.18)" },
  hr: { stroke: "#f87171", fill: "rgba(248, 113, 113, 0.18)" },
  cadence: { stroke: "#b79bff", fill: "rgba(183, 155, 255, 0.18)" },
  power: { stroke: "#f3bf5c", fill: "rgba(243, 191, 92, 0.18)" },
  strideLength: { stroke: "#7ab8ff", fill: "rgba(122, 184, 255, 0.18)" },
  groundTime: { stroke: "#fb923c", fill: "rgba(251, 146, 60, 0.18)" },
  verticalOscillation: { stroke: "#f472b6", fill: "rgba(244, 114, 182, 0.18)" },
  verticalRatio: { stroke: "#a3e635", fill: "rgba(163, 230, 53, 0.18)" },
  verticalSpeed: { stroke: "#38bdf8", fill: "rgba(56, 189, 248, 0.18)" },
  altitude: { stroke: "rgba(255, 255, 255, 0.22)", fill: "rgba(255, 255, 255, 0.07)" }
};

const PAPER_CHANNEL_COLORS: Record<ActivityChannelKey, ActivityChannelColors> = {
  pace: { stroke: "#1f7a55", fill: "rgba(31, 122, 85, 0.16)" },
  adjustedPace: { stroke: "#0f766e", fill: "rgba(15, 118, 110, 0.16)" },
  speed: { stroke: "#1f7a55", fill: "rgba(31, 122, 85, 0.16)" },
  hr: { stroke: "#c2410c", fill: "rgba(194, 65, 12, 0.16)" },
  cadence: { stroke: "#6d28d9", fill: "rgba(109, 40, 217, 0.16)" },
  power: { stroke: "#a16207", fill: "rgba(161, 98, 7, 0.16)" },
  strideLength: { stroke: "#1d4ed8", fill: "rgba(29, 78, 216, 0.16)" },
  groundTime: { stroke: "#b45309", fill: "rgba(180, 83, 9, 0.16)" },
  verticalOscillation: { stroke: "#be185d", fill: "rgba(190, 24, 93, 0.16)" },
  verticalRatio: { stroke: "#4d7c0f", fill: "rgba(77, 124, 15, 0.16)" },
  verticalSpeed: { stroke: "#0369a1", fill: "rgba(3, 105, 161, 0.16)" },
  // The one channel that is a backdrop rather than a series, so it takes the
  // theme's ink the way every border and well does — rgb(19, 26, 40) here,
  // white-alpha in the dark table. It was the cream theme's warm ink and got
  // missed when that was swept out of the stylesheets, because it lives in TS.
  altitude: { stroke: "rgba(19, 26, 40, 0.2)", fill: "rgba(19, 26, 40, 0.08)" }
};

export function activityChannelColors(theme: Theme): Record<ActivityChannelKey, ActivityChannelColors> {
  return theme === "paper" ? PAPER_CHANNEL_COLORS : DARK_CHANNEL_COLORS;
}
