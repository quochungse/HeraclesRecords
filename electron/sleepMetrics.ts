import type { TrainingHubSleepRecord, TrainingHubSleepWindow } from "./types";

/**
 * The arithmetic a sleep record implies, in one place.
 *
 * COROS reports a day's sleep in two halves — a main sleep with its stages and
 * score, and a `Naps Total` beside it — and until this file existed every
 * surface read only the first. A day whose whole sleep was naps therefore had
 * no total at all, and a night followed by a two-hour nap read as the night
 * alone. `totalSleepMinutes` is the one answer to "how much did they sleep",
 * and `totalMinutes` stays what it has always been: the main sleep, which is
 * what the stage percentages and the efficiency are a share of.
 *
 * Imported by the renderer as well as the main process (like
 * `activityMetrics.ts` and `unitSystem.ts`), so it **must stay free of `node:`
 * imports** — `test:sleep-metrics` asserts that.
 */

function finite(value?: number): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function clockMinutes(value?: string): number | undefined {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function dayKeyToUtcMillis(happenDay?: string): number | undefined {
  if (!happenDay || !/^\d{8}$/.test(happenDay)) {
    return undefined;
  }

  return Date.UTC(
    Number(happenDay.slice(0, 4)),
    Number(happenDay.slice(4, 6)) - 1,
    Number(happenDay.slice(6, 8))
  );
}

/**
 * How long a clock window ran.
 *
 * When COROS dated both ends the length is arithmetic; without the dates it is
 * inference, and the only inference available is that an end at or before its
 * start crossed midnight. That is right for a night and wrong for the cases
 * worth being right about, which is why the dates are carried at all.
 */
export function windowDurationMinutes(
  window: TrainingHubSleepWindow
): number | undefined {
  const start = clockMinutes(window.start);
  const end = clockMinutes(window.end);

  if (start === undefined || end === undefined) {
    return undefined;
  }

  const startDayMs = dayKeyToUtcMillis(window.startDay);
  const endDayMs = dayKeyToUtcMillis(window.endDay);

  if (startDayMs !== undefined && endDayMs !== undefined) {
    const span = Math.round((endDayMs - startDayMs) / 60_000) + end - start;
    if (span >= 0) {
      return span;
    }
  }

  return (end <= start ? end + 24 * 60 : end) - start;
}

/** The main sleep's window, as a length. */
export function sleepWindowDurationMinutes(
  record: Pick<
    TrainingHubSleepRecord,
    "sleepStart" | "sleepEnd" | "sleepStartDay" | "sleepEndDay"
  >
): number | undefined {
  return windowDurationMinutes({
    start: record.sleepStart,
    end: record.sleepEnd,
    startDay: record.sleepStartDay,
    endDay: record.sleepEndDay
  });
}

/** Minutes of main sleep, or nothing when COROS reported none. */
function mainSleepMinutes(
  record: Pick<TrainingHubSleepRecord, "totalMinutes">
): number | undefined {
  return finite(record.totalMinutes);
}

/** Minutes of nap across the whole day, or nothing when COROS said nothing. */
export function napMinutes(
  record: Pick<TrainingHubSleepRecord, "napMinutes">
): number | undefined {
  return finite(record.napMinutes);
}

/**
 * Everything the athlete slept on the day — main sleep plus every nap.
 *
 * Nothing when COROS reported neither half. A reported zero is an answer, not
 * an absence: `Naps Total: 0 min` is how the feed says "no naps", and a day
 * with a main sleep and that line must still total the main sleep.
 */
export function totalSleepMinutes(
  record: Pick<TrainingHubSleepRecord, "totalMinutes" | "napMinutes">
): number | undefined {
  const main = mainSleepMinutes(record);
  const naps = napMinutes(record);

  if (main === undefined && naps === undefined) {
    return undefined;
  }

  return (main ?? 0) + (naps ?? 0);
}

/** True when the day's sleep is naps and nothing else. */
export function isNapOnlyRecord(
  record: Pick<TrainingHubSleepRecord, "kind">
): boolean {
  return record.kind === "nap-only";
}

/**
 * True when the record stands for a day rather than for one nap inside one.
 *
 * Both `main` and `nap-only` are days; a bare `nap` is a component of a day
 * and is folded into it, never listed beside it. This is the filter every
 * list, trend and average wants — `kind !== "nap"` spelled so the intent
 * survives a third kind being added.
 */
export function isSleepDayRecord(
  record: Pick<TrainingHubSleepRecord, "kind">
): boolean {
  return record.kind !== "nap";
}

/**
 * Each nap's window. Falls back to the single `napStart`/`napEnd` pair, which
 * is all a record stored before `napWindows` existed carries.
 */
export function napWindowsOf(
  record: Pick<TrainingHubSleepRecord, "napWindows" | "napStart" | "napEnd">
): TrainingHubSleepWindow[] {
  if (record.napWindows && record.napWindows.length > 0) {
    return record.napWindows;
  }

  if (record.napStart || record.napEnd) {
    return [{ start: record.napStart, end: record.napEnd }];
  }

  return [];
}
