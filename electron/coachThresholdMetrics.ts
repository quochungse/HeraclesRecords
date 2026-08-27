import type { AutomationTrigger } from "./types";

/**
 * The four threshold metrics of 3.3, as pure functions over locally cached
 * rows.
 *
 * **Nothing here reaches the network.** The scheduler evaluates these on its
 * 60-second tick, once per threshold automation, and a metric that fetched
 * would put a request on the tick for every rule the athlete has — on the one
 * path that already learned what an unbounded call costs (section 10). The two
 * series COROS owns rather than the app (resting HR, sleep) are snapshotted
 * into `coach_daily_samples` by the activity watcher, which is already the
 * thing that talks to COROS on a slow cadence.
 *
 * Every metric answers one question — *is the condition true right now* — and
 * nothing about whether to run. Firing on the transition rather than on the
 * answer is the scheduler's job, because the state that decides it belongs to
 * the binding (3.3), not to the metric.
 */

/** 3.3: the acute window, and the trailing window it is compared against. */
export const ACUTE_WINDOW_DAYS = 7;
export const CHRONIC_WINDOW_DAYS = 28;

/** How far back the resting-HR baseline is averaged, and the streak it needs. */
export const RESTING_HR_BASELINE_DAYS = 30;
export const RESTING_HR_STREAK_DAYS = 3;

/** The rolling window the sleep deficit is summed over. */
export const SLEEP_WINDOW_NIGHTS = 7;

/**
 * How far back an unmatched slot still counts against adherence.
 *
 * Not in 3.3, and necessary: without it the metric **latches**. A workout
 * missed in March is unmatched forever, so the condition would be true forever,
 * so it would fire once on the transition and then never again — the rule would
 * quietly retire itself the first time the athlete skipped anything. Ageing old
 * slots out lets the condition fall back to false and re-arm.
 */
export const PLAN_ADHERENCE_LOOKBACK_DAYS = 14;

/** The widest history any metric reads, for the caller filling a snapshot. */
export const THRESHOLD_LOOKBACK_DAYS = Math.max(
  CHRONIC_WINDOW_DAYS,
  RESTING_HR_BASELINE_DAYS + RESTING_HR_STREAK_DAYS,
  SLEEP_WINDOW_NIGHTS
);

/**
 * The nightly sleep a deficit is measured against. 3.3 says "deficit" without
 * saying deficit from what, and a per-athlete target is a setting nobody has
 * been asked for yet — so it is a stated constant rather than a hidden one.
 */
export const SLEEP_TARGET_MINUTES = 8 * 60;

export interface ThresholdActivityLoad {
  /** `training_activities.start_time`, epoch seconds. */
  startTime: number;
  load: number;
}

export interface ThresholdDailySample {
  /** Local day as COROS keys it, "YYYYMMDD". */
  day: string;
  restingHr?: number;
  sleepMinutes?: number;
}

export interface ThresholdPlannedSlot {
  /** The day the workout was scheduled for, "YYYYMMDD". */
  day: string;
  /** True once an activity has been matched to it. */
  matched: boolean;
}

/** Everything the four metrics read, already fetched from local tables. */
export interface ThresholdSnapshot {
  loads: ThresholdActivityLoad[];
  /** Ascending by day; gaps are real and are treated as gaps, not zeroes. */
  daily: ThresholdDailySample[];
  planned: ThresholdPlannedSlot[];
}

const DAY_MS = 86_400_000;

/** "YYYYMMDD" for a local date, the key COROS and the plan tables both use. */
export function toDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

/** Local midnight at the *start* of a "YYYYMMDD" day, or null if malformed. */
export function fromDayKey(day: string): Date | null {
  if (!/^\d{8}$/.test(day)) {
    return null;
  }
  const parsed = new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8))
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The N most recent days ending today, newest last. Calendar steps, not +24h. */
function recentDayKeys(now: Date, count: number, endingDaysAgo = 0): string[] {
  const keys: string[] = [];
  for (let offset = count - 1 + endingDaysAgo; offset >= endingDaysAgo; offset -= 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    keys.push(toDayKey(day));
  }
  return keys;
}

function sumLoadSince(
  loads: ThresholdActivityLoad[],
  fromEpochSeconds: number
): number {
  return loads.reduce(
    (total, entry) =>
      entry.startTime >= fromEpochSeconds ? total + entry.load : total,
    0
  );
}

/**
 * 3.3: the 7-day load exceeds the trailing 28-day average by more than `value`
 * per cent.
 *
 * "Average" is per *week*, not per day: the 28-day total over four, so the two
 * sides of the comparison are the same kind of number. The chronic window
 * includes the acute one, which is the standard acute:chronic shape — a ramp is
 * measured against the block it is part of, not against the block before it.
 *
 * With no chronic load at all there is no ratio to take, and an athlete's first
 * week back is not a ramp, so it does not fire. `> `, not `>=`: 3.3 says
 * "exceeds".
 */
