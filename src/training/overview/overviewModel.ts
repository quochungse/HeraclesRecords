import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
} from "../../../electron/types";
import { happenDayToUtcMs } from "../vo2Trend";

export const OVERVIEW_DAYS = 30;
export const OVERVIEW_WEEKS = 5;
const DAY = 86_400_000;

/** Calendar-day window, including today; future activities never enter totals. */
export function overviewActivities<T extends TrainingHubActivity>(
  activities: readonly T[],
  now = new Date(),
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - OVERVIEW_DAYS + 1);
  return activities.filter((activity) => {
    const at = (activity.startTime ?? NaN) * 1000;
    return at >= start.getTime() && at <= now.getTime();
  });
}

/** COROS readings as received; missing dates and fields remain gaps. */
export function overviewStatusTrend(
  metrics: readonly TrainingHubDailyMetric[],
  today: string,
) {
  const end = happenDayToUtcMs(today);
  if (end === null) return [];
  const byDay = new Map(metrics.map((day) => [day.happenDay, day]));
  const finite = (value?: number) =>
    value !== undefined && Number.isFinite(value) ? value : undefined;
  return Array.from({ length: 28 }, (_, i) => {
    const day = new Date(end - (27 - i) * DAY)
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "");
    const metric = byDay.get(day);
    return {
      day,
      baseFitness: finite(metric?.cti),
      loadImpact: finite(metric?.ati),
    };
  });
}
