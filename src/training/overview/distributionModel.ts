import type {
  CorosProfileZoneFamily,
  TrainingHubActivity,
  TrainingHubZoneDistributionEntry
} from "../../../electron/types";
import { intensityForZone, type RunIntensity } from "../../running/runMetrics";
import { sportColorCategory, SPORT_COLOR_CATEGORIES, type SportColorCategory } from "../sportColors";

/*
 * The arithmetic behind Overview's Training load distribution: the last four
 * weeks' load by sport, and COROS's own time and load in each heart-rate zone
 * with the easy / moderate / hard split it adds up to.
 */

/** The window, and the one COROS's zone area lists cover. */
export const DISTRIBUTION_DAYS = 28;

export interface SportShare {
  category: SportColorCategory;
  load: number;
  share: number;
}

/**
 * Load by sport over the last `days` days, the biggest first; a sport with no
 * load is left out rather than drawn as a sliver.
 */
export function sportLoadShares(
  activities: readonly TrainingHubActivity[],
  now = new Date(),
  days = DISTRIBUTION_DAYS
): { total: number; sports: SportShare[] } {
  const since = now.getTime() / 1000 - days * 86_400;
  const loads = new Map<SportColorCategory, number>();
  for (const activity of activities) {
    const start = activity.startTime ?? 0;
    const seconds = start > 10_000_000_000 ? start / 1000 : start;
    const load = activity.trainingLoad ?? 0;
    if (seconds < since || seconds > now.getTime() / 1000 || !Number.isFinite(load) || load <= 0) {
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

export interface ZoneShare {
  /** 0 is the easiest zone. */
  position: number;
  value: number;
  share: number;
}

/**
 * COROS's zone area list, one row a zone, easiest first. COROS numbers the
 * buckets from zero, as it numbers the zones, so the nth bucket is the nth
 * zone. Its own ratio stands where it sent one; otherwise the value's share.
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
      position,
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
