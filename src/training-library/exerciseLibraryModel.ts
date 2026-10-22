/**
 * The arithmetic of the Exercises Library tab, out of the view for the reason
 * `activityFilters.ts` sits outside `ActivitiesView`: it is the only part a
 * suite can reach.
 *
 * A row is a movement of COROS's own catalog — Strength or Hybrid Fitness,
 * the two sports COROS keeps one for. Everything said about it comes from
 * `optionFacets`, the reading the exercise picker already makes: its muscles
 * and their shares of the work, its body parts, its equipment and how hard
 * it loads what it works. Nothing here reads a figure off the catalog row
 * that only means something when a workout is being built (a default target,
 * a rest), because this screen is for reading, not building.
 *
 * Two filters, not three lists: the body, which is one hierarchy — a body
 * part is a roll-up of muscles, so picking a muscle is narrowing a part — and
 * the equipment.
 */
import type { ExerciseSearchEquipment } from "../../electron/exerciseCatalogSearch";
import type { WorkoutExerciseOption } from "../../electron/types";
import {
  BODY_PART_MUSCLES,
  EXERCISE_BODY_PARTS,
  EXERCISE_EQUIPMENT_ORDER,
  bodyPartOf,
  facetRank,
  optionFacets,
  type ExerciseBodyPartId,
  type ExerciseFacets
} from "../calendar/exerciseFacets";
import type { MuscleId } from "../strength/muscles";

/** The two sports COROS keeps a movement catalog for. */
export type ExerciseLibrarySport = "strength" | "hyrox";
export const EXERCISE_LIBRARY_SPORTS: readonly ExerciseLibrarySport[] = ["strength", "hyrox"];

export interface LibraryExercise {
  id: string;
  name: string;
  option: WorkoutExerciseOption;
  facets: ExerciseFacets;
  /** The muscles that take the largest share of the work. */
  primary: MuscleId[];
  /** Every other muscle the movement works, largest share first. */
  involved: MuscleId[];
  /** Where most of the work lands, summed over each part's muscles. */
  mainPart?: ExerciseBodyPartId;
  /** The other parts it works, most first. */
  otherParts: ExerciseBodyPartId[];
}

/**
 * Within this much of the top share a muscle is a prime mover. COROS's own
 * rows weigh a primary muscle at twice an involved one, so their shares are
 * either equal or far apart; the tolerance is for the name rules, whose
 * shares are written to two places.
 */
const PRIMARY_SHARE_TOLERANCE = 0.02;

function describe(option: WorkoutExerciseOption, name: string): LibraryExercise {
  const facets = optionFacets(option, name);
  const shares = (Object.entries(facets.loads) as [MuscleId, number][])
    .filter(([, share]) => share > 0)
    .sort((left, right) => right[1] - left[1]);
  const top = shares[0]?.[1] ?? 0;
  const primary = shares.filter(([, share]) => share >= top - PRIMARY_SHARE_TOLERANCE).map(([muscle]) => muscle);
  const involved = shares.filter(([, share]) => share < top - PRIMARY_SHARE_TOLERANCE).map(([muscle]) => muscle);

  const byPart = new Map<ExerciseBodyPartId, number>();
  for (const [muscle, share] of shares) {
    const part = bodyPartOf(muscle);
    if (part) byPart.set(part, (byPart.get(part) ?? 0) + share);
  }
  const parts = [...byPart.entries()]
    .sort((left, right) => right[1] - left[1] || EXERCISE_BODY_PARTS.indexOf(left[0]) - EXERCISE_BODY_PARTS.indexOf(right[0]))
    .map(([part]) => part);

  return {
    id: option.id,
    name,
    option,
    facets,
    primary,
    involved,
    ...(parts[0] ? { mainPart: parts[0] } : {}),
    otherParts: parts.slice(1)
  };
}

/**
 * The catalog as rows, one per movement, in name order — the one order every
 * row carries in its first paint. COROS's catalog can list one movement twice
 * under two ids for two sports; within a sport an id is one row.
 */
export function libraryExercises(
  options: readonly WorkoutExerciseOption[],
  nameOf: (option: WorkoutExerciseOption) => string,
  locale?: string
): LibraryExercise[] {
  const seen = new Set<string>();
  const rows: LibraryExercise[] = [];
  for (const option of options) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    const name = nameOf(option).trim();
    if (!name) continue;
    rows.push(describe(option, name));
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name, locale));
}

export interface ExerciseLibraryFilter {
  query: string;
  favoritesOnly: boolean;
  favorites: ReadonlySet<string>;
  equipment: ExerciseSearchEquipment | null;
  /** A body part, or the part a chosen muscle belongs to. */
  part: ExerciseBodyPartId | null;
  muscle: MuscleId | null;
}

