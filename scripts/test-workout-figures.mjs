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
const { corosProgramFigures, estimateWorkoutFigures, sessionFigures, statedWorkoutFigures, stepFigures, workoutFigures } =
  await load("workoutFigures.js");
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

// 2. Distance steps take time at the step's speed; with no intensity there is no time to state.
{
  assert.equal(estimateWorkoutFigures(run([dist(5000, hr(140, 140))]), context).durationSeconds, 2176);
  assert.equal(estimateWorkoutFigures(run([dist(5000, hr(175, 175))]), context).durationSeconds, 1564);
  assert.equal(estimateWorkoutFigures(run([dist(3000, pace(300, 330))]), context).durationSeconds, 945, "the middle of a pace band");
  assert.deepEqual(estimateWorkoutFigures(run([dist(5000)]), context), { distanceMeters: 5000 }, "no intensity, no time");
  assert.equal(
    estimateWorkoutFigures(run([dist(7000), dist(500, hr(140, 140))]), context).durationSeconds,
    undefined,
    "COROS would say 3:38 for 7.5 km, counting the warm-up at 0 s; that is a sum over some steps"
  );
}

// 3. Pace and effort pace convert; power, cadence and nothing do not (COROS counts them at 0);
//    a rest with no target stands still, as COROS has it; an open step has no length.
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
    undefined,
    "an untargeted warm-up is not 0 m, whatever COROS adds"
  );
  assert.deepEqual(estimateWorkoutFigures(run([{ kind: "training", target_type: "open", intensity: hr(140, 140) }]), context), {});
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

// 5. What cannot be worked out is not stated: no account for heart rate, a ride, a strength set.
{
  assert.deepEqual(estimateWorkoutFigures(run(LONG_RUN)), {}, "heart rate waits for the account");
  assert.deepEqual(estimateWorkoutFigures(run(LONG_RUN, "bike"), context), {}, "COROS converts nothing on a ride");
  assert.deepEqual(estimateWorkoutFigures({ sport: "strength", steps: [{ kind: "training", target_type: "reps", target_reps: 12 }] }, context), {});
}

// 6. The rule: COROS's stored figure, else its arithmetic, else a sum only when every step is in its unit.
{
  assert.deepEqual(workoutFigures(run(LONG_RUN), { context }), { distanceMeters: 14079.74, durationSeconds: 5883 });
  assert.deepEqual(
    workoutFigures(run(LONG_RUN), { coros: { distanceMeters: 14100, durationSeconds: 5900 }, context }),
    { distanceMeters: 14100, durationSeconds: 5900 },
    "a stored COROS figure outranks the arithmetic"
  );
  assert.deepEqual(workoutFigures(run(LONG_RUN)), {}, "11.5 km of steps is not a 14 km run's distance");
  assert.deepEqual(
    statedWorkoutFigures(run(LONG_RUN)),
    { distanceMeters: 11500, durationSeconds: 1200, distanceWhole: false, durationWhole: false },
    "a screen may still name the partial sums as such"
  );
  assert.deepEqual(
    workoutFigures({ sport: "bike", steps: [dist(20000, hr(140, 140)), dist(10000, hr(150, 150))] }, { context }),
    { distanceMeters: 30000 },
    "every step in distance: their sum is the session's"
  );
  assert.deepEqual(workoutFigures({ sport: "run", distance_km: 8 }), { distanceMeters: 8000 }, "a simple run's distance");
}

// 7. The pieces the rule is built from.
{
  assert.deepEqual(stepFigures(LONG_RUN), { distanceMeters: 11500, durationSeconds: 1200, stepCount: 4, distanceSteps: 2, timedSteps: 2 });
  assert.equal(
    stepFigures([{ kind: "training", target_distance_meters: 8000, target_duration_seconds: 1920 }]).durationSeconds,
    undefined,
    "a step is in one unit: with no `target_type`, distance first, as the write reads it"
  );
  assert.deepEqual(sessionFigures(stepFigures([timed(2700), { kind: "cooldown", target_type: "open" }])), {});
  const runningCopy = { distance: 0, duration: 0, estimatedDistance: 1407974, estimatedTime: 5883 };
  assert.deepEqual(corosProgramFigures(runningCopy), { distanceMeters: 14079.74, durationSeconds: 5883 });
  assert.deepEqual(
    corosProgramFigures({ planDistance: "1407974.00", planDuration: 5883, estimatedDistance: 1150000, estimatedTime: 1200 }),
    { distanceMeters: 14079.74, durationSeconds: 5883 },
    "`calculate`'s answer comes before the `estimated*` a built program carries"
  );
  assert.deepEqual(corosProgramFigures({ distance: 0, estimatedTime: 0 }), {}, "a 0 is a field nobody filled in");
}

console.log("workout figures OK — COROS's arithmetic (within centimetres) (pace, effort pace, heart rate through the account, nothing for power or cadence), a stored COROS figure first, a sum only when every step is in its unit");
