/**
 * What Heracles Training Load needs to know about a movement that its sets do
 * not say, by COROS key. A movement not listed is read from its sets: weighted
 * when any set of it ever carried a weight, bodyweight otherwise.
 *
 * - `load`: the weight on the bar is the load (`bodyShare` adds a part of the
 *   athlete, for a weighted squat or lunge);
 * - `bodyweight`: the load is `bodyShare` × body weight, plus any weight added.
 *   `repsAtBodyweight` is what a 70 kg recreational adult manages with body
 *   weight alone, the capacity used before the athlete has a history of it;
 * - `hold`: timed, scored by the hold against `maxHoldSec`;
 * - `plyo`: drills, jumps, skipping — heart rate measures these, so COROS's
 *   figure stands and their time counts as time between sets;
 * - `skip`: rest, stretching, cool-down — time between sets.
 *
 * Body shares are the part of the body the working muscles move, from force
 * plates (Ebben et al. 2011, push-up variations) or from segment masses
 * (de Leva 1996): a dip or a pull-up moves all but the forearms and hands
 * (0.95), a squat all but the shanks and feet (0.88). Keys and names were read
 * off the COROS catalogue (`src/calendar/exerciseReview.ts`) and the sessions
 * the formula was checked on.
 */

export type HeraclesExerciseKind = "load" | "bodyweight" | "hold" | "plyo" | "skip";

export interface HeraclesExerciseFactor {
  kind: HeraclesExerciseKind;
  /** Share of body weight inside the load. */
  bodyShare?: number;
  /** Reps a 70 kg recreational adult manages at body weight alone. */
  repsAtBodyweight?: number;
  /** A hard hold for a recreational adult, in seconds. */
  maxHoldSec?: number;
}

/** Raised with any change to the tables, so the service recomputes. */
export const HERACLES_FACTORS_VERSION = 2;

export const HERACLES_EXERCISE_FACTORS: Readonly<Record<string, HeraclesExerciseFactor>> = {
  // Bodyweight on a bar or a station.
  T1002: { kind: "bodyweight", bodyShare: 0.95, repsAtBodyweight: 6 }, // Pull Ups
  T1330: { kind: "bodyweight", bodyShare: 0.95, repsAtBodyweight: 3 }, // Archer Pull Up
  T1051: { kind: "bodyweight", bodyShare: 0.95, repsAtBodyweight: 10 }, // Parallel Bar Dips
  T1340: { kind: "bodyweight", bodyShare: 0.6, repsAtBodyweight: 15 }, // Supine Pull Ups (inverted row)
  T1032: { kind: "bodyweight", bodyShare: 0.4, repsAtBodyweight: 12 }, // Hanging Leg Raise
  T1159: { kind: "bodyweight", bodyShare: 0.4, repsAtBodyweight: 10 }, // Leg Raise Toe To Bar
  T1034: { kind: "bodyweight", bodyShare: 0.35, repsAtBodyweight: 15 }, // Incline Leg Raise
  T1035: { kind: "bodyweight", bodyShare: 0.35, repsAtBodyweight: 15 }, // Upright Leg Raise
  T1038: { kind: "bodyweight", bodyShare: 0.3, repsAtBodyweight: 20 }, // Seated Leg Raise

  // Push-ups.
  T1148: { kind: "bodyweight", bodyShare: 0.64, repsAtBodyweight: 15 }, // Plank Push Up

  // Legs.
  T1061: { kind: "load", bodyShare: 0.88, repsAtBodyweight: 40 }, // Squats
  T1064: { kind: "load", bodyShare: 0.88, repsAtBodyweight: 25 }, // Lunges
  T1067: { kind: "load", bodyShare: 0.6 },
  T1152: { kind: "bodyweight", bodyShare: 0.88, repsAtBodyweight: 25 }, // Lunge Down
  T1164: { kind: "load", bodyShare: 0.88, repsAtBodyweight: 20 }, // Split Bench Squat
  T1188: { kind: "bodyweight", bodyShare: 0.88, repsAtBodyweight: 30 }, // Curtsey Squat
  T1217: { kind: "bodyweight", bodyShare: 0.88, repsAtBodyweight: 30 }, // Lateral Squats
  T1226: { kind: "bodyweight", bodyShare: 0.88, repsAtBodyweight: 25 }, // Reverse Lunge
  T1295: { kind: "load", bodyShare: 0.88, repsAtBodyweight: 40 }, // Sumo Squat
  T1275: { kind: "load", bodyShare: 0.97, repsAtBodyweight: 20 }, // Single Leg Calf Raise
  T1033: { kind: "bodyweight", bodyShare: 0.5, repsAtBodyweight: 30 }, // Bridge

  // Trunk.
  T1243: { kind: "bodyweight", bodyShare: 0.15, repsAtBodyweight: 60 }, // Dead Bug
  T1150: { kind: "bodyweight", bodyShare: 0.15, repsAtBodyweight: 60 }, // Bird Dog
  T1076: { kind: "bodyweight", bodyShare: 0.3, repsAtBodyweight: 40 }, // Bicycle Crunches

  // Holds.
  T1010: { kind: "hold", maxHoldSec: 120 }, // Planks
  T1185: { kind: "hold", maxHoldSec: 75 }, // Side Plank
  T1229: { kind: "hold", maxHoldSec: 120 }, // Glute Bridge Hold
  T1349: { kind: "hold", maxHoldSec: 90 }, // Exercise Ball Plank
  T1368: { kind: "hold", maxHoldSec: 45 }, // Copenhagen Plank
  T1211: { kind: "hold", maxHoldSec: 45 }, // V Sit Hold

  // Drills and jumps: heart rate measures them.
  T1005: { kind: "plyo" }, // Skipping Rope
  T1013: { kind: "plyo" }, // High Knees
  T1014: { kind: "plyo" }, // Box Jumps
  T1060: { kind: "plyo" }, // Step Up Jumps
  T1077: { kind: "plyo" }, // Plank Jacks
  T1078: { kind: "plyo" }, // Squat Jumps
  T1131: { kind: "plyo" }, // Run Fast Frequency At A Fast Pace
  T1136: { kind: "plyo" }, // Jumping Lunges
  T1144: { kind: "plyo" }, // One Leg Deadlifts And Knee Lifting
  T1212: { kind: "plyo" }, // A Skips
  T1259: { kind: "plyo" }, // Plank Jacks 2
  T1260: { kind: "plyo" }, // Straight Leg Hops
  T1393: { kind: "plyo" }, // Skierg
  T1396: { kind: "plyo" }, // Burpee broad jumps

  // Rest, stretching, cool-down.
  T1122: { kind: "skip" }, // Cool Down
  T1123: { kind: "skip" }, // Rest
  T1132: { kind: "skip" }, // Lie On Your Back A Hip
  T1215: { kind: "skip" }, // Back Stretch
  T1248: { kind: "skip" }, // Thoracic Spine Rotation
  T1262: { kind: "skip" } // Greatest Stretch
};

