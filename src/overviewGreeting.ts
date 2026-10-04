import type {
  TrainingHubActivity,
  TrainingHubSleepRecord,
  TrainingHubSleepSummary,
  TrainingHubSportType,
  TrainingHubUpcomingWorkout,
  UnitSystem
} from "../electron/types";
import {
  formatDistanceMeters,
  formatUpcomingWorkoutDate,
  getLocalHappenDayKey,
  happenDayFromTimestamp,
  inferUpcomingWorkoutCategory,
  isUpcomingWorkoutScheduled,
  isUpcomingWorkoutToday
} from "./training/formatters";
import { pickLastNightSleep } from "./sleep/sleepFreshness";
import { isNapOnlyRecord, totalSleepMinutes } from "../electron/sleepMetrics";
import { resolveSportName } from "./training/sportTypes";
import { scheduledWorkoutSport } from "./training/workoutSport";
import type { TrainingSummaryMetrics } from "./training/types";
import { formatCount, getIntlLocale, getLocale, t, type MessageKey } from "./i18n/core";

/**
 * The Overview subtitle used to be one frozen sentence. It now reads the
 * signals the dashboard already has — tonight's plan, last night's sleep,
 * recovery, resting HR, what was logged — and says the most useful thing.
 *
 * Everything here is pure so `scripts/test-overview-greeting.mjs` can pin the
 * copy without a renderer.
 */
export interface OverviewGreetingContext {
  trainingConnected: boolean;
  upcomingWorkouts?: TrainingHubUpcomingWorkout[];
  activities?: TrainingHubActivity[];
  sportTypes?: TrainingHubSportType[];
  summary?: TrainingSummaryMetrics | null;
  sleep?: TrainingHubSleepSummary | null;
  unitSystem?: UnitSystem;
  now?: Date;
}

export interface OverviewGreetingLine {
  /** Stable across renders — the rotation and the tests both key off it. */
  id: string;
  text: string;
  /** Higher wins. At or above URGENT_PRIORITY the line skips the rotation. */
  priority: number;
}

/**
 * A line this urgent is always shown: "recovery is low" must never be rotated
 * out in favour of a step count.
 */
export const URGENT_PRIORITY = 80;

/** How many of the remaining lines take turns across the day. */
export const ROTATION_POOL_SIZE = 3;

/**
 * Only lines within this much of the leader take turns with it. Without the
 * band a rest-day plan would lose its slot to a far less useful line, which is
 * variety at the cost of saying anything useful.
 */
export const ROTATION_PRIORITY_BAND = 25;

const MINUTES_PER_HOUR = 60;
const SHORT_SLEEP_MINUTES = 6 * MINUTES_PER_HOUR;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatSleepLength(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = Math.round(minutes % MINUTES_PER_HOUR);

  if (hours <= 0) {
    return t("units.duration.m", { m: remainder });
  }

  return t("units.duration.hm", { h: hours, m: String(remainder).padStart(2, "0") });
}

function dayKeyOffset(now: Date, days: number): string {
  const shifted = new Date(now);
  shifted.setDate(shifted.getDate() + days);
  return getLocalHappenDayKey(shifted);
}

function dayKeyToDate(happenDay: string): Date | null {
  if (!/^\d{8}$/.test(happenDay)) {
    return null;
  }

  return new Date(
    Number(happenDay.slice(0, 4)),
    Number(happenDay.slice(4, 6)) - 1,
    Number(happenDay.slice(6, 8))
  );
}

