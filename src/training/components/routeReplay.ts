import type { TrainingHubTrackPoint } from "../../../electron/types";

/**
 * The route replay drawn when a route map opens: the line grows from the start
 * at the pace the activity was actually done, sped up, with the finish marker
 * riding its head. Kept out of the component, and free of Leaflet, so a test
 * can reach the arithmetic.
 */
export interface RouteReplay {
  latLngs: [number, number][];
  /** The located track points `latLngs` was read from, one for one. */
  points: TrainingHubTrackPoint[];
  /** Metres from the start to each point along the route. */
  distances: number[];
  /** Where each point falls on the replay, 0 at the start and 1 at the finish. */
  clock: number[];
  /** Length of the route in metres, which sets how long the replay runs. */
  meters: number;
}

/** A still moment after the map opens, so the eye finds the start first. */
export const REPLAY_DELAY_MS = 500;

/**
 * A replay's length grows with the route's, inside a floor and a ceiling: a
 * kilometre takes 1 s, 2 km 1.4 s, 5 km 2.6 s, and anything past 8.5 km 4 s.
 * A short route is over quickly because there is little to watch; one fixed
 * length drew every route in 2.2 s, a 100 km ride at 45 km a second.
 */
const REPLAY_MIN_MS = 1000;
const REPLAY_MAX_MS = 4000;
const REPLAY_BASE_MS = 600;
const REPLAY_MS_PER_KM = 400;

/**
 * A gap between two fixes longer than this many ordinary gaps is a pause or a
 * lost signal, not slow going. It is replayed as one ordinary gap, or the
 * finish marker would stand still at a traffic light for seconds on end.
 */
const LONG_GAP_FACTOR = 3;

/**
 * A route cover's ceiling: the cover is a picture behind a page's heading, read
 * at a glance on the way to the figures, so a long route is drawn in 2 s there
 * and the full map keeps the time to watch it.
 */
export const COVER_REPLAY_MAX_MS = 2000;

export function replayDurationMs(meters: number, ceilingMs = REPLAY_MAX_MS): number {
  const ms = REPLAY_BASE_MS + (meters / 1000) * REPLAY_MS_PER_KM;
  return Math.min(ceilingMs, Math.max(REPLAY_MIN_MS, ms));
}

function metersBetween(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad;
  const dLon = (b[1] - a[1]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The replay for a track, or null when fewer than two points are located.
 *
 * Time comes from each point's `elapsed` when every located point carries one;
 * then a stretch run slowly is replayed slowly. Without it the replay falls
 * back to distance, which is an even pace throughout.
 */
export function buildRouteReplay(points: TrainingHubTrackPoint[]): RouteReplay | null {
  const located = points.filter(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  if (located.length < 2) {
    return null;
  }

  const latLngs = located.map((point): [number, number] => [point.lat!, point.lon!]);
  const distances = [0];
  for (let index = 1; index < latLngs.length; index += 1) {
    distances.push(
      distances[index - 1]! + metersBetween(latLngs[index - 1]!, latLngs[index]!)
    );
  }
  const meters = distances[distances.length - 1]!;

  let steps = distances.map((distance, index) =>
    index === 0 ? 0 : distance - distances[index - 1]!
  );

  if (located.every((point) => point.elapsed !== undefined)) {
    const gaps = located.map((point, index) =>
      index === 0 ? 0 : Math.max(0, point.elapsed! - located[index - 1]!.elapsed!)
    );
    const ordinary = median(gaps.slice(1).filter((gap) => gap > 0));
    if (ordinary > 0) {
      steps = gaps.map((gap) => (gap > ordinary * LONG_GAP_FACTOR ? ordinary : gap));
    }
  }

  const clock = [0];
  for (let index = 1; index < steps.length; index += 1) {
    clock.push(clock[index - 1]! + steps[index]!);
  }
  const total = clock[clock.length - 1]!;
  return {
    latLngs,
    points: located,
    distances,
    // A route that never moves has nothing to replay; it is drawn whole.
    clock: total > 0 ? clock.map((value) => value / total) : clock.map(() => 1),
    meters
  };
}

/**
 * Where the replay's head is at `progress` (0–1): the last point it has
 * passed, how far it is towards the next, and the spot on the chord between.
 */
export function replayHead(
  replay: RouteReplay,
  progress: number
): { index: number; fraction: number; point: [number, number] } {
  const { latLngs, clock } = replay;
  const last = latLngs.length - 1;
  if (progress >= 1) {
    return { index: last, fraction: 0, point: latLngs[last]! };
  }
  if (progress <= 0) {
    return { index: 0, fraction: 0, point: latLngs[0]! };
  }

  // The last point at or before `progress`.
  let low = 0;
  let high = clock.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (clock[mid]! <= progress) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const from = latLngs[low]!;
  const next = latLngs[low + 1];
  if (!next) {
    return { index: low, fraction: 0, point: from };
  }
  const span = clock[low + 1]! - clock[low]!;
  const fraction = span > 0 ? (progress - clock[low]!) / span : 1;
  return {
    index: low,
    fraction,
    point: [
      from[0] + (next[0] - from[0]) * fraction,
      from[1] + (next[1] - from[1]) * fraction
    ]
  };
}

/** The line drawn so far at `progress` (0–1), ending at the replay's head. */
export function replayPath(
  replay: RouteReplay,
  progress: number
): [number, number][] {
  if (progress >= 1) {
    return replay.latLngs;
  }
  const { index, point } = replayHead(replay, progress);
  return [...replay.latLngs.slice(0, index + 1), point];
}
