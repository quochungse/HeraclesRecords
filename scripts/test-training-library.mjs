// The plan model the library reads and writes: a COROS plan, or a draft of
// one (docs/training-plan-coros-first.md). Sessions on days, a stage per week,
// and nothing COROS cannot store — no rest days, notes, phases, start dates or
// calendar bookkeeping of local installs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const domain = await import(distUrl("trainingPlanDomain.js"));
const adapter = await import(distUrl("corosTrainingPlanAdapter.js"));
const databaseModule = await import(distUrl("database.js"));
const library = await import(distUrl("trainingLibraryService.js"));
const planWorkoutEditor = await import(distUrl("planWorkoutEditor.js"));
const chatWorkoutTools = await import(distUrl("chatWorkoutTools.js"));

const makeWorkout = (name, load, seconds = 1_800) => ({
  key: name.toLowerCase().replaceAll(" ", "-"),
  name,
  sport: "run",
  steps: [
    {
      kind: "training",
      target_type: "time",
      target_duration_seconds: seconds,
      target_load: load,
      intensity: { type: "heartRate", lowBpm: 135, highBpm: 145 }
    }
  ]
});

// --- a new plan is a draft ---------------------------------------------------

const first = domain.createTrainingPlan("Build");
assert.match(first.id, /^draft:/, "a plan that is not on COROS yet is a draft");
assert.equal(first.calendar, "unscheduled");
assert.deepEqual(first.weekStages, []);
first.weekCount = 2;
first.weekStages = [{ weekIndex: 0, stage: 2 }, { weekIndex: 1, stage: 3 }];
first.entries = [
  domain.planEntryFromWorkout(makeWorkout("Easy", 40), 0, 0),
  domain.planEntryFromWorkout(makeWorkout("Threshold", 80, 2_700), 1, 2),
  domain.planEntryFromWorkout(makeWorkout("Double", 20), 1, 2)
];

// --- week operations carry the stages -----------------------------------------

const duplicated = domain.duplicateTrainingPlanWeek(first, 0);
assert.equal(duplicated.weekCount, 3);
assert.equal(duplicated.entries.filter((entry) => entry.weekIndex === 1).length, 1);
assert.notEqual(duplicated.entries[0].id, duplicated.entries.at(-1).id);
assert.deepEqual(
  duplicated.weekStages.map((stage) => [stage.weekIndex, stage.stage]).sort(),
  [[0, 2], [1, 2], [2, 3]],
  "the copy takes the week's stage and later weeks keep theirs, one down"
);

const reordered = domain.reorderTrainingPlanWeek(first, 0, 1);
assert.equal(reordered.entries[0].weekIndex, 1);
assert.deepEqual(
  reordered.weekStages.map((stage) => [stage.weekIndex, stage.stage]).sort(),
  [[0, 3], [1, 2]],
  "a moved week takes its stage with it"
);

const copied = domain.copiedEntry({ ...first.entries[0], idInPlan: "7", happenDay: "20990803", corosProgram: { id: "p" } });
assert.equal(copied.idInPlan, undefined, "a copy is a new session to COROS");
assert.equal(copied.happenDay, undefined);
assert.equal(copied.corosProgram.id, "p", "and keeps the program: the steps are the same");
assert.notEqual(copied.id, first.entries[0].id);

// --- the summary and what stops a save --------------------------------------

const summary = domain.summarizeTrainingPlan(first);
assert.equal(summary.workouts, 3);
assert.equal(summary.trainingLoad, 140);
assert.equal(summary.peakWeek, 2);
assert.deepEqual(summary.sportDistribution, { run: 3 });

const issues = (plan) => domain.validateTrainingPlan(plan);
assert.deepEqual(issues(first), [], "a finished plan has nothing to say");
assert.equal(issues({ ...first, name: "" }).some((issue) => issue.path === "name"), true);
assert.equal(
  issues({ ...first, entries: [] }).some((issue) => issue.path === "entries" && issue.severity === "error"),
  true,
  "COROS keeps no empty plan"
);
const crowded = {
  ...first,
  entries: Array.from({ length: 11 }, () => domain.planEntryFromWorkout(makeWorkout("Stack", 1), 0, 3))
};
assert.match(
  issues(crowded).find((issue) => issue.severity === "error")?.message ?? "",
  /at most 10 sessions/,
  "the web app's per-day limit is stated before COROS refuses it"
);
const trailing = issues({ ...first, weekCount: 4 });
assert.equal(trailing.every((issue) => issue.severity === "warning"), true);
assert.match(trailing[0].message, /2 empty weeks at the end are not kept/, "COROS ends a plan at its last session");

