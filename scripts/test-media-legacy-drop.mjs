// Opening a database written by the build that had a Media screen.
//
// `downloads`, `spotify_sync_tracks` and `youtube_history` are dropped, and
// every `spotify.*`, `youtubeMusic.*` and `appleMusic.*` setting deleted — a
// client secret, OAuth tokens and captured Apple Music headers among them. Like
// the maps drop it deletes rows, runs once per machine and no other suite can
// see it, so it gets its own; and its own process, because `initializeDatabase`
// returns the process's existing database (see test-map-legacy-drop.mjs).
//
// Under Electron for the usual reason: better-sqlite3 is built for Electron's
// ABI and will not dlopen under plain node.
//
// Run: npm run test:media-legacy-drop
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

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-media-drop-"));
const dbPath = path.join(tempRoot, "heraclesrecords.sqlite");

// --- what the Media build left on disk -------------------------------------
// Written out in full rather than derived from today's schema: the point is to
// be the *old* shape.
{
  const old = new Database(dbPath);
  old.exec(`
    CREATE TABLE downloads (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL, transferred_at TEXT
    );
    CREATE TABLE spotify_sync_tracks (
      playlist_id TEXT NOT NULL, spotify_track_id TEXT NOT NULL,
      artist_name TEXT NOT NULL, track_name TEXT NOT NULL, query TEXT NOT NULL,
      filename TEXT NOT NULL, status TEXT NOT NULL, local_download_id TEXT,
      file_path TEXT, error TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, spotify_track_id)
    );
    CREATE TABLE youtube_history (
      url TEXT PRIMARY KEY, title TEXT NOT NULL, entry_type TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0, last_visited_at TEXT NOT NULL,
      downloaded_at TEXT
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, title TEXT NOT NULL,
      messages_json TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, pinned_at TEXT
    );
    INSERT INTO downloads VALUES
      ('d1','https://example.invalid/v','A track','/tmp/a.mp3',1,'2026-01-01',NULL);
    INSERT INTO spotify_sync_tracks VALUES
      ('pl1','t1','Artist','Song','Artist Song','Artist - Song.mp3','completed',
       'd1','/tmp/a.mp3',NULL,'2026-01-01');
    INSERT INTO youtube_history VALUES
      ('https://example.invalid/v','A video','video',1,'2026-01-01',NULL);
    INSERT INTO app_settings VALUES
      ('spotify.clientSecret','enc:v1:c2VjcmV0'),
      ('spotify.refreshToken','refresh'),
      ('youtubeMusic.libraryJson','{}'),
      ('appleMusic.credentialsJson','enc:v1:aGVhZGVycw=='),
      ('chat.provider','claude-code'),
      ('hevy.apiKey','k');
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

for (const table of ["downloads", "spotify_sync_tracks", "youtube_history"]) {
  assert.equal(hasTable(table), false, `${table} must be dropped`);
}

const keys = probe
  .prepare("SELECT key FROM app_settings ORDER BY key")
  .all()
  .map((row) => row.key);
assert.deepEqual(
  keys,
  ["chat.provider", "hevy.apiKey"],
  "every media setting is deleted, a credential included, and nothing else is"
);

// The drop sits next to the transcripts, the one thing in the database with
// no other copy anywhere.
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

console.log("media legacy drop OK — three tables and the media settings gone, the rest untouched");
