import type {
  TrainingHubScheduledWorkoutEntry,
  TrainingHubUpcomingWorkout
} from "../../electron/types";

/**
 * Overview's upcoming list and the calendar's scheduled list are parsed from the
 * same COROS `schedule/query` response, but the upcoming shape drops the plan
 * identifiers and `rawProgram` — the full step structure the detail view draws
 * from. So a click on Overview has to find its own row again in a scheduled
 * fetch, and the only fields both shapes carry are the day, COROS's own
 * within-day `sortNo` and the name.
 *
 * A day with no confident match returns `undefined` rather than the first
 * candidate: showing the wrong workout's structure is worse than showing this
 * one's thinner parsed form, which {@link scheduledEntryFromUpcoming} provides.
 */
export function matchScheduledEntry(
  entries: TrainingHubScheduledWorkoutEntry[],
  workout: Pick<TrainingHubUpcomingWorkout, "happenDay" | "name" | "sortNo">
): TrainingHubScheduledWorkoutEntry | undefined {
  const sameDay = entries.filter(
    (entry) => entry.happenDay === workout.happenDay
  );
  if (sameDay.length <= 1) {
    return sameDay[0];
  }

  const byBoth = sameDay.filter(
    (entry) => entry.sortNo === workout.sortNo && entry.name === workout.name
  );
  if (byBoth.length === 1) {
    return byBoth[0];
  }

  const byName = sameDay.filter((entry) => entry.name === workout.name);
  if (byName.length === 1) {
    return byName[0];
  }

  const bySortNo = sameDay.filter((entry) => entry.sortNo === workout.sortNo);
  if (bySortNo.length === 1) {
    return bySortNo[0];
  }

  return undefined;
}

/**
 * The upcoming row rendered as the entry shape the detail view takes. It carries
 * no plan identifiers — nothing on Overview mutates a schedule — and no
 * `rawProgram`, so the structure falls back to the parsed exercises COROS
 * already sent with the upcoming list.
 */
export function scheduledEntryFromUpcoming(
  workout: TrainingHubUpcomingWorkout
): TrainingHubScheduledWorkoutEntry {
  return {
    planId: "",
    idInPlan: "",
    planProgramId: "",
    happenDay: workout.happenDay,
    name: workout.name,
    sportType: workout.sportType,
    sortNo: workout.sortNo,
    volume: workout.volume,
    trainingLoad: workout.trainingLoad,
    exercises: workout.exercises
  };
}
