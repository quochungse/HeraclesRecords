import type {
  ActivityDetailSummary,
  CorosProfileZoneFamily,
  StrengthLoadSource,
  TrainingHubActivity,
  TrainingHubZoneDistributionEntry
} from "../../../electron/types";
import { intensityForZone, type RunIntensity } from "../../running/runMetrics";
import { activityStartTimeMs } from "../activityWindow";
import { activityLoad } from "../loadFigures";
import { sportColorCategory, SPORT_COLOR_CATEGORIES, type SportColorCategory } from "../sportColors";

/*
 * The arithmetic behind Overview's Training load distribution: the last four
 * weeks' load by sport, every sport, in the load the athlete reads strength
 * in; then time in each heart-rate zone over the sports heart rate measures,
 * with the easy / moderate / hard split it adds up to. A stop-start session
 * (lifting, climbing, a match) is left out of the zones: its heart rate says
 * little of the effort.
 */

/** The window. */
export const DISTRIBUTION_DAYS = 28;

/**
 * COROS's codes for the steady sports heart rate measures: running, hiking,
 * cycling, swimming, cross-country skiing and ski touring, rowing, flatwater
 * paddling, walking, stair climbing and the elliptical. Anything else —
 * strength and gym cardio, climbing, downhill skiing, ball and racket sports,
 * yoga, a custom sport — is stop-start or unknown, and stays out.
 */
const HEART_RATE_SPORT_TYPES: ReadonlySet<number> = new Set([
  100, 101, 102, 103, 104, 105, 200, 201, 202, 203, 204, 205, 299, 300, 301, 502, 503, 700, 701, 704, 900, 902, 903
]);

export function isHeartRateSport(sportType: number | undefined): boolean {
  return sportType !== undefined && HEART_RATE_SPORT_TYPES.has(sportType);
}

/** The heart-rate sports' sessions of the last `days` days: what the zones are read over. */
export function heartRateSessions(
  activities: readonly TrainingHubActivity[],
  now = new Date(),
  days = DISTRIBUTION_DAYS
): TrainingHubActivity[] {
  const since = now.getTime() - days * 86_400_000;
  return activities.filter((activity) => {
    const start = activityStartTimeMs(activity) ?? 0;
    return isHeartRateSport(activity.sportType) && start >= since && start <= now.getTime();
  });
}

export interface SportShare {
  category: SportColorCategory;
  /** In the chosen load. */
  load: number;
  share: number;
}

/**
 * Load by sport over the last `days` days, every sport, the biggest first; a
 * sport with no load is left out rather than drawn as a sliver. With Heracles
 * chosen a strength session counts its Heracles load.
 */
export function sportLoadShares(
  activities: readonly TrainingHubActivity[],
  now = new Date(),
  days = DISTRIBUTION_DAYS,
  source: StrengthLoadSource = "coros"
): { total: number; sports: SportShare[] } {
  const since = now.getTime() - days * 86_400_000;
  const loads = new Map<SportColorCategory, number>();
  for (const activity of activities) {
    const start = activityStartTimeMs(activity) ?? 0;
    const load = activityLoad(activity, source) ?? 0;
    if (start < since || start > now.getTime() || !Number.isFinite(load) || load <= 0) {
      continue;
    }
    const category = sportColorCategory(activity.sportType);
    loads.set(category, (loads.get(category) ?? 0) + load);
  }
  const total = [...loads.values()].reduce((sum, load) => sum + load, 0);
  const sports = SPORT_COLOR_CATEGORIES.filter((category) => (loads.get(category) ?? 0) > 0)
    .map((category) => {
      const load = loads.get(category) ?? 0;
      return { category, load, share: total > 0 ? load / total : 0 };
    })
    .sort((left, right) => right.load - left.load);
  return { total, sports };
}

/**
 * Time in each heart-rate zone over the given sessions, from each one's own
 * detail (`ActivityDetailSummary.zoneSeconds`, COROS's seconds per zone), as
 * entries `zoneShares` reads. `read` of `total` sessions had one; the rest are
 * still being fetched, or kept no heart rate.
 */
export function zoneTimeEntries(
  sessions: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): { entries: TrainingHubZoneDistributionEntry[]; read: number; total: number } {
  const seconds: number[] = [];
  let read = 0;
  for (const session of sessions) {
    const zones = summaries.get(session.activityId)?.zoneSeconds;
    if (!zones?.some((value) => value > 0)) continue;
    read += 1;
    zones.forEach((value, index) => {
      seconds[index] = (seconds[index] ?? 0) + (Number.isFinite(value) && value > 0 ? value : 0);
    });
  }
  return {
    entries: Array.from(seconds, (value, index) => ({ index, value: value ?? 0 })),
    read,
    total: sessions.length
  };
}

export interface ZoneShare {
  /** 0 is the easiest zone. */
  position: number;
  value: number;
  share: number;
}

/**
 * COROS's zone area list, one row a zone, easiest first. COROS numbers the
 * buckets from zero, as it numbers the zones, so a bucket's `index` is its
 * zone — read from the bucket, so a list missing one does not shift the rest.
 * Its own ratio stands where it sent one; otherwise the value's share.
 */
export function zoneShares(entries: readonly TrainingHubZoneDistributionEntry[]): {
  total: number;
  rows: ZoneShare[];
} {
  const sorted = [...entries].sort((left, right) => left.index - right.index);
  const value = (entry: TrainingHubZoneDistributionEntry) =>
    entry.value !== undefined && Number.isFinite(entry.value) && entry.value > 0 ? entry.value : 0;
  const total = sorted.reduce((sum, entry) => sum + value(entry), 0);
  const ratioTotal = sorted.reduce(
    (sum, entry) => sum + (entry.ratio !== undefined && Number.isFinite(entry.ratio) ? entry.ratio : 0),
    0
  );
  if (total <= 0 && ratioTotal <= 0) {
    return { total: 0, rows: [] };
  }
  return {
    total,
    rows: sorted.map((entry, position) => ({
      position: Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : position,
      value: value(entry),
      share:
        entry.ratio !== undefined && Number.isFinite(entry.ratio) && ratioTotal > 0
          ? entry.ratio / ratioTotal
          : total > 0
            ? value(entry) / total
            : 0
    }))
  };
}

/**
 * Easy, moderate and hard, as the Running screen cuts them (`intensityForZone`:
 * the first two zones easy, the third moderate, the rest hard, a zone later
 * under Max HR). Shares of the whole, 0–1.
 */
export function intensityShares(
  rows: readonly ZoneShare[],
  family: CorosProfileZoneFamily
): Record<RunIntensity, number> {
  const shares: Record<RunIntensity, number> = { easy: 0, moderate: 0, hard: 0 };
  for (const row of rows) {
    shares[intensityForZone(row.position + 1, family)] += row.share;
  }
  return shares;
}
