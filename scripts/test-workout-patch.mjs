import assert from "node:assert/strict";
import { applyWorkoutPatch, patchWorkoutEditorDraft } from "../dist-electron/workoutPatch.js";
import { planWorkoutInputToEditorDraft } from "../dist-electron/planWorkoutEditor.js";
import { corosProgramToWorkoutDraft, parseWorkoutEditorContext, workoutDraftToCorosProgram, workoutEditRevision } from "../dist-electron/corosWorkoutEditor.js";

const step = (seconds) => ({ kind: "training", target_type: "time", target_duration_seconds: seconds, intensity: { type: "none" } });
const original = {
  key: "easy", name: "Easy", description: "Old note", sport: "run", schedule_date: "20991002", sort_no: 2,
  steps: [step(600), { repeat: 4, name: "Intervals", steps: [step(300), step(60)] }]
};
const snapshot = structuredClone(original);
const edited = applyWorkoutPatch(original, { set: { "/description": "New note", "/steps/1/repeat": 3, "/steps/1/steps/0/target_duration_seconds": 240 } });
assert.deepEqual(original, snapshot);
assert.equal(edited.description, "New note");
assert.equal(edited.steps[1].repeat, 3);
assert.equal(edited.steps[1].steps[0].target_duration_seconds, 240);
assert.deepEqual(edited.steps[0], original.steps[0]);
assert.equal(edited.schedule_date, original.schedule_date);
assert.equal(edited.key, original.key);
assert.equal(applyWorkoutPatch(original, { unset: ["/description"] }).description, undefined);
for (const patch of [
  { set: { "/steps": [] } }, { set: { "/key": "other" } }, { set: { "/sport": "bike" } },
  { set: { "/schedule_date": "20990101" } }, { set: { "/__proto__/polluted": true } },
  { set: { "/steps/1/steps/0/constructor": {} } }, { set: { "/steps/99/name": "Missing" } },
  { set: { "/steps/01/name": "Ambiguous" } }, { set: { "/steps/0/intensity/lowBpm": 120 } },
  { set: { "/steps/0/target_reps": 5 } }, { set: { "/steps/0/target_type": "distance" } },
  { set: { "/steps/0/target_duration_seconds": "300" } }, { set: { "/steps/1/repeat": 100 } },
  { set: { "/description": null } }, { set: { "/name": " " } }, { unset: ["/name"] },
  { set: { "/description": "A" }, unset: ["/description"] },
  { set: { "/steps/0/intensity": { type: "heartRate", lowBpm: 120 } } },
  { set: { "/steps/0/intensity": { type: "none", lowBpm: 120 } } },
  { set: { "/distance_km": 5 } }, { set: {} }
]) assert.throws(() => applyWorkoutPatch(original, patch), JSON.stringify(patch));
assert.equal({}.polluted, undefined);

const changedTarget = applyWorkoutPatch(original, { set: { "/steps/0/target_type": "distance", "/steps/0/target_distance_meters": 1000 } });
assert.equal(changedTarget.steps[0].target_duration_seconds, undefined);
assert.equal(changedTarget.steps[0].target_distance_meters, 1000);
const oldIntensity = structuredClone(original);
oldIntensity.steps[0].intensity_type = 3;
const changedIntensity = applyWorkoutPatch(oldIntensity, { set: { "/steps/0/intensity": { type: "heartRate", lowBpm: 120, highBpm: 140 } } });
assert.equal(changedIntensity.steps[0].intensity_type, undefined);
assert.deepEqual(changedIntensity.steps[0].intensity, { type: "heartRate", lowBpm: 120, highBpm: 140 });

const draft = planWorkoutInputToEditorDraft(original);
draft.nodes[1].sourceExerciseId = "group-71";
draft.nodes[1].steps[0].sourceExerciseId = "child-72";
draft.nodes[0].editable = false;
const patchedDraft = patchWorkoutEditorDraft(draft, { set: { "/steps/1/steps/0/target_duration_seconds": 200 } });
assert.equal(patchedDraft.nodes[1].sourceExerciseId, "group-71");
assert.equal(patchedDraft.nodes[1].steps[0].sourceExerciseId, "child-72");
assert.equal(patchedDraft.nodes[1].steps[0].target.seconds, 200);
assert.deepEqual(patchedDraft.nodes[0], draft.nodes[0]);
assert.throws(() => patchWorkoutEditorDraft(draft, { set: { "/steps/0/overview": "No" } }), /read-only/);
assert.equal(patchWorkoutEditorDraft(draft, { set: { "/description": "Metadata" } }).overview, "Metadata");

const raw = {
  id: "raw-1", name: "Raw", overview: "Original", sportType: 1, privateProgramField: { keep: true },
  exercises: [{ id: "70", name: "Training", exerciseType: 2, sportType: 1, targetType: 2, targetValue: 600, intensityType: 0, sets: 1, groupId: "0", isGroup: false, sortNo: 16777216, privateStepField: "kept" }]
};
const context = parseWorkoutEditorContext({});
const fromRaw = corosProgramToWorkoutDraft(raw, context);
const rawPatched = workoutDraftToCorosProgram(raw, patchWorkoutEditorDraft(fromRaw, { set: { "/steps/0/target_duration_seconds": 300 } }), context);
assert.equal(rawPatched.exercises[0].id, "70");
assert.equal(rawPatched.exercises[0].privateStepField, "kept");
assert.deepEqual(rawPatched.privateProgramField, { keep: true });
assert.equal(rawPatched.exercises[0].targetValue, 300);

const source = { ref: { kind: "library", programId: "raw-1" }, program: raw };
const revision = workoutEditRevision(source);
assert.equal(workoutEditRevision({ ...source, program: Object.fromEntries(Object.entries(raw).reverse()) }), revision, "property order is not a revision");
assert.notEqual(workoutEditRevision({ ...source, program: { ...raw, overview: "Changed without version counter" } }), revision);
console.log("workout patch tests passed (paths, variants, read-only nodes, raw identity and content revisions)");
