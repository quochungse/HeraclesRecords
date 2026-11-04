/**
 * How far and how long a planned workout goes (`electron/workoutFigures.ts`),
 * the one rule the Calendar, the workout view, the builder's footer, the plan
 * reader and Coach's draft volume go through.
 *
 * The case that made it one rule: a 14 km long run written as a 15-minute
 * warm-up, 6.5 km, 5 km and a 5-minute cool-down, all at heart-rate targets.
 * COROS estimates it at 14.08 km and 1:38:03; Coach's card summed the distance
 * steps and said "Distance 11.5 km". COROS's arithmetic is done here, so a
 * workout nobody has saved states what COROS will once it is.
 *
 * Every number below is an answer of `/training/program/calculate`, probed on
 * 2026-11-03 against one account (max HR 190, resting 52, LTHR 168, threshold
 * pace 321 s/km, pace zone 6 at 285 s/km).
 *
 * Run: npm run test:workout-figures
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (file) => import(pathToFileURL(path.join(repoRoot, "dist-electron", file)).href + "?cacheBust=" + Date.now());
const {
  combineMarks,
  corosProgramFigures,
  corosProgramStated,
  estimateWorkoutFigures,
  figureInWords,
  markFigure,
  sessionFigures,
  statedWorkoutFigures
} = await load("workoutFigures.js");
const { parseWorkoutEditorContext } = await load("corosWorkoutEditor.js");

const ACCOUNT = {
  hrZoneType: 2,
  zoneData: {
    maxHr: 190,
    rhr: 52,
    lthr: 168,
    ltsp: 321,
    ltspZone: [463, 387, 350, 321, 315, 285, 161].map((pace, index) => ({
      index,
      pace,
      ratio: [69.4, 82.9, 91.7, 100, 101.9, 112.6, 200][index]
    }))
  }
};
const context = parseWorkoutEditorContext(ACCOUNT, "metric");

const hr = (lowBpm, highBpm) => ({ type: "heartRate", lowBpm, highBpm });
const pace = (lowSecondsPerKm, highSecondsPerKm, type = "pace") => ({ type, lowSecondsPerKm, highSecondsPerKm, displayUnit: "km" });
const timed = (seconds, intensity, kind = "training") => ({ kind, target_type: "time", target_duration_seconds: seconds, ...(intensity ? { intensity } : {}) });
const dist = (meters, intensity, kind = "training") => ({ kind, target_type: "distance", target_distance_meters: meters, ...(intensity ? { intensity } : {}) });
const run = (steps, sport = "run") => ({ sport, steps });

const LONG_RUN = [timed(900, hr(125, 150), "warmup"), dist(6500, hr(135, 156)), dist(5000, hr(135, 160)), timed(300, hr(110, 145), "cooldown")];

// 0. The context carries COROS's own pace at max HR, not one rebuilt from rounded percents.
{
  assert.equal(context.maxHrPaceSecondsPerKm, 285, "ltspZone[5].pace, where 321 / 1.13 would say 284");
  assert.equal(
    parseWorkoutEditorContext({ zoneData: { ...ACCOUNT.zoneData, ltspZone: undefined } }, "metric").maxHrPaceSecondsPerKm,
    285,
    "without the table, threshold pace / 112.6%"
  );
}

// 1. A heart-rate step: the middle bpm, whole, through COROS's curve — within a centimetre or two.
{
  const answered = {
    40: 0, 52: 0, 60: 20341, 80: 71192, 90: 96618, 95: 109331, 100: 122044, 101: 124694, 103: 130084,
    105: 135474, 110: 148949, 125: 189375, 140: 229801, 150: 256752, 160: 283703, 165: 297178,
    168: 305263, 170: 309410, 175: 319777, 180: 330144, 185: 340510, 190: 350877, 195: 350877
  };
  for (const [bpm, centimetres] of Object.entries(answered)) {
    const { distanceMeters = 0 } = estimateWorkoutFigures(run([timed(1000, hr(Number(bpm), Number(bpm)))]), context);
    const off = Math.abs(Math.round(distanceMeters * 100) - centimetres);
    assert.ok(off <= 2, `1000 s at ${bpm} bpm: ${distanceMeters} m against COROS's ${centimetres / 100}`);
  }
  const band = (low, high) => Math.round(estimateWorkoutFigures(run([timed(1000, hr(low, high))]), context).distanceMeters);
  assert.equal(band(130, 170), 2568, "a band is its middle bpm, not the mean of its ends (2561)");
  assert.equal(band(160, 190), 3198);
  assert.equal(band(145, 146), 2433, "the middle is whole: 145.5 is 145, not 2446");
}

// 2. Distance steps take time at the step's speed; with no intensity they take none, as COROS has it.
{
  assert.equal(estimateWorkoutFigures(run([dist(5000, hr(140, 140))]), context).durationSeconds, 2176);
  assert.equal(estimateWorkoutFigures(run([dist(5000, hr(175, 175))]), context).durationSeconds, 1564);
  assert.equal(estimateWorkoutFigures(run([dist(3000, pace(300, 330))]), context).durationSeconds, 945, "the middle of a pace band");
  assert.deepEqual(estimateWorkoutFigures(run([dist(5000)]), context), { distanceMeters: 5000 }, "no intensity, no time");
  assert.equal(
    estimateWorkoutFigures(run([dist(7000), dist(500, hr(140, 140))]), context).durationSeconds,
    218,
    "COROS says 3:38 for 7.5 km, counting the untargeted 7 km at 0 s"
  );
}

// 3. Pace and effort pace convert; power, cadence and nothing do not (COROS counts them at 0,
//    and so does this); an open step, ended by the lap button, counts 0 m and 0 s.
{
  assert.equal(estimateWorkoutFigures(run([timed(1000, pace(300, 330))])).distanceMeters, 3174.6, "pace needs no account");
  assert.equal(estimateWorkoutFigures(run([timed(1000, pace(300, 330, "effortPace"))])).distanceMeters, 3174.6);
  for (const intensity of [{ type: "power", lowWatts: 200, highWatts: 220 }, { type: "cadence", low: 170, high: 180, unit: "spm" }, undefined]) {
    assert.deepEqual(estimateWorkoutFigures(run([timed(1000, intensity)]), context), { durationSeconds: 1000 });
  }
  assert.deepEqual(
    estimateWorkoutFigures(run([timed(600, hr(140, 140)), timed(60, undefined, "rest")]), context),
    { distanceMeters: 1378.81, durationSeconds: 660 }
  );
  assert.equal(
    estimateWorkoutFigures(run([timed(600, undefined, "warmup"), timed(600, hr(140, 140))]), context).distanceMeters,
    1378.81,
    "an untargeted warm-up adds 0 m, as it does on COROS's Calendar"
  );
  // "Easy 8 km (HR ≤154)", proposed by Coach: COROS stored 7797.96 m and 3602 s for it, where
  // leaving the untargeted cool-down unknown said "Distance steps 6.50 km" beside the Calendar's 7.80.
  assert.deepEqual(
    estimateWorkoutFigures(run([timed(600, hr(120, 150), "warmup"), dist(6500, hr(135, 154)), timed(300, { type: "none" }, "cooldown")]), context),
    { distanceMeters: 7797.96, durationSeconds: 3602 }
  );
  assert.deepEqual(estimateWorkoutFigures(run([{ kind: "training", target_type: "open", intensity: hr(140, 140) }]), context), {});
  assert.deepEqual(
    estimateWorkoutFigures(run([timed(600, hr(140, 140), "warmup"), dist(5000, hr(140, 140)), { kind: "cooldown", target_type: "open" }]), context),
    { distanceMeters: 6378.81, durationSeconds: 2776 },
    "an open cool-down adds nothing, and the steps around it still count"
  );
  assert.deepEqual(
    estimateWorkoutFigures(run([timed(600, { type: "unheardOf" })]), context),
    { durationSeconds: 600 },
    "an intensity the encoder does not know is never handed to it (it would throw, and take the plan reader with it)"
  );
}

// 4. The real long run, and sessions COROS stored in September and October.
{
  assert.deepEqual(estimateWorkoutFigures(run(LONG_RUN), context), { distanceMeters: 14079.74, durationSeconds: 5883 });
  // P10303's four HR zones of 5 minutes (its untargeted cool-down added 0 m there).
  assert.equal(
    estimateWorkoutFigures(run([timed(300, hr(133, 154)), timed(300, hr(155, 168)), timed(300, hr(169, 173)), timed(300, hr(174, 183))]), context).distanceMeters,
    3485.29
  );
  // "Easy 9 km + 5×100 m strides": heart rate, a repeat of pace strides and untargeted jogs.
  assert.deepEqual(
    estimateWorkoutFigures(run([
      timed(600, hr(115, 150), "warmup"),
      timed(2700, hr(135, 156)),
      { repeat: 5, steps: [timed(20, pace(300, 330), "interval"), timed(70, undefined, "rest")] },
      timed(300, hr(110, 145), "cooldown")
    ]), context),
    { distanceMeters: 8719.67, durationSeconds: 4050 }
  );
  assert.deepEqual(estimateWorkoutFigures(run(LONG_RUN, "trailRun"), context), { distanceMeters: 14079.74, durationSeconds: 5883 }, "Trail Run alike");
}

// 5. What cannot be worked out is not stated: no account for heart rate, a strength set. A ride or a
//    swim converts nothing, so each step counts in its own unit, as COROS stores it.
{
  assert.deepEqual(estimateWorkoutFigures(run(LONG_RUN)), {}, "heart rate waits for the account");
  assert.deepEqual(
    estimateWorkoutFigures(run(LONG_RUN, "bike"), context),
    { distanceMeters: 11500, durationSeconds: 1200 },
    "COROS converts nothing on a ride: each step counts in its own unit only"
  );
  // P10305, a COROS swim: 2×(100 m, 30 s), 2×(200 m, 30 s), 6×(100 m, 15 s), 2×(100 m, 60 s);
  // COROS stored 140000 cm and 330 s, its rests alone.
  const swimSet = (meters, rest) => [dist(meters, undefined, "interval"), timed(rest, undefined, "rest")];
  assert.deepEqual(
    estimateWorkoutFigures({ sport: "swim", steps: [
      { repeat: 2, steps: swimSet(100, 30) },
      { repeat: 2, steps: swimSet(200, 30) },
      { repeat: 6, steps: swimSet(100, 15) },
      { repeat: 2, steps: swimSet(100, 60) }
    ] }, context),
    { distanceMeters: 1400, durationSeconds: 330 }
  );
  assert.deepEqual(estimateWorkoutFigures({ sport: "strength", steps: [{ kind: "training", target_type: "reps", target_reps: 12 }] }, context), {});
}

// 6. The rule: COROS's stored figure, else its arithmetic, each marked by how its steps let it be known:
//    "exact" written in the steps, "estimated" worked out from an intensity, "atLeast" short of a
//    step nothing works out (an untargeted warm-up's distance, an open step, a swim length's time).
{
  const marks = (distanceMark, durationMark) => ({ distanceMark, durationMark, distanceAwaits: false, durationAwaits: false });
  assert.deepEqual(
    statedWorkoutFigures(run(LONG_RUN), { context }),
    { distanceMeters: 14079.74, durationSeconds: 5883, ...marks("estimated", "estimated") },
    "every step at heart rate: both worked out"
  );
  assert.deepEqual(
    statedWorkoutFigures(run(LONG_RUN), { coros: { distanceMeters: 14100, durationSeconds: 5900 }, context }),
    { distanceMeters: 14100, durationSeconds: 5900, ...marks("estimated", "estimated") },
    "a stored COROS figure outranks the arithmetic, and is marked by the same steps"
  );
  assert.deepEqual(
    statedWorkoutFigures(run(LONG_RUN)),
    { distanceMeters: 11500, durationSeconds: 1200, distanceMark: "atLeast", durationMark: "atLeast", distanceAwaits: true, durationAwaits: true },
    "before the account's thresholds: at least what the other steps add up to, waiting for them"
  );
  assert.deepEqual(
    statedWorkoutFigures(run(LONG_RUN), { coros: { distanceMeters: 14100, durationSeconds: 5900 } }),
    { distanceMeters: 14100, durationSeconds: 5900, ...marks("estimated", "estimated") },
    "COROS converted those steps: its figure waits for nothing"
  );
  const EASY8 = [timed(600, hr(120, 150), "warmup"), dist(6500, hr(135, 154)), timed(300, { type: "none" }, "cooldown")];
  assert.deepEqual(
    statedWorkoutFigures(run(EASY8), { context }),
    { distanceMeters: 7797.96, durationSeconds: 3602, ...marks("atLeast", "estimated") },
    "an untargeted cool-down adds no distance it has: 7.80+ km, ≈1:00:02"
  );
  assert.deepEqual(
    statedWorkoutFigures(run(EASY8), { coros: { distanceMeters: 7797.96, durationSeconds: 3602 }, context }),
    { distanceMeters: 7797.96, durationSeconds: 3602, ...marks("atLeast", "estimated") },
    "the same on the Calendar, from COROS's figure"
  );
  assert.deepEqual(
    statedWorkoutFigures(run([dist(10000, pace(300, 330))]), { context }),
    { distanceMeters: 10000, durationSeconds: 3150, ...marks("exact", "estimated") },
    "a distance written is exact; its time at a pace is worked out"
  );
  assert.deepEqual(
    statedWorkoutFigures(run([{ repeat: 10, steps: [dist(400, pace(300, 330), "interval"), timed(90, undefined, "rest")] }]), { context }),
    { distanceMeters: 4000, durationSeconds: 2160, ...marks("exact", "estimated") },
    "a rest stands still: its 0 m is exact"
  );
  assert.deepEqual(
    statedWorkoutFigures(run([timed(600, hr(140, 140), "warmup"), dist(5000, hr(140, 140)), { kind: "cooldown", target_type: "open" }]), { context }),
    { distanceMeters: 6378.81, durationSeconds: 2776, ...marks("atLeast", "atLeast") },
    "an open step leaves both at least"
  );
  const swimSet = (meters, rest) => [dist(meters, undefined, "interval"), timed(rest, undefined, "rest")];
  assert.deepEqual(
    statedWorkoutFigures({ sport: "swim", steps: [{ repeat: 2, steps: swimSet(100, 30) }, { repeat: 6, steps: swimSet(100, 15) }] }, { context }),
    { distanceMeters: 800, hiddenDurationSeconds: 150, ...marks("exact", "atLeast") },
    "a swim's lengths are exact; its rests are not its time, so none is stated — only counted toward a sum"
  );
  assert.deepEqual(
    statedWorkoutFigures({ sport: "bike", steps: [dist(20000, hr(140, 140)), dist(10000, hr(150, 150))] }, { context }),
    { distanceMeters: 30000, ...marks("exact", "atLeast") },
    "a ride in kilometres: exact, and no time to state"
  );
  assert.deepEqual(
    statedWorkoutFigures({ sport: "bike", steps: [timed(3000, hr(130, 140))] }, { context }),
    { durationSeconds: 3000, ...marks("atLeast", "exact") },
    "a timed ride's distance is at least 0: not stated"
  );
  const core = { sport: "strength", steps: [{ kind: "training", target_type: "reps", target_reps: 12 }, timed(360)] };
  assert.deepEqual(
    statedWorkoutFigures(core),
    { hiddenDurationSeconds: 360, ...marks("exact", "atLeast") },
    "the reps are the session's work and nothing times them: no time stated; a strength session covers no ground, so no distance is exact"
  );
  assert.deepEqual(
    statedWorkoutFigures(core, { coros: { durationSeconds: 1620 } }),
    { durationSeconds: 1620, ...marks("exact", "estimated") },
    "COROS times a strength session's reps itself: its figure is an estimate, not a floor"
  );
  assert.deepEqual(statedWorkoutFigures({ sport: "run", distance_km: 8 }), { distanceMeters: 8000, ...marks("exact", "exact") }, "a simple run's distance");
}

// 6b. A figure mostly short is not stated: the short steps, weighed in the unit they are exact in
//     (a step with no speed of its own at its sport's steady speed), over a third of the session.
{
  const marks = (distanceMark, durationMark) => ({ distanceMark, durationMark, distanceAwaits: false, durationAwaits: false });
  assert.deepEqual(
    statedWorkoutFigures(run([dist(200, undefined, "warmup"), timed(7200)]), { context }),
    { durationSeconds: 7200, hiddenDistanceMeters: 200, ...marks("atLeast", "atLeast") },
    "200 m and two untargeted hours: no distance (not 200 m+), and at least two hours"
  );
  assert.deepEqual(
    statedWorkoutFigures(run([dist(200, undefined, "warmup"), timed(7200)]), { coros: { distanceMeters: 200, durationSeconds: 7200 }, context }),
    { durationSeconds: 7200, hiddenDistanceMeters: 200, ...marks("atLeast", "atLeast") },
    "COROS's 200 m for it is hidden alike"
  );
  assert.equal(
    statedWorkoutFigures(run([timed(900, undefined, "warmup"), dist(6500, hr(135, 156)), timed(600, undefined, "cooldown")]), { context }).distanceMeters,
    undefined,
    "25 untargeted minutes of about 70: over a third"
  );
  assert.equal(
    statedWorkoutFigures(run([timed(300, undefined, "warmup"), dist(5000, pace(300, 330)), timed(300, undefined, "cooldown")]), { context }).distanceMark,
    "atLeast",
    "10 untargeted minutes of 36: stated, at least"
  );
  assert.deepEqual(
    statedWorkoutFigures({ sport: "bike", steps: [timed(1200, undefined, "warmup"), dist(30000)] }, { context }),
    { distanceMeters: 30000, hiddenDurationSeconds: 1200, ...marks("atLeast", "atLeast") },
    "a ride: 20 minutes against 30 km at 25 km/h is a fifth — 30.0+ km; 20 minutes are no time to state for 30 km"
  );
  assert.deepEqual(
    statedWorkoutFigures(run([timed(600, hr(140, 140), "warmup"), { kind: "training", target_type: "open" }]), { context }),
    { hiddenDistanceMeters: 1378.81, hiddenDurationSeconds: 600, ...marks("atLeast", "atLeast") },
    "an open main step: nothing says how long or how far the session goes"
  );
  assert.deepEqual(
    statedWorkoutFigures(run([{ kind: "warmup", target_type: "open" }, dist(5000, hr(140, 140))]), { context }),
    { distanceMeters: 5000, durationSeconds: 2176, ...marks("atLeast", "atLeast") },
    "an open warm-up is no main step: the rest is stated, at least"
  );
  // A heart-rate step weighs at its own speed — the account's, or on a COROS figure what that
  // figure holds beyond the steps written in its unit — so a saved workout and its proposal agree.
  const nearLimit = [timed(1200, undefined, "warmup"), dist(6500, hr(135, 154))];
  const proposed = statedWorkoutFigures(run(nearLimit), { context });
  assert.equal(proposed.distanceMeters, 6500, "20 untargeted minutes against 6.5 km at its own 6:56/km: 31%, stated");
  assert.deepEqual(
    statedWorkoutFigures(run(nearLimit), { coros: { distanceMeters: 6500, durationSeconds: proposed.durationSeconds }, context }),
    proposed,
    "the same steps on COROS's figure weigh the same (at 6:00/km they were 34%, hidden)"
  );
  assert.equal(
    statedWorkoutFigures(run(nearLimit), { coros: { distanceMeters: 6500, durationSeconds: proposed.durationSeconds } }).distanceMeters,
    6500,
    "and need no account to: COROS's own time for the 6.5 km is in its figure"
  );
  // A HYROX session: its stations are reps, which cover no ground — they leave no distance short.
  const hyrox = {
    sport: "hyrox",
    steps: [{ repeat: 8, steps: [dist(1000), { kind: "training", target_type: "reps", target_reps: 20 }] }]
  };
  assert.equal(statedWorkoutFigures(hyrox, { coros: { distanceMeters: 8000, durationSeconds: 4176 } }).distanceMeters, 8000, "8 km of runs, as COROS has it");
  assert.equal(statedWorkoutFigures(hyrox, { coros: { distanceMeters: 8000, durationSeconds: 4176 } }).distanceMark, "exact");
}

// 7. A COROS program read straight off COROS (the Calendar, Overview): its own figure, marked by its own steps.
{
  const exercise = (exerciseType, targetType, targetValue, intensityType = 0, extra = {}) =>
    ({ exerciseType, targetType, targetValue, intensityType, sets: 1, ...extra });
  const easy8 = {
    sportType: 1,
    estimatedDistance: 779796,
    estimatedTime: 3602,
    exercises: [exercise(1, 2, 600, 2), exercise(2, 5, 650000, 2), exercise(3, 2, 300, 0)]
  };
  assert.deepEqual(
    corosProgramStated(easy8),
    { distanceMeters: 7797.96, durationSeconds: 3602, distanceMark: "atLeast", durationMark: "estimated", distanceAwaits: false, durationAwaits: false },
    "the Calendar's Easy 8 km marks as the proposal did"
  );
  // P10305 as COROS stores it: group rows carry the repeat, their steps name them in `groupId`.
  const group = (id, sets) => ({ id, isGroup: true, sets, targetType: 0, targetValue: 0 });
  const swim = {
    sportType: 3,
    exercises: [
      group("a", 2), exercise(2, 5, 10000, 5, { groupId: "a" }), exercise(4, 2, 30, 0, { groupId: "a" }),
      group("b", 2), exercise(2, 5, 20000, 5, { groupId: "b" }), exercise(4, 2, 30, 0, { groupId: "b" }),
      group("c", 6), exercise(2, 5, 10000, 5, { groupId: "c" }), exercise(4, 2, 15, 0, { groupId: "c" }),
      group("d", 2), exercise(2, 5, 10000, 5, { groupId: "d" }), exercise(4, 2, 60, 0, { groupId: "d" })
    ]
  };
  assert.deepEqual(
    corosProgramStated(swim),
    { distanceMeters: 1400, hiddenDurationSeconds: 330, distanceMark: "exact", durationMark: "atLeast", distanceAwaits: false, durationAwaits: false },
    "a repeat counts per pass: 1400 m; its 5:30 of rests is not its time, so none is stated"
  );
  assert.deepEqual(
    corosProgramStated({ sportType: 4, estimatedTime: 1620 }),
    { durationSeconds: 1620, distanceMark: "exact", durationMark: "exact", distanceAwaits: false, durationAwaits: false },
    "no steps to mark it by: stated as COROS has it"
  );
  assert.equal(
    corosProgramStated({ sportType: 1, exercises: easy8.exercises }, { distanceMeters: 7797.96 }).distanceMeters,
    7797.96,
    "what a caller already holds of COROS's estimate stands in for a field the program left out"
  );
}

// 8. The marks, drawn and said.
{
  assert.equal(markFigure("7.80 km", "estimated"), "≈7.80 km");
  assert.equal(markFigure("7.80 km", "atLeast"), "7.80+ km", "the plus follows the number");
  assert.equal(markFigure("4.5 hr", "atLeast"), "4.5+ hr");
  assert.equal(markFigure("1h 12m", "atLeast", "end"), "1h 12m+", "a time in parts takes it at its end");
  assert.equal(markFigure("1400 m", "exact"), "1400 m");
  assert.equal(combineMarks("exact", "estimated", "exact"), "estimated");
  assert.equal(combineMarks("estimated", "atLeast"), "atLeast", "both estimated and short: only at least");
  assert.equal(combineMarks(), "exact");
  assert.equal(figureInWords("7.8 km", "atLeast"), "at least 7.8 km");
  assert.equal(figureInWords("60 min", "estimated"), "about 60 min");
  assert.deepEqual(sessionFigures({ stepCount: 2, distanceSteps: 0, timedSteps: 1, durationSeconds: 2700 }), {});
  const runningCopy = { distance: 0, duration: 0, estimatedDistance: 1407974, estimatedTime: 5883 };
  assert.deepEqual(corosProgramFigures(runningCopy), { distanceMeters: 14079.74, durationSeconds: 5883 });
  assert.deepEqual(
    corosProgramFigures({ planDistance: "1407974.00", planDuration: 5883, estimatedDistance: 1150000, estimatedTime: 1200 }),
    { distanceMeters: 14079.74, durationSeconds: 5883 },
    "`calculate`'s answer comes before the `estimated*` a built program carries"
  );
  assert.deepEqual(corosProgramFigures({ distance: 0, estimatedTime: 0 }), {}, "a 0 is a field nobody filled in");
}

console.log("workout figures OK — COROS's arithmetic (within centimetres) (pace, effort pace, heart rate through the account, nothing for power or cadence), a stored COROS figure first, each figure marked exact, ≈ or +");
