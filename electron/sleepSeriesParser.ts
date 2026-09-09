import type {
  SleepHrvAssessment,
  SleepSeriesPoint,
  TrainingHubSleepRecord
} from "./types";

/**
 * Parsers for the two COROS MCP tools that answer with samples rather than
 * totals — `querySleepHrv` and `queryStressTimeSeries`.
 *
 * Both answer in prose, both stamp every point with COROS's own UTC offset, and
 * both label their day blocks — but not by the same rule. Sleep HRV is filed
 * under the **wake-up day**, the way sleep is. Stress is filed under the
 * **calendar day** it happened on, so a night that began before midnight is
 * split across two blocks and needs both days asked for.
 *
 * Shapes captured live on 2026-09-09:
 *
 *   Sleep HRV Time Series — Last 2 days
 *   ========================
 *
 *   2026-09-08:
 *     timestamp=1788714290, timezone=28, hrv=42 ms, status=4, confidence=96551
 *
 *   Stress Time Series — 2026-09-08
 *   ========================
 *
 *   2026-09-08:
 *     timestamp=1788800690, timezone=28, stress=15, score=1, stressHrv=0, stressHr=0
 */

/** COROS counts its offset in quarter-hours: 28 is UTC+7. */
const TIMEZONE_UNIT_SECONDS = 15 * 60;

function unwrap(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('"')) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : trimmed;
  } catch {
    return trimmed;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The point, with the wall clock the athlete would have seen. The offset is
 * folded into a UTC instant only to read the hours and minutes off it — `at`
 * stays the true instant, so two nights in different timezones still sort.
 */
function toPoint(
  timestampSeconds: number,
  timezoneUnits: number,
  value: number
): SleepSeriesPoint {
  const at = timestampSeconds * 1000;
  const localAt = at + timezoneUnits * TIMEZONE_UNIT_SECONDS * 1000;
  const shifted = new Date(localAt);

  return {
    at,
    localAt,
    clock: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    value
  };
}

function sortByTime(points: SleepSeriesPoint[]): SleepSeriesPoint[] {
  return [...points].sort((left, right) => left.at - right.at);
}

/**
 * Every HRV sample in the response, whatever day block it sat under.
 *
 * The blocks are not filtered by their label on purpose: the label is a
 * wake-up day, the window this night actually spans is known exactly, and
 * clipping to the window is both stricter and truer than trusting the heading.
 * A live block labelled 2026-09-07 ran to 20:39 in the evening — well outside
 * any night — which is the case the clip exists for.
 */
export function parseSleepHrvSeries(response: string): SleepSeriesPoint[] {
  const text = unwrap(response);
  const seriesStart = text.indexOf("Sleep HRV Time Series");
  const body = seriesStart >= 0 ? text.slice(seriesStart) : text;
  const points: SleepSeriesPoint[] = [];

  const pattern =
    /timestamp=(\d+),\s*timezone=(-?\d+),\s*hrv=(-?\d+(?:\.\d+)?)\s*ms/gi;

  for (const match of body.matchAll(pattern)) {
    const value = Number(match[3]);
    // A non-positive reading is COROS saying it could not measure, not a zero.
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    points.push(toPoint(Number(match[1]), Number(match[2]), value));
  }

  return sortByTime(points);
}

export function parseStressSeries(response: string): SleepSeriesPoint[] {
  const text = unwrap(response);
  const points: SleepSeriesPoint[] = [];
  const pattern = /timestamp=(\d+),\s*timezone=(-?\d+),\s*stress=(-?\d+(?:\.\d+)?)/gi;

  for (const match of text.matchAll(pattern)) {
    const value = Number(match[3]);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    points.push(toPoint(Number(match[1]), Number(match[2]), value));
  }

  return sortByTime(points);
}

/**
 * COROS's daily HRV verdict for one wake-up day. Its own tool description says
 * not to recompute the average or the normal range from the raw points, so this
 * reads the assessment section and nothing else.
 */
export function parseSleepHrvAssessment(
  response: string,
  happenDay: string
): SleepHrvAssessment | undefined {
  const text = unwrap(response);
  const assessmentStart = text.indexOf("HRV Assessment");
  if (assessmentStart < 0) {
    return undefined;
  }

  const seriesStart = text.indexOf("Sleep HRV Time Series");
  const body = text.slice(
    assessmentStart,
    seriesStart > assessmentStart ? seriesStart : undefined
  );

  const iso = `${happenDay.slice(0, 4)}-${happenDay.slice(4, 6)}-${happenDay.slice(6, 8)}`;
  const blockStart = body.indexOf(`${iso}:`);
  if (blockStart < 0) {
    return undefined;
  }

  const nextBlock = body.slice(blockStart + iso.length).search(/\n\d{4}-\d{2}-\d{2}:/);
  const block = body.slice(
    blockStart,
    nextBlock >= 0 ? blockStart + iso.length + nextBlock : undefined
  );

  const avg = block.match(/HRV Avg:\s*(\d+(?:\.\d+)?)\s*ms(?:\s*—\s*([^\n]+))?/i);
  const range = block.match(/Normal Range:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*ms/i);
  const baseline = block.match(/Baseline:\s*(\d+(?:\.\d+)?)\s*ms/i);

  if (!avg && !range && !baseline) {
    return undefined;
  }

  return {
    happenDay,
    avg: avg ? Number(avg[1]) : undefined,
    evaluation: avg?.[2]?.trim() || undefined,
    normalLow: range ? Number(range[1]) : undefined,
    normalHigh: range ? Number(range[2]) : undefined,
    baseline: baseline ? Number(baseline[1]) : undefined
  };
}

function dayClockToLocalMillis(happenDay: string, clock: string): number | undefined {
  if (!/^\d{8}$/.test(happenDay)) {
    return undefined;
  }

  const match = clock.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }

  return Date.UTC(
    Number(happenDay.slice(0, 4)),
    Number(happenDay.slice(4, 6)) - 1,
    Number(happenDay.slice(6, 8)),
    Number(match[1]),
    Number(match[2])
  );
}