// --- the coach's plans ------------------------------------------------------

const generationRequest = {
  goal: "Build durable mountain endurance",
  sports: ["run", "strength", "swim"],
  difficulty: "advanced",
  weeks: 2,
  sessionsPerWeek: 2,
  startDate: "2026-08-03",
  availableDayIndexes: [0, 2],
  maxSessionMinutes: 90,
  constraints: "Keep Wednesday joint-friendly."
};
const generatedDraft = {
  draftId: "typed-draft",
  name: "Mountain durability",
  summary: "Two focused weeks built from current recovery context.",
  conflicts: [],
  warnings: ["Review loads before saving."],
  entries: [
    {
      key: "w1-run",
      name: "Uphill repeats",
      scheduleDate: "20260803",
      saveToLibrary: false,
      workoutType: "run",
      source: {
        key: "w1-run",
        name: "Uphill repeats",
        sport: "run",
        schedule_date: "20260803",
        save_to_library: false,
        steps: [{
          repeat: 4,
          name: "Climbing set",
          steps: [{ kind: "training", name: "Uphill", target_type: "time", target_duration_seconds: 240, intensity: { type: "heartRatePercent", basis: "lthr", lowPercent: 92, highPercent: 98 } }, { kind: "rest", name: "Float down", target_type: "time", target_duration_seconds: 120, intensity: { type: "none" } }]
        }]
      }
    },
    {
      key: "w1-strength",
      name: "Trail strength",
      scheduleDate: "20260805",
      saveToLibrary: false,
      workoutType: "strength",
      source: {
        key: "w1-strength", name: "Trail strength", sport: "strength", schedule_date: "20260805",
        steps: [{ kind: "training", name: "Goblet squat", target_type: "reps", target_reps: 10, exercise_id: "squat-1", exercise_name: "Goblet Squat", exercise_kind: 3, intensity: { type: "weight", mode: "weight", value: 24, unit: "kg" } }]
      }
    },
    {
      key: "w2-run", name: "Steady trail", scheduleDate: "20260810", saveToLibrary: false, workoutType: "run",
      source: { key: "w2-run", name: "Steady trail", sport: "run", schedule_date: "20260810", steps: [{ kind: "training", target_type: "distance", target_distance_meters: 12_000, intensity: { type: "effortPace", lowSecondsPerKm: 330, highSecondsPerKm: 360, displayUnit: "km" } }] }
    },
    {
      key: "w2-swim", name: "Pool recovery", scheduleDate: "20260812", saveToLibrary: false, workoutType: "swim",
      source: { key: "w2-swim", name: "Pool recovery", sport: "swim", sport_options: { poolLength: { value: 25, unit: "m" } }, schedule_date: "20260812", steps: [{ kind: "sendOff", target_type: "distance", target_distance_meters: 100, send_off_seconds: 120, intensity: { type: "swimStroke", stroke: "freestyle" } }] }
    }
  ]
};
const generated = domain.trainingPlanFromDraftPreview(generatedDraft, generationRequest);
assert.equal(generated.origin, "coach");
assert.equal(generated.coach.draftId, "typed-draft");
assert.equal(generated.startDate, undefined, "a plan has no start date of its own");
assert.equal(generated.weekCount, 2);
assert.equal(generated.entries.length, 4);
assert.equal(generated.entries[0].workout.steps[0].repeat, 4);
assert.deepEqual(generated.entries[1].workout.steps[0].intensity, { type: "weight", mode: "weight", value: 24, unit: "kg" });
assert.deepEqual(generated.entries[3].workout.sport_options, { poolLength: { value: 25, unit: "m" } });
assert.match(generated.description, /Build durable mountain endurance/, "the goal is the description's first line");
assert.match(generated.description, /Review loads/, "and the coach's warnings follow it");
assert.deepEqual(generated.entries.map((entry) => [entry.weekIndex, entry.dayIndex]), [[0, 0], [0, 2], [1, 0], [1, 2]]);

