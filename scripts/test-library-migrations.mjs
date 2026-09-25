// Opening a database written before the "collection" grouping and the local
// plan store were removed.
//
// COROS serves four training endpoints — program, plan, schedule and exercise —
// and not one of them knows about a collection. It was invented upstream, and
// in this fork it was write-only: two bulk bars set `collection_id` and the one
// place that read it was a count, on a tab that only counted templates. There
// is nothing to migrate, because there was never anywhere for the grouping to
// go, so the table and the column are dropped outright.
//
// The local plan store is the other removal (docs/training-plan-coros-first.md
// §8): a plan is a COROS plan now. `training_plans` held two kinds of row — a
// cache of a COROS plan, whose one irreplaceable part is what the athlete set
// here (favourite, tags, archived), and a local or coach plan, which is
// dropped by decision. Nothing may reach COROS while this happens: the
// sessions such a plan once put on the calendar are ordinary COROS workouts
// and must stay exactly where they are.
//
// Changing rows on open is a decision worth a suite of its own, and every one
// of these has to prove two halves:
//
// - the old shape is gone, and
// - **everything beside it survived**. `collection_id` sat in the middle of
//   `training_workout_metadata`, so dropping it rewrites the table — and the
//   favourites, the tags and the cached payload on either side of it are the
//   athlete's own and cannot be rebuilt from COROS. A plan is stored twice, in
//   a column and in its document, so a fold that reaches only one leaves the
//   renderer reading the old value. That is the half a migration gets wrong
//   quietly.
//
// Its own process, for the reason `test-analysis-legacy-drop.mjs` gives:
// `initializeDatabase` returns the process's existing database and does nothing
// if there already is one, so a drop test sharing a process with another
// database test is silently testing nothing — the second call hands back the
// first file and every assertion passes against rows the drop never saw.
//
// Under Electron because better-sqlite3 is built for Electron's ABI.
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

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-library-migrations-"));
const dbPath = path.join(tempRoot, "coroslink.sqlite");

const PLAN_ID = "plan-local";
const TEMPLATE_ID = "plan-template";
const COROS_ID = "coros:remote-7";
const QUIET_COROS_ID = "coros:remote-8";

/**
 * A template, in the shape the old build wrote: `source: "template"` in both
 * the column and the document, and no start date — which is what made it
 * reusable, and is now the whole of the distinction.
 */
const TEMPLATE_DOCUMENT = JSON.stringify({
  id: TEMPLATE_ID,
  name: "Down week",
  description: "",
  goal: "",
  difficulty: "custom",
  notes: "Keep it easy.",
  source: "template",
  sportMix: ["run"],
  weekCount: 1,
  phases: [],
  entries: [
    { id: "t1", kind: "workout", weekIndex: 0, dayIndex: 1, sortOrder: 0, title: "Easy 30" },
    { id: "t2", kind: "rest", weekIndex: 0, dayIndex: 2, sortOrder: 0, title: "Rest day" }
  ],
  tags: ["taper"],
  favorite: true,
  archived: false,
  syncState: "local",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z"
});
const PLAN_DOCUMENT = JSON.stringify({
  id: PLAN_ID,
  name: "Autumn Base",
  description: "",
  goal: "Build a base",
  difficulty: "intermediate",
  notes: "",
  source: "local",
  sportMix: ["run"],
  weekCount: 9,
  phases: [],
  entries: [{ id: "e1", kind: "workout", weekIndex: 0, dayIndex: 0, sortOrder: 0, title: "Easy 45" }],
  tags: ["base", "autumn"],
  // The plan document carried the grouping inside its JSON rather than in a
  // column. A reader that still parsed it would resurrect the concept.
  collectionId: "coll-1",
  favorite: true,
  archived: false,
  syncState: "local",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
});

/** A COROS plan's cached row, carrying settings the athlete made here. */
const corosDocument = (id, extra) => JSON.stringify({
  id,
  remoteId: id.slice("coros:".length),
  name: "COROS plan",
  description: "",
  goal: "",
  source: "coros",
  sportMix: ["run"],
  weekCount: 4,
  phases: [],
  entries: [],
  tags: [],
  favorite: false,
  archived: false,
  syncState: "synced",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra
});

