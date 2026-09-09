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