/* A Tuesday start is still counted from its Monday, which is where COROS
   counts a plan's days from — so a Tuesday session is a Tuesday. */
const tuesdayDraft = structuredClone(generatedDraft);
tuesdayDraft.draftId = "tuesday-start";
const tuesdayDates = ["20260804", "20260806", "20260811", "20260813"];
tuesdayDraft.entries.forEach((entry, index) => {
  entry.scheduleDate = tuesdayDates[index];
  entry.source.schedule_date = tuesdayDates[index];
});
const tuesdayPlan = domain.trainingPlanFromDraftPreview(tuesdayDraft, {
  ...generationRequest,
  startDate: "2026-08-04",
  availableDayIndexes: [1, 3]
});
assert.deepEqual(tuesdayPlan.entries.map((entry) => [entry.weekIndex, entry.dayIndex]), [[0, 1], [0, 3], [1, 1], [1, 3]]);
assert.throws(
  () => domain.trainingPlanFromDraftPreview(tuesdayDraft, { ...generationRequest, startDate: "2026-08-04" }),
  /unavailable day/i
);
/* Weeks are counted from the start day asked for, so a mid-week start does
   not split one requested week across two calendar weeks. */
const wednesdayDraft = structuredClone(generatedDraft);
wednesdayDraft.draftId = "wednesday-start";
const wednesdayDates = ["20260805", "20260809", "20260812", "20260816"];
wednesdayDraft.entries.forEach((entry, index) => {
  entry.scheduleDate = wednesdayDates[index];
  entry.source.schedule_date = wednesdayDates[index];
});
const wednesdayPlan = domain.trainingPlanFromDraftPreview(wednesdayDraft, {
  ...generationRequest,
  startDate: "2026-08-05",
  availableDayIndexes: [2, 6]
});
assert.deepEqual(wednesdayPlan.entries.map((entry) => [entry.weekIndex, entry.dayIndex]), [[0, 2], [0, 6], [1, 2], [1, 6]]);
assert.throws(
  () => domain.trainingPlanFromDraftPreview({ ...generatedDraft, entries: generatedDraft.entries.slice(0, 3) }, generationRequest),
  /week 2 has 1 workouts/i
);

const coachLibraryPlan = domain.trainingPlanFromCoachDraftPreview(generatedDraft);
assert.equal(coachLibraryPlan.origin, "coach");
assert.equal(coachLibraryPlan.startDate, undefined);
assert.equal(coachLibraryPlan.entries[3].weekIndex, 1);
assert.deepEqual(coachLibraryPlan.entries[0].workout.steps, generatedDraft.entries[0].source.steps);
const undatedCoachPlan = domain.trainingPlanFromCoachDraftPreview({
  ...generatedDraft,
  draftId: "undated-coach",
  entries: [
    { key: "later-1", name: "Decide later", sport: "run", saveToLibrary: false, workoutType: "run" },
    { key: "later-2", name: "And this", sport: "run", saveToLibrary: false, workoutType: "run" }
  ]
});
assert.deepEqual(
  undatedCoachPlan.entries.map((entry) => [entry.weekIndex, entry.dayIndex]),
  [[0, 0], [0, 1]],
  "a plan has no day-less sessions: undated ones are placed a day apart"
);
assert.equal(undatedCoachPlan.entries[0].workout.name, "Decide later");
const stagedCoachPlan = domain.trainingPlanFromCoachDraftPreview(generatedDraft, {
  description: "Edited by the athlete.",
  weekStages: [{ weekIndex: 1, stage: 4 }, { weekIndex: 9, stage: 5 }]
});
assert.equal(stagedCoachPlan.description, "Edited by the athlete.");
assert.deepEqual(stagedCoachPlan.weekStages, [{ weekIndex: 1, stage: 4 }], "a stage past the plan's weeks is dropped");

