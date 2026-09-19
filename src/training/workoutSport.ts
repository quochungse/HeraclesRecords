import type { WorkoutSport } from "../../electron/types";
import {
  WORKOUT_SPORT_CAPABILITIES,
  workoutSportFromType
} from "../../electron/workoutCapabilities";
import { inferUpcomingWorkoutCategory } from "./formatters";
import type { SportColorCategory } from "./sportColors";

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
  trailRun: "trail",
  bike: "bike",
  swim: "other",
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
  return WORKOUT_SPORT_CAPABILITIES[sport].label;
}

/**
 * Sport families, for deciding whether a planned workout and a recorded
 * activity could be the same session.
 *
 * The five-colour `SportColorCategory` cannot answer that question: it folds
 * swim, climbing, rowing, yoga and every unmapped code into one `other` bucket,
 * so a prescribed swim and a yoga class read as the same thing. COROS's own
 * activity codes are grouped by hundred, and that grouping is the answer —
 * 100–105 is the run family, 200s ride, 300s swim, and so on.
 *
 * `undefined` means "this code is not one we have grouped", which has to stay
 * distinct from "a different sport": an unknown code can never rule a pairing
 * out, or a new COROS activity type would silently stop matching its plan.
 */
export type SportFamily =
  | "run"
  | "walk"
  | "bike"
  | "swim"
  | "strength"
  | "climb"
  | "ski";

const WORKOUT_SPORT_FAMILY: Record<WorkoutSport, SportFamily> = {
  run: "run",
  trailRun: "run",
  bike: "bike",
  swim: "swim",
  strength: "strength",
  hyrox: "strength",
  indoorClimb: "climb",
  bouldering: "climb",
  xcSki: "ski"
};

/** COROS activity codes, grouped. Anything unlisted answers `undefined`. */
const ACTIVITY_SPORT_FAMILY: Readonly<Record<number, SportFamily>> = {
  100: "run", //  Run
  101: "run", //  Indoor Run
  102: "run", //  Trail Run
  103: "run", //  Track Run
  104: "run", //  Hike
  105: "run", //  Mountain Climb
  106: "climb", // Climb
  200: "bike",
  201: "bike",
  202: "bike",
  203: "bike",
  204: "bike",
  205: "bike",
  299: "bike",
  300: "swim", // Pool Swim
  301: "swim", // Open Water Swim
  400: "strength", // Gym Cardio
  401: "strength", // GPS Cardio
  402: "strength", // Strength
  500: "ski",
  501: "ski",
  502: "ski", // XC Ski
  503: "ski", // Ski Touring
  800: "climb", // Indoor Climb
  801: "climb", // Bouldering
  802: "climb", // Outdoor Climb
  900: "walk",
  902: "walk", //  Climb Stairs
  1200: "strength", // Hybrid Fitness
  9901: "strength", // Custom Indoor Strength
  10002: "ski", //   Ski Touring
  10003: "climb" //  Multi-Pitch Climb
};

/** The family a scheduled entry's program sport code belongs to. */
export function scheduledSportFamily(
  sportType: number | undefined
): SportFamily | undefined {
  const sport = scheduledWorkoutSport(sportType);
  return sport ? WORKOUT_SPORT_FAMILY[sport] : undefined;
}

/** The family a completed activity's COROS sport code belongs to. */
export function activitySportFamily(
  sportType: number | undefined
): SportFamily | undefined {
  return sportType === undefined ? undefined : ACTIVITY_SPORT_FAMILY[sportType];
}

/**
 * Whether a plan in one family could have been satisfied by a session in
 * another. An unknown family on either side is never a refusal.
 */
export function sportFamiliesCompatible(
  planned: SportFamily | undefined,
  actual: SportFamily | undefined
): boolean {
  if (!planned || !actual || planned === actual) {
    return true;
  }
  // A prescribed easy or recovery run is often walked, and COROS records that
  // as a Walk. The reverse holds for a walk logged as a slow run.
  return (
    (planned === "run" && actual === "walk") ||
    (planned === "walk" && actual === "run")
  );
}

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
    return category;
  }
  // "Run" is the classifier's default as well as a real answer, so it only
  // stands when COROS said the sport really is running.
  return sport ? workoutSportLabel(sport) : undefined;
}
