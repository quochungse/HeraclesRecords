import type {
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
 * weeks' load by sport, in the load the athlete reads strength in, and COROS's
 * own time and load in each heart-rate zone with the easy / moderate / hard
 * split it adds up to. The zones stay COROS's: its load is a heart-rate
 * figure, and Heracles Training Load has no zone to fall in.
 */

/** The window, and the one COROS's zone area lists cover. */
export const DISTRIBUTION_DAYS = 28;

export interface SportShare {
  category: SportColorCategory;
  /** In the chosen load. */
  load: number;
  /** COROS's figure for the same sessions, for the hover. */
  corosLoad: number;
  share: number;
}

/**
 * Load by sport over the last `days` days, the biggest first; a sport with no
 * load is left out rather than drawn as a sliver. With Heracles chosen a
 * strength session counts its Heracles load, and COROS's sums stand beside.
 */
export function sportLoadShares(
  activities: readonly TrainingHubActivity[],
  now = new Date(),
  days = DISTRIBUTION_DAYS,
  source: StrengthLoadSource = "coros"
): { total: number; corosTotal: number; sports: SportShare[] } {
  const since = now.getTime() - days * 86_400_000;
  const loads = new Map<SportColorCategory, { load: number; corosLoad: number }>();
  for (const activity of activities) {
    const start = activityStartTimeMs(activity) ?? 0;
    const load = activityLoad(activity, source) ?? 0;
    if (start < since || start > now.getTime() || !Number.isFinite(load) || load <= 0) {
      continue;
    }
    const category = sportColorCategory(activity.sportType);
    const sum = loads.get(category) ?? { load: 0, corosLoad: 0 };
    sum.load += load;
    sum.corosLoad += Math.max(0, activity.trainingLoad ?? 0);
    loads.set(category, sum);
  }
  const sums = [...loads.values()];
  const total = sums.reduce((sum, entry) => sum + entry.load, 0);
  const corosTotal = sums.reduce((sum, entry) => sum + entry.corosLoad, 0);
  const sports = SPORT_COLOR_CATEGORIES.filter((category) => (loads.get(category)?.load ?? 0) > 0)
    .map((category) => {
      const { load, corosLoad } = loads.get(category)!;
      return { category, load, corosLoad, share: total > 0 ? load / total : 0 };
    })
    .sort((left, right) => right.load - left.load);
  return { total, corosTotal, sports };
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
