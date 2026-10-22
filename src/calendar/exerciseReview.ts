/**
 * What COROS's catalog does not say about a movement, stated per movement.
 *
 * A catalog row names its muscles and its equipment as codes, and those codes
 * are read as they are (`exerciseFacets.ts`). Two things they cannot say:
 *
 *   - **muscles COROS has no code for.** Its muscle table runs 1–15 with no
 *     obliques and no neck, so a side plank is filed under 6 with the crunches
 *     and a neck harness under the traps. Read as sent, no movement worked
 *     either muscle;
 *   - **equipment its codes misfile.** A TRX is filed under the cable stack
 *     (5), a battle rope and a sled under "Others" (16), a hex bar deadlift
 *     under "Others" too, and a pull-up bar under gym equipment with no word
 *     that the movement is bodyweight.
 *
 * Both used to be read off the movement's name, and a name is not a
 * description: "Bicycle Crunches" says nothing of the obliques, "Romanian
 * Deadlift" nothing of the hamstrings. So each is decided here, **per movement,
 * by its COROS key**, as `exerciseEffort.ts` decides effort. A movement not
 * listed is exactly as COROS sends it. Keys and names were read off the live
 * catalog on 2026-10-22 (382 Strength movements).
 *
 * `muscles` sets a muscle's role, over whatever COROS said of it: `primary`
 * weighs as a muscle COROS lists in `muscle`, `involved` as one it lists only
 * in `muscleRelevance`. Where the obliques lead a movement COROS files under 6
 * alone, the abs step down to involved. `equipment` replaces COROS's codes
 * whole.
 */
import type { MuscleId } from "../strength/muscles";
import type { ExerciseEquipment } from "./exerciseFacets";

export type ReviewedRole = "primary" | "involved";

export interface ExerciseReview {
  muscles?: Partial<Record<MuscleId, ReviewedRole>>;
  equipment?: readonly ExerciseEquipment[];
}

/** The obliques lead and the rest of the abdominal wall assists. */
const OBLIQUES_LEAD: ExerciseReview["muscles"] = { obliques: "primary", abs: "involved" };
/** The obliques work as hard as the abs. */
const OBLIQUES_WITH_ABS: ExerciseReview["muscles"] = { obliques: "primary" };
/** The obliques hold the trunk still against a rotation or a sideways pull. */
const OBLIQUES_STEADY: ExerciseReview["muscles"] = { obliques: "involved" };
/** COROS files the neck under the traps, which only assist. */
const NECK: ExerciseReview["muscles"] = { neck: "primary", traps: "involved" };

/** Bodyweight on a bar, a bench or a station COROS calls gym equipment. */
const BODYWEIGHT_ON_A_STATION: readonly ExerciseEquipment[] = ["bodyweight", "machine"];

