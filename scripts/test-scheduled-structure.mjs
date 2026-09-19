import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "calendar", "scheduledStructure.ts")
);
const {
  buildEditorDraftView,
  buildScheduledWorkoutView,
  formatStepDistanceLabel,
  formatStepTimeLabel,
  liftSchemeLabel
} = await import(`${modUrl.href}?cacheBust=${Date.now()}`);

// --- label helpers ---
assert.equal(formatStepTimeLabel(90), "1:30");
assert.equal(formatStepTimeLabel(600), "10:00");
assert.equal(formatStepTimeLabel(3661), "1:01:01");
assert.equal(formatStepDistanceLabel(800, "metric"), "800 m");
assert.equal(formatStepDistanceLabel(7000, "metric"), "7.00 km");
assert.equal(formatStepDistanceLabel(21097, "metric"), "21.1 km");
assert.equal(formatStepDistanceLabel(1609.344, "imperial"), "1.00 mi");
assert.equal(formatStepDistanceLabel(91.44, "imperial", true), "100 yd");

// --- raw path: simple distance run (mirrors COROS schedule payload) ---
const simpleRun = buildScheduledWorkoutView({
  rawProgram: {
    name: "7km Easy Run",
    sportType: 1,
    exercises: [
      {
        id: "1",
        exerciseType: 2,
        name: "T3001",
        targetType: 5,
        targetValue: 700000,
        intensityType: 0,
        intensityValue: 0,
        sets: 1,
        sortNo: 1
      }
    ]
  }
}, "metric");
assert.equal(simpleRun.source, "raw");
assert.equal(simpleRun.nodes.length, 1);
assert.equal(simpleRun.nodes[0].type, "step");
assert.equal(simpleRun.nodes[0].step.kind, "training");
assert.equal(simpleRun.nodes[0].step.name, "Training"); // T-name → friendly
assert.equal(simpleRun.nodes[0].step.targetLabel, "7.00 km");
assert.equal(simpleRun.nodes[0].step.magnitude, 7000);
assert.equal(simpleRun.nodes[0].step.magnitudeType, "distance");
assert.equal(simpleRun.totals.distanceMeters, 7000);
assert.equal(simpleRun.totals.stepCount, 1);
assert.equal(simpleRun.totals.repeatGroups, 0);

// --- raw path: intervals with a repeat group + pace intensity ---
const intervalRun = buildScheduledWorkoutView({
  rawProgram: {
    name: "Rolling 400s",
    sportType: 1,
    exercises: [
      {
        id: "w",
        exerciseType: 1,
        name: "Warm-up",
        targetType: 2,
        targetValue: 600,
        intensityType: 0,
        sets: 1,
        sortNo: 1
      },
      {
        id: "g1",
        exerciseType: 2,
        name: "Repeat",
        isGroup: true,
        sets: 6,
        sortNo: 2
      },
      {
        id: "i1",
        exerciseType: 2,
        name: "Interval",
        groupId: "g1",
        targetType: 5,
        targetValue: 80000,
        intensityType: 3,
        intensityValue: 240000,
        intensityValueExtend: 250000,
        intensityMultiplier: 1000,
        sets: 1,
        sortNo: 3
      },
      {
        id: "r1",
        exerciseType: 4,
        name: "Rest",
        groupId: "g1",
        targetType: 2,
        targetValue: 90,
        intensityType: 0,
        sets: 1,
        sortNo: 4
      },
      {
        id: "c",
        exerciseType: 3,
        name: "Cool-down",
        targetType: 5,
        targetValue: 100000,
        intensityType: 0,
        sets: 1,
        sortNo: 5
      }
    ]
  }
}, "metric");
assert.equal(intervalRun.nodes.length, 3);
assert.deepEqual(
  intervalRun.nodes.map((node) => node.type),
  ["step", "repeat", "step"]
);
assert.equal(intervalRun.nodes[0].step.kind, "warmup");
assert.equal(intervalRun.nodes[0].step.targetLabel, "10:00");
const group = intervalRun.nodes[1];
assert.equal(group.repeat, 6);
assert.equal(group.steps.length, 2);
assert.equal(group.steps[0].kind, "training");
assert.equal(group.steps[0].targetLabel, "800 m");
assert.equal(group.steps[0].intensityLabel, "4:00–4:10/km");
assert.equal(group.steps[1].kind, "rest");
assert.equal(group.steps[1].targetLabel, "1:30");
assert.equal(group.magnitude, 800); // per-rep distance dominates
assert.equal(group.magnitudeType, "distance");
assert.equal(intervalRun.nodes[2].step.kind, "cooldown");
assert.equal(intervalRun.totals.distanceMeters, 6 * 800 + 1000);
assert.equal(intervalRun.totals.durationSeconds, 600 + 6 * 90);
assert.equal(intervalRun.totals.stepCount, 4);
assert.equal(intervalRun.totals.repeatGroups, 1);

