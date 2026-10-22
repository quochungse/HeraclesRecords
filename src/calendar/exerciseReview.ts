/**
 * What COROS's catalog does not say about a movement, or says wrongly, stated
 * per movement.
 *
 * A catalog row names its muscles and its equipment as codes, and those codes
 * are read as they are (`exerciseFacets.ts`). Three things they get wrong:
 *
 *   - **muscles COROS has no code for.** Its muscle table runs 1–15 with no
 *     obliques and no neck, so a side plank is filed under 6 with the crunches
 *     and a neck harness under the traps. Read as sent, no movement worked
 *     either muscle;
 *   - **equipment its codes misfile.** A TRX is filed under the cable stack
 *     (5), a battle rope and a sled under "Others" (16), a hex bar deadlift
 *     under "Others" too, and a pull-up bar under gym equipment with no word
 *     that the movement is bodyweight;
 *   - **muscles it files wrongly.** A squat, a leg press and a step-up are
 *     filed as hamstring work, a bridge and a glute kickback too, a band
 *     lateral raise as traps, a battle rope as biceps, an L-sit as glutes.
 *     These are corrected against what each movement is known to train.
 *
 * The first two used to be read off the movement's name, and a name is not a
 * description: "Bicycle Crunches" says nothing of the obliques, "Romanian
 * Deadlift" nothing of the hamstrings. So each is decided here, **per movement,
 * by its COROS key**, as `exerciseEffort.ts` decides effort. A movement not
 * listed is exactly as COROS sends it. Keys and names were read off the live
 * catalog on 2026-10-22 (382 Strength movements).
 *
 * `muscles` sets a muscle's role, over whatever COROS said of it: `primary`
 * weighs as a muscle COROS lists in `muscle`, `involved` as one it lists only
 * in `muscleRelevance`, and `none` takes it out. Where the obliques lead a
 * movement COROS files under 6 alone, the abs step down to involved.
 * `equipment` replaces COROS's codes whole. The three are kept as three tables
 * and joined per movement into `EXERCISE_REVIEW`.
 */
import type { MuscleId } from "../strength/muscles";
import type { ExerciseEquipment } from "./exerciseFacets";

export type ReviewedRole = "primary" | "involved" | "none";
type ReviewedMuscles = Partial<Record<MuscleId, ReviewedRole>>;

export interface ExerciseReview {
  muscles?: ReviewedMuscles;
  equipment?: readonly ExerciseEquipment[];
}

/** The obliques lead and the rest of the abdominal wall assists. */
const OBLIQUES_LEAD: ReviewedMuscles = { obliques: "primary", abs: "involved" };
/** The obliques work as hard as the abs. */
const OBLIQUES_WITH_ABS: ReviewedMuscles = { obliques: "primary" };
/** The obliques hold the trunk still against a rotation or a sideways pull. */
const OBLIQUES_STEADY: ReviewedMuscles = { obliques: "involved" };
/** COROS files the neck under the traps, which only assist. */
const NECK: ReviewedMuscles = { neck: "primary", traps: "involved" };

/** Bodyweight on a bar, a bench or a station COROS calls gym equipment. */
const BODYWEIGHT_ON_A_STATION: readonly ExerciseEquipment[] = ["bodyweight", "machine"];