export const NO_EXERCISE_FILTER: ExerciseLibraryFilter = {
  query: "",
  favoritesOnly: false,
  favorites: new Set(),
  equipment: null,
  part: null,
  muscle: null
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Everything but the body: what the body control's counts are taken over. */
function beforeBody(list: readonly LibraryExercise[], filter: ExerciseLibraryFilter): LibraryExercise[] {
  const term = normalize(filter.query);
  return list.filter((exercise) =>
    (!filter.favoritesOnly || filter.favorites.has(exercise.id))
    && (!filter.equipment || exercise.facets.equipment.includes(filter.equipment))
    && (!term || normalize(exercise.name).includes(term))
  );
}

/** Everything but the equipment: what the equipment menu's counts are taken over. */
function beforeEquipment(list: readonly LibraryExercise[], filter: ExerciseLibraryFilter): LibraryExercise[] {
  return narrowExercises(list, { ...filter, equipment: null });
}

function worksPart(exercise: LibraryExercise, part: ExerciseBodyPartId): boolean {
  return exercise.facets.bodyParts.includes(part);
}

function worksMuscle(exercise: LibraryExercise, muscle: MuscleId): boolean {
  return exercise.facets.muscles.includes(muscle);
}

/**
 * The rows the filter leaves, in their order: name order, unless a part or a
 * muscle is chosen, which puts the movements that load it hardest first —
 * the picker's own `facetRank`, so the two never disagree about what
 * "shoulders" means. The sort is stable, so equal ranks keep name order.
 */
export function narrowExercises(
  list: readonly LibraryExercise[],
  filter: ExerciseLibraryFilter
): LibraryExercise[] {
  const rows = beforeBody(list, filter);
  if (filter.muscle) {
    const muscle = filter.muscle;
    const rank = new Map(rows.map((row) => [row, facetRank(row.facets, "muscle", muscle)]));
    return rows.filter((row) => worksMuscle(row, muscle)).sort((a, b) => rank.get(b)! - rank.get(a)!);
  }
  if (filter.part) {
    const part = filter.part;
    const rank = new Map(rows.map((row) => [row, facetRank(row.facets, "bodyPart", part)]));
    return rows.filter((row) => worksPart(row, part)).sort((a, b) => rank.get(b)! - rank.get(a)!);
  }
  return rows;
}

export interface BodyCounts {
  /** Every row the body control can narrow from. */
  total: number;
  parts: ReadonlyMap<ExerciseBodyPartId, number>;
  muscles: ReadonlyMap<MuscleId, number>;
}

/**
 * How many rows each part and muscle would leave, under the rest of the
 * filter — so a count is never a promise of rows the athlete cannot reach
 * from where they are.
 */
export function bodyCounts(list: readonly LibraryExercise[], filter: ExerciseLibraryFilter): BodyCounts {
  const rows = beforeBody(list, filter);
  const parts = new Map<ExerciseBodyPartId, number>();
  const muscles = new Map<MuscleId, number>();
  for (const part of EXERCISE_BODY_PARTS) {
    parts.set(part, rows.filter((row) => worksPart(row, part)).length);
    for (const muscle of BODY_PART_MUSCLES[part]) {
      muscles.set(muscle, rows.filter((row) => worksMuscle(row, muscle)).length);
    }
  }
  return { total: rows.length, parts, muscles };
}

/**
 * The equipment the catalog uses, in the picker's order, each with the rows
 * it would leave. Equipment no movement here uses is not offered at all.
 */
export function equipmentCounts(
  list: readonly LibraryExercise[],
  filter: ExerciseLibraryFilter
): Array<{ equipment: ExerciseSearchEquipment; count: number }> {
  const rows = beforeEquipment(list, filter);
  const used = new Set(list.flatMap((row) => row.facets.equipment));
  return EXERCISE_EQUIPMENT_ORDER
    .filter((equipment) => used.has(equipment))
    .map((equipment) => ({
      equipment,
      count: rows.filter((row) => row.facets.equipment.includes(equipment)).length
    }));
}

export interface MuscleShare {
  muscle: MuscleId;
  /** Its share of the movement's work, 0–1; the shares sum to 1. */
  share: number;
  primary: boolean;
}

/** Where the work goes, largest share first. */
export function muscleShares(exercise: LibraryExercise): MuscleShare[] {
  return [...exercise.primary, ...exercise.involved].map((muscle) => ({
    muscle,
    share: exercise.facets.loads[muscle] ?? 0,
    primary: exercise.primary.includes(muscle)
  }));
}

/** Where a movement's effort sits on the four steps the reader draws; 0 for a loaded lift, whose weight decides. */
export function effortStep(exercise: LibraryExercise): number {
  switch (exercise.facets.effort) {
    case "minimal": return 1;
    case "light": return 2;
    case "moderate": return 3;
    case "heavy": return 4;
    default: return 0;
  }
}

/**
 * The body control's state after a muscle is picked. A muscle carries its
 * part with it, so the control can say "Legs › Glutes"; picking the muscle
 * already chosen steps back up to its part.
 */
export function pickMuscle(
  filter: Pick<ExerciseLibraryFilter, "part" | "muscle">,
  muscle: MuscleId | null
): Pick<ExerciseLibraryFilter, "part" | "muscle"> {
  if (!muscle || filter.muscle === muscle) return { part: filter.part, muscle: null };
  return { part: bodyPartOf(muscle) ?? filter.part, muscle };
}
