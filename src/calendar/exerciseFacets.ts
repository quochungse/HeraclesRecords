/**
 * The four ways the exercise picker narrows COROS's catalog.
 *
 * COROS's `/training/exercise/query` answers with an id, a name and some
 * media, and nothing else — no body part, no muscle, no equipment. Every
 * facet here is therefore derived from the movement's name, by the two rule
 * sets the app already owns:
 *
 *   - muscles come from `resolveExerciseTargets` (`src/strength/muscles.ts`),
 *     the same rules the Strength body map is drawn from, so a movement is
 *     attributed to the same muscles on both screens;
 *   - equipment comes from `classifyWorkoutExerciseName`
 *     (`electron/exerciseCatalogSearch.ts`), the same rules the coach's
 *     `search_coros_exercises` tool filters by.
 *
 * A body part is a roll-up of muscles rather than a third rule set, so the
 * two rows of the picker cannot disagree about where a movement belongs.
 *
 * A movement no rule recognises carries no facet at all. It is reachable
 * under **All** and by search, and it is deliberately not filed under a
 * guess — a picker that puts a bench press under "Legs" is worse than one
 * that only finds it by name.
 */
import {
  classifyWorkoutExerciseName,
  type ExerciseSearchEquipment
} from "../../electron/exerciseCatalogSearch";
import { MUSCLE_BY_ID, resolveExerciseTargets, type MuscleId } from "../strength/muscles";
import { messageRecord } from "../i18n/core";

export type ExerciseFacetKind = "all" | "bodyPart" | "muscle" | "equipment";

const FACET_KIND_LABELS = messageRecord<ExerciseFacetKind>({
  all: "calendar.facet.all",
  bodyPart: "calendar.facet.bodyPart",
  muscle: "calendar.facet.muscle",
  equipment: "calendar.facet.equipment"
});

export const EXERCISE_FACET_KINDS: readonly {
  value: ExerciseFacetKind;
  readonly label: string;
}[] = (["all", "bodyPart", "muscle", "equipment"] as const).map((value) => ({
  value,
  get label() {
    return FACET_KIND_LABELS[value];
  }
}));

export type ExerciseBodyPartId =
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "core"
  | "legs"
  | "neck";

/**
 * Which muscles each body part stands for. Reading downward this is also the
 * order the column is drawn in: the torso from the front, then the arms, then
 * the core and the legs, which is how a lifter reads a body.
 */
export const BODY_PART_MUSCLES: Readonly<Record<ExerciseBodyPartId, readonly MuscleId[]>> = {
  chest: ["chest"],
  back: ["lats", "traps", "lowerBack"],
  shoulders: ["shoulders"],
  arms: ["biceps", "triceps", "forearms"],
  core: ["abs", "obliques"],
  legs: ["quads", "hamstrings", "glutes", "adductors", "calves"],
  neck: ["neck"]
};

export const BODY_PART_LABELS: Readonly<Record<ExerciseBodyPartId, string>> = messageRecord({
  chest: "calendar.bodyPart.chest",
  back: "calendar.bodyPart.back",
  shoulders: "calendar.bodyPart.shoulders",
  arms: "calendar.bodyPart.arms",
  core: "calendar.bodyPart.core",
  legs: "calendar.bodyPart.legs",
  neck: "calendar.bodyPart.neck"
});

export const EXERCISE_BODY_PARTS = Object.keys(BODY_PART_MUSCLES) as ExerciseBodyPartId[];

const MUSCLE_BODY_PART = new Map<MuscleId, ExerciseBodyPartId>(
  EXERCISE_BODY_PARTS.flatMap((part) =>
    BODY_PART_MUSCLES[part].map((muscle) => [muscle, part] as const)
  )
);

export const EQUIPMENT_LABELS: Readonly<Record<ExerciseSearchEquipment, string>> = messageRecord({
  bodyweight: "calendar.equipment.bodyweight",
  barbell: "calendar.equipment.barbell",
  dumbbell: "calendar.equipment.dumbbell",
  kettlebell: "calendar.equipment.kettlebell",
  machine: "calendar.equipment.machine",
  cable: "calendar.equipment.cable",
  resistance_band: "calendar.equipment.resistance_band",
  medicine_ball: "calendar.equipment.medicine_ball",
  exercise_ball: "calendar.equipment.exercise_ball",
  suspension: "calendar.equipment.suspension",
  bosu: "calendar.equipment.bosu",
  sled: "calendar.equipment.sled",
  rope: "calendar.equipment.rope"
});

/** The order the equipment column is drawn in: the common bars first. */
export const EXERCISE_EQUIPMENT_ORDER: readonly ExerciseSearchEquipment[] = [
  "bodyweight",
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "cable",
  "resistance_band",
  "medicine_ball",
  "exercise_ball",
  "suspension",
  "bosu",
  "sled",
  "rope"
];

/** The muscle column, in the body's own reading order. */
export const EXERCISE_MUSCLE_ORDER: readonly MuscleId[] = EXERCISE_BODY_PARTS.flatMap(
  (part) => BODY_PART_MUSCLES[part]
);

export interface ExerciseFacets {
  bodyParts: ExerciseBodyPartId[];
  muscles: MuscleId[];
  equipment: ExerciseSearchEquipment[];
}

const EMPTY_FACETS: ExerciseFacets = { bodyParts: [], muscles: [], equipment: [] };

/**
 * Both rule sets are pure functions of the name and the catalog is a few
 * hundred rows re-filtered on every keystroke, so the answer is memoised for
 * the life of the window. The names are COROS's fixed list; they do not
 * change while the app is open.
 */
const cache = new Map<string, ExerciseFacets>();

export function exerciseFacets(name: string): ExerciseFacets {
  if (!name) return EMPTY_FACETS;
  const cached = cache.get(name);
  if (cached) return cached;

  const targets = resolveExerciseTargets(name);
  // Mobility work trains nothing, and `generic` means the provider gave a body
  // region rather than a movement — neither earns a muscle facet.
  const muscles = targets.mobility || targets.generic
    ? []
    : targets.activations.map((entry) => entry.muscle);
  const facets: ExerciseFacets = {
    muscles,
    bodyParts: [...new Set(
      muscles.flatMap((muscle) => {
        const part = MUSCLE_BODY_PART.get(muscle);
        return part ? [part] : [];
      })
    )],
    equipment: classifyWorkoutExerciseName(name).equipment
  };
  cache.set(name, facets);
  return facets;
}

export function muscleLabel(muscle: MuscleId): string {
  return MUSCLE_BY_ID[muscle].label;
}

/** The anatomical name, shown under the muscle's own label. */
export function muscleAnatomy(muscle: MuscleId): string {
  return MUSCLE_BY_ID[muscle].anatomy;
}
