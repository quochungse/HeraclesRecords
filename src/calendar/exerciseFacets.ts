/**
 * The four ways the exercise picker narrows COROS's catalog.
 *
 * Muscles come from COROS where it says them. Each catalog row carries
 * `muscle` (the muscles the movement works hardest) and `muscleRelevance`
 * (every muscle that takes part), as codes from the Training Hub's own muscle
 * table — `COROS_MUSCLES` below reads them. A few rows carry neither, and a
 * caller that is handed only a name has nothing but that name, so those fall
 * back to the two rule sets the app already owns:
 *
 *   - muscles come from `resolveExerciseTargets` (`src/strength/muscles.ts`),
 *     the same rules the Strength body map is drawn from, so a movement is
 *     attributed to the same muscles on both screens;
 *   - equipment always comes from `classifyWorkoutExerciseName`
 *     (`electron/exerciseCatalogSearch.ts`), the same rules the coach's
 *     `search_coros_exercises` tool filters by — COROS files no equipment.
 *
 * A body part is a roll-up of muscles rather than a third rule set, so the
 * two rows of the picker cannot disagree about where a movement belongs. COROS
 * has its own `part` too, and it is deliberately not read: it files a bench
 * press under Chest *and* Arms, which would disagree with the muscle column.
 *
 * A movement nothing recognises carries no facet at all. It is reachable
 * under **All** and by search, and it is deliberately not filed under a
 * guess — a picker that puts a bench press under "Legs" is worse than one
 * that only finds it by name.
 */
import {
  classifyWorkoutExerciseName,
  type ExerciseSearchEquipment
} from "../../electron/exerciseCatalogSearch";
import type { WorkoutExerciseOption } from "../../electron/types";
import { MUSCLE_BY_ID, resolveExerciseTargets, type MuscleId } from "../strength/muscles";
import { messageRecord } from "../i18n/core";
import { EXERCISE_EFFORT, type ExerciseEffort } from "./exerciseEffort";

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
  /**
   * How much of the movement's work each muscle takes — `resolveExerciseTargets`'
   * activation shares, which sum to 1 across a movement. A squat is mostly
   * quads, a leg curl nearly all hamstrings; this is what lets the picker put
   * the movements that load a chosen muscle hardest first.
   */
  loads: Partial<Record<MuscleId, number>>;
  /**
   * How hard the movement works the muscles it names, beyond their share of it:
   * from a stretch or a warm-up drill (`minimal`) to a dip or a pull-up
   * (`heavy`), with a lift that carries an external load between. See
   * `exerciseEffort.ts` for the steps and where each comes from.
   */
  effort: ExerciseEffort;
  equipment: ExerciseSearchEquipment[];
}

/** Equipment that puts an external load on the muscle. */
const LOADED_EQUIPMENT: ReadonlySet<ExerciseSearchEquipment> = new Set([
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "cable",
  "sled"
]);

function isLoadedByName(equipment: readonly ExerciseSearchEquipment[]): boolean {
  return equipment.some((item) => LOADED_EQUIPMENT.has(item));
}

/**
 * COROS's own equipment codes that put a load on the muscle, read off the
 * catalog against the movements filed under each: dumbbells (2), barbells (3),
 * plates (4), cable and pulley (5), gym equipment (6 — machines, but pull-up
 * bars and boxes too, which are a load all the same), kettlebells (11). Bands
 * (9), the ball, rope and rower codes are not.
 */
const COROS_LOADED_EQUIPMENT: ReadonlySet<number> = new Set([2, 3, 4, 5, 6, 11]);
const COROS_BAND_EQUIPMENT = 9;

/** COROS's `targetType`: the movement counts reps. Anything else is held or run for time. */
const COROS_REP_TARGET = 3;

/**
 * Whether COROS describes the movement as lifting a load: equipment that
 * does, or a default working weight (a sled, a wall ball, a weighted twist)
 * — except on a band, whose "weight" is a resistance setting.
 */
