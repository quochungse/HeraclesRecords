/**
 * Heracles Training Load's estimate of the strength sessions in the plans on
 * screen, while strength is read in it (`useLoadSource`). The main process
 * makes the estimates — it holds the athlete's capacity per movement — and a
 * plan carries none of them, so nothing derived is ever saved with a plan.
 * Asked for by `usePlanHeraclesLoads`; pure here so the models can read them.
 */
import type { HeraclesLoad, PlanLoadEntry, TrainingPlanDocument, TrainingPlanEntry } from "../../electron/types";

/** The estimates, by `planLoadKey`; undefined while strength is read in COROS's load. */
export type PlanHeraclesLoads = ReadonlyMap<string, HeraclesLoad>;

export function planLoadKey(planId: string, entryId: string): string {
  return `${planId}:${entryId}`;
}

/** A session's planned load in Heracles Training Load, where there is an estimate. */
export function heraclesEntryLoad(
  plan: Pick<TrainingPlanDocument, "id">,
  loads: PlanHeraclesLoads | undefined
): ((entry: TrainingPlanEntry) => number | undefined) | undefined {
  return loads ? (entry) => loads.get(planLoadKey(plan.id, entry.id))?.value : undefined;
}

export function strengthEntries(plans: readonly TrainingPlanDocument[]): PlanLoadEntry[] {
  return plans.flatMap((plan) =>
    plan.entries
      .filter((entry) => entry.workout.sport === "strength")
      .map((entry) => ({
        key: planLoadKey(plan.id, entry.id),
        workout: entry.workout,
        plannedDurationSeconds: entry.plannedDurationSeconds,
        plannedTrainingLoad: entry.plannedTrainingLoad
      }))
  );
}
