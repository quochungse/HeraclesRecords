/**
 * Calendar days as the chat tools write them: `yyyyMMdd` keys in machine-local
 * time, the way COROS files a day and the way the athlete lived it.
 *
 * Shared because the activity, trend and sleep tools each grew their own copy
 * of these, and a day labelled one way in the trend table and another in the
 * sleep table is a disagreement the coach has no way to notice.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

/** `yyyyMMdd` for the local day a date falls on. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}${padTwo(date.getMonth() + 1)}${padTwo(date.getDate())}`;
}

/** `yyyyMMdd` for the local day `offset` days before `today` (negative: after). */
export function dayKeyDaysAgo(today: Date, offset: number): string {
  const date = new Date(today);
  date.setDate(date.getDate() - offset);
  return dayKey(date);
}

/** Local midnight of a `yyyyMMdd` key. */
export function dateFromDayKey(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
}

/** "09-07 Sun": the year is in the heading, the weekday is what a coach reads. */
export function dayLabel(day: string): string {
  return `${day.slice(4, 6)}-${day.slice(6, 8)} ${WEEKDAYS[dateFromDayKey(day).getDay()]}`;
}

/** `yyyy-MM-dd` for a `yyyyMMdd` key. */
export function isoFromDayKey(day: string): string {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

/**
 * `yyyy-MM-dd` for the local day a date falls on — never `toISOString()`,
 * which dates a 06:00 run in UTC+7 by the UTC day before.
 */
export function isoDay(date: Date): string {
  return isoFromDayKey(dayKey(date));
}
