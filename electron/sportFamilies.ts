/**
 * Which sport family a planned session and a recorded activity belong to — the
 * one question the Calendar (`src/calendar/pairing.ts`) and the plan matcher
 * (`buildTrainingActivityMatches`) both ask before calling an activity a
 * session done.
 *
 * A scheduled entry carries a COROS *program* sport code (1 Run, 4 Strength…)
 * and an activity an *activity* code (100 Run, 402 Strength…): two
 * numberings, so the codes are never compared to each other, only the
 * families they resolve into.
 *
 * Node-free: the renderer imports it through `src/training/workoutSport.ts`.
 */
import type { WorkoutSport } from "./types";
import { workoutSportFromType } from "./workoutCapabilities";

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
  const sport = sportType === undefined ? undefined : workoutSportFromType(sportType);
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