const imperialIntervals = buildScheduledWorkoutView({
  rawProgram: intervalRun.sourceProgram ?? {
    name: "Imperial intervals",
    sportType: 1,
    exercises: [
      {
        id: "i1",
        exerciseType: 2,
        name: "Interval",
        targetType: 5,
        targetValue: 80000,
        intensityType: 3,
        intensityValue: 240000,
        intensityValueExtend: 250000,
        intensityMultiplier: 1000,
        sets: 1,
        sortNo: 1
      }
    ]
  }
}, "imperial");
assert.equal(imperialIntervals.nodes[0].step.targetLabel, "0.50 mi");
assert.equal(imperialIntervals.nodes[0].step.intensityLabel, "6:26–6:42/mi");

// --- raw path: strength exercises (sets × reps @ weight) ---
const strength = buildScheduledWorkoutView({
  rawProgram: {
    name: "Lower Body",
    sportType: 13,
    exercises: [
      {
        id: "s1",
        exerciseType: 2,
        name: "Back Squat",
        targetType: 3,
        targetValue: 10,
        intensityType: 1,
        // COROS stores a weight intensity in grams: 60000 is 60 kg.
        intensityValue: 60_000,
        sets: 3,
        sortNo: 1
      },
      {
        id: "s2",
        exerciseType: 2,
        name: "Walking Lunge",
        targetType: 3,
        targetValue: 12,
        intensityType: 1,
        intensityValue: 24_000,
        sets: 3,
        sortNo: 2
      }
    ]
  }
}, "metric");
assert.equal(strength.nodes.length, 2);
assert.equal(strength.nodes[0].step.sets, 3);
assert.equal(strength.nodes[0].step.reps, 10);
assert.equal(strength.nodes[0].step.weight, 60);
assert.equal(strength.nodes[0].step.weightUnit, "kg");
assert.equal(strength.nodes[0].step.targetLabel, "10 reps");
assert.equal(strength.nodes[1].step.weight, 24);

const imperialStrength = buildScheduledWorkoutView({
  rawProgram: {
    name: "Imperial strength",
    sportType: 13,
    exercises: [{
      id: "s1",
      exerciseType: 2,
      name: "Back Squat",
      targetType: 3,
      targetValue: 10,
      intensityType: 1,
      intensityValue: 10_000,
      sets: 3,
      sortNo: 1
    }]
  }
}, "imperial");
assert.equal(imperialStrength.nodes[0].step.weight, 10);
assert.equal(imperialStrength.nodes[0].step.weightUnit, "kg");
assert.match(imperialStrength.nodes[0].step.intensityLabel, /22(?:\.0)? lb/);

