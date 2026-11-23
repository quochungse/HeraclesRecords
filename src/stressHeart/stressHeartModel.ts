import {
  STRESS_LEVELS,
  dayDate,
  daysBetween,
  measuredMinutes,
  shiftDay,
  type StressLevelKey
} from "../../electron/stressHeartParser";
import { napWindowsOf } from "../../electron/sleepMetrics";
import { SLEEP_SCREEN_TREND_DAYS } from "../training/chartConfig";
import { sleepWindowDays } from "../../electron/sleepSeriesParser";
import type {
  StressDaySeries,
  StressHeartDay,
  TrainingHubActivity,
  TrainingHubSleepRecord
} from "../../electron/types";

/**
 * Stress level and Heart rate's arithmetic, kept out of the components.
 *
 * **Today has no averages.** A day still being lived states its resting heart
 * rate (set by the night), its range so far and the time in each level so far,
 * but no average stress or average heart rate: at nine in the morning those
 * are the night's, and read as the day's they mislead. Every average here
 * leaves today out.
 */

/**
 * The days Stress level and Heart rate list: the Sleep screen's month, so the
 * Health screens list the same days. It is also the run of five-minute readings
 * Stress level loads, so that picking a day asks for nothing.
 */
export const DAY_LIST_DAYS = SLEEP_SCREEN_TREND_DAYS;
export const MINUTES_PER_SLOT = 5;

/** The listed days, newest first, ending today. */
export function listedDays(today: string): string[] {
  return daysBetween(shiftDay(today, -(DAY_LIST_DAYS - 1)), today).reverse();
}

export function average(values: ReadonlyArray<number | undefined>): number | undefined {
  const known = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : undefined;
}

