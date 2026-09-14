/**
 * VO2max readings collapsed into the plateaus they actually form.
 *
 * COROS reports vo2max only on days with a run, so the series is sparse and the
 * value between two readings is the earlier one carried forward -- never an
 * interpolation, and never zero. Reading-to-reading deltas are therefore almost
 * always 0 (the figure moves about one point every four to six weeks), which is
 * what makes a plain "change since last reading" stat dead on arrival. Grouping
 * the carried-forward series into runs of equal value gives the one thing a
 * slow metric can say in a small space: how long each level held.
 */

export interface Vo2Reading {
  /** COROS `happenDay`, `yyyyMMdd`. */
  happenDay: string;
  value: number;
}

export interface Vo2Plateau {
  value: number;
  /** First day read at this value. */
  startDay: string;
  /** Last day it held -- the day before the next plateau, or the reference day. */
  endDay: string;
  /** Whole days held, counting both ends. Always at least 1. */
  days: number;
  /** Share of the whole span, 0..1. Shares sum to 1. */
  share: number;
}

export interface Vo2Trend {
  plateaus: Vo2Plateau[];
  first: number;
  latest: number;
  /** latest - first across the whole span. */
  delta: number;
  /** The step that produced the current plateau; absent when there is only one. */
  lastStep?: number;
  /** Days the current level has held. */
  daysAtCurrent: number;
  /** Days from the first reading to the reference day, counting both ends. */
  spanDays: number;
  startDay: string;
  endDay: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Parsed as UTC on purpose: these are calendar labels, not instants, and a
 * local-time parse makes a day count come out one short across a DST boundary.
 */
export function happenDayToUtcMs(happenDay: string): number | null {
  if (!/^\d{8}$/.test(happenDay)) {
    return null;
  }

  const year = Number(happenDay.slice(0, 4));
  const month = Number(happenDay.slice(4, 6));
  const day = Number(happenDay.slice(6, 8));

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const ms = Date.UTC(year, month - 1, day);
  // Date.UTC rolls an impossible date forward (Feb 30 -> Mar 2); reject those
  // rather than silently counting days against a date nobody sent.
  const rolled = new Date(ms);
  if (rolled.getUTCMonth() !== month - 1 || rolled.getUTCDate() !== day) {
    return null;
  }

  return ms;
}

function utcMsToHappenDay(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/** Inclusive day count between two `happenDay` keys. */
function inclusiveDays(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / MS_PER_DAY) + 1;
}

/**
 * @param readings Sparse vo2max readings; order and duplicates are tolerated.
 * @param referenceDay The day the newest plateau is carried forward to, as
 *   `yyyyMMdd`. Clamped up to the last reading, so a skewed clock cannot
 *   produce a negative span.
 */
export function buildVo2Trend(
  readings: Vo2Reading[],
  referenceDay: string
): Vo2Trend | null {
  const points = readings
    .map((reading) => ({
      happenDay: reading.happenDay,
      value: reading.value,
      ms: happenDayToUtcMs(reading.happenDay)
    }))
    .filter(
      (point): point is { happenDay: string; value: number; ms: number } =>
        point.ms !== null && Number.isFinite(point.value) && point.value > 0
    )
    .sort((left, right) => left.ms - right.ms);

  if (points.length === 0) {
    return null;
  }

  const lastMs = points[points.length - 1].ms;
  const referenceMs = happenDayToUtcMs(referenceDay);
  const endMs =
    referenceMs === null || referenceMs < lastMs ? lastMs : referenceMs;

  // Collapse runs of equal value. A reading that repeats the running value
  // extends the plateau rather than starting one.
  const runs: { value: number; startMs: number }[] = [];
  for (const point of points) {
    const current = runs[runs.length - 1];
    if (!current || current.value !== point.value) {
      runs.push({ value: point.value, startMs: point.ms });
    }
  }

  const startMs = runs[0].startMs;
  const spanDays = inclusiveDays(startMs, endMs);

  const plateaus: Vo2Plateau[] = runs.map((run, index) => {
    const next = runs[index + 1];
    // The level holds up to the day before the next reading changed it.
    const runEndMs = next ? next.startMs - MS_PER_DAY : endMs;
    const days = Math.max(1, inclusiveDays(run.startMs, runEndMs));

    return {
      value: run.value,
      startDay: utcMsToHappenDay(run.startMs),
      endDay: utcMsToHappenDay(runEndMs),
      days,
      share: days / spanDays
    };
  });

  const current = plateaus[plateaus.length - 1];
  const previous = plateaus[plateaus.length - 2];

  return {
    plateaus,
    first: plateaus[0].value,
    latest: current.value,
    delta: current.value - plateaus[0].value,
    ...(previous ? { lastStep: current.value - previous.value } : {}),
    daysAtCurrent: current.days,
    spanDays,
    startDay: plateaus[0].startDay,
    endDay: utcMsToHappenDay(endMs)
  };
}

/**
 * Days while a span is short enough to read as days, weeks past that. Keeps the
 * segment captions to three characters at most, which is what lets a narrow
 * plateau still carry one.
 */
export function formatPlateauDuration(days: number): string {
  if (days < 56) {
    return `${days}d`;
  }

  return `${Math.round(days / 7)}w`;
}

/**
 * `yyyyMMdd` as `dd/MM/yy`. Sliced rather than run through `Intl`, which would
 * answer `08/13/26` under an en-US locale -- the tooltip pairs two of these
 * with a dash between them, and a reader cannot tell which half moved if the
 * order is not fixed.
 */
export function formatHappenDayNumeric(happenDay: string): string {
  if (!/^\d{8}$/.test(happenDay)) {
    return happenDay;
  }

  return `${happenDay.slice(6, 8)}/${happenDay.slice(4, 6)}/${happenDay.slice(2, 4)}`;
}

/** How long the whole bar covers, for the caption above it. */
export function formatTrendSpan(spanDays: number): string {
  if (spanDays < 60) {
    return `${spanDays} days`;
  }

  const months = Math.round(spanDays / 30.44);
  if (months < 24) {
    return `${months} months`;
  }

  return `${Math.round(spanDays / 365.25)} years`;
}
