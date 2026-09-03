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
import { resolveSportName } from "./training/sportTypes";
import type { TrainingSummaryMetrics } from "./training/types";

/**
 * The Overview subtitle used to be one frozen sentence. It now reads the
 * signals the dashboard already has — tonight's plan, last night's sleep,
 * recovery, resting HR, what was logged — and says the most useful thing.
 *
 * Everything here is pure so `scripts/test-overview-greeting.mjs` can pin the
 * copy without a renderer.
 */
export interface OverviewGreetingContext {
  watchConnected: boolean;
  trainingConnected: boolean;
  upcomingWorkouts?: TrainingHubUpcomingWorkout[];
  activities?: TrainingHubActivity[];
  sportTypes?: TrainingHubSportType[];
  summary?: TrainingSummaryMetrics | null;
  sleep?: TrainingHubSleepSummary | null;
  /** Local tracks in the media library — the Overview lists them too. */
  downloadCount?: number;
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
 * band a rest-day plan would lose its slot to "grab some music", which is
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
    return `${remainder}m`;
  }

  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
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
  if (!sleep) {
    return undefined;
  }

  const acceptable = new Set([getLocalHappenDayKey(now), dayKeyOffset(now, -1)]);
  const candidates = [
    ...(sleep.latest ? [sleep.latest] : []),
    ...(sleep.records ?? [])
  ];

  return candidates.find(
    (record) =>
      record.kind !== "nap" &&
      record.completeness !== "partial" &&
      acceptable.has(record.happenDay)
  );
}

const TODAY_WORKOUT_COPY: Record<string, string> = {
  Race: "Race day. Trust the training and go get it.",
  Long: "Long run on the plan today — settle in and enjoy it.",
  Easy: "An easy run today. Keep it conversational.",
  Intervals: "Intervals today. Warm up properly before the hard reps.",
  Speed: "A tempo session today. Find the rhythm and hold it."
};

function todayWorkoutText(workout: TrainingHubUpcomingWorkout): string {
  const category = inferUpcomingWorkoutCategory(workout.name ?? "");
  const copy = TODAY_WORKOUT_COPY[category];

  if (copy) {
    return copy;
  }

  const name = workout.name?.trim();
  return name ? `${name} is on the plan today.` : "You have a session on the plan today.";
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
  const { score, totalMinutes } = record;

  if (score !== undefined && Number.isFinite(score) && score < 60) {
    lines.push({
      id: "sleep-poor",
      priority: 90,
      text: `Last night's sleep scored ${Math.round(score)}. Looks rough — keep today easy.`
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
      text: `Only ${formatSleepLength(totalMinutes)} of sleep last night. Go gentle today.`
    });
  } else if (score !== undefined && Number.isFinite(score) && score >= 90) {
    lines.push({
      id: "sleep-excellent",
      priority: 62,
      text: `You slept well — ${Math.round(score)} sleep score last night.`
    });
  } else if (
    totalMinutes !== undefined &&
    Number.isFinite(totalMinutes) &&
    totalMinutes >= SHORT_SLEEP_MINUTES
  ) {
    lines.push({
      id: "sleep-solid",
      priority: 52,
      text: `${formatSleepLength(totalMinutes)} of sleep last night. That's a solid base.`
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
        text: `Recovery is at ${percent}%. Rest is training too.`
      });
    } else if (percent >= 90) {
      lines.push({
        id: "recovery-peak",
        priority: 72,
        text: `${percent}% recovered. Your body is ready for a hard one.`
      });
    } else if (percent >= 70) {
      lines.push({
        id: "recovery-ready",
        priority: 66,
        text: `You're ${percent}% recovered and good to go.`
      });
    } else {
      lines.push({
        id: "recovery-moderate",
        priority: 58,
        text: `Recovery is at ${percent}% — easy to moderate suits today.`
      });
    }
  }

  if (rhrDelta !== undefined && Number.isFinite(rhrDelta)) {
    if (rhrDelta >= 5) {
      lines.push({
        id: "rhr-elevated",
        priority: 86,
        text: `Resting heart rate is ${Math.round(rhrDelta)} bpm above your week's average. Worth an easy day.`
      });
    } else if (rhrDelta <= -3) {
      lines.push({
        id: "rhr-falling",
        priority: 50,
        text: "Your resting heart rate is trending down. Good sign."
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
      text: `${Math.round(summary.weekLoadTotal)} training load over the last 7 days.`
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
      text: `${summary.steps.toLocaleString()} steps today. Nice moving.`
    });
  }

  return lines;
}

function planLines(
  context: OverviewGreetingContext,
  now: Date
): OverviewGreetingLine[] {
  const scheduled = (context.upcomingWorkouts ?? []).filter((workout) =>
    isUpcomingWorkoutScheduled(workout.happenDay)
  );

  if (scheduled.length === 0) {
    return [];
  }

  const today = scheduled.filter((workout) =>
    isUpcomingWorkoutToday(workout.happenDay)
  );

  if (today.length > 1) {
    return [
      {
        id: "plan-today-multi",
        priority: 84,
        text: `${today.length} sessions on the plan today.`
      }
    ];
  }

  if (today.length === 1) {
    return [{ id: "plan-today", priority: 84, text: todayWorkoutText(today[0]) }];
  }

  const next = scheduled.find(
    (workout) => !isUpcomingWorkoutToday(workout.happenDay)
  );

  if (!next) {
    return [];
  }

  const gap = daysBetweenDayKeys(getLocalHappenDayKey(now), next.happenDay);
  const when =
    gap === 1 ? "tomorrow" : `on ${formatUpcomingWorkoutDate(next.happenDay)}`;
  const name = next.name?.trim();

  return [
    {
      id: "plan-rest",
      priority: 60,
      text: name
        ? `Rest day today. Next up: ${name} ${when}.`
        : `Nothing scheduled today. Your next session is ${when}.`
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
  const sport = (resolveSportName(latest, context.sportTypes ?? []) ?? "session")
    .toLowerCase();
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
        ? `Today's ${sport} is logged — ${distance} in the bank.`
        : `Today's ${sport} is logged. Nice work.`
    });
  } else if (gap === 1) {
    lines.push({
      id: "logged-yesterday",
      priority: 48,
      text: `Yesterday's ${sport} is in the books.`
    });
  } else if (gap !== null && gap >= 4) {
    lines.push({
      id: "training-gap",
      priority: 64,
      text: `It's been ${gap} days since your last session. Ready when you are.`
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
        text: `${streak} days in a row. Nice streak.`
      });
    }
  }

  return lines;
}

function setupLines(context: OverviewGreetingContext): OverviewGreetingLine[] {
  const lines: OverviewGreetingLine[] = [];

  if (!context.trainingConnected) {
    lines.push({
      id: "connect-coros",
      priority: 46,
      text: "Sign in to COROS to see your training at a glance."
    });
  }

  const downloads = context.downloadCount ?? 0;

  if (context.watchConnected && downloads > 0) {
    lines.push({
      id: "library-ready",
      priority: 36,
      text: `${downloads} ${downloads === 1 ? "track" : "tracks"} in your library, ready for the watch.`
    });
  } else if (context.watchConnected) {
    lines.push({
      id: "watch-ready",
      priority: 34,
      text: "Watch connected. Grab some music for your next run."
    });
  }

  return lines;
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

/**
 * `fallbackText` is the watch presentation's companion line — the old fixed
 * copy, still the right thing to say when we know nothing else.
 */
export function selectOverviewGreeting(
  context: OverviewGreetingContext,
  fallbackText: string
): string {
  return selectOverviewGreetingLine(context)?.text ?? fallbackText;
}