/** "HH:MM" for a minute of the day. */
export function clockOf(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function minutesOfClock(clock: string | undefined): number | undefined {
  const match = clock?.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

// --- A day's readings ---------------------------------------------------------

export function readingCount(series: StressDaySeries | undefined): number {
  return series ? series.slots.filter((slot) => slot !== null).length : 0;
}

/** The slot of the last reading, or -1. */
export function lastReadingSlot(series: StressDaySeries | undefined): number {
  if (!series) return -1;
  for (let index = series.slots.length - 1; index >= 0; index -= 1) {
    if (series.slots[index] !== null) return index;
  }
  return -1;
}

// --- What else happened that day: sleep and sessions -------------------------

export interface LanePiece {
  kind: "sleep" | "nap";
  /** Minutes of the day, `[from, to)`. */
  from: number;
  to: number;
  /** The window's own clocks, for the hover. */
  start: string;
  end: string;
}

/**
 * The sleep on a calendar day: the night that ended that morning, the night
 * that began that evening, and the day's naps. COROS files a night under the
 * day it ended, so a night that began before midnight reaches into the day
 * before its key.
 */
export function sleepOnDay(day: string, records: readonly TrainingHubSleepRecord[]): LanePiece[] {
  const pieces: LanePiece[] = [];

  for (const record of records) {
    if (record.sleepStart && record.sleepEnd && record.kind !== "nap") {
      const days = sleepWindowDays(record);
      const from = minutesOfClock(record.sleepStart);
      const to = minutesOfClock(record.sleepEnd);
      if (days && from !== undefined && to !== undefined) {
        const piece = { kind: "sleep" as const, start: record.sleepStart, end: record.sleepEnd };
        if (days.startDay === day && days.endDay === day) pieces.push({ ...piece, from, to });
        else if (days.endDay === day) pieces.push({ ...piece, from: 0, to });
        else if (days.startDay === day) pieces.push({ ...piece, from, to: 24 * 60 });
      }
    }

    for (const nap of napWindowsOf(record)) {
      const napDay = nap.startDay ?? nap.endDay ?? record.happenDay;
      const from = minutesOfClock(nap.start);
      const to = minutesOfClock(nap.end);
      if (napDay === day && from !== undefined && to !== undefined && to > from && nap.start && nap.end) {
        pieces.push({ kind: "nap", from, to, start: nap.start, end: nap.end });
      }
    }
  }

  // One window can arrive twice (a day's record and its folded nap record).
  const seen = new Set<string>();
  return pieces
    .filter((piece) => piece.to > piece.from)
    .filter((piece) => {
      const key = `${piece.kind}:${piece.from}:${piece.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.from - right.from);
}

export interface LaneSession {
  from: number;
  to: number;
  activity: TrainingHubActivity;
}

function epochMs(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

/** The sessions that ran on a calendar day, clipped to it. */
export function sessionsOnDay(day: string, activities: readonly TrainingHubActivity[]): LaneSession[] {
  const midnight = dayDate(day).getTime();
  const nextMidnight = dayDate(shiftDay(day, 1)).getTime();
  const out: LaneSession[] = [];

  for (const activity of activities) {
    if (activity.startTime === undefined) continue;
    const start = epochMs(activity.startTime);
    const end =
      activity.endTime !== undefined
        ? epochMs(activity.endTime)
        : start + (activity.elapsedDuration ?? activity.duration ?? 0) * 1000;
    if (end <= midnight || start >= nextMidnight) continue;
    const from = Math.max(0, (start - midnight) / 60_000);
    const to = Math.min(24 * 60, (Math.max(end, start + 60_000) - midnight) / 60_000);
    out.push({ from, to, activity });
  }

  return out.sort((left, right) => left.from - right.from);
}

// --- Trends -------------------------------------------------------------------

export type TrendPeriod = 28 | 90 | null;
export const TREND_PERIODS: readonly TrendPeriod[] = [28, 90, null];

/**
 * The calendar days a period covers, ending today: every day, whether COROS
 * had a figure for it or not, so a gap is a gap on the axis. "All" starts at
 * the first day on file.
 */
export function periodDays(
  days: readonly StressHeartDay[],
  period: TrendPeriod,
  today: string
): string[] {
  const first = days[0]?.day;
  if (!first) return [];
  const from = period === null ? first : shiftDay(today, -(period - 1));
  return daysBetween(from < first ? first : from, today);
}

/** The same length just before, for "against the period before". */
export function previousPeriodDays(days: readonly StressHeartDay[], period: TrendPeriod, today: string): string[] {
  const first = days[0]?.day;
  if (period === null || !first) return [];
  const to = shiftDay(today, -period);
  const from = shiftDay(to, -(period - 1));
  if (to < first) return [];
  return daysBetween(from < first ? first : from, to);
}

export interface StressTrendRow {
  day: string;
  relaxed?: number;
  low?: number;
  medium?: number;
  high?: number;
  /** Absent on today (see the header). */
  average?: number;
}

/** Hours in each level a day, and the day's average. */
export function stressTrendRows(
  byDay: ReadonlyMap<string, StressHeartDay>,
  window: readonly string[],
  today: string
): StressTrendRow[] {
  return window.map((day) => {
    const record = byDay.get(day);
    const hours = (minutes: number | undefined) => (minutes !== undefined ? minutes / 60 : undefined);
    return {
      day,
      relaxed: hours(record?.levels?.relaxed),
      low: hours(record?.levels?.low),
      medium: hours(record?.levels?.medium),
      high: hours(record?.levels?.high),
      average: day === today ? undefined : record?.stressAvg
    };
  });
}

/**
 * A day's lowest and highest heart rate, as COROS sends them
 * (`queryAvgHeartRate`). Its maximum can sit under the night's own (2026-11-23:
 * 48–73 against a night of 48–85); it is shown as sent, pending review.
 */
export function dayHeartRange(record: StressHeartDay | undefined): [number, number] | undefined {
  return record?.minHr !== undefined && record.maxHr !== undefined ? [record.minHr, record.maxHr] : undefined;
}

/**
 * The bpm scale a day's ladder and every list row's strip are drawn on — one
 * scale, so a row's strip is the ladder in small and two days compare where
 * they stand. Wide enough for a night's lowest and a session's highest.
 */
export const HEART_DAY_SCALE = { low: 30, high: 210, ticks: [30, 60, 90, 120, 150, 180, 210] } as const;

/** Where a heart rate sits on `HEART_DAY_SCALE`, as a share of its width (clamped). */
export function heartScaleAt(bpm: number): string {
  const share = (bpm - HEART_DAY_SCALE.low) / (HEART_DAY_SCALE.high - HEART_DAY_SCALE.low);
  return `${Math.min(100, Math.max(0, share * 100))}%`;
}

export interface HeartTrendRow {
  day: string;
  /** Lowest to highest; today's is so far. */
  range?: [number, number];
  average?: number;
  resting?: number;
}

export function heartTrendRows(
  byDay: ReadonlyMap<string, StressHeartDay>,
  window: readonly string[],
  today: string
): HeartTrendRow[] {
  return window.map((day) => {
    const record = byDay.get(day);
    return {
      day,
      range: dayHeartRange(record),
      average: day === today ? undefined : record?.avgHr,
      resting: record?.restingHr
    };
  });
}

function settledRecords(
  byDay: ReadonlyMap<string, StressHeartDay>,
  window: readonly string[],
  today: string
): StressHeartDay[] {
  return window.filter((day) => day !== today).flatMap((day) => {
    const record = byDay.get(day);
    return record ? [record] : [];
  });
}

export interface StressFigures {
  average?: number;
  previousAverage?: number;
  /** Minutes at 76 and above, a day. */
  highPerDay?: number;
  /** Relaxed share of measured time, 0–100. */
  relaxedShare?: number;
}

export function stressFigures(
  byDay: ReadonlyMap<string, StressHeartDay>,
  window: readonly string[],
  previous: readonly string[],
  today: string
): StressFigures {
  const records = settledRecords(byDay, window, today);
  const measured = records.filter((record) => measuredMinutes(record.levels) > 0);
  const totalMeasured = measured.reduce((sum, record) => sum + measuredMinutes(record.levels), 0);
  return {
    average: average(records.map((record) => record.stressAvg)),
    previousAverage: average(settledRecords(byDay, previous, today).map((record) => record.stressAvg)),
    highPerDay: average(measured.map((record) => record.levels?.high)),
    relaxedShare:
      totalMeasured > 0
        ? (measured.reduce((sum, record) => sum + (record.levels?.relaxed ?? 0), 0) / totalMeasured) * 100
        : undefined
  };
}

export interface HeartFigures {
  resting?: number;
  previousResting?: number;
  average?: number;
  lowest?: { bpm: number; day: string };
}

export function heartFigures(
  byDay: ReadonlyMap<string, StressHeartDay>,
  window: readonly string[],
  previous: readonly string[],
  today: string
): HeartFigures {
  const records = settledRecords(byDay, window, today);
  // A lowest is not an average, so the lowest of the period may well be today's.
  const lowest = window.reduce<{ bpm: number; day: string } | undefined>((best, day) => {
    const range = dayHeartRange(byDay.get(day));
    return range && (best === undefined || range[0] < best.bpm) ? { bpm: range[0], day } : best;
  }, undefined);
  return {
    resting: average(records.map((record) => record.restingHr)),
    previousResting: average(settledRecords(byDay, previous, today).map((record) => record.restingHr)),
    average: average(records.map((record) => record.avgHr)),
    lowest
  };
}

/** Resting heart rate against the seven days before `day`. */
export function restingAgainstWeek(byDay: ReadonlyMap<string, StressHeartDay>, day: string): number | undefined {
  const resting = byDay.get(day)?.restingHr;
  const before = average(daysBetween(shiftDay(day, -7), shiftDay(day, -1)).map((key) => byDay.get(key)?.restingHr));
  return resting !== undefined && before !== undefined ? Math.round(resting - before) : undefined;
}

/** The highest reading of a day, and its slot; for today, so far. */
export function peakReading(series: StressDaySeries | undefined): { value: number; slot: number } | undefined {
  let peak: { value: number; slot: number } | undefined;
  series?.slots.forEach((value, slot) => {
    if (value !== null && (peak === undefined || value > peak.value)) peak = { value, slot };
  });
  return peak;
}

// --- Heart rate asleep ----------------------------------------------------------

/**
 * Each day's night, keyed by the day it ended (COROS's own key), for the ones
 * that carry a heart rate. A day of naps only is no night here: its heart rate
 * is one nap's.
 */
export function sleepHeartByDay(records: readonly TrainingHubSleepRecord[]): Map<string, TrainingHubSleepRecord> {
  const out = new Map<string, TrainingHubSleepRecord>();
  for (const record of records) {
    if (record.kind === "nap" || record.kind === "nap-only" || record.avgHr === undefined) continue;
    out.set(record.happenDay, record);
  }
  return out;
}

export { STRESS_LEVELS, dayDate, daysBetween, measuredMinutes, shiftDay };
export type { StressLevelKey };
