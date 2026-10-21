import type { Theme } from "../theme/theme";
import type { TrainingHubActivitySeriesPoint } from "../../electron/types";
import { t } from "../i18n/core";
import { isRunSportType } from "../running/runSurface";

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
  rest: Omit<ActivityChannelDefinition, "key" | "label">,
  name: ActivityChannelKey | "runningPower" = key
): ActivityChannelDefinition {
  return {
    key,
    get label() {
      return t(`activity.channel.${name}` as const);
    },
    ...rest
  };
}

const POWER = { unit: "W", decimals: 0 } as const;

const ACTIVITY_CHANNELS: readonly ActivityChannelDefinition[] = [
  channel("pace", { unit: "", decimals: 0, reversed: true }),
  channel("adjustedPace", { unit: "", decimals: 0, reversed: true }),
  channel("speed", { unit: "", decimals: 1 }),
  channel("hr", { unit: "bpm", decimals: 0 }),
  channel("cadence", { unit: "spm", decimals: 0 }),
  channel("power", POWER),
  channel("strideLength", { unit: "m", decimals: 2 }),
  channel("groundTime", { unit: "ms", decimals: 0 }),
  channel("verticalOscillation", { unit: "cm", decimals: 1 }),
  channel("verticalRatio", { unit: "%", decimals: 1 }),
  channel("verticalSpeed", { unit: "", decimals: 0 }),
  channel("altitude", { unit: "m", decimals: 0, background: true })
];

/**
 * Power on a run is COROS's Running Power, and is called that; on a ride it is
 * the meter's power, and keeps the plain word. So does power on anything else
 * read as a pace — a HYROX session, a row — which is not a run: the Activities
 * pane reads every such sport as a pace, so the motion alone cannot say. A
 * caller that names no sport is a run's own page, or a card read as one.
 */
const RUNNING_POWER = channel("power", POWER, "runningPower");

function forMotion(
  channel: ActivityChannelDefinition,
  motion: ActivityMotion | undefined,
  sportType: number | undefined
): ActivityChannelDefinition {
  const run = (motion === "pace" || motion === "trail") && (sportType === undefined || isRunSportType(sportType));
  return channel.key === "power" && run ? RUNNING_POWER : channel;
}

export function activityChannel(
  key: ActivityChannelKey,
  motion?: ActivityMotion,
  sportType?: number
): ActivityChannelDefinition {
  return forMotion(ACTIVITY_CHANNELS.find((channel) => channel.key === key) ?? ACTIVITY_CHANNELS[0]!, motion, sportType);
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
  motion: ActivityMotion = "pace",
  sportType?: number
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
  }).map((channel) => forMotion(channel, motion, sportType));
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
 * Which plot a channel belongs to when the chart is split: what the athlete
 * produced (pace, effort pace, speed, power, climbing rate) above, and what it
 * cost and how it was done (heart rate, cadence and the form figures) below.
 * Read top to bottom it is the question the chart is for — how the effort went,
 * and what the heart paid for it. Power is output, not the body: it was filed
 * with heart rate at first, so a ride opened with power and heart rate both in
 * the lower plot and speed made up to fill the upper one. Elevation is neither
 * — it is the ground both are read against.
 */
export type ActivityChannelGroup = "body" | "motion";

const MOTION_GROUP: ReadonlySet<ActivityChannelKey> = new Set([
  "pace",
  "adjustedPace",
  "speed",
  "power",
  "verticalSpeed"
]);

export function activityChannelGroup(key: ActivityChannelKey): ActivityChannelGroup | undefined {
  if (activityChannel(key).background) {
    return undefined;
  }
  return MOTION_GROUP.has(key) ? "motion" : "body";
}

/** A split needs something to draw in both plots, or one of them is an empty frame. */
export function canSplitActivityChannels(
  available: readonly ActivityChannelDefinition[]
): boolean {
  const groups = new Set(available.map((channel) => activityChannelGroup(channel.key)));
  return groups.has("body") && groups.has("motion");
}