export function isAcuteChronicRamp(
  now: Date,
  loads: ThresholdActivityLoad[],
  percent: number
): boolean {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const acute = sumLoadSince(loads, nowSeconds - ACUTE_WINDOW_DAYS * 86_400);
  const chronicTotal = sumLoadSince(
    loads,
    nowSeconds - CHRONIC_WINDOW_DAYS * 86_400
  );
  const chronicWeekly = chronicTotal / (CHRONIC_WINDOW_DAYS / ACUTE_WINDOW_DAYS);
  if (chronicWeekly <= 0) {
    return false;
  }
  return acute > chronicWeekly * (1 + percent / 100);
}

/**
 * 3.3: resting HR is `value` bpm above the 30-day baseline for 3 consecutive
 * days.
 *
 * The baseline is averaged over the 30 days **ending before** the streak, not
 * the 30 days ending today. Including the elevated days would measure the drift
 * partly against itself, which quietly raises the bar the longer the drift
 * lasts — the opposite of what the rule is for.
 *
 * A day with no reading breaks the streak rather than passing through it: three
 * consecutive days is a claim about three days, and the app cannot make it
 * about a day it has no reading for. `>=`, because a reading exactly `value`
 * above the baseline *is* `value` above it.
 */
export function isRestingHrDrift(
  now: Date,
  daily: ThresholdDailySample[],
  bpm: number
): boolean {
  const byDay = new Map(daily.map((sample) => [sample.day, sample]));
  const readingFor = (day: string): number | undefined => {
    const value = byDay.get(day)?.restingHr;
    // `> 0` for the same reason `isSleepDebt` below wants it: a nought or a
    // negative is not a reading, and this one is averaged into the baseline —
    // so one bad row drags the baseline down and makes an ordinary morning look
    // like three days of drift.
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  };

  const baselineDays = recentDayKeys(
    now,
    RESTING_HR_BASELINE_DAYS,
    RESTING_HR_STREAK_DAYS
  );
  const baselineReadings = baselineDays
    .map(readingFor)
    .filter((value): value is number => value !== undefined);
  if (!baselineReadings.length) {
    return false;
  }
  const baseline =
    baselineReadings.reduce((total, value) => total + value, 0) /
    baselineReadings.length;

  const streakDays = recentDayKeys(now, RESTING_HR_STREAK_DAYS);
  return streakDays.every((day) => {
    const reading = readingFor(day);
    return reading !== undefined && reading >= baseline + bpm;
  });
}

/**
 * 3.3: a scheduled workout has no matching activity `value` hours after its
 * slot.
 *
 * The clock starts at the **end** of the scheduled day. A plan entry carries a
 * day and no time, so measuring from the day's start would call a Tuesday
 * workout missed at lunchtime on Tuesday, while the athlete still has the
 * evening to do it.
 *
 * `>`, not `>=`: 3.3's grace period is a period, and the moment it expires is
 * the last moment inside it.
 */
export function isPlanAdherenceBreach(
  now: Date,
  planned: ThresholdPlannedSlot[],
  hours: number
): boolean {
  const graceMs = hours * 3_600_000;
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - PLAN_ADHERENCE_LOOKBACK_DAYS);
  return planned.some((slot) => {
    if (slot.matched) {
      return false;
    }
    const start = fromDayKey(slot.day);
    if (!start || start.getTime() < oldest.getTime()) {
      return false;
    }
    const dayEnd = start.getTime() + DAY_MS;
    return now.getTime() - dayEnd > graceMs;
  });
}

/**
 * 3.3: the rolling 7-night sleep deficit exceeds `value` hours.
 *
 * A deficit nets out — a long night pays back a short one — because that is
 * what a rolling deficit means, and summing only the shortfalls would make a
 * fortnight of ordinary variation look like chronic loss.
 *
 * Nights with no reading are dropped from **both** sides: the target scales to
 * the nights actually recorded. Counting a missing night against the full
 * target would manufacture eight hours of debt out of a watch left on the
 * charger, which is the single easiest way for this rule to fire on nothing.
 */
export function isSleepDebt(
  now: Date,
  daily: ThresholdDailySample[],
  hours: number
): boolean {
  const byDay = new Map(daily.map((sample) => [sample.day, sample]));
  const nights = recentDayKeys(now, SLEEP_WINDOW_NIGHTS)
    .map((day) => byDay.get(day)?.sleepMinutes)
    .filter(
      (minutes): minutes is number =>
        typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    );
  if (!nights.length) {
    return false;
  }
  const slept = nights.reduce((total, minutes) => total + minutes, 0);
  const deficitMinutes = nights.length * SLEEP_TARGET_MINUTES - slept;
  return deficitMinutes > hours * 60;
}

/** Whether a threshold trigger's condition holds right now. */
export function evaluateThresholdTrigger(
  trigger: Extract<AutomationTrigger, { kind: "threshold" }>,
  now: Date,
  snapshot: ThresholdSnapshot
): boolean {
  switch (trigger.metric) {
    case "acuteChronicRamp":
      return isAcuteChronicRamp(now, snapshot.loads, trigger.value);
    case "restingHrDrift":
      return isRestingHrDrift(now, snapshot.daily, trigger.value);
    case "planAdherence":
      return isPlanAdherenceBreach(now, snapshot.planned, trigger.value);
    case "sleepDebt":
      return isSleepDebt(now, snapshot.daily, trigger.value);
    default:
      return false;
  }
}
