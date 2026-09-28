import type {
  TrainingHubActivitySeriesPoint,
  TrainingHubActivityZoneBucket
} from "../../../electron/types";
import type { RouteReplay } from "./routeReplay";

/**
 * Colouring a route by what happened along it, one activity at a time. Kept
 * out of the component and free of Leaflet, for the reason `routeReplay.ts` is.
 *
 * Two modes: **Performance** colours each stretch by pace, heart rate or
 * elevation; **Heatmap** by how many times the activity passed over it — laps,
 * an out-and-back, a loop run twice.
 */
export type RouteColorMode = "route" | "performance" | "heatmap";
export type RouteMetric = "pace" | "hr" | "elevation";

/** How many steps a ramp has. Five keeps each step visibly apart from the next. */
export const RAMP_STEPS = 5;

/**
 * Sequential ramps, weakest step first, each with a version for either ground.
 * Validated with the dataviz skill's `validate_palette.js --ordinal` against
 * light and dark surfaces: monotone lightness, every step ≥ 0.06 ΔL from the
 * next, the weak end ≥ 2:1 on its ground.
 *
 * Performance's elevation ramp is one hue, blue, and "more" is the step that
 * stands out from the ground — darker on a daylight map, lighter on a dark one.
 *
 * Heatmap is a multi-hue ramp on purpose, light yellow → deep yellow → orange →
 * red → deep red (ColorBrewer's YlOrRd on a dark ground), because a count read
 * off one hue in five shades was too hard to tell apart — so it fails only the
 * validator's single-hue check, which is the point. On a daylight map the pale
 * yellow vanished (1.01:1), so that ramp starts at a deeper yellow.
 */
const RAMPS = {
  performance: {
    light: ["#86b6ef", "#3987e5", "#256abf", "#184f95", "#0d366b"],
    dark: ["#184f95", "#2a78d6", "#6da7ec", "#9ec5f4", "#cde2fb"]
  },
  heatmap: {
    light: ["#d9a800", "#e07a00", "#d9531a", "#bf2420", "#7e0a1a"],
    dark: ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"]
  }
} as const;

export function routeRamp(
  mode: Exclude<RouteColorMode, "route">,
  lightGround: boolean
): readonly string[] {
  return RAMPS[mode][lightGround ? "light" : "dark"];
}

export interface RouteColoring {
  /** The ramp step of each stretch between point i and i + 1; null where nothing was recorded. */
  steps: (number | null)[];
  /** The value the weakest step stands for, and the strongest. */
  low: number;
  high: number;
}

/** A pace slower than this is standing still, not running slowly. */
const SLOWEST_PACE_S_PER_KM = 30 * 60;

function stretchValues(
  replay: RouteReplay,
  series: TrainingHubActivitySeriesPoint[],
  metric: RouteMetric
): (number | null)[] {
  const { points } = replay;
  const stretches = points.length - 1;

  if (metric === "elevation") {
    return Array.from({ length: stretches }, (_, index) => {
      const a = points[index]!.elevation;
      const b = points[index + 1]!.elevation;
      return a !== undefined && b !== undefined ? (a + b) / 2 : a ?? b ?? null;
    });
  }

  // Pace and heart rate live on the series, one sample a second, on the same
  // clock as the track's `elapsed`. A stretch takes the mean of the samples
  // inside it, or the one nearest its middle when it is shorter than a sample.
  const read = (sample: TrainingHubActivitySeriesPoint): number | undefined => {
    const value = metric === "pace" ? sample.pace : sample.hr;
    if (value === undefined || value <= 0) {
      return undefined;
    }
    return metric === "pace" && value > SLOWEST_PACE_S_PER_KM ? undefined : value;
  };
  const samples = series
    .filter((sample) => sample.elapsed !== undefined && read(sample) !== undefined)
    .sort((a, b) => a.elapsed! - b.elapsed!);
  if (samples.length === 0 || points.some((point) => point.elapsed === undefined)) {
    return Array.from({ length: stretches }, () => null);
  }

  const values: (number | null)[] = [];
  let cursor = 0;
  for (let index = 0; index < stretches; index += 1) {
    const from = points[index]!.elapsed!;
    const to = points[index + 1]!.elapsed!;
    while (cursor < samples.length && samples[cursor]!.elapsed! < from) {
      cursor += 1;
    }
    let sum = 0;
    let count = 0;
    for (let at = cursor; at < samples.length && samples[at]!.elapsed! <= to; at += 1) {
      sum += read(samples[at]!)!;
      count += 1;
    }
    if (count > 0) {
      values.push(sum / count);
      continue;
    }
    const middle = (from + to) / 2;
    const near = [samples[cursor - 1], samples[cursor]]
      .filter((sample): sample is TrainingHubActivitySeriesPoint => sample !== undefined)
      .sort(
        (a, b) => Math.abs(a.elapsed! - middle) - Math.abs(b.elapsed! - middle)
      )[0];
    values.push(near && Math.abs(near.elapsed! - middle) <= 30 ? read(near)! : null);
  }
  return values;
}

