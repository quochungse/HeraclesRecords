import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubUpcomingWorkout
} from "../../../electron/types";
import { runWindowStartMs } from "../../running/runMetrics";
import { epochMsFromCorosTime } from "../activityWindow";
import { getLocalHappenDayKey, happenDayFromTimestamp, parseUpcomingWorkoutDistanceKm } from "../formatters";
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
export function sportWindow<T extends { startTime?: number }>(activities: readonly T[], nowMs: number): T[] {
  const cutoff = runWindowStartMs(SPORT_WINDOW_WEEKS, nowMs);
  return activities.filter((activity) => {
    const start = epochMsFromCorosTime(activity.startTime) ?? 0;
    return start >= cutoff && start <= nowMs;
  });
}

/**
 * How many weeks the window spans so far: three whole ones and as much of
 * this one as has passed, so a per-week figure on a Monday is not read over a
 * week that has hardly begun.
 */
export function sportWindowWeeks(nowMs: number): number {
  return Math.max(1, (nowMs - runWindowStartMs(SPORT_WINDOW_WEEKS, nowMs)) / (7 * 86_400_000));
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
  const today = getLocalHappenDayKey(now);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const last = getLocalHappenDayKey(sunday);
  const ofSport = upcoming.filter(
    (workout) =>
      workout.happenDay >= today && workout.happenDay <= last && scheduledSportFamily(workout.sportType) === family
  );
  const doneToday = activities.filter((activity) => happenDayFromTimestamp(activity.startTime) === today);
  const open = [
    ...pairTodayPlan(ofSport.filter((workout) => workout.happenDay === today), doneToday).open,
    ...ofSport.filter((workout) => workout.happenDay > today)
  ];
  return {
    count: open.length,
    // A structured session's volume is a set count, so its own distance first.
    km: open.reduce(
      (sum, workout) =>
        sum +
        (workout.distanceMeters !== undefined
          ? workout.distanceMeters / 1000
          : (parseUpcomingWorkoutDistanceKm(workout.volume) ?? 0)),
      0
    )
  };
}

/**
 * The next session of a sport family on the calendar from today on. One of
 * today's that a session recorded today answers (`pairTodayPlan`) is done, not
 * next: the line beside it already names that session as the last.
 */
export function nextPlanned(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  family: SportFamily,
  now = new Date(),
  activities: readonly TrainingHubActivity[] = []
): TrainingHubUpcomingWorkout | undefined {
  const today = getLocalHappenDayKey(now);
  const ofSport = upcoming.filter(
    (workout) => workout.happenDay >= today && scheduledSportFamily(workout.sportType) === family
  );
  const answered = new Set(
    pairTodayPlan(
      ofSport.filter((workout) => workout.happenDay === today),
      activities.filter((activity) => happenDayFromTimestamp(activity.startTime) === today)
    ).pairs.map((pair) => pair.workout)
  );
  return ofSport
    .filter((workout) => !answered.has(workout))
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay))[0];
}

/** The window's longest session by distance, and the newest of all of them, in one pass each. */
export function longestAndLast(
  window: readonly TrainingHubActivity[],
  all: readonly TrainingHubActivity[]
): { longest?: TrainingHubActivity; last?: TrainingHubActivity } {
  let longest: TrainingHubActivity | undefined;
  for (const activity of window) {
    if ((activity.distance ?? 0) > (longest?.distance ?? 0)) {
      longest = activity;
    }
  }
  let last: TrainingHubActivity | undefined;
  for (const activity of all) {
    if (!last || (activity.startTime ?? 0) > (last.startTime ?? 0)) {
      last = activity;
    }
  }
  return { longest, last };
}
