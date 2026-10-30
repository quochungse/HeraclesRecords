/**
 * COROS's fitness figures with strength read in Heracles Training Load
 * (docs/heracles-training-load.md). COROS makes them from its daily load
 * (probed 2026-10-28 on a real account):
 *
 *   Load Impact  ati += (load − ati) / 7
 *   Base Fitness cti += (load − cti) / 42
 *   Intensity Trend = ati / cti
 *   recommended week = Base Fitness on the Sunday before × 7, and that × 1.3
 *
 * All of it is linear in the daily load, so the Heracles figures are COROS's
 * own plus the same arithmetic run on what Heracles adds each day — nothing of
 * COROS's history has to be rebuilt, and on a day with no strength session
 * before it the two are equal. Node-free: the renderer applies the deltas.
 */
import type { HeraclesDayDelta, StrengthLoadSource, TrainingHubDailyMetric } from "./types";

/** One day's strength sessions, as the series is built from. */
export interface HeraclesDaySurplus {
  /** Heracles TL over COROS's. */
  surplus: number;
  /** Sessions whose sets are not read yet. */
  pending: number;
}

const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 42;
const RANGE_DAYS = 7;
const RANGE_STRETCH = 1.3;
/** Where the 42-day average has kept 95% of what it will: a session older reaches it at most 5%. */
const PARTIAL_WINDOW_DAYS = 126;

function dayDate(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
}

function dayString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function nextDay(day: string): string {
  const date = dayDate(day);
  date.setDate(date.getDate() + 1);
  return dayString(date);
}

/**
 * The additions for every day from the first strength session to `lastDay`,
 * by `yyyyMMdd`. A day before the first session adds nothing and is absent.
 */
export function heraclesDeltaSeries(
  surplusByDay: ReadonlyMap<string, HeraclesDaySurplus>,
  lastDay: string
): Map<string, HeraclesDayDelta> {
  const series = new Map<string, HeraclesDayDelta>();
  const first = [...surplusByDay.keys()].sort()[0];
  if (!first || first > lastDay) return series;
  let ati = 0;
  let cti = 0;
  // Base Fitness's addition on the Sunday before, for the week's range.
  let sundayCti = 0;
  let range = 0;
  const pendingDays: string[] = [];
  for (let day = first; day <= lastDay; day = nextDay(day)) {
    const date = dayDate(day);
    if (date.getDay() === 1) range = sundayCti * RANGE_DAYS;
    const today = surplusByDay.get(day);
    const surplus = today?.surplus ?? 0;
    ati += (surplus - ati) / ACUTE_DAYS;
    cti += (surplus - cti) / CHRONIC_DAYS;
    if (today?.pending) pendingDays.push(day);
    const windowStart = new Date(date);
    windowStart.setDate(windowStart.getDate() - (PARTIAL_WINDOW_DAYS - 1));
    const since = dayString(windowStart);
    while (pendingDays.length && pendingDays[0]! < since) pendingDays.shift();
    series.set(day, { load: surplus, ati, cti, range, ...(pendingDays.length ? { partial: true } : {}) });
    if (date.getDay() === 0) sundayCti = cti;
  }
  return series;
}

/** COROS's own figures, kept beside the Heracles ones for the hover. */
export interface CorosFitness {
  ati?: number;
  cti?: number;
  trainingLoadRatio?: number;
  recommendedLoadMin?: number;
  recommendedLoadMax?: number;
}

export type FitnessDay = TrainingHubDailyMetric & { coros?: CorosFitness };

function plus(value: number | undefined, delta: number): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value + delta : undefined;
}

/**
 * The day list in the load the athlete reads strength in: with Heracles chosen,
 * Load Impact, Base Fitness, Intensity Trend and the week's recommended range
 * read on Heracles Training Load, COROS's figures kept in `coros`. The day's
 * own `trainingLoad` is left alone unless `withLoad` — the screens add their
 * sessions' Heracles loads themselves. The list as given while COROS is chosen.
 */
export function fitnessInLoadSource<T extends TrainingHubDailyMetric>(
  days: readonly T[],
  source: StrengthLoadSource,
  { withLoad = false }: { withLoad?: boolean } = {}
): (T & { coros?: CorosFitness })[] {
  if (source !== "heracles") return days as T[];
  return days.map((day) => {
    const delta = day.heracles;
    if (!delta) return day;
    const ati = plus(day.ati, delta.ati);
    const cti = plus(day.cti, delta.cti);
    const min = plus(day.recommendedLoadMin, delta.range);
    const max = plus(day.recommendedLoadMax, delta.range * RANGE_STRETCH);
    return {
      ...day,
      ...(withLoad && day.trainingLoad !== undefined ? { trainingLoad: day.trainingLoad + delta.load } : {}),
      ...(ati !== undefined ? { ati } : {}),
      ...(cti !== undefined ? { cti } : {}),
      ...(ati !== undefined && cti !== undefined && cti > 0 ? { trainingLoadRatio: ati / cti } : {}),
      ...(min !== undefined ? { recommendedLoadMin: min } : {}),
      ...(max !== undefined ? { recommendedLoadMax: max } : {}),
      coros: {
        ati: day.ati,
        cti: day.cti,
        trainingLoadRatio: day.trainingLoadRatio,
        recommendedLoadMin: day.recommendedLoadMin,
        recommendedLoadMax: day.recommendedLoadMax
      }
    };
  });
}

/** A week's recommended range (`recomendTlMin`/`Max`, COROS's spelling) in the chosen load. */
export function weekRangeInLoadSource(
  week: Record<string, unknown> | undefined,
  source: StrengthLoadSource
): { min?: number; max?: number; corosMin?: number; corosMax?: number } {
  const corosMin = Number(week?.recomendTlMin);
  const corosMax = Number(week?.recomendTlMax);
  const min = Number.isFinite(corosMin) ? corosMin : undefined;
  const max = Number.isFinite(corosMax) ? corosMax : undefined;
  const range = Number(week?.heraclesRange);
  if (source !== "heracles" || !Number.isFinite(range) || range === 0) return { min, max, corosMin: min, corosMax: max };
  return {
    min: min !== undefined ? min + range : undefined,
    max: max !== undefined ? max + range * RANGE_STRETCH : undefined,
    corosMin: min,
    corosMax: max
  };
}