/**
 * The least spread a ramp may stretch over. Below it the differences are noise
 * — a flat run's elevation moves a metre or two — and five steps over them
 * would paint a flat road as hills. A narrower range is widened around its
 * middle, so it lands in the middle steps.
 */
const LEAST_SPAN: Record<RouteMetric, number> = {
  pace: 20,
  hr: 8,
  elevation: 10
};

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
}

/**
 * Each stretch's ramp step for one metric, or null when the activity recorded
 * none of it. The ramp spans the 5th to the 95th percentile, so a stop or a
 * sensor spike does not flatten everything else into one step. Faster pace is
 * "more", so the fastest stretch takes the strongest step.
 */
export function performanceColoring(
  replay: RouteReplay,
  series: TrainingHubActivitySeriesPoint[],
  metric: RouteMetric
): RouteColoring | null {
  const values = stretchValues(replay, series, metric);
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) {
    return null;
  }
  const sorted = [...known].sort((a, b) => a - b);
  let p5 = percentile(sorted, 0.05);
  let p95 = percentile(sorted, 0.95);
  if (p95 - p5 < LEAST_SPAN[metric]) {
    const middle = (p5 + p95) / 2;
    p5 = middle - LEAST_SPAN[metric] / 2;
    p95 = middle + LEAST_SPAN[metric] / 2;
  }
  const span = p95 - p5;
  const fasterIsMore = metric === "pace";

  const steps = values.map((value) => {
    if (value === null) {
      return null;
    }
    if (span <= 0) {
      return Math.floor(RAMP_STEPS / 2);
    }
    const share = Math.min(1, Math.max(0, (value - p5) / span));
    const strength = fasterIsMore ? 1 - share : share;
    return Math.min(RAMP_STEPS - 1, Math.floor(strength * RAMP_STEPS));
  });

  return fasterIsMore
    ? { steps, low: p95, high: p5 }
    : { steps, low: p5, high: p95 };
}

/**
 * The zone colours, Z1 first — the activity pane's zone bar's, mirrored from
 * `[data-zone]` in activities.css, which is scoped to that screen while the
 * full map is portalled to <body>. `test:route-coloring` holds the two copies
 * equal.
 */
export const ZONE_COLORS = [
  "#7fb0d8",
  "#3fb27f",
  "#d8b13a",
  "#e08a3c",
  "#dd5f4b",
  "#b4405c"
] as const;

/** COROS's six zones, for heart rate and for pace alike. */
export const ZONE_COUNT = 6;

/**
 * The COROS zone (1–6) a `zoneList` bucket stands for. Heart rate has six
 * buckets and bucket n is zone n + 1: bucket 0, "under 134 bpm", is the band
 * COROS draws as zone 1, Recovery. Pace has seven, because COROS splits its
 * Threshold zone at 100% of threshold pace — on a real run, 354–324 and
 * 324–318 s/km against a threshold of 324 — and the two halves are one zone,
 * zone 4, in the six `PACE_PRESETS` name.
 */
export function zoneNumber(metric: "pace" | "hr", bucket: number, bucketCount: number): number {
  if (metric === "pace" && bucketCount === 7) {
    return [1, 2, 3, 4, 4, 5, 6][bucket] ?? ZONE_COUNT;
  }
  return Math.min(ZONE_COUNT, Math.max(1, bucket + 1));
}

/** One zone's bounds: bpm for heart rate; seconds per km for pace, `low` the fast edge. */
export interface ZoneRange {
  low?: number;
  high?: number;
}

export interface RouteZoneColoring {
  /** The zone (1–6) of each stretch; null where nothing was recorded. */
  steps: (number | null)[];
  /** Each zone's bounds, as COROS scored the activity; index 0 is zone 1. */
  ranges: ZoneRange[];
}

/**
 * The bucket a reading falls in. Heart-rate buckets run up in bpm, so it is the
 * highest bucket whose floor the reading reaches; pace buckets run the other
 * way — bucket 1 is the slowest with a floor — so it is the highest bucket whose
 * slow edge the pace is inside. Anything short of bucket 1 is bucket 0.
 */