// --- what the pre-removal build left on disk -------------------------------
// Written out in full rather than derived from today's schema: the point is to
// be the *old* shape, with the column in the middle where it used to sit.
{
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE training_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE training_workout_metadata (
      program_id TEXT PRIMARY KEY,
      favorite INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      collection_id TEXT,
      source TEXT NOT NULL DEFAULT 'coros',
      sync_state TEXT NOT NULL DEFAULT 'synced',
      last_used_at TEXT,
      last_synced_at TEXT,
      cached_version TEXT,
      cached_payload_json TEXT
    );

    CREATE TABLE training_plans (
      id TEXT PRIMARY KEY,
      remote_id TEXT UNIQUE,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      document_json TEXT NOT NULL,
      raw_remote_json TEXT,
      remote_version INTEGER,
      remote_updated_at INTEGER,
      sync_state TEXT NOT NULL DEFAULT 'local',
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE training_plan_workout_links (
      plan_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      program_id TEXT,
      happen_day TEXT,
      remote_plan_program_id TEXT,
      PRIMARY KEY (plan_id, entry_id)
    );
  `);

  legacy
    .prepare(
      `INSERT INTO training_collections (id, name, description, color, created_at, updated_at)
       VALUES ('coll-1', 'Marathon block', 'Autumn', '#ff0000',
               '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
    )
    .run();

  legacy
    .prepare(
      `INSERT INTO training_workout_metadata
         (program_id, favorite, tags_json, collection_id, source, sync_state,
          last_used_at, last_synced_at, cached_version, cached_payload_json)
       VALUES (?, 1, ?, 'coll-1', 'coros', 'synced', ?, ?, 'v3', ?)`
    )
    .run(
      "program-1",
      JSON.stringify(["tempo", "threshold"]),
      "2026-09-09T06:00:00.000Z",
      "2026-09-10T00:00:00.000Z",
      JSON.stringify({ id: "program-1", name: "Threshold 4 x 8", trainingLoad: 74 })
    );

  legacy
    .prepare(
      `INSERT INTO training_plans
         (id, remote_id, source, name, document_json, sync_state, created_at, updated_at)
       VALUES (?, NULL, 'local', 'Autumn Base', ?, 'local',
               '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`
    )
    .run(PLAN_ID, PLAN_DOCUMENT);

  legacy
    .prepare(
      `INSERT INTO training_plans
         (id, remote_id, source, name, document_json, sync_state, created_at, updated_at)
       VALUES (?, NULL, 'template', 'Down week', ?, 'local',
               '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z')`
    )
    .run(TEMPLATE_ID, TEMPLATE_DOCUMENT);

  const insertCoros = legacy.prepare(
    `INSERT INTO training_plans
       (id, remote_id, source, name, document_json, sync_state, created_at, updated_at)
     VALUES (?, ?, 'coros', 'COROS plan', ?, 'synced',
             '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`
  );
  insertCoros.run(COROS_ID, "remote-7", corosDocument(COROS_ID, { favorite: true, tags: ["race"], archived: true }));
  insertCoros.run(QUIET_COROS_ID, "remote-8", corosDocument(QUIET_COROS_ID, {}));

  legacy
    .prepare(
      `INSERT INTO training_plan_workout_links (plan_id, entry_id, program_id, happen_day)
       VALUES (?, 'e1', 'installed-program', '20260915')`
    )
    .run(PLAN_ID);

  legacy.close();
}

// --- and what opening it as the app does makes of it ------------------------
// Nothing about retiring plans may ask COROS anything.
const requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  throw new Error(`the migration must not reach the network: ${url}`);
};
const database = await import(distUrl("database.js"));
database.initializeDatabase(tempRoot);
const db = database.requireDatabase();

// 1. The table is gone
{
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  assert.equal(
    tables.has("training_collections"),
    false,
    "training_collections must be dropped, not left behind for a future reader to puzzle over"
  );
  assert.ok(tables.has("training_workout_metadata"), "its neighbour is untouched");
}

// 2. The column is gone
{
  const columns = db
    .prepare("PRAGMA table_info(training_workout_metadata)")
    .all()
    .map((row) => row.name);
  assert.equal(
    columns.includes("collection_id"),
    false,
    "the column goes with the table — upsertRow drops columns this build does not " +
      "have, so a machine still on the old build can publish one without aborting the merge"
  );
  for (const kept of [
    "program_id",
    "favorite",
    "tags_json",
    "source",
    "sync_state",
    "last_used_at",
    "last_synced_at",
    "cached_version",
    "cached_payload_json"
  ]) {
    assert.ok(columns.includes(kept), `${kept} must survive the column drop`);
  }
}

// 3. Everything beside it survived, which is the half a migration loses quietly
{
  const metadata = database.listTrainingWorkoutMetadata();
  assert.equal(metadata.length, 1, "the row itself is not deleted with the column");
  const row = metadata[0];
  assert.equal(row.programId, "program-1");
  assert.equal(row.favorite, true, "a favourite cannot be rebuilt from COROS");
  assert.deepEqual(row.tags, ["tempo", "threshold"], "nor can a tag");
  assert.equal(row.source, "coros");
  assert.equal(row.syncState, "synced");
  assert.equal(row.lastUsedAt, "2026-09-09T06:00:00.000Z");
  assert.equal(row.cachedVersion, "v3");
  assert.equal(
    row.collectionId,
    undefined,
    "and the concept must not come back out of the row"
  );

  // The cached payload is the reason the drop is a table rewrite rather than a
  // no-op, so it is worth reading back rather than trusting the column list.
  const cached = database.listCachedTrainingLibraryWorkouts();
  assert.equal(cached.length, 1, "the cached COROS payload rides in the same row");
  assert.equal(cached[0].name, "Threshold 4 x 8");
}

// 4. The local plan store is gone, both tables of it
{
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  assert.equal(tables.has("training_plans"), false, "local plans are retired with their table");
  assert.equal(tables.has("training_plan_workout_links"), false, "and so are the links a local install wrote");
  assert.ok(tables.has("training_plan_metadata"), "what replaces them is there");
  assert.ok(tables.has("training_plan_drafts"));
  assert.deepEqual(requested, [], "and nothing was asked of COROS: calendar sessions stay where they are");
}

// 5. A COROS plan's own settings survive; nothing of a local plan does
{
  const metadata = database.listTrainingPlanMetadata();
  assert.deepEqual(
    metadata.map((row) => row.planId),
    [COROS_ID],
    "only a COROS plan the athlete marked has anything to keep; local and template rows leave nothing"
  );
  const kept = metadata[0];
  assert.equal(kept.favorite, true, "a favourite cannot be rebuilt from COROS");
  assert.deepEqual(kept.tags, ["race"], "nor can a tag");
  assert.equal(kept.archived, true, "nor archived");
  assert.equal(database.listTrainingPlanDrafts().length, 0, "a local plan is not turned into a draft");
}

// 6. Opening twice is safe — the migration runs on every launch
{
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  assert.equal(tables.has("training_collections"), false);
}

db.close();
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("library migration tests passed — collections dropped, local plans retired");
