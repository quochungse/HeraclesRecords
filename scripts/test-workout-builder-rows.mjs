/**
 * The workout builder's rows, read from a workout and written back.
 *
 * Create workout's builder now also edits a plan session and a library
 * workout. What it writes for a *new* workout is unchanged — the one encoder,
 * `rowToStep` — so everything here is about an edit, and each section is a way
 * reading a workout into display strings and back could quietly change it:
 *
 * 1. **An untouched workout comes back byte for byte.** A row holds a distance
 *    as kilometres to three places and a pace as `m:ss`; re-encoding it would
 *    move a 1234 m step on an imperial account and a 4:31.2 pace. It would
 *    also drop what the builder has no field for — a step's own name, a
 *    strength step's instructions, a send-off — and the `sourceExerciseId`
 *    that makes `workoutDraftToCorosProgram` update an exercise in place
 *    rather than replace it. So an untouched row writes back the node it was
 *    read from.
 * 2. **A changed step keeps its identity, and only what still belongs to it.**
 *    Same kind and same exercise keep the name and instructions; a kind or an
 *    exercise changed takes the builder's words instead.
 * 3. **A changed step means what Create workout means by it** — it is encoded
 *    by `rowToStep`, and a new workout's steps in a plan are Create workout's.
 * 4. **A step the builder cannot represent is carried through.**
 * 5. **A chosen heart-rate family is not restated.** A default follows the
 *    account's; a zone somebody chose keeps its family until they change it.
 * 6. **An untouched step is not held to the catalog.** "Wait for the exercise
 *    catalog" on a strength session nobody edited would lock Save for as long
 *    as COROS took to answer.
 * 7. **A copy is a new step**, claiming no COROS exercise of its source's.
 *
 * Runs through Electron only so `--experimental-strip-types` is available on a
 * Node built without Amaro; the resolver hook is needed because the module
 * graph imports `.ts` files without an extension. It touches no SQLite.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) => import(`${pathToFileURL(path.join(repoRoot, file)).href}${bust}`);

const rowsModule = await load("src/calendar/workoutBuilderRows.ts");
const {
  builderRowSummary,
  builderRowValidationMessage,
  builderRowsToEditorDraft,
  changeBuilderRowKind,
  cloneBuilderRow,
  editorDraftToBuilderRows,
  emptyRow,
  rowToSteps,
  seedBuilderRows,
  syncRowHeartRateBasis
} = rowsModule;
const { editorDraftToPlanWorkoutInput, planWorkoutInputToEditorDraft } = await load(
  "electron/planWorkoutEditor.ts"
);

const fieldsOf = (draft) => ({
  sport: draft.sport,
  name: draft.name,
  description: draft.overview,
  ...(draft.sportOptions?.poolLength ? { poolLength: draft.sportOptions.poolLength } : {})
});

/** A run as COROS hands it to the editor: ids, names, and figures that do
    not sit on a display grid. */
const RUN = {
  name: "Tempo Tuesday",
  overview: "Settle, then press.",
  sportType: 1,
  sport: "run",
  nodes: [
    {
      id: "step-11",
      sourceExerciseId: "11",
      nodeType: "step",
      kind: "warmup",
      name: "Easy jog in",
      target: { type: "distance", meters: 1234 },
      intensity: { type: "heartRatePercent", basis: "reserve", preset: "aerobicEndurance" },
      overview: "Nose breathing only.",
      editable: true
    },
    {
      id: "group-12",
      sourceExerciseId: "12",
      nodeType: "repeat",
      name: "Main set",
      repeat: 5,
      steps: [
        {
          id: "step-13",
          sourceExerciseId: "13",
          nodeType: "step",
          kind: "training",
          name: "Hard 1k",
          target: { type: "time", seconds: 247 },
          intensity: { type: "pace", lowSecondsPerKm: 271.2, highSecondsPerKm: 280.7, displayUnit: "km" },
          editable: true
        },
        {
          id: "step-14",
          sourceExerciseId: "14",
          nodeType: "step",
          kind: "rest",
          name: "Float",
          target: { type: "time", seconds: 90 },
          intensity: { type: "none" },
          editable: true
        }
      ],
      editable: true
    },
    {
      id: "step-15",
      sourceExerciseId: "15",
      nodeType: "step",
      kind: "training",
      name: "Unsupported step",
      target: { type: "open" },
      intensity: { type: "none" },
      editable: false,
      unsupportedReason: "COROS exercise type 42 is preserved but not editable."
    },
    {
      id: "step-16",
      sourceExerciseId: "16",
      nodeType: "step",
      kind: "cooldown",
      name: "Walk it off",
      target: { type: "time", seconds: 600 },
      intensity: { type: "none" },
      editable: true
    }
  ]
};

const STRENGTH = {
  name: "Gym A",
  overview: "",
  sportType: 4,
  sport: "strength",
  nodes: [
    {
      id: "step-21",
      sourceExerciseId: "21",
      nodeType: "step",
      kind: "training",
      name: "Bench press",
      target: { type: "reps", count: 8 },
      intensity: { type: "weight", mode: "weight", value: 62.5, unit: "kg" },
      exerciseId: "bench",
      exerciseName: "T1041",
      exerciseKind: 1,
      sets: 4,
      restType: 1,
      restValue: 120,
      overview: "Pause on the chest.",
      editable: true
    }
  ]
};

