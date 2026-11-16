import type { WorkoutSport } from "../../electron/types";
import {
  workoutSportFromType
} from "../../electron/workoutCapabilities";
import { inferUpcomingWorkoutCategory, workoutCategoryLabel } from "./formatters";
import type { SportColorCategory } from "./sportColors";
import { t } from "../i18n/core";

/**
 * A scheduled workout carries a COROS *program* sport code (1–9), which is a
 * different numbering from the activity codes `sportColorCategory` reads — 2 is
 * Bike as a program and nothing at all as an activity. Passing one to the other
 * silently answers "other", so every calendar surface that needs a scheduled
 * entry's sport resolves it here instead, through the same capability table the
 * workout editor writes with.
 *
 * This module stays free of React and of `lucide-react`: it is the arithmetic
 * of "which sport is this", which a test can reach, and the icons that go with
 * a sport live in `src/calendar/workoutSportIcons` beside the component that
 * draws them.
 */
export const WORKOUT_SPORT_COLOR_CATEGORY: Record<
  WorkoutSport,
  SportColorCategory
> = {
  run: "run",
  trailRun: "run",
  bike: "bike",
  swim: "swim",
  strength: "strength",
  hyrox: "other",
  indoorClimb: "other",
  bouldering: "other",
  xcSki: "other"
};

/** The `WorkoutSport` a scheduled entry's program sport code names, if any. */
export function scheduledWorkoutSport(
  sportType: number | undefined
): WorkoutSport | undefined {
  return sportType === undefined ? undefined : workoutSportFromType(sportType);
}

/**
 * The sport colour category for a scheduled entry. `undefined` when COROS sent
 * no usable sport code, so a caller can fall back rather than paint every
 * unknown workout with the "other" colour.
 */
export function scheduledSportCategory(
  sportType: number | undefined
): SportColorCategory | undefined {
  const sport = scheduledWorkoutSport(sportType);
  return sport ? WORKOUT_SPORT_COLOR_CATEGORY[sport] : undefined;
}

/** COROS's own name for a program sport code, e.g. "Bike" for 2. */
export function workoutSportLabel(sport: WorkoutSport): string {
  return t(`workout.sport.${sport}`);
}

export {
  activitySportFamily,
  scheduledSportFamily,
  sportFamiliesCompatible,
  type SportFamily
} from "../../electron/sportFamilies";

/** The two program sports whose name classifier has anything to say. */
const RUN_SPORTS: ReadonlySet<WorkoutSport> = new Set(["run", "trailRun"]);

/**
 * The tag a planned workout wears — on the calendar chip, on Overview's
 * upcoming list, on its Today card.
 *
 * `inferUpcomingWorkoutCategory` reads a workout's *name* for a running
 * intent — Easy, Long, Intervals, Speed, Race — and answers "Run" for
 * everything it does not recognise, which is every strength session, ride and
 * swim, and every workout named in a language other than English. Those all
 * wore a "Run" badge on Overview.
 *
 * So the sport code is asked first: a workout that is not a run is tagged with
 * its own sport, and only a run is passed to the classifier, which is the one
 * thing it was written to read. An entry with no sport code whose name says
 * nothing gets no tag at all — a wrong label is worse than a missing one.
 */
export function planTag(workout: {
  name?: string;
  sportType?: number;
}): string | undefined {
  const sport = scheduledWorkoutSport(workout.sportType);

  if (sport && !RUN_SPORTS.has(sport)) {
    return workoutSportLabel(sport);
  }

  const category = inferUpcomingWorkoutCategory(workout.name ?? "");
  if (category !== "Run") {
    return workoutCategoryLabel(category);
  }
  // "Run" is the classifier's default as well as a real answer, so it only
  // stands when COROS said the sport really is running.
  return sport ? workoutSportLabel(sport) : undefined;
}

/**
 * Whether a sport's steps read as a list of exercises rather than a timeline.
 *
 * Both COROS sports whose steps name a movement out of the exercise catalog —
 * Strength and HYROX — answer yes, which is the same pair
 * `useWorkoutExerciseCatalog` fetches for. The question was spelled out by hand
 * in three places and two of them disagreed: the Calendar's read-only view drew
 * a HYROX session as exercise cards while the day drawer drew the same session
 * as a magnitude bar, so the two surfaces named the same workout differently
 * and only one of them could reach the demonstration clips.
 */
export function isStrengthStyleWorkout(
  sport: WorkoutSport | undefined
): sport is "strength" | "hyrox" {
  return sport === "strength" || sport === "hyrox";
}
