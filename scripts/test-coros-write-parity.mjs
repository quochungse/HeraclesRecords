// What this app writes to COROS against what COROS's own Training Hub web app
// writes (docs/coros-write-parity.md). The web app builds every step from a row
// of `/training/exercise/query` and only then writes the step's own figures
// over it; a strength step built any other way carries no muscles, and COROS
// then draws no muscle map for the session it was trained from (probed live on
// 2026-10-20: `muscleList: []` on every session of a plan written here).
//
// Usage: npm run test:coros-write-parity

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) => `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const { buildWorkoutPayload } = await import(distUrl("corosWorkoutBuilder.js"));
const { corosProgramToWorkoutDraft, parseWorkoutEditorContext, workoutDraftToCorosProgram } =
  await import(distUrl("corosWorkoutEditor.js"));
const catalogModule = await import(distUrl("corosExerciseCatalog.js"));
const { catalogIndex, libraryProgramForCalendar, poolLengthPresetId, sourceThumbnailFor, withProgramIdentity } =
  catalogModule;

let failures = 0;
async function test(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

/* Two rows of the strength catalog as `/training/exercise/query` answers them
   (trimmed of media), and the names the app reads them by. */
const BENCH = {
  access: 0, defaultOrder: 0, equipment: [3], exerciseType: 2, id: "425831217146019840",
  intensityCustom: 0, intensityType: 1, intensityValue: 15000, isDefaultAdd: 0, isGroup: false,
  isIntensityPercent: false, muscle: [2], muscleRelevance: [2, 4], name: "T1041",
  overview: "sid_strength_bench_press", part: [2, 6], restType: 1, restValue: 30, sets: 4, sortNo: 39,
  sourceUrl: "https://s3.coros.com/source/exercise_img/0/d6a99dbc5ecb44408698dfc7f100a00d.png",
  sportType: 4, status: 1, targetType: 3, targetValue: 10, userId: 0, animationId: 299,
  displayName: "Bench Press"
};
const PULLDOWN = {
  ...BENCH, id: "469664481325268993", name: "T1358", overview: "sid_strength_straight_arm_pulldown",
  muscle: [12], muscleRelevance: [12, 4, 1], part: [3], equipment: [5], displayName: "Straight Arm Pulldown"
};
const catalog = catalogIndex([BENCH, PULLDOWN]);
const context = parseWorkoutEditorContext({}, "metric");

await test("a strength movement is its catalog row: muscles, parts, equipment, key and description", () => {
  const program = buildWorkoutPayload(
    "Chest",
    [{ kind: "training", name: "Bench Press", exercise_id: BENCH.id, exercise_name: "Bench Press", sets: 4, target_type: "reps", target_reps: 8 }],
    "strength",
    undefined,
    context,
    "",
    catalog
  );
  const [step] = program.exercises;
  assert.deepEqual(step.muscle, [2], "what COROS draws the muscle map from");
  assert.deepEqual(step.muscleRelevance, [2, 4]);
  assert.deepEqual(step.part, [2, 6]);
  assert.deepEqual(step.equipment, [3]);
  assert.equal(step.originId, BENCH.id);
  assert.equal(step.name, "T1041", "the key the watch shows in the athlete's language, not the English words");
  assert.equal(step.overview, "sid_strength_bench_press");
  assert.equal(step.animationId, 299, "the rest of the row rides along, as the web app's clone does");
  assert.equal("displayName" in step, false, "the app's own English reading of the row stays home");
  assert.equal(step.sets, 4);
  assert.equal(step.targetType, 3);
  assert.equal(step.targetValue, 8);
});

await test("a strength step the coach named itself keeps the name", () => {
  const program = buildWorkoutPayload(
    "Chest",
    [{ kind: "training", name: "Bench, heavy top set", exercise_id: BENCH.id, exercise_name: "Bench Press", target_type: "reps", target_reps: 5 }],
    "strength", undefined, context, "", catalog
  );
  assert.equal(program.exercises[0].name, "Bench, heavy top set");
  assert.deepEqual(program.exercises[0].muscle, [2], "and the muscles of the movement");
});

await test("warm-up, cool-down and rest on a strength day are COROS's own rows, not movements", () => {
  const program = buildWorkoutPayload(
    "Chest",
    [
      { kind: "warmup", target_type: "time", target_duration_seconds: 300 },
      { kind: "training", exercise_id: BENCH.id, exercise_name: "Bench Press", target_type: "reps", target_reps: 8 },
      { kind: "rest", target_type: "time", target_duration_seconds: 120 },
      { kind: "cooldown", target_type: "time", target_duration_seconds: 300 }
    ],
    "strength", undefined, context, "", catalog
  );
  const [warm, , rest, cool] = program.exercises;
  assert.deepEqual([warm.originId, warm.name, warm.overview], ["425898928110747648", "T1120", "sid_strength_warm_up"]);
  assert.deepEqual([rest.originId, rest.name, rest.overview], ["426842174601216000", "T1123", "sid_strength_rest"]);
  assert.deepEqual([cool.originId, cool.name, cool.overview], ["425898949585584128", "T1122", "sid_strength_cool_down"]);
  for (const step of [warm, rest, cool]) {
    assert.deepEqual([step.restType, step.restValue], [3, 0], "a step that is not a movement ends without a rest");
  }
});

await test("run, bike and swim steps carry their sport's catalog ids and description keys", () => {
  const expected = {
    run: ["425895398452936705", "426109589008859136", "425895456971866112", "sid_run_warm_up_dist", "sid_run_training", "sid_run_cool_down_dist", "T3001"],
    bike: ["425895843250487297", "425895474420170753", "425895892642611200", "sid_bike_warm_up_dist", "sid_bike_dist_speed", "sid_bike_cool_down_dist", "T4000"],
    swim: ["425896164567728129", "425895924049559553", "425896212886110208", "sid_poolswim_warm_up_dist", "sid_poolswim_dist_default", "sid_poolswim_cool_down_dist", "T5000"]
  };
  for (const [sport, [warmId, trainId, coolId, warmOverview, trainOverview, coolOverview, trainName]] of Object.entries(expected)) {
    const target = sport === "swim"
      ? { target_type: "distance", target_distance_meters: 200 }
      : { target_type: "time", target_duration_seconds: 600 };
    const program = buildWorkoutPayload(
      "Steps",
      [{ kind: "warmup", ...target }, { kind: "training", ...target }, { kind: "cooldown", ...target }],
      sport, undefined, context
    );
    const [warm, train, cool] = program.exercises;
    assert.deepEqual([warm.originId, train.originId, cool.originId], [warmId, trainId, coolId], sport);
    assert.deepEqual([warm.overview, train.overview, cool.overview], [warmOverview, trainOverview, coolOverview], sport);
    assert.deepEqual([warm.name, train.name, cool.name], ["T1120", trainName, "T1122"], `${sport}: an unnamed step is named by COROS's key`);
  }
});