// --- fallback path: pre-parsed exercises without rawProgram ---
const fallback = buildScheduledWorkoutView({
  exercises: [
    { name: "Warm-up", targetLabel: "10:00", sets: 1 },
    { name: "Easy Run", targetLabel: "7.00 km", sets: 1 },
    { name: "Cool Down Jog", targetLabel: "5:00", sets: 1 }
  ]
}, "metric");
assert.equal(fallback.source, "parsed");
assert.equal(fallback.nodes.length, 3);
assert.equal(fallback.nodes[0].step.kind, "warmup");
assert.equal(fallback.nodes[0].step.magnitude, 600);
assert.equal(fallback.nodes[0].step.magnitudeType, "time");
assert.equal(fallback.nodes[1].step.kind, "training");
assert.equal(fallback.nodes[1].step.magnitude, 7000);
assert.equal(fallback.nodes[2].step.kind, "cooldown");
assert.equal(fallback.totals.distanceMeters, 7000);
assert.equal(fallback.totals.durationSeconds, 900);

// --- fallback path: strength keeps sets/reps/weight ---
const fallbackStrength = buildScheduledWorkoutView({
  exercises: [
    { name: "Bench Press", sets: 4, reps: 8, weight: 80, targetLabel: "8 reps" }
  ]
}, "metric");
assert.equal(fallbackStrength.nodes[0].step.sets, 4);
assert.equal(fallbackStrength.nodes[0].step.reps, 8);
assert.equal(fallbackStrength.nodes[0].step.weight, 80);
assert.equal(fallbackStrength.nodes[0].step.weightUnit, "kg");

// --- empty entry ---
const empty = buildScheduledWorkoutView({}, "metric");
assert.equal(empty.nodes.length, 0);
assert.equal(empty.totals.stepCount, 0);
assert.equal(empty.totals.distanceMeters, undefined);

/* ------------------------------------------------------------------ *
 * The editor-draft path. The Calendar's read-only workout view is built
 * from a `RunWorkoutEditorDraft` rather than a COROS payload — a library
 * workout is only ever fetched through the editor's document — so the same
 * view has a second builder, and these are the places the two could drift.
 * ------------------------------------------------------------------ */

const step = (over) => ({
  id: over.id ?? "s1",
  nodeType: "step",
  kind: "training",
  name: "Training",
  target: { type: "open" },
  intensity: { type: "none" },
  editable: true,
  ...over
});

// --- draft: a cardio session with a warm-up, a repeat and a cool-down ---
const draftIntervals = buildEditorDraftView(
  {
    sport: "run",
    nodes: [
      step({ id: "w", kind: "warmup", name: "Warm Up", target: { type: "time", seconds: 600 } }),
      {
        id: "g1",
        nodeType: "repeat",
        name: "Repeat",
        repeat: 5,
        editable: true,
        steps: [
          step({
            id: "fast",
            target: { type: "distance", meters: 400 },
            intensity: { type: "pace", lowSecondsPerKm: 240, highSecondsPerKm: 250, displayUnit: "km" }
          }),
          step({ id: "easy", kind: "rest", name: "Rest", target: { type: "time", seconds: 90 } })
        ]
      },
      step({ id: "c", kind: "cooldown", name: "Cool Down", target: { type: "time", seconds: 300 } })
    ]
  },
  "metric"
);
assert.equal(draftIntervals.source, "raw");
assert.equal(draftIntervals.nodes.length, 3);
assert.equal(draftIntervals.nodes[0].step.targetLabel, "10:00");
assert.equal(draftIntervals.nodes[0].step.magnitudeType, "time");
assert.equal(draftIntervals.nodes[1].type, "repeat");
assert.equal(draftIntervals.nodes[1].repeat, 5);
assert.equal(draftIntervals.nodes[1].steps[0].targetLabel, "400 m");
assert.equal(draftIntervals.nodes[1].steps[0].intensityLabel, "4:00–4:10/km");
// Distance wins the group's own magnitude, as it does on the raw path.
assert.equal(draftIntervals.nodes[1].magnitudeType, "distance");
assert.equal(draftIntervals.nodes[1].magnitude, 400);
// A repeat multiplies its children into the totals.
assert.equal(draftIntervals.totals.distanceMeters, 2000);
assert.equal(draftIntervals.totals.durationSeconds, 600 + 90 * 5 + 300);
assert.equal(draftIntervals.totals.stepCount, 4);
assert.equal(draftIntervals.totals.repeatGroups, 1);

