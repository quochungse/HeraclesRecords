// Opening a database written by the Automation build.
//
// The predecessor's tables are dropped rather than migrated, and that is a
// decision worth a suite of its own: it deletes rows, it runs once per
// machine, and no other suite can see it — every one of them injects a
// hand-written database, and this file's own fixtures would otherwise be
// created *after* the drop had already run.
//
// Its own process, too. `initializeDatabase` returns the process's existing
// database and does nothing if there already is one, so a test that shares a
// process with any other database test is silently testing nothing: the
// second call hands back the first file and every assertion passes against
// rows the drop never saw.
//
// Under Electron for the usual reason: better-sqlite3 is built for Electron's
// ABI and will not dlopen under plain node.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-legacy-drop-"));
const dbPath = path.join(tempRoot, "coroslink.sqlite");

const CONVERSATION_ID = "sess-kept";
const TRANSCRIPT = JSON.stringify([
  { kind: "message", role: "user", content: "How was last week?" },
  {
    kind: "message",
    role: "assistant",
    content: "Solid week. Nothing to change.",
    // Written by an automation run. The analysis it names is about to be
    // dropped; the entry, and its attribution, must not be.
    automation: {
      runId: "run-1",
      automationId: "legacy-1",
      bindingId: "bind-1",
      name: "Morning briefing",
      triggerLabel: "Daily at 07:00"
    }
  }
]);

// --- what the pre-refactor build left on disk ------------------------------
// Written out in full rather than derived from today's schema: the point is to
// be the *old* shape.
{
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      title TEXT,
      messages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE coach_automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      playbook TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      preset_id TEXT,
      trigger_json TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      runtime_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE coach_automation_bindings (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      session_id TEXT,
      title_template TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_binding_unique_session
      ON coach_automation_bindings (automation_id, session_id)
      WHERE session_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_binding_unique_per_run
      ON coach_automation_bindings (automation_id)
      WHERE session_id IS NULL;

    CREATE TABLE coach_automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      trigger_payload_json TEXT,
      session_id TEXT,
      summary TEXT,
      model TEXT,
      effort TEXT,
      error TEXT,
      skip_reason TEXT,
      seen_at TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE coach_automation_local_triggers (
      binding_id TEXT PRIMARY KEY,
      trigger_json TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  legacy
    .prepare(
      `INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      CONVERSATION_ID,
      "claude-code",
      "Weekly check-in",
      TRANSCRIPT,
      "2026-08-01T00:00:00.000Z",
      "2026-08-20T07:00:04.000Z"
    );
  legacy
    .prepare(
      `INSERT INTO coach_automations
         (id, name, role, playbook, enabled, preset_id, trigger_json,
          conditions_json, runtime_json, created_at, updated_at)
       VALUES ('legacy-1', 'Morning briefing', NULL, 'Say something.', 1, NULL,
               '{"kind":"schedule","cadence":"daily","timeOfDay":"07:00"}',
               '{"cooldownMin":90,"maxRunsPerDay":2}', NULL,
               '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
    )
    .run();
  legacy
    .prepare(
      `INSERT INTO coach_automation_bindings
         (id, automation_id, mode, session_id, title_template, enabled,
          sort_order, last_run_at, next_run_at, created_at)
       VALUES ('bind-1', 'legacy-1', 'existing', ?, NULL, 1, 0, NULL, NULL,
               '2026-08-01T00:00:00.000Z')`
    )
    .run(CONVERSATION_ID);
  legacy
    .prepare(
      `INSERT INTO coach_automation_runs
         (id, automation_id, binding_id, status, trigger_kind, session_id,
          summary, started_at)
       VALUES ('run-1', 'legacy-1', 'bind-1', 'success', 'schedule', ?,
               'Solid week.', '2026-08-20T07:00:00.000Z')`
    )
    .run(CONVERSATION_ID);
  legacy
    .prepare(
      `INSERT INTO coach_automation_local_triggers
         (binding_id, trigger_json, conditions_json, updated_at)
       VALUES ('bind-1', '{"kind":"manual"}', '{}', '2026-08-01T00:00:00.000Z')`
    )
    .run();
  legacy.close();
}

// --- and what opening it as the app does makes of it ------------------------
const database = await import(distUrl("database.js"));
database.initializeDatabase(tempRoot);
const db = database.requireDatabase();

const tables = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
);

for (const gone of [
  "coach_automations",
  "coach_automation_bindings",
  "coach_automation_runs",
  "coach_automation_local_triggers"
]) {
  assert.equal(tables.has(gone), false, `${gone} must be dropped, not kept`);
}

for (const made of [
  "coach_analyses",
  "coach_analysis_local_triggers",
  "coach_analysis_runs"
]) {
  assert.equal(tables.has(made), true, `${made} must exist`);
}

// The new tables start empty. Nothing is carried across: an automation could
// be attached to several conversations or to none, and an analysis is one
// thing in one conversation — there is no honest mapping between them, and
// guessing produces coaching that speaks without being asked.
const store = await import(distUrl("coachAnalysisStore.js"));
assert.deepEqual(
  store.listCoachAnalysesForSession(CONVERSATION_ID),
  [],
  "nothing is migrated into the new shape"
);
assert.equal(
  db.prepare("SELECT COUNT(*) AS n FROM coach_analyses").get().n,
  0
);
assert.equal(
  db.prepare("SELECT COUNT(*) AS n FROM coach_analysis_runs").get().n,
  0,
  "the old run log goes with the machinery it described"
);

// **What the athlete would actually miss is untouched.** Their conversation is
// a `chat_sessions` row, and every answer an automation wrote into it is a
// transcript entry — including its attribution chip, which reads off keys the
// marker still spells the old way on purpose.
const session = db
  .prepare("SELECT title, messages_json FROM chat_sessions WHERE id = ?")
  .get(CONVERSATION_ID);
assert.ok(session, "the conversation survives");
assert.equal(session.title, "Weekly check-in");
const entries = JSON.parse(session.messages_json);
assert.equal(entries.length, 2);
assert.equal(entries[1].content, "Solid week. Nothing to change.");
assert.equal(
  entries[1].automation.name,
  "Morning briefing",
  "and so does the chip naming what wrote it"
);

// The indexes the old tables carried go too, so a later CREATE INDEX on a
// table of the same name cannot collide with one nothing owns.
const indexes = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => row.name)
);
for (const gone of [
  "idx_binding_unique_session",
  "idx_binding_unique_per_run",
  "idx_automation_runs_automation"
]) {
  assert.equal(indexes.has(gone), false, `${gone} must be dropped`);
}
assert.equal(indexes.has("idx_coach_analyses_session"), true);

// An analysis written after the upgrade behaves normally — the point of
// checking is that the drop left the new tables usable, not merely present.
const created = store.createCoachAnalysis({
  sessionId: CONVERSATION_ID,
  name: "Fresh start",
  playbook: "Look at the week.",
  trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:00" }
});
assert.equal(created.sessionId, CONVERSATION_ID);
assert.deepEqual(created.trigger, {
  kind: "schedule",
  cadence: "daily",
  timeOfDay: "07:00"
});
assert.equal(
  store.listCoachAnalysesForSession(CONVERSATION_ID).length,
  1
);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("legacy automation drop tests passed");
