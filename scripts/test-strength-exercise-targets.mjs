// Identity, source precedence and the import -> session/window body-chart path.
import assert from "node:assert/strict";
import { catalogIndex } from "../electron/corosExerciseCatalog.ts";
import { parseStrengthDetail, STRENGTH_DETAIL_VERSION } from "../electron/strengthDetail.ts";
import { strengthProgramFromSchedule } from "../electron/strengthExerciseMetadata.ts";
import { optionFacets } from "../src/calendar/exerciseFacets.ts";
import { exerciseTargets, strengthSessionsWithCatalog } from "../src/strength/exerciseTargets.ts";
import { buildStrengthAnalytics, heatLevel, metricValue } from "../src/strength/strengthAnalytics.ts";
import { buildStrengthSessionIndex, sessionHeat } from "../src/strength/sessionAnalytics.ts";
import { strengthExerciseOptions, strengthExerciseMetadata } from "./fixtures/strength-exercises.mjs";

const catalog = catalogIndex(strengthExerciseOptions.map((row) => ({
  id: row.id, name: row.corosKey, muscle: row.primaryMuscles,
  muscleRelevance: row.involvedMuscles, exerciseType: row.corosExerciseType ?? 2
})));
const split = strengthExerciseOptions.find((row) => row.corosKey === "T1164");
const copenhagen = strengthExerciseOptions.find((row) => row.corosKey === "T1368");
const roundedId = Number("481209173684699836");
const raw = {
  summary: { hasProgram: 1, programId: "14", sets: 4, totalReps: 32 },
  // Session aggregates must never be copied onto each exercise or added twice.
  muscleList: [{ muscleId: 2, sets: 99 }],
  lapList: [{ lapItemList: [
    ...Array.from({ length: 4 }, () => ({ mode: 14, exerciseIndex: 2,
      exerciseId: roundedId, programExerciseIndex: 0,
      exerciseNameKey: "Bulgarian 16 kg (8/ben), 2 set moi chan",
      exerciseType: 2, reps: 8, weight: 16000, time: 4000 })),
    { mode: 16, exerciseIndex: 2, exerciseId: roundedId, programExerciseIndex: 1,
      exerciseNameKey: "Bulgarian 16 kg (8/ben), 2 set moi chan", sets: 4, reps: 32 }
  ] }]
};
const program = { idInPlan: "14", exercises: [
  { id: "481209173684699835", originId: copenhagen.id, name: "Unrelated", sortNo: 1,
    exerciseType: 2, muscle: [6], muscleRelevance: [6, 9] },
  { id: "481209173684699836", originId: split.id, name: "Instructions only", sortNo: 2,
    exerciseType: 2, muscle: [7], muscleRelevance: [7, 14] }
] };
assert.ok(STRENGTH_DETAIL_VERSION > 2, "old cached sessions must be parsed again");
assert.equal(strengthProgramFromSchedule(raw, { programs: [program] }), program);
assert.equal(strengthProgramFromSchedule(raw, { programs: [program, program] }), undefined);
assert.equal(strengthProgramFromSchedule(raw, { programs: [{ ...program, idInPlan: "15" }] }), undefined);

const detail = parseStrengthDetail(raw, { program, catalog });
const exercise = detail.exercises[0];
assert.equal(exercise.externalId, split.id, "use the roll-up's program index when old caches rounded 64-bit ids");
assert.equal(exercise.corosKey, "T1164");
assert.deepEqual(exercise.primaryMuscles, [7]);
assert.deepEqual(exercise.involvedMuscles, [7, 14]);
const targets = exerciseTargets(exercise);
const loadsOf = (targets) => Object.fromEntries(targets.activations.map(({ muscle, share }) => [muscle, share]));
assert.deepEqual(loadsOf(targets), optionFacets(split, split.name).loads,
  "completed sessions and the Exercises Library use the same mapping and weights");
assert.deepEqual(exerciseTargets({ ...exercise, nameKey: "Bench Press", rawName: "Curl" }), targets,
  "renaming the movement must not change its muscles");

const exact = structuredClone(raw);
for (const lap of exact.lapList[0].lapItemList) lap.exerciseId = program.exercises[1].id;
exact.lapList[0].lapItemList.at(-1).programExerciseIndex = 0;
assert.equal(parseStrengthDetail(exact, { program, catalog }).exercises[0].externalId, split.id,
  "an exact step id takes precedence over a positional fallback");
for (const lap of exact.lapList[0].lapItemList) lap.exerciseId = "unknown-step-id";
assert.equal(parseStrengthDetail(exact, { program, catalog }).exercises[0].externalId, undefined,
  "a missing exact id must not silently become a different step at the old position");
const moved = structuredClone(raw);
for (const lap of moved.lapList[0].lapItemList) lap.exerciseNameKey = "T1164";
moved.lapList[0].lapItemList.at(-1).programExerciseIndex = 0;
assert.equal(parseStrengthDetail(moved, { program, catalog }).exercises[0].externalId, split.id,
  "a known activity key survives a later edit to the program's order");