// --- draft: pace follows the reader's units, like the raw path ---
const draftImperial = buildEditorDraftView(
  {
    sport: "run",
    nodes: [
      step({
        target: { type: "distance", meters: 1609.344 },
        intensity: { type: "pace", lowSecondsPerKm: 300, highSecondsPerKm: 300, displayUnit: "km" }
      })
    ]
  },
  "imperial"
);
assert.equal(draftImperial.nodes[0].step.targetLabel, "1.00 mi");
assert.equal(draftImperial.nodes[0].step.intensityLabel, "8:03–8:03/mi");

// --- draft: strength keeps sets, reps and weight in kilograms ---
const draftStrength = buildEditorDraftView(
  {
    sport: "strength",
    nodes: [
      step({
        exerciseId: "425831217146019840",
        exerciseName: "T1041",
        sets: 4,
        restValue: 90,
        target: { type: "reps", count: 8 },
        intensity: { type: "weight", mode: "weight", value: 80, unit: "kg" }
      })
    ]
  },
  "metric",
  new Map([["425831217146019840", { name: "Bench Press" }]])
);
assert.equal(draftStrength.nodes[0].step.name, "Bench Press");
assert.equal(draftStrength.nodes[0].step.sets, 4);
assert.equal(draftStrength.nodes[0].step.reps, 8);
assert.equal(draftStrength.nodes[0].step.weight, 80);
assert.equal(draftStrength.nodes[0].step.weightUnit, "kg");
assert.equal(draftStrength.nodes[0].step.targetLabel, "8 reps");
// Reps are neither a distance nor a duration, so the session totals neither.
assert.equal(draftStrength.totals.distanceMeters, undefined);
assert.equal(draftStrength.totals.durationSeconds, undefined);

// --- draft: a COROS localization key is never shown ---
// `exerciseName` on a COROS-built workout is "T1041", not a name. Without the
// catalog the step falls back to its kind rather than printing the key.
const draftNoCatalog = buildEditorDraftView(
  {
    sport: "strength",
    nodes: [step({ exerciseId: "425831217146019840", exerciseName: "T1041" })]
  },
  "metric"
);
assert.equal(draftNoCatalog.nodes[0].step.name, "Training");

// --- draft: a zero-length target reads as Open, not "0 m" ---
const draftOpen = buildEditorDraftView(
  {
    sport: "run",
    nodes: [
      step({ id: "a", target: { type: "distance", meters: 0 } }),
      step({ id: "b", target: { type: "time", seconds: 0 } }),
      step({ id: "c", target: { type: "open" } })
    ]
  },
  "metric"
);
assert.deepEqual(
  draftOpen.nodes.map((node) => node.step.targetLabel),
  ["Open", "Open", "Open"]
);
assert.equal(draftOpen.totals.distanceMeters, undefined);

// --- draft: an empty workout has nodes to render nothing for ---
const draftEmpty = buildEditorDraftView({ sport: "run", nodes: [] }, "metric");
assert.equal(draftEmpty.nodes.length, 0);
assert.equal(draftEmpty.totals.stepCount, 0);

/* ------------------------------------------------------------------ *
 * What one exercise asks for, in one line. The set count multiplies the
 * target, because "12 reps", "0:45" and "Open" are all what one set holds.
 * ------------------------------------------------------------------ */

