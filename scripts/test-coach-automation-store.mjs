import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  DEFAULT_AUTOMATION_CONDITIONS,
  cancelStaleCoachAutomationRuns,
  listCoachAutomationRuns,
  recordCoachAutomationRun,
  countCoachAutomationBindings,
  createCoachAutomation,
  deleteCoachAutomation,
  getCoachAutomation,
  listCoachAutomations,
  normalizeAutomationConditions,
  normalizeAutomationRuntime,
  normalizeAutomationTrigger,
  setCoachAutomationEnabled,
  updateCoachAutomation
} = await import(`${distUrl("coachAutomationStore.js")}?cacheBust=${Date.now()}`);

const { AUTOMATION_DEFAULT_EFFORT } = await import(
  `${distUrl("types.js")}?cacheBust=${Date.now()}`
);
const { COACH_AUTOMATION_PRESETS } = await import(
  `${distUrl("coachAutomationPresets.js")}?cacheBust=${Date.now()}`
);

// better-sqlite3 is built for the Electron ABI and will not dlopen under plain
// node, so the store is exercised through its injectable database interface.
function createMemoryDatabase() {
  /** @type {Map<string, Record<string, unknown>>} */
  const rows = new Map();
  /** @type {Map<string, number>} */
  const bindings = new Map();
  /** @type {Array<Record<string, unknown>>} */
  const runs = [];

  return {
    _rows: rows,
    _bindings: bindings,
    _runs: runs,
    listAutomations() {
      return [...rows.values()].sort((left, right) =>
        left.created_at.localeCompare(right.created_at)
      );
    },
    getAutomation(id) {
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    },
    insertAutomation(row) {
      assert.ok(!rows.has(row.id), "duplicate automation id");
      rows.set(row.id, { ...row });
    },
    updateAutomation(row) {
      assert.ok(rows.has(row.id), "update of unknown automation");
      rows.set(row.id, { ...row });
    },
    deleteAutomation(id) {
      rows.delete(id);
    },
    deleteBindingsForAutomation(automationId) {
      bindings.delete(automationId);
    },
    countBindings(automationId) {
      return bindings.get(automationId) ?? 0;
    },
    listRuns(filter = {}) {
      return runs.filter((run) =>
        filter.statuses ? filter.statuses.includes(run.status) : true
      );
    },
    getRun(id) {
      const row = runs.find((run) => run.id === id);
      return row ? { ...row } : undefined;
    },
    insertRun(row) {
      runs.push({ ...row });
    },
    updateRun(row) {
      const index = runs.findIndex((run) => run.id === row.id);
      if (index >= 0) runs[index] = { ...row };
    }
  };
}

const db = createMemoryDatabase();

// --- create: defaults applied, trigger round-trips -------------------------
const daily = createCoachAutomation(
  {
    name: "  Morning briefing  ",
    role: "Strict marathon coach, injury-prevention first",
    playbook: "Summarise yesterday and set today's focus.",
    trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:30" }
  },
  db
);

assert.equal(daily.name, "Morning briefing");
assert.equal(daily.role, "Strict marathon coach, injury-prevention first");
assert.equal(daily.enabled, true);
assert.deepEqual(daily.trigger, {
  kind: "schedule",
  cadence: "daily",
  timeOfDay: "07:30"
});
assert.deepEqual(daily.conditions, DEFAULT_AUTOMATION_CONDITIONS);
assert.deepEqual(daily.runtime, {});
assert.equal(daily.createdAt, daily.updatedAt);
assert.equal(daily.presetId, undefined);

// Persisted shape is the snake_case row the schema declares.
const storedRow = db._rows.get(daily.id);
assert.equal(storedRow.enabled, 1);
assert.equal(storedRow.preset_id, null);
assert.equal(JSON.parse(storedRow.trigger_json).timeOfDay, "07:30");

// --- create: required fields ------------------------------------------------
assert.throws(
  () => createCoachAutomation({ name: "  ", playbook: "x", trigger: { kind: "manual" } }, db),
  /name is required/
);
assert.throws(
  () => createCoachAutomation({ name: "x", playbook: "", trigger: { kind: "manual" } }, db),
  /playbook is required/
);

// A half-filled schedule must not silently become a never-firing "manual".
assert.throws(
  () =>
    createCoachAutomation(
      { name: "x", playbook: "y", trigger: { kind: "schedule", cadence: "daily" } },
      db
    ),
  /trigger "schedule" is incomplete/
);