const customFirst = structuredClone(program);
customFirst.exercises[0] = { id: "1", originId: "999", name: "My own lift", sortNo: 1,
  exerciseType: 2, muscle: [1], muscleRelevance: [1] };
const keptKey = parseStrengthDetail(moved, { program: customFirst, catalog }).exercises[0];
assert.equal(keptKey.externalId, split.id, "a step whose key cannot be read does not replace a known one");
assert.deepEqual(keptKey.primaryMuscles, [7]);

// Existing per-movement reviews override the provider's muscle roles.
const squat = { ...exercise, ...strengthExerciseMetadata("T1061"), primaryMuscles: [8] };
const squatLoads = loadsOf(exerciseTargets(squat));
assert.ok(squatLoads.quads > squatLoads.hamstrings && squatLoads.glutes > squatLoads.hamstrings);
const side = { ...exercise, ...strengthExerciseMetadata("T1368") };
assert.ok(loadsOf(exerciseTargets(side)).obliques > loadsOf(exerciseTargets(side)).abs);

// Per-exercise metadata wins over today's catalog, below the Library review.
const changedProgram = structuredClone(program);
changedProgram.exercises[1].muscle = [14];
const changed = parseStrengthDetail(raw, { program: changedProgram, catalog }).exercises[0];
const changedLoads = loadsOf(exerciseTargets(changed));
assert.ok(changedLoads.glutes > changedLoads.quads);
const changedSession = { activityId: "changed", sportType: 402, detail: { ...detail, exercises: [changed] } };
assert.deepEqual(strengthSessionsWithCatalog([changedSession], strengthExerciseOptions)[0].detail.exercises[0].primaryMuscles, [14]);
const embedded = structuredClone(raw);
embedded.lapList[0].lapItemList.at(-1).muscle = [14];
embedded.lapList[0].lapItemList.at(-1).muscleRelevance = [7, 14];
assert.deepEqual(parseStrengthDetail(embedded, { program, catalog }).exercises[0].primaryMuscles, [14],
  "metadata embedded in the exercise beats the scheduled copy and catalog");

// When the workout has no metadata, fall back to the catalog by originId.
const bareProgram = structuredClone(program);
delete bareProgram.exercises[1].muscle;
delete bareProgram.exercises[1].muscleRelevance;
assert.deepEqual(exerciseTargets(parseStrengthDetail(raw, { program: bareProgram, catalog }).exercises[0]), targets);
const legacy = { activityId: "legacy", sportType: 402, detail: { ...detail,
  exercises: [{ nameKey: "T1164", sets: 4, totalReps: 32, entries: exercise.entries }] } };
assert.deepEqual(exerciseTargets(strengthSessionsWithCatalog([legacy], strengthExerciseOptions)[0].detail.exercises[0]), targets);

// No id/metadata means unmapped, even if a name happens to match an old rule.
assert.equal(exerciseTargets({ nameKey: "Squats", entries: [] }).activations.length, 0);
assert.equal(exerciseTargets({ nameKey: "S4208", entries: [] }).generic, true);
// A free session's body-region codes are identities too (most real free sets).
assert.deepEqual(Object.keys(loadsOf(exerciseTargets({ nameKey: "S4211", entries: [] }))).sort(),
  ["chest", "shoulders", "triceps"]);
assert.ok(loadsOf(exerciseTargets({ nameKey: "S4214", corosKey: "S4214", corosExerciseType: 0, entries: [] })).quads > 0);
assert.equal(exerciseTargets({ ...exercise, corosExerciseType: 3 }).mobility, true);
assert.deepEqual(Object.keys(loadsOf(exerciseTargets({ nameKey: "Bench Press", primaryMuscleGroup: "quadriceps", entries: [] }))), ["quads"],
  "Hevy also uses template metadata, never its display name");
const missingIndex = structuredClone(raw);
missingIndex.lapList[0].lapItemList.at(-1).programExerciseIndex = 999;
assert.equal(parseStrengthDetail(missingIndex, { program, catalog }).exercises[0].externalId, undefined);

const session = { activityId: "split", sportType: 402, startTime: Math.floor(Date.now() / 1000), detail };
const analytics = buildStrengthAnalytics([session], 28);
assert.equal(analytics.attributedSets, 4);
assert.equal(analytics.unmappedSets, 0);
assert.equal(analytics.summary.volumeKg, 512);
assert.equal(analytics.muscleById.chest.sets, 0, "muscleList is not per-exercise metadata");
assert.ok(Math.abs(analytics.muscles.reduce((n, muscle) => n + muscle.sets, 0) - 4) < 1e-9);
const entry = buildStrengthSessionIndex([session]).byId.get("split");
assert.equal(entry.coverage.attributed, 4);
for (const metric of ["sets", "volume", "time"]) {
  const heat = sessionHeat(entry, metric);
  for (const muscle of ["quads", "glutes"]) {
    assert.ok(heatLevel(metricValue(heat.muscleById[muscle], metric), heat.max) > 0);
    assert.ok(metricValue(analytics.muscleById[muscle], metric) > 0);
  }
}
console.log("strength exercise identity and metadata tests passed");
