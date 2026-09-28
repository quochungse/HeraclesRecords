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
 * The ramp pace and heart rate fall back to on an activity COROS scored against
 * no zones, weakest step first, with a version for either ground: one hue,
 * blue, and "more" is the step that stands out from the ground — darker on a
 * daylight map, lighter on a dark one. It spans that activity's own range,
 * because without zones there is nothing fixed to measure against.
 */
const PERFORMANCE_RAMP = {
  light: ["#86b6ef", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  dark: ["#184f95", "#2a78d6", "#6da7ec", "#9ec5f4", "#cde2fb"]
} as const;

export function routeRamp(lightGround: boolean): readonly string[] {
  return PERFORMANCE_RAMP[lightGround ? "light" : "dark"];
}

/**
 * Elevation is coloured against fixed heights, green → yellow → orange → red,
 * and blended between them — so a height is the same colour on every activity,
 * and a run along the Red River reads green beside a Da Lat run's orange rather
 * than both being stretched over the whole ramp. Past the last stop is red.
 */
export const ELEVATION_STOPS = [0, 250, 750, 1500] as const;
const ELEVATION_COLORS = {
  light: ["#2f9e44", "#e6a700", "#f76707", "#e03131"],
  dark: ["#51cf66", "#ffd43b", "#ff922b", "#fa5252"]
} as const;

export function elevationColors(lightGround: boolean): readonly string[] {
  return ELEVATION_COLORS[lightGround ? "light" : "dark"];
}

/** The colour of a height in metres, on the fixed stops. */
export function elevationColor(meters: number, lightGround: boolean): string {
  const colors = elevationColors(lightGround);
  const last = ELEVATION_STOPS.length - 1;
  if (meters <= ELEVATION_STOPS[0]) {
    return rgb(hexChannels(colors[0]!));
  }
  for (let index = 0; index < last; index += 1) {
    const low = ELEVATION_STOPS[index]!;
    const high = ELEVATION_STOPS[index + 1]!;
    if (meters <= high) {
      return mixColor(colors[index]!, colors[index + 1]!, (meters - low) / (high - low));
    }
  }
  return rgb(hexChannels(colors[last]!));
}

/**
 * The heatmap's bands, by how many times a stretch was passed — fixed counts,
 * not a share of this activity's most, so twelve laps of a track read the same
 * red on every session.
 */
export const HEAT_BANDS = [
  { most: 1 },
  { most: 4 },
  { most: 8 },
  { most: 12 },
  { most: Number.POSITIVE_INFINITY }
] as const;

/**
 * Green, yellow, orange, red, deep red — the order heat rises in, so the
 * colours read cool to hot without a key. Deeper on a daylight map so the
 * yellow shows. The reds lean warm (little blue in them): a cool crimson
 * whitened towards the neon's core turns pink.
 */
const HEAT_COLORS = {
  light: ["#2f9e44", "#e6a700", "#f76707", "#e03131", "#a51d0f"],
  dark: ["#51cf66", "#ffd43b", "#ff922b", "#f03e3e", "#c81d11"]
} as const;

/**
 * What each band's neon core whitens towards. White, but for the reds a pale
 * orange: red mixed with white is pink, which reads as nothing that glows,
 * where a red-hot line has a hotter, yellower core.
 */
const HEAT_CORE = "#ffffff";
const HEAT_CORE_RED = "#ffc88c";
const HEAT_CORES = [HEAT_CORE, HEAT_CORE, HEAT_CORE, HEAT_CORE_RED, HEAT_CORE_RED] as const;

export function heatColors(lightGround: boolean): readonly string[] {
  return HEAT_COLORS[lightGround ? "light" : "dark"];
}

export function heatCores(): readonly string[] {
  return HEAT_CORES;
}

/** The band (0 to `HEAT_BANDS.length - 1`) a pass count falls in. */
export function heatBand(count: number): number {
  const band = HEAT_BANDS.findIndex((entry) => count <= entry.most);
  return band < 0 ? HEAT_BANDS.length - 1 : band;
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

/**
 * A metric's reading on each stretch between point i and i + 1, null where
 * nothing was recorded there — or why there are none at all: the activity did
 * not record the metric, or recorded it with no way to place it on the route
 * (a track without a clock, or one that never overlaps the samples').
 */
export type StretchValues =
  | { values: (number | null)[] }
  | { missing: "unrecorded" | "untimed" };

/**
 * Pace (seconds per km) or heart rate on each stretch. They live on the
 * series, one sample a second, on the same clock as the track's `elapsed`. A
 * stretch takes the mean of the samples inside it, or the one nearest its
 * middle when it is shorter than a sample.
 */
export function stretchValues(
  replay: RouteReplay,
  series: readonly TrainingHubActivitySeriesPoint[],
  metric: "pace" | "hr"
): StretchValues {
  const { points } = replay;
  const stretches = points.length - 1;

  const read = (sample: TrainingHubActivitySeriesPoint): number | undefined => {
    const value = metric === "pace" ? sample.pace : sample.hr;
    if (value === undefined || value <= 0) {
      return undefined;
    }
    return metric === "pace" && value > SLOWEST_PACE_S_PER_KM ? undefined : value;
  };
  const recorded = series.filter((sample) => read(sample) !== undefined);
  if (recorded.length === 0) {
    return { missing: "unrecorded" };
  }
  const samples = recorded
    .filter((sample) => sample.elapsed !== undefined)
    .sort((a, b) => a.elapsed! - b.elapsed!);
  if (samples.length === 0 || points.some((point) => point.elapsed === undefined)) {
    return { missing: "untimed" };
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
  return values.some((value) => value !== null) ? { values } : { missing: "untimed" };
}

/**
 * The least spread a ramp may stretch over. Below it the differences are noise
 * — a steady run's heart rate moves a few beats — and five steps over them
 * would paint a steady run as intervals. A narrower range is widened around its
 * middle, so it lands in the middle steps.
 */
const LEAST_SPAN: Record<"pace" | "hr", number> = {
  pace: 20,
  hr: 8
};

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
}

/**
 * Each stretch's ramp step for one metric's `stretchValues`. The ramp spans
 * the 5th to the 95th percentile, so a stop or a sensor spike does not flatten
 * everything else into one step. Faster pace is "more", so the fastest stretch
 * takes the strongest step.
 */
export function performanceColoring(
  values: readonly (number | null)[],
  metric: "pace" | "hr"
): RouteColoring {
  const sorted = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  let p5 = percentile(sorted, 0.05);
  let p95 = percentile(sorted, 0.95);
  if (p95 - p5 < LEAST_SPAN[metric]) {
    const middle = (p5 + p95) / 2;
    p5 = middle - LEAST_SPAN[metric] / 2;
    p95 = middle + LEAST_SPAN[metric] / 2;
  }
  const span = p95 - p5;
  const fasterIsMore = metric === "pace";

  // The span is at least `LEAST_SPAN`, so never zero.
  const steps = values.map((value) => {
    if (value === null) {
      return null;
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
 * Each stretch's height in metres, for `elevationColor`; null where the track
 * carries none, and null as a whole when no point has one.
 */
export function elevationColoring(replay: RouteReplay): (number | null)[] | null {
  const { points } = replay;
  const values = points.slice(0, -1).map((point, index) => {
    const a = point.elevation;
    const b = points[index + 1]!.elevation;
    return a !== undefined && b !== undefined ? (a + b) / 2 : a ?? b ?? null;
  });
  return values.some((value) => value !== null) ? values : null;
}

/**
 * A zone bucket's colour, bucket 0 — below zone 1 — first: the activity pane's
 * zone bar's, mirrored from `[data-zone]` in activities.css, which is scoped to
 * that screen while the full map is portalled to <body>. `test:route-coloring`
 * holds the two copies equal.
 */
export const ZONE_COLORS = [
  "#6b7280",
  "#7fb0d8",
  "#3fb27f",
  "#d8b13a",
  "#e08a3c",
  "#dd5f4b",
  "#b4405c"
] as const;

/**
 * A bucket's colour and name, numbered as the zone bar numbers them — bucket 0
 * "Below Z1", bucket n "Zn" — so the map and the bar beside it read a stretch
 * the same way, heart rate and pace alike. Clamped like the bar's
 * `data-zone`, for a list longer than seven.
 */
export function zoneColor(bucket: number): string {
  return ZONE_COLORS[Math.min(ZONE_COLORS.length - 1, Math.max(0, bucket))]!;
}

export function zoneLabel(bucket: number): string {
  return bucket <= 0 ? "Below Z1" : `Z${bucket}`;
}

export interface RouteZoneColoring {
  /** The bucket of each stretch; null where nothing was recorded. */
  steps: (number | null)[];
  /** COROS's buckets for the metric, in order, with their bounds. */
  buckets: TrainingHubActivityZoneBucket[];
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
 * Each stretch's bucket, by the zones COROS scored this activity against — the
 * same buckets its zone bar is drawn from, so the map and the bar agree. Null
 * when the activity has no zones for the metric.
 */
export function zoneColoring(
  values: readonly (number | null)[],
  metric: "pace" | "hr",
  zones: readonly TrainingHubActivityZoneBucket[] | undefined
): RouteZoneColoring | null {
  const buckets = [...(zones ?? [])].sort((a, b) => a.index - b.index);
  if (buckets.filter((zone) => zone.index > 0).length < 2) {
    return null;
  }
  return {
    steps: values.map((value) => (value === null ? null : zoneOf(metric, buckets, value))),
    buckets
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
/**
 * A pass this close to a point counts in full towards where the line is laid;
 * from here out to `SAME_SPOT_METERS` it counts for less and less, so a road
 * leaving a lapped loop eases away from it instead of jumping the moment it is
 * out of reach.
 */
const FULL_WEIGHT_METERS = 5;

function passWeight(gap: number): number {
  if (gap <= FULL_WEIGHT_METERS) {
    return 1;
  }
  const t = Math.min(1, (gap - FULL_WEIGHT_METERS) / (SAME_SPOT_METERS - FULL_WEIGHT_METERS));
  return 1 - t * t * (3 - 2 * t);
}

export interface RouteHeat {
  /** How many times the activity passed over each stretch, all told. */
  passes: number[];
  /**
   * For each stretch, the stretch at which each pass over its ground arrived,
   * in order — so a replay can count only the passes it has reached.
   */
  arrivals: number[][];
  /**
   * For each point, where each pass over its spot ran — the nearest reading of
   * that pass, the stretch at which the pass arrived, and how much it counts.
   * Every pass is laid at the mean of these, so passes over one spot land on
   * one line: a later lap is not a second line beside the first but the same
   * line, hotter, wider and moved to where the laps ran on average.
   */
  positions: HeatPosition[][];
  /** The most passes any stretch had. */
  most: number;
}

export interface HeatPosition {
  arrival: number;
  latLng: [number, number];
  weight: number;
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

/**
 * The route's points as the heatmap lays them once the replay has reached
 * `head`: each at the weighted mean of the passes over its spot that have
 * arrived, so a lap run a few metres wide of the last pulls the line towards
 * it rather than drawing beside it. A point no pass has reached yet stays where
 * it was.
 */
export function heatPositions(
  heat: RouteHeat,
  latLngs: readonly [number, number][],
  head: number
): [number, number][] {
  return latLngs.map((latLng, index) => {
    let lat = 0;
    let lon = 0;
    let weight = 0;
    for (const position of heat.positions[index] ?? []) {
      if (position.arrival <= head) {
        lat += position.latLng[0] * position.weight;
        lon += position.latLng[1] * position.weight;
        weight += position.weight;
      }
    }
    return weight > 0 ? [lat / weight, lon / weight] : latLng;
  });
}

interface HeatSample {
  x: number;
  y: number;
  along: number;
  latLng: [number, number];
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

  const grid = new Map<string, HeatSample[]>();
  const add = (latLng: [number, number], along: number) => {
    const [x, y] = toXY(latLng);
    const key = `${Math.floor(x / SAME_SPOT_METERS)}:${Math.floor(y / SAME_SPOT_METERS)}`;
    const sample = { x, y, along, latLng };
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

  // Each stay near a spot — the readings of one pass over it, in route order.
  const staysAt = (x: number, y: number): HeatSample[][] => {
    const cx = Math.floor(x / SAME_SPOT_METERS);
    const cy = Math.floor(y / SAME_SPOT_METERS);
    const near: HeatSample[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const sample of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (Math.hypot(sample.x - x, sample.y - y) <= SAME_SPOT_METERS) {
            near.push(sample);
          }
        }
      }
    }
    near.sort((p, q) => p.along - q.along);
    const stays: HeatSample[][] = [];
    for (const sample of near) {
      const current = stays[stays.length - 1];
      const previous = current?.[current.length - 1];
      if (current && previous && sample.along - previous.along <= REJOIN_METERS) {
        current.push(sample);
      } else {
        stays.push([sample]);
      }
    }
    // The loop's last stay is its first, cut at the line.
    if (
      closedLoop &&
      stays.length > 1 &&
      near[0]!.along + (total - near[near.length - 1]!.along) <= REJOIN_METERS * 2
    ) {
      stays[0]!.push(...stays.pop()!);
    }
    return stays;
  };

  const arrivals: number[][] = [];
  const passes = latLngs.slice(0, -1).map((a, index) => {
    const b = latLngs[index + 1]!;
    const [x, y] = toXY([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const stays = staysAt(x, y);
    const starts = stays.map((stay) => stretchAt(stay[0]!.along));
    if (starts.length === 0) {
      starts.push(index);
    }
    arrivals.push(starts);
    return starts.length;
  });

  const positions = latLngs.map((latLng, index): HeatPosition[] => {
    const [x, y] = toXY(latLng);
    const found = staysAt(x, y).map((stay): HeatPosition => {
      let nearest = stay[0]!;
      let best = Number.POSITIVE_INFINITY;
      for (const sample of stay) {
        const gap = Math.hypot(sample.x - x, sample.y - y);
        if (gap < best) {
          best = gap;
          nearest = sample;
        }
      }
      return {
        arrival: stretchAt(stay[0]!.along),
        latLng: nearest.latLng,
        weight: passWeight(best)
      };
    });
    return found.length > 0
      ? found
      : [{ arrival: Math.max(0, index - 1), latLng, weight: 1 }];
  });

  let most = 0;
  for (const count of passes) {
    most = Math.max(most, count);
  }
  return { passes, arrivals, positions, most };
}

function hexChannels(hex: string): [number, number, number] {
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16)) as [
    number,
    number,
    number
  ];
}

function mixChannels(
  from: readonly number[],
  to: readonly number[],
  mix: number
): [number, number, number] {
  return [0, 1, 2].map((index) => from[index]! + (to[index]! - from[index]!) * mix) as [
    number,
    number,
    number
  ];
}

function rgb(channels: readonly number[]): string {
  return `rgb(${channels.map((channel) => Math.round(channel)).join(", ")})`;
}

function mixColor(from: string, to: string, mix: number): string {
  return rgb(mixChannels(hexChannels(from), hexChannels(to), mix));
}

function rampChannels(ramp: readonly string[], t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const position = clamped * (ramp.length - 1);
  const from = Math.floor(position);
  const to = Math.min(ramp.length - 1, from + 1);
  return mixChannels(hexChannels(ramp[from]!), hexChannels(ramp[to]!), position - from);
}

/**
 * A colour on a ramp at `t` (0–1), blended between its stops — the heatmap's
 * line turns from one band's colour to the next along a stretch rather than
 * stepping at a join — and taken `whiten` (0–1) of the way to its core, for
 * the layers of its neon tube: white, or the matching stop of `cores`.
 */
export function rampColorAt(
  ramp: readonly string[],
  t: number,
  whiten = 0,
  cores?: readonly string[]
): string {
  const color = rampChannels(ramp, t);
  if (whiten <= 0) {
    return rgb(color);
  }
  const core = cores ? rampChannels(cores, t) : [255, 255, 255];
  return rgb(mixChannels(color, core, Math.min(1, whiten)));
}

/**
 * How wide the heatmap's neon is at a heat `share` (0 once, 1 past twelve
 * passes), in pixels: the whole tube, and its white core. Both grow with the
 * passes, and the core grows faster — an eighth of a single pass's tube, a
 * third of the hottest — so the more a stretch was run the more of it is
 * white.
 */
export function neonWidths(share: number): { body: number; core: number } {
  const clamped = Math.min(1, Math.max(0, share));
  const body = 4 + 5 * clamped;
  return { body, core: body * (0.12 + 0.23 * clamped) };
}
