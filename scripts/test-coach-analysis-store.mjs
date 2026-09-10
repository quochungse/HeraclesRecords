// What an analysis *is*: its fields, the normalizers that read them back, the
// run log, and the preset gallery.
//
// Its life inside a conversation — the per-conversation cap, the trigger's two
// homes, the clocks, what a deleted conversation does — is
// `test-coach-analysis-lifecycle.mjs`. The split is by question, not by table:
// there is one table now.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  DEFAULT_ANALYSIS_CONDITIONS,
  cancelStaleCoachAnalysisRuns,
  listCoachAnalysisRuns,
  recordCoachAnalysisRun,
  countCoachAnalysesForSession,
  createCoachAnalysis,
  deleteCoachAnalysis,
  getCoachAnalysis,
  listCoachAnalysesForSession,
  normalizeAnalysisConditions,
  normalizeAnalysisRuntime,
  normalizeAnalysisTrigger,
  setCoachAnalysisEnabled,
  updateCoachAnalysis
} = await import(`${distUrl("coachAnalysisStore.js")}?cacheBust=${Date.now()}`);

const { ANALYSIS_DEFAULT_EFFORT } = await import(
  `${distUrl("types.js")}?cacheBust=${Date.now()}`
);
const { COACH_ANALYSIS_PRESETS } = await import(
  `${distUrl("coachAnalysisPresets.js")}?cacheBust=${Date.now()}`
);

