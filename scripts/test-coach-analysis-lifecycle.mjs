// The life of an analysis inside a conversation: the per-conversation cap, the
// trigger's two homes, the run order, the clocks, and what a deleted
// conversation does to everything in it.
//
// What an analysis *is* — its fields, the normalizers, the run log, the preset
// gallery — is `test-coach-analysis-store.mjs`.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  DEFAULT_ANALYSIS_CONDITIONS,
  MAX_ANALYSES_PER_SESSION,
  applyAnalysisSessionDeleted,
  cancelStaleCoachAnalysisRuns,
  countCoachAnalysesForSession,
  createCoachAnalysis,
  deleteCoachAnalysis,
  getCoachAnalysis,
  listCoachAnalysesForSession,
  listCoachAnalysisSessionAttention,
  listCoachAnalysisSummariesForSession,
  listTriggeredCoachAnalyses,
  markCoachAnalysisSessionSeen,
  recordCoachAnalysisRun,
  reorderCoachAnalyses,
  setCoachAnalysisEnabled,
  setCoachAnalysisSchedule,
  updateCoachAnalysis,
  getCoachAnalysisBudget,
  getCoachAnalysisPause,
  setCoachAnalysisBudget,
  setCoachAnalysisPause
} = await import(`${distUrl("coachAnalysisStore.js")}?cacheBust=${Date.now()}`);