/** Muscles COROS has no code for: the obliques and the neck. */
const UNCODED_MUSCLES: Readonly<Record<string, ReviewedMuscles>> = {
  // Side bends, twists, side planks, windmills and woodchops: the obliques lead
  T1011: OBLIQUES_LEAD, // Dumbbell Side Bends
  T1039: OBLIQUES_LEAD, // Trunk Rotations
  T1040: OBLIQUES_LEAD, // Oblique V Ups
  T1143: OBLIQUES_LEAD, // Side Bridge Wing Arm And Swing Leg
  T1145: OBLIQUES_LEAD, // Trunk Rotations
  T1146: OBLIQUES_LEAD, // Alternate Heel Touchers
  T1156: OBLIQUES_LEAD, // Windshield Wiper
  T1162: OBLIQUES_LEAD, // Side Plank Rotation
  T1171: OBLIQUES_LEAD, // Hanging Windshield Wiper
  T1173: OBLIQUES_LEAD, // Lower Oblique Load Roll
  T1180: OBLIQUES_LEAD, // Kettlebell Windmill
  T1185: OBLIQUES_LEAD, // Side Plank
  T1216: { ...OBLIQUES_LEAD, abductors: "involved" }, // Side Plank With Leg Raise
  T1250: OBLIQUES_LEAD, // Supine Oblique Wood Chop
  T1354: OBLIQUES_LEAD, // Cable Rotation
  T1355: OBLIQUES_LEAD, // Kneeling Cable Woodchop
  T1359: OBLIQUES_LEAD, // Kneeling Anti Rotational Press (Pallof press)
  T1363: OBLIQUES_LEAD, // Twist Throw
  T1364: OBLIQUES_LEAD, // Russian Twist Med Ball Slam
  // A side plank on a bench: the adductors hold it as hard as the obliques
  T1368: { ...OBLIQUES_LEAD, adductors: "primary" }, // Copenhagen Plank

  // Crunches with a twist and loaded carries on one side: obliques and abs together
  T1076: OBLIQUES_WITH_ABS, // Bicycle Crunches
  T1239: OBLIQUES_WITH_ABS, // Plank With Rotation
  T1257: OBLIQUES_WITH_ABS, // Standing Knee To Elbow
  T1361: OBLIQUES_WITH_ABS, // Rainbow Slam
  T1392: OBLIQUES_WITH_ABS, // Single Arm Overhead Farmers Walk

  // Planks, bird dogs, dead bugs and one-sided work: the obliques hold the trunk
  T1001: OBLIQUES_STEADY, // Cardio Kickboxing
  T1010: OBLIQUES_STEADY, // Planks
  T1077: OBLIQUES_STEADY, // Plank Jacks
  T1148: OBLIQUES_STEADY, // Plank Push Up
  T1150: OBLIQUES_STEADY, // Bird Dog
  T1163: OBLIQUES_STEADY, // Turkish Get Up
  T1177: OBLIQUES_STEADY, // One Arm Kettlebell Swings
  T1183: OBLIQUES_STEADY, // Lean Over And Touch Your Shoulders Alternately
  T1199: OBLIQUES_STEADY, // Spring With Lunge Quick Punch
  T1230: OBLIQUES_STEADY, // Saw Plank
  T1238: OBLIQUES_STEADY, // Plank With Lateral Movement
  T1243: OBLIQUES_STEADY, // Dead Bug
  T1248: OBLIQUES_STEADY, // Thoracic Spine Rotation
  T1249: OBLIQUES_STEADY, // Bird Dog Balance
  T1259: OBLIQUES_STEADY, // Plank Jacks 2
  T1299: OBLIQUES_STEADY, // Plank Row
  T1347: OBLIQUES_STEADY, // Exercise Ball Circles (stir the pot)
  T1348: OBLIQUES_STEADY, // Exercise Ball Buzzsaw Plank
  T1349: OBLIQUES_STEADY, // Exercise Ball Plank
  T1369: OBLIQUES_STEADY, // Kneeling Ab Wheel Rollout

  // Neck work, which COROS files under the traps
  T1071: NECK, // Press The Neck Forward
  T1072: NECK, // Lying Face Down Plate Neck Resistance
  T1073: NECK, // Lying Face Up Plate Neck Resistance
  T1074: NECK, // Seated Head Harness Neck Resistance
  T1075: NECK, // Neck Bridge Prone
};

