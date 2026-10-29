import type { StrengthLoadSource, TrainingHubActivity, TrainingHubUpcomingWorkout } from "../../../electron/types";
import { getLocalHappenDayKey, happenDayFromTimestamp } from "../formatters";
import { activityLoad, plannedLoad } from "../loadFigures";
import { activitySportFamily, scheduledSportFamily, sportFamiliesCompatible } from "../workoutSport";

/*
 * The arithmetic behind Overview's Coming up: what today holds — done, still
 * to do, or nothing — the days after it, and the week ahead in one line.
 */

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

/**
 * How far a session is from a plan, lower closer: by load where both state
 * one, then distance, then time — the Calendar's own order (`matchScore` in
 * calendar/pairing.ts), so the two choose alike between two runs of one day.
 * Load is read in the load the athlete reads strength in, both sides alike.
 */
function fitScore(
  workout: TrainingHubUpcomingWorkout,
  activity: TrainingHubActivity,
  loadSource: StrengthLoadSource
): number {
  const relative = (actual: number | undefined, planned: number | undefined) =>
    actual !== undefined && planned !== undefined && planned > 0 ? Math.abs(actual - planned) / planned : undefined;
  return (
    relative(activityLoad(activity, loadSource), plannedLoad(workout, loadSource)) ??
    relative(activity.distance, workout.distanceMeters) ??
    relative(activity.duration, workout.durationSeconds) ??
    1
  );
}

/**
 * Today's plan read against today's sessions, greedily and by sport family as
 * the Calendar pairs a day: each plan in the calendar's order takes the
 * compatible session closest to it (`fitScore`), the earlier on a tie, and a
 * session nothing planned stands on its own. The Calendar's hand-made links
 * and skips are not read here.
 */
export function pairTodayPlan(
  planned: readonly TrainingHubUpcomingWorkout[],
  done: readonly TrainingHubActivity[],
  loadSource: StrengthLoadSource = "coros"
): {
  pairs: Array<{ workout: TrainingHubUpcomingWorkout; activity: TrainingHubActivity }>;
  open: TrainingHubUpcomingWorkout[];
  unplanned: TrainingHubActivity[];
} {
  const used = new Set<string>();
  const pairs: Array<{ workout: TrainingHubUpcomingWorkout; activity: TrainingHubActivity }> = [];
  const open: TrainingHubUpcomingWorkout[] = [];
  const sessions = [...done].sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));
  for (const workout of planned) {
    const family = scheduledSportFamily(workout.sportType);
    let activity: TrainingHubActivity | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of sessions) {
      if (used.has(candidate.activityId) || !sportFamiliesCompatible(family, activitySportFamily(candidate.sportType))) {
        continue;
      }
      const score = fitScore(workout, candidate, loadSource);
      if (score < best) {
        activity = candidate;
        best = score;
      }
    }
    if (activity) {
      used.add(activity.activityId);
      pairs.push({ workout, activity });
    } else {
      open.push(workout);
    }
  }
  return { pairs, open, unplanned: sessions.filter((activity) => !used.has(activity.activityId)) };
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

/**
 * Today, in the order it is read: what is done first, in the order it was
 * done, then what is still to do, in the calendar's order.
 */
export function todayItems(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  activities: readonly TrainingHubActivity[],
  now = new Date(),
  loadSource: StrengthLoadSource = "coros"
): TodayItem[] {
  const today = getLocalHappenDayKey(now);
  const planned = upcoming.filter((workout) => workout.happenDay === today);
  const { pairs, open, unplanned } = pairTodayPlan(
    planned,
    activities.filter((activity) => happenDayFromTimestamp(activity.startTime) === today),
    loadSource
  );
  const answered = new Map(pairs.map((pair) => [pair.activity.activityId, pair.workout]));
  const done = [...pairs.map((pair) => pair.activity), ...unplanned].sort(
    (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
  );
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
        // Its place in the day's plan: the same however many are done.
        key: `planned:${workout.happenDay}:${planned.indexOf(workout)}`,
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
  const today = getLocalHappenDayKey(now);
  const tomorrow = getLocalHappenDayKey(addDays(now, 1));
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

/**
 * What the calendar still holds from today through the sixth day after it:
 * today's sessions a session recorded today answers are behind, not ahead.
 */
export function weekAhead(
  upcoming: readonly TrainingHubUpcomingWorkout[],
  activities: readonly TrainingHubActivity[],
  now = new Date(),
  loadSource: StrengthLoadSource = "coros"
): TrainingHubUpcomingWorkout[] {
  const today = getLocalHappenDayKey(now);
  const last = getLocalHappenDayKey(addDays(now, 6));
  const { open } = pairTodayPlan(
    upcoming.filter((workout) => workout.happenDay === today),
    activities.filter((activity) => happenDayFromTimestamp(activity.startTime) === today),
    loadSource
  );
  return [...open, ...upcoming.filter((workout) => workout.happenDay > today && workout.happenDay <= last)];
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
