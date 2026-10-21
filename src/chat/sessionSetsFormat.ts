import type { ActivityVisualStrengthExercise, SessionSet, UnitSystem } from "../../electron/types";
import { formatDurationSeconds } from "../training/formatters";
import { formatWeightKg } from "../strength/strengthAnalytics";
import { formatCount, plural, t } from "../i18n/core";

/** `30 kg × 12`, `12 reps`, a timed set's `0:45` (`24 kg · 2:00` with a load). */
export function formatSessionSet(set: SessionSet, unitSystem: UnitSystem): string {
  const load = set.weightKg ? formatWeightKg(set.weightKg, unitSystem) : undefined;
  if (!set.timed && set.reps !== undefined) {
    return load ? `${load} × ${set.reps}` : plural("strength.reps", set.reps);
  }
  const time = formatDurationSeconds(set.seconds);
  return load ? `${load} · ${time}` : time;
}

function scheme(values: number[], format: (value: number) => string): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return `${formatCount(values.length)} × ${low === high ? format(low) : `${format(low)}–${format(high)}`}`;
}

/**
 * An exercise's sets as a gym writes them: `4 × 12`, `4 × 11–14`, a timed
 * exercise's `3 × 0:45`. The total reps beside the set count read as reps per
 * set — "4 sets, 48 reps" — which is the misreading this replaces. A card
 * stored before the sets were kept has only the two counts, and says so.
 */
export function formatSetScheme(exercise: ActivityVisualStrengthExercise): string {
  const sets = exercise.setList ?? [];
  if (sets.length === 0) {
    return t("activity.strength.setsReps", {
      sets: formatCount(exercise.sets),
      reps: formatCount(exercise.reps)
    });
  }
  const counted = sets.flatMap((set) => (!set.timed && set.reps !== undefined ? [set.reps] : []));
  const timed = sets.flatMap((set) => (set.timed || set.reps === undefined ? [set.seconds] : []));
  return [
    counted.length > 0 ? scheme(counted, formatCount) : undefined,
    timed.length > 0 ? scheme(timed, formatDurationSeconds) : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}