// --- a session's workout, round-tripped through the editor --------------------

const intensityFamilies = [
  { type: "none" },
  { type: "heartRate", lowBpm: 130, highBpm: 145 },
  { type: "heartRatePercent", basis: "reserve", preset: "aerobicEndurance", zoneId: 2 },
  { type: "heartRatePercent", basis: "maxHr", lowPercent: 70, highPercent: 80 },
  { type: "pace", lowSecondsPerKm: 270, highSecondsPerKm: 300, displayUnit: "km" },
  { type: "effortPace", lowSecondsPerKm: 285, highSecondsPerKm: 315, displayUnit: "mi" },
  { type: "thresholdPacePercent", preset: "threshold", zoneId: 4 },
  { type: "effortPacePercent", lowPercent: 88, highPercent: 96 },
  { type: "ftpPercent", preset: "aerobicPower", zoneId: 3 },
  { type: "power", lowWatts: 220, highWatts: 260 },
  { type: "power", preset: "interval", zoneId: 4 },
  { type: "speed", low: 10, high: 13, unit: "km/h" },
  { type: "cadence", low: 82, high: 92, unit: "rpm" },
  { type: "swimStroke", stroke: "individualMedley" },
  { type: "weight", mode: "bodyweight" },
  { type: "weight", mode: "weight", value: 50, unit: "lb" },
  { type: "rpe", value: 8 },
  { type: "climbGrade", system: "yds", relativeToOnsight: -1 },
  { type: "climbGrade", system: "font", absoluteGrade: "7A" },
  { type: "lthrPercent", lowPercent: 90, highPercent: 95, zoneId: 4 }
];
const targetSteps = [
  { kind: "training", name: "Time", target_type: "time", target_duration_seconds: 300 },
  { kind: "training", name: "Distance", target_type: "distance", target_distance_meters: 1_200 },
  { kind: "training", name: "Load", target_type: "load", target_load: 50 },
  { kind: "rest", name: "HR recovery", target_type: "hrRecovery", target_hr_recovery_bpm: 110 },
  { kind: "training", name: "Open", target_type: "open" },
  { kind: "training", name: "Reps", target_type: "reps", target_reps: 12, exercise_id: "exercise-1", exercise_name: "Squat", exercise_kind: 2 },
  { kind: "training", name: "Vert", target_type: "elevationGain", target_elevation_gain_meters: 400 },
  { kind: "training", name: "Routes", target_type: "routes", target_routes: 5 }
].map((step, index) => ({ ...step, intensity: intensityFamilies[index] }));
const remainingIntensitySteps = intensityFamilies.slice(targetSteps.length).map((intensity, index) => ({ kind: "training", name: `Intensity ${index}`, target_type: "time", target_duration_seconds: 60, intensity }));
const roundTripSource = {
  key: "typed-round-trip",
  name: "All typed controls",
  description: "Keep every target and intensity family.",
  sport: "swim",
  sport_options: { poolLength: { value: 25, unit: "yd" }, gradingSystem: "font" },
  schedule_date: "20260803",
  sort_no: 4,
  steps: [...targetSteps, { repeat: 3, name: "Typed repeat", steps: remainingIntensitySteps }]
};
const editorDraft = planWorkoutEditor.planWorkoutInputToEditorDraft(roundTripSource);
const roundTripped = planWorkoutEditor.editorDraftToPlanWorkoutInput(editorDraft, roundTripSource);
assert.equal(roundTripped.name, roundTripSource.name);
assert.deepEqual(roundTripped.sport_options, roundTripSource.sport_options);
assert.deepEqual(roundTripped.steps, roundTripSource.steps);
assert.equal(roundTripped.schedule_date, "20260803");
assert.equal(roundTripped.save_to_library, false);
const coroEntry = {
  ...domain.planEntryFromWorkout({ key: "coros", name: "Read from COROS", sport: "strength" }, 0, 0),
  corosProgram: { id: "program-in-plan", exercises: [] },
  idInPlan: "3",
  plannedTrainingLoad: 80
};
const editedEntry = planWorkoutEditor.replaceTrainingPlanEntryWorkout(coroEntry, {
  key: "coros",
  name: "Edited plan copy",
  sport: "strength",
  steps: [{ kind: "training", name: "Deadlift", target_type: "reps", target_reps: 5, exercise_id: "deadlift-1", exercise_name: "Deadlift", exercise_kind: 4, intensity: { type: "weight", mode: "weight", value: 100, unit: "kg" } }]
});
assert.equal(editedEntry.corosProgram, undefined, "an edit drops the program it was read with, so the save rebuilds it from the steps");
assert.equal(editedEntry.plannedTrainingLoad, undefined, "and the old program's figures with it");
assert.equal(editedEntry.idInPlan, "3", "the session keeps its identity inside the COROS plan");
assert.equal(editedEntry.title, "Edited plan copy");
assert.equal(coroEntry.corosProgram.id, "program-in-plan", "the entry edited is not mutated");
assert.equal(editedEntry.workout.steps[0].exercise_id, "deadlift-1");
for (const specialistInput of [
  { key: "pool", name: "Pool", sport: "swim", sport_options: { poolLength: { value: 50, unit: "m" } }, steps: [{ kind: "sendOff", name: "100s", target_type: "distance", target_distance_meters: 100, send_off_seconds: 105, intensity: { type: "swimStroke", stroke: "butterfly" } }] },
  { key: "climb", name: "Boulders", sport: "bouldering", sport_options: { gradingSystem: "font" }, steps: [{ kind: "training", name: "Limit route", target_type: "routes", target_routes: 4, intensity: { type: "climbGrade", system: "font", absoluteGrade: "7B" } }] },
  { key: "strength", name: "Push", sport: "strength", steps: [{ kind: "training", name: "Bench Press", target_type: "reps", target_reps: 8, exercise_id: "bench-press", exercise_name: "Bench Press", sets: 4, rest_type: 1, rest_value: 90, overview: "Pause on the chest", intensity: { type: "weight", mode: "weight", value: 70, unit: "kg" } }] }
]) {
  const specialistDraft = planWorkoutEditor.planWorkoutInputToEditorDraft(specialistInput);
  assert.deepEqual(planWorkoutEditor.editorDraftToPlanWorkoutInput(specialistDraft, specialistInput).steps, specialistInput.steps);
  assert.deepEqual(planWorkoutEditor.editorDraftToPlanWorkoutInput(specialistDraft, specialistInput).sport_options, specialistInput.sport_options);
}


