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

/** Raised with any change to the table, so the service recomputes. */
export const HERACLES_FACTORS_VERSION = 1;

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
