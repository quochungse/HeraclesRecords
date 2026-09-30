import type { TrainingHubActivity } from "../../electron/types";
import {
  RIDE_TYPES,
  classifyRideType,
  isOutdoorRideType,
  isRideSportType,
  type RideType
} from "./rideType";
import { startOfRunWeekMs } from "../running/runMetrics";

// "The last N weeks" is one definition across the sport screens: calendar
// weeks from a Monday, this one included. The run module owns it and nothing
// in it is about running, so Cycling reads it from there rather than restating
// it a day off.
export {
  climbPerDistanceUnit,
  runWindowStartMs as rideWindowStartMs
} from "../running/runMetrics";

const MS_PER_DAY = 86_400_000;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** COROS sends epoch seconds on the activity list. */
function startedAtMs(activity: TrainingHubActivity): number | undefined {
  const seconds = positive(activity.startTime);
  return seconds === undefined ? undefined : seconds * 1000;
}

/**
 * How long a ride took, in the sense every figure on this screen means: time
 * spent riding. `duration` is COROS's activity time, auto-pause out — never
 * `elapsedDuration`, which counts the café stop as riding and puts a 30 km/h
 * ride at 22.
 */
export function rideSeconds(
  activity: Pick<TrainingHubActivity, "duration">
): number | undefined {
  return positive(activity.duration);
}

/**
 * Kilometres per hour, or nothing.
 *
 * An indoor ride on a trainer that reports no speed comes back with no
 * distance, and is not a 0 km/h ride: a zero would sit at the bottom of every
 * speed figure it reached.
 */
export function speedKmh(
  activity: Pick<TrainingHubActivity, "distance" | "duration">
): number | undefined {
  const distance = positive(activity.distance);
  const duration = rideSeconds(activity);
  if (distance === undefined || duration === undefined) {
    return undefined;
  }

  return distance / METERS_PER_KM / (duration / SECONDS_PER_HOUR);
}

/** Climb per kilometre. Absent when COROS recorded no climb or no distance. */
export function rideElevationPerKm(
  activity: TrainingHubActivity
): number | undefined {
  const distance = positive(activity.distance);
  if (distance === undefined || activity.elevationGain === undefined) {
    return undefined;
  }

  return activity.elevationGain / (distance / METERS_PER_KM);
}

export interface RideTotals {
  count: number;
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  /**
   * Seconds of the rides that recorded a distance — the only time a speed can
   * be taken over. An hour on a trainer that measured nothing is riding, and is
   * in `duration`; it is not an hour at 0 km/h.
   */
  distanceDuration: number;
  trainingLoad: number;
  /** Metres. */
  elevationGain: number;
}

/** What one kind of ride added to a week, one field per thing the chart can measure. */
export interface RideTypeVolume {
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  /** Metres climbed. */
  elevationGain: number;
}

export interface RideWeek extends RideTotals {
  weekStartMs: number;
  label: string;
  /** Metres of the week's single longest ride, by distance. */
  longestRideMeters: number;
  /** Seconds of the week's single longest ride, by time. */
  longestRideSeconds: number;
  /** Metres climbed on the week's single hilliest ride. */
  biggestClimbMeters: number;
  /** Per kind of ride, for the volume chart's stacked bars. */
  byType: Record<RideType, RideTypeVolume>;
}

function emptyTotals(): RideTotals {
  return {
    count: 0,
    distance: 0,
    duration: 0,
    distanceDuration: 0,
    trainingLoad: 0,
    elevationGain: 0
  };
}

function emptyTypeVolumes(): Record<RideType, RideTypeVolume> {
  const volumes = {} as Record<RideType, RideTypeVolume>;
  for (const type of RIDE_TYPES) {
    volumes[type] = { distance: 0, duration: 0, elevationGain: 0 };
  }
  return volumes;
}

function addToTotals(totals: RideTotals, activity: TrainingHubActivity): void {
  const distance = positive(activity.distance);
  const duration = rideSeconds(activity) ?? 0;
  totals.count += 1;
  totals.distance += distance ?? 0;
  totals.duration += duration;
  if (distance !== undefined) {
    totals.distanceDuration += duration;
  }
  totals.trainingLoad += positive(activity.trainingLoad) ?? 0;
  totals.elevationGain += positive(activity.elevationGain) ?? 0;
}

/** Average speed of a total, over the time that recorded a distance. */
export function totalsSpeedKmh(totals: RideTotals): number | undefined {
  return totals.distance > 0 && totals.distanceDuration > 0
    ? totals.distance / METERS_PER_KM / (totals.distanceDuration / SECONDS_PER_HOUR)
    : undefined;
}

/** Every ride in the list added up, ignoring dates. */
export function summariseRides(
  activities: readonly TrainingHubActivity[]
): RideTotals {
  const totals = emptyTotals();
  for (const activity of activities) {
    if (isRideSportType(activity.sportType)) {
      addToTotals(totals, activity);
    }
  }
  return totals;
}

