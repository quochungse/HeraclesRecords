import type { TrainingHubSleepRecord } from "../../electron/types";
import { getLocalHappenDayKey } from "./formatters";
import type { TrainingTrendPoint } from "./types";

/** How many days the Sleep card's column looks back over, the night included. */
export const SLEEP_WEEK_DAYS = 7;

/**
 * The Sleep card's column: four figures over the seven days that end on the
 * night the card shows. Each is an average of the days that have the figure,
 * never of seven — a night the watch was off is a missing night, and counting
 * it as zero would pull the average down for sleep nobody failed to get.
 */
export interface SleepWeekTotals {
  /** Main sleep only: naps are left out, and so is a day with nothing but naps. */
  avgSleepMinutes?: number;
  /** How many nights the sleep average is over. */
  sleepNights: number;
  avgScore?: number;
  scoreNights: number;
  avgRhr?: number;
  rhrDays: number;
  hrvMin?: number;
  hrvMax?: number;
  hrvNights: number;
}

/** `yyyyMMdd` for the `days` days ending on `endKey`, oldest first. */
export function sleepWeekDayKeys(endKey: string, days = SLEEP_WEEK_DAYS): string[] {
  const end = new Date(
    Number(endKey.slice(0, 4)),
    Number(endKey.slice(4, 6)) - 1,
    Number(endKey.slice(6, 8))
  );

  return Array.from({ length: days }, (_value, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (days - 1 - index));
    return getLocalHappenDayKey(date);
  });
}

function positive(value?: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function average(values: number[]): number | undefined {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : undefined;
}

export function buildSleepWeekTotals(
  records: readonly TrainingHubSleepRecord[],
  points: readonly TrainingTrendPoint[],
  endKey: string
): SleepWeekTotals {
  const days = new Set(sleepWeekDayKeys(endKey));

  // One night per day. `totalMinutes` is the main sleep and nothing else; a
  // partial night is still syncing, so its minutes are short of the night.
  const nights = new Map<string, TrainingHubSleepRecord>();
  for (const record of records) {
    if (
      days.has(record.happenDay) &&
      (record.kind ?? "main") === "main" &&
      record.completeness !== "partial"
    ) {
      nights.set(record.happenDay, record);
    }
  }

  const sleepMinutes = [...nights.values()]
    .map((night) => night.totalMinutes)
    .filter(positive);
  const scores = [...nights.values()].map((night) => night.score).filter(positive);

  const inWindow = points.filter((point) => days.has(point.date));
  const rhr = inWindow.map((point) => point.rhr).filter(positive);
  const hrv = inWindow.map((point) => point.avgSleepHrv).filter(positive);

  return {
    avgSleepMinutes: average(sleepMinutes),
    sleepNights: sleepMinutes.length,
    avgScore: average(scores),
    scoreNights: scores.length,
    avgRhr: average(rhr),
    rhrDays: rhr.length,
    hrvMin: hrv.length > 0 ? Math.min(...hrv) : undefined,
    hrvMax: hrv.length > 0 ? Math.max(...hrv) : undefined,
    hrvNights: hrv.length
  };
}