function corosLoaded(option: WorkoutExerciseOption): boolean {
  const codes = option.equipmentCodes ?? [];
  if (codes.some((code) => COROS_LOADED_EQUIPMENT.has(code))) return true;
  return (option.defaultLoad ?? 0) > 0 && !codes.includes(COROS_BAND_EQUIPMENT);
}

/**
 * How hard the row works its muscles. A movement `exerciseEffort.ts` places is
 * as placed there — that is the only way to tell a dip from a warm-up, both
 * being bodyweight reps. One it does not place is read off the row: a load is
 * loaded, timed work with none is minimal (a stretch, a roll, a hold), and
 * anything else — reps with no weight — is light. A row that does not say what
 * it counts is never called minimal.
 */
function corosEffort(option: WorkoutExerciseOption): ExerciseEffort {
  const placed = option.corosKey ? EXERCISE_EFFORT[option.corosKey.toUpperCase()] : undefined;
  if (placed) return placed;
  if (corosLoaded(option)) return "loaded";
  return option.targetType !== undefined && option.targetType !== COROS_REP_TARGET
    ? "minimal"
    : "light";
}

const EMPTY_FACETS: ExerciseFacets = {
  bodyParts: [],
  muscles: [],
  loads: {},
  effort: "light",
  equipment: []
};

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
  const loads: Partial<Record<MuscleId, number>> = {};
  if (muscles.length) {
    for (const entry of targets.activations) loads[entry.muscle] = entry.share;
  }
  const { equipment } = classifyWorkoutExerciseName(name);
  const facets: ExerciseFacets = {
    muscles,
    loads,
    effort: targets.mobility ? "minimal" : isLoadedByName(equipment) ? "loaded" : "light",
    bodyParts: [...new Set(
      muscles.flatMap((muscle) => {
        const part = MUSCLE_BODY_PART.get(muscle);
        return part ? [part] : [];
      })
    )],
    equipment
  };
  cache.set(name, facets);
  return facets;
}

/**
 * How hard a movement loads a muscle, or a whole body part (the sum over its
 * muscles). 0 for a movement that does not train it.
 */
export function facetLoad(
  facets: ExerciseFacets,
  kind: "bodyPart" | "muscle",
  value: string
): number {
  if (kind === "muscle") return facets.loads[value as MuscleId] ?? 0;
  const muscles = BODY_PART_MUSCLES[value as ExerciseBodyPartId] ?? [];
  return muscles.reduce((sum, muscle) => sum + (facets.loads[muscle] ?? 0), 0);
}

/**
 * COROS's muscle codes, read off its catalog against movements whose muscle
 * is not in doubt (leg extension 7, hip adduction 9, shrug 11, pull-up 12,
 * back extension 13, hip thrust 14, calf raise 15…). The table the web app
 * labels them from has no hamstrings entry, but a deadlift, a Romanian
 * deadlift and a leg curl are filed under 8 and nothing else. There is no
 * abductor in the body map, so 10 — the hip abductors — is filed with the
 * glutes they are part of.
 */
const COROS_MUSCLES: Readonly<Record<number, MuscleId>> = {
  1: "shoulders",
  2: "chest",
  3: "biceps",
  4: "triceps",
  5: "forearms",
  6: "abs",
  7: "quads",
  8: "hamstrings",
  9: "adductors",
  10: "glutes",
  11: "traps",
  12: "lats",
  13: "lowerBack",
  14: "glutes",
  15: "calves"
};

/** What a muscle COROS names as a primary mover counts, against an involved one. */
const PRIMARY_WEIGHT = 1;
const INVOLVED_WEIGHT = 0.5;

