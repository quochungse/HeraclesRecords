// What a new workout step starts out holding — `electron/workoutDefaults.ts`.
//
// The point of that file is that a step is valid the moment it appears, so
// assertion 1 is the whole suite in miniature: every (sport, step kind,
// inside/outside a repeat) combination is run through the app's own
// validators. Everything else states a rule the table was built on, so that
// breaking one fails here rather than on somebody's watch.
//
// Run with:
//   npm run test:workout-defaults
//
// It goes through Electron rather than plain `node` for the reason the other
// strip-types suites do: the module graph has extensionless `.ts` imports, so
// it needs the resolver hook, and a distro Node built without Amaro cannot
// run `--experimental-strip-types` at all. Electron ships one that can.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) => import(`${pathToFileURL(path.join(repoRoot, file)).href}${bust}`);

const { resolveStepDefaults } = await load("electron/workoutDefaults.ts");
const {
  HEART_RATE_PRESETS,
  WORKOUT_SPORTS,
  WORKOUT_SPORT_CAPABILITIES,
  validateWorkoutIntensity,
  validateWorkoutTarget,
  workoutIntensitiesForStep,
  workoutTargetsForStep
} = await load("electron/workoutCapabilities.ts");
const { EXERCISE_SEARCH_MOVEMENTS } = await load("electron/exerciseCatalogSearch.ts");

