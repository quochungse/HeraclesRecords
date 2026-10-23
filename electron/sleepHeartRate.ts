import type { TrainingHubSleepRecord } from "./types";
import { isNapOnlyRecord, isSleepDayRecord, totalSleepMinutes } from "./sleepMetrics";
import { dateFromDayKey, dayKeyDaysAgo } from "./chatDayKeys";

/**
 * The heart rate a night was slept at, which is what Coach reads for recovery
 * in place of COROS's resting HR.
 *
 * COROS's `rhr` is the whole day's: it moves with whatever the day held (a
 * coffee, a hot afternoon, a nap on the sofa) and is still moving while the
 * day lasts, so it missed a night slept at 78 bpm (read 53) and raised a day
 * whose night was ordinary (read 60). Measured over 81 nights, 2026-07-27 to
 * 2026-10-23. The night's average and lowest come from the daily-health feed,
 * folded onto the main sleep only (`withDailyHealth`): on a day of naps alone
 * that line is one nap's, which says nothing about a night.
 *
 * Node-free, like `sleepMetrics.ts`, so the trend tool, the snapshot and the
 * threshold metric read one definition.
 */

/** How many nights a night is compared against: four whole weeks. */
export const SLEEP_HR_BASELINE_NIGHTS = 28;

/** Fewer nights than this and there is no baseline to state. */
export const SLEEP_HR_BASELINE_MIN_NIGHTS = 7;

/** A night this far over its baseline is counted as raised. */
export const SLEEP_HR_RAISED_BPM = 5;

export interface NightHeartRate {
  avg: number;
  min?: number;
}

/** What a night says about recovery, keyed by the morning it ended. */
export interface SleepNight {
  heartRate?: NightHeartRate;
  /** The whole day's sleep, naps included. */
  minutes?: number;
}

function reading(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Settled day records by wake day. A night still arriving (`partial`) is left
 * out: its minutes are short and its heart rate is not yet the night's.
 */
export function sleepNightsByDay(records: TrainingHubSleepRecord[]): Map<string, SleepNight> {
  const nights = new Map<string, SleepNight>();
  for (const record of records) {
    if (!isSleepDayRecord(record) || record.completeness === "partial") continue;
    const avg = isNapOnlyRecord(record) ? undefined : reading(record.avgHr);
    const minutes = totalSleepMinutes(record);
    if (avg === undefined && minutes === undefined) continue;
    const min = reading(record.minHr);
    nights.set(record.happenDay, {
      ...(avg !== undefined ? { heartRate: min !== undefined ? { avg, min } : { avg } } : {}),
      ...(minutes !== undefined ? { minutes } : {})
    });
  }
  return nights;
}

export function medianOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * The median of the nights' averages over the `nights` wake days ending the
 * day before `firstDay`. A median, not a mean: one feverish night at 78 would
 * otherwise lift the bar for a month.
 */
export function sleepHrBaseline(
  byDay: ReadonlyMap<string, SleepNight>,
  firstDay: string,
  nights = SLEEP_HR_BASELINE_NIGHTS
): number | undefined {
  const start = dateFromDayKey(firstDay);
  const values: number[] = [];
  for (let offset = 1; offset <= nights; offset += 1) {
    const avg = byDay.get(dayKeyDaysAgo(start, offset))?.heartRate?.avg;
    if (avg !== undefined) values.push(avg);
  }
  return values.length >= SLEEP_HR_BASELINE_MIN_NIGHTS ? medianOf(values) : undefined;
}
