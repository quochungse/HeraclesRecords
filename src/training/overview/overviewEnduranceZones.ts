import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubThresholdZone,
} from "../../../electron/types";

// Only known, sustained endurance disciplines. Unknown/custom sports, lifting,
// ball sports, downhill skiing and climbing do not enter an HR load distribution.
const ENDURANCE_SPORTS = new Set([
  100, 101, 102, 103, 104, 105, 200, 201, 202, 203, 204, 205, 299, 300, 301,
  502, 503, 700, 701, 704, 900, 902, 903, 10000, 10002,
]);

export function overviewEnduranceActivities(
  activities: readonly TrainingHubActivity[],
  now = new Date(),
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 27);
  return activities.filter(
    (a) =>
      ENDURANCE_SPORTS.has(a.sportType ?? -1) &&
      (a.startTime ?? NaN) * 1000 >= +start &&
      (a.startTime ?? NaN) * 1000 <= +now,
  );
}

/** A filtered distribution cannot use COROS's aggregate across all sports. */
export function overviewEnduranceZones(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  zones: readonly TrainingHubThresholdZone[],
  metric: "time" | "trainingLoad",
) {
  const totals = zones.map(() => 0);
  // The final zone is open-ended. Earlier ceilings must all be usable.
  const canEstimate = zones.slice(0, -1).every((zone, index) =>
    zone.hr !== undefined && Number.isFinite(zone.hr) && zone.hr > 0 &&
    (index === 0 || zone.hr > zones[index - 1].hr!),
  );
  let measured = 0,
    estimated = 0,
    unplaced = 0;
  for (const a of activities) {
    if (!ENDURANCE_SPORTS.has(a.sportType ?? -1)) continue;
    if (!zones.length) {
      unplaced++;
      continue;
    }
    const seconds = summaries.get(a.activityId)?.zoneSeconds;
    const scored = seconds?.reduce((sum, v) => sum + v, 0) ?? 0;
    const duration = a.duration !== undefined && Number.isFinite(a.duration) && a.duration > 0
      ? a.duration
      : undefined;
    const hasSplit =
      seconds?.length === zones.length &&
      seconds.every((v) => Number.isFinite(v) && v >= 0) &&
      scored > 0 &&
      (duration === undefined || scored >= duration * 0.5);
    const value = metric === "time"
      ? hasSplit ? scored : a.duration
      : a.trainingLoad;
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      unplaced++;
      continue;
    }
    if (value === 0) continue;
    if (hasSplit && seconds) {
      seconds.forEach((s, i) => {
        totals[i] += metric === "time" ? s : (value * s) / scored;
      });
      measured++;
    } else if (
      a.avgHr !== undefined &&
      Number.isFinite(a.avgHr) &&
      a.avgHr > 0 &&
      canEstimate
    ) {
      const index = zones.findIndex(
        (z) => z.hr !== undefined && a.avgHr! <= z.hr,
      );
      totals[index < 0 ? zones.length - 1 : index] += value;
      estimated++;
    } else {
      unplaced++;
    }
  }
  const total = totals.reduce((sum, v) => sum + v, 0);
  return {
    entries: totals.map((value, index) => ({
      index,
      value,
      percent: total > 0 ? (value / total) * 100 : 0,
    })),
    total,
    measured,
    estimated,
    unplaced,
  };
}
