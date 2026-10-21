import type { ActivityLapSection, TrainingHubLapPhase } from "./types";

/**
 * The part of a structured workout each lap fell in — warm-up, the main part,
 * cool-down, and whatever was run after the last step — which every lap
 * table heads its rows by: the Coach's card, and the run, ride, hike and
 * activity pages. COROS names no step on a lap, only its `mode`, which every
 * 1 km lap inside a step carries; a lap run past the last step is mode 2 with
 * `programExerciseIndex` 255 (`afterWorkout`).
 *
 * The renderer imports this directly, so it must stay free of `node:` imports.
 */

interface SectionedLap {
  phase?: TrainingHubLapPhase;
  afterWorkout?: boolean;
}

function lapSection(lap: SectionedLap): ActivityLapSection | undefined {
  if (lap.afterWorkout) return "after";
  switch (lap.phase) {
    case "warmup":
      return "warmup";
    case "cooldown":
      return "cooldown";
    case "work":
    case "recovery":
      return "training";
    default:
      return undefined;
  }
}

/**
 * Each lap's section, on a workout of more than one. A free run, or a workout
 * of one step, has nothing to tell apart and gets none.
 */
export function lapSections(laps: readonly SectionedLap[]): (ActivityLapSection | undefined)[] {
  const sections = laps.map(lapSection);
  return new Set(sections.filter(Boolean)).size > 1 ? sections : laps.map(() => undefined);
}

/**
 * A recovery between repeats, inside the workout's main part — which is all of
 * an interval session with no warm-up or cool-down, where `lapSections` has no
 * parts to tell apart and hands back none.
 */
export function isRecoveryLap(lap: SectionedLap, section: ActivityLapSection | undefined): boolean {
  return lap.phase === "recovery" && !lap.afterWorkout && (section === undefined || section === "training");
}