function facetsFromMuscles(
  loads: Partial<Record<MuscleId, number>>,
  effort: ExerciseEffort,
  equipment: ExerciseSearchEquipment[]
): ExerciseFacets {
  const muscles = Object.keys(loads) as MuscleId[];
  return {
    muscles,
    loads,
    effort,
    bodyParts: [...new Set(
      muscles.flatMap((muscle) => {
        const part = MUSCLE_BODY_PART.get(muscle);
        return part ? [part] : [];
      })
    )],
    equipment
  };
}

const optionCache = new WeakMap<WorkoutExerciseOption, ExerciseFacets>();

/**
 * An option's facets. Everything comes from the catalog row COROS sent — its
 * muscles (a primary mover weighs more than one that only takes part), its
 * equipment and default weight, and whether it counts reps or holds for time —
 * and the name is read only for a row COROS lists no muscles for, which has
 * nothing else to go on. The equipment *filter* still reads the name: COROS's
 * codes are coarser than the picker's thirteen kinds.
 */
export function optionFacets(option: WorkoutExerciseOption, name: string): ExerciseFacets {
  const cached = optionCache.get(option);
  if (cached) return cached;

  const weights: Partial<Record<MuscleId, number>> = {};
  const take = (codes: readonly number[] | undefined, weight: number) => {
    for (const code of codes ?? []) {
      const muscle = COROS_MUSCLES[code];
      if (muscle) weights[muscle] = Math.max(weights[muscle] ?? 0, weight);
    }
  };
  take(option.involvedMuscles, INVOLVED_WEIGHT);
  take(option.primaryMuscles, PRIMARY_WEIGHT);

  // A muscle's load is its share of the movement's work, as the name rules
  // state it: the activations sum to 1. A lateral raise that is all shoulder
  // is 1; a press that leans on the triceps is two thirds shoulder.
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const loads: Partial<Record<MuscleId, number>> = {};
  for (const [muscle, weight] of Object.entries(weights) as [MuscleId, number][]) {
    loads[muscle] = weight / total;
  }

  const facets = total > 0
    ? facetsFromMuscles(loads, corosEffort(option), classifyWorkoutExerciseName(name).equipment)
    : exerciseFacets(name);
  optionCache.set(option, facets);
  return facets;
}

/**
 * What each step of effort does to the ranking, on top of the share of the
 * movement's work that lands on the muscle (at most 1). A lift with an external
 * load is worth half a share more: a seated dumbbell press (two thirds
 * shoulder) is what "shoulders" means to someone choosing a lift, before a
 * handstand that is all shoulder — and a loaded movement that only assists the
 * muscle (a cable row, for the biceps) still ranks below a plain one that is
 * mostly about it. A dip or a pull-up is worth more than a loaded lift, since
 * the whole body is the weight. Moderate bodyweight work sits between plain and
 * loaded, and minimal work (a warm-up, a stretch) is scaled down instead,
 * because no bonus could be small enough to keep it below real training.
 */
const EFFORT_BONUS: Readonly<Record<ExerciseEffort, number>> = {
  minimal: 0,
  light: 0,
  moderate: 0.25,
  loaded: 0.5,
  heavy: 0.75
};
const MINIMAL_FACTOR = 0.25;

/**
 * What the picker sorts by once a muscle or body part is chosen: how much of
 * the movement's work lands there (`facetLoad`) and how hard the movement
 * works it (`EFFORT_BONUS`). 0 for a movement that does not train it. Only the
 * order matters, never the figure.
 */
export function facetRank(
  facets: ExerciseFacets,
  kind: "bodyPart" | "muscle",
  value: string
): number {
  const load = facetLoad(facets, kind, value);
  if (load <= 0) return 0;
  if (facets.effort === "minimal") return load * MINIMAL_FACTOR;
  return load + EFFORT_BONUS[facets.effort];
}

export function muscleLabel(muscle: MuscleId): string {
  return MUSCLE_BY_ID[muscle].label;
}

/** The anatomical name, shown under the muscle's own label. */
export function muscleAnatomy(muscle: MuscleId): string {
  return MUSCLE_BY_ID[muscle].anatomy;
}
