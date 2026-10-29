import { corosExerciseKey, type CorosExerciseCatalog, type CorosExerciseRow } from "./corosExerciseCatalog";
import { workoutExerciseMuscles } from "./workoutCapabilities";
import type { StrengthExercise } from "./types";

export interface StrengthExerciseContext {
  program?: Record<string, unknown>;
  catalog?: CorosExerciseCatalog;
}

/** A rounded 64-bit id is not an identity. Old detail caches contain those. */
function exactId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && value !== "0") return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : undefined;
}

/**
 * Read the movement by identity, never by its display name. A scheduled step
 * carries originId and muscle metadata even when its name is an instruction.
 * COROS's roll-up carries the zero-based programExerciseIndex; work laps often
 * carry 0 for every exercise, so only the roll-up may supply that fallback.
 */
export function strengthExerciseMetadata(
  laps: Record<string, unknown>[],
  context: StrengthExerciseContext
): Partial<StrengthExercise> {
  const aggregate = laps.find((lap) => lap.mode === 16 || Number(lap.sets) > 0);
  const first = laps.find((lap) => lap.mode === 14) ?? laps[0];
  const steps = Array.isArray(context.program?.exercises)
    ? (context.program.exercises as CorosExerciseRow[])
      .filter((step) => step && typeof step === "object" && !step.isGroup)
      .sort((a, b) => Number(a.sortNo ?? 0) - Number(b.sortNo ?? 0))
    : [];
  const stepId = exactId(aggregate?.exerciseId) ?? exactId(first?.exerciseId);
  let step = stepId ? steps.find((row) => exactId(row.id) === stepId) : undefined;
  const lapKey = corosExerciseKey(first?.exerciseNameKey);
  const index = aggregate?.programExerciseIndex;
  if (!step && !stepId && typeof index === "number" && Number.isInteger(index) && index >= 0) {
    const candidate = steps[index];
    const candidateKey = corosExerciseKey(context.catalog?.get(String(candidate?.originId))?.name) ??
      corosExerciseKey(candidate?.name);
    // A program edited since completion may no longer have this movement at
    // that position. A known activity key must never become a different lift,
    // nor a step whose key cannot be read.
    if (!lapKey || lapKey === candidateKey) step = candidate;
  }

  const originId = exactId(step?.originId) ?? exactId(aggregate?.originId) ?? exactId(first?.originId);
  let catalogRow = originId ? context.catalog?.get(originId) : undefined;
  if (!catalogRow && lapKey) {
    catalogRow = [...(context.catalog?.values() ?? [])]
      .find((row) => corosExerciseKey(row.name) === lapKey);
  }
  // With no program, some payloads use exerciseId for the catalog identity.
  if (!catalogRow && stepId) catalogRow = context.catalog?.get(stepId);
  const externalId = originId ?? exactId(catalogRow?.id);
  const corosKey = corosExerciseKey(catalogRow?.name) ?? lapKey;
  const metadata = [first, aggregate, step, catalogRow].find((row) =>
    row && (Array.isArray(row.muscle) || Array.isArray(row.muscleRelevance))
  );
  const muscles = metadata ? workoutExerciseMuscles(metadata) : undefined;
  const phase = step?.exerciseType ?? first?.exerciseType ?? catalogRow?.exerciseType;
  return {
    ...(externalId ? { externalId } : {}),
    ...(corosKey ? { corosKey } : {}),
    ...(muscles ? { primaryMuscles: muscles.primary, involvedMuscles: muscles.involved } : {}),
    ...(typeof phase === "number" ? { corosExerciseType: phase } : {})
  };
}

/** The activity names the scheduled program by idInPlan, not by its title. */
export function strengthProgramFromSchedule(
  raw: Record<string, unknown>,
  schedule: Record<string, unknown>
): Record<string, unknown> | undefined {
  const summary = raw.summary as Record<string, unknown> | undefined;
  const id = exactId(summary?.programId);
  if (!id || !Array.isArray(schedule.programs)) return undefined;
  const matches = (schedule.programs as Record<string, unknown>[]).filter((program) =>
    exactId(program.idInPlan) === id
  );
  return matches.length === 1 ? matches[0] : undefined;
}