const SWIM = {
  name: "Pool",
  overview: "",
  sportType: 3,
  sport: "swim",
  sportOptions: { poolLength: { value: 25, unit: "yd" } },
  nodes: [
    {
      id: "step-31",
      sourceExerciseId: "31",
      nodeType: "step",
      kind: "sendOff",
      name: "100s on 1:45",
      target: { type: "distance", meters: 91.44 },
      intensity: { type: "swimStroke", stroke: "freestyle" },
      sendOffSeconds: 105,
      editable: true
    }
  ]
};

// ---------------------------------------------------------------------------
// 1. Untouched, byte for byte — in both unit systems
// ---------------------------------------------------------------------------
for (const unitSystem of ["metric", "imperial"]) {
  for (const draft of [RUN, STRENGTH, SWIM]) {
    const rows = editorDraftToBuilderRows(draft, unitSystem);
    const written = builderRowsToEditorDraft(rows, fieldsOf(draft), unitSystem, draft);
    assert.deepEqual(
      written,
      draft,
      `${draft.name} (${unitSystem}) comes back exactly as it was read`
    );
  }
}
{
  // The display strings really are lossy, which is why the origin matters.
  const [warmup, group] = editorDraftToBuilderRows(RUN, "imperial");
  assert.equal(warmup.targetValue, "0.767", "1234 m reads as 0.767 mi");
  assert.equal(group.children[0].paceFast, "7:16", "271.2 s/km reads as a whole second per mile");
}

// ---------------------------------------------------------------------------
// 2. A changed step keeps its identity and what still belongs to it
// ---------------------------------------------------------------------------
{
  const rows = editorDraftToBuilderRows(RUN, "metric");
  rows[0] = { ...rows[0], targetValue: "2" };
  const written = builderRowsToEditorDraft(rows, fieldsOf(RUN), "metric", RUN);
  const warmup = written.nodes[0];
  assert.deepEqual(warmup.target, { type: "distance", meters: 2000 }, "the new distance is written");
  assert.equal(warmup.sourceExerciseId, "11", "and the COROS exercise is still the one it updates");
  assert.equal(warmup.id, "step-11");
  assert.equal(warmup.name, "Easy jog in", "the same kind keeps its own name");
  assert.equal(warmup.overview, "Nose breathing only.", "and its instructions");
  assert.deepEqual(
    warmup.intensity,
    { type: "heartRatePercent", basis: "reserve", preset: "aerobicEndurance" },
    "an intensity nobody touched is written as the zone it was"
  );
  assert.deepEqual(written.nodes.slice(1), RUN.nodes.slice(1), "and the rest of the workout is untouched");

  // Changed and changed back is untouched again: the fingerprint is the fields.
  rows[0] = { ...rows[0], targetValue: "1.234" };
  assert.deepEqual(
    builderRowsToEditorDraft(rows, fieldsOf(RUN), "metric", RUN).nodes[0],
    RUN.nodes[0],
    "an edit taken back leaves the step exactly as it was read"
  );
}
{
  const rows = editorDraftToBuilderRows(RUN, "metric");
  rows[3] = changeBuilderRowKind(rows[3], "rest", "run", { unitSystem: "metric" });
  const rest = builderRowsToEditorDraft(rows, fieldsOf(RUN), "metric", RUN).nodes[3];
  assert.equal(rest.kind, "rest");
  assert.equal(rest.name, "Rest", "another kind takes the builder's word for it");
  assert.equal(rest.sourceExerciseId, "16", "and still updates the same COROS exercise");
}
{
  const rows = editorDraftToBuilderRows(SWIM, "metric");
  rows[0] = changeBuilderRowKind(rows[0], "training", "swim", { unitSystem: "metric" });
  const step = builderRowsToEditorDraft(rows, fieldsOf(SWIM), "metric", SWIM).nodes[0];
  assert.equal(step.sendOffSeconds, undefined, "a send-off does not outlive the send-off step");
}
{
  const rows = editorDraftToBuilderRows(STRENGTH, "metric");
  rows[0] = { ...rows[0], exerciseId: "squat", exerciseName: "Back squat" };
  const step = builderRowsToEditorDraft(rows, fieldsOf(STRENGTH), "metric", STRENGTH).nodes[0];
  assert.equal(step.name, "Back squat", "a new exercise names the step");
  assert.equal(step.overview, undefined, "and the bench press's cues are not the squat's");
  assert.equal(step.sets, 4, "the prescription the athlete did not change stays");
  assert.equal(step.restValue, 120);
  assert.deepEqual(step.intensity, { type: "weight", mode: "weight", value: 62.5, unit: "kg" });
}