// --- create: weekly + activity + runtime overrides --------------------------
const weekly = createCoachAutomation(
  {
    name: "Long run debrief",
    playbook: "Debrief the long run.",
    enabled: false,
    presetId: "long-run-debrief",
    trigger: {
      kind: "activity",
      sportTypes: [100, "junk", 102],
      minDurationSec: 3600.4,
      minDistanceM: -5
    },
    conditions: { cooldownMin: 30, quietHours: { start: "22:00", end: "06:30" } },
    runtime: { provider: "claude-api", model: "claude-opus-5", effort: "high" }
  },
  db
);

assert.equal(weekly.enabled, false);
assert.equal(weekly.presetId, "long-run-debrief");
assert.deepEqual(weekly.trigger, {
  kind: "activity",
  sportTypes: [100, 102],
  minDurationSec: 3600
});
assert.equal(weekly.trigger.minDistanceM, undefined, "non-positive filter dropped");
assert.deepEqual(weekly.conditions, {
  cooldownMin: 30,
  maxRunsPerDay: 3,
  quietHours: { start: "22:00", end: "06:30" }
});
assert.deepEqual(weekly.runtime, {
  provider: "claude-api",
  model: "claude-opus-5",
  effort: "high"
});

// --- list: insertion order by created_at -----------------------------------
const listed = listCoachAutomations(db);
assert.equal(listed.length, 2);
assert.deepEqual(
  listed.map((entry) => entry.id),
  [daily.id, weekly.id]
);
assert.deepEqual(getCoachAutomation(daily.id, db), daily);
assert.equal(getCoachAutomation("missing", db), null);

// --- update: patches only what it is given ---------------------------------
const renamed = updateCoachAutomation(
  daily.id,
  { name: "Evening briefing", conditions: { maxRunsPerDay: 1 } },
  db
);
assert.equal(renamed.name, "Evening briefing");
assert.equal(renamed.playbook, daily.playbook);
assert.equal(renamed.role, daily.role, "untouched role survives");
assert.deepEqual(renamed.trigger, daily.trigger);
assert.equal(renamed.conditions.maxRunsPerDay, 1);
assert.equal(
  renamed.conditions.cooldownMin,
  DEFAULT_AUTOMATION_CONDITIONS.cooldownMin,
  "partial conditions patch keeps the other guard rails"
);
assert.equal(renamed.createdAt, daily.createdAt);
assert.ok(renamed.updatedAt >= daily.updatedAt);

// A partial conditions patch on a customised automation keeps the custom values.
const capped = updateCoachAutomation(weekly.id, { conditions: { maxRunsPerDay: 5 } }, db);
assert.equal(capped.conditions.maxRunsPerDay, 5);
assert.equal(capped.conditions.cooldownMin, 30, "custom cooldown preserved");
assert.deepEqual(capped.conditions.quietHours, { start: "22:00", end: "06:30" });

// Explicit null clears the quiet window.
const noQuiet = updateCoachAutomation(weekly.id, { conditions: { quietHours: null } }, db);
assert.equal(noQuiet.conditions.quietHours, undefined);

// Clearing an optional string removes the key rather than storing "".
const roleless = updateCoachAutomation(daily.id, { role: "  " }, db);
assert.equal(roleless.role, undefined);
assert.equal(db._rows.get(daily.id).role, null);

assert.equal(updateCoachAutomation("missing", { name: "x" }, db), null);
assert.throws(() => updateCoachAutomation(daily.id, { name: "" }, db), /name is required/);

// --- enable toggle ----------------------------------------------------------
assert.equal(setCoachAutomationEnabled(weekly.id, true, db).enabled, true);
assert.equal(db._rows.get(weekly.id).enabled, 1);
assert.equal(setCoachAutomationEnabled(weekly.id, false, db).enabled, false);
assert.equal(db._rows.get(weekly.id).enabled, 0);
assert.equal(setCoachAutomationEnabled("missing", true, db), null);

// --- normalizers: corrupt rows degrade instead of throwing ------------------
assert.deepEqual(normalizeAutomationTrigger(null), { kind: "manual" });
assert.deepEqual(normalizeAutomationTrigger({ kind: "nope" }), { kind: "manual" });
assert.deepEqual(normalizeAutomationTrigger({ kind: "schedule", timeOfDay: "25:00" }), {
  kind: "manual"
});
assert.deepEqual(
  normalizeAutomationTrigger({ kind: "schedule", cadence: "weekly", timeOfDay: "06:00", dayOfWeek: 9 }),
  { kind: "schedule", cadence: "weekly", timeOfDay: "06:00", dayOfWeek: 6 }
);
assert.deepEqual(normalizeAutomationTrigger({ kind: "threshold", metric: "sleepDebt" }), {
  kind: "manual"
});
// R5. A metric name nobody implements is the same class of typo as a malformed
// time, and it degrades the same way. Without this the row stores a threshold
// trigger the scheduler evaluates to `false` for ever — a rule that looks
// configured on the card and can never fire, which is worse than one that
// visibly fell back to manual.
assert.deepEqual(
  normalizeAutomationTrigger({ kind: "threshold", metric: "vo2maxSlump", value: 5 }),
  { kind: "manual" },
  "an unimplemented metric is not a threshold trigger"
);
for (const metric of ["acuteChronicRamp", "restingHrDrift", "planAdherence", "sleepDebt"]) {
  assert.deepEqual(
    normalizeAutomationTrigger({ kind: "threshold", metric, value: 5 }),
    { kind: "threshold", metric, value: 5 },
    `${metric} is one of the four 3.3 names`
  );
}
assert.deepEqual(
  normalizeAutomationTrigger({ kind: "threshold", metric: "acuteChronicRamp", value: 25 }),
  { kind: "threshold", metric: "acuteChronicRamp", value: 25 }
);