// --- a COROS plan as the library reads it -------------------------------------

const rawNative = {
  id: "remote-1",
  name: "Native Build",
  overview: "Preserve this plan",
  totalDay: 14,
  version: 7,
  unknownFutureField: { keep: true },
  entities: [
    { id: "native-entity-1", idInPlan: "1", planProgramId: "1", dayNo: 9 }
  ],
  programs: [
    {
      id: "program-1",
      idInPlan: "1",
      name: "Native Run",
      sportType: 1,
      duration: 2_400,
      distance: 600_000,
      trainingLoad: 55,
      totalSets: 3,
      opaqueProgramField: "round-trip",
      exercises: []
    }
  ],
  weekStages: [{ weekNo: 1, stage: 0 }, { weekNo: 2, stage: 3 }]
};
const native = adapter.parseNativeCorosPlan(rawNative, "2026-07-29T00:00:00.000Z");
assert.equal(native.remoteId, "remote-1");
assert.equal(native.programs[0].planTrainingLoad, 55);
assert.equal(native.programs[0].planDuration, 2_400);
assert.equal(native.programs[0].planSets, 3);
assert.equal(native.rawPayload.unknownFutureField.keep, true);
assert.equal(native.sportTypes[0], 1);
assert.equal(native.entities[0].id, "native-entity-1");

