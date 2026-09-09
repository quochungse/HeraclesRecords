import type {
  TrainingHubSleepRecord,
  TrainingHubSleepSummary
} from "../../electron/types";
import { getLocalHappenDayKey } from "./formatters";

/**
 * The sleep summary's `latest` is the newest record COROS returned, which is
 * not the same claim as "last night". A watch that has not synced since Sunday
 * still answers, and the panel used to hang Sunday's score under a heading the
 * athlete reads as this morning's — the one reading of a sleep card nobody can
 * check against anything else.
 *
 * **COROS stamps a night with the morning it ended**, not the evening it began.
 * Verified against this account on 2026-09-09: the record dated Sep 8 was the
 * night of the 7th into the morning of the 8th. So last night is today's key
 * and nothing else — yesterday's key is the night before last, which is exactly
 * the stale reading this whole check exists to keep off the panel. The service
 * already assumes as much where it asks COROS for today's date to fetch last
 * night's sleep (`addExactSleepDateArgs`), so the two now agree.
 */
export function isLastNightHappenDay(happenDay: string, now = new Date()): boolean {
  if (!/^\d{8}$/.test(happenDay)) {
    return false;
  }

  return happenDay === getLocalHappenDayKey(now);
}

export interface LastNightSleepOptions {
  now?: Date;
  /** Greeting copy states totals as fact, so a half-synced night must not feed it. */
  excludePartial?: boolean;
}

/**
 * The main sleep that covers last night, or nothing. Naps are never it.
 *
 * `latest` is preferred when it qualifies — the main process already sorted the
 * newest day's records by completeness to build it — and `records` is only
 * scanned when it does not, newest day first.
 */
export function pickLastNightSleep(
  sleep: TrainingHubSleepSummary | null | undefined,
  options: LastNightSleepOptions = {}
): TrainingHubSleepRecord | undefined {
  if (!sleep) {
    return undefined;
  }

  const now = options.now ?? new Date();
  const qualifies = (record: TrainingHubSleepRecord): boolean =>
    record.kind !== "nap" &&
    (!options.excludePartial || record.completeness !== "partial") &&
    isLastNightHappenDay(record.happenDay, now);

  if (sleep.latest && qualifies(sleep.latest)) {
    return sleep.latest;
  }

  return (sleep.records ?? [])
    .filter(qualifies)
    .sort((left, right) => right.happenDay.localeCompare(left.happenDay))[0];
}