export function zoneOf(
  metric: "pace" | "hr",
  zones: readonly TrainingHubActivityZoneBucket[],
  value: number
): number {
  let found = 0;
  for (const zone of zones) {
    if (zone.index <= 0) {
      continue;
    }
    const inside =
      metric === "hr"
        ? zone.low !== undefined && value >= zone.low
        : zone.high !== undefined && value <= zone.high;
    if (inside && zone.index > found) {
      found = zone.index;
    }
  }
  return found;
}

/**
 * Each stretch's zone, by the zones COROS scored this activity against — the
 * same bounds its zone bar is drawn from, so the map and the bar agree. Null
 * when the activity has no zones for the metric, or recorded none of it.
 */
export function zoneColoring(
  replay: RouteReplay,
  series: TrainingHubActivitySeriesPoint[],
  metric: "pace" | "hr",
  zones: readonly TrainingHubActivityZoneBucket[] | undefined
): RouteZoneColoring | null {
  const ordered = [...(zones ?? [])].sort((a, b) => a.index - b.index);
  if (ordered.filter((zone) => zone.index > 0).length < 2) {
    return null;
  }
  const values = stretchValues(replay, series, metric);
  if (values.every((value) => value === null)) {
    return null;
  }

  // A zone's bounds are its buckets' outer edges — zone 4 of pace spans two.
  const ranges: ZoneRange[] = Array.from({ length: ZONE_COUNT }, () => ({}));
  for (const bucket of ordered) {
    const range = ranges[zoneNumber(metric, bucket.index, ordered.length) - 1]!;
    if (bucket.low !== undefined) {
      range.low = range.low === undefined ? bucket.low : Math.min(range.low, bucket.low);
    }
    if (bucket.high !== undefined) {
      range.high = range.high === undefined ? bucket.high : Math.max(range.high, bucket.high);
    }
  }

  return {
    steps: values.map((value) =>
      value === null ? null : zoneNumber(metric, zoneOf(metric, ordered, value), ordered.length)
    ),
    ranges
  };
}

/** Two readings closer than this are the same spot. */
const SAME_SPOT_METERS = 10;
/** How finely the route is sampled for the count; well inside the spot. */
const SAMPLE_EVERY_METERS = 2;
/**
 * A route that leaves a spot and comes back has passed it again — but a break
 * this short is one pass wobbling at the edge of the spot, not a second one.
 */
const REJOIN_METERS = SAME_SPOT_METERS;
/** How far in from each end a loop's heading is read. */
const LOOP_LOOK_METERS = 50;

export interface RouteHeat {
  /** How many times the activity passed over each stretch, all told. */
  passes: number[];
  /**
   * Whether a stretch is drawn: only the first time the route covered some
   * ground. A later pass over it is not a second line beside the first but the
   * first line getting hotter — that is what a heatmap says.
   */
  drawn: boolean[];
  /**
   * For each stretch, the stretch at which each pass over its ground arrived,
   * in order — so a replay can count only the passes it has reached.
   */
  arrivals: number[][];
  /** The most passes any stretch had. */
  most: number;
}

/** How many passes over a stretch the route had made by the time it reached `head`. */
export function passesBy(heat: RouteHeat, stretch: number, head: number): number {
  let count = 0;
  for (const arrival of heat.arrivals[stretch] ?? []) {
    if (arrival <= head) {
      count += 1;
    }
  }
  return count;
}

/** A pass count as a share of the most, 0–1, for the ramp. */
export function heatShare(heat: RouteHeat, count: number): number {
  return heat.most <= 1 ? 0 : Math.min(1, Math.max(0, (count - 1) / (heat.most - 1)));
}

/**
 * How many times the activity passed over each stretch: a lap of a track run
 * twelve times reads twelve; a road run out and back, two. The route is
 * sampled every 2 m into a 10 m grid, and a stretch counts the separate stays
 * within 10 m of its middle. A stay ends when the route leaves the spot, so
 * the way back from a turnaround is a second pass as soon as it is 15 m from
 * the turn.
 */
