import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

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
  buildRevisePlanInputSchema,
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
// The Claude Code bridge rebuilds properties through zod. Session notes must
// survive that conversion for both draft tools, with the same COROS limit.
const coachingNotes = "Giữ vai thả lỏng; uống nước từng ngụm nhỏ.";
for (const workoutShape of [workoutItem, workoutSchema.properties.workout]) {
  const validator = z.fromJSONSchema(workoutShape);
  const session = { key: "easy", name: "Easy", sport: "run", distance_km: 5, description: coachingNotes };
  assert.equal(validator.parse(session).description, coachingNotes);
  assert.equal(validator.parse({ ...session, description: "x".repeat(200) }).description.length, 200);
  assert.equal(validator.safeParse({ ...session, description: "x".repeat(201) }).success, false);
  const step = { kind: "training", target_type: "time", target_duration_seconds: 600, overview: "x".repeat(201) };
  assert.equal(validator.safeParse({ key: "easy", name: "Easy", steps: [step] }).success, false);
  assert.equal(validator.safeParse({ key: "easy", name: "Easy", steps: [{ repeat: 2, steps: [step] }] }).success, false);
  // JSON Schema's maxLength cannot measure UTF-8 bytes. Runtime validation
  // must reject multibyte notes even when the provider's schema accepts them.
  const atByteLimit = validator.parse({ ...session, description: "Ấ".repeat(66) + "Â" });
  assert.equal(validatePlanDraft({ name: "Plan", workouts: [atByteLimit] }).ok, true);
  const overByteLimit = validator.parse({ ...session, description: "Ấ".repeat(67) });
  const result = validatePlanDraft({ name: "Plan", workouts: [overByteLimit] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /200 UTF-8 bytes/);
  const overlongStep = validator.parse({ key: "easy", name: "Easy", steps: [{ ...step, overview: "Ấ".repeat(67) }] });
  assert.equal(validatePlanDraft({ name: "Plan", workouts: [overlongStep] }).ok, false);
}
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
// The revision carries one workout schema, for replace_session and add_session.
for (const [label, built] of [["plan", schema], ["workout", workoutSchema], ["revise", buildRevisePlanInputSchema()]]) {
  const size = JSON.stringify(built).length;
  assert.ok(
    size < 20_000,
    `the ${label} schema is ${size} chars; it was 67,000 when it branched per sport`
  );
}
// The revision does not carry a third copy of the workout schema: the two
// draft tools beside it have it, and a revised plan is validated as a new
// draft. It was 16 kB of the ~66 kB of schemas sent every round.
const reviseWorkout = buildRevisePlanInputSchema().properties.ops.items.properties.workout;
assert.equal(reviseWorkout.type, "object");
assert.equal(reviseWorkout.properties, undefined, "an open object, not the workout schema again");
assert.equal(reviseWorkout.additionalProperties, true, "Claude Code rebuilds it through zod, which must keep its keys");
assert.ok(JSON.stringify(buildRevisePlanInputSchema()).length < 2_500, "the revision schema is its ops, not a workout");
const revisionSchema = buildRevisePlanInputSchema();
assert.ok(revisionSchema.properties.ops.items.properties.op.enum.includes("patch_session"));
const patchValidator = z.fromJSONSchema(revisionSchema);
const tinyPatch = { draft_id: "draft", summary: "Add note", ops: [{ op: "patch_session", key: "easy", set: { "/description": "Relax shoulders.", "/steps/0/target_duration_seconds": 300 }, unset: ["/steps/0/overview"] }] };
assert.deepEqual(patchValidator.parse(tinyPatch), tinyPatch, "provider schema bridges must retain path keys and typed values");

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
// Put on the calendar, a workout can also be kept in the library — which the
// calendar path used to rule out by clearing the flag.
const keptCalendarInput = buildTrainingPlanDestinationInput(
  heartRateDraft,
  "calendar",
  "2099-12-06",
  true
);
assert.equal(keptCalendarInput.workouts[0].schedule_date, "20991206");
assert.equal(keptCalendarInput.workouts[0].save_to_library, true);
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
          // COROS calls this band "Aerobic" on the Max HR family; only the
          // other families call it "Aerobic Endurance".
          intensity: { type: "heartRatePercent", basis: "maxHr", preset: "aerobic" }
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
assert.match(mixedPreview.summary, /Run, Bike, Pool Swim, Strength$/);
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

// A calendar save names the sessions on a day gone by before anything is
// written; COROS would refuse them one at a time after the rest went through.
{
  const { pastCalendarSessions } = await import(
    `${distUrl("chatWorkoutTools.js")}?cacheBust=${Date.now()}-past`
  );
  const sessions = [
    { name: "Yesterday", schedule_date: "20260925" },
    { name: "Today", schedule_date: "20260926" },
    { name: "Undated" }
  ];
  assert.deepEqual(
    pastCalendarSessions(sessions, "20260926").map((item) => item.name),
    ["Yesterday"]
  );
}

console.log("test-chat-workout-tools: ok");