/**
 * Toggling a channel, with the two-axis cap applied by **dropping the oldest**
 * rather than refusing the press. A chip that does nothing when clicked reads
 * as broken; one that quietly replaces what it has to is understood at once.
 *
 * Split, each plot has two axes of its own, so the cap — and the oldest that
 * gives way — is counted within the pressed channel's group.
 */
export function toggleActivityChannel(
  selected: readonly ActivityChannelKey[],
  key: ActivityChannelKey,
  split = false
): ActivityChannelKey[] {
  if (selected.includes(key)) {
    return selected.filter((entry) => entry !== key);
  }

  const next = [...selected, key];
  if (!split) {
    return next.length > MAX_SELECTED_CHANNELS
      ? next.slice(next.length - MAX_SELECTED_CHANNELS)
      : next;
  }
  const group = activityChannelGroup(key);
  const sameGroup = next.filter((entry) => activityChannelGroup(entry) === group);
  const dropped = new Set(sameGroup.slice(0, Math.max(0, sameGroup.length - MAX_SELECTED_CHANNELS)));
  return next.filter((entry) => !dropped.has(entry));
}

/**
 * The selection carried across a change of layout. Split, every plot opens on
 * something — a group with nothing chosen takes its first channel — and each
 * keeps at most two. Combined, the first channel of each group is kept ahead of
 * the rest, so pace and heart rate split and rejoined come back as pace and
 * heart rate rather than as whichever two were pressed last.
 */
