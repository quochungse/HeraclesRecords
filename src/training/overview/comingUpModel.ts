import type { TrainingHubActivity, TrainingHubUpcomingWorkout } from "../../../electron/types";
import { activitySportFamily, scheduledSportFamily, sportFamiliesCompatible } from "../workoutSport";

/*
 * The arithmetic behind Overview's Coming up: what today holds — done, still
 * to do, or nothing — the days after it, and the week ahead in one line.
 */

function happenDayOf(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return dayKey(date);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

/**
 * Today's plan read against today's sessions, greedily and by sport family as
 * the Calendar pairs a day: a run recorded today answers today's planned run,
 * and a session nothing planned stands on its own.
 */
export function pairTodayPlan(
  planned: readonly TrainingHubUpcomingWorkout[],
  done: readonly TrainingHubActivity[]
): {
  pairs: Array<{ workout: TrainingHubUpcomingWorkout; activity: TrainingHubActivity }>;
  open: TrainingHubUpcomingWorkout[];
  unplanned: TrainingHubActivity[];
} {
  const used = new Set<string>();
  const pairs: Array<{ workout: TrainingHubUpcomingWorkout; activity: TrainingHubActivity }> = [];
  const open: TrainingHubUpcomingWorkout[] = [];
  for (const workout of planned) {
    const family = scheduledSportFamily(workout.sportType);
    const activity = done.find(
      (candidate) =>
        !used.has(candidate.activityId) &&
        sportFamiliesCompatible(family, activitySportFamily(candidate.sportType))
    );
    if (activity) {
      used.add(activity.activityId);
      pairs.push({ workout, activity });
    } else {
      open.push(workout);
    }
  }
  return { pairs, open, unplanned: done.filter((activity) => !used.has(activity.activityId)) };
}

export type TodayItem =
  | {
      kind: "done";
      key: string;
      activity: TrainingHubActivity;
      /** The plan it answers, when it answers one. */
      workout?: TrainingHubUpcomingWorkout;
    }
  | { kind: "planned"; key: string; workout: TrainingHubUpcomingWorkout };

function workoutKey(workout: TrainingHubUpcomingWorkout, index: number): string {
  return `${workout.happenDay}:${workout.sortNo ?? index}:${workout.name}`;
}

/**
 * Today, in the order it is read: what is done first, in the order it was
 * done, then what is still to do, in the calendar's order.
 */
export function todayItems(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  activities: readonly TrainingHubActivity[],
  now = new Date()
): TodayItem[] {
  const today = dayKey(now);
  const planned = upcoming.filter((workout) => workout.happenDay === today);
  const done = activities
    .filter((activity) => happenDayOf(activity.startTime) === today)
    .sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));
  const { pairs, open } = pairTodayPlan(planned, done);
  const answered = new Map(pairs.map((pair) => [pair.activity.activityId, pair.workout]));
  return [
    ...done.map(
      (activity): TodayItem => ({
        kind: "done",
        key: `done:${activity.activityId}`,
        activity,
        workout: answered.get(activity.activityId)
      })
    ),
    ...open.map(
      (workout): TodayItem => ({
        kind: "planned",
        key: `planned:${workoutKey(workout, planned.indexOf(workout))}`,
        workout
      })
    )
  ];
}

/**
 * The days after today: every session tomorrow (COROS allows ten a day), then
 * the days after only up to `rows` in all, tomorrow's included — the same rule
 * the Upcoming Workouts card kept.
 */
export function nextDays(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  now = new Date(),
  rows = 3
): TrainingHubUpcomingWorkout[] {
  const today = dayKey(now);
  const tomorrow = dayKey(addDays(now, 1));
  const later = upcoming
    .filter((workout) => workout.happenDay > today)
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay));
  const tomorrows = later.filter((workout) => workout.happenDay === tomorrow).slice(0, 10);
  return [
    ...tomorrows,
    ...later
      .filter((workout) => workout.happenDay > tomorrow)
      .slice(0, Math.max(0, rows - tomorrows.length))
  ];
}

/** What the calendar holds from today through the sixth day after it. */
export function weekAhead(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  now = new Date()
): TrainingHubUpcomingWorkout[] {
  const today = dayKey(now);
  const last = dayKey(addDays(now, 6));
  return upcoming.filter((workout) => workout.happenDay >= today && workout.happenDay <= last);
}

/**
 * A session's load against its plan's, as a bar: the fill is what was done
 * and the mark is the plan, on a scale long enough for whichever is greater.
 * Undefined when either side carries no load to compare.
 */
export function loadAgainstPlan(
  done: number | undefined,
  planned: number | undefined
): { percent: number; fill: number; mark: number } | undefined {
  if (!done || !planned || !Number.isFinite(done) || !Number.isFinite(planned) || done <= 0 || planned <= 0) {
    return undefined;
  }
  const scale = Math.max(done, planned);
  return { percent: Math.round((done / planned) * 100), fill: done / scale, mark: planned / scale };
}
