import type { TrainingHubActivity } from "../../electron/types";

export const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * COROS sends activity start times as epoch seconds on the list endpoint and
 * as milliseconds on some detail payloads, so the scale has to be sniffed
 * rather than assumed: anything below 10_000_000_000 cannot be a millisecond
 * timestamp inside any plausible date range.
 */
export function activityStartTimeMs(
  activity: TrainingHubActivity
): number | undefined {
  if (!Number.isFinite(activity.startTime) || !activity.startTime) {
    return undefined;
  }

  return activity.startTime < 10_000_000_000
    ? activity.startTime * 1000
    : activity.startTime;
}

/**
 * An activity with no usable start time counts as in-window — dropping it
 * would silently shrink the sample, and a missing timestamp says nothing
 * about when the session happened.
 */
export function isActivityInLastFourWeeks(
  activity: TrainingHubActivity,
  now: number = Date.now()
): boolean {
  const startTime = activityStartTimeMs(activity);

  if (startTime === undefined) {
    return true;
  }

  return now - startTime <= FOUR_WEEKS_MS;
}

/**
 * Monday 00:00 of the week a timestamp falls in, local time.
 *
 * The one definition, shared: `runMetrics` and `strengthAnalytics` had a copy
 * each, character for character, and a third was about to be written for
 * Activities.
 */
export function startOfWeekMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  // getDay() is 0 on Sunday; shift so weeks start on Monday.
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

/**
 * Where a window of `weeks` calendar weeks begins, this week included.
 *
 * Stepped through the local calendar rather than by subtracting
 * `weeks * 7 * 86_400_000`, so a DST change inside the window cannot land the
 * start an hour off a Monday.
 */
export function weekWindowStartMs(weeks: number, nowMs: number): number {
  const cursor = new Date(startOfWeekMs(nowMs));
  cursor.setDate(cursor.getDate() - Math.max(0, weeks - 1) * 7);
  return cursor.getTime();
}