/**
 * A movement with no COROS key — a Hevy template — read by its name, as the
 * Exercises Library reads one. Most reuse the factor of the COROS movement they
 * are, so a pull-up moves 0.95 of the body whichever app logged it; push-up
 * variations take Ebben et al. 2011's own shares. Matched against the name
 * lowercased with punctuation as spaces ("Pull Up (Assisted)" → "pull up
 * assisted"), the first pattern that matches winning. A name none matches is
 * read from its sets.
 */
const NAMED_FACTORS: readonly [RegExp, HeraclesExerciseFactor][] = [
  // Before "pull up", which "australian pull up" also matches.
  [/\binverted rows?\b|\baustralian pull ?ups?\b/, HERACLES_EXERCISE_FACTORS.T1340],
  [/\bmuscle ?ups?\b/, HERACLES_EXERCISE_FACTORS.T1330],
  [/\b(pull|chin) ?ups?\b/, HERACLES_EXERCISE_FACTORS.T1002],
  // A bench dip keeps the feet on the floor, a machine carries the body: read from their sets.
  [/^(?!.*\b(bench|machine)\b).*\bdips?\b/, HERACLES_EXERCISE_FACTORS.T1051],
  [/\bknee push ?ups?\b/, { kind: "bodyweight", bodyShare: 0.49, repsAtBodyweight: 25 }],
  [/\bincline push ?ups?\b/, { kind: "bodyweight", bodyShare: 0.41, repsAtBodyweight: 25 }],
  [/\bdecline push ?ups?\b/, { kind: "bodyweight", bodyShare: 0.7, repsAtBodyweight: 12 }],
  [/\bpush ?ups?\b/, HERACLES_EXERCISE_FACTORS.T1148],
  [/\btoes? to bar\b/, HERACLES_EXERCISE_FACTORS.T1159],
  [/\bhanging leg raises?\b/, HERACLES_EXERCISE_FACTORS.T1032],
  [/\bleg raises?\b/, HERACLES_EXERCISE_FACTORS.T1034],
  // Jumps before the squats and lunges they are named after.
  [/\b(jump squats?|squat jumps?)\b/, HERACLES_EXERCISE_FACTORS.T1078],
  [/\bjumping lunges?\b/, HERACLES_EXERCISE_FACTORS.T1136],
  [/\bbox jumps?\b/, HERACLES_EXERCISE_FACTORS.T1014],
  [/\b(jump rope|skipping)\b/, HERACLES_EXERCISE_FACTORS.T1005],
  [/\bhigh knees?\b/, HERACLES_EXERCISE_FACTORS.T1013],
  [/\bburpees?\b/, HERACLES_EXERCISE_FACTORS.T1396],
  [/\bsplit squats?\b/, HERACLES_EXERCISE_FACTORS.T1164],
  // The body moves under the bar too; a machine (hack, leg press) carries it.
  [/^(?!.*\b(machine|hack|smith|press)\b).*\bsquats?\b/, HERACLES_EXERCISE_FACTORS.T1061],
  [/^(?!.*\bmachine\b).*\blunges?\b/, HERACLES_EXERCISE_FACTORS.T1064],
  [/\bsingle leg (standing )?calf raises?\b/, HERACLES_EXERCISE_FACTORS.T1275],
  [/\bglute bridges?\b/, HERACLES_EXERCISE_FACTORS.T1033],
  [/\bdead ?bugs?\b/, HERACLES_EXERCISE_FACTORS.T1243],
  [/\bbird ?dogs?\b/, HERACLES_EXERCISE_FACTORS.T1150],
  [/\bbicycle crunch(es)?\b/, HERACLES_EXERCISE_FACTORS.T1076],
  [/\bcopenhagen\b/, HERACLES_EXERCISE_FACTORS.T1368],
  [/\bplank jacks?\b/, HERACLES_EXERCISE_FACTORS.T1077],
  [/\bside plank\b/, HERACLES_EXERCISE_FACTORS.T1185],
  [/\bplank\b/, HERACLES_EXERCISE_FACTORS.T1010],
  [/\bstretch(es|ing)?\b/, HERACLES_EXERCISE_FACTORS.T1215]
];

export function heraclesFactorByName(name: string): HeraclesExerciseFactor | undefined {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return NAMED_FACTORS.find(([pattern]) => pattern.test(words))?.[1];
}
