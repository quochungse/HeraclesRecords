// Opening a database written by the build that had a Maps screen.
//
// `generated_routes` and `cached_coros_maps` are dropped rather than migrated,
// and like the analyses drop beside it that is a decision worth its own suite:
// it deletes rows, it runs once per machine, and no other suite can see it —
// every one of them injects a hand-written database, and this file's fixtures
// would otherwise be created *after* the drop had already run.
//
// Its own process, too. `initializeDatabase` returns the process's existing
// database and does nothing if there already is one, so a test sharing a
// process with any other database test is silently testing nothing: the second
// call hands back the first file and every assertion passes against rows the
// drop never saw.
//
// Under Electron for the usual reason: better-sqlite3 is built for Electron's
// ABI and will not dlopen under plain node.
//
// Run: npm run test:map-legacy-drop
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

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-map-drop-"));
const dbPath = path.join(tempRoot, "coroslink.sqlite");

// --- what the Maps build left on disk --------------------------------------
// Written out in full rather than derived from today's schema: the point is to
// be the *old* shape.
{
  const old = new Database(dbPath);
  old.exec(`
    CREATE TABLE generated_routes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
      start_location TEXT NOT NULL, destination_location TEXT,
      distance_meters INTEGER NOT NULL, duration_seconds REAL,
      ascent_meters REAL, descent_meters REAL, mode TEXT NOT NULL,
      surface_preference TEXT NOT NULL, avoid_highways INTEGER NOT NULL,
      elevation_preference TEXT NOT NULL, points_json TEXT NOT NULL,
      bounds_json TEXT, gpx_path TEXT, activity_type TEXT
    );
    CREATE TABLE cached_coros_maps (
      package_id TEXT PRIMARY KEY, title TEXT NOT NULL, region TEXT NOT NULL,
      parent TEXT NOT NULL, type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      download_url TEXT NOT NULL, file_path TEXT NOT NULL UNIQUE,
      extracted_path TEXT, downloaded_at TEXT NOT NULL
    );
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, title TEXT NOT NULL,
      messages_json TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, pinned_at TEXT
    );
    INSERT INTO generated_routes VALUES
      ('r1','Morning loop','2026-01-01','Home',NULL,8000,NULL,NULL,NULL,
       'loop','road',0,'any','[]',NULL,NULL,'running');
    INSERT INTO cached_coros_maps VALUES
      ('p1','Vietnam','apac','asia','topo',1,'https://example.invalid/p1.zip',
       '/tmp/p1.zip',NULL,'2026-01-01');
    INSERT INTO chat_sessions VALUES
      ('s1','claude-code','Last week','[]','2026-01-01','2026-01-01',NULL);
  `);
  old.close();
}

const { initializeDatabase } = await import(distUrl("database.js"));
initializeDatabase(tempRoot);

const probe = new Database(dbPath, { readonly: true });
const hasTable = (name) =>
  Boolean(
    probe
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name)
  );

assert.equal(
  hasTable("generated_routes"),
  false,
  "generated_routes must be dropped — a drawn route belongs to a route builder this app no longer has"
);
assert.equal(
  hasTable("cached_coros_maps"),
  false,
  "cached_coros_maps must be dropped — its rows describe files the startup sweep deletes"
);

// The drop is next to a table that shares nothing with it, and the transcripts
// there are the one thing in the database with no other copy anywhere.
assert.equal(hasTable("chat_sessions"), true, "conversations are untouched");
assert.equal(
  probe.prepare("SELECT COUNT(*) AS n FROM chat_sessions").get().n,
  1,
  "the conversation and its transcript survive the drop"
);
probe.close();

// Best effort: Windows keeps the SQLite handle open past `close()`, so the
// removal fails there. Leaving a temp directory behind is not worth a failure.
try {
  fs.rmSync(tempRoot, { recursive: true, force: true });
} catch {
  /* the OS will clear it */
}

console.log("map legacy drop OK — both tables gone, conversations untouched");
