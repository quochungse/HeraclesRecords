// COROS's exercise catalogue as the demo answers it: the rows in
// exercise-catalog.json (fetch-exercise-catalog.mjs), each read by
// `workoutExerciseOption`, the function main reads a live catalogue with. The
// Exercises Library, the picker and the strength workouts' clips show COROS's
// movements as they are, and the app's review of them as it ships.
import type { WorkoutExerciseOption } from "../../electron/types";
import { workoutExerciseOption } from "../../electron/workoutCapabilities";
import NAMES from "../../src/training/exerciseNames.json";
import CATALOG from "./exercise-catalog.json";

// A row names its movement by key (`T1010`). Main puts COROS's words for it on
// the row from COROS's string table (nameFromCorosLocale); the demo has no
// table, so it takes the app's own English name for the same key. Without one
// a workout's step reads as its kind, "Training".
function named(row: Record<string, unknown>): Record<string, unknown> {
  const key = typeof row.name === "string" ? row.name.trim() : "";
  const words = (NAMES as Record<string, string>)[key];
  return words ? { ...row, displayName: words } : row;
}

let options: WorkoutExerciseOption[] | undefined;

/** Every movement, in the order listWorkoutExercises answers them. */
export function exerciseOptions(): WorkoutExerciseOption[] {
  options ??= [...new Map((CATALOG as Record<string, unknown>[]).flatMap((row) => {
    const option = workoutExerciseOption(named(row));
    return option ? [[option.id, option] as const] : [];
  })).values()].sort((left, right) => left.name.localeCompare(right.name));
  return options;
}