let failures = 0;
const check = (label, run) => {
  try {
    run();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}\n      ${error.message}`);
  }
};

/** Every combination the builder can ask for. */
function* everyStep() {
  for (const sport of WORKOUT_SPORTS) {
    for (const stepKind of WORKOUT_SPORT_CAPABILITIES[sport].stepKinds) {
      for (const insideRepeat of [false, true]) {
        yield { sport, stepKind, insideRepeat };
      }
    }
  }
}

const FULL_CONTEXT = {
  distanceUnit: "metric",
  paceUnit: "km",
  heartRateBasis: "maxHr",
  maxHr: 190,
  restingHr: 48,
  lthrBpm: 172,
  thresholdPaceSecondsPerKm: 255,
  ftp: 240,
  criticalPower: 300,
  zones: {},
  lthrZones: [],
  defaultPoolLength: { value: 25, unit: "m" },
  climbSystems: {}
};

const EMPTY_CONTEXT = {
  distanceUnit: "metric",
  paceUnit: "km",
  heartRateBasis: "maxHr",
  zones: {},
  lthrZones: [],
  defaultPoolLength: { value: 25, unit: "m" },
  climbSystems: {}
};

// ---------------------------------------------------------------------------

console.log("1. Every default is a step COROS would accept");
check("targets and intensities pass the app's own validators", () => {
  for (const step of everyStep()) {
    for (const context of [FULL_CONTEXT, EMPTY_CONTEXT, undefined]) {
      const defaults = resolveStepDefaults({ ...step, context });
      const where = `${step.sport}/${step.stepKind}${step.insideRepeat ? " (in repeat)" : ""}`
        + `${context === FULL_CONTEXT ? "" : context ? " [no thresholds]" : " [no context]"}`;
      assert.equal(
        validateWorkoutTarget(step.sport, step.stepKind, defaults.target),
        undefined,
        `${where}: ${validateWorkoutTarget(step.sport, step.stepKind, defaults.target)}`
      );
      assert.equal(
        validateWorkoutIntensity(step.sport, defaults.intensity, step.stepKind),
        undefined,
        `${where}: ${validateWorkoutIntensity(step.sport, defaults.intensity, step.stepKind)}`
      );
    }
  }
});

console.log("2. A default only offers what the sport offers");
check("target and intensity types are in the capability lists", () => {
  for (const step of everyStep()) {
    const defaults = resolveStepDefaults({ ...step, context: FULL_CONTEXT });
    const where = `${step.sport}/${step.stepKind}`;
    assert.ok(
      workoutTargetsForStep(step.sport, step.stepKind).includes(defaults.target.type),
      `${where}: target ${defaults.target.type} is not offered`
    );
    assert.ok(
      workoutIntensitiesForStep(step.sport, step.stepKind).includes(defaults.intensity.type),
      `${where}: intensity ${defaults.intensity.type} is not offered`
    );
  }
});

console.log("3. Nothing invents a training load");
check("no default targets load", () => {
  for (const step of everyStep()) {
    for (const context of [FULL_CONTEXT, EMPTY_CONTEXT]) {
      const { target } = resolveStepDefaults({ ...step, context });
      assert.notEqual(
        target.type,
        "load",
        `${step.sport}/${step.stepKind} defaults to a load, which COROS reports as 0 on every list row`
      );
    }
  }
});

console.log("4. Nothing invents a weight");
check("no default states an added load", () => {
  for (const step of everyStep()) {
    const { intensity } = resolveStepDefaults({ ...step, context: FULL_CONTEXT });
    assert.ok(
      intensity.type !== "weight" || intensity.mode === "bodyweight",
      `${step.sport}/${step.stepKind} prefills an added weight`
    );
  }
});

console.log("5. A zone with no threshold behind it degrades");
check("no percent-of-threshold default survives an empty context", () => {
  for (const step of everyStep()) {
    const { intensity } = resolveStepDefaults({ ...step, context: EMPTY_CONTEXT });
    assert.ok(
      !["ftpPercent", "thresholdPacePercent", "effortPacePercent", "heartRatePercent"]
        .includes(intensity.type),
      `${step.sport}/${step.stepKind} keeps ${intensity.type} with no threshold to compute it from`
    );
  }
});

check("the same steps do use those zones once the thresholds are there", () => {
  const bike = resolveStepDefaults({
    sport: "bike",
    stepKind: "training",
    context: FULL_CONTEXT
  });
  assert.equal(bike.intensity.type, "ftpPercent");
  const run = resolveStepDefaults({
    sport: "run",
    stepKind: "training",
    context: FULL_CONTEXT
  });
  assert.equal(run.intensity.type, "thresholdPacePercent");
});

check("an FTP zone falls back to the heart-rate band that means the same", () => {
  const withHr = resolveStepDefaults({
    sport: "bike",
    stepKind: "training",
    context: { ...FULL_CONTEXT, ftp: undefined }
  });
  assert.equal(withHr.intensity.type, "heartRatePercent");
  // Not the same *name*: COROS calls this band "Aerobic Endurance" on the
  // power and pace families and "Aerobic" on Max HR, which is the family a
  // default states its zones against.
  assert.equal(withHr.intensity.preset, "aerobic");
});

console.log("5b. A zone is stated in the family the account is scored in");
check("the same band is named as COROS names it, per family", () => {
  // COROS calls the easy aerobic band "Aerobic" on Max HR and "Aerobic
  // Endurance" on the other two, so a default has to be restated rather than
  // carried across — the preset name would otherwise not be in the list the
  // athlete is shown.
  const band = (heartRateBasis) => resolveStepDefaults({
    sport: "trailRun",
    stepKind: "training",
    context: { ...FULL_CONTEXT, heartRateBasis }
  }).intensity;
  assert.deepEqual(band("maxHr"), {
    type: "heartRatePercent", basis: "maxHr", preset: "aerobic"
  });
  assert.deepEqual(band("reserve"), {
    type: "heartRatePercent", basis: "reserve", preset: "aerobicEndurance"
  });
  assert.deepEqual(band("lthr"), {
    type: "heartRatePercent", basis: "lthr", preset: "aerobicEndurance"
  });
});

check("every restated zone is a preset that family actually offers", () => {
  for (const heartRateBasis of ["maxHr", "reserve", "lthr"]) {
    const offered = new Set(HEART_RATE_PRESETS[heartRateBasis].map((zone) => zone.preset));
    for (const step of everyStep()) {
      const { intensity } = resolveStepDefaults({
        ...step,
        context: { ...FULL_CONTEXT, heartRateBasis }
      });
      if (intensity.type !== "heartRatePercent") continue;
      assert.equal(intensity.basis, heartRateBasis);
      assert.ok(
        offered.has(intensity.preset),
        `${step.sport}/${step.stepKind}: ${heartRateBasis} has no zone called ${intensity.preset}`
      );
    }
  }
});

console.log("6. A swim distance is a whole number of lengths");
check("distances snap to the athlete's pool", () => {
  for (const pool of [
    { value: 25, unit: "m" },
    { value: 33.33, unit: "m" },
    { value: 50, unit: "m" },
    { value: 25, unit: "yd" }
  ]) {
    const meters = pool.unit === "yd" ? pool.value * 0.9144 : pool.value;
    for (const stepKind of ["warmup", "training", "cooldown", "sendOff"]) {
      for (const insideRepeat of [false, true]) {
        const { target } = resolveStepDefaults({
          sport: "swim",
          stepKind,
          insideRepeat,
          context: { ...FULL_CONTEXT, defaultPoolLength: pool }
        });
        if (target.type !== "distance") continue;
        const lengths = target.meters / meters;
        assert.ok(
          Math.abs(lengths - Math.round(lengths)) * meters <= 0.5,
          `${stepKind} in a ${pool.value}${pool.unit} pool is ${target.meters} m,`
          + ` which is ${lengths.toFixed(2)} lengths`
        );
        assert.ok(lengths >= 1, `${stepKind} is shorter than one length`);
      }
    }
  }
});

console.log("7. Table B — every movement pattern has an entry");
check("Table B covers all of EXERCISE_SEARCH_MOVEMENTS", () => {
  const source = readFileSync(path.join(repoRoot, "electron/workoutDefaults.ts"), "utf8");
  const table = source.slice(
    source.indexOf("const MOVEMENT_DEFAULTS"),
    source.indexOf("const MOVEMENT_PRIORITY")
  );
  assert.ok(table.length > 0, "MOVEMENT_DEFAULTS is missing");
  for (const movement of EXERCISE_SEARCH_MOVEMENTS) {
    assert.match(
      table,
      new RegExp(`\\b${movement}:`),
      `movement pattern "${movement}" has no default`
    );
  }
});

const strength = (exerciseName) => resolveStepDefaults({
  sport: "strength",
  stepKind: "training",
  exerciseName,
  context: FULL_CONTEXT
});

check("the movement decides reps, sets and recovery", () => {
  assert.deepEqual(strength("Barbell Deadlift").target, { type: "reps", count: 6 });
  assert.equal(strength("Barbell Deadlift").sets, 4);
  assert.equal(strength("Barbell Deadlift").restSeconds, 150);
  assert.deepEqual(strength("Dumbbell Bench Press").target, { type: "reps", count: 8 });
  assert.deepEqual(strength("Walking Lunge").target, { type: "reps", count: 10 });
  assert.deepEqual(strength("Farmers Carry").target, { type: "time", seconds: 45 });
});

check("a held movement is counted in seconds, whatever it files under", () => {
  assert.deepEqual(strength("Plank").target, { type: "time", seconds: 45 });
  // A wall sit files as a squat; the hold decides the target, the squat still
  // decides the sets and the recovery.
  const wallSit = strength("Wall Sit");
  assert.deepEqual(wallSit.target, { type: "time", seconds: 45 });
  assert.equal(wallSit.sets, 4);
  assert.equal(wallSit.restSeconds, 120);
});

check("mobility work is one set, briefly", () => {
  const stretch = strength("Hamstring Stretch");
  assert.deepEqual(stretch.target, { type: "time", seconds: 45 });
  assert.equal(stretch.sets, 1);
  assert.deepEqual(stretch.intensity, { type: "none" });
});

check("equipment decides the load mode and nothing else", () => {
  // Same movement, same reps; only what it says about load differs.
  assert.deepEqual(strength("Barbell Squat").target, strength("Bodyweight Squat").target);
  assert.deepEqual(strength("Barbell Squat").intensity, { type: "none" });
  assert.deepEqual(strength("Push Up").intensity, { type: "weight", mode: "bodyweight" });
  assert.deepEqual(strength("Cable Row").intensity, { type: "none" });
  assert.deepEqual(strength("Kettlebell Swing").intensity, { type: "none" });
});

check("a movement no rule recognises still yields a valid step", () => {
  const unknown = strength("Zercher Anderson Squat Variation From Pins");
  assert.equal(
    validateWorkoutTarget("strength", "training", unknown.target),
    undefined
  );
  assert.equal(
    validateWorkoutIntensity("strength", unknown.intensity, "training"),
    undefined
  );
});

console.log("7b. Table C — a Hybrid Fitness station");
const station = (exerciseName, insideRepeat = false) => resolveStepDefaults({
  sport: "hyrox",
  stepKind: "training",
  exerciseName,
  insideRepeat,
  context: FULL_CONTEXT
});

check("the competition distance is what a station starts at", () => {
  assert.deepEqual(station("SkiErg").target, { type: "distance", meters: 1000 });
  assert.deepEqual(station("Sled Push").target, { type: "distance", meters: 50 });
  assert.deepEqual(station("Sled Pull").target, { type: "distance", meters: 50 });
  assert.deepEqual(station("Burpee Broad Jump").target, { type: "distance", meters: 80 });
  assert.deepEqual(station("Rowing").target, { type: "distance", meters: 1000 });
  assert.deepEqual(station("Farmers Carry").target, { type: "distance", meters: 200 });
  assert.deepEqual(station("Sandbag Lunges").target, { type: "distance", meters: 100 });
  assert.deepEqual(station("Wall Balls").target, { type: "reps", count: 100 });
});

check("inside a repeat the long pieces halve and the short ones do not", () => {
  assert.deepEqual(station("SkiErg", true).target, { type: "distance", meters: 500 });
  assert.deepEqual(station("Rowing", true).target, { type: "distance", meters: 500 });
  assert.deepEqual(station("Farmers Carry", true).target, { type: "distance", meters: 100 });
  assert.deepEqual(station("Wall Balls", true).target, { type: "reps", count: 50 });
  assert.deepEqual(station("Sled Push", true).target, { type: "distance", meters: 50 });
  assert.deepEqual(station("Burpee Broad Jump", true).target, { type: "distance", meters: 80 });
});

check("a station nothing recognises falls back rather than guessing", () => {
  assert.deepEqual(station("Some New Station").target, { type: "time", seconds: 300 });
});

console.log("8. A Hybrid Fitness station stays legal whatever it is");
check("every exercise kind, known or not, yields a valid step", () => {
  for (const exerciseKind of [1, 2, 3, 4, 5, 6, 7, 8, 11, 99, undefined]) {
    for (const exerciseName of [
      "SkiErg", "Sled Push", "Sled Pull", "Burpee Broad Jump", "Rowing",
      "Farmers Carry", "Sandbag Lunges", "Wall Balls", "Running",
      "Something COROS Has Not Shipped"
    ]) {
      for (const insideRepeat of [false, true]) {
        const defaults = resolveStepDefaults({
          sport: "hyrox",
          stepKind: "training",
          insideRepeat,
          exerciseKind,
          exerciseName,
          context: FULL_CONTEXT
        });
        const where = `hyrox kind ${exerciseKind} / ${exerciseName}`;
        assert.ok(
          workoutTargetsForStep("hyrox", "training", exerciseKind).includes(defaults.target.type),
          `${where}: target ${defaults.target.type} is not offered`
        );
        assert.ok(
          workoutIntensitiesForStep("hyrox", "training", exerciseKind)
            .includes(defaults.intensity.type),
          `${where}: intensity ${defaults.intensity.type} is not offered`
        );
        assert.equal(
          validateWorkoutTarget("hyrox", "training", defaults.target, exerciseKind),
          undefined,
          `${where}: ${validateWorkoutTarget("hyrox", "training", defaults.target, exerciseKind)}`
        );
      }
    }
  }
});

console.log("9. The module stays importable by the renderer");
check("workoutDefaults.ts has no node: imports", () => {
  const source = readFileSync(path.join(repoRoot, "electron/workoutDefaults.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /from\s+"node:/,
    "a node: import here breaks the renderer build, which imports this file directly"
  );
});

console.log("10. The defaults are a pure function");
check("the same input answers the same way", () => {
  for (const step of everyStep()) {
    const first = resolveStepDefaults({ ...step, context: FULL_CONTEXT });
    const second = resolveStepDefaults({ ...step, context: FULL_CONTEXT });
    assert.deepEqual(first, second, `${step.sport}/${step.stepKind} is not stable`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll workout default checks passed.");