function weekLabel(weekStartMs: number): string {
  return new Date(weekStartMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

export interface BuildRideWeeksOptions {
  /** How many weeks back to build, the current week included. */
  weeks: number;
  /** Defaults to now; injected by tests. */
  nowMs?: number;
}

/**
 * One bucket per week, oldest first, with **no gaps** — a week off the bike is
 * a zero bar, not a missing one, or a fortnight away reads as a block that
 * never stopped. The same shape as `buildRunWeeks`, stepped through the local
 * calendar for the same DST reason.
 */
export function buildRideWeeks(
  activities: readonly TrainingHubActivity[],
  { weeks, nowMs = Date.now() }: BuildRideWeeksOptions
): RideWeek[] {
  if (weeks <= 0) {
    return [];
  }

  const currentWeekStart = startOfRunWeekMs(nowMs);
  const buckets = new Map<number, RideWeek>();

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const cursor = new Date(currentWeekStart);
    cursor.setDate(cursor.getDate() - index * 7);
    const weekStartMs = cursor.getTime();
    buckets.set(weekStartMs, {
      weekStartMs,
      label: weekLabel(weekStartMs),
      longestRideMeters: 0,
      longestRideSeconds: 0,
      biggestClimbMeters: 0,
      byType: emptyTypeVolumes(),
      ...emptyTotals()
    });
  }

  for (const activity of activities) {
    const type = classifyRideType(activity.sportType);
    const at = startedAtMs(activity);
    if (type === null || at === undefined) {
      continue;
    }

    const bucket = buckets.get(startOfRunWeekMs(at));
    if (!bucket) {
      continue;
    }

    addToTotals(bucket, activity);
    const distance = positive(activity.distance) ?? 0;
    const duration = rideSeconds(activity) ?? 0;
    const climb = positive(activity.elevationGain) ?? 0;
    const volume = bucket.byType[type];
    volume.distance += distance;
    volume.duration += duration;
    volume.elevationGain += climb;
    bucket.longestRideMeters = Math.max(bucket.longestRideMeters, distance);
    bucket.longestRideSeconds = Math.max(bucket.longestRideSeconds, duration);
    bucket.biggestClimbMeters = Math.max(bucket.biggestClimbMeters, climb);
  }

  return [...buckets.values()].sort(
    (left, right) => left.weekStartMs - right.weekStartMs
  );
}

export interface RideLoadBalance {
  /** Training load over the last 7 days. */
  acute: number;
  /** Weekly-equivalent load over the last 28 days. */
  chronic: number;
  /** acute ÷ chronic. Absent while there is nothing to divide by. */
  ratio?: number;
  /**
   * How far back the oldest ride is, across the whole list — under ~21 days the
   * chronic figure is averaging over history that does not exist. See
   * `RunLoadBalance.oldestRunDaysAgo` for why it is the list and not the window.
   */
  oldestRideDaysAgo?: number;
}

/**
 * Acute-to-chronic load, riding only.
 *
 * COROS's own `trainingLoadRatio` is taken across every sport, so a heavy
 * week of running moves it. The question this screen answers is whether the
 * *riding* has jumped, so it is tallied from ride load alone.
 */
export function rideLoadBalance(
  activities: readonly TrainingHubActivity[],
  nowMs: number = Date.now()
): RideLoadBalance {
  let acute = 0;
  let chronicTotal = 0;
  let oldestAt: number | undefined;

  for (const activity of activities) {
    const at = startedAtMs(activity);
    if (at === undefined || !isRideSportType(activity.sportType) || at > nowMs) {
      continue;
    }

    if (oldestAt === undefined || at < oldestAt) {
      oldestAt = at;
    }

    const daysAgo = (nowMs - at) / MS_PER_DAY;
    if (daysAgo > 28) {
      continue;
    }

    const load = positive(activity.trainingLoad) ?? 0;
    chronicTotal += load;
    if (daysAgo <= 7) {
      acute += load;
    }
  }

  const chronic = chronicTotal / 4;
  return {
    acute,
    chronic,
    ...(chronic > 0 ? { ratio: acute / chronic } : {}),
    ...(oldestAt !== undefined
      ? { oldestRideDaysAgo: (nowMs - oldestAt) / MS_PER_DAY }
      : {})
  };
}

/** The kinds of ride actually present in a list, in render order. */
export function rideTypesPresent(
  activities: readonly TrainingHubActivity[]
): RideType[] {
  const seen = new Set<RideType>();
  for (const activity of activities) {
    const type = classifyRideType(activity.sportType);
    if (type !== null) {
      seen.add(type);
    }
  }
  return RIDE_TYPES.filter((type) => seen.has(type));
}

export interface RideTypeTotals extends RideTotals {
  type: RideType;
  /**
   * Share of the list's riding **time**, 0..1 — not its distance, as a run's
   * surfaces are shared. An hour of singletrack covers half the ground of an
   * hour on the road, and a trainer may cover none; by distance both would
   * read as a sliver of a week they took a good part of.
   */
  share: number;
  /** Aggregate km/h — total distance over the time that recorded one. */
  speed?: number;
  /** Metres climbed per kilometre. Absent indoors, where there is no terrain. */
  elevationPerKm?: number;
}

/** Per-kind totals, in render order, skipping kinds with no rides. */
export function rideTypeBreakdown(
  activities: readonly TrainingHubActivity[]
): RideTypeTotals[] {
  const totals = new Map<RideType, RideTotals>();
  for (const activity of activities) {
    const type = classifyRideType(activity.sportType);
    if (type === null) {
      continue;
    }
    const bucket = totals.get(type) ?? emptyTotals();
    addToTotals(bucket, activity);
    totals.set(type, bucket);
  }

  const overall = [...totals.values()].reduce(
    (sum, bucket) => sum + bucket.duration,
    0
  );

  return RIDE_TYPES.flatMap((type) => {
    const bucket = totals.get(type);
    if (!bucket || bucket.count === 0) {
      return [];
    }

    const speed = totalsSpeedKmh(bucket);
    const outdoor = isOutdoorRideType(type);
    const elevationPerKm =
      outdoor && bucket.distance > 0
        ? bucket.elevationGain / (bucket.distance / METERS_PER_KM)
        : undefined;

    return [
      {
        type,
        ...bucket,
        share: overall > 0 ? bucket.duration / overall : 0,
        ...(speed !== undefined ? { speed } : {}),
        ...(elevationPerKm !== undefined ? { elevationPerKm } : {})
      }
    ];
  });
}