function daysBetweenDayKeys(from: string, to: string): number | null {
  const start = dayKeyToDate(from);
  const end = dayKeyToDate(to);

  if (!start || !end) {
    return null;
  }

  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/** The most recent full night — naps and part-nights tell us nothing. */
function findLastNight(
  sleep: TrainingHubSleepSummary | null | undefined,
  now: Date
): TrainingHubSleepRecord | undefined {
  return pickLastNightSleep(sleep, { now, excludePartial: true });
}

const TODAY_WORKOUT_COPY: Record<string, MessageKey> = {
  Race: "overview.greeting.today.race",
  Long: "overview.greeting.today.long",
  Easy: "overview.greeting.today.easy",
  Intervals: "overview.greeting.today.intervals",
  Speed: "overview.greeting.today.speed"
};

function todayWorkoutText(workout: TrainingHubUpcomingWorkout): string {
  // Every line in the table above is written about a run, and the classifier
  // that picks one reads the workout's *name*. A strength session called
  // "Full Body - Long" matched the Long rule and was greeted with "Long run on
  // the plan today", so the sport is asked first and a non-run keeps its name.
  const sport = scheduledWorkoutSport(workout.sportType);
  const runFlavoured = !sport || sport === "run" || sport === "trailRun";
  const category = inferUpcomingWorkoutCategory(workout.name ?? "");
  const copy = runFlavoured ? TODAY_WORKOUT_COPY[category] : undefined;

  if (copy) {
    return t(copy);
  }

  const name = workout.name?.trim();
  return name
    ? t("overview.greeting.namedToday", { name })
    : t("overview.greeting.sessionToday");
}

function sleepLines(
  context: OverviewGreetingContext,
  now: Date
): OverviewGreetingLine[] {
  const record = findLastNight(context.sleep, now);

  if (!record) {
    return [];
  }

  const lines: OverviewGreetingLine[] = [];
  const { score } = record;
  // The whole day's sleep, naps included — the line is about how rested the
  // athlete is, and an afternoon spent asleep counts toward that.
  const totalMinutes = totalSleepMinutes(record);

  if (isNapOnlyRecord(record)) {
    // Said as what it is. "Only 4h 38m of sleep last night" would be a claim
    // about a night COROS has no record of at all.
    return totalMinutes !== undefined && totalMinutes > 0
      ? [
          {
            id: "sleep-naps-only",
            priority: 86,
            text: t("overview.greeting.napsOnly", {
              length: formatSleepLength(totalMinutes)
            })
          }
        ]
      : [];
  }

  if (score !== undefined && Number.isFinite(score) && score < 60) {
    lines.push({
      id: "sleep-poor",
      priority: 90,
      text: t("overview.greeting.sleepPoor", { score: Math.round(score) })
    });
  } else if (
    totalMinutes !== undefined &&
    Number.isFinite(totalMinutes) &&
    totalMinutes > 0 &&
    totalMinutes < SHORT_SLEEP_MINUTES
  ) {
    lines.push({
      id: "sleep-short",
      priority: 84,
      text: t("overview.greeting.sleepShort", { length: formatSleepLength(totalMinutes) })
    });
  } else if (score !== undefined && Number.isFinite(score) && score >= 90) {
    lines.push({
      id: "sleep-excellent",
      priority: 62,
      text: t("overview.greeting.sleepExcellent", { score: Math.round(score) })
    });
  } else if (
    totalMinutes !== undefined &&
    Number.isFinite(totalMinutes) &&
    totalMinutes >= SHORT_SLEEP_MINUTES
  ) {
    lines.push({
      id: "sleep-solid",
      priority: 52,
      text: t("overview.greeting.sleepSolid", { length: formatSleepLength(totalMinutes) })
    });
  }

  return lines;
}

function recoveryLines(summary: TrainingSummaryMetrics): OverviewGreetingLine[] {
  const lines: OverviewGreetingLine[] = [];
  const { recoveryPct, rhrDelta } = summary;

  if (recoveryPct !== undefined && Number.isFinite(recoveryPct)) {
    const percent = Math.round(recoveryPct);

    if (percent < 40) {
      lines.push({
        id: "recovery-low",
        priority: 92,
        text: t("overview.greeting.recoveryLow", { percent })
      });
    } else if (percent >= 90) {
      lines.push({
        id: "recovery-peak",
        priority: 72,
        text: t("overview.greeting.recoveryPeak", { percent })
      });
    } else if (percent >= 70) {
      lines.push({
        id: "recovery-ready",
        priority: 66,
        text: t("overview.greeting.recoveryReady", { percent })
      });
    } else {
      lines.push({
        id: "recovery-moderate",
        priority: 58,
        text: t("overview.greeting.recoveryModerate", { percent })
      });
    }
  }

  if (rhrDelta !== undefined && Number.isFinite(rhrDelta)) {
    if (rhrDelta >= 5) {
      lines.push({
        id: "rhr-elevated",
        priority: 86,
        text: t("overview.greeting.rhrElevated", { bpm: Math.round(rhrDelta) })
      });
    } else if (rhrDelta <= -3) {
      lines.push({
        id: "rhr-falling",
        priority: 50,
        text: t("overview.greeting.rhrFalling")
      });
    }
  }

  if (
    summary.weekLoadTotal !== undefined &&
    Number.isFinite(summary.weekLoadTotal) &&
    summary.weekLoadTotal > 0
  ) {
    lines.push({
      id: "week-load",
      priority: 42,
      text: t("overview.greeting.weekLoad", { load: formatCount(Math.round(summary.weekLoadTotal)) })
    });
  }

  if (
    summary.steps !== undefined &&
    Number.isFinite(summary.steps) &&
    summary.steps >= 10_000
  ) {
    lines.push({
      id: "steps",
      priority: 44,
      text: t("overview.greeting.steps", { steps: formatCount(summary.steps) })
    });
  }

  return lines;
}

function planLines(
  context: OverviewGreetingContext,
  now: Date
): OverviewGreetingLine[] {
  const scheduled = (context.upcomingWorkouts ?? []).filter((workout) =>
    isUpcomingWorkoutScheduled(workout.happenDay, now)
  );

  if (scheduled.length === 0) {
    return [];
  }

  const today = scheduled.filter((workout) =>
    isUpcomingWorkoutToday(workout.happenDay, now)
  );

  if (today.length > 1) {
    return [
      {
        id: "plan-today-multi",
        priority: 84,
        text: t("overview.greeting.multiToday", { count: today.length })
      }
    ];
  }

  if (today.length === 1) {
    return [{ id: "plan-today", priority: 84, text: todayWorkoutText(today[0]) }];
  }

  const next = scheduled.find(
    (workout) => !isUpcomingWorkoutToday(workout.happenDay, now)
  );

  if (!next) {
    return [];
  }

  const gap = daysBetweenDayKeys(getLocalHappenDayKey(now), next.happenDay);
  const when =
    gap === 1
      ? t("overview.greeting.tomorrow")
      : t("overview.greeting.onDate", { date: formatUpcomingWorkoutDate(next.happenDay, now) });
  const name = next.name?.trim();

  return [
    {
      id: "plan-rest",
      priority: 60,
      text: name
        ? t("overview.greeting.restNext", { name, when })
        : t("overview.greeting.nothingToday", { when })
    }
  ];
}

function activityLines(
  context: OverviewGreetingContext,
  now: Date
): OverviewGreetingLine[] {
  const activities = context.activities ?? [];
  const unitSystem = context.unitSystem ?? "metric";
  const dayKeys = new Set<string>();
  let latest: TrainingHubActivity | undefined;

  for (const activity of activities) {
    const dayKey = happenDayFromTimestamp(activity.startTime);

    if (dayKey) {
      dayKeys.add(dayKey);
    }

    if (
      activity.startTime !== undefined &&
      (latest?.startTime === undefined || activity.startTime > latest.startTime)
    ) {
      latest = activity;
    }
  }

  if (!latest) {
    return [];
  }

  const lines: OverviewGreetingLine[] = [];
  const todayKey = getLocalHappenDayKey(now);
  const latestKey = happenDayFromTimestamp(latest.startTime);
  // Lower case mid-sentence where the language writes it so; German keeps a
  // noun's capital, and most scripts have no case at all.
  const sportName = resolveSportName(latest, context.sportTypes ?? []) ?? t("overview.greeting.session");
  const sport = getLocale() === "de" ? sportName : sportName.toLocaleLowerCase(getIntlLocale());
  const gap = latestKey ? daysBetweenDayKeys(latestKey, todayKey) : null;

  if (gap === 0) {
    const distance =
      latest.distance !== undefined && latest.distance > 0
        ? formatDistanceMeters(latest.distance, unitSystem)
        : null;

    lines.push({
      id: "logged-today",
      priority: 86,
      text: distance
        ? t("overview.greeting.loggedTodayDistance", { sport, distance })
        : t("overview.greeting.loggedToday", { sport })
    });
  } else if (gap === 1) {
    lines.push({
      id: "logged-yesterday",
      priority: 48,
      text: t("overview.greeting.loggedYesterday", { sport })
    });
  } else if (gap !== null && gap >= 4) {
    lines.push({
      id: "training-gap",
      priority: 64,
      text: t("overview.greeting.gap", { days: gap })
    });
  }

  // Streak: consecutive active days ending today, or yesterday if today is
  // still empty — a rest day should not wipe out a run of hard weeks.
  const anchor = dayKeys.has(todayKey) ? 0 : dayKeys.has(dayKeyOffset(now, -1)) ? -1 : null;

  if (anchor !== null) {
    let streak = 0;

    while (dayKeys.has(dayKeyOffset(now, anchor - streak))) {
      streak += 1;
    }

    if (streak >= 3) {
      lines.push({
        id: "streak",
        priority: 56,
        text: t("overview.greeting.streak", { days: streak })
      });
    }
  }

  return lines;
}

function setupLines(context: OverviewGreetingContext): OverviewGreetingLine[] {
  if (context.trainingConnected) {
    return [];
  }

  return [
    {
      id: "connect-coros",
      priority: 46,
      text: t("overview.greeting.connect")
    }
  ];
}

/**
 * Every line that currently holds true, most important first. Ties break on
 * `id` so the order never depends on which builder ran first.
 */
export function buildOverviewGreetingCandidates(
  context: OverviewGreetingContext
): OverviewGreetingLine[] {
  const now = context.now ?? new Date();
  const summary = context.summary ?? null;

  const lines = [
    ...planLines(context, now),
    ...sleepLines(context, now),
    ...(summary ? recoveryLines(summary) : []),
    ...activityLines(context, now),
    ...setupLines(context)
  ];

  return lines.sort(
    (left, right) =>
      right.priority - left.priority || left.id.localeCompare(right.id)
  );
}

/**
 * Which slot of the day we are in — the same three buckets the "Good morning /
 * afternoon / evening" heading uses, so the subtitle turns over with it.
 */
export function greetingSlotIndex(now: Date): number {
  const hour = now.getHours();
  const slot = hour < 12 ? 0 : hour < 17 ? 1 : 2;
  const dayNumber = Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY
  );

  return dayNumber * 3 + slot;
}

export function selectOverviewGreetingLine(
  context: OverviewGreetingContext
): OverviewGreetingLine | null {
  const candidates = buildOverviewGreetingCandidates(context);

  if (candidates.length === 0) {
    return null;
  }

  const [leader] = candidates;

  if (leader.priority >= URGENT_PRIORITY) {
    return leader;
  }

  const pool = candidates
    .filter((line) => line.priority >= leader.priority - ROTATION_PRIORITY_BAND)
    .slice(0, ROTATION_POOL_SIZE);
  const index = greetingSlotIndex(context.now ?? new Date()) % pool.length;

  return pool[index];
}

/** `fallbackText` is what to say when we know nothing else. */
export function selectOverviewGreeting(
  context: OverviewGreetingContext,
  fallbackText: string
): string {
  return selectOverviewGreetingLine(context)?.text ?? fallbackText;
}