/** Muscles COROS files wrongly. */
const MUSCLE_CORRECTIONS: Readonly<Record<string, ReviewedMuscles>> = {
  // Squats, presses and step-ups: COROS leads with the hamstrings, which only assist
  T1061: { quads: "primary", glutes: "primary", hamstrings: "involved" }, // Squats
  T1065: { quads: "primary", glutes: "primary", hamstrings: "involved" }, // Incline Leg Press
  T1166: { quads: "primary", glutes: "primary", hamstrings: "involved" }, // Box Step Ups
  T1188: { quads: "primary", glutes: "primary", hamstrings: "involved", adductors: "involved" }, // Curtsey Squat
  T1226: { quads: "primary" }, // Reverse Lunge (COROS: glutes alone)
  // Bridges and kickbacks: the glutes lead, the hamstrings assist
  T1033: { glutes: "primary", hamstrings: "involved" }, // Bridge
  T1063: { glutes: "primary", hamstrings: "involved" }, // Cable Glute Kickbacks
  // A standing hamstring curl is the hamstrings, not the calves
  T1255: { hamstrings: "primary", calves: "involved" }, // Standing Hamstring Curl
  // Band squats and lunges COROS files under the abs
  T1189: { quads: "primary", glutes: "involved", abs: "involved" }, // Band Squat
  T1190: { quads: "primary", glutes: "primary", abs: "involved" }, // Lunge With Elastic Band
  T1191: { quads: "primary", glutes: "primary", adductors: "involved", abs: "involved" }, // Band Side Squat
  // Hip work COROS gives the wrong side of the hip, or none
  T1113: { glutes: "primary", abductors: "involved", adductors: "none" }, // Prone Hip Circles
  T1317: { abductors: "primary" }, // Clamshell
  // Rear-delt and lateral raises COROS files under the traps or the chest
  T1083: { shoulders: "primary", traps: "involved", chest: "none" }, // Trx Suspended Back Flys
  T1106: { shoulders: "primary", traps: "involved" }, // Reverse Flys With Bands
  T1107: { shoulders: "primary", traps: "involved" }, // Lateral Raises With Bands
  // A low cable fly is a chest fly
  T1046: { chest: "primary", shoulders: "involved" }, // Low Cable Flys
  T1082: { shoulders: "involved", triceps: "none" }, // Trx Suspended Chest Flys
  // A chest pass is the chest and triceps
  T1094: { chest: "primary", triceps: "involved", abs: "involved" }, // Supine Chest Ball Throw
  // Battle ropes are driven from the shoulders
  T1080: { shoulders: "primary", biceps: "involved", triceps: "involved", forearms: "involved", abs: "involved" }, // Battle Ropes
  T1372: { shoulders: "primary", biceps: "involved", triceps: "involved" }, // Battle Rope Double Waves
  T1373: { shoulders: "primary", chest: "involved" }, // Battle Rope In And Out Waves
  T1374: { abs: "involved" }, // Battle Rope Slams
  T1375: { shoulders: "primary", biceps: "involved", lats: "involved", chest: "involved" }, // Battle Rope Alternating Waves
  // An L-sit is held by the abs, not the glutes
  T1161: { abs: "primary", quads: "involved", triceps: "involved", glutes: "none" }, // The L Sit
  T1211: { quads: "involved", lowerBack: "none" }, // V Sit Hold
  // Mountain climbers are a plank with the knees driven in
  T1079: { abs: "primary", quads: "involved", shoulders: "involved" }, // Mountain Climbers
  // The row's legs drive and its back pulls; the triceps do not
  T1207: { lats: "primary", glutes: "involved", hamstrings: "involved", triceps: "none" }, // Indoor Rower
  // A push press and a snatch are driven by the legs into the shoulders
  T1362: { shoulders: "primary" }, // Med Ball Push Press
  T1307: { hamstrings: "involved", triceps: "none" }, // Dumbbell Snatch
  // A pulldown pulls with the biceps
  T1350: { biceps: "involved", triceps: "none" }, // Single Arm Lat Pulldown
  T1351: { biceps: "involved" }, // Behind The Neck Pulldowns
  T1340: { biceps: "involved" }, // Supine Pull Ups
  T1341: { chest: "none" }, // Triceps Pushdown Machine
  T1037: { quads: "none" }, // High Pulley Crunches
  // A deadlift's calves are COROS's; its quads, grip and traps are not listed
  T1067: { quads: "involved", forearms: "involved", traps: "involved", calves: "none" }, // Deadlifts
  // What COROS leaves out of movements it otherwise reads right
  T1014: { glutes: "involved" }, // Box Jumps
  T1060: { glutes: "involved" }, // Step Up Jumps
  T1084: { glutes: "involved" }, // Trx Suspended Leg Curl
  T1086: { glutes: "involved" }, // Trx Suspended Split Squat
  T1103: { glutes: "involved" }, // Lateral Band Walks
  T1112: { glutes: "involved" }, // Thigh Abductor
  T1116: { glutes: "involved" }, // Standing Side Leg Raises
  T1136: { glutes: "involved" }, // Jumping Lunges
  T1138: { glutes: "involved" }, // Lunge Leg Lifts
  T1144: { glutes: "involved" }, // One Leg Deadlifts And Knee Lifting
  T1152: { glutes: "involved" }, // Lunge Down
  T1153: { glutes: "involved", adductors: "involved" }, // Lunge Sideways From Hip To Hip
  T1217: { adductors: "involved" }, // Lateral Squats Or Side Squats
  T1290: { adductors: "involved" }, // Sumo Deadlift
  T1295: { adductors: "involved" }, // Sumo Squat
  T1331: { glutes: "involved" }, // Reverse Hack Squat
  T1366: { glutes: "involved" }, // Box Step Up Knee Drive
  T1177: { hamstrings: "involved", lowerBack: "involved" }, // One Arm Kettlebell Swings
  T1178: { hamstrings: "involved", lowerBack: "involved" }, // Two Arm Kettlebell Swings
  T1284: { lowerBack: "involved" }, // Barbell Good Morning
  T1150: { lowerBack: "involved", glutes: "involved" }, // Bird Dog
  T1041: { shoulders: "involved" }, // Bench Press
  T1043: { shoulders: "involved" }, // Decline Bench Press
  T1049: { lats: "involved" }, // Dumbbell Pullover
  T1050: { lats: "involved" }, // Barbell Pullover
  T1148: { chest: "involved", shoulders: "involved" }, // Plank Push Up
  T1163: { shoulders: "involved" }, // Turkish Get Up
  T1168: { triceps: "involved" }, // Handstands
  T1179: { triceps: "involved" }, // One Arm Kettlebell Military Press To The Side
  T1324: { triceps: "involved" }, // Banded Press
  T1298: { forearms: "involved" }, // Reverse Curl
  T1205: { biceps: "involved", lats: "involved" }, // Hang With 90 Degree Elbow
  T1206: { biceps: "involved", lats: "involved" }, // Hang With 135 Degree Elbow
  T1329: { traps: "involved" }, // Single Arm Scap Pulls
  T1336: { traps: "involved" }, // Machine Reverse Fly
  // The eight HYROX stations, read as the race runs them (the rower is above)
  T1393: { triceps: "primary", quads: "involved" }, // SkiErg: lats and triceps pull, the legs drop into it
  T1394: { glutes: "primary", shoulders: "involved", triceps: "involved" }, // Sled push
  T1395: { forearms: "involved", shoulders: "involved", quads: "involved" }, // Sled pull: hand over hand, legs braced
  T1396: { glutes: "primary", calves: "involved" }, // Burpee broad jumps
  T1310: { traps: "primary", obliques: "involved", quads: "involved", glutes: "involved" }, // Farmers carry
  T1064: { hamstrings: "involved", adductors: "involved" }, // Lunges (sandbag lunges in the race)
  T1397: { glutes: "primary" } // Wall balls
};

