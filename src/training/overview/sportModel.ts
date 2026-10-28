import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubUpcomingWorkout
} from "../../../electron/types";
import { runWindowStartMs } from "../../running/runMetrics";
import { parseUpcomingWorkoutDistanceKm } from "../formatters";
import {
  TRAINING_BENEFITS,
  trainingBenefit,
  type BenefitZoneFamily,
  type TrainingBenefit
} from "../trainingBenefit";
import { scheduledSportFamily, type SportFamily } from "../workoutSport";
import { pairTodayPlan } from "./comingUpModel";

/*
 * What Overview's per-sport sections share: the window they cover, the weeks
 * their charts draw, the session types their runs and rides were labelled
 * with, and what the calendar still holds for the sport this week. The sports'
 * own arithmetic is their screens' (runMetrics, rideMetrics, hikeMetrics).
 */

/** Four calendar weeks, this one included: the sport screens' "4 weeks". */
export const SPORT_WINDOW_WEEKS = 4;
/** The chart: the four weeks before this one, and this one. */
export const SPORT_CHART_WEEKS = 5;

/** The sessions of the last four calendar weeks, cut at the Monday the sport screens cut at. */
export function sportWindow<T extends { startTime?: number }>(
  activities: readonly T[],
  nowMs: number
): T[] {
  const cutoff = runWindowStartMs(SPORT_WINDOW_WEEKS, nowMs) / 1000;
  return activities.filter((activity) => {
    const start = activity.startTime ?? 0;
    const seconds = start > 10_000_000_000 ? start / 1000 : start;
    return seconds >= cutoff && seconds <= nowMs / 1000;
  });
}

/** The mean of every week but the last, which is this one and still running. */
export function previousWeeksAverage(values: readonly number[]): number | undefined {
  const before = values.slice(0, -1);
  return before.length > 0 ? before.reduce((sum, value) => sum + value, 0) / before.length : undefined;
}

export type SessionTypeKey = TrainingBenefit | "intervals" | "strides" | "long";

export interface SessionTypeCount {
  key: SessionTypeKey;
  count: number;
}

/**
 * How the sessions were labelled (`trainingBenefit`, the Running and Cycling
 * lists' own label): a session with a shape — intervals, strides, a long one —
 * counts as that shape, any other by its primary benefit. A session with no
 * label (too short, no heart rate, not yet summarised) is not counted. Most
 * first; a tie in the benefits' own order, easiest first.
 */
export function sessionTypeCounts(
  sessions: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  family: BenefitZoneFamily | undefined
): SessionTypeCount[] {
  const counts = new Map<SessionTypeKey, number>();
  for (const session of sessions) {
    const reading = trainingBenefit(session.sportType, summaries.get(session.activityId)?.intensity, family);
    if (!reading) {
      continue;
    }
    const key: SessionTypeKey = reading.format ? reading.format.kind : reading.primary;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order: readonly SessionTypeKey[] = [...TRAINING_BENEFITS, "long", "intervals", "strides"];
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || order.indexOf(left.key) - order.indexOf(right.key));
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * What the calendar still holds for one sport family this week, today to
 * Sunday: today's sessions less those a session recorded today answers
 * (`pairTodayPlan`, as Coming up reads today), and every day after.
 */
export function plannedThisWeek(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  activities: readonly TrainingHubActivity[],
  family: SportFamily,
  now = new Date()
): { count: number; km: number } {
  const today = dayKey(now);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const last = dayKey(sunday);
  const ofSport = upcoming.filter(
    (workout) =>
      workout.happenDay >= today && workout.happenDay <= last && scheduledSportFamily(workout.sportType) === family
  );
  const doneToday = activities.filter((activity) => {
    const start = activity.startTime ?? 0;
    const date = new Date(start > 10_000_000_000 ? start : start * 1000);
    return start > 0 && dayKey(date) === today;
  });
  const open = [
    ...pairTodayPlan(ofSport.filter((workout) => workout.happenDay === today), doneToday).open,
    ...ofSport.filter((workout) => workout.happenDay > today)
  ];
  return {
    count: open.length,
    km: open.reduce((sum, workout) => sum + (parseUpcomingWorkoutDistanceKm(workout.volume) ?? 0), 0)
  };
}

/** The next session of a sport family on the calendar from today on. */
export function nextPlanned(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  family: SportFamily,
  now = new Date()
): TrainingHubUpcomingWorkout | undefined {
  const today = dayKey(now);
  return [...upcoming]
    .filter((workout) => workout.happenDay >= today && scheduledSportFamily(workout.sportType) === family)
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay))[0];
}

/** The window's longest session by distance, and the newest of all of them. */
export function longestAndLast(
  window: readonly TrainingHubActivity[],
  all: readonly TrainingHubActivity[]
): { longest?: TrainingHubActivity; last?: TrainingHubActivity } {
  const longest = [...window]
    .filter((activity) => (activity.distance ?? 0) > 0)
    .sort((left, right) => (right.distance ?? 0) - (left.distance ?? 0))[0];
  const last = [...all].sort((left, right) => (right.startTime ?? 0) - (left.startTime ?? 0))[0];
  return { longest, last };
}
