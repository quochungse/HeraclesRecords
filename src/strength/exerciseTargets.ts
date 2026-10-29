import type { StrengthExercise, StrengthSession, WorkoutExerciseOption } from "../../electron/types";
import { corosExerciseKey } from "../../electron/corosExerciseCatalog";
import { reviewedMuscleLoads } from "../calendar/exerciseFacets";
import {
  resolveExerciseTargets,
  resolveProviderMuscleTargets,
  type ExerciseTargets,
  type MuscleId
} from "./muscles";

/**
 * A free session's segments are body-region codes with no catalog row and no
 * metadata: still an identity, read with the region rules under their English
 * names (the display name is translated, so it cannot be the key).
 */
const BODY_REGION_RULE_NAMES: Readonly<Record<string, string>> = {
  S4209: "Shoulders", // i18n-ignore: a rule key
  S4210: "Arms", // i18n-ignore: a rule key
  S4211: "Chest", // i18n-ignore: a rule key
  S4212: "Back", // i18n-ignore: a rule key
  S4213: "Abs", // i18n-ignore: a rule key
  S4214: "Legs & Hips" // i18n-ignore: a rule key
};

/** Resolve the identity and metadata already on the exercise. Names are display only. */
export function exerciseTargets(exercise: StrengthExercise): ExerciseTargets {
  const corosKey = exercise.corosKey ?? corosExerciseKey(exercise.nameKey);
  const mobility = exercise.corosExerciseType === 1 || exercise.corosExerciseType === 3 ||
    exercise.corosExerciseType === 4;
  if (mobility || corosKey === "S4208") {
    return { activations: [], mobility, generic: !mobility };
  }
  const region = corosKey ? BODY_REGION_RULE_NAMES[corosKey] : undefined;
  if (region) return resolveExerciseTargets(region);
  const loads = reviewedMuscleLoads({
    corosKey,
    primaryMuscles: exercise.primaryMuscles,
    involvedMuscles: exercise.involvedMuscles
  });
  if (Object.keys(loads).length > 0) {
    return {
      activations: (Object.entries(loads) as [MuscleId, number][])
        .map(([muscle, share]) => ({ muscle, share })),
      mobility: false,
      generic: false
    };
  }
  return resolveProviderMuscleTargets(exercise.primaryMuscleGroup, exercise.secondaryMuscleGroups);
}

/**
 * Catalog fallback for legacy caches and developer samples. Match only the
 * provider id or COROS's stable key, and keep metadata saved with the workout
 * ahead of today's catalog. Reviews are applied by exerciseTargets afterward.
 */
export function strengthSessionsWithCatalog(
  sessions: StrengthSession[],
  options: readonly WorkoutExerciseOption[]
): StrengthSession[] {
  if (!options.length) return sessions;
  const byId = new Map(options.map((option) => [option.id, option]));
  const byKey = new Map(options.flatMap((option) => option.corosKey ? [[option.corosKey, option] as const] : []));
  return sessions.map((session) => ({
    ...session,
    detail: {
      ...session.detail,
      exercises: session.detail.exercises.map((exercise) => {
        // Hevy template ids and COROS ids are different namespaces.
        if (exercise.primaryMuscleGroup !== undefined || session.source === "hevy" || session.source === "combined") return exercise;
        const key = exercise.corosKey ?? corosExerciseKey(exercise.nameKey);
        const option = (exercise.externalId ? byId.get(exercise.externalId) : undefined) ??
          (key ? byKey.get(key) : undefined);
        if (!option) return exercise;
        const hasMetadata = exercise.primaryMuscles !== undefined || exercise.involvedMuscles !== undefined;
        return {
          ...exercise,
          externalId: exercise.externalId ?? option.id,
          corosKey: option.corosKey ?? key,
          ...(!hasMetadata ? { primaryMuscles: option.primaryMuscles, involvedMuscles: option.involvedMuscles } : {})
        };
      })
    }
  }));
}
