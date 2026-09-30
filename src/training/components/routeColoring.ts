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
 * A bucket's colour and name, numbered as COROS and the zone bar number them —
 * bucket n is Z(n+1) — so the map, the bar beside it and the coach read a
 * stretch the same way, heart rate and pace alike. Clamped like the bar's
 * `data-zone`, for a list longer than seven.
 */
export function zoneColor(bucket: number): string {
  return ZONE_COLORS[Math.min(ZONE_COLORS.length - 1, Math.max(0, bucket))]!;
}

/** COROS's own zone number for a bucket: bucket 0 is Zone 1, the one under the first bound. */
export function zoneNumber(bucket: number): number {
  return Math.max(0, bucket) + 1;
}

export function zoneLabel(bucket: number): string {
  return `Z${zoneNumber(bucket)}`;
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

/** A grid cell's key: the cell's column and row packed into one number. */
function cellKey(column: number, row: number): number {
  return column * 4_194_304 + row;
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
  // Metres from the first point, so a cell's column and row stay small.
  const lat0 = latLngs[0]![0];
  const lon0 = latLngs[0]![1];
  const kx = 111_320 * Math.cos(lat0 * (Math.PI / 180));
  const toXY = ([lat, lon]: [number, number]): [number, number] => [
    (lon - lon0) * kx,
    (lat - lat0) * 110_540
  ];
  const total = distances[distances.length - 1]!;
  const stretches = latLngs.length - 1;

  // The route sampled every 2 m, in route order, as flat columns: sample i is
  // at (x[i], y[i]), `along[i]` metres in, on stretch `stretch[i]`. Each cell
  // lists its samples' indexes, which therefore rise with `along`.
  const x: number[] = [];
  const y: number[] = [];
  const along: number[] = [];
  const stretch: number[] = [];
  const sampleLatLng: [number, number][] = [];
  const grid = new Map<number, number[]>();
  const add = (latLng: [number, number], distance: number, onStretch: number) => {
    const [px, py] = toXY(latLng);
    const index = x.length;
    x.push(px);
    y.push(py);
    along.push(distance);
    stretch.push(onStretch);
    sampleLatLng.push(latLng);
    const key = cellKey(Math.floor(px / SAME_SPOT_METERS), Math.floor(py / SAME_SPOT_METERS));
    const cell = grid.get(key);
    if (cell) {
      cell.push(index);
    } else {
      grid.set(key, [index]);
    }
  };
  for (let index = 0; index < stretches; index += 1) {
    const a = latLngs[index]!;
    const b = latLngs[index + 1]!;
    const length = distances[index + 1]! - distances[index]!;
    const samples = Math.max(1, Math.ceil(length / SAMPLE_EVERY_METERS));
    for (let step = 0; step < samples; step += 1) {
      const t = step / samples;
      add(
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        distances[index]! + length * t,
        index
      );
    }
  }
  add(latLngs[stretches]!, total, Math.max(0, stretches - 1));

  // A loop that finishes where it started, heading the way it set off, is one
  // pass cut in two at the line: the start of lap one and the end of the last
  // lap. An out-and-back also ends where it began, but coming the other way,
  // and those are two passes.
  const closedLoop = (() => {
    const first = toXY(latLngs[0]!);
    const last = toXY(latLngs[stretches]!);
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

  // Each stay near a spot — the samples of one pass over it, in route order —
  // handed to `visit` as its first sample and the one nearest the spot. The
  // samples near a spot are gathered as indexes and sorted as numbers, which
  // is route order: this runs twice per point, and sorting objects by a key
  // was most of what the heatmap cost to open.
  let near = new Int32Array(256);
  const reach = SAME_SPOT_METERS * SAME_SPOT_METERS;
  const staysAt = (
    px: number,
    py: number,
    visit: (first: number, nearest: number, gap: number) => void
  ) => {
    const column = Math.floor(px / SAME_SPOT_METERS);
    const row = Math.floor(py / SAME_SPOT_METERS);
    let count = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const sample of grid.get(cellKey(column + dx, row + dy)) ?? []) {
          const ex = x[sample]! - px;
          const ey = y[sample]! - py;
          if (ex * ex + ey * ey <= reach) {
            if (count === near.length) {
              const grown = new Int32Array(near.length * 2);
              grown.set(near);
              near = grown;
            }
            near[count] = sample;
            count += 1;
          }
        }
      }
    }
    if (count === 0) {
      return;
    }
    const ordered = near.subarray(0, count).sort();

    // The stays as runs of `ordered`: a new one wherever the route left the
    // spot for longer than a wobble.
    const starts = [0];
    for (let k = 1; k < count; k += 1) {
      if (along[ordered[k]!]! - along[ordered[k - 1]!]! > REJOIN_METERS) {
        starts.push(k);
      }
    }
    // The loop's last stay is its first, cut at the line.
    const joinEnds =
      closedLoop &&
      starts.length > 1 &&
      along[ordered[0]!]! + (total - along[ordered[count - 1]!]!) <= REJOIN_METERS * 2;
    const stays = joinEnds ? starts.length - 1 : starts.length;

    for (let k = 0; k < stays; k += 1) {
      const from = starts[k]!;
      const to = k + 1 < starts.length ? starts[k + 1]! : count;
      let nearest = ordered[from]!;
      let best = Number.POSITIVE_INFINITY;
      const consider = (index: number) => {
        const sample = ordered[index]!;
        const gap = Math.hypot(x[sample]! - px, y[sample]! - py);
        if (gap < best) {
          best = gap;
          nearest = sample;
        }
      };
      for (let index = from; index < to; index += 1) {
        consider(index);
      }
      if (joinEnds && k === 0) {
        for (let index = starts[starts.length - 1]!; index < count; index += 1) {
          consider(index);
        }
      }
      visit(ordered[from]!, nearest, best);
    }
  };

  const arrivals: number[][] = [];
  const passes: number[] = [];
  for (let index = 0; index < stretches; index += 1) {
    const a = latLngs[index]!;
    const b = latLngs[index + 1]!;
    const [px, py] = toXY([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const starts: number[] = [];
    staysAt(px, py, (first) => starts.push(stretch[first]!));
    if (starts.length === 0) {
      starts.push(index);
    }
    arrivals.push(starts);
    passes.push(starts.length);
  }

  const positions = latLngs.map((latLng, index): HeatPosition[] => {
    const [px, py] = toXY(latLng);
    const found: HeatPosition[] = [];
    staysAt(px, py, (first, nearest, gap) =>
      found.push({
        arrival: stretch[first]!,
        latLng: sampleLatLng[nearest]!,
        weight: passWeight(gap)
      })
    );
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

/**
 * A colour — `#rrggbb`, or `rgb(r, g, b)` as the elevation stops are written —
 * taken `amount` (0–1) of the way to white: a route line's neon core.
 */
export function whitenColor(color: string, amount: number): string {
  const channels = color.startsWith("#")
    ? hexChannels(color)
    : (color.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  return channels.length === 3
    ? rgb(mixChannels(channels, [255, 255, 255], Math.min(1, Math.max(0, amount))))
    : color;
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
 * The neon every route line wears, the heatmap's included: a core whitened
 * towards white down its middle between two edges of the line's own colour,
 * and under it a halo in that colour, faint and blurred 4 px, reaching 2 px
 * past a route line on each side and three quarters of its width past the
 * heatmap's.
 * The edges keep a route line's 1.2 px at any width, so the heatmap's line,
 * which widens with its passes, widens in its core: a stretch run many times
 * burns brighter rather than growing two thick borders. Its glow is a share of
 * the width, so it widens with it. A daylight map takes less of both: a white core and a glow
 * read louder on it. The halo pane's CSS blur
 * (`.leaflet-heraclesRouteHalo-pane`) is `haloBlur` written out, and
 * `test:route-coloring` holds the two equal.
 */
export const ROUTE_NEON = {
  /** A route line's width, in pixels. */
  weight: 4,
  /** Each edge of the line, outside its core, in pixels. */
  edge: 1.2,
  /** How far the heatmap's halo reaches past its line on each side, as a share of the line's width. */
  haloShare: 0.75,
  /** How far a route line's halo reaches past it on each side, in pixels. */
  lineHalo: 2,
  haloBlur: 4,
  dark: { coreWhiten: 0.45, haloOpacity: 0.3 },
  light: { coreWhiten: 0.3, haloOpacity: 0.16 }
} as const;

export function routeNeon(lightGround: boolean): { coreWhiten: number; haloOpacity: number } {
  return ROUTE_NEON[lightGround ? "light" : "dark"];
}

/** A route line's widths, in the route and performance modes. */
export const ROUTE_LINE_WIDTHS = {
  ...neonWidths(ROUTE_NEON.weight),
  halo: ROUTE_NEON.weight + 2 * ROUTE_NEON.lineHalo
};

/** A heatmap line of `weight` pixels with its core and halo, in the neon's proportions at any width. */
export function neonWidths(weight: number): { body: number; core: number; halo: number } {
  return {
    body: weight,
    core: Math.max(0, weight - 2 * ROUTE_NEON.edge),
    halo: weight * (1 + 2 * ROUTE_NEON.haloShare)
  };
}

/**
 * How wide the heatmap's line is at a heat `share` (0 once, 1 past twelve
 * passes), in pixels: a route line's own width for a single pass, growing to
 * 9 — the more a stretch was run the wider its line and its glow, in the
 * same neon.
 */
export function heatWeight(share: number): number {
  return ROUTE_NEON.weight + 5 * Math.min(1, Math.max(0, share));
}