/** Equipment COROS's codes misfile, replacing them whole. */
const EQUIPMENT: Readonly<Record<string, readonly ExerciseEquipment[]>> = {
  // Bodyweight on a pull-up bar, a dip station, a captain's chair or an incline bench
  T1171: BODYWEIGHT_ON_A_STATION, // Hanging Windshield Wiper
  T1002: BODYWEIGHT_ON_A_STATION, // Pull Ups
  T1032: BODYWEIGHT_ON_A_STATION, // Hanging Leg Raise
  T1034: BODYWEIGHT_ON_A_STATION, // Incline Leg Raise
  T1035: BODYWEIGHT_ON_A_STATION, // Upright Leg Raise
  T1038: BODYWEIGHT_ON_A_STATION, // Seated Leg Raise
  T1051: BODYWEIGHT_ON_A_STATION, // Parallel Bar Dips
  T1159: BODYWEIGHT_ON_A_STATION, // Leg Raise Toe To Bar
  T1329: BODYWEIGHT_ON_A_STATION, // Single Arm Scap Pulls
  T1330: BODYWEIGHT_ON_A_STATION, // Archer Pull Up
  T1333: BODYWEIGHT_ON_A_STATION, // Scapular Pull Up (COROS lists none)
  T1340: BODYWEIGHT_ON_A_STATION, // Supine Pull Ups
  T1377: BODYWEIGHT_ON_A_STATION, // One Arm Bar Hangs

  // A seated row is the cable stack, which COROS files only as gym equipment
  T1053: ["cable", "machine"], // Seated Cable Row

  // A suspension trainer, which COROS files under the cable stack
  T1081: ["suspension"], // Trx Suspended Crunches
  T1082: ["suspension"], // Trx Suspended Chest Flys
  T1083: ["suspension"], // Trx Suspended Back Flys
  T1084: ["suspension"], // Trx Suspended Leg Curl
  T1085: ["suspension"], // Trx Suspended Biceps Curl
  T1086: ["suspension"], // Trx Suspended Split Squat
  T1087: ["suspension"], // Trx Suspended Abdominal Fallout

  // What COROS files under "Others" that has a kind of its own
  T1005: ["rope"], // Skipping Rope
  T1080: ["rope"], // Battle Ropes
  T1372: ["rope"], // Battle Rope Double Waves
  T1373: ["rope"], // Battle Rope In And Out Waves
  T1374: ["rope"], // Battle Rope Slams
  T1375: ["rope"], // Battle Rope Alternating Waves
  T1394: ["sled"], // Sledpush
  T1395: ["sled"], // Sledpull
  T1371: ["barbell"], // Hex Bar Deadlift
  T1393: ["machine"], // Skierg
  T1365: ["bodyweight"], // Nordic Hamstring Curl
  T1366: ["bodyweight"], // Box Step Up Knee Drive
  T1367: ["bodyweight"], // Reverse Step Down
  T1368: ["bodyweight"], // Copenhagen Plank

  // A stretch COROS lists no equipment for
  T1262: ["bodyweight"] // Greatest Stretch
};

/** The three tables, joined per movement. */
export const EXERCISE_REVIEW: Readonly<Record<string, ExerciseReview>> = Object.fromEntries(
  [...new Set([...Object.keys(UNCODED_MUSCLES), ...Object.keys(MUSCLE_CORRECTIONS), ...Object.keys(EQUIPMENT)])]
    .map((key): [string, ExerciseReview] => {
      const muscles = { ...UNCODED_MUSCLES[key], ...MUSCLE_CORRECTIONS[key] };
      const equipment = EQUIPMENT[key];
      return [key, {
        ...(Object.keys(muscles).length ? { muscles } : {}),
        ...(equipment ? { equipment } : {})
      }];
    })
);

/**
 * The two muscle tables, for a suite to hold apart: a muscle set in both for
 * one movement would have the correction win in silence.
 */
export const REVIEW_MUSCLE_TABLES = { uncoded: UNCODED_MUSCLES, corrections: MUSCLE_CORRECTIONS } as const;