// multiActivity is opt-in: a definition written before the option existed keeps
// the "newest activity only" behaviour it already had, and nothing but an
// explicit true turns the catch-up on.
assert.equal(
  normalizeAutomationTrigger({ kind: "activity", sportTypes: [] }).multiActivity,
  undefined
);
assert.equal(
  normalizeAutomationTrigger({ kind: "activity", sportTypes: [], multiActivity: "yes" })
    .multiActivity,
  undefined
);
assert.equal(
  normalizeAutomationTrigger({ kind: "activity", sportTypes: [], multiActivity: true })
    .multiActivity,
  true
);

assert.deepEqual(normalizeAutomationConditions("not json"), DEFAULT_AUTOMATION_CONDITIONS);
assert.equal(normalizeAutomationConditions({ maxRunsPerDay: 0 }).maxRunsPerDay, 1);
assert.equal(normalizeAutomationConditions({ maxRunsPerDay: 999 }).maxRunsPerDay, 24);
assert.equal(normalizeAutomationConditions({ cooldownMin: -5 }).cooldownMin, 0);
assert.equal(
  normalizeAutomationConditions({ quietHours: { start: "9pm", end: "6am" } }).quietHours,
  undefined
);

assert.deepEqual(normalizeAutomationRuntime({ provider: "openai", effort: "turbo" }), {});
assert.deepEqual(normalizeAutomationRuntime({ model: "  gpt  " }), { model: "gpt" });

// A row whose JSON is unparseable still yields a usable automation.
db._rows.set("corrupt", {
  id: "corrupt",
  name: "Corrupt",
  role: null,
  playbook: "p",
  enabled: 1,
  preset_id: null,
  trigger_json: "{not json",
  conditions_json: "{not json",
  runtime_json: null,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:00:00.000Z"
});
const corrupt = getCoachAutomation("corrupt", db);
assert.deepEqual(corrupt.trigger, { kind: "manual" });
assert.deepEqual(corrupt.conditions, DEFAULT_AUTOMATION_CONDITIONS);
assert.deepEqual(corrupt.runtime, {});
db._rows.delete("corrupt");

// --- a run row whose status is not a status --------------------------------
// R5. Every reader downstream branches on this — the burst guard and the daily
// cap count particular statuses, 9.3's dot counts two of them, and the card
// shows Stop for `running`. A value that is none of them would be compared
// against all of those lists and match nothing, so the run would be invisible
// to every guard while still sitting in the log. Reading it as `failed` puts it
// somewhere real: counted against the day, counted against nothing else.
{
  const corruptDb = createMemoryDatabase();
  const owner = createCoachAutomation(
    { name: "Corrupt", playbook: "p", trigger: { kind: "manual" } },
    corruptDb
  );
  const good = recordCoachAutomationRun(
    { automationId: owner.id, bindingId: "b1", status: "success", triggerKind: "manual" },
    corruptDb
  );
  corruptDb.updateRun({
    ...corruptDb.getRun(good.id),
    status: "halfway",
    trigger_kind: "telepathy"
  });

  const [read] = listCoachAutomationRuns({ automationId: owner.id }, corruptDb);
  assert.equal(read.status, "failed", "a status that is not a status reads as failed");
  assert.equal(read.triggerKind, "manual", "and a trigger kind that is not one reads as manual");
}

// --- delete: takes the bindings, leaves everything else --------------------
db._bindings.set(weekly.id, 3);
assert.equal(countCoachAutomationBindings(weekly.id, db), 3);
assert.equal(countCoachAutomationBindings(daily.id, db), 0);

deleteCoachAutomation(weekly.id, db);
assert.equal(getCoachAutomation(weekly.id, db), null);
assert.equal(db._bindings.has(weekly.id), false, "bindings deleted with the definition");
assert.equal(listCoachAutomations(db).length, 1);

deleteCoachAutomation("missing", db); // no-op

