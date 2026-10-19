/**
 * How hard a movement works the muscle it names, for the movements where
 * COROS's catalog cannot say.
 *
 * A row says what a movement lifts (equipment, a default weight) and how it is
 * counted (reps or time), and that is enough to tell a dumbbell press from a
 * stretch. It is not enough for bodyweight work, which is one kind of row —
 * equipment "bodyweight", reps, no weight — and covers a warm-up drill that
 * loads nothing and a dip that loads more than most dumbbells. Nothing in the
 * row separates them: not the muscles, not the default reps (a push-up and a
 * jumping jack are both 15), not the body part.
 *
 * So the difference is stated here, **per movement, by its COROS key** (the
 * `T####` the catalog files it under), not guessed from its name. Four steps:
 *
 *   - minimal  warm-ups, mobility, stretching, foam rolling, activation and
 *              cardio drills: next to no load on any muscle;
 *   - light    a small share of bodyweight or a short lever: crunches, leg
 *              raises lying down, bridges, planks, kneeling and incline push-ups;
 *   - moderate a good share of bodyweight through a big muscle: push-ups,
 *              squats, lunges, step-ups, single-leg bridges;
 *   - heavy    most or all of bodyweight on a small base or a long lever:
 *              pull-ups, dips, handstands, pistols, Nordic curls, L-sits, hangs;
 *
 * plus `loaded` for the two rows COROS files under "other" equipment with no
 * weight set. A movement that is not listed — one COROS adds later — falls
 * back to what its row says, so a new bodyweight movement ranks as plain work
 * until someone places it. Keys were read off the catalog on 2026-10-19.
 */
export type ExerciseEffort = "minimal" | "light" | "moderate" | "heavy" | "loaded";

