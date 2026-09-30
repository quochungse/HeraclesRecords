import type {
  CorosProfileZone,
  TrainingHubActivitySeriesPoint
} from "../../electron/types";
import { FTP_PRESETS } from "../../electron/workoutCapabilities";

/**
 * What a ride's samples say that its summary does not: the power figures a
 * rider reads off every ride, and the climbs on it.
 *
 * COROS computes some of these itself — its ride summary has fields named
 * `np`, `bicycleIf` and `work` — but they come back 0 on every ride without a
 * meter, which is every ride this app has seen from COROS, so their units have
 * never been checked. So they are worked out here from the samples, by the
 * definitions everyone uses, and a test holds the arithmetic.
 *
 * Every function takes the series on **activity time**
 * (`withPausesRemoved`), the way the ride page already reads it: a coffee stop
 * is not thirty minutes at zero watts.
 */

/** How long one sample may stand in for the seconds after it before it counts as a gap. */
const MAX_HOLD_SECONDS = 5;

/**
 * One value per second of activity time, each sample held until the next, and
 * `undefined` for a gap longer than `MAX_HOLD_SECONDS`. COROS records a ride a
 * second at a time, but smart recording spaces them out, so nothing below may
 * assume one sample is one second.
 */
function perSecond(
  series: readonly TrainingHubActivitySeriesPoint[],
  pick: (point: TrainingHubActivitySeriesPoint) => number | undefined
): (number | undefined)[] {
  const timed = series.filter(
    (point) => typeof point.elapsed === "number" && Number.isFinite(point.elapsed)
  );
  if (timed.length === 0) {
    return [];
  }

  const start = timed[0]!.elapsed!;
  const end = timed[timed.length - 1]!.elapsed!;
  const seconds = new Array<number | undefined>(Math.floor(end - start) + 1).fill(undefined);
  for (let index = 0; index < timed.length; index += 1) {
    const point = timed[index]!;
    const value = pick(point);
    if (value === undefined || !Number.isFinite(value)) {
      continue;
    }
    const from = Math.floor(point.elapsed! - start);
    const next = timed[index + 1];
    const until = next
      ? Math.min(Math.floor(next.elapsed! - start), from + MAX_HOLD_SECONDS)
      : from + 1;
    for (let second = from; second < Math.max(until, from + 1) && second < seconds.length; second += 1) {
      seconds[second] = value;
    }
  }
  return seconds;
}

/** The best average of any `window` consecutive seconds, gaps counted as nothing. */
function bestAverage(values: readonly (number | undefined)[], window: number): number | undefined {
  if (window <= 0 || values.length < window) {
    return undefined;
  }
  let sum = 0;
  for (let index = 0; index < window; index += 1) {
    sum += values[index] ?? 0;
  }
  let best = sum;
  for (let index = window; index < values.length; index += 1) {
    sum += (values[index] ?? 0) - (values[index - window] ?? 0);
    best = Math.max(best, sum);
  }
  return best / window;
}

// ------------------------------------------------------------------- power --