await test("a coach's own step name is kept; the words a key reads as are not a name", () => {
  const program = buildWorkoutPayload(
    "Easy",
    [
      { kind: "warmup", name: "Warm Up", target_type: "time", target_duration_seconds: 600 },
      { kind: "training", name: "Easy, HR cap 156", target_type: "time", target_duration_seconds: 2400 }
    ],
    "run", undefined, context
  );
  assert.equal(program.exercises[0].name, "T1120", "\"Warm Up\" is what T1120 reads as, so the key goes back");
  assert.equal(program.exercises[1].name, "Easy, HR cap 156");
});

await test("no invented description key is written", () => {
  const program = buildWorkoutPayload(
    "Easy",
    [
      { kind: "warmup", target_type: "time", target_duration_seconds: 600 },
      { kind: "rest", target_type: "time", target_duration_seconds: 60 },
      { kind: "cooldown", target_type: "time", target_duration_seconds: 600 }
    ],
    "run", undefined, context
  );
  const overviews = program.exercises.map((step) => step.overview);
  for (const invented of ["sid_run_warm_up", "sid_run_cool_down", "sid_run_rest", "sid_run_rest_dist"]) {
    assert.equal(overviews.includes(invented), false, `${invented} is in no COROS catalog`);
  }
  assert.equal(overviews[1], "sid_run_rest_time");
});

