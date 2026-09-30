/**
 * What the sample rides and the sample hikes share: one athlete, the seeded
 * randomness that makes a screenshot repeatable, the geometry of a route and
 * the figures a watch derives from its samples the same way whatever the sport.
 *
 * Read only by `sampleRides.ts` and `sampleHikes.ts` — both of which main.ts
 * alone imports, behind their flags. Nothing here is reached otherwise.
 */
import type {
  TrainingHubActivitySeriesPoint,
  TrainingHubActivityZoneBucket
} from "./types";

/**
 * One athlete for every sample activity, so a ride and a hike read as one
 * person's: the same resting and maximum heart rate, and the same zones COROS
 * scores them against (LTHR 168).
 */
export const SAMPLE_ATHLETE = {
  restingHr: 52,
  maxHr: 188,
  zoneCeilings: [133, 154, 168, 173, 183]
} as const;

/** mulberry32 — small, seeded, and the same on every machine. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A slowly wandering value around 0 with the given spread. */
export function wander(random: () => number, persistence: number, spread: number) {
  let value = 0;
  const innovation = spread * Math.sqrt(1 - persistence * persistence);
  return () => {
    const gaussian =
      Math.sqrt(-2 * Math.log(Math.max(random(), 1e-9))) * Math.cos(2 * Math.PI * random());
    value = value * persistence + gaussian * innovation;
    return value;
  };
}

export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;
}

export function haversine(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** The zone bucket a heart rate lands in: 0 up to the first ceiling, and so on. */
export function sampleZoneOf(bpm: number): number {
  const index = SAMPLE_ATHLETE.zoneCeilings.findIndex((ceiling) => bpm <= ceiling);
  return index === -1 ? SAMPLE_ATHLETE.zoneCeilings.length : index;
}

/** Up and down over a 2 m hysteresis, as a barometric watch counts it. */
export function climbOf(
  series: readonly TrainingHubActivitySeriesPoint[]
): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let anchor = series[0]?.altitude ?? 0;
  for (const point of series) {
    const altitude = point.altitude ?? anchor;
    if (altitude - anchor >= 2) {
      gain += altitude - anchor;
      anchor = altitude;
    } else if (anchor - altitude >= 2) {
      loss += anchor - altitude;
      anchor = altitude;
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

export function mean(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Scaled by the 1.2 that puts Banister's TRIMP where COROS's own load lands
 * for a session at the same heart rate (checked against real trainer rides:
 * 52 minutes at 143 bpm is 94).
 */
const COROS_LOAD_SCALE = 1.2;

export interface HeartRateFigures {
  trainingLoad: number;
  /** Seconds above the third ceiling — threshold and up. */
  aboveThreshold: number;
  hrZones: TrainingHubActivityZoneBucket[];
}

/** Load, time in zone and time over threshold, from one heart rate a second. */
export function heartRateFigures(hrs: readonly number[]): HeartRateFigures {
  const { restingHr, maxHr, zoneCeilings } = SAMPLE_ATHLETE;
  let load = 0;
  let aboveThreshold = 0;
  const zoneSeconds = new Array<number>(zoneCeilings.length + 1).fill(0);
  for (const hr of hrs) {
    const reserve = Math.min(1, Math.max(0, (hr - restingHr) / (maxHr - restingHr)));
    load += (1 / 60) * reserve * 0.64 * Math.exp(1.92 * reserve);
    zoneSeconds[sampleZoneOf(hr)] += 1;
    if (hr > zoneCeilings[2]) aboveThreshold += 1;
  }
  const hrZones = zoneSeconds.map((seconds, index) => {
    const ceiling = zoneCeilings[index];
    const floor = index === 0 ? undefined : zoneCeilings[index - 1]! + 1;
    return {
      index,
      ...(floor !== undefined ? { low: floor } : {}),
      ...(ceiling !== undefined ? { high: ceiling } : {}),
      seconds,
      percent: hrs.length > 0 ? Math.round((seconds / hrs.length) * 1000) / 10 : 0
    };
  });
  return { trainingLoad: Math.round(load * COROS_LOAD_SCALE), aboveThreshold, hrZones };
}

export function decimate<T>(points: readonly T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return [...points];
  const step = points.length / maxPoints;
  const result: T[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    result.push(points[Math.floor(index * step)]!);
  }
  result.push(points[points.length - 1]!);
  return result;
}

/** COROS's `yyyyMMdd` day key for an epoch-seconds start, in local time. */
export function happenDay(startTime: number): string {
  const date = new Date(startTime * 1000);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/** Whether a sample activity's day falls inside the window the list was asked for. */
export function insideDayWindow(
  startTime: number | undefined,
  request: { startDay?: string; endDay?: string }
): boolean {
  const day = happenDay(startTime ?? 0);
  return (
    (request.startDay === undefined || day >= request.startDay) &&
    (request.endDay === undefined || day <= request.endDay)
  );
}