export const EXERCISE_EFFORT: Readonly<Record<string, ExerciseEffort>> = {
  // Warm-ups, mobility, stretching, foam rolling, activation and cardio drills: next to no load on any muscle
  T1001: "minimal", // Cardio Kickboxing
  T1005: "minimal", // Skipping Rope
  T1007: "minimal", // Burpees
  T1009: "minimal", // Jumping Jacks
  T1013: "minimal", // High Knees
  T1077: "minimal", // Plank Jacks
  T1079: "minimal", // Mountain Climbers
  T1080: "minimal", // Battle Ropes
  T1113: "minimal", // Prone Hip Circles
  T1120: "minimal", // Warm Up
  T1121: "minimal", // Training
  T1122: "minimal", // Cool Down
  T1123: "minimal", // Rest
  T1126: "minimal", // Fast Arm Swing
  T1127: "minimal", // Running In Place
  T1128: "minimal", // High Knees Against Wall
  T1129: "minimal", // Running With High Knees (Faster Pace)
  T1130: "minimal", // Running Butt Kicks
  T1131: "minimal", // Short Stride Running
  T1134: "minimal", // Run Lunges
  T1135: "minimal", // Running With High Knees
  T1142: "minimal", // Lie On And High Knees
  T1169: "minimal", // Incline Walking
  T1170: "minimal", // Jogging
  T1174: "minimal", // Ski Step
  T1175: "minimal", // Back And Forth Step
  T1181: "minimal", // J Lo S
  T1183: "minimal", // Lean Over And Touch Your Shoulders Alte
  T1207: "minimal", // Indoor Rower
  T1212: "minimal", // A-Skips
  T1213: "minimal", // B-Skips
  T1214: "minimal", // C-Skips
  T1215: "minimal", // Back Stretch
  T1222: "minimal", // Leg Swing Front and Back
  T1224: "minimal", // Lunge Pulls
  T1228: "minimal", // Shoulder Stretch
  T1234: "minimal", // Cat-Cow Stretch
  T1236: "minimal", // Straight-Leg Run or Bounding
  T1240: "minimal", // Frog Pose
  T1244: "minimal", // Glute Stretch
  T1246: "minimal", // Calf Stretch
  T1247: "minimal", // Chest Stretch
  T1248: "minimal", // Thoracic Spine Rotation
  T1254: "minimal", // Standing Forward Bend
  T1256: "minimal", // Quadriceps Stretch
  T1257: "minimal", // Standing Knee-to-Elbow
  T1259: "minimal", // Plank Jacks
  T1262: "minimal", // Greatest Stretch
  T1263: "minimal", // Lateral Leg Swings
  T1264: "minimal", // Bicep Stretch
  T1265: "minimal", // Tricep Stretch
  T1266: "minimal", // Hamstring Stretch
  T1267: "minimal", // Inner Thigh Stretch
  T1268: "minimal", // Outer Thigh Stretch
  T1269: "minimal", // Knee Hug
  T1270: "minimal", // Crossbody Calf Hug
  T1271: "minimal", // Quad Stretch with Reach
  T1272: "minimal", // Toe Touch Sweep
  T1274: "minimal", // Lunge Stretch
  T1276: "minimal", // Prone A's
  T1277: "minimal", // Prone I's
  T1278: "minimal", // Prone Y's
  T1279: "minimal", // Prone T's
  T1280: "minimal", // Prone W's
  T1372: "minimal", // Battle Rope Double Waves
  T1373: "minimal", // Battle Rope In-and-Out Waves
  T1374: "minimal", // Battle Rope Slams
  T1375: "minimal", // Battle Rope Alternating Waves
  T1376: "minimal", // Foot Rolling
  T1378: "minimal", // Stick Warmup 1
  T1379: "minimal", // Stick Warmup 2
  T1380: "minimal", // Stick Warmup 3
  T1383: "minimal", // Foam Rolling - Tibialis Anteriors
  T1384: "minimal", // Foam Rolling - Hips
  T1385: "minimal", // Foam Rolling - Hamstrings
  T1386: "minimal", // Foam Rolling - IT Bands
  T1387: "minimal", // Foam Rolling - Quads
  T1388: "minimal", // Foam Rolling - Adductors
  T1389: "minimal", // Foam Rolling - Calves
  T1390: "minimal", // Foam Rolling - Chest
  T1391: "minimal", // Foam Rolling - Upper Back
  T1393: "minimal", // Ski Erg
  T1396: "minimal", // Burpee Broad Jumps

  // A small share of bodyweight, or a short lever: crunches, leg raises lying down, bridges, kicks, planks, kneeling and incline push-ups
  T1006: "light", // Sit-ups
  T1010: "light", // Planks
  T1014: "light", // Box Jumps
  T1033: "light", // Bridge
  T1034: "light", // Incline Leg Raise
  T1035: "light", // Upright Leg Raise
  T1038: "light", // Seated Leg Raise
  T1040: "light", // Oblique V-Ups
  T1070: "light", // Standing Calf Raises
  T1071: "light", // Neck Flexion With Positive Pressure Of
  T1075: "light", // Neck Bridge Prone
  T1076: "light", // Bicycle Crunches
  T1116: "light", // Standing Side Leg Raises
  T1132: "light", // Lie on Your Back Glute Bridge
  T1141: "light", // Lie On One Leg Supine Hip And Knee
  T1143: "light", // Side Plank Knee To Chest
  T1144: "light", // Balanced Kick Back
  T1146: "light", // Alternate Heel Touchers
  T1147: "light", // Seated Scissor Kicks
  T1148: "light", // Plank Step Ups
  T1149: "light", // Crunch
  T1150: "light", // Bird Dog
  T1156: "light", // Windshield Wiper
  T1157: "light", // Power Point
  T1182: "light", // Crawl On The Ground
  T1184: "light", // Kneeling Push-Ups
  T1185: "light", // Side Plank
  T1218: "light", // Single-Leg High Knee Jump
  T1223: "light", // Prone Cobra
  T1229: "light", // Glute Bridge Hold
  T1233: "light", // Donkey Kicks
  T1238: "light", // Plank with Lateral Movement
  T1239: "light", // Plank with Rotation
  T1241: "light", // Incline Push-Up
  T1243: "light", // Dead Bug
  T1249: "light", // Bird-Dog Balance
  T1250: "light", // Supine Oblique Wood Chop
  T1251: "light", // Supine Cobra
  T1252: "light", // Supine Knee Tucks
  T1255: "light", // Standing Hamstring Curl
  T1260: "light", // Straight-Leg Hops
  T1273: "light", // Single-Leg Hops
  T1329: "light", // Single Arm Scap Pulls
  T1333: "light", // Scapular Pull-Up

  // A good share of bodyweight through a big muscle: push-ups, squats, lunges, step-ups, single-leg bridges
  T1004: "moderate", // Push-ups
  T1057: "moderate", // Back Extensions
  T1060: "moderate", // Step Up Jumps
  T1061: "moderate", // Squats
  T1078: "moderate", // Squat Jumps
  T1133: "moderate", // Unilateral Supine Buttocks Lift Hip Lif
  T1136: "moderate", // Jumping Lunges
  T1137: "moderate", // Knee-Up Walking Lunges
  T1138: "moderate", // Knee-Up Lunges
  T1139: "moderate", // Forward Jumping Lunges
  T1160: "moderate", // Single Leg Bridge
  T1164: "moderate", // Split Bench Squat
  T1165: "moderate", // Bench Dips
  T1166: "moderate", // Box Step-Ups
  T1188: "moderate", // Curtsey Squat
  T1211: "moderate", // V-Sit Hold
  T1216: "moderate", // Side Plank with Leg Raise
  T1217: "moderate", // Lateral Squats or Side Squats
  T1219: "moderate", // Single-Leg Hip Bridge
  T1225: "moderate", // Walking Lunges
  T1226: "moderate", // Reverse Lunge
  T1231: "moderate", // Wall Sit
  T1230: "moderate", // Saw Plank
  T1232: "moderate", // Wide Grip Push-Up
  T1237: "moderate", // Offset Push-Up
  T1245: "moderate", // Decline Push-Up
  T1253: "moderate", // Close Grip Push-Up
  T1261: "moderate", // Diamond Push-Up
  T1158: "moderate", // Super Push Up
  T1340: "moderate", // Supine pull ups
  T1346: "moderate", // Single Leg Curl
  T1366: "moderate", // Box Step Up Knee Drive
  T1367: "moderate", // Reverse Step-Down
  T1368: "moderate", // Copenhagen Plank

  // Most or all of bodyweight on a small base or a long lever: pull-ups, dips, handstands, pistols, Nordic curls, L-sits, hangs
  T1002: "heavy", // Pull-ups
  T1032: "heavy", // Hanging Leg Raise
  T1051: "heavy", // Parallel Bar Dips
  T1159: "heavy", // Leg Raise Toe to Bar
  T1161: "heavy", // The L-sit
  T1167: "heavy", // Single Leg Squats
  T1168: "heavy", // Handstands
  T1171: "heavy", // Hanging Windshield Wiper
  T1202: "heavy", // Open Hand Grip
  T1203: "heavy", // Half Crimp
  T1204: "heavy", // Slope Hang
  T1205: "heavy", // Hang with 90 Degree Elbow
  T1206: "heavy", // Hang with 135 Degree Elbow
  T1220: "heavy", // Handstand Push-Up
  T1221: "heavy", // Inverse Nordic Curl
  T1227: "heavy", // Clapping Push-Up
  T1235: "heavy", // Pike Push-Up
  T1242: "heavy", // Fingertip Push-Up
  T1330: "heavy", // Archer Pull-Up
  T1360: "heavy", // Hangboard Pull-ups
  T1365: "heavy", // Nordic Hamstring Curl
  T1369: "heavy", // Kneeling Ab Wheel Rollout
  T1377: "heavy", // One Arm Bar Hangs

  // Lifts COROS files under rope or other equipment with no weight set
  T1370: "loaded", // Wrist Roller
  T1371: "loaded", // Hex Bar Deadlift
};