// better-sqlite3 is built for the Electron ABI and will not dlopen under plain
// node, so the store is exercised through its injectable database interface.
// The ordering here mirrors the ORDER BY clauses in database.ts so the fake and
// the real table agree on run order.
function createMemoryDatabase() {
  /** @type {Map<string, Record<string, any>>} */
  const rows = new Map();
  /** @type {Map<string, Record<string, any>>} */
  const localTriggers = new Map();
  /** @type {Array<Record<string, any>>} */
  const runs = [];

  /** Section 10's pause, as the single settings row the store writes it to. */
  let pause;
  /** 13: the monthly token ceiling, in the same settings table. */
  let budget;

  const byOrder = (left, right) =>
    left.sort_order - right.sort_order ||
    left.created_at.localeCompare(right.created_at);

  return {
    _rows: rows,
    _localTriggers: localTriggers,
    _runs: runs,
    readPause() {
      return pause;
    },
    writePause(value) {
      pause = value === null ? undefined : value;
    },
    readBudget() {
      return budget;
    },
    writeBudget(value) {
      budget = value === null ? undefined : value;
    },
    listAnalyses() {
      return [...rows.values()].sort(byOrder).map((row) => ({ ...row }));
    },
    listAnalysesForSession(sessionId) {
      return [...rows.values()]
        .filter((row) => row.session_id === sessionId)
        .sort(byOrder)
        .map((row) => ({ ...row }));
    },
    countAnalysesForSession(sessionId) {
      return [...rows.values()].filter((row) => row.session_id === sessionId)
        .length;
    },
    getAnalysis(id) {
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    },
    insertAnalysis(row) {
      assert.ok(!rows.has(row.id), "duplicate analysis id");
      assert.ok(row.session_id, "an analysis without a conversation is not writable");
      rows.set(row.id, { ...row });
    },
    updateAnalysis(row) {
      assert.ok(rows.has(row.id), "update of unknown analysis");
      rows.set(row.id, { ...row });
    },
    deleteAnalysis(id) {
      rows.delete(id);
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
    // Runs, for the conversation-list attention projection (9.3). The filters
    // mirror the WHERE clauses in listCoachAnalysisRunRows.
    listRuns(filter = {}) {
      return runs
        .filter((run) => !filter.analysisId || run.analysis_id === filter.analysisId)
        .filter((run) => !filter.sessionId || run.session_id === filter.sessionId)
        .filter((run) => !filter.statuses || filter.statuses.includes(run.status))
        .filter((run) => !filter.unseenOnly || run.seen_at === null)
        .map((row) => ({ ...row }));
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

function expectCode(fn, code, label) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, code, `${label}: wrong code (${error.message})`);
    assert.equal(error.name, "CoachAnalysisError");
    return error;
  }
  assert.fail(`${label}: expected ${code}, nothing thrown`);
}

const SCHEDULE = { kind: "schedule", cadence: "daily", timeOfDay: "07:00" };
const ACTIVITY = { kind: "activity", sportTypes: [100] };

const db = createMemoryDatabase();
const make = (sessionId, name, patch = {}) =>
  createCoachAnalysis(
    { sessionId, name, playbook: `${name} playbook.`, ...patch },
    db
  );

// --- 2.2 constraint: five per conversation ---------------------------------
assert.equal(MAX_ANALYSES_PER_SESSION, 5);
for (let index = 0; index < MAX_ANALYSES_PER_SESSION; index += 1) {
  make("s1", `Filler ${index}`);
}
assert.equal(countCoachAnalysesForSession("s1", db), MAX_ANALYSES_PER_SESSION);

const limitError = expectCode(
  () => make("s1", "Sixth"),
  "ANALYSIS_LIMIT_REACHED",
  "sixth analysis in one conversation"
);
assert.match(limitError.message, /at most 5/);

// The cap is per conversation, so a second one starts empty. There is no
// global cap and no global list: two conversations' analyses have nothing to
// do with each other.
assert.equal(countCoachAnalysesForSession("s2", db), 0);
const elsewhere = make("s2", "Somewhere else");
assert.equal(elsewhere.sessionId, "s2");

expectCode(
  () => createCoachAnalysis({ sessionId: "", name: "x", playbook: "y" }, db),
  "ANALYSIS_SESSION_REQUIRED",
  "create with no conversation"
);

// Two analyses with the same name in one conversation are fine. There is no
// shared definition to duplicate any more, so the old duplicate-attach refusal
// has nothing left to refuse.
const twinA = make("s3", "Debrief");
const twinB = make("s3", "Debrief");
assert.notEqual(twinA.id, twinB.id);
assert.equal(countCoachAnalysesForSession("s3", db), 2);

// --- "this device only": the trigger goes somewhere sync cannot reach ------
// The whole point of the flag. `syncPolicy` classifies tables, the oplog
// carries whole rows, and a merge is an INSERT OR REPLACE — so there is no
// honest way to hold one column back. The trigger therefore lives in a
// `device`-tier table, and the row that *does* travel carries no trace of it.
{
  const priv = make("s4", "Private schedule", {
    trigger: SCHEDULE,
    conditions: { cooldownMin: 15, maxRunsPerDay: 2 },
    deviceOnly: true
  });

  assert.equal(priv.deviceOnly, true);
  assert.deepEqual(priv.trigger, SCHEDULE);
  assert.deepEqual(priv.conditions, { cooldownMin: 15, maxRunsPerDay: 2 });

  const travelling = db._rows.get(priv.id);
  assert.equal(
    travelling.trigger_json,
    null,
    "a device-only trigger must not be on the row the oplog publishes"
  );
  assert.equal(
    travelling.conditions_json,
    null,
    "and neither must the guard rails that ride with it"
  );
  assert.equal(travelling.device_only, 1);
  assert.deepEqual(
    JSON.parse(db._localTriggers.get(priv.id).trigger_json),
    SCHEDULE,
    "it is in the device-tier table instead"
  );

  // What the *other* machine sees: the analysis arrives, the local trigger
  // does not, and it reads as manual there. Simulated by dropping the local
  // row, which is exactly what a merge on a second machine produces.
  const localCopy = db._localTriggers.get(priv.id);
  db._localTriggers.delete(priv.id);
  const asSeenElsewhere = getCoachAnalysis(priv.id, db);
  assert.equal(
    asSeenElsewhere.trigger,
    null,
    "on another machine a device-only analysis is a manual one"
  );
  assert.equal(
    asSeenElsewhere.deviceOnly,
    true,
    "and it still says the trigger belongs to a machine, rather than vanishing"
  );
  db._localTriggers.set(priv.id, localCopy);

  // Turning the flag off must publish the trigger and clear the private copy —
  // otherwise the local row shadows the shared one for ever.
  const shared = updateCoachAnalysis(priv.id, { deviceOnly: false }, db);
  assert.equal(shared.deviceOnly, false);
  assert.deepEqual(shared.trigger, SCHEDULE);
  assert.deepEqual(
    JSON.parse(db._rows.get(priv.id).trigger_json),
    SCHEDULE,
    "the trigger is on the travelling row once it is allowed to travel"
  );
  assert.equal(
    db._localTriggers.has(priv.id),
    false,
    "and the private copy is gone, not left to shadow it"
  );

  // And turning it back on must take the shared copy *down*. An athlete who
  // makes a schedule private must not leave the other machine still firing it.
  updateCoachAnalysis(priv.id, { deviceOnly: true }, db);
  assert.equal(
    db._rows.get(priv.id).trigger_json,
    null,
    "going private must withdraw the published trigger, not just add a local one"
  );
  assert.deepEqual(
    JSON.parse(db._localTriggers.get(priv.id).trigger_json),
    SCHEDULE
  );

  // Dropping the trigger drops the flag with it: "this device only" is a
  // statement about a trigger, and there is now no trigger to be about.
  const backToManual = updateCoachAnalysis(priv.id, { trigger: null }, db);
  assert.equal(backToManual.trigger, null);
  assert.equal(backToManual.deviceOnly, false);
  assert.equal(db._localTriggers.has(priv.id), false);

  // Same rule on the way in: a manual analysis cannot be device-only.
  const manualPrivate = make("s4", "Manual private", { deviceOnly: true });
  assert.equal(manualPrivate.deviceOnly, false);
  assert.equal(db._localTriggers.has(manualPrivate.id), false);
}

// --- becoming an auto analysis, and stopping being one ---------------------
{
  const promoted = updateCoachAnalysis(twinA.id, { trigger: ACTIVITY }, db);
  assert.deepEqual(promoted.trigger, ACTIVITY);
  const demoted = updateCoachAnalysis(twinA.id, { trigger: null }, db);
  assert.equal(demoted.trigger, null);
  assert.equal(
    db._rows.get(twinA.id).trigger_json,
    null,
    "demoting must clear the stored trigger, not leave it unreachable"
  );

  // An omitted key is unchanged, which is what lets the UI send one field.
  updateCoachAnalysis(twinA.id, { trigger: SCHEDULE }, db);
  const conditionsOnly = updateCoachAnalysis(
    twinA.id,
    { conditions: { maxRunsPerDay: 7 } },
    db
  );
  assert.deepEqual(conditionsOnly.trigger, SCHEDULE, "trigger untouched");
  assert.equal(conditionsOnly.conditions.maxRunsPerDay, 7);
  assert.equal(
    conditionsOnly.conditions.cooldownMin,
    DEFAULT_ANALYSIS_CONDITIONS.cooldownMin,
    "a partial conditions patch keeps the other guard rails"
  );

  // An explicit null clears the quiet window; leaving the key out cannot also
  // mean "remove", which is why null is spelled out.
  updateCoachAnalysis(
    twinA.id,
    { conditions: { quietHours: { start: "22:00", end: "06:00" } } },
    db
  );
  assert.deepEqual(getCoachAnalysis(twinA.id, db).conditions.quietHours, {
    start: "22:00",
    end: "06:00"
  });
  const cleared = updateCoachAnalysis(
    twinA.id,
    { conditions: { quietHours: null } },
    db
  );
  assert.equal(cleared.conditions.quietHours, undefined);
}

// --- 2.2 constraint 4 / 2.3: sort_order is the run order -------------------
const sessionOrder = () =>
  listCoachAnalysesForSession("s1", db).map((entry) => entry.id);
const original = sessionOrder();
assert.equal(original.length, MAX_ANALYSES_PER_SESSION);

const reversed = [...original].reverse();
const reordered = reorderCoachAnalyses("s1", reversed, db);
assert.deepEqual(reordered.map((entry) => entry.id), reversed);
assert.deepEqual(
  reordered.map((entry) => entry.sortOrder),
  [0, 1, 2, 3, 4],
  "sort_order is rewritten densely from zero"
);

// A caller that lists only some ids must not drop the rest out of the rotation.
const partial = reorderCoachAnalyses("s1", [reversed[4], "ghost"], db);
assert.equal(partial[0].id, reversed[4]);
assert.deepEqual(
  partial.slice(1).map((entry) => entry.id),
  reversed.filter((id) => id !== reversed[4]),
  "omitted analyses keep their relative order behind the listed ones"
);
assert.deepEqual(reorderCoachAnalyses("nope", [], db), []);

// --- the clocks (3.1, 3.2, 10) ---------------------------------------------
const clocked = make("s5", "Clocked", { trigger: SCHEDULE });
const stamped = setCoachAnalysisSchedule(
  clocked.id,
  { nextRunAt: "2026-08-23T07:00:00.000Z" },
  db
);
assert.equal(stamped.nextRunAt, "2026-08-23T07:00:00.000Z");
const ranOnce = setCoachAnalysisSchedule(
  clocked.id,
  { lastRunAt: "2026-08-22T07:30:04.000Z" },
  db
);
assert.equal(ranOnce.lastRunAt, "2026-08-22T07:30:04.000Z");
assert.equal(
  ranOnce.nextRunAt,
  "2026-08-23T07:00:00.000Z",
  "absent key is left alone"
);
assert.equal(setCoachAnalysisSchedule("missing", {}, db), null);

// A changed trigger invalidates the slot the scheduler already booked (3.1).
// Moving a briefing from 07:00 to 21:00 must not deliver one more 07:00 first.
{
  const sibling = make("s5", "Sibling", { trigger: SCHEDULE });
  const book = (analysis) =>
    setCoachAnalysisSchedule(
      analysis.id,
      { nextRunAt: "2026-08-22T07:00:00.000Z" },
      db
    );
  book(clocked);
  book(sibling);

  updateCoachAnalysis(
    clocked.id,
    { trigger: { kind: "schedule", cadence: "daily", timeOfDay: "21:00" } },
    db
  );
  assert.equal(
    getCoachAnalysis(clocked.id, db).nextRunAt,
    undefined,
    "the edited analysis loses its booked slot"
  );
  assert.equal(
    getCoachAnalysis(sibling.id, db).nextRunAt,
    "2026-08-22T07:00:00.000Z",
    "and its neighbour's slot is left exactly where it was"
  );

  book(clocked);
  updateCoachAnalysis(clocked.id, { name: "Renamed" }, db);
  assert.equal(
    getCoachAnalysis(clocked.id, db).nextRunAt,
    "2026-08-22T07:00:00.000Z",
    "an edit that leaves the trigger alone leaves the slot alone"
  );
  updateCoachAnalysis(
    clocked.id,
    { trigger: { kind: "schedule", cadence: "daily", timeOfDay: "21:00" } },
    db
  );
  assert.equal(
    getCoachAnalysis(clocked.id, db).nextRunAt,
    "2026-08-22T07:00:00.000Z",
    "and re-sending the same trigger is not an edit"
  );

  // 3.3's firing state goes with the slot, and for the same reason: it records
  // whether the *old* condition held, so a rule moved from "ramp over 30%" to
  // "over 5%" would be comparing today's answer against a question nobody is
  // asking. Back to NULL means the next tick re-seeds — so an edit, like a
  // creation, is silent rather than firing on history.
  setCoachAnalysisSchedule(clocked.id, { thresholdFiring: true }, db);
  assert.equal(getCoachAnalysis(clocked.id, db).thresholdFiring, true);
  updateCoachAnalysis(
    clocked.id,
    { trigger: { kind: "threshold", metric: "acuteChronicRamp", value: 5 } },
    db
  );
  assert.equal(
    getCoachAnalysis(clocked.id, db).thresholdFiring,
    undefined,
    "a changed trigger resets it to never-evaluated"
  );

  setCoachAnalysisSchedule(clocked.id, { thresholdFiring: false }, db);
  updateCoachAnalysis(clocked.id, { conditions: { cooldownMin: 5 } }, db);
  assert.equal(getCoachAnalysis(clocked.id, db).thresholdFiring, false);
}

// The activity watermark lives on the same row.
{
  const watermarked = make("s6", "Watermarked", { trigger: ACTIVITY });
  assert.equal(
    getCoachAnalysis(watermarked.id, db).lastActivityAt,
    undefined,
    "a fresh analysis has never looked at anything"
  );
  const analysed = setCoachAnalysisSchedule(
    watermarked.id,
    { lastActivityAt: 1_755_766_800 },
    db
  );
  assert.equal(analysed.lastActivityAt, 1_755_766_800);
  assert.equal(
    getCoachAnalysis(watermarked.id, db).lastActivityAt,
    1_755_766_800,
    "and it survives the row round-trip"
  );
  assert.equal(
    setCoachAnalysisSchedule(watermarked.id, { lastActivityAt: null }, db)
      .lastActivityAt,
    undefined
  );

  // The failure backoff (10) is the third clock, through the same stamp.
  const backed = setCoachAnalysisSchedule(
    watermarked.id,
    { backoffUntil: "2026-08-22T07:35:00.000Z", backoffLevel: 2 },
    db
  );
  assert.equal(backed.backoffUntil, "2026-08-22T07:35:00.000Z");
  assert.equal(backed.backoffLevel, 2);

  // Clearing it is what a non-failure does, and level 0 has to read back as
  // "no streak" rather than as a streak of zero — the runner tells those apart.
  const cleared = setCoachAnalysisSchedule(
    watermarked.id,
    { backoffUntil: null, backoffLevel: 0 },
    db
  );
  assert.equal(cleared.backoffUntil, undefined);
  assert.equal(cleared.backoffLevel, undefined);
}

// --- what the scheduler's tick and the watcher ask for ---------------------
// One read that skips the manual analyses and the disabled ones. Getting this
// wrong means either a manual analysis firing on a timer or an auto one going
// silent.
{
  const tickDb = createMemoryDatabase();
  const auto = createCoachAnalysis(
    { sessionId: "t1", name: "Auto", playbook: "p", trigger: SCHEDULE },
    tickDb
  );
  const activity = createCoachAnalysis(
    { sessionId: "t2", name: "Activity", playbook: "p", trigger: ACTIVITY },
    tickDb
  );
  const manualOne = createCoachAnalysis(
    { sessionId: "t3", name: "Manual", playbook: "p" },
    tickDb
  );
  const paused = createCoachAnalysis(
    {
      sessionId: "t4",
      name: "Paused",
      playbook: "p",
      trigger: SCHEDULE,
      enabled: false
    },
    tickDb
  );

  const offered = listTriggeredCoachAnalyses(tickDb).map((entry) => entry.id);
  assert.deepEqual(
    offered.sort(),
    [auto.id, activity.id].sort(),
    "only enabled analyses with a real trigger"
  );
  assert.equal(offered.includes(manualOne.id), false, "manual is not a tick");
  assert.equal(offered.includes(paused.id), false);

  // A device-only trigger is a trigger. The tick has to see it, or "this
  // device only" would mean "on no device at all".
  const privateTick = createCoachAnalysis(
    {
      sessionId: "t5",
      name: "Private",
      playbook: "p",
      trigger: SCHEDULE,
      deviceOnly: true
    },
    tickDb
  );
  assert.ok(
    listTriggeredCoachAnalyses(tickDb).some(
      (entry) => entry.id === privateTick.id
    ),
    "a device-only trigger still fires on the device that owns it"
  );
}

// --- 2.4 conversation deleted: everything in it goes -----------------------
// A plain consequence of ownership rather than a policy. An analysis lives in
// one conversation and cannot be moved, so a deleted conversation leaves
// nothing to re-point and nothing to disable. A device-only trigger has to go
// too — nothing else would ever remove it, since the table has no foreign key.
{
  const deleteDb = createMemoryDatabase();
  const kept = createCoachAnalysis(
    { sessionId: "keep", name: "Kept", playbook: "p" },
    deleteDb
  );
  const doomedManual = createCoachAnalysis(
    { sessionId: "doomed", name: "Doomed manual", playbook: "p" },
    deleteDb
  );
  const doomedPrivate = createCoachAnalysis(
    {
      sessionId: "doomed",
      name: "Doomed private",
      playbook: "p",
      trigger: SCHEDULE,
      deviceOnly: true
    },
    deleteDb
  );
  assert.ok(deleteDb._localTriggers.has(doomedPrivate.id));

  const removed = applyAnalysisSessionDeleted("doomed", deleteDb);
  assert.deepEqual(
    removed.map((entry) => entry.id).sort(),
    [doomedManual.id, doomedPrivate.id].sort()
  );
  assert.deepEqual(
    listCoachAnalysesForSession("doomed", deleteDb),
    [],
    "nothing is left pointing at a conversation that does not exist"
  );
  assert.equal(
    deleteDb._localTriggers.has(doomedPrivate.id),
    false,
    "and the device-only trigger went with it"
  );
  assert.equal(
    getCoachAnalysis(kept.id, deleteDb)?.name,
    "Kept",
    "another conversation's analyses are untouched"
  );
  assert.deepEqual(
    applyAnalysisSessionDeleted("never-existed", deleteDb),
    [],
    "a conversation with nothing in it reports nothing"
  );
}

// --- 2.4 is wired to the real delete path, not just exported ---------------
// applyAnalysisSessionDeleted is only useful if deleting a conversation
// actually calls it; without this the lifecycle silently never fires.
const chatServiceSource = readFileSync(
  path.join(repoRoot, "electron", "chatService.ts"),
  "utf8"
);
assert.match(
  chatServiceSource,
  /export function deleteChatSessionById\([\s\S]*?applyAnalysisSessionDeleted\(id\)/,
  "deleting a conversation no longer removes the analyses inside it"
);

// --- one conversation's rows, with what each last did ----------------------
{
  const summaryDb = createMemoryDatabase();
  const first = createCoachAnalysis(
    { sessionId: "sum", name: "First", playbook: "p" },
    summaryDb
  );
  const second = createCoachAnalysis(
    { sessionId: "sum", name: "Second", playbook: "p" },
    summaryDb
  );
  recordCoachAnalysisRun(
    {
      analysisId: first.id,
      status: "success",
      triggerKind: "manual",
      sessionId: "sum",
      summary: "All good."
    },
    summaryDb
  );

  const summaries = listCoachAnalysisSummariesForSession("sum", summaryDb);
  assert.deepEqual(
    summaries.map((row) => row.analysis.id),
    [first.id, second.id],
    "in run order"
  );
  assert.equal(summaries[0].lastRun?.summary, "All good.");
  assert.equal(
    summaries[1].lastRun,
    undefined,
    "one that has never run says so by absence, not by a placeholder"
  );
}

// --- conversation-list attention (9.3) -------------------------------------
// An auto run changes the transcript, so it bumps the conversation to the top
// of the list. The chip says an analysis speaks here; the dot says it has said
// something new. Without the dot the row reorders for no visible reason.
{
  const attentionDb = createMemoryDatabase();
  const live = createCoachAnalysis(
    { sessionId: "s-live", name: "Live", playbook: "p" },
    attentionDb
  );
  const off = createCoachAnalysis(
    { sessionId: "s-off", name: "Off", playbook: "p" },
    attentionDb
  );
  setCoachAnalysisEnabled(off.id, false, attentionDb);

  const byId = () =>
    new Map(
      listCoachAnalysisSessionAttention(attentionDb).map((row) => [
        row.sessionId,
        row
      ])
    );

  let marks = byId();
  assert.equal(marks.get("s-live").attached, true);
  assert.equal(marks.get("s-live").unread, 0, "present is not the same as unread");
  assert.equal(
    marks.has("s-off"),
    false,
    "an analysis switched off is not going to speak"
  );

  // A *manual* analysis still marks its conversation. It is the athlete's way
  // of reaching it from there, which is exactly what the mark announces — and
  // most analyses are manual, so a mark that required a trigger would leave
  // the sidebar almost blank.
  assert.equal(live.trigger, null);

  const run = (sessionId, patch = {}) =>
    recordCoachAnalysisRun(
      {
        analysisId: live.id,
        status: "success",
        triggerKind: "manual",
        sessionId,
        finishedAt: "2026-08-25T07:00:00.000Z",
        ...patch
      },
      attentionDb
    );

  run("s-live");
  run("s-live", { status: "silent" });
  // A skip wrote nothing, so there is nothing unread about it.
  run("s-live", { status: "skipped", skipReason: "cooldown" });
  marks = byId();
  assert.equal(marks.get("s-live").unread, 2, "an answer and a silence, not the skip");

  assert.equal(markCoachAnalysisSessionSeen("s-live", attentionDb), 2);
  assert.equal(byId().get("s-live").unread, 0, "opening it clears the dot");
  assert.equal(
    markCoachAnalysisSessionSeen("s-live", attentionDb),
    0,
    "and opening it again clears nothing"
  );
}

// --- the marks reach the conversation list ---------------------------------
//
// What is left here is source that is *about* source: a contract between two
// files, or a shape TypeScript cannot see. Anything that was really a claim
// about behaviour lives in `test:coach-analysis-renderer`, which mounts these
// components and drives them — a regex could not say the code ran.
{
  const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

  const row = read("src", "chat", "ChatSessionRow.tsx");
  assert.match(
    row,
    /className="chat-session-row-analysis-mark"/,
    "the row must carry the analysis chip" // portable: ChatSessionRow renders inside a mounted ChatView
  );
  assert.match(
    row,
    /className="chat-session-row-unread"/,
    "the row must carry the unread dot" // portable: same mount, same reason
  );

  const view = read("src", "chat", "ChatView.tsx");
  assert.match(
    view,
    /void markSessionRead\(sessionId\);/,
    "opening a conversation must clear its unread mark"
  );
  assert.match(
    view,
    /attention: sessionAttention/,
    "the marks must reach the sidebar"
  );

  // Stop ends the trigger, not the run it was pressed on (10). Both surfaces
  // reach that through one IPC handler, so the wire that can silently rot is
  // the handler's own: `cancelChat` still compiles, still aborts the stream
  // the athlete was looking at, and leaves an activity catch-up to carry on.
  const mainSource = read("electron", "main.ts");
  assert.match(
    mainSource,
    /"analysis:cancelRun",\s*\(_event, runId: string\) => \{\s*cancelAnalysisRun\(runId\);/,
    "Stop must cancel the trigger, not just the run's stream" // SOURCE: main.ts handler body, which the stub replaces
  );
  for (const surface of ["AnalysisDetail.tsx", "ConversationAnalyses.tsx"]) {
    assert.match(
      read("src", "chat", "analyses", surface),
      /await api\.cancelCoachAnalysisRun\(runId\)/,
      `${surface} must route Stop through the analysis handler, not chat's own cancel`
    );
  }

  const popover = read("src", "chat", "analyses", "ConversationAnalyses.tsx");

  // --- 3.4: a manual run runs the one analysis it was pressed on -----------
  // There is nothing to fan out to any more, so the id list that used to
  // narrow it is gone. A second argument reappearing here would mean somebody
  // rebuilt the attach model without saying so.
  assert.match(
    popover,
    /runCoachAnalysisNow\(analysisId\)/,
    "running from the conversation runs that analysis"
  );

  // ...and it runs from exactly one place. The detail screen deliberately has
  // no Run now: it opens over the conversation that holds the button, and two
  // of them one click apart is two ways to start the same run twice. Stop is
  // the other half of that decision and stays on both, because a run in flight
  // is shown on both and there is nothing to duplicate about ending one.
  const detail = read("src", "chat", "analyses", "AnalysisDetail.tsx");
  assert.doesNotMatch(
    detail,
    /runCoachAnalysisNow\(/,
    "the detail screen must not offer a second Run now"
  );
  assert.match(
    detail,
    /await api\.cancelCoachAnalysisRun\(runId\)/,
    "but it must still be able to stop the run it is showing"
  );

  // --- the entry points, which are the shape of the feature ----------------
  // Creating is the only way in, and it happens inside a conversation. An
  // "attach" affordance reappearing anywhere would mean the model came back.
  assert.match(
    popover,
    /Create Auto Analysis/,
    "the conversation is where an analysis is created"
  );
  assert.match(
    popover,
    /onCreateAnalysis\(\)/,
    "and the button has to actually reach the create screen"
  );
  assert.match(
    popover,
    /onOpenAnalysis\(analysis\.id\)/,
    "each row opens that analysis's own detail and settings screen"
  );
  for (const banned of [
    /AttachAnalysisDialog/,
    /attachAnalysis\(/,
    /api\.listCoachAnalyses\(\)/
  ]) {
    assert.doesNotMatch(
      popover,
      banned,
      `the popover must not reach for the attach model (${banned})`
    );
  }

  // Requirement 4: the detail screen has no "Where it runs". An analysis has
  // one place and cannot be moved, so a tab listing one unchangeable row said
  // nothing a person would open a tab for.
  const detailScreen = read("src", "chat", "analyses", "AnalysisDetail.tsx");
  // Matched on the tab definition rather than the words: the file's own
  // header explains at length why the tab is gone, and a check that banned
  // the phrase would ban the explanation.
  assert.doesNotMatch(
    detailScreen,
    /label: "Where it runs"/,
    "the detail screen must not offer a where-it-runs tab"
  );
  assert.doesNotMatch(
    detailScreen,
    /AttachAnalysisDialog|attachAnalysis\(|listAnalysisAttachments/,
    "nor reach for anything else from the attach model"
  );
  // The trigger lives on that screen instead, which is where the tab's space
  // went.
  assert.match(
    detailScreen,
    /<TriggerForm/,
    "the trigger is edited on the analysis's own screen"
  );

  // --- the run log is a way back into the conversation ----------------------
  assert.match(
    detailScreen,
    /onClick=\{\(\) => onOpenConversation\?\.\(opensInto\)\}/,
    "a run log row must open the conversation the run wrote into"
  );
  // A conversation from an old run may have been deleted since. Selecting a
  // session id no row exists for leaves the sidebar with nothing selected and
  // the composer writing into a conversation that is not there.
  assert.match(
    view,
    /const listed = await refreshSessions\(chatSettings\.provider\);\n\s*if \(!listed\.some\(\(session\) => session\.id === sessionId\)\)/,
    "and the conversation has to still exist before it is opened"
  );

  // --- what "a run is in flight here" is read from -------------------------
  // Derived, not accumulated: switching away and back left the map holding
  // runs that had finished meanwhile.
  assert.match(
    popover,
    /listCoachAnalysisRuns\(\{ statuses: \["running"\] \}\)[\s\S]{0,300}?setInFlightRuns\(\s*Object\.fromEntries\(running\.map/,
    "the popover must re-read which runs are in flight, and use the answer"
  );

  // Genuinely about source, and staying: this is a contract between two files
  // that never run in the same process, and an argument dropped on either side
  // still type-checks and still compiles into a call that does the wrong
  // thing. No renderer harness can see across that bridge, because the harness
  // *is* the stub standing in for it.
  assert.match(
    read("electron", "preload.ts"),
    /invoke\("analysis:markSessionSeen", sessionId\)/,
    "preload must forward the session id across the bridge"
  );
  assert.match(
    read("electron", "main.ts"),
    /markCoachAnalysisSessionSeen\(sessionId\)/,
    "the ipcMain handler must forward the session id"
  );

  // The pause and the monthly budget are the only feature-wide controls left,
  // and the screen that used to host them is gone. They have to be somewhere
  // an athlete can reach, or a paused world has no Resume button.
  const settings = read("src", "chat", "ChatSettingsPanel.tsx");
  assert.match(
    settings,
    /resumeCoachAnalyses\(\)/,
    "Settings must be able to resume a paused world"
  );
  assert.match(
    settings,
    /setCoachAnalysisBudget\(/,
    "and to set the monthly ceiling"
  );
}

// --- section 10's pause is one row, and it survives a restart -------------
// One flag for the whole feature rather than a column per attachment: the cause is
// one thing the athlete fixes once, so five copies could only ever disagree.
{
  assert.equal(getCoachAnalysisPause(db), null, "nothing is paused to begin with");

  const held = {
    reason: "two-factor-required",
    since: "2026-08-25T07:30:00.000Z",
    runId: "run-42"
  };
  setCoachAnalysisPause(held, db);
  assert.deepEqual(
    getCoachAnalysisPause(db),
    held,
    "and it reads back whole — a restart must not resume a paused world"
  );

  setCoachAnalysisPause(null, db);
  assert.equal(getCoachAnalysisPause(db), null, "resume clears the row entirely");

  // The optional half is optional.
  setCoachAnalysisPause(
    { reason: "two-factor-required", since: "2026-08-25T07:30:00.000Z" },
    db
  );
  assert.equal(getCoachAnalysisPause(db).runId, undefined);

  // A half-written or hand-edited row reads as "not paused". Trusting a shape
  // nobody checked would hold every analysis forever on the strength of a
  // string somebody once put in a settings table — and the only way out of
  // that is a banner the athlete cannot reach, because it never renders.
  for (const broken of [
    "not json at all",
    "{}",
    '{"reason":"two-factor-required"}',
    '{"since":"2026-08-25T07:30:00.000Z"}',
    '{"reason":"something-else","since":"2026-08-25T07:30:00.000Z"}',
    '{"reason":"two-factor-required","since":"   "}'
  ]) {
    db.writePause(broken);
    assert.equal(
      getCoachAnalysisPause(db),
      null,
      `a malformed pause row must not hold anything: ${broken}`
    );
  }
  db.writePause(null);
}

// --- 12 (item 6): the monthly ceiling ------------------------------------
{
  assert.equal(getCoachAnalysisBudget(db), null, "no ceiling by default");

  assert.equal(setCoachAnalysisBudget(500_000, db), 500_000);
  assert.equal(getCoachAnalysisBudget(db), 500_000, "and it survives a restart");

  // Whole tokens: the number is compared against a SUM of integers, and a
  // fractional ceiling would be a ceiling nothing can land exactly on.
  assert.equal(setCoachAnalysisBudget(1234.7, db), 1234);

  // Everything that is not a positive number means "no ceiling", which is the
  // default. A budget of zero read as a stop would pause every analysis the
  // moment somebody cleared the field.
  for (const value of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      setCoachAnalysisBudget(value, db),
      null,
      `${String(value)} must read as no ceiling, not as a stop`
    );
    assert.equal(getCoachAnalysisBudget(db), null);
  }

  // A hand-edited row follows the same rule rather than being trusted.
  for (const raw of ["", "   ", "not a number", "-5", "0"]) {
    db.writeBudget(raw);
    assert.equal(getCoachAnalysisBudget(db), null, `a "${raw}" row is no ceiling`);
  }
  db.writeBudget(null);
}

// --- R4 step 8: what the startup reconciliation must not touch -------------
// The app quitting mid-run leaves a `running` row, and
// `cancelStaleCoachAnalysisRuns` turns it into `cancelled` (10). It touches
// the run log and *nothing else*, and that is load-bearing rather than
// incidental: a `cancelled` run that goes through the runner's own `finish`
// **clears** the backoff streak, so routing this through the same exit — the
// obvious tidy-up somebody will eventually propose — would mean a crash
// resets the hold on every analysis that was failing. The app closing is not
// a provider reporting itself healthy, any more than the athlete pressing
// Stop is (10).
//
// The same goes for the other two clocks. A crash must leave the activity
// owed and the cooldown where it was, because nothing about the run reached a
// conclusion.
{
  const crashDb = createMemoryDatabase();
  const crashed = createCoachAnalysis(
    {
      sessionId: "s-crashed",
      name: "Crashed",
      playbook: "p",
      trigger: { kind: "activity", sportTypes: [] }
    },
    crashDb
  );
  setCoachAnalysisSchedule(
    crashed.id,
    {
      backoffLevel: 3,
      backoffUntil: "2026-08-21T10:00:00.000Z",
      lastActivityAt: 1_756_000_000,
      lastRunAt: "2026-08-21T08:00:00.000Z"
    },
    crashDb
  );
  recordCoachAnalysisRun(
    { analysisId: crashed.id, status: "running", triggerKind: "activity" },
    crashDb
  );

  assert.equal(
    cancelStaleCoachAnalysisRuns(crashDb),
    1,
    "fixture sanity: exactly one row was left open"
  );
  const after = getCoachAnalysis(crashed.id, crashDb);
  assert.equal(after.backoffLevel, 3, "a crash does not clear the streak");
  assert.equal(after.backoffUntil, "2026-08-21T10:00:00.000Z");
  assert.equal(
    after.lastActivityAt,
    1_756_000_000,
    "nor advance the watermark, so the activity is still owed"
  );
  assert.equal(after.lastRunAt, "2026-08-21T08:00:00.000Z", "nor the cooldown clock");
}

console.log("coach analysis lifecycle tests passed");