await test("a repeat group is the web app's group", () => {
  const program = buildWorkoutPayload(
    "Intervals",
    [{ repeat: 5, steps: [
      { kind: "training", target_type: "distance", target_distance_meters: 400 },
      { kind: "rest", target_type: "time", target_duration_seconds: 90 }
    ] }],
    "run", undefined, context
  );
  const [group, work, rest] = program.exercises;
  assert.equal(group.isGroup, true);
  assert.deepEqual(
    [group.name, group.overview, group.sportType, group.restType, group.restValue, group.sets],
    ["", "", 0, 0, 30, 5]
  );
  assert.deepEqual([work.groupId, rest.groupId], [String(group.id), String(group.id)]);
});

await test("a HYROX run is T1398 and every HYROX step states its kind", () => {
  const program = buildWorkoutPayload(
    "Hyrox",
    [
      { kind: "warmup", target_type: "time", target_duration_seconds: 600 },
      { kind: "training", name: "Run 1 km", target_type: "distance", target_distance_meters: 1000 }
    ],
    "hyrox", undefined, context
  );
  const [warm, run] = program.exercises;
  assert.equal(run.name, "T1398", "the web app writes this name whatever the step says");
  assert.equal(run.exerciseKind, 0);
  assert.equal(warm.exerciseKind, 0);
});

await test("a program has a cover, the account's unit and a pool preset", () => {
  const swim = buildWorkoutPayload(
    "Pool",
    [{ kind: "training", target_type: "distance", target_distance_meters: 400 }],
    "swim", { poolLength: { value: 50, unit: "m" } }, context
  );
  assert.equal(swim.poolLengthId, 2, "50 m is COROS's preset 2, not custom");
  assert.equal(swim.poolLength, 5000);
  assert.ok(catalogModule.COROS_SOURCE_THUMBNAILS.some((thumb) => thumb.sourceId === swim.sourceId), "one of COROS's covers");
  const again = buildWorkoutPayload(
    "Pool",
    [{ kind: "training", target_type: "distance", target_distance_meters: 400 }],
    "swim", { poolLength: { value: 50, unit: "m" } }, context
  );
  assert.deepEqual(again, swim, "the same workout is the same payload: a plan upload spots repeats by it");
  const imperial = buildWorkoutPayload(
    "Run", [{ kind: "training", target_type: "time", target_duration_seconds: 600 }], "run", undefined,
    parseWorkoutEditorContext({}, "imperial")
  );
  assert.equal(imperial.unit, 1);
  assert.deepEqual([poolLengthPresetId(2500, 2), poolLengthPresetId(2286, 4), poolLengthPresetId(3333, 2), poolLengthPresetId(3048, 4), poolLengthPresetId(2700, 2)], [1, 3, 4, 5, 0]);
  assert.deepEqual(sourceThumbnailFor("Pool"), sourceThumbnailFor("Pool"));
});

/* A strength workout as COROS's web app saved it: a row-built bench press. */
const savedStrength = {
  id: "program-1",
  name: "Chest",
  overview: "",
  sportType: 4,
  sourceId: "425706707117850624",
  exercises: [
    { ...structuredClone(BENCH), id: "1", originId: BENCH.id, groupId: "0", sortNo: 16777216, sets: 4, targetType: 3, targetValue: 10, restType: 1, restValue: 90, intensityType: 1, intensityValue: 50000 }
  ]
};
delete savedStrength.exercises[0].displayName;

await test("the editor writes an untouched movement back as COROS stored it", () => {
  const draft = corosProgramToWorkoutDraft(savedStrength, context);
  const program = workoutDraftToCorosProgram(savedStrength, draft, context, catalog);
  const [step] = program.exercises;
  assert.equal(step.name, "T1041", "a key read back as words is not rewritten as the words");
  assert.equal(step.overview, "sid_strength_bench_press");
  assert.deepEqual([step.muscle, step.part, step.equipment], [[2], [2, 6], [3]]);
  assert.equal(program.sourceId, "425706707117850624", "a cover it had is kept");
});