export const EXERCISE_REVIEW: Readonly<Record<string, ExerciseReview>> = {
  // Side bends, twists, side planks, windmills and woodchops: the obliques lead
  T1011: { muscles: OBLIQUES_LEAD }, // Dumbbell Side Bends
  T1039: { muscles: OBLIQUES_LEAD }, // Trunk Rotations
  T1040: { muscles: OBLIQUES_LEAD }, // Oblique V Ups
  T1143: { muscles: OBLIQUES_LEAD }, // Side Bridge Wing Arm And Swing Leg
  T1145: { muscles: OBLIQUES_LEAD }, // Trunk Rotations
  T1146: { muscles: OBLIQUES_LEAD }, // Alternate Heel Touchers
  T1156: { muscles: OBLIQUES_LEAD }, // Windshield Wiper
  T1162: { muscles: OBLIQUES_LEAD }, // Side Plank Rotation
  T1171: { muscles: OBLIQUES_LEAD, equipment: BODYWEIGHT_ON_A_STATION }, // Hanging Windshield Wiper
  T1173: { muscles: OBLIQUES_LEAD }, // Lower Oblique Load Roll
  T1180: { muscles: OBLIQUES_LEAD }, // Kettlebell Windmill
  T1185: { muscles: OBLIQUES_LEAD }, // Side Plank
  T1216: { muscles: { ...OBLIQUES_LEAD, abductors: "involved" } }, // Side Plank With Leg Raise
  T1250: { muscles: OBLIQUES_LEAD }, // Supine Oblique Wood Chop
  T1354: { muscles: OBLIQUES_LEAD }, // Cable Rotation
  T1355: { muscles: OBLIQUES_LEAD }, // Kneeling Cable Woodchop
  T1359: { muscles: OBLIQUES_LEAD }, // Kneeling Anti Rotational Press (Pallof press)
  T1363: { muscles: OBLIQUES_LEAD }, // Twist Throw
  T1364: { muscles: OBLIQUES_LEAD }, // Russian Twist Med Ball Slam
  // A side plank on a bench: the adductors hold it as hard as the obliques
  T1368: { muscles: { ...OBLIQUES_LEAD, adductors: "primary" }, equipment: ["bodyweight"] }, // Copenhagen Plank

  // Crunches with a twist and loaded carries on one side: obliques and abs together
  T1076: { muscles: OBLIQUES_WITH_ABS }, // Bicycle Crunches
  T1239: { muscles: OBLIQUES_WITH_ABS }, // Plank With Rotation
  T1257: { muscles: OBLIQUES_WITH_ABS }, // Standing Knee To Elbow
  T1361: { muscles: OBLIQUES_WITH_ABS }, // Rainbow Slam
  T1392: { muscles: OBLIQUES_WITH_ABS }, // Single Arm Overhead Farmers Walk

  // Planks, bird dogs, dead bugs and one-sided work: the obliques hold the trunk
  T1001: { muscles: OBLIQUES_STEADY }, // Cardio Kickboxing
  T1010: { muscles: OBLIQUES_STEADY }, // Planks
  T1077: { muscles: OBLIQUES_STEADY }, // Plank Jacks
  T1148: { muscles: OBLIQUES_STEADY }, // Plank Push Up
  T1150: { muscles: OBLIQUES_STEADY }, // Bird Dog
  T1163: { muscles: OBLIQUES_STEADY }, // Turkish Get Up
  T1177: { muscles: OBLIQUES_STEADY }, // One Arm Kettlebell Swings
  T1183: { muscles: OBLIQUES_STEADY }, // Lean Over And Touch Your Shoulders Alternately
  T1199: { muscles: OBLIQUES_STEADY }, // Spring With Lunge Quick Punch
  T1230: { muscles: OBLIQUES_STEADY }, // Saw Plank
  T1238: { muscles: OBLIQUES_STEADY }, // Plank With Lateral Movement
  T1243: { muscles: OBLIQUES_STEADY }, // Dead Bug
  T1248: { muscles: OBLIQUES_STEADY }, // Thoracic Spine Rotation
  T1249: { muscles: OBLIQUES_STEADY }, // Bird Dog Balance
  T1259: { muscles: OBLIQUES_STEADY }, // Plank Jacks 2
  T1299: { muscles: OBLIQUES_STEADY }, // Plank Row
  T1347: { muscles: OBLIQUES_STEADY }, // Exercise Ball Circles (stir the pot)
  T1348: { muscles: OBLIQUES_STEADY }, // Exercise Ball Buzzsaw Plank
  T1349: { muscles: OBLIQUES_STEADY }, // Exercise Ball Plank
  T1369: { muscles: OBLIQUES_STEADY }, // Kneeling Ab Wheel Rollout

  // Neck work, which COROS files under the traps
  T1071: { muscles: NECK }, // Press The Neck Forward
  T1072: { muscles: NECK }, // Lying Face Down Plate Neck Resistance
  T1073: { muscles: NECK }, // Lying Face Up Plate Neck Resistance
  T1074: { muscles: NECK }, // Seated Head Harness Neck Resistance
  T1075: { muscles: NECK }, // Neck Bridge Prone

  // Bodyweight on a pull-up bar, a dip station, a captain's chair or an incline bench
  T1002: { equipment: BODYWEIGHT_ON_A_STATION }, // Pull Ups
  T1032: { equipment: BODYWEIGHT_ON_A_STATION }, // Hanging Leg Raise
  T1034: { equipment: BODYWEIGHT_ON_A_STATION }, // Incline Leg Raise
  T1035: { equipment: BODYWEIGHT_ON_A_STATION }, // Upright Leg Raise
  T1038: { equipment: BODYWEIGHT_ON_A_STATION }, // Seated Leg Raise
  T1051: { equipment: BODYWEIGHT_ON_A_STATION }, // Parallel Bar Dips
  T1159: { equipment: BODYWEIGHT_ON_A_STATION }, // Leg Raise Toe To Bar
  T1329: { equipment: BODYWEIGHT_ON_A_STATION }, // Single Arm Scap Pulls
  T1330: { equipment: BODYWEIGHT_ON_A_STATION }, // Archer Pull Up
  T1333: { equipment: BODYWEIGHT_ON_A_STATION }, // Scapular Pull Up (COROS lists none)
  T1340: { equipment: BODYWEIGHT_ON_A_STATION }, // Supine Pull Ups
  T1377: { equipment: BODYWEIGHT_ON_A_STATION }, // One Arm Bar Hangs

  // A seated row is the cable stack, which COROS files only as gym equipment
  T1053: { equipment: ["cable", "machine"] }, // Seated Cable Row

  // A suspension trainer, which COROS files under the cable stack
  T1081: { equipment: ["suspension"] }, // Trx Suspended Crunches
  T1082: { equipment: ["suspension"] }, // Trx Suspended Chest Flys
  T1083: { equipment: ["suspension"] }, // Trx Suspended Back Flys
  T1084: { equipment: ["suspension"] }, // Trx Suspended Leg Curl
  T1085: { equipment: ["suspension"] }, // Trx Suspended Biceps Curl
  T1086: { equipment: ["suspension"] }, // Trx Suspended Split Squat
  T1087: { equipment: ["suspension"] }, // Trx Suspended Abdominal Fallout

  // What COROS files under "Others" that has a kind of its own
  T1005: { equipment: ["rope"] }, // Skipping Rope
  T1080: { equipment: ["rope"] }, // Battle Ropes
  T1372: { equipment: ["rope"] }, // Battle Rope Double Waves
  T1373: { equipment: ["rope"] }, // Battle Rope In And Out Waves
  T1374: { equipment: ["rope"] }, // Battle Rope Slams
  T1375: { equipment: ["rope"] }, // Battle Rope Alternating Waves
  T1394: { equipment: ["sled"] }, // Sledpush
  T1395: { equipment: ["sled"] }, // Sledpull
  T1371: { equipment: ["barbell"] }, // Hex Bar Deadlift
  T1393: { equipment: ["machine"] }, // Skierg
  T1365: { equipment: ["bodyweight"] }, // Nordic Hamstring Curl
  T1366: { equipment: ["bodyweight"] }, // Box Step Up Knee Drive
  T1367: { equipment: ["bodyweight"] }, // Reverse Step Down

  // A stretch COROS lists no equipment for
  T1262: { equipment: ["bodyweight"] } // Greatest Stretch
};
