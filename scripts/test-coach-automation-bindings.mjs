import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  MAX_BINDINGS_PER_SESSION,
  applyCoachAutomationSessionDeleted,
  attachCoachAutomation,
  cancelStaleCoachAutomationRuns,
  countCoachAutomationBindings,
  countCoachAutomationBindingsForSession,
  createCoachAutomation,
  deleteCoachAutomation,
  detachCoachAutomation,
  getCoachAutomationBinding,
  listActiveCoachAutomationBindings,
  listCoachAutomationBindings,
  listCoachAutomationBindingsForSession,
  reorderCoachAutomationBindings,
  setCoachAutomationBindingEnabled,
  setCoachAutomationBindingSchedule,
  setCoachAutomationBindingSession,
  getCoachAutomationBudget,
  getCoachAutomationPause,
  setCoachAutomationBudget,
  setCoachAutomationPause,
  listCoachAutomationSessionAttention,
  markCoachAutomationSessionSeen,
  recordCoachAutomationRun,
  setCoachAutomationEnabled,
  updateCoachAutomation
} = await import(`${distUrl("coachAutomationStore.js")}?cacheBust=${Date.now()}`);

// better-sqlite3 is built for the Electron ABI and will not dlopen under plain
// node, so the store is exercised through its injectable database interface.
// The ordering here mirrors the ORDER BY clauses in database.ts so the fake and
// the real table agree on run order.
function createMemoryDatabase() {
  /** @type {Map<string, Record<string, any>>} */
  const automations = new Map();
  /** @type {Map<string, Record<string, any>>} */
  const bindings = new Map();

  /** @type {Array<Record<string, any>>} */
  const runs = [];

  /** Section 10's pause, as the single settings row the store writes it to. */
  let pause;
  /** 12 (item 6): the monthly token ceiling, in the same settings table. */
  let budget;

  const byOrder = (left, right) =>
    left.sort_order - right.sort_order ||
    left.created_at.localeCompare(right.created_at);

  return {
    _automations: automations,
    _bindings: bindings,
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
    listAutomations() {
      return [...automations.values()].sort((left, right) =>
        left.created_at.localeCompare(right.created_at)
      );
    },
    getAutomation(id) {
      const row = automations.get(id);
      return row ? { ...row } : undefined;
    },
    insertAutomation(row) {
      automations.set(row.id, { ...row });
    },
    updateAutomation(row) {
      automations.set(row.id, { ...row });
    },
    deleteAutomation(id) {
      automations.delete(id);
    },
    deleteBindingsForAutomation(automationId) {
      for (const [id, row] of bindings) {
        if (row.automation_id === automationId) bindings.delete(id);
      }
    },
    countBindings(automationId) {
      return [...bindings.values()].filter(
        (row) => row.automation_id === automationId
      ).length;
    },
    listBindings(automationId) {
      return [...bindings.values()]
        .filter((row) => row.automation_id === automationId)
        .sort(byOrder)
        .map((row) => ({ ...row }));
    },
    listBindingsForSession(sessionId) {
      return [...bindings.values()]
        .filter((row) => row.session_id !== null && row.session_id === sessionId)
        .sort(byOrder)
        .map((row) => ({ ...row }));
    },
    getBinding(id) {
      const row = bindings.get(id);
      return row ? { ...row } : undefined;
    },
    insertBinding(row) {
      assert.ok(!bindings.has(row.id), "duplicate binding id");
      // The partial unique indexes must never be reachable from the store —
      // every violation should have been refused with a code first.
      for (const existing of bindings.values()) {
        if (existing.automation_id !== row.automation_id) continue;
        assert.ok(
          !(existing.session_id === null && row.session_id === null),
          "store let a second per-run binding through to the unique index"
        );
        assert.ok(
          !(row.session_id !== null && existing.session_id === row.session_id),
          "store let a duplicate attach through to the unique index"
        );
      }
      bindings.set(row.id, { ...row });
    },
    updateBinding(row) {
      assert.ok(bindings.has(row.id), "update of unknown binding");
      bindings.set(row.id, { ...row });
    },
    deleteBinding(id) {
      bindings.delete(id);
    },
    // Runs, for the conversation-list attention projection (9.3). The filters
    // mirror the WHERE clauses in listCoachAutomationRunRows.
    listRuns(filter = {}) {
      return runs
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
    assert.equal(error.name, "CoachAutomationBindingError");
    return error;
  }
  assert.fail(`${label}: expected ${code}, nothing thrown`);
}

const db = createMemoryDatabase();
const makeAutomation = (name) =>
  createCoachAutomation(
    { name, playbook: `${name} playbook`, trigger: { kind: "manual" } },
    db
  );

const briefing = makeAutomation("Briefing");
const debrief = makeAutomation("Debrief");

// --- 2.1 modes --------------------------------------------------------------
const dedicated = attachCoachAutomation(
  { automationId: briefing.id, mode: "dedicated", sessionId: "s1" },
  db
);
assert.equal(dedicated.mode, "dedicated");
assert.equal(dedicated.sessionId, "s1");
assert.equal(dedicated.enabled, true);
assert.equal(dedicated.sortOrder, 0);
assert.equal(dedicated.titleTemplate, undefined);
assert.equal(db._bindings.get(dedicated.id).enabled, 1);

const perRun = attachCoachAutomation(
  {
    automationId: debrief.id,
    mode: "per-run",
    titleTemplate: "{{rule.name}} · {{activity.name}}"
  },
  db
);
assert.equal(perRun.sessionId, null);
assert.equal(perRun.titleTemplate, "{{rule.name}} · {{activity.name}}");

// A title template on a mode that does not create its conversation is dropped.
const existing = attachCoachAutomation(
  {
    automationId: debrief.id,
    mode: "existing",
    sessionId: "s1",
    titleTemplate: "ignored"
  },
  db
);
assert.equal(existing.titleTemplate, undefined);
assert.equal(existing.sortOrder, 1, "second attach queues behind the first");
assert.deepEqual(getCoachAutomationBinding(existing.id, db), existing);
assert.equal(getCoachAutomationBinding("missing", db), null);

// --- 2.2 constraint 1: max 5 per conversation ------------------------------
assert.equal(MAX_BINDINGS_PER_SESSION, 5);
const fillers = [];
for (let index = 0; index < MAX_BINDINGS_PER_SESSION - 2; index += 1) {
  const automation = makeAutomation(`Filler ${index}`);
  fillers.push(
    attachCoachAutomation(
      { automationId: automation.id, mode: "existing", sessionId: "s1" },
      db
    )
  );
}
assert.equal(countCoachAutomationBindingsForSession("s1", db), 5);

const sixth = makeAutomation("Sixth");
const limitError = expectCode(
  () =>
    attachCoachAutomation(
      { automationId: sixth.id, mode: "existing", sessionId: "s1" },
      db
    ),
  "BINDING_LIMIT_REACHED",
  "sixth attach"
);
assert.match(limitError.message, /at most 5 automations/);
assert.equal(countCoachAutomationBindingsForSession("s1", db), 5, "no partial write");

// A per-run binding has no conversation, so it never eats into the cap.
assert.equal(
  listCoachAutomationBindingsForSession("s1", db).some(
    (binding) => binding.id === perRun.id
  ),
  false
);
attachCoachAutomation({ automationId: sixth.id, mode: "per-run" }, db);

// --- 2.2 constraint 2: no duplicate attach ---------------------------------
expectCode(
  () =>
    attachCoachAutomation(
      { automationId: briefing.id, mode: "existing", sessionId: "s1" },
      db
    ),
  "BINDING_DUPLICATE",
  "duplicate attach"
);
// Same automation on a *different* conversation is fine (fan-out, 2.3).
const fanOut = attachCoachAutomation(
  { automationId: briefing.id, mode: "existing", sessionId: "s2" },
  db
);
assert.equal(fanOut.sortOrder, 0, "sort_order is per conversation");
assert.equal(countCoachAutomationBindings(briefing.id, db), 2);

// --- 2.2 constraint 3: one per-run binding per automation ------------------
expectCode(
  () => attachCoachAutomation({ automationId: debrief.id, mode: "per-run" }, db),
  "BINDING_PER_RUN_EXISTS",
  "second per-run"
);

// --- attach argument validation --------------------------------------------
expectCode(
  () => attachCoachAutomation({ automationId: "nope", mode: "existing", sessionId: "s3" }, db),
  "AUTOMATION_NOT_FOUND",
  "unknown automation"
);
expectCode(
  () => attachCoachAutomation({ automationId: briefing.id, mode: "existing" }, db),
  "BINDING_SESSION_REQUIRED",
  "existing without session"
);
expectCode(
  () => attachCoachAutomation({ automationId: briefing.id, mode: "dedicated", sessionId: "  " }, db),
  "BINDING_SESSION_REQUIRED",
  "dedicated with blank session"
);
expectCode(
  () =>
    attachCoachAutomation(
      { automationId: briefing.id, mode: "per-run", sessionId: "s3" },
      db
    ),
  "BINDING_SESSION_NOT_ALLOWED",
  "per-run with session"
);
assert.throws(
  () => attachCoachAutomation({ automationId: briefing.id, mode: "whatever" }, db),
  /Unknown automation binding mode/
);

// --- enable toggle ----------------------------------------------------------
assert.equal(setCoachAutomationBindingEnabled(existing.id, false, db).enabled, false);
assert.equal(db._bindings.get(existing.id).enabled, 0);
assert.equal(setCoachAutomationBindingEnabled(existing.id, true, db).enabled, true);
assert.equal(setCoachAutomationBindingEnabled("missing", true, db), null);

// --- 2.2 constraint 4 / 2.3: sort_order is the run order -------------------
const sessionOrder = () =>
  listCoachAutomationBindingsForSession("s1", db).map((binding) => binding.id);
const original = sessionOrder();
assert.deepEqual(original, [dedicated.id, existing.id, ...fillers.map((b) => b.id)]);

const reversed = [...original].reverse();
const reordered = reorderCoachAutomationBindings("s1", reversed, db);
assert.deepEqual(reordered.map((binding) => binding.id), reversed);
assert.deepEqual(
  reordered.map((binding) => binding.sortOrder),
  [0, 1, 2, 3, 4],
  "sort_order is compacted, so it stays unique within the conversation"
);

// Foreign, repeated and unknown ids are ignored; anything left out keeps its
// relative order behind what the caller did list.
const partial = reorderCoachAutomationBindings(
  "s1",
  [existing.id, existing.id, perRun.id, fanOut.id, "missing"],
  db
);
assert.equal(partial[0].id, existing.id);
assert.equal(partial.length, 5, "omitted bindings are not dropped");
assert.deepEqual(
  partial.slice(1).map((binding) => binding.id),
  reversed.filter((id) => id !== existing.id),
  "omitted bindings keep their relative order"
);
assert.deepEqual(partial.map((binding) => binding.sortOrder), [0, 1, 2, 3, 4]);
// The foreign binding was untouched by the reorder of another conversation.
assert.equal(getCoachAutomationBinding(fanOut.id, db).sortOrder, 0);

// --- schedule stamps (3.1 keeps these per binding) -------------------------
const stamped = setCoachAutomationBindingSchedule(
  dedicated.id,
  { nextRunAt: "2026-08-22T07:30:00.000Z" },
  db
);
assert.equal(stamped.nextRunAt, "2026-08-22T07:30:00.000Z");
assert.equal(stamped.lastRunAt, undefined);
const ranOnce = setCoachAutomationBindingSchedule(
  dedicated.id,
  { lastRunAt: "2026-08-22T07:30:04.000Z" },
  db
);
assert.equal(ranOnce.nextRunAt, "2026-08-22T07:30:00.000Z", "absent key is left alone");
assert.equal(ranOnce.lastRunAt, "2026-08-22T07:30:04.000Z");
assert.equal(
  setCoachAutomationBindingSchedule(dedicated.id, { nextRunAt: null }, db).nextRunAt,
  undefined
);
assert.equal(setCoachAutomationBindingSchedule("missing", {}, db), null);

// A changed trigger invalidates the slots the scheduler already booked (3.1).
// Moving a briefing from 07:00 to 21:00 must not deliver one more 07:00 first.
{
  const rebooked = makeAutomation("Rebooked");
  const first = attachCoachAutomation(
    { automationId: rebooked.id, mode: "dedicated", sessionId: "s-reboot-a" },
    db
  );
  const second = attachCoachAutomation(
    { automationId: rebooked.id, mode: "dedicated", sessionId: "s-reboot-b" },
    db
  );
  const book = (binding) =>
    setCoachAutomationBindingSchedule(
      binding.id,
      { nextRunAt: "2026-08-22T07:00:00.000Z" },
      db
    );
  book(first);
  book(second);

  updateCoachAutomation(
    rebooked.id,
    { trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:00" } },
    db
  );
  assert.equal(
    getCoachAutomationBinding(first.id, db).nextRunAt,
    undefined,
    "every binding of the edited automation loses its booked slot"
  );
  assert.equal(getCoachAutomationBinding(second.id, db).nextRunAt, undefined);

  book(first);
  updateCoachAutomation(rebooked.id, { name: "Renamed" }, db);
  assert.equal(
    getCoachAutomationBinding(first.id, db).nextRunAt,
    "2026-08-22T07:00:00.000Z",
    "an edit that leaves the trigger alone leaves the slot alone"
  );
  updateCoachAutomation(
    rebooked.id,
    { trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:00" } },
    db
  );
  assert.equal(
    getCoachAutomationBinding(first.id, db).nextRunAt,
    "2026-08-22T07:00:00.000Z",
    "and re-sending the same trigger is not an edit"
  );

  // 3.3's firing state goes with the slot, and for the same reason: it records
  // whether the *old* condition held, so a rule moved from "ramp over 30%" to
  // "over 5%" would be comparing today's answer against a question nobody is
  // asking. Back to NULL means the next tick re-seeds — so an edit, like an
  // attach, is silent rather than firing on history.
  setCoachAutomationBindingSchedule(first.id, { thresholdFiring: true }, db);
  assert.equal(getCoachAutomationBinding(first.id, db).thresholdFiring, true);
  updateCoachAutomation(
    rebooked.id,
    { trigger: { kind: "threshold", metric: "acuteChronicRamp", value: 5 } },
    db
  );
  assert.equal(
    getCoachAutomationBinding(first.id, db).thresholdFiring,
    undefined,
    "a changed trigger resets the binding to never-evaluated"
  );

  // And an edit that leaves the trigger alone leaves the state alone.
  setCoachAutomationBindingSchedule(first.id, { thresholdFiring: false }, db);
  updateCoachAutomation(rebooked.id, { name: "Renamed again" }, db);
  assert.equal(getCoachAutomationBinding(first.id, db).thresholdFiring, false);
}

// The activity watermark lives on the same row: a binding attached last month
// and one attached today owe answers on different activities, so it cannot be
// tracked per automation.
assert.equal(
  getCoachAutomationBinding(dedicated.id, db).lastActivityAt,
  undefined,
  "a fresh binding has never analysed anything"
);
const analysed = setCoachAutomationBindingSchedule(
  dedicated.id,
  { lastActivityAt: 1_755_766_800 },
  db
);
assert.equal(analysed.lastActivityAt, 1_755_766_800);
assert.equal(
  analysed.lastRunAt,
  "2026-08-22T07:30:04.000Z",
  "absent key is left alone"
);
assert.equal(
  getCoachAutomationBinding(dedicated.id, db).lastActivityAt,
  1_755_766_800,
  "and it survives the row round-trip"
);
assert.equal(
  setCoachAutomationBindingSchedule(dedicated.id, { lastActivityAt: null }, db)
    .lastActivityAt,
  undefined
);

// The failure backoff (10) is the third clock on the row, and it goes through
// the same stamp. The runner suite drives it against a hand-written world, so
// this is the only place that says the two columns exist and round-trip.
{
  const backed = setCoachAutomationBindingSchedule(
    dedicated.id,
    { backoffUntil: "2026-08-22T07:35:00.000Z", backoffLevel: 2 },
    db
  );
  assert.equal(backed.backoffUntil, "2026-08-22T07:35:00.000Z");
  assert.equal(backed.backoffLevel, 2);
  assert.equal(
    backed.lastRunAt,
    "2026-08-22T07:30:04.000Z",
    "absent key is left alone"
  );
  assert.equal(
    getCoachAutomationBinding(dedicated.id, db).backoffLevel,
    2,
    "and it survives the row round-trip"
  );

  // Clearing it is what a non-failure does, and level 0 has to read back as
  // "no streak" rather than as a streak of zero — the runner tells those apart.
  const cleared = setCoachAutomationBindingSchedule(
    dedicated.id,
    { backoffUntil: null, backoffLevel: 0 },
    db
  );
  assert.equal(cleared.backoffUntil, undefined);
  assert.equal(cleared.backoffLevel, undefined);

  // A binding written before the columns existed is a healthy one, not a
  // half-backed-off one.
  const legacy = db._bindings.get(dedicated.id);
  delete legacy.backoff_until;
  delete legacy.backoff_level;
  const migrated = getCoachAutomationBinding(dedicated.id, db);
  assert.equal(migrated.backoffUntil, undefined);
  assert.equal(migrated.backoffLevel, undefined);
}

// --- 2.4 automation disabled: bindings stop, rows survive -------------------
assert.equal(listActiveCoachAutomationBindings(briefing.id, db).length, 2);
setCoachAutomationEnabled(briefing.id, false, db);
assert.deepEqual(listActiveCoachAutomationBindings(briefing.id, db), []);
assert.equal(
  listCoachAutomationBindings(briefing.id, db).length,
  2,
  "binding rows are kept while the automation is off"
);
assert.equal(
  listCoachAutomationBindings(briefing.id, db).every((binding) => binding.enabled),
  true,
  "per-binding enabled flags are untouched"
);
setCoachAutomationEnabled(briefing.id, true, db);
assert.equal(listActiveCoachAutomationBindings(briefing.id, db).length, 2);
// A disabled binding on an enabled automation is also inactive.
setCoachAutomationBindingEnabled(fanOut.id, false, db);
assert.deepEqual(
  listActiveCoachAutomationBindings(briefing.id, db).map((b) => b.id),
  [dedicated.id]
);
setCoachAutomationBindingEnabled(fanOut.id, true, db);
assert.deepEqual(listActiveCoachAutomationBindings("missing", db), []);

// --- 2.4 conversation deleted ----------------------------------------------
const report = applyCoachAutomationSessionDeleted("s1", db);
assert.deepEqual(
  report.needsSession.map((binding) => binding.id),
  [dedicated.id],
  "the dedicated binding rebuilds its conversation on the next run"
);
assert.equal(report.needsSession[0].enabled, true, "and stays enabled");
assert.equal(
  db._bindings.get(dedicated.id).session_id,
  "s1",
  "stale session_id is kept so the row cannot masquerade as per-run"
);
assert.equal(report.disabled.length, 4, "every existing binding on s1 is disabled");
assert.equal(
  report.disabled.every((binding) => binding.enabled === false),
  true
);
assert.equal(
  report.disabled.some((binding) => binding.id === existing.id),
  true
);
assert.equal(
  getCoachAutomationBinding(perRun.id, db).enabled,
  true,
  "per-run bindings are untouched by a conversation deletion"
);
assert.equal(
  getCoachAutomationBinding(fanOut.id, db).enabled,
  true,
  "bindings on other conversations are untouched"
);
assert.deepEqual(applyCoachAutomationSessionDeleted("never-existed", db), {
  disabled: [],
  needsSession: []
});

// --- repointing a broken binding -------------------------------------------
const repointed = setCoachAutomationBindingSession(existing.id, "s3", db);
assert.equal(repointed.sessionId, "s3");
assert.equal(repointed.enabled, true, "repointing is the fix for being disabled");
assert.equal(repointed.sortOrder, 0, "it queues into the new conversation");
expectCode(
  () => setCoachAutomationBindingSession(perRun.id, "s3", db),
  "BINDING_SESSION_NOT_ALLOWED",
  "repoint a per-run binding"
);
expectCode(
  () => setCoachAutomationBindingSession(existing.id, "", db),
  "BINDING_SESSION_REQUIRED",
  "repoint at nothing"
);
// Repointing onto a conversation that already runs this automation is a
// duplicate; onto a full conversation it hits the same cap as an attach.
const clash = attachCoachAutomation(
  { automationId: debrief.id, mode: "dedicated", sessionId: "s4" },
  db
);
expectCode(
  () => setCoachAutomationBindingSession(existing.id, "s4", db),
  "BINDING_DUPLICATE",
  "repoint onto a duplicate"
);
for (let index = 0; index < 4; index += 1) {
  const automation = makeAutomation(`Packing ${index}`);
  attachCoachAutomation(
    { automationId: automation.id, mode: "existing", sessionId: "s4" },
    db
  );
}
assert.equal(countCoachAutomationBindingsForSession("s4", db), 5);
const briefingOnS2 = getCoachAutomationBinding(fanOut.id, db);
expectCode(
  () => setCoachAutomationBindingSession(briefingOnS2.id, "s4", db),
  "BINDING_LIMIT_REACHED",
  "repoint onto a full conversation"
);
assert.equal(getCoachAutomationBinding(fanOut.id, db).sessionId, "s2", "no partial write");
// Repointing at the conversation it already uses just re-enables it.
setCoachAutomationBindingEnabled(clash.id, false, db);
const sameSession = setCoachAutomationBindingSession(clash.id, "s4", db);
assert.equal(sameSession.enabled, true);
assert.equal(sameSession.sessionId, "s4");
assert.equal(sameSession.sortOrder, clash.sortOrder, "order is not disturbed");
assert.equal(setCoachAutomationBindingSession("missing", "s4", db), null);

// --- 2.4 binding removed: conversation and siblings survive ----------------
const beforeDetach = countCoachAutomationBindingsForSession("s4", db);
detachCoachAutomation(clash.id, db);
assert.equal(getCoachAutomationBinding(clash.id, db), null);
assert.equal(countCoachAutomationBindingsForSession("s4", db), beforeDetach - 1);
assert.equal(countCoachAutomationBindings(debrief.id, db), 2, "its other bindings stay");
detachCoachAutomation("missing", db); // no-op

// --- 2.4 automation deleted: bindings go, other automations stay -----------
const debriefBindings = countCoachAutomationBindings(debrief.id, db);
assert.ok(debriefBindings > 0);
const survivorCount = db._bindings.size - debriefBindings;
deleteCoachAutomation(debrief.id, db);
assert.deepEqual(listCoachAutomationBindings(debrief.id, db), []);
assert.equal(db._bindings.size, survivorCount, "only its own bindings were removed");
assert.equal(
  getCoachAutomationBinding(fanOut.id, db).id,
  fanOut.id,
  "another automation's binding on the same conversation survives"
);

// --- 2.4 is wired to the real delete path, not just exported ---------------
// applyCoachAutomationSessionDeleted is only useful if deleting a conversation
// actually calls it; without this the lifecycle silently never fires in the app.
const chatServiceSource = readFileSync(
  path.join(repoRoot, "electron", "chatService.ts"),
  "utf8"
);
assert.match(
  chatServiceSource,
  /export function deleteChatSessionById\([\s\S]*?applyCoachAutomationSessionDeleted\(id\)/,
  "deleting a conversation no longer notifies the bindings pointing at it"
);

// --- conversation-list attention (9.3) -------------------------------------
// An auto run changes the transcript, so it bumps the conversation to the top
// of the list. The chip says a coach speaks here; the dot says it has said
// something new. Without the dot the row reorders for no visible reason.
{
  const attentionDb = createMemoryDatabase();
  const coach = createCoachAutomation(
    { name: "Debrief", playbook: "Debrief.", trigger: { kind: "manual" } },
    attentionDb
  );
  const attach = (sessionId, patch = {}) =>
    attachCoachAutomation(
      { automationId: coach.id, mode: "existing", sessionId, ...patch },
      attentionDb
    );
  const run = (sessionId, patch = {}) =>
    recordCoachAutomationRun(
      {
        automationId: coach.id,
        bindingId: "any",
        status: "success",
        triggerKind: "manual",
        sessionId,
        finishedAt: "2026-08-25T07:00:00.000Z",
        ...patch
      },
      attentionDb
    );
  const byId = () =>
    new Map(
      listCoachAutomationSessionAttention(attentionDb).map((row) => [
        row.sessionId,
        row
      ])
    );

  const live = attach("s-live");
  const off = attach("s-off");
  setCoachAutomationBindingEnabled(off.id, false, attentionDb);
  // A "per-run" binding has no conversation of its own to mark.
  attachCoachAutomation(
    { automationId: coach.id, mode: "per-run" },
    attentionDb
  );

  // Only conversations with something to say are listed at all: a row the
  // sidebar hears nothing about is a row with no marks on it.
  let marks = byId();
  assert.equal(marks.get("s-live").attached, true);
  assert.equal(marks.get("s-live").unread, 0, "attached is not the same as unread");
  assert.equal(
    marks.has("s-off"),
    false,
    "a binding switched off is not going to speak"
  );
  assert.equal(marks.size, 1, "and a per-run binding has no conversation of its own");

  // Only the two statuses that write to the transcript make a conversation
  // unread — those are the two that bumped it up the list.
  run("s-live");
  run("s-live", { status: "silent" });
  run("s-live", { status: "skipped", skipReason: "cooldown" });
  run("s-live", { status: "failed", error: "boom" });
  run("s-live", { status: "running", finishedAt: undefined });
  marks = byId();
  assert.equal(
    marks.get("s-live").unread,
    2,
    "a skip, a failure and a run still going wrote nothing to read"
  );

  // A run into a conversation nothing is attached to any more is still unread:
  // the answer is sitting in it either way.
  run("s-history");
  marks = byId();
  assert.equal(marks.get("s-history").attached, false);
  assert.equal(marks.get("s-history").unread, 1);

  // A run whose conversation was deleted has nowhere to be unread.
  run(undefined);
  assert.equal(byId().size, 2, "a run with no conversation marks nothing");

  // Opening a conversation is what reading it means, and it is scoped.
  assert.equal(markCoachAutomationSessionSeen("s-live", attentionDb), 2);
  marks = byId();
  assert.equal(marks.get("s-live").unread, 0);
  assert.equal(
    marks.get("s-history").unread,
    1,
    "reading one conversation does not clear another"
  );
  assert.equal(
    markCoachAutomationSessionSeen("s-live", attentionDb),
    0,
    "reading it twice is a no-op"
  );
  assert.equal(
    marks.get("s-live").attached,
    true,
    "and the chip stays: the coach still writes here"
  );
  assert.equal(
    byId().has("s-history"),
    true,
    "an unread conversation stays listed even with nothing attached"
  );

  // The skip is still unstamped, so it never silently became "read".
  const skipped = attentionDb
    .listRuns({ sessionId: "s-live", statuses: ["skipped"] })
    .at(0);
  assert.equal(skipped.seen_at, null, "a skip the athlete never saw stays unseen");

  // Switching the definition off silences every conversation it wrote into.
  setCoachAutomationEnabled(coach.id, false, attentionDb);
  assert.equal(
    byId().has("s-live"),
    false,
    "a disabled automation speaks nowhere, and its read conversation drops out"
  );
}

// --- the marks reach the conversation list ---------------------------------
// The projection above is only worth having if the sidebar asks for it, clears
// it, and keeps asking.
//
// What is left here is source that is *about* source: a contract between two
// files, or a shape TypeScript cannot see. Everything below that was really a
// claim about behaviour has moved to `test:coach-automation-renderer`, which
// mounts these components and drives them — the run-now picker's threshold, the
// popover reporting an attach, the conversation list re-reading on a run
// update, the marks following a run into a conversation nobody is looking at,
// and the live bubble re-establishing on a conversation opened mid-run. Each of
// those passed here as a regex; a regex could not say the code ran.
{
  const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

  const row = read("src", "chat", "ChatSessionRow.tsx");
  assert.match(
    row,
    /className="chat-session-row-automation-mark"/,
    "the row must carry the automation chip"
  );
  assert.match(
    row,
    /className="chat-session-row-unread"/,
    "the row must carry the unread dot"
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
  // Stop ends the trigger, not the run it was pressed on (10). All three
  // surfaces reach that through one IPC handler, so the wire that can silently
  // rot is the handler's own: `cancelChat` still compiles, still aborts the
  // stream the athlete was looking at, and leaves the rest of the fan-out to
  // run — the exact bug this replaced.
  const mainSource = read("electron", "main.ts");
  assert.match(
    mainSource,
    /"coachAutomation:cancelRun",\s*\(_event, runId: string\) => \{\s*cancelAutomationRun\(runId\);/,
    "Stop must cancel the trigger, not just the run's stream"
  );
  for (const surface of [
    "CoachAutomationsPanel.tsx",
    "CoachAutomationDetail.tsx",
    "ConversationCoaches.tsx"
  ]) {
    const source = read("src", "chat", "automations", surface);
    assert.match(
      source,
      /await api\.cancelCoachAutomationRun\(runId\)/,
      `${surface} must route Stop through the automation handler, not chat's own cancel`
    );
    // And say so: a button that ends a five-conversation fan-out must not still
    // promise to stop one run.
    assert.doesNotMatch(
      source,
      /"Stop this run"/,
      `${surface} must not still promise to stop only this run`
    );
  }

  // The ⚡ mark is derived from the bindings, so attaching or detaching moves
  // it. The header popover is the entry point most athletes use and the only
  // one with no way to report a change, so the mark stayed put until restart.
  assert.match(
    view,
    /onChanged=\{\(\) => setAutomationsVersion\(\(value\) => value \+ 1\)\}\n\s*onManageAutomations=/,
    "the header popover must be able to say it changed which coaches are attached"
  );
  const popover = read("src", "chat", "automations", "ConversationCoaches.tsx");
  // Both of its ways of changing a binding: the shared mutation wrapper — the
  // switch, the reorder, the detach — and the attach dialog it opens.
  assert.match(
    popover,
    /await work\(\);\n\s*await refresh\(\);\n\s*onChanged\?\.\(\);/,
    "switching, reordering or detaching a coach must say so"
  );
  // --- 3.4: which places a manual run reaches ------------------------------
  // From a conversation it is always that one place, whichever surface asked.
  assert.match(
    popover,
    /runCoachAutomationNow\(binding\.automationId, \[binding\.id\]\)/,
    "running from a conversation must run only in that conversation"
  );
  assert.match(
    read("src", "chat", "automations", "CoachAutomationDetail.tsx"),
    /runCoachAutomationNow\(automationId, \[bindingId\]\)/,
    "and so must running from one row of the coach's own list"
  );

  const runPanel = read("src", "chat", "automations", "CoachAutomationsPanel.tsx");

  // --- the run log is a way back into the conversation ----------------------
  const detailScreen = read("src", "chat", "automations", "CoachAutomationDetail.tsx");
  assert.match(
    detailScreen,
    /onClick=\{\(\) => onOpenConversation\?\.\(opensInto\)\}/,
    "a run log row must open the conversation the run wrote into"
  );
  // A `per-run` conversation can be newer than anything this window has heard
  // of, and one from an old run may have been deleted since. Selecting a
  // session id no row exists for leaves the sidebar with nothing selected and
  // the composer writing into a conversation that is not there.
  assert.match(
    view,
    /const listed = await refreshSessions\(chatSettings\.provider\);\n\s*if \(!listed\.some\(\(session\) => session\.id === sessionId\)\)/,
    "and the conversation has to still exist before it is opened"
  );

  // --- what "a run is in flight here" is read from -------------------------
  // Derived, not accumulated. A `per-run` binding attached to this conversation
  // runs into one of its own, so a subscription filtered on this session's id
  // threw away every update about the rows on screen — and switching away and
  // back left the map holding runs that had finished meanwhile.
  assert.match(
    popover,
    /listCoachAutomationRuns\(\{ statuses: \["running"\] \}\)[\s\S]{0,300}?setInFlightRuns\(\s*Object\.fromEntries\(running\.map/,
    "the popover must re-read which runs are in flight, and use the answer"
  );
  assert.doesNotMatch(
    popover,
    /run\.sessionId !== sessionId/,
    "and must not throw away the updates that tell it to"
  );
  // A trigger fans out to one run per place and they are serialised, so between
  // two of them no run is `running`. The card's optimistic flag has to outlast
  // that gap or it offers "Run now" in the middle of its own fan-out — which is
  // why it is set once and cleared once, when the whole fan-out has answered.
  assert.equal(
    (runPanel.match(/setStartingId\(/g) ?? []).length,
    2,
    "the card's run flag is set on the click and cleared on the outcome, nowhere else"
  );

  // Genuinely about source, and staying: this is a contract between two files
  // that never run in the same process, and an argument dropped on either side
  // still type-checks and still compiles into a call that does the wrong thing.
  // No renderer harness can see across that bridge, because the harness *is*
  // the stub standing in for it.
  assert.match(
    read("electron", "preload.ts"),
    /invoke\("coachAutomation:markSessionSeen", sessionId\)/,
    "preload must forward the session id across the bridge"
  );
  assert.match(
    read("electron", "main.ts"),
    /markCoachAutomationSessionSeen\(sessionId\)/,
    "the ipcMain handler must forward the session id"
  );

  // 2.1: the store refuses a `dedicated` binding with no conversation, and it
  // is right to — it has no business creating chat sessions. Somebody still has
  // to, and that is the attach screen. Until the presets started recommending
  // this mode the button had never worked: it attached with no session id and
  // failed with BINDING_SESSION_REQUIRED every time.
  const attachScreen = read("src", "chat", "automations", "AttachAutomationScreen.tsx");
  assert.match(
    attachScreen,
    /api\.createChatSession\(provider\)/,
    "attaching a dedicated binding must create its conversation"
  );
  assert.match(
    attachScreen,
    /api\.renameChatSession\(created\.id, automationName\)/,
    "and name it, or its first run titles it after its own playbook (2.5)"
  );
  assert.match(
    attachScreen,
    /mode: "dedicated",\s*sessionId: created\.id/,
    "and hand that conversation to the store"
  );
  assert.doesNotMatch(
    attachScreen,
    /attachMode\("dedicated"\)/,
    "the session-less dedicated attach is the bug, not a fallback"
  );

  // A preset was written around one binding mode, and the attach screen says
  // which — advisory only, since all three modes stay on offer.
  const detail = read("src", "chat", "automations", "CoachAutomationDetail.tsx");
  assert.match(
    detail,
    /suggestedMode=\{suggestedBinding\?\.mode\}/,
    "the preset's recommended binding mode must reach the attach screen"
  );
  assert.match(
    attachScreen,
    /data-suggested=\{suggestedMode === "dedicated" \? "true" : undefined\}/,
    "and be marked on the mode it recommends"
  );

  // Section 10: an expired provider sign-in shows up as a no-auth skip and
  // nothing else. For the providers guard rail 3 cannot pre-flight, this banner
  // is the athlete's only indication.
  const panel = read("src", "chat", "automations", "CoachAutomationsPanel.tsx");
  assert.match(
    panel,
    /skipReason === "no-auth"/,
    "the panel must recognise a signed-out provider"
  );
  assert.match(
    panel,
    /className="coach-automation-banner"/,
    "and say so in a banner"
  );
}

// --- section 10's pause is one row, and it survives a restart -------------
// One flag for the whole feature rather than a column per binding: the cause is
// one thing the athlete fixes once, so five copies could only ever disagree.
{
  assert.equal(getCoachAutomationPause(db), null, "nothing is paused to begin with");

  const held = {
    reason: "two-factor-required",
    since: "2026-08-25T07:30:00.000Z",
    runId: "run-42"
  };
  setCoachAutomationPause(held, db);
  assert.deepEqual(
    getCoachAutomationPause(db),
    held,
    "and it reads back whole — a restart must not resume a paused world"
  );

  setCoachAutomationPause(null, db);
  assert.equal(getCoachAutomationPause(db), null, "resume clears the row entirely");

  // The optional half is optional.
  setCoachAutomationPause(
    { reason: "two-factor-required", since: "2026-08-25T07:30:00.000Z" },
    db
  );
  assert.equal(getCoachAutomationPause(db).runId, undefined);

  // A half-written or hand-edited row reads as "not paused". Trusting a shape
  // nobody checked would hold every automation forever on the strength of a
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
      getCoachAutomationPause(db),
      null,
      `a malformed pause row must not hold anything: ${broken}`
    );
  }
  db.writePause(null);
}

// --- 12 (item 6): the monthly ceiling ------------------------------------
{
  assert.equal(getCoachAutomationBudget(db), null, "no ceiling by default");

  assert.equal(setCoachAutomationBudget(500_000, db), 500_000);
  assert.equal(getCoachAutomationBudget(db), 500_000, "and it survives a restart");

  // Whole tokens: the number is compared against a SUM of integers, and a
  // fractional ceiling would be a ceiling nothing can land exactly on.
  assert.equal(setCoachAutomationBudget(1234.7, db), 1234);

  // Everything that is not a positive number means "no ceiling", which is the
  // default. A budget of zero read as a stop would pause every automation the
  // moment somebody cleared the field.
  for (const value of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      setCoachAutomationBudget(value, db),
      null,
      `${String(value)} must read as no ceiling, not as a stop`
    );
    assert.equal(getCoachAutomationBudget(db), null);
  }

  // A hand-edited row follows the same rule rather than being trusted.
  for (const raw of ["", "   ", "not a number", "-5", "0"]) {
    db.writeBudget(raw);
    assert.equal(getCoachAutomationBudget(db), null, `a "${raw}" row is no ceiling`);
  }
  db.writeBudget(null);
}

// --- R4 step 8: what the startup reconciliation must not touch -------------
// The app quitting mid-run leaves a `running` row, and `cancelStaleCoachAutomationRuns`
// turns it into `cancelled` (10). It touches the run log and *nothing else*,
// and that is load-bearing rather than incidental: a `cancelled` run that goes
// through the runner's own `finish` **clears** the binding's backoff streak, so
// routing this through the same exit — the obvious tidy-up somebody will
// eventually propose — would mean a crash resets the hold on every binding that
// was failing. The app closing is not a provider reporting itself healthy, any
// more than the athlete pressing Stop is (10).
//
// The same goes for the other two clocks. A crash must leave the activity owed
// and the cooldown where it was, because nothing about the run reached a
// conclusion.
{
  const crashed = createCoachAutomation(
    { name: "Crashed", playbook: "p", trigger: { kind: "activity", sportTypes: [] } },
    db
  );
  const held = attachCoachAutomation(
    { automationId: crashed.id, mode: "per-run" },
    db
  );
  setCoachAutomationBindingSchedule(
    held.id,
    {
      backoffLevel: 3,
      backoffUntil: "2026-08-21T10:00:00.000Z",
      lastActivityAt: 1_756_000_000,
      lastRunAt: "2026-08-21T08:00:00.000Z"
    },
    db
  );
  recordCoachAutomationRun(
    {
      automationId: crashed.id,
      bindingId: held.id,
      status: "running",
      triggerKind: "activity"
    },
    db
  );

  assert.equal(
    cancelStaleCoachAutomationRuns(db),
    1,
    "fixture sanity: exactly one row was left open"
  );
  const after = getCoachAutomationBinding(held.id, db);
  assert.equal(after.backoffLevel, 3, "a crash does not clear the streak");
  assert.equal(after.backoffUntil, "2026-08-21T10:00:00.000Z");
  assert.equal(
    after.lastActivityAt,
    1_756_000_000,
    "nor advance the watermark, so the activity is still owed"
  );
  assert.equal(after.lastRunAt, "2026-08-21T08:00:00.000Z", "nor the cooldown clock");
}

console.log("coach automation binding tests passed");