export function routeHeat(replay: RouteReplay): RouteHeat {
  const { latLngs, distances } = replay;
  const lat0 = latLngs[0]![0] * (Math.PI / 180);
  const toXY = ([lat, lon]: [number, number]): [number, number] => [
    lon * 111_320 * Math.cos(lat0),
    lat * 110_540
  ];
  const total = distances[distances.length - 1]!;

  const grid = new Map<string, { x: number; y: number; along: number }[]>();
  const add = (latLng: [number, number], along: number) => {
    const [x, y] = toXY(latLng);
    const key = `${Math.floor(x / SAME_SPOT_METERS)}:${Math.floor(y / SAME_SPOT_METERS)}`;
    const sample = { x, y, along };
    const cell = grid.get(key);
    if (cell) {
      cell.push(sample);
    } else {
      grid.set(key, [sample]);
    }
  };
  for (let index = 0; index < latLngs.length - 1; index += 1) {
    const a = latLngs[index]!;
    const b = latLngs[index + 1]!;
    const length = distances[index + 1]! - distances[index]!;
    const samples = Math.max(1, Math.ceil(length / SAMPLE_EVERY_METERS));
    for (let step = 0; step < samples; step += 1) {
      const t = step / samples;
      add([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], distances[index]! + length * t);
    }
  }
  add(latLngs[latLngs.length - 1]!, total);

  // A loop that finishes where it started, heading the way it set off, is one
  // pass cut in two at the line: the start of lap one and the end of the last
  // lap. An out-and-back also ends where it began, but coming the other way,
  // and those are two passes.
  const closedLoop = (() => {
    const first = toXY(latLngs[0]!);
    const last = toXY(latLngs[latLngs.length - 1]!);
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > LOOP_LOOK_METERS) {
      return false;
    }
    let leavingIndex = distances.findIndex((distance) => distance >= LOOP_LOOK_METERS);
    if (leavingIndex < 0) {
      leavingIndex = distances.length - 1;
    }
    let arrivingIndex = 0;
    for (let index = distances.length - 1; index >= 0; index -= 1) {
      if (distances[index]! <= total - LOOP_LOOK_METERS) {
        arrivingIndex = index;
        break;
      }
    }
    const leaving = toXY(latLngs[leavingIndex]!);
    const arrivingFrom = toXY(latLngs[arrivingIndex]!);
    return (
      (leaving[0] - first[0]) * (last[0] - arrivingFrom[0]) +
        (leaving[1] - first[1]) * (last[1] - arrivingFrom[1]) >
      0
    );
  })();

  // The stretch a distance along the route falls in.
  const stretchAt = (along: number) => {
    let low = 0;
    let high = distances.length - 2;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (distances[mid]! <= along) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  };

  const drawn: boolean[] = [];
  const arrivals: number[][] = [];
  const passes = latLngs.slice(0, -1).map((a, index) => {
    const b = latLngs[index + 1]!;
    const [x, y] = toXY([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const cx = Math.floor(x / SAME_SPOT_METERS);
    const cy = Math.floor(y / SAME_SPOT_METERS);
    const along: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const sample of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (Math.hypot(sample.x - x, sample.y - y) <= SAME_SPOT_METERS) {
            along.push(sample.along);
          }
        }
      }
    }
    along.sort((p, q) => p - q);
    // Each stay near the spot, as the distance along the route it began at.
    const stays: number[] = along.length > 0 ? [along[0]!] : [];
    for (let at = 1; at < along.length; at += 1) {
      if (along[at]! - along[at - 1]! > REJOIN_METERS) {
        stays.push(along[at]!);
      }
    }
    if (
      closedLoop &&
      stays.length > 1 &&
      along[0]! + (total - along[along.length - 1]!) <= REJOIN_METERS * 2
    ) {
      stays.pop();
    }
    const own = (distances[index]! + distances[index + 1]!) / 2;
    const starts = stays.map(stretchAt);
    if (starts.length === 0) {
      starts.push(index);
    }
    arrivals.push(starts);
    // Drawn when its own stay is the first: nothing earlier covered this ground.
    const firstStayEnds = stays.length > 1 ? stays[1]! : Number.POSITIVE_INFINITY;
    drawn.push(own < firstStayEnds);
    return starts.length;
  });

  return { passes, drawn, arrivals, most: Math.max(...passes) };
}

/**
 * A colour on a ramp at `t` (0–1), blended between its stops — the heatmap's
 * line runs smoothly rather than in five bands.
 */
export function rampColorAt(ramp: readonly string[], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const position = clamped * (ramp.length - 1);
  const from = Math.floor(position);
  const to = Math.min(ramp.length - 1, from + 1);
  const mix = position - from;
  const channel = (hex: string, offset: number) =>
    Number.parseInt(hex.slice(1 + offset, 3 + offset), 16);
  const blend = [0, 2, 4].map((offset) =>
    Math.round(
      channel(ramp[from]!, offset) + (channel(ramp[to]!, offset) - channel(ramp[from]!, offset)) * mix
    )
  );
  return `rgb(${blend[0]}, ${blend[1]}, ${blend[2]})`;
}