// ---------------------------------------------------------------------------
// 3. A changed or new step means what Create workout means by it
// ---------------------------------------------------------------------------
for (const sport of ["run", "bike", "swim", "strength", "hyrox"]) {
  const rows = seedBuilderRows(sport, { unitSystem: "metric" });
  rows.push(emptyRow("intervals", sport, { unitSystem: "metric" }));
  const created = rows.flatMap((row) => rowToSteps(row, sport, "metric"));
  const planned = editorDraftToPlanWorkoutInput(
    builderRowsToEditorDraft(rows, { sport, name: "New", description: "" }, "metric"),
    { key: "k", name: "New", sport, save_to_library: false }
  ).steps;
  const shape = (steps) => planWorkoutInputToEditorDraft({ key: "k", name: "x", sport, steps }).nodes.map(
    (node) => node.nodeType === "repeat"
      ? { repeat: node.repeat, steps: node.steps.map(({ kind, target, intensity, sets, restValue }) => ({ kind, target, intensity, sets, restValue })) }
      : { kind: node.kind, target: node.target, intensity: node.intensity, sets: node.sets, restValue: node.restValue }
  );
  assert.deepEqual(
    shape(planned),
    shape(created),
    `a new ${sport} session is the workout Create workout would write`
  );
}

// ---------------------------------------------------------------------------
// 4. A locked step is carried through
// ---------------------------------------------------------------------------
{
  const rows = editorDraftToBuilderRows(RUN, "metric");
  const locked = rows[2];
  assert.equal(locked.locked, "COROS exercise type 42 is preserved but not editable.");
  assert.equal(builderRowValidationMessage(locked, "run", [], false, "metric"), undefined);
  assert.deepEqual(builderRowSummary(locked, "run", "metric"), [
    { label: "Kept as is", value: "COROS exercise type 42 is preserved but not editable." }
  ]);
  // Moving it is allowed; it goes where it was put, as it was.
  const moved = [rows[2], rows[0], rows[1], rows[3]];
  assert.deepEqual(
    builderRowsToEditorDraft(moved, fieldsOf(RUN), "metric", RUN).nodes[0],
    RUN.nodes[2]
  );
}

// ---------------------------------------------------------------------------
// 5. A chosen heart-rate family is not restated
// ---------------------------------------------------------------------------
{
  const [warmup] = editorDraftToBuilderRows(RUN, "metric");
  assert.equal(syncRowHeartRateBasis(warmup, "maxHr"), warmup, "a zone somebody chose keeps its family");
  const fresh = { ...emptyRow("warmup", "run", { unitSystem: "metric" }), intensityType: "heartRatePercent", intensityBasis: "maxHr", intensityPreset: "aerobicEndurance" };
  assert.equal(syncRowHeartRateBasis(fresh, "reserve").intensityBasis, "reserve", "a default follows the account");
  const rekinded = changeBuilderRowKind(warmup, "training", "run", { unitSystem: "metric" });
  assert.equal(rekinded.keepBasis, undefined, "a new kind is a default again");
}

// ---------------------------------------------------------------------------
// 6. An untouched step is not held to the catalog
// ---------------------------------------------------------------------------
{
  const [bench] = editorDraftToBuilderRows(STRENGTH, "metric");
  assert.equal(
    builderRowValidationMessage(bench, "strength", [], true, "metric"),
    undefined,
    "an untouched strength step saves while the catalog is still loading"
  );
  assert.equal(
    builderRowValidationMessage({ ...bench, sets: "5" }, "strength", [], true, "metric"),
    "Wait for the COROS exercise catalog to finish loading.",
    "a changed one is checked as Create workout checks it"
  );
}

// ---------------------------------------------------------------------------
// 7. A copy is a new step
// ---------------------------------------------------------------------------
{
  const [warmup, group] = editorDraftToBuilderRows(RUN, "metric");
  const copies = [cloneBuilderRow(warmup), cloneBuilderRow(group)];
  assert.equal(copies[0].origin, undefined);
  assert.equal(copies[1].children[0].origin, undefined, "down to the steps inside a repeat");
  const written = builderRowsToEditorDraft(copies, fieldsOf(RUN), "metric", RUN).nodes;
  assert.equal(written[0].sourceExerciseId, undefined, "a copy claims no COROS exercise");
  assert.equal(written[1].sourceExerciseId, undefined);
  assert.equal(written[1].steps[0].sourceExerciseId, undefined);
  assert.notEqual(written[0].id, warmup.origin.node.id);
}

// ---------------------------------------------------------------------------
// And the pool a workout states is the pool it keeps
// ---------------------------------------------------------------------------
{
  const rows = editorDraftToBuilderRows(SWIM, "metric");
  const written = builderRowsToEditorDraft(
    rows,
    { ...fieldsOf(SWIM), poolLength: { value: 50, unit: "m" } },
    "metric",
    SWIM
  );
  assert.deepEqual(written.sportOptions, { poolLength: { value: 50, unit: "m" } });
  assert.equal(written.sportType, 3);
}

console.log(
  "workout builder rows OK — an untouched workout round-trips exactly in both unit systems, a changed step keeps its COROS identity and only what still belongs to it, new steps are Create workout's, locked steps pass through, chosen zones keep their family"
);