/** The efforts a rider compares one ride against the next by. */
export const PEAK_POWER_WINDOWS: readonly { seconds: number; label: string }[] = [
  { seconds: 5, label: "5 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 1200, label: "20 min" },
  { seconds: 3600, label: "60 min" }
];

/** Coggan's rolling window for normalised power. */
const NORMALIZED_WINDOW_SECONDS = 30;

export interface RidePeakPower {
  seconds: number;
  label: string;
  watts: number;
}

export interface RidePower {
  /** Seconds that carry a power reading, coasting included. */
  seconds: number;
  /** Mean over those seconds, zeros included — as a power meter averages. */
  average: number;
  max: number;
  /**
   * Normalised power: the fourth-power mean of a 30-second rolling average.
   * What the ride cost, where the average is what it measured — a ride of
   * surges and freewheeling costs more than its average says. Absent under 30 s.
   */
  normalized?: number;
  /** Kilojoules of work at the pedals. */
  workKj: number;
  /** Seconds at 0 W — freewheeling, descending, soft-pedalling into a stop. */
  coastingSeconds: number;
  /** Best averages over the standard windows the ride was long enough for. */
  peaks: RidePeakPower[];
}

/**
 * The ride's power a second at a time, `undefined` in a gap. Worked out once
 * and handed to `ridePower` and `powerZoneTime`, which both read it: on a long
 * day it is tens of thousands of seconds.
 */
export type PowerSeconds = readonly (number | undefined)[];

export function powerSeconds(series: readonly TrainingHubActivitySeriesPoint[]): PowerSeconds {
  return perSecond(series, (point) =>
    typeof point.power === "number" && point.power >= 0 ? point.power : undefined
  );
}

/** Absent when the ride carries no power: no meter, or a meter that never spoke. */
export function ridePower(watts: PowerSeconds): RidePower | undefined {
  // One pass for the counts: a 600 km brevet is a hundred thousand seconds,
  // past what `Math.max(...values)` can spread onto the stack.
  let seconds = 0;
  let total = 0;
  let max = 0;
  let coastingSeconds = 0;
  for (const value of watts) {
    if (value === undefined) {
      continue;
    }
    seconds += 1;
    total += value;
    if (value > max) max = value;
    if (value === 0) coastingSeconds += 1;
  }
  if (seconds < 2 || max <= 0) {
    return undefined;
  }

  let normalized: number | undefined;
  if (watts.length >= NORMALIZED_WINDOW_SECONDS) {
    let rolling = 0;
    let fourth = 0;
    let count = 0;
    for (let index = 0; index < watts.length; index += 1) {
      rolling += watts[index] ?? 0;
      if (index >= NORMALIZED_WINDOW_SECONDS) {
        rolling -= watts[index - NORMALIZED_WINDOW_SECONDS] ?? 0;
      }
      if (index >= NORMALIZED_WINDOW_SECONDS - 1) {
        fourth += (rolling / NORMALIZED_WINDOW_SECONDS) ** 4;
        count += 1;
      }
    }
    normalized = count > 0 ? (fourth / count) ** 0.25 : undefined;
  }

  return {
    seconds,
    average: total / seconds,
    max,
    ...(normalized !== undefined ? { normalized } : {}),
    workKj: total / 1000,
    coastingSeconds,
    peaks: PEAK_POWER_WINDOWS.flatMap((window) => {
      const best = bestAverage(watts, window.seconds);
      return best === undefined ? [] : [{ ...window, watts: best }];
    })
  };
}

export interface RideLoadFromPower {
  /** Intensity factor: normalised power over FTP. */
  intensity: number;
  /** Training stress score: an hour at FTP is 100. */
  stressScore: number;
}

/**
 * IF and TSS against an FTP. It is the FTP on the profile **today**: COROS
 * keeps no history of it, so an old ride is scored against a threshold the
 * rider may not have had then — which is why the page says whose FTP it is.
 */
export function rideLoadFromPower(
  power: RidePower,
  ftp: number | undefined
): RideLoadFromPower | undefined {
  if (power.normalized === undefined || ftp === undefined || !(ftp > 0)) {
    return undefined;
  }
  const intensity = power.normalized / ftp;
  return {
    intensity,
    stressScore: ((power.seconds * power.normalized * intensity) / (ftp * 3600)) * 100
  };
}

export interface PowerZoneBound {
  /** "Z1" … "Z7". */
  label: string;
  /** COROS's name for the band — "Threshold". */
  name: string;
  /** Watts, inclusive. Absent on the first zone. */
  floor?: number;
  /** Watts, inclusive. Absent on the last, which is open-ended. */
  ceiling?: number;
}

/**
 * The account's power zones, as COROS states them: each entry is a zone's
 * **ceiling** and the top one a sentinel (900 W), so zone n runs from one above
 * entry n−1 to entry n and the last is open — the reading of every other COROS
 * zone family (see "Training zones" in CLAUDE.md). An account with no power
 * zones of its own gets COROS's default seven off its FTP; with neither, none.
 */
export function powerZoneBounds(
  zones: readonly CorosProfileZone[] | undefined,
  ftp: number | undefined
): PowerZoneBound[] | undefined {
  const own = [...(zones ?? [])]
    .filter((zone) => typeof zone.watts === "number" && zone.watts > 0)
    .sort((left, right) => left.index - right.index)
    .map((zone) => zone.watts!);
  const ceilings =
    own.length >= 3
      ? own.slice(0, -1)
      : ftp !== undefined && ftp > 0
        ? FTP_PRESETS.slice(0, -1).map((preset) => Math.round((ftp * preset.high) / 100))
        : undefined;
  if (!ceilings) {
    return undefined;
  }

  const count = ceilings.length + 1;
  return Array.from({ length: count }, (_, index) => ({
    label: `Z${index + 1}`,
    name: count === FTP_PRESETS.length ? FTP_PRESETS[index]!.label : `Zone ${index + 1}`,
    ...(index > 0 ? { floor: ceilings[index - 1]! + 1 } : {}),
    ...(index < ceilings.length ? { ceiling: ceilings[index]! } : {})
  }));
}

export interface PowerZoneTime extends PowerZoneBound {
  seconds: number;
}

/**
 * Seconds spent in each power zone, over the seconds the rider was pedalling.
 * Coasting is left out rather than filed under Recovery: forty minutes
 * freewheeling off a mountain would otherwise read as forty minutes of easy
 * riding, and it is reported beside the zones on its own.
 */
export function powerZoneTime(
  watts: PowerSeconds,
  bounds: readonly PowerZoneBound[]
): PowerZoneTime[] {
  const seconds = bounds.map(() => 0);
  for (const value of watts) {
    if (value === undefined || value <= 0) {
      continue;
    }
    const watts = Math.round(value);
    const zone = bounds.findIndex((bound) => bound.ceiling === undefined || watts <= bound.ceiling);
    seconds[zone === -1 ? bounds.length - 1 : zone] += 1;
  }
  return bounds.map((bound, index) => ({ ...bound, seconds: seconds[index]! }));
}

// ------------------------------------------------------------------- speed --

/** Seconds a top speed has to be held, so one GPS jump is not the ride's fastest moment. */
const MAX_SPEED_WINDOW_SECONDS = 5;

/** The fastest the ride went for five seconds together, km/h. */
export function rideMaxSpeedKmh(
  series: readonly TrainingHubActivitySeriesPoint[]
): number | undefined {
  const speeds = perSecond(series, (point) =>
    typeof point.pace === "number" && point.pace > 0 ? 3600 / point.pace : undefined
  );
  if (speeds.filter((value) => value !== undefined).length < MAX_SPEED_WINDOW_SECONDS) {
    return undefined;
  }
  const best = bestAverage(speeds, MAX_SPEED_WINDOW_SECONDS);
  return best !== undefined && best > 0 ? best : undefined;
}

// ------------------------------------------------------------------ climbs --

/** Metres between the points the climb finder reads the road at. */
const CLIMB_STEP_METERS = 25;
/** Either side of a point that its height is averaged over — a barometer's wobble is not a hill. */
const CLIMB_SMOOTH_METERS = 50;
/** A dip inside a climb that does not end it: this much, or a tenth of the height gained so far. */
const CLIMB_MIN_DIP_METERS = 10;
/** A plateau this long past the top ends the climb there. */
const CLIMB_MAX_PLATEAU_METERS = 1000;
/** The lead-in and run-out trimmed off each end, where the road is not yet climbing. */
const CLIMB_TRIM_METERS = 250;
const CLIMB_TRIM_GRADE = 0.02;
const CLIMB_MIN_GRADE = 0.03;
/** Grade over this stretch is what "max grade" means — steepest 200 m, not steepest sample. */
const MAX_GRADE_METERS = 200;

export type ClimbCategory = "HC" | "1" | "2" | "3" | "4";

/**
 * The categories as Strava scores them: length in metres times average grade
 * in percent. A kilometre at 8% is the least that is a climb at all (Cat 4);
 * Tam Đảo's 13 km at 7% is hors catégorie.
 */
const CATEGORY_SCORES: readonly { category: ClimbCategory; score: number }[] = [
  { category: "HC", score: 80_000 },
  { category: "1", score: 64_000 },
  { category: "2", score: 32_000 },
  { category: "3", score: 16_000 },
  { category: "4", score: 8_000 }
];

export function climbCategory(lengthMeters: number, grade: number): ClimbCategory | undefined {
  const score = lengthMeters * grade * 100;
  return CATEGORY_SCORES.find((entry) => score >= entry.score)?.category;
}

export interface RideClimb {
  /** Metres into the ride where it starts and tops out. */
  startMeters: number;
  endMeters: number;
  lengthMeters: number;
  gainMeters: number;
  /** Average grade, 0..1. */
  grade: number;
  /** Steepest 200 m, 0..1. */
  maxGrade?: number;
  category: ClimbCategory;
  /** Activity time spent on it. */
  seconds?: number;
  /** Vertical metres an hour: the climbing rate, what riders compare a climb by. */
  vam?: number;
  avgPower?: number;
  avgHr?: number;
}

interface RoadPoint {
  distance: number;
  altitude: number;
  elapsed?: number;
}

/** The road every `CLIMB_STEP_METERS`, heights smoothed and times interpolated. */
function roadProfile(series: readonly TrainingHubActivitySeriesPoint[]): RoadPoint[] {
  const located = series.filter(
    (point) =>
      typeof point.distance === "number" &&
      Number.isFinite(point.distance) &&
      typeof point.altitude === "number" &&
      Number.isFinite(point.altitude)
  );
  if (located.length < 2) {
    return [];
  }

  const end = located[located.length - 1]!.distance!;
  const raw: RoadPoint[] = [];
  let cursor = 0;
  for (let distance = located[0]!.distance!; distance <= end; distance += CLIMB_STEP_METERS) {
    while (cursor < located.length - 2 && located[cursor + 1]!.distance! < distance) {
      cursor += 1;
    }
    const from = located[cursor]!;
    const to = located[cursor + 1]!;
    const span = to.distance! - from.distance!;
    const t = span > 0 ? Math.min(1, Math.max(0, (distance - from.distance!) / span)) : 0;
    const elapsed =
      from.elapsed !== undefined && to.elapsed !== undefined
        ? from.elapsed + (to.elapsed - from.elapsed) * t
        : undefined;
    raw.push({
      distance,
      altitude: from.altitude! + (to.altitude! - from.altitude!) * t,
      ...(elapsed !== undefined ? { elapsed } : {})
    });
  }

  const reach = Math.round(CLIMB_SMOOTH_METERS / CLIMB_STEP_METERS);
  const prefix = [0];
  for (const point of raw) {
    prefix.push(prefix[prefix.length - 1]! + point.altitude);
  }
  return raw.map((point, index) => {
    const from = Math.max(0, index - reach);
    const to = Math.min(raw.length, index + reach + 1);
    return { ...point, altitude: (prefix[to]! - prefix[from]!) / (to - from) };
  });
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The climbs on a ride, in the order they were ridden.
 *
 * Read off the road the way a rider would name them: from the bottom of a rise
 * to its top, carried through a dip or a flat bend that does not give back
 * much of what was gained, trimmed of the flat approach and the flat summit,
 * and kept only where it earns a category. COROS's own `trackClimbInfo` is
 * empty on every payload seen so far, so there is nothing of theirs to show.
 */
export function rideClimbs(series: readonly TrainingHubActivitySeriesPoint[]): RideClimb[] {
  const road = roadProfile(series);
  if (road.length < 2) {
    return [];
  }

  const trimSteps = Math.round(CLIMB_TRIM_METERS / CLIMB_STEP_METERS);
  const gradeSteps = Math.round(MAX_GRADE_METERS / CLIMB_STEP_METERS);
  const gradeBetween = (from: number, to: number) =>
    (road[to]!.altitude - road[from]!.altitude) / (road[to]!.distance - road[from]!.distance);

  const climbs: RideClimb[] = [];
  const consider = (bottom: number, top: number) => {
    // The approach and the summit plateau are not the climb.
    while (top - bottom > trimSteps && gradeBetween(bottom, bottom + trimSteps) < CLIMB_TRIM_GRADE) {
      bottom += 1;
    }
    while (top - bottom > trimSteps && gradeBetween(top - trimSteps, top) < CLIMB_TRIM_GRADE) {
      top -= 1;
    }
    if (top <= bottom) {
      return;
    }

    const start = road[bottom]!;
    const end = road[top]!;
    const lengthMeters = end.distance - start.distance;
    const gainMeters = end.altitude - start.altitude;
    const grade = lengthMeters > 0 ? gainMeters / lengthMeters : 0;
    const category = climbCategory(lengthMeters, grade);
    if (grade < CLIMB_MIN_GRADE || category === undefined) {
      return;
    }

    let maxGrade: number | undefined;
    for (let index = bottom; index + gradeSteps <= top; index += 1) {
      const steep = gradeBetween(index, index + gradeSteps);
      maxGrade = maxGrade === undefined ? steep : Math.max(maxGrade, steep);
    }

    const seconds =
      start.elapsed !== undefined && end.elapsed !== undefined
        ? end.elapsed - start.elapsed
        : undefined;
    const on = series.filter(
      (point) =>
        typeof point.distance === "number" &&
        point.distance >= start.distance &&
        point.distance <= end.distance
    );
    const powers = on.flatMap((point) => (typeof point.power === "number" ? [point.power] : []));
    const hrs = on.flatMap((point) => (typeof point.hr === "number" && point.hr > 0 ? [point.hr] : []));
    const avgPower = mean(powers);
    const avgHr = mean(hrs);

    climbs.push({
      startMeters: start.distance,
      endMeters: end.distance,
      lengthMeters,
      gainMeters,
      grade,
      ...(maxGrade !== undefined ? { maxGrade } : {}),
      category,
      ...(seconds !== undefined && seconds > 0
        ? { seconds, vam: gainMeters / (seconds / 3600) }
        : {}),
      ...(avgPower !== undefined && powers.some((value) => value > 0) ? { avgPower } : {}),
      ...(avgHr !== undefined ? { avgHr } : {})
    });
  };

  let bottom = 0;
  let top = 0;
  for (let index = 1; index < road.length; index += 1) {
    const altitude = road[index]!.altitude;
    if (altitude > road[top]!.altitude) {
      top = index;
      continue;
    }
    // Nothing gained yet: the bottom follows the road down.
    if (top === bottom) {
      if (altitude <= road[bottom]!.altitude) {
        bottom = index;
        top = index;
      }
      continue;
    }
    const gained = road[top]!.altitude - road[bottom]!.altitude;
    const dropped = road[top]!.altitude - altitude;
    const plateau = road[index]!.distance - road[top]!.distance;
    if (dropped > Math.max(CLIMB_MIN_DIP_METERS, gained * 0.1) || plateau > CLIMB_MAX_PLATEAU_METERS) {
      consider(bottom, top);
      bottom = index;
      top = index;
    }
  }
  if (top > bottom) {
    consider(bottom, top);
  }
  return climbs;
}