const nativeDocument = library.nativePlanToDocument(native, {
  planId: "coros:remote-1",
  favorite: true,
  tags: ["base"],
  archived: false,
  origin: "coach",
  updatedAt: "2026-07-29T00:00:00.000Z"
});
assert.equal(nativeDocument.id, "coros:remote-1");
assert.equal(nativeDocument.remoteVersion, 7);
assert.equal(nativeDocument.calendar, "unscheduled");
assert.equal(nativeDocument.startDate, undefined);
assert.equal(nativeDocument.weekCount, 2);
assert.deepEqual(nativeDocument.weekStages, [{ weekIndex: 1, stage: 3 }], "only a stage COROS set; stage 0 is Not Set");
const nativeEntry = nativeDocument.entries[0];
assert.deepEqual([nativeEntry.weekIndex, nativeEntry.dayIndex], [1, 2], "dayNo 9 is week 2, Wednesday");
assert.equal(nativeEntry.idInPlan, "1", "the session keeps the id an update names it by");
assert.equal(nativeEntry.corosProgram.opaqueProgramField, "round-trip", "and the program as COROS sent it, unknown fields included");
assert.equal(nativeEntry.plannedDistanceMeters, 6_000, "program distance is centimetres");
assert.equal(nativeEntry.plannedStrengthSets, undefined, "totalSets counts steps on a run");
assert.equal(nativeDocument.favorite, true, "the app's own settings are laid over it");
assert.equal(nativeDocument.origin, "coach");

/* An instance is dated from the Monday of its start day's week: COROS counts
   dayNo from there and drops what falls before the start. */
const instance = library.nativePlanToDocument(adapter.parseNativeCorosPlan({
  ...rawNative,
  id: "instance-1",
  executeStatus: 1,
  sourcePlanId: "remote-1",
  startDay: 20270303,
  entities: [{ id: "e", idInPlan: "1", planProgramId: "1", dayNo: 9, happenDay: 20270310 }]
}));
assert.equal(instance.calendar, "running");
assert.equal(instance.sourcePlanId, "remote-1");
assert.equal(instance.startDate, "2027-03-01", "the Monday of a Wednesday start");
assert.equal(instance.entries[0].happenDay, "20270310");
const finished = library.nativePlanToDocument(adapter.parseNativeCorosPlan({ ...rawNative, id: "old", executeStatus: 2, startDay: 20260105 }));
assert.equal(finished.calendar, "finished");

const duplicateNative = adapter.parseNativeCorosPlan({
  id: "remote-duplicates",
  name: "Native duplicate rows",
  totalDay: 7,
  entities: [
    { id: "occurrence-a", idInPlan: "1", planProgramId: "1", dayNo: 0 },
    { id: "occurrence-a", idInPlan: "1", planProgramId: "1", dayNo: 0 },
    { id: "occurrence-b", idInPlan: "2", planProgramId: "2", dayNo: 3, status: 3 }
  ],
  programs: [{ id: "program-1", idInPlan: "1", name: "Run", sportType: 1 }]
});
assert.equal(duplicateNative.entities.length, 3, "the adapter keeps every row it was sent");
assert.deepEqual(
  library.nativePlanToDocument(duplicateNative).entries.map((entry) => entry.idInPlan),
  ["1"],
  "a repeated row is one session, and a deleted one (status 3) is none"
);

// --- plan-versus-done ---------------------------------------------------------

const day = new Date(2099, 11, 1, 12, 0, 0).valueOf();
const scheduled = [
  { planId: "schedule", idInPlan: "one", planProgramId: "pp", happenDay: "20991201", name: "Easy", sportType: 1, trainingLoad: 40 },
  { planId: "schedule", idInPlan: "two", planProgramId: "pp2", happenDay: "20991202", name: "Restored", sportType: 1, trainingLoad: 30 }
];
const activities = [
  { activityId: "activity-1", name: "Easy", sportType: 1, startTime: day, duration: 1_800, distance: 5_000, trainingLoad: 38 }
];
const matches = library.buildTrainingActivityMatches(scheduled, activities, [], "20991202");
assert.equal(matches[0].status, "completed");
assert.equal(matches[0].activityId, "activity-1");
assert.equal(matches[0].confidence >= 0.9, true);
assert.equal(matches[1].status, "upcoming");
const manual = library.buildTrainingActivityMatches(
  scheduled,
  activities,
  [{ ...matches[1], status: "skipped", manual: true }],
  "21000101"
);
assert.equal(manual[1].status, "skipped");