export function fitActivityChannels(
  selected: readonly ActivityChannelKey[],
  available: readonly ActivityChannelDefinition[],
  split: boolean
): ActivityChannelKey[] {
  const offered = new Set(
    available.filter((channel) => !channel.background).map((channel) => channel.key)
  );
  const kept = selected.filter((key) => offered.has(key));

  if (split) {
    return (["motion", "body"] as const).flatMap((group) => {
      const inGroup = kept.filter((key) => activityChannelGroup(key) === group);
      if (inGroup.length > 0) {
        return inGroup.slice(-MAX_SELECTED_CHANNELS);
      }
      const first = available.find((channel) => activityChannelGroup(channel.key) === group);
      return first ? [first.key] : [];
    });
  }

  const leads = (["motion", "body"] as const).flatMap((group) => {
    const lead = kept.find((key) => activityChannelGroup(key) === group);
    return lead === undefined ? [] : [lead];
  });
  const ordered = kept.filter((key) => leads.includes(key));
  for (const key of kept) {
    if (ordered.length >= MAX_SELECTED_CHANNELS) break;
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered.slice(0, MAX_SELECTED_CHANNELS);
}

export interface ActivityChannelColors {
  stroke: string;
  /** Translucent fill for the elevation backdrop. */
  fill: string;
}

/**
 * The channels' colours are COROS's: the hue each one wears in the COROS app
 * (pace green, effort pace lime, heart rate red, cadence amber, running power
 * orange, stride length violet, ground time yellow, stride height coral,
 * elevation teal), so a chart here reads like the one the athlete already
 * knows. Two are this app's own. The climbing rate is not a COROS channel and
 * keeps a magenta. Stride ratio is a sky blue where COROS draws it
 * yellow-green: at that hue it sat on effort pace (ΔE under 3), and held apart
 * from it, from pace and from heart rate it had nowhere to go but near-black
 * on paper or orange on dark. The blue half of the wheel is empty, and blue
 * against yellow is the axis protan and deutan vision keeps.
 *
 * The hues are COROS's and the lightness and chroma this app's. COROS's set
 * crowds the warm half of the wheel — red, orange, amber, lime and green — so
 * lightness carries what hue cannot, and the pairs that can be drawn together
 * are held apart by OKLab ΔE (×100) of at least 15 to normal vision and 8
 * under protan and deutan simulation (Machado 2009, full severity), in both
 * themes: heart rate against every channel, since it sits beside all of them;
 * pace (and speed, its colour) against effort pace, power, cadence and the
 * climbing rate; effort pace against power and the climbing rate; power
 * against cadence and the climbing rate; cadence against the climbing rate;
 * stride ratio against pace, effort pace, power, cadence, stride length and
 * the climbing rate.
 * What gives way is pairs nobody reads together — the form figures among
 * each other, and effort pace against cadence. `test:activity-channel-colors`
 * holds every one of those pairs, and every stroke at 3:1 against the panel.
 *
 * Holding them costs some tone. On dark, heart rate is a deeper red, the low
 * point the bright greens and ambers are read off, and cadence a pale amber
 * above the orange of power. Paper has only the band between ink and 3:1 on
 * white to spend, so the three tones it holds apart are three steps of
 * lightness: effort pace a light olive-lime at the top of the band, pace a
 * mid-tone green and power a dark burnt orange, beside the red of heart rate.
 * Elevation is a backdrop, so it is the teal washed thin.
 */
const DARK_CHANNEL_COLORS: Record<ActivityChannelKey, ActivityChannelColors> = {
  pace: { stroke: "#5cbc7d", fill: "rgba(92, 188, 125, 0.18)" },
  adjustedPace: { stroke: "#c5db70", fill: "rgba(197, 219, 112, 0.18)" },
  // Speed takes pace's colour: the two are one channel read two ways, and are
  // never offered together.
  speed: { stroke: "#5cbc7d", fill: "rgba(92, 188, 125, 0.18)" },
  hr: { stroke: "#d75154", fill: "rgba(215, 81, 84, 0.18)" },
  cadence: { stroke: "#f1ce99", fill: "rgba(241, 206, 153, 0.18)" },
  power: { stroke: "#f58c38", fill: "rgba(245, 140, 56, 0.18)" },
  strideLength: { stroke: "#8f78df", fill: "rgba(143, 120, 223, 0.18)" },
  groundTime: { stroke: "#dcc86c", fill: "rgba(220, 200, 108, 0.18)" },
  verticalOscillation: { stroke: "#ed987d", fill: "rgba(237, 152, 125, 0.18)" },
  verticalRatio: { stroke: "#64bced", fill: "rgba(100, 188, 237, 0.18)" },
  verticalSpeed: { stroke: "#ae64bc", fill: "rgba(174, 100, 188, 0.18)" },
  altitude: { stroke: "rgba(61, 187, 174, 0.4)", fill: "rgba(61, 187, 174, 0.1)" }
};

const PAPER_CHANNEL_COLORS: Record<ActivityChannelKey, ActivityChannelColors> = {
  pace: { stroke: "#357a4e", fill: "rgba(53, 122, 78, 0.16)" },
  adjustedPace: { stroke: "#7e9d1d", fill: "rgba(126, 157, 29, 0.16)" },
  // Speed takes pace's colour: the two are one channel read two ways, and are
  // never offered together.
  speed: { stroke: "#357a4e", fill: "rgba(53, 122, 78, 0.16)" },
  hr: { stroke: "#cc342f", fill: "rgba(204, 52, 47, 0.16)" },
  cadence: { stroke: "#c48225", fill: "rgba(196, 130, 37, 0.16)" },
  power: { stroke: "#753a05", fill: "rgba(117, 58, 5, 0.16)" },
  strideLength: { stroke: "#6a4ec8", fill: "rgba(106, 78, 200, 0.16)" },
  groundTime: { stroke: "#ac8b00", fill: "rgba(172, 139, 0, 0.16)" },
  verticalOscillation: { stroke: "#c8846d", fill: "rgba(200, 132, 109, 0.16)" },
  verticalRatio: { stroke: "#4093bb", fill: "rgba(64, 147, 187, 0.16)" },
  verticalSpeed: { stroke: "#9945a9", fill: "rgba(153, 69, 169, 0.16)" },
  altitude: { stroke: "rgba(38, 153, 142, 0.4)", fill: "rgba(38, 153, 142, 0.1)" }
};

export function activityChannelColors(theme: Theme): Record<ActivityChannelKey, ActivityChannelColors> {
  return theme === "paper" ? PAPER_CHANNEL_COLORS : DARK_CHANNEL_COLORS;
}
