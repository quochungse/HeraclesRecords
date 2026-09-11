import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildPlanPreview,
  buildWorkoutPayload,
  formatEntryStepsSummary,
  validatePlanDraft
} = await import(`${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`);
const { buildDraftTrainingPlanInputSchema, buildDraftWorkoutInputSchema } = await import(
  `${distUrl("workoutCapabilities.js")}?cacheBust=${Date.now()}`
);
const {
  buildTrainingPlanDestinationInput,
  buildTrainingPlanUploadInput,
  isChatWorkoutTool
} = await import(
  `${distUrl("chatWorkoutTools.js")}?cacheBust=${Date.now()}`
);
const {
  classifyWorkoutExerciseName,
  searchWorkoutExerciseCatalog
} = await import(`${distUrl("exerciseCatalogSearch.js")}?cacheBust=${Date.now()}`);

const strengthCatalog = [
  { originId: "1045", displayName: "Dumbbell Flys" },
  { originId: "1334", displayName: "Lateral Raise Machine" },
  { originId: "1337", displayName: "Shoulder Press Machine" },
  { originId: "1338", displayName: "Chest Press Machine" },
  { originId: "1341", displayName: "Triceps Pushdown Machine" },
  { originId: "1004", displayName: "Push Ups" },
  { originId: "1053", displayName: "Seated Cable Row" }
];

assert.equal(isChatWorkoutTool("search_coros_exercises"), true);
assert.equal(isChatWorkoutTool("draft_workout"), true);

assert.deepEqual(
  classifyWorkoutExerciseName("Chest Press Machine").equipment,
  ["machine"]
);
assert.deepEqual(
  classifyWorkoutExerciseName("Dumbbell Flys").targetMuscles,
  ["chest", "triceps", "shoulders"]
);
assert.equal(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    query: "machine chest press",
    limit: 3
  })[0]?.id,
  "1338"
);
assert.deepEqual(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    targetMuscles: ["chest"],
    equipment: ["machine"]
  }).map((entry) => entry.id),
  ["1338"]
);
assert.ok(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    targetMuscles: ["triceps"],
    equipment: ["machine"]
  }).some((entry) => entry.id === "1341")
);
assert.deepEqual(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    movementPatterns: ["pull"],
    equipment: ["cable"]
  }).map((entry) => entry.id),
  ["1053"]
);

const draft = {
  name: "Test Week",
  workouts: [
    {
      key: "intervals",
      name: "400 Repeats",
      schedule_date: "20991201",
      steps: [
        {
          repeat: 6,
          steps: [
            {
              kind: "training",
              target_type: "distance",
              target_distance_meters: 400,
              pace: "4:30/km"
            },
            {
              kind: "rest",
              target_type: "time",
              target_duration_seconds: 90
            }
          ]
        }
      ]
    }
  ]
};

const validation = validatePlanDraft(draft, { todayDay: "20260101" });
assert.equal(validation.ok, true);

const stepsSummary = formatEntryStepsSummary(draft.workouts[0]);
assert.match(stepsSummary ?? "", /6x/);

const preview = buildPlanPreview("draft-test-1", draft);
assert.equal(preview.entries[0]?.sport, "run");
assert.equal(preview.entries[0]?.stepsSummary, stepsSummary);
assert.match(preview.entries[0]?.stepsSummary ?? "", /training/);

// --- One workout schema for every sport, not one branch per sport ---
//
// The schema used to `oneOf` over all nine sports, and since a repeat group
// carries steps of its own, the step schema appeared twice in each branch: 67 kB
// across the two draft tools, ~33,700 tokens re-sent on every request round of
// every conversation. The per-sport rules live in the capability guide and in
// `validateWorkoutDraftShared`, which the draft tools run and whose errors go
// back to the model.
const schema = buildDraftTrainingPlanInputSchema();
const workoutItem = schema.properties.workouts.items;
assert.equal(workoutItem.oneOf, undefined, "one workout shape, not nine branches");
assert.deepEqual(
  new Set(workoutItem.properties.sport.enum),
  new Set(["run", "trailRun", "bike", "swim", "strength", "xcSki", "indoorClimb", "bouldering", "hyrox"])
);
assert.equal(workoutItem.properties.sport.default, "run");
// Both sport-specific option blocks stay reachable; the validator refuses the
// ones that do not belong to the chosen sport.
assert.ok(workoutItem.properties.sport_options.properties.poolLength);
assert.ok(workoutItem.properties.sport_options.properties.gradingSystem);
// A step and a repeat group, and the repeat group's items are steps.
const stepVariants = workoutItem.properties.steps.items.oneOf;
assert.equal(stepVariants.length, 2);
assert.ok(stepVariants[0].properties.intensity.oneOf.length > 5, "every intensity type is offered");
assert.deepEqual(stepVariants[1].required, ["repeat", "steps"]);
assert.deepEqual(
  Object.keys(stepVariants[1].properties.steps.items.properties),
  Object.keys(stepVariants[0].properties)
);

const workoutSchema = buildDraftWorkoutInputSchema();
assert.equal(workoutSchema.properties.workout.oneOf, undefined);
assert.equal(workoutSchema.properties.calendar_date.pattern, "^\\d{8}$");
for (const field of ["schedule_date", "save_to_library", "sort_no"]) {
  assert.equal(field in workoutSchema.properties.workout.properties, false);
  assert.equal(field in schema.properties.workouts.items.properties, true, "the plan keeps them");
}