// --- a run in flight when the app quit is reconciled at startup ------------
// Nothing is left to finish it, so without this the run log spins forever.
const runsAutomation = createCoachAutomation(
  { name: "Runs", playbook: "p", trigger: { kind: "manual" } },
  db
);
const inFlight = recordCoachAutomationRun(
  {
    automationId: runsAutomation.id,
    bindingId: "b1",
    status: "running",
    triggerKind: "manual"
  },
  db
);
const finished = recordCoachAutomationRun(
  {
    automationId: runsAutomation.id,
    bindingId: "b1",
    status: "success",
    triggerKind: "manual",
    summary: "All good.",
    finishedAt: "2026-08-21T09:00:00.000Z"
  },
  db
);

assert.equal(cancelStaleCoachAutomationRuns(db), 1, "only the in-flight run is stale");
const afterStartup = listCoachAutomationRuns({}, db);
const reconciled = afterStartup.find((run) => run.id === inFlight.id);
assert.equal(reconciled.status, "cancelled");
assert.ok(reconciled.finishedAt, "a reconciled run is no longer open-ended");
assert.match(reconciled.error, /app closed/);
assert.equal(
  afterStartup.find((run) => run.id === finished.id).status,
  "success",
  "a run that already finished is untouched"
);
assert.equal(cancelStaleCoachAutomationRuns(db), 0, "the second startup finds nothing");

// --- the preset gallery survives the store (9.1) ---------------------------
// A preset is a hand-written definition that goes straight through the same
// normalizers as anything the athlete types. A malformed trigger degrades
// silently to "manual" and an out-of-range guard rail is clamped, so a typo in
// this file ships as a coach that never fires rather than as an error.
{
  const presetDb = createMemoryDatabase();
  const ids = COACH_AUTOMATION_PRESETS.map((preset) => preset.id);

  assert.ok(ids.length >= 4, "the gallery is a gallery, not one starting point");
  assert.equal(new Set(ids).size, ids.length, "preset ids are unique");

  // Each preset should teach something different, so the kinds of trigger and
  // binding it offers have to actually differ.
  const triggerKinds = new Set(
    COACH_AUTOMATION_PRESETS.map((preset) => preset.definition.trigger.kind)
  );
  assert.ok(
    triggerKinds.has("activity") && triggerKinds.has("schedule"),
    "the gallery covers both trigger kinds the app can fire"
  );
  assert.equal(
    new Set(
      COACH_AUTOMATION_PRESETS.map((preset) => preset.suggestedBinding.mode)
    ).size >= 2,
    true,
    "and more than one way of attaching one"
  );

  for (const preset of COACH_AUTOMATION_PRESETS) {
    const label = `preset "${preset.id}"`;
    assert.ok(preset.label.trim(), `${label} has a label`);
    assert.ok(preset.description.trim(), `${label} has a description`);
    assert.equal(
      preset.definition.presetId,
      preset.id,
      `${label} must carry its own id, or the attach screen cannot find its hints`
    );

    const created = createCoachAutomation(preset.definition, presetDb);

    // The trigger is the part that fails silently, so it is asserted whole.
    assert.deepEqual(
      created.trigger,
      preset.definition.trigger,
      `${label} trigger did not survive normalisation`
    );
    assert.notEqual(
      created.trigger.kind,
      "manual",
      `${label} degraded to a manual trigger, so it would never fire on its own`
    );
    assert.deepEqual(
      created.conditions,
      { ...DEFAULT_AUTOMATION_CONDITIONS, ...preset.definition.conditions },
      `${label} guard rails were clamped or dropped`
    );
    assert.deepEqual(
      created.runtime,
      preset.definition.runtime ?? {},
      `${label} runtime did not survive normalisation`
    );
    assert.equal(created.name, preset.definition.name.trim());
    assert.ok(created.role?.trim(), `${label} has a role`);
    assert.ok(
      created.playbook.includes("{{") || created.playbook.length > 80,
      `${label} playbook is a real brief`
    );

    // Section 7: silence means `low`. Only a preset that genuinely wants more
    // says so, and it must say something the effort switch can offer.
    if (created.runtime.effort) {
      assert.notEqual(
        created.runtime.effort,
        AUTOMATION_DEFAULT_EFFORT,
        `${label} spells out the default effort, which says nothing`
      );
    }
  }

  // A per-run binding needs a title template, and nothing else should carry one.
  for (const preset of COACH_AUTOMATION_PRESETS) {
    const { mode, titleTemplate } = preset.suggestedBinding;
    assert.equal(
      mode === "per-run",
      Boolean(titleTemplate),
      `preset "${preset.id}" pairs a title template with the wrong binding mode`
    );
  }
}

console.log("coach automation store tests passed");
