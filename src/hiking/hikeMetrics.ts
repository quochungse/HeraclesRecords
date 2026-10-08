import type { TrainingHubActivity } from "../../electron/types";
import {
  ascentPerHour,
  climbingRateOf,
  startOfRunWeekMs,
  type ClimbingRate
} from "../running/runMetrics";
import {
  HIKE_TYPES,
  classifyHikeType,
  isHikeSportType,
  type HikeType
} from "./hikeType";

import { getIntlLocale } from "../i18n/core";
// "The last N weeks" is one definition across the sport screens — calendar
// weeks from a Monday, this one included — owned by the run module; see
// rideMetrics.ts, which reads it from there for the same reason. So is the
// climbing rate, which Running's trail view reads too.
export {
  CLIMBING_RATE_MIN_GAIN_M,
  climbPerDistanceUnit,
  runWindowStartMs as hikeWindowStartMs,
  type ClimbingRate
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
 * How long a hike took, as the list states it: COROS's activity time.
 *
 * On a run that is the time spent running. On a hike it usually is not: COROS's
 * hike mode leaves auto-pause off, so the lunch at the camp and the half hour
 * at the top are in it — which is why this screen calls it time *on the trail*
 * and the hike page works the moving time out of the samples. It is still
 * never `elapsedDuration`, which a walker who did turn auto-pause on would see
 * counting the stops a second time.
 */
export function hikeSeconds(
  activity: Pick<TrainingHubActivity, "duration">
): number | undefined {
  return positive(activity.duration);
}

/** Kilometres per hour over the time on the trail, or nothing. */
export function hikeSpeedKmh(
  activity: Pick<TrainingHubActivity, "distance" | "duration">
): number | undefined {
  const distance = positive(activity.distance);
  const duration = hikeSeconds(activity);
  if (distance === undefined || duration === undefined) {
    return undefined;
  }

  return distance / METERS_PER_KM / (duration / SECONDS_PER_HOUR);
}

/**
 * Metres climbed an hour over the whole hike — the figure a walker reads a
 * day in the hills by, where a runner reads pace. Taken over the time on the
 * trail, stops included, so it is a day's rate rather than a climb's; the hike
 * page states the rate on the climbs themselves.
 */
export function hikeAscentRate(
  activity: Pick<TrainingHubActivity, "elevationGain" | "duration">
): number | undefined {
  return ascentPerHour(activity);
}

export interface HikeTotals {
  count: number;
  /** Metres. */
  distance: number;
  /** Seconds on the trail. */
  duration: number;
  trainingLoad: number;
  /** Metres. */
  elevationGain: number;
}

/** What one kind of hike added to a week, one field per thing the chart can measure. */
export interface HikeTypeVolume {
  distance: number;
  duration: number;
  elevationGain: number;
}

export interface HikeWeek extends HikeTotals {
  weekStartMs: number;
  label: string;
  /** Seconds of the week's single longest hike. */
  longestHikeSeconds: number;
  /** Metres of the week's single longest hike, by distance. */
  longestHikeMeters: number;
  /** Metres climbed on the week's single biggest ascent. */
  biggestAscentMeters: number;
  byType: Record<HikeType, HikeTypeVolume>;
}

function emptyTotals(): HikeTotals {
  return { count: 0, distance: 0, duration: 0, trainingLoad: 0, elevationGain: 0 };
}

function emptyTypeVolumes(): Record<HikeType, HikeTypeVolume> {
  const volumes = {} as Record<HikeType, HikeTypeVolume>;
  for (const type of HIKE_TYPES) {
    volumes[type] = { distance: 0, duration: 0, elevationGain: 0 };
  }
  return volumes;
}

function addToTotals(totals: HikeTotals, activity: TrainingHubActivity): void {
  totals.count += 1;
  totals.distance += positive(activity.distance) ?? 0;
  totals.duration += hikeSeconds(activity) ?? 0;
  totals.trainingLoad += positive(activity.trainingLoad) ?? 0;
  totals.elevationGain += positive(activity.elevationGain) ?? 0;
}

/** Kilometres per hour of a total. */
export function totalsSpeedKmh(totals: HikeTotals): number | undefined {
  return totals.distance > 0 && totals.duration > 0
    ? totals.distance / METERS_PER_KM / (totals.duration / SECONDS_PER_HOUR)
    : undefined;
}

/** Metres climbed an hour of a total. */
export function totalsAscentRate(totals: HikeTotals): number | undefined {
  return totals.elevationGain > 0 && totals.duration > 0
    ? totals.elevationGain / (totals.duration / SECONDS_PER_HOUR)
    : undefined;
}

/** Every hike in the list added up, ignoring dates. */
export function summariseHikes(
  activities: readonly TrainingHubActivity[]
): HikeTotals {
  const totals = emptyTotals();
  for (const activity of activities) {
    if (isHikeSportType(activity.sportType)) {
      addToTotals(totals, activity);
    }
  }
  return totals;
}

function weekLabel(weekStartMs: number): string {
  return new Date(weekStartMs).toLocaleDateString(getIntlLocale(), {
    month: "short",
    day: "numeric"
  });
}

export interface BuildHikeWeeksOptions {
  /** How many weeks back to build, the current week included. */
  weeks: number;
  /** Defaults to now; injected by tests. */
  nowMs?: number;
}

/**
 * One bucket per week, oldest first, with no gaps — a weekend at home is a
 * zero bar, which on a hiking chart is most weeks' honest answer. The same
 * shape as `buildRunWeeks` and `buildRideWeeks`.
 */
export function buildHikeWeeks(
  activities: readonly TrainingHubActivity[],
  { weeks, nowMs = Date.now() }: BuildHikeWeeksOptions
): HikeWeek[] {
  if (weeks <= 0) {
    return [];
  }

  const currentWeekStart = startOfRunWeekMs(nowMs);
  const buckets = new Map<number, HikeWeek>();

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const cursor = new Date(currentWeekStart);
    cursor.setDate(cursor.getDate() - index * 7);
    const weekStartMs = cursor.getTime();
    buckets.set(weekStartMs, {
      weekStartMs,
      label: weekLabel(weekStartMs),
      longestHikeSeconds: 0,
      longestHikeMeters: 0,
      biggestAscentMeters: 0,
      byType: emptyTypeVolumes(),
      ...emptyTotals()
    });
  }

  for (const activity of activities) {
    const type = classifyHikeType(activity.sportType);
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
    const duration = hikeSeconds(activity) ?? 0;
    const climb = positive(activity.elevationGain) ?? 0;
    const volume = bucket.byType[type];
    volume.distance += distance;
    volume.duration += duration;
    volume.elevationGain += climb;
    bucket.longestHikeSeconds = Math.max(bucket.longestHikeSeconds, duration);
    bucket.longestHikeMeters = Math.max(bucket.longestHikeMeters, distance);
    bucket.biggestAscentMeters = Math.max(bucket.biggestAscentMeters, climb);
  }

  return [...buckets.values()].sort(
    (left, right) => left.weekStartMs - right.weekStartMs
  );
}