// --- storage ------------------------------------------------------------------

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-training-library-"));
const legacyPath = path.join(tempRoot, "coros-desktop.sqlite");
const legacy = new Database(legacyPath);
legacy.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
legacy.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("preserved", "yes");
legacy.close();

const db = databaseModule.initializeDatabase(tempRoot);
assert.equal(fs.existsSync(path.join(tempRoot, "coroslink.sqlite")), true);
assert.equal(db.prepare("SELECT value FROM app_settings WHERE key = ?").get("preserved").value, "yes");
const tableNames = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
);
for (const table of ["training_plan_metadata", "training_plan_drafts", "coros_plan_cache", "training_workout_metadata", "training_activity_matches"]) {
  assert.equal(tableNames.has(table), true, `${table} exists`);
}
for (const table of ["training_plans", "training_plan_workout_links", "training_collections"]) {
  assert.equal(tableNames.has(table), false, `${table} is retired and not created`);
}

// Drafts: kept, listed, replaced in place, discarded.
const kept = library.savePlanDraft({ baseRemoteId: "remote-1", baseVersion: 7, plan: nativeDocument });
assert.match(kept.id, /^draft:/);
assert.equal(databaseModule.listTrainingPlanDrafts().length, 1);
const rekept = library.savePlanDraft({ id: kept.id, baseRemoteId: "remote-1", baseVersion: 7, plan: { ...nativeDocument, name: "Renamed" } });
assert.equal(rekept.id, kept.id, "saving a draft again replaces it");
assert.equal(databaseModule.listTrainingPlanDrafts().length, 1);
assert.equal(databaseModule.getTrainingPlanDraft(kept.id).plan.name, "Renamed");
assert.equal(databaseModule.getTrainingPlanDraft(kept.id).baseVersion, 7);
library.discardPlanDraft(kept.id);
assert.equal(databaseModule.listTrainingPlanDrafts().length, 0);

// Metadata: the app's own settings on a COROS plan.
const settings = library.updateTrainingPlanMetadata("coros:remote-1", { favorite: true });
assert.equal(settings.favorite, true);
assert.equal(library.updateTrainingPlanMetadata("coros:remote-1", { archived: true }).favorite, true, "a patch keeps what it does not name");
assert.throws(() => library.updateTrainingPlanMetadata("draft:x", { favorite: true }), /saved to COROS/);

// The cache: a list replaces it whole.
databaseModule.replaceCorosPlanCache([nativeDocument, instance]);
assert.equal(databaseModule.listCorosPlanCache().length, 2);
databaseModule.replaceCorosPlanCache([nativeDocument]);
assert.deepEqual(databaseModule.listCorosPlanCache().map((plan) => plan.remoteId), ["remote-1"], "a plan COROS no longer lists leaves the cache");
assert.equal(databaseModule.getCorosPlanCache("remote-1").entries[0].corosProgram.opaqueProgramField, "round-trip");

// The coach's local saves are retired: a plan is a COROS plan.
let groupedDraftPreview;
const groupedDraftResponse = JSON.parse(await chatWorkoutTools.handleChatWorkoutTool(
  "draft_training_plan",
  {
    name: "Grouped Coach Plan",
    workouts: [
      { ...makeWorkout("Easy Monday", 35), schedule_date: "20990803" },
      { ...makeWorkout("Steady Wednesday", 45), schedule_date: "20990805" }
    ]
  },
  {
    allowUpcomingWorkouts: false,
    onPlanDraft: (preview) => { groupedDraftPreview = preview; }
  }
));
assert.equal(groupedDraftResponse.ok, true);
for (const destination of ["localPlan", "localTemplate"]) {
  await assert.rejects(
    chatWorkoutTools.uploadPlanDraftById(groupedDraftPreview.draftId, "metric", destination),
    /to COROS as a plan, as individual workouts, or on the calendar/,
    `${destination} no longer writes a local plan`
  );
}

await assert.rejects(
  library.deleteTrainingLibraryWorkouts({ programIds: ["remote"], confirmed: false }),
  /confirmation/i
);

db.close();
fs.rmSync(tempRoot, { recursive: true, force: true });

console.log("test-training-library: ok");