export interface SleepWindowBounds {
  /** Local instants, expressed as UTC so they compare with a shifted point. */
  startLocal: number;
  endLocal: number;
}

/**
 * The night's two ends as local instants.
 *
 * Prefers the days COROS dated the window with. Without them — an older cached
 * record — the start day is inferred the only way left: a start clock at or
 * after the end clock means the night began the day before the wake-up day.
 */
export function sleepWindowBounds(
  record: Pick<
    TrainingHubSleepRecord,
    "happenDay" | "sleepStart" | "sleepEnd" | "sleepStartDay" | "sleepEndDay"
  >
): SleepWindowBounds | undefined {
  if (!record.sleepStart || !record.sleepEnd) {
    return undefined;
  }

  const endDay = record.sleepEndDay ?? record.happenDay;
  let startDay = record.sleepStartDay;

  if (!startDay) {
    const startMinutes = dayClockToLocalMillis("20000101", record.sleepStart);
    const endMinutes = dayClockToLocalMillis("20000101", record.sleepEnd);
    if (startMinutes === undefined || endMinutes === undefined) {
      return undefined;
    }

    if (startMinutes >= endMinutes) {
      const previous = new Date(dayClockToLocalMillis(endDay, "00:00") ?? 0);
      previous.setUTCDate(previous.getUTCDate() - 1);
      startDay = `${previous.getUTCFullYear()}${pad(previous.getUTCMonth() + 1)}${pad(
        previous.getUTCDate()
      )}`;
    } else {
      startDay = endDay;
    }
  }

  const startLocal = dayClockToLocalMillis(startDay, record.sleepStart);
  const endLocal = dayClockToLocalMillis(endDay, record.sleepEnd);

  if (startLocal === undefined || endLocal === undefined || endLocal <= startLocal) {
    return undefined;
  }

  return { startLocal, endLocal };
}

/**
 * The points that fall inside the night.
 *
 * Both sides are compared as local instants: a point's own offset is folded in
 * so that a window written in watch time and a sample stamped in UTC meet in
 * the same frame. A little slack on each end keeps the reading that landed a
 * minute either side of the boundary, which is the difference between a curve
 * that starts at the pillow and one that starts a sample late.
 */
export function clipToSleepWindow(
  points: SleepSeriesPoint[],
  bounds: SleepWindowBounds,
  slackMinutes = 5
): SleepSeriesPoint[] {
  const slack = slackMinutes * 60 * 1000;

  return points.filter(
    (point) =>
      point.localAt >= bounds.startLocal - slack &&
      point.localAt <= bounds.endLocal + slack
  );
}

export const sleepSeriesInternals = { dayClockToLocalMillis };