// better-sqlite3 is built for the Electron ABI and will not dlopen under plain
// node, so the store is exercised through its injectable database interface.
function createMemoryDatabase() {
  /** @type {Map<string, Record<string, unknown>>} */
  const rows = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const localTriggers = new Map();
  /** @type {Array<Record<string, unknown>>} */
  const runs = [];

  return {
    _rows: rows,
    _localTriggers: localTriggers,
    _runs: runs,
    listAnalyses() {
      return [...rows.values()].sort((left, right) =>
        left.created_at.localeCompare(right.created_at)
      );
    },
    listAnalysesForSession(sessionId) {
      return [...rows.values()]
        .filter((row) => row.session_id === sessionId)
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((row) => ({ ...row }));
    },
    countAnalysesForSession(sessionId) {
      return [...rows.values()].filter((row) => row.session_id === sessionId)
        .length;
    },
    deleteAnalysesForSession(sessionId) {
      const ids = [];
      for (const [id, row] of rows) {
        if (row.session_id === sessionId) {
          rows.delete(id);
          ids.push(id);
        }
      }
      return ids;
    },
    getAnalysis(id) {
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    },
    insertAnalysis(row) {
      assert.ok(!rows.has(row.id), "duplicate analysis id");
      rows.set(row.id, { ...row });
    },
    updateAnalysis(row) {
      assert.ok(rows.has(row.id), "update of unknown analysis");
      rows.set(row.id, { ...row });
    },
    deleteAnalysis(id) {
      rows.delete(id);
    },
    getLocalTrigger(analysisId) {
      const row = localTriggers.get(analysisId);
      return row ? { ...row } : undefined;
    },
    upsertLocalTrigger(row) {
      localTriggers.set(row.analysis_id, { ...row });
    },
    deleteLocalTrigger(analysisId) {
      localTriggers.delete(analysisId);
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
const SESSION = "sess-1";

// --- create: an analysis, in a conversation --------------------------------
const manual = createCoachAnalysis(
  {
    sessionId: SESSION,
    name: "  Morning briefing  ",
    role: "Strict marathon coach, injury-prevention first",
    playbook: "Summarise yesterday and set today's focus."
  },
  db
);

assert.equal(manual.name, "Morning briefing");
assert.equal(manual.role, "Strict marathon coach, injury-prevention first");
assert.equal(manual.sessionId, SESSION);
assert.equal(manual.enabled, true);
assert.deepEqual(manual.runtime, {});
assert.equal(manual.sortOrder, 0);
assert.equal(manual.createdAt, manual.updatedAt);
assert.equal(manual.presetId, undefined);

// No trigger asked for, so none stored: an analysis is manual until the
// athlete says otherwise, and that is the common case.
assert.equal(manual.trigger, null);
assert.deepEqual(manual.conditions, DEFAULT_ANALYSIS_CONDITIONS);
assert.equal(manual.deviceOnly, false);
assert.equal(
  db._rows.get(manual.id).trigger_json,
  null,
  "a manual analysis stores no trigger at all"
);

// A conversation is not optional. It is what an analysis *is* — the thing it
// reads, and the place it writes — so there is no partial state where one
// exists without one.
assert.throws(
  () => createCoachAnalysis({ sessionId: "  ", name: "x", playbook: "y" }, db),
  /belongs to a conversation/
);

// --- create: with the trigger that makes it automatic ----------------------
const SCHEDULE = { kind: "schedule", cadence: "daily", timeOfDay: "07:00" };
const scheduled = createCoachAnalysis(
  {
    sessionId: SESSION,
    name: "Daily briefing",
    playbook: "Say what today should be.",
    trigger: SCHEDULE,
    conditions: { cooldownMin: 0, maxRunsPerDay: 1 }
  },
  db
);
assert.deepEqual(scheduled.trigger, SCHEDULE);
assert.deepEqual(scheduled.conditions, { cooldownMin: 0, maxRunsPerDay: 1 });
assert.equal(scheduled.sortOrder, 1, "run order follows creation order");

// A half-filled trigger is refused rather than silently downgraded — an auto
// analysis that never fires is worse than one that would not save.
assert.throws(
  () =>
    createCoachAnalysis(
      {
        sessionId: SESSION,
        name: "x",
        playbook: "y",
        trigger: { kind: "schedule", cadence: "daily" }
      },
      db
    ),
  /Trigger "schedule" is incomplete/
);

// --- create: required fields ------------------------------------------------
assert.throws(
  () => createCoachAnalysis({ sessionId: SESSION, name: "  ", playbook: "x" }, db),
  /name is required/
);
assert.throws(
  () => createCoachAnalysis({ sessionId: SESSION, name: "x", playbook: "" }, db),
  /playbook is required/
);

// --- create: runtime overrides ----------------------------------------------
const tuned = createCoachAnalysis(
  {
    sessionId: "sess-2",
    name: "Long run debrief",
    playbook: "Debrief the long run.",
    enabled: false,
    presetId: "long-run-debrief",
    runtime: { provider: "claude-api", model: "claude-opus-5", effort: "high" }
  },
  db
);
assert.equal(tuned.enabled, false);
assert.equal(tuned.presetId, "long-run-debrief");
assert.deepEqual(tuned.runtime, {
  provider: "claude-api",
  model: "claude-opus-5",
  effort: "high"
});
assert.equal(
  tuned.sortOrder,
  0,
  "run order is per conversation, so a second conversation starts again at 0"
);

// --- read: scoped to one conversation ---------------------------------------
assert.deepEqual(
  listCoachAnalysesForSession(SESSION, db).map((entry) => entry.id),
  [manual.id, scheduled.id]
);
assert.deepEqual(
  listCoachAnalysesForSession("sess-2", db).map((entry) => entry.id),
  [tuned.id]
);
assert.equal(countCoachAnalysesForSession(SESSION, db), 2);
assert.deepEqual(listCoachAnalysesForSession("nowhere", db), []);
assert.deepEqual(getCoachAnalysis(manual.id, db), manual);
assert.equal(getCoachAnalysis("missing", db), null);

// --- update: patches only what it is given ---------------------------------
const renamed = updateCoachAnalysis(manual.id, { name: "Evening briefing" }, db);
assert.equal(renamed.name, "Evening briefing");
assert.equal(renamed.playbook, manual.playbook);
assert.equal(renamed.role, manual.role, "untouched role survives");
assert.equal(renamed.sessionId, SESSION, "and so does the conversation");
assert.equal(renamed.createdAt, manual.createdAt);
assert.ok(renamed.updatedAt >= manual.updatedAt);

// Clearing an optional string removes the key rather than storing "".
const roleless = updateCoachAnalysis(manual.id, { role: "  " }, db);
assert.equal(roleless.role, undefined);
assert.equal(db._rows.get(manual.id).role, null);

assert.equal(updateCoachAnalysis("missing", { name: "x" }, db), null);
assert.throws(() => updateCoachAnalysis(manual.id, { name: "" }, db), /name is required/);

// An analysis cannot change conversation. The patch type says so, and the
// store ignores it if one arrives anyway — a move would be a new analysis
// with a new run history, and pretending otherwise would leave the run log
// naming a conversation the runs never touched.
const moved = updateCoachAnalysis(
  manual.id,
  { sessionId: "sess-elsewhere", name: "Still here" },
  db
);
assert.equal(moved.sessionId, SESSION);
assert.equal(db._rows.get(manual.id).session_id, SESSION);

// --- enable toggle ----------------------------------------------------------
assert.equal(setCoachAnalysisEnabled(tuned.id, true, db).enabled, true);
assert.equal(db._rows.get(tuned.id).enabled, 1);
assert.equal(setCoachAnalysisEnabled(tuned.id, false, db).enabled, false);
assert.equal(db._rows.get(tuned.id).enabled, 0);
assert.equal(setCoachAnalysisEnabled("missing", true, db), null);

// --- normalizers: corrupt rows degrade instead of throwing ------------------
assert.deepEqual(normalizeAnalysisTrigger(null), { kind: "manual" });
assert.deepEqual(normalizeAnalysisTrigger({ kind: "nope" }), { kind: "manual" });
assert.deepEqual(normalizeAnalysisTrigger({ kind: "schedule", timeOfDay: "25:00" }), {
  kind: "manual"
});
assert.deepEqual(
  normalizeAnalysisTrigger({ kind: "schedule", cadence: "weekly", timeOfDay: "06:00", dayOfWeek: 9 }),
  { kind: "schedule", cadence: "weekly", timeOfDay: "06:00", dayOfWeek: 6 }
);
assert.deepEqual(normalizeAnalysisTrigger({ kind: "threshold", metric: "sleepDebt" }), {
  kind: "manual"
});
// R5. A metric name nobody implements is the same class of typo as a malformed
// time, and it degrades the same way. Without this the row stores a threshold
// trigger the scheduler evaluates to `false` for ever — one that looks
// configured on screen and can never fire, which is worse than one that
// visibly fell back to manual.
assert.deepEqual(
  normalizeAnalysisTrigger({ kind: "threshold", metric: "vo2maxSlump", value: 5 }),
  { kind: "manual" },
  "an unimplemented metric is not a threshold trigger"
);
for (const metric of ["acuteChronicRamp", "restingHrDrift", "planAdherence", "sleepDebt"]) {
  assert.deepEqual(
    normalizeAnalysisTrigger({ kind: "threshold", metric, value: 5 }),
    { kind: "threshold", metric, value: 5 },
    `${metric} is one of the four 3.3 names`
  );
}
assert.deepEqual(
  normalizeAnalysisTrigger({ kind: "activity", sportTypes: [100, "junk", 102], minDurationSec: 3600.4, minDistanceM: -5 }),
  { kind: "activity", sportTypes: [100, 102], minDurationSec: 3600 },
  "junk sport ids and non-positive filters are dropped"
);

// multiActivity is opt-in: a trigger written before the option existed keeps
// the "newest activity only" behaviour it already had, and nothing but an
// explicit true turns the catch-up on.
assert.equal(
  normalizeAnalysisTrigger({ kind: "activity", sportTypes: [] }).multiActivity,
  undefined
);
assert.equal(
  normalizeAnalysisTrigger({ kind: "activity", sportTypes: [], multiActivity: "yes" })
    .multiActivity,
  undefined
);
assert.equal(
  normalizeAnalysisTrigger({ kind: "activity", sportTypes: [], multiActivity: true })
    .multiActivity,
  true
);

assert.deepEqual(normalizeAnalysisConditions("not json"), DEFAULT_ANALYSIS_CONDITIONS);
assert.equal(normalizeAnalysisConditions({ maxRunsPerDay: 0 }).maxRunsPerDay, 1);
assert.equal(normalizeAnalysisConditions({ maxRunsPerDay: 999 }).maxRunsPerDay, 24);
assert.equal(normalizeAnalysisConditions({ cooldownMin: -5 }).cooldownMin, 0);
assert.equal(
  normalizeAnalysisConditions({ quietHours: { start: "9pm", end: "6am" } }).quietHours,
  undefined
);

assert.deepEqual(normalizeAnalysisRuntime({ provider: "openai", effort: "turbo" }), {});
assert.deepEqual(normalizeAnalysisRuntime({ model: "  gpt  " }), { model: "gpt" });

// A row whose JSON is unparseable still yields a usable analysis.
db._rows.set("corrupt", {
  id: "corrupt",
  session_id: SESSION,
  name: "Corrupt",
  role: null,
  playbook: "p",
  enabled: 1,
  preset_id: null,
  runtime_json: "{not json",
  trigger_json: "{not json",
  conditions_json: "{not json",
  device_only: 0,
  sort_order: 9,
  last_run_at: null,
  next_run_at: null,
  last_activity_at: null,
  backoff_until: null,
  backoff_level: null,
  threshold_firing: null,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:00:00.000Z"
});
const corrupt = getCoachAnalysis("corrupt", db);
assert.deepEqual(corrupt.runtime, {});
// Unparseable reads as *no* trigger rather than as a manual one, and the
// difference matters: `null` is the state nothing fires from, so a row nobody
// can read stays silent instead of being handed to the scheduler.
assert.equal(corrupt.trigger, null);
assert.deepEqual(corrupt.conditions, DEFAULT_ANALYSIS_CONDITIONS);
assert.equal(corrupt.name, "Corrupt");
db._rows.delete("corrupt");

// --- a run row whose status is not a status --------------------------------
// R5. Every reader downstream branches on this — the burst guard and the daily
// cap count particular statuses, 9.3's dot counts two of them, and the row
// shows Stop for `running`. A value that is none of them would be compared
// against all of those lists and match nothing, so the run would be invisible
// to every guard while still sitting in the log. Reading it as `failed` puts
// it somewhere real: counted against the day, counted against nothing else.
{
  const corruptDb = createMemoryDatabase();
  const owner = createCoachAnalysis(
    { sessionId: SESSION, name: "Corrupt", playbook: "p" },
    corruptDb
  );
  const good = recordCoachAnalysisRun(
    { analysisId: owner.id, status: "success", triggerKind: "manual" },
    corruptDb
  );
  corruptDb.updateRun({
    ...corruptDb.getRun(good.id),
    status: "halfway",
    trigger_kind: "telepathy"
  });

  const [read] = listCoachAnalysisRuns({ analysisId: owner.id }, corruptDb);
  assert.equal(read.status, "failed", "a status that is not a status reads as failed");
  assert.equal(read.triggerKind, "manual", "and a trigger kind that is not one reads as manual");
}

// --- delete: takes the device-only trigger with it -------------------------
// The local trigger table has no foreign key — this database never turns on
// PRAGMA foreign_keys — so nothing but this code path removes those rows. A
// leak here is a private schedule outliving the analysis it belonged to.
{
  const deleteDb = createMemoryDatabase();
  const doomed = createCoachAnalysis(
    {
      sessionId: SESSION,
      name: "Doomed",
      playbook: "p",
      trigger: SCHEDULE,
      deviceOnly: true
    },
    deleteDb
  );
  const survivor = createCoachAnalysis(
    {
      sessionId: SESSION,
      name: "Survivor",
      playbook: "p",
      trigger: SCHEDULE,
      deviceOnly: true
    },
    deleteDb
  );

  assert.ok(deleteDb._localTriggers.has(doomed.id));
  deleteCoachAnalysis(doomed.id, deleteDb);

  assert.equal(getCoachAnalysis(doomed.id, deleteDb), null);
  assert.equal(
    deleteDb._localTriggers.has(doomed.id),
    false,
    "a device-only trigger must not outlive the analysis it belongs to"
  );
  assert.equal(
    deleteDb._localTriggers.has(survivor.id),
    true,
    "and another analysis's must be left alone"
  );

  deleteCoachAnalysis("missing", deleteDb); // no-op
}

// --- a run in flight when the app quit is reconciled at startup ------------
// Nothing is left to finish it, so without this the run log spins forever.
const runsAnalysis = createCoachAnalysis(
  { sessionId: SESSION, name: "Runs", playbook: "p" },
  db
);
const inFlight = recordCoachAnalysisRun(
  { analysisId: runsAnalysis.id, status: "running", triggerKind: "manual" },
  db
);
const finished = recordCoachAnalysisRun(
  {
    analysisId: runsAnalysis.id,
    status: "success",
    triggerKind: "manual",
    summary: "All good.",
    finishedAt: "2026-08-21T09:00:00.000Z"
  },
  db
);

assert.equal(cancelStaleCoachAnalysisRuns(db), 1, "only the in-flight run is stale");
const afterStartup = listCoachAnalysisRuns({}, db);
const reconciled = afterStartup.find((run) => run.id === inFlight.id);
assert.equal(reconciled.status, "cancelled");
assert.ok(reconciled.finishedAt, "a reconciled run is no longer open-ended");
assert.match(reconciled.error, /app closed/);
assert.equal(
  afterStartup.find((run) => run.id === finished.id).status,
  "success",
  "a run that already finished is untouched"
);
assert.equal(cancelStaleCoachAnalysisRuns(db), 0, "the second startup finds nothing");

// --- the preset gallery survives the store (9.1) ---------------------------
// A preset is a hand-written analysis that goes straight through the same
// normalizers as anything the athlete types, plus a *suggested* trigger the
// create screen pre-fills. The suggestion is the part that fails silently: a
// typo degrades it to "manual", which ships as a preset that quietly proposes
// nothing rather than as an error.
{
  const presetDb = createMemoryDatabase();
  const ids = COACH_ANALYSIS_PRESETS.map((preset) => preset.id);

  assert.ok(ids.length >= 4, "the gallery is a gallery, not one starting point");
  assert.equal(new Set(ids).size, ids.length, "preset ids are unique");

  const triggerKinds = new Set(
    COACH_ANALYSIS_PRESETS.map((preset) => preset.suggestedTrigger?.kind)
  );
  assert.ok(
    triggerKinds.has("activity") && triggerKinds.has("schedule"),
    "the gallery covers both trigger kinds the app can fire"
  );

  for (const preset of COACH_ANALYSIS_PRESETS) {
    const label = `preset "${preset.id}"`;
    assert.ok(preset.label.trim(), `${label} has a label`);
    assert.ok(preset.description.trim(), `${label} has a description`);
    assert.equal(
      preset.definition.presetId,
      preset.id,
      `${label} must carry its own id, or the create screen cannot find its suggestion`
    );

    // A preset cannot know the conversation, so it must not claim one — the
    // screen that creates from it is inside one and fills that in.
    assert.equal(
      preset.definition.sessionId,
      undefined,
      `${label} must not name a conversation`
    );
    // Nor may it assert a trigger. It suggests one, and the athlete sees the
    // suggestion on the form before anything is saved.
    assert.equal(
      preset.definition.trigger,
      undefined,
      `${label} must not put a trigger on the analysis it creates`
    );

    const created = createCoachAnalysis(
      { ...preset.definition, sessionId: `preset-${preset.id}` },
      presetDb
    );
    assert.equal(created.trigger, null, `${label} created a non-manual analysis`);

    // The suggestion has to survive the same normalizer the athlete's input
    // does, or the create screen opens on a trigger that silently is not the
    // one this preset was written around.
    assert.deepEqual(
      normalizeAnalysisTrigger(preset.suggestedTrigger),
      preset.suggestedTrigger,
      `${label} suggested trigger did not survive normalisation`
    );
    assert.notEqual(
      preset.suggestedTrigger.kind,
      "manual",
      `${label} suggests nothing, so it teaches nothing about triggers`
    );
    assert.deepEqual(
      normalizeAnalysisConditions(preset.suggestedConditions ?? {}),
      { ...DEFAULT_ANALYSIS_CONDITIONS, ...(preset.suggestedConditions ?? {}) },
      `${label} suggested guard rails were clamped or dropped`
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
        ANALYSIS_DEFAULT_EFFORT,
        `${label} spells out the default effort, which says nothing`
      );
    }
  }
}

console.log("coach analysis store tests passed");