/** The kinds of hike actually present in a list, in render order. */
export function hikeTypesPresent(
  activities: readonly TrainingHubActivity[]
): HikeType[] {
  const seen = new Set<HikeType>();
  for (const activity of activities) {
    const type = classifyHikeType(activity.sportType);
    if (type !== null) {
      seen.add(type);
    }
  }
  return HIKE_TYPES.filter((type) => seen.has(type));
}

export interface HikeTypeTotals extends HikeTotals {
  type: HikeType;
  /** Share of the list's time on the trail, 0..1 — a mountain day covers little ground. */
  share: number;
  speed?: number;
  /** Metres climbed per kilometre. */
  elevationPerKm?: number;
  /** Metres climbed an hour on the trail. */
  ascentRate?: number;
}

/** Per-kind totals, in render order, skipping kinds with no hikes. */
export function hikeTypeBreakdown(
  activities: readonly TrainingHubActivity[]
): HikeTypeTotals[] {
  const totals = new Map<HikeType, HikeTotals>();
  for (const activity of activities) {
    const type = classifyHikeType(activity.sportType);
    if (type === null) {
      continue;
    }
    const bucket = totals.get(type) ?? emptyTotals();
    addToTotals(bucket, activity);
    totals.set(type, bucket);
  }

  const overall = [...totals.values()].reduce((sum, bucket) => sum + bucket.duration, 0);

  return HIKE_TYPES.flatMap((type) => {
    const bucket = totals.get(type);
    if (!bucket || bucket.count === 0) {
      return [];
    }
    const speed = totalsSpeedKmh(bucket);
    const ascentRate = totalsAscentRate(bucket);
    const elevationPerKm =
      bucket.distance > 0 ? bucket.elevationGain / (bucket.distance / METERS_PER_KM) : undefined;
    return [
      {
        type,
        ...bucket,
        share: overall > 0 ? bucket.duration / overall : 0,
        ...(speed !== undefined ? { speed } : {}),
        ...(elevationPerKm !== undefined ? { elevationPerKm } : {}),
        ...(ascentRate !== undefined ? { ascentRate } : {})
      }
    ];
  });
}

/**
 * The single biggest day on the trail in a window: the longest by time, which
 * is what a multi-day hike is trained for — hours on the feet, pack on. Its
 * ascent is stated beside it by the caller.
 */
export function biggestHike(
  activities: readonly TrainingHubActivity[],
  { days, nowMs = Date.now() }: { days: number; nowMs?: number }
): TrainingHubActivity | undefined {
  const cutoff = nowMs - days * MS_PER_DAY;
  let best: TrainingHubActivity | undefined;
  for (const activity of activities) {
    const at = startedAtMs(activity);
    if (at === undefined || at < cutoff || at > nowMs || !isHikeSportType(activity.sportType)) {
      continue;
    }
    if ((hikeSeconds(activity) ?? 0) > (best ? (hikeSeconds(best) ?? 0) : 0)) {
      best = activity;
    }
  }
  return best;
}

/**
 * How fast the athlete gains height, over the hikes that climbed enough to
 * say — the fitness figure of a walker, as threshold pace is a runner's. The
 * rule is `climbingRateOf`, shared with Running's trail view.
 */
export function climbingRate(
  activities: readonly TrainingHubActivity[],
  window: { days: number; nowMs?: number }
): ClimbingRate {
  return climbingRateOf(activities, isHikeSportType, window);
}