await test("the editor swaps a movement onto its own row, not the old one's muscles", () => {
  const draft = corosProgramToWorkoutDraft(savedStrength, context);
  const step = draft.nodes[0];
  step.exerciseId = PULLDOWN.id;
  step.exerciseName = "Straight Arm Pulldown";
  step.name = "Straight Arm Pulldown";
  const program = workoutDraftToCorosProgram(savedStrength, draft, context, catalog);
  const [written] = program.exercises;
  assert.equal(written.originId, PULLDOWN.id);
  assert.deepEqual(written.muscle, [12], "the pulldown's muscles — the bug filed it under the chest");
  assert.deepEqual(written.muscleRelevance, [12, 4, 1]);
  assert.deepEqual(written.part, [3]);
  assert.deepEqual(written.equipment, [5]);
  assert.equal(written.name, "T1358");
  assert.equal(written.overview, "sid_strength_straight_arm_pulldown");
  assert.equal(written.id, "1", "the step keeps its id in the program");
});

await test("an untouched movement saved with another movement's muscles heals on its next save", () => {
  const broken = structuredClone(savedStrength);
  Object.assign(broken.exercises[0], { originId: PULLDOWN.id, name: "Straight Arm Pulldown", muscle: [1], muscleRelevance: [1], part: [1], equipment: [6] });
  const draft = corosProgramToWorkoutDraft(broken, context);
  const [written] = workoutDraftToCorosProgram(broken, draft, context, catalog).exercises;
  assert.deepEqual([written.muscle, written.muscleRelevance, written.part, written.equipment], [[12], [12, 4, 1], [3], [5]]);
  assert.equal(written.name, "Straight Arm Pulldown", "and nothing else about the step changes");
  assert.equal(written.sets, 4);
});

await test("a swapped movement with no catalog read keeps its id and claims no muscles", () => {
  const draft = corosProgramToWorkoutDraft(savedStrength, context);
  draft.nodes[0].exerciseId = PULLDOWN.id;
  draft.nodes[0].exerciseName = "Straight Arm Pulldown";
  draft.nodes[0].name = "Straight Arm Pulldown";
  const [written] = workoutDraftToCorosProgram(savedStrength, draft, context).exercises;
  assert.equal(written.originId, PULLDOWN.id);
  assert.equal("muscle" in written, false, "better no map than the old movement's map");
});

await test("a library workout goes on the calendar as the web app puts it there", () => {
  const program = {
    exercises: [
      { isGroup: true, intensityType: 0 },
      { intensityType: 3, intensityCustom: 1, intensityValue: 401000, intensityValueExtend: 473000, intensityPercent: 69000, intensityPercentExtend: 81000 },
      { intensityType: 2, intensityCustom: 0, isIntensityPercent: true, intensityValue: 135, intensityValueExtend: 150, intensityPercent: 70000, intensityPercentExtend: 80000 },
      { intensityType: 2, intensityCustom: 0, isIntensityPercent: false, intensityValue: 135, intensityValueExtend: 150, intensityPercent: 70000, intensityPercentExtend: 80000 },
      { intensityType: undefined }
    ]
  };
  const [, zone, percent, absolute, none] = libraryProgramForCalendar(program).exercises;
  assert.deepEqual([zone.intensityValue, zone.intensityValueExtend, zone.intensityPercent, zone.intensityPercentExtend], [0, 0, 0, 0], "a zone is worked out again from today's zones");
  assert.deepEqual([percent.intensityValue, percent.intensityValueExtend, percent.intensityPercent], [0, 0, 70000]);
  assert.deepEqual([absolute.intensityValue, absolute.intensityPercent, absolute.intensityPercentExtend], [135, 0, 0]);
  assert.equal(none.intensityType, 0);
  assert.equal(program.exercises[1].intensityValue, 401000, "the library detail itself is not changed");
});

await test("a rebuilt session is written as the row it replaces", () => {
  const rebuilt = { id: "0", name: "New", sourceId: "1", exercises: [] };
  const row = { id: "p-7", planId: "plan-1", version: 3, userId: "u", sourceId: "425706707117850624", sourceUrl: "x", name: "Old" };
  const merged = withProgramIdentity(rebuilt, row);
  assert.deepEqual([merged.id, merged.planId, merged.version, merged.sourceId, merged.name], ["p-7", "plan-1", 3, "425706707117850624", "New"]);
});

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("coros write parity tests passed");