assert.equal(liftSchemeLabel({ sets: 3, reps: 12, targetLabel: "12 reps" }), "3 × 12 reps");
assert.equal(liftSchemeLabel({ sets: 4, targetLabel: "0:45" }), "4 × 0:45");
// An open exercise says so rather than showing nothing.
assert.equal(liftSchemeLabel({ sets: 3, targetLabel: "Open" }), "3 × Open");
assert.equal(liftSchemeLabel({ sets: 1, targetLabel: "Open" }), "Open");
// One set does not multiply.
assert.equal(liftSchemeLabel({ sets: 1, reps: 10, targetLabel: "10 reps" }), "10 reps");
assert.equal(liftSchemeLabel({ targetLabel: "12 reps" }), "12 reps");
// No target at all: the sets are still worth saying, alone.
assert.equal(liftSchemeLabel({ sets: 3 }), "3 sets");
assert.equal(liftSchemeLabel({}), undefined);
// Reps with no label (the pre-parsed fallback path) still read as reps.
assert.equal(liftSchemeLabel({ sets: 2, reps: 8 }), "2 × 8 reps");

// --- the id that reaches the demonstration clip ---
// The draft carries it directly; COROS keeps it on `originId`, where "0"
// means the step was not built from a catalog movement.
const withOrigin = buildScheduledWorkoutView({
  rawProgram: {
    sportType: 4,
    exercises: [
      { id: "1", exerciseType: 2, name: "T1041", originId: "425831217146019840", targetType: 1, sortNo: 1 },
      { id: "2", exerciseType: 2, name: "T1042", originId: "0", targetType: 1, sortNo: 2 },
      { id: "3", exerciseType: 2, name: "T1043", targetType: 1, sortNo: 3 }
    ]
  }
}, "metric");
assert.equal(withOrigin.nodes[0].step.exerciseId, "425831217146019840");
assert.equal(withOrigin.nodes[1].step.exerciseId, undefined);
assert.equal(withOrigin.nodes[2].step.exerciseId, undefined);

const draftWithExercise = buildEditorDraftView(
  {
    sport: "strength",
    nodes: [step({ exerciseId: "425831217146019840", sets: 3, target: { type: "reps", count: 12 } })]
  },
  "metric"
);
assert.equal(draftWithExercise.nodes[0].step.exerciseId, "425831217146019840");
assert.equal(liftSchemeLabel(draftWithExercise.nodes[0].step), "3 × 12 reps");

// A strength step COROS left open reads "Open", not blank.
const draftOpenLift = buildEditorDraftView(
  {
    sport: "strength",
    nodes: [step({ sets: 3, target: { type: "open" } })]
  },
  "metric"
);
assert.equal(liftSchemeLabel(draftOpenLift.nodes[0].step), "3 × Open");

// --- a weight of zero is no weight ---
// COROS writes `value: 0` for an exercise with no load prescribed; bodyweight
// has its own mode, so "0.0 kg" would be a figure standing in for nothing.
const draftZeroLoad = buildEditorDraftView(
  {
    sport: "strength",
    nodes: [
      step({ id: "z", sets: 2, target: { type: "time", seconds: 60 }, intensity: { type: "weight", mode: "weight", value: 0, unit: "kg" } }),
      step({ id: "b", sets: 2, target: { type: "time", seconds: 60 }, intensity: { type: "weight", mode: "bodyweight" } }),
      step({ id: "l", sets: 3, target: { type: "reps", count: 5 }, intensity: { type: "weight", mode: "weight", value: 60, unit: "kg" } })
    ]
  },
  "metric"
);
assert.equal(draftZeroLoad.nodes[0].step.intensityLabel, undefined);
assert.equal(draftZeroLoad.nodes[0].step.weight, undefined);
assert.equal(draftZeroLoad.nodes[1].step.intensityLabel, "Bodyweight");
assert.equal(draftZeroLoad.nodes[2].step.intensityLabel, "60 kg");
assert.equal(draftZeroLoad.nodes[2].step.weight, 60);
assert.equal(liftSchemeLabel(draftZeroLoad.nodes[0].step), "2 × 1:00");

console.log("scheduled-structure tests passed");