// The regression guard: this is what the duplication cost, and what it must not
// cost again. Measured after the rewrite at 15.4 kB for the plan and 15.3 kB for
// the single workout, against 67 kB before. What is left is the step schema,
// which still appears twice — once on its own and once inside the repeat group —
// and is 81% intensity variants. Collapsing that last copy needs `$defs`/`$ref`,
// which not every provider resolves well when *writing* arguments, so it is
// deliberately not done on the app's main write path.
for (const [label, built] of [["plan", schema], ["workout", workoutSchema]]) {
  const size = JSON.stringify(built).length;
  assert.ok(
    size < 20_000,
    `the ${label} schema is ${size} chars; it was 67,000 when it branched per sport`
  );
}

// Representative typed result for: “Create a 5 km run at 135–145 bpm.”
const heartRateDraft = {
  name: "Heart Rate Plan",
  workouts: [
    {
      key: "steady-hr",
      name: "5 km at 135–145 bpm",
      sport: "run",
      steps: [
        {
          kind: "training",
          target_type: "distance",
          target_distance_meters: 5_000,
          intensity: { type: "heartRate", lowBpm: 135, highBpm: 145 }
        }
      ]
    }
  ]
};
assert.equal(validatePlanDraft(heartRateDraft, { todayDay: "20260101" }).ok, true);
const heartRatePreview = buildPlanPreview("draft-test-hr", heartRateDraft);
assert.equal(heartRatePreview.entries[0]?.sport, "run");
assert.match(heartRatePreview.entries[0]?.stepsSummary ?? "", /135–145 bpm/);
const oneOffPreview = buildPlanPreview("draft-one-off", heartRateDraft, {
  artifactType: "workout"
});
assert.equal(oneOffPreview.artifactType, "workout");
assert.doesNotMatch(oneOffPreview.summary, /none scheduled/);
assert.equal(oneOffPreview.warnings.length, 0);
const oneOffCalendarInput = buildTrainingPlanDestinationInput(
  heartRateDraft,
  "calendar",
  "2099-12-06"
);
assert.equal(oneOffCalendarInput.workouts[0].schedule_date, "20991206");
assert.equal(oneOffCalendarInput.workouts[0].save_to_library, false);
const oneOffLibraryInput = buildTrainingPlanDestinationInput(
  heartRateDraft,
  "workoutLibrary"
);
assert.equal(oneOffLibraryInput.workouts[0].schedule_date, undefined);
assert.equal(oneOffLibraryInput.workouts[0].save_to_library, true);
const heartRatePayload = buildWorkoutPayload(
  heartRateDraft.workouts[0].name,
  heartRateDraft.workouts[0].steps,
  "run"
);
assert.equal(heartRatePayload.exercises[0].intensityType, 2);
assert.equal(heartRatePayload.exercises[0].hrType, 2);
assert.equal(heartRatePayload.exercises[0].isIntensityPercent, false);
assert.equal(heartRatePayload.exercises[0].intensityCustom, 0);
assert.equal(heartRatePayload.exercises[0].intensityValue, 135);
assert.equal(heartRatePayload.exercises[0].intensityValueExtend, 145);

const mixedDraft = {
  name: "Mixed Training Week",
  workouts: [
    {
      key: "easy-run",
      name: "Easy Run",
      sport: "run",
      schedule_date: "20991202",
      steps: [
        {
          kind: "training",
          target_type: "time",
          target_duration_seconds: 2_400,
          intensity: { type: "heartRatePercent", basis: "maxHr", preset: "aerobicEndurance" }
        }
      ]
    },
    {
      key: "bike-threshold",
      name: "Bike Threshold",
      sport: "bike",
      schedule_date: "20991203",
      steps: [
        {
          kind: "training",
          target_type: "time",
          target_duration_seconds: 2_700,
          intensity: { type: "ftpPercent", preset: "threshold" }
        }
      ]
    },
    {
      key: "pool-technique",
      name: "Pool Technique",
      sport: "swim",
      sport_options: { poolLength: { value: 25, unit: "m" } },
      schedule_date: "20991204",
      steps: [
        {
          kind: "training",
          target_type: "distance",
          target_distance_meters: 1_500,
          intensity: { type: "swimStroke", stroke: "freestyle" }
        }
      ]
    },
    {
      key: "strength-session",
      name: "Full Body Strength",
      sport: "strength",
      schedule_date: "20991205",
      steps: [
        {
          kind: "training",
          target_type: "reps",
          target_reps: 10,
          exercise_name: "Squat",
          intensity: { type: "weight", mode: "bodyweight" }
        }
      ]
    }
  ]
};
assert.equal(validatePlanDraft(mixedDraft, { todayDay: "20260101" }).ok, true);
const mixedPreview = buildPlanPreview("draft-mixed", mixedDraft);
assert.equal(mixedPreview.entries.length, 4);
assert.match(mixedPreview.summary, /1 Run \/ 1 Bike \/ 1 Pool Swim \/ 1 Strength/);
assert.deepEqual(
  mixedPreview.entries.map((entry) => entry.sport),
  ["run", "bike", "swim", "strength"]
);
assert.deepEqual(
  mixedDraft.workouts.map((entry) =>
    buildWorkoutPayload(entry.name, entry.steps, entry.sport, entry.sport_options).sportType
  ),
  [1, 2, 3, 4]
);
const mixedUploadInput = buildTrainingPlanUploadInput(mixedDraft);
assert.deepEqual(
  mixedUploadInput.workouts.map((entry) => entry.sport),
  ["run", "bike", "swim", "strength"]
);
assert.deepEqual(mixedUploadInput.workouts[2].sport_options, {
  poolLength: { value: 25, unit: "m" }
});
assert.equal(mixedUploadInput.workouts[3].steps[0].target_type, "reps");

console.log("test-chat-workout-tools: ok");
