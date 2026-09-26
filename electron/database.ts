import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { enrichActivitiesWithSportNames } from "./corosSportTypes";
import { musicFileNamesMatch } from "./musicFileNames";
import Database from "better-sqlite3";
import {
  notifyRowChanged,
  notifyRowDeleted,
  notifySettingChanged,
  notifySettingsDeleted
} from "./sync/syncBridge";
import { RECORD_ID_SEPARATOR } from "./sync/syncPolicy";
import type {
  ActivityDetailSummary,
  CoachAnalysisRunQuery,
  LocalTrack,
  SpotifySyncTrack,
  SpotifySyncTrackStatus,
  StrengthDetail,
  StrengthSession,
  TrainingActivityMatch,
  TrainingHubActivity,
  TrainingHubLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanDraftRecord,
  TrainingPlanMetadata,
  TrainingWorkoutMetadata,
  YouTubeHistoryEntry,
  YouTubeHistoryEntryType
} from "./types";

interface DownloadRow {
  id: string;
  url: string;
  title: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  transferred_at: string | null;
}

interface SettingRow {
  key: string;
  value: string;
}

interface SpotifySyncTrackRow {
  playlist_id: string;
  spotify_track_id: string;
  artist_name: string;
  track_name: string;
  query: string;
  filename: string;
  status: SpotifySyncTrackStatus;
  local_download_id: string | null;
  file_path: string | null;
  error: string | null;
  updated_at: string;
}

interface YouTubeHistoryRow {
  url: string;
  title: string;
  entry_type: YouTubeHistoryEntryType;
  visits: number;
  last_visited_at: string;
  downloaded_at: string | null;
}

interface TrainingActivityRow {
  activity_id: string;
  name: string | null;
  sport_type: number;
  sport_name: string | null;
  start_time: number | null;
  end_time: number | null;
  duration: number | null;
  distance: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  training_load: number | null;
  elevation_gain: number | null;
}

let db: Database.Database | undefined;

function migrateLegacyDatabase(userDataPath: string, dbPath: string): void {
  if (fs.existsSync(dbPath)) {
    return;
  }

  const legacyPath = path.join(userDataPath, "coros-desktop.sqlite");
  if (!fs.existsSync(legacyPath)) {
    return;
  }

  fs.renameSync(legacyPath, dbPath);

  for (const suffix of ["-wal", "-shm"]) {
    const legacySidecar = `${legacyPath}${suffix}`;
    const nextSidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(legacySidecar)) {
      fs.renameSync(legacySidecar, nextSidecar);
    }
  }
}

export function initializeDatabase(userDataPath: string): Database.Database {
  if (db) {
    return db;
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, "coroslink.sqlite");
  migrateLegacyDatabase(userDataPath, dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      transferred_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spotify_sync_tracks (
      playlist_id TEXT NOT NULL,
      spotify_track_id TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      track_name TEXT NOT NULL,
      query TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL,
      local_download_id TEXT,
      file_path TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, spotify_track_id)
    );

    CREATE TABLE IF NOT EXISTS youtube_history (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      last_visited_at TEXT NOT NULL,
      downloaded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS training_activities (
      activity_id TEXT PRIMARY KEY,
      name TEXT,
      sport_type INTEGER NOT NULL,
      sport_name TEXT,
      start_time INTEGER,
      end_time INTEGER,
      duration INTEGER,
      distance REAL,
      avg_hr INTEGER,
      max_hr INTEGER,
      calories INTEGER,
      training_load REAL,
      elevation_gain REAL,
      synced_at TEXT NOT NULL
    );

    -- What survives of an activity detail once its 2.5 MB payload is gone.
    -- The payload itself is a file (activityDetailCache.ts); this is the part
    -- small enough to sync and to read for a whole list at once. fingerprint
    -- ties the row to the activity as COROS last described it, so an edited
    -- run's figures are recomputed rather than shown from before the edit.
    CREATE TABLE IF NOT EXISTS training_activity_summaries (
      activity_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      summary_version INTEGER NOT NULL,
      zone_seconds TEXT,
      decoupling_percent REAL,
      last_upload_time INTEGER,
      computed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strength_sessions (
      activity_id TEXT PRIMARY KEY,
      sport_type INTEGER NOT NULL,
      detail_json TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hevy_workouts (
      workout_id TEXT PRIMARY KEY,
      start_time INTEGER NOT NULL,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hevy_workouts_start_time
      ON hevy_workouts(start_time);

    CREATE TABLE IF NOT EXISTS hevy_exercise_templates (
      template_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('chatgpt', 'claude-api', 'claude-code', 'openrouter', 'local')),
      title TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      pinned_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_provider_updated
      ON chat_sessions(provider, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_conversation_settings (
      session_id TEXT PRIMARY KEY,
      sources_json TEXT,
      runtime_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_schedule_changes (
      change_set_id TEXT PRIMARY KEY,
      session_id TEXT,
      summary TEXT NOT NULL,
      lines_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_plan_artifacts (
      artifact_id TEXT PRIMARY KEY,
      session_id TEXT,
      kind TEXT NOT NULL,
      start_monday TEXT,
      race_day TEXT,
      brief_json TEXT,
      outline_json TEXT,
      outline_version INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_plan_drafts (
      draft_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      uploaded_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_chat_plan_drafts_created
      ON chat_plan_drafts(created_at DESC);

    -- App-side facts about a COROS plan that COROS has no field for.
    CREATE TABLE IF NOT EXISTS training_plan_metadata (
      plan_id TEXT PRIMARY KEY,
      favorite INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      origin TEXT,
      coach_json TEXT,
      updated_at TEXT NOT NULL
    );

    -- A plan being edited, not yet saved to COROS.
    CREATE TABLE IF NOT EXISTS training_plan_drafts (
      id TEXT PRIMARY KEY,
      base_remote_id TEXT,
      base_version INTEGER,
      plan_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );

    -- The last COROS answer for each plan, so the library draws offline.
    CREATE TABLE IF NOT EXISTS coros_plan_cache (
      remote_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS training_workout_metadata (
      program_id TEXT PRIMARY KEY,
      favorite INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'coros',
      sync_state TEXT NOT NULL DEFAULT 'synced',
      last_used_at TEXT,
      last_synced_at TEXT,
      cached_version TEXT,
      cached_payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS training_activity_matches (
      id TEXT PRIMARY KEY,
      plan_id TEXT,
      plan_entry_id TEXT,
      schedule_plan_id TEXT NOT NULL,
      schedule_id_in_plan TEXT NOT NULL,
      activity_id TEXT,
      happen_day TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL,
      manual INTEGER NOT NULL DEFAULT 0,
      planned_duration_seconds REAL,
      completed_duration_seconds REAL,
      planned_distance_meters REAL,
      completed_distance_meters REAL,
      planned_training_load REAL,
      completed_training_load REAL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_training_activity_match_schedule
      ON training_activity_matches(schedule_plan_id, schedule_id_in_plan);

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'streamable-http',
      auth_type TEXT NOT NULL DEFAULT 'oauth',
      scope TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- Coach analyses. One analysis lives in exactly one conversation, and
    -- carries everything about itself: what it says, when it fires, and the
    -- clocks that decide whether it may.
    --
    -- The tables it replaced (coach_automations, coach_automation_bindings,
    -- coach_automation_local_triggers, coach_automation_runs) are dropped
    -- outright by dropLegacyAutomationTables. Nothing is migrated; see there.
    CREATE TABLE IF NOT EXISTS coach_analyses (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      name            TEXT NOT NULL,
      role            TEXT,
      playbook        TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      preset_id       TEXT,
      runtime_json    TEXT,
      -- NULL = manual, or the trigger is device-only and lives in the table
      -- below. Either way there is nothing here for the oplog to carry.
      trigger_json    TEXT,
      conditions_json TEXT,
      device_only     INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      last_run_at     TEXT,
      next_run_at     TEXT,
      -- start_time (epoch seconds) of the newest activity already looked at.
      -- NULL = never, in which case the creation time is the floor instead.
      last_activity_at INTEGER,
      -- Section 10's backoff. NULL/0 mean healthy.
      backoff_until   TEXT,
      backoff_level   INTEGER,
      -- 3.3's transition state, and its three values all matter: NULL = never
      -- evaluated, 0 = the condition was false last tick, 1 = it was true.
      -- NULL is what stops an analysis written today firing on a condition
      -- that has held all week.
      threshold_firing INTEGER,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    -- Every read is "the analyses of this conversation", in run order.
    CREATE INDEX IF NOT EXISTS idx_coach_analyses_session
      ON coach_analyses (session_id);

    -- A trigger the athlete marked "this device only". It lives here rather
    -- than in a column on coach_analyses because syncPolicy classifies whole
    -- tables and the oplog carries whole rows (SELECT *): a column left out of
    -- a payload arrives as NULL on the other machine, not as "unchanged", so
    -- there is no honest way to hold one column back. This table is device
    -- tier, which is the tier with no way off the machine at all — not into
    -- the vault, not into a backup.
    --
    -- No FOREIGN KEY: this database never turns on PRAGMA foreign_keys, so a
    -- cascade would silently not fire and would read as protection that is not
    -- there. The store deletes these rows alongside the analysis.
    CREATE TABLE IF NOT EXISTS coach_analysis_local_triggers (
      analysis_id     TEXT PRIMARY KEY,
      trigger_json    TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    -- What the local database currently holds, per synced destination, as the
    -- HLC of the write that put it there. The one thing the merge could not
    -- ask before: applyEntries compares entries against each other and never
    -- against this database, so without a per-record timestamp a pull had no
    -- way to notice that the row it was about to overwrite was newer than
    -- anything the log it read contained. See sync/recordVersions.ts.
    --
    -- Never leaves the machine: it describes this copy of the data, not the
    -- data, and it is 'device' in TABLE_POLICY. Written through
    -- requireDatabase() rather than the hooked writers, so stamping a row
    -- cannot itself queue a change.
    CREATE TABLE IF NOT EXISTS sync_record_versions (
      identity TEXT PRIMARY KEY,
      hlc      TEXT NOT NULL
    );

    -- Changes made here that the vault has not confirmed. The queue used to be
    -- an array in the sync loop, so a change written and the app closed in the
    -- same breath never reached the other machine — and nothing ever noticed,
    -- because nothing compares this database against the log. See
    -- sync/outbox.ts. 'device' in TABLE_POLICY, and written through
    -- requireDatabase() so queueing a change cannot queue another.
    CREATE TABLE IF NOT EXISTS sync_outbox (
      hlc        TEXT PRIMARY KEY,
      identity   TEXT NOT NULL,
      entry_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_identity
      ON sync_outbox (identity);

    -- Every activity trigger asks "what landed after this analysis's
    -- watermark", once per analysis, ordered by start_time.
    CREATE INDEX IF NOT EXISTS idx_training_activities_start_time
      ON training_activities (start_time);

    CREATE TABLE IF NOT EXISTS coach_analysis_runs (
      id                   TEXT PRIMARY KEY,
      analysis_id          TEXT NOT NULL,
      status               TEXT NOT NULL,
      trigger_kind         TEXT NOT NULL,
      trigger_payload_json TEXT,
      session_id           TEXT,
      summary              TEXT,
      model                TEXT,
      effort               TEXT,
      -- What each run cost (13). NULL means the provider reported nothing,
      -- which is not the same as a run that cost nothing — the budget has to
      -- be able to say what it cannot see.
      input_tokens         INTEGER,
      output_tokens        INTEGER,
      error                TEXT,
      skip_reason          TEXT,
      seen_at              TEXT,
      started_at           TEXT NOT NULL,
      finished_at          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_runs_analysis
      ON coach_analysis_runs (analysis_id, started_at DESC);

    -- The monthly spend (13) asks "what did every analysis cost since the
    -- 1st", which narrows by nothing but the date. The index above is
    -- prefixed by an id, so it cannot serve it — without this the budget
    -- guard rail scans the whole run log on every run.
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_started
      ON coach_analysis_runs (started_at);

    -- 3.3: the two series a threshold metric needs and the app does not
    -- otherwise keep. COROS owns resting HR and sleep; the activity watcher
    -- snapshots them here on its slow poll so the scheduler's 60-second tick
    -- can evaluate a threshold without a request of its own.
    CREATE TABLE IF NOT EXISTS coach_daily_samples (
      day           TEXT PRIMARY KEY,   -- local "YYYYMMDD", as COROS keys it
      resting_hr    REAL,
      sleep_minutes REAL,
      captured_at   TEXT NOT NULL
    );

    -- The Sleep details screen's cache. One COROS sleep fetch costs ~20
    -- sequential MCP round trips (sleepDataService brute-forces the tool's
    -- argument shapes), so a screen that refetched on every visit would be
    -- unusable; a night that has already been slept never changes, so it is
    -- kept here and re-read instead. The payload column holds the whole
    -- TrainingHubSleepRecord as JSON, which keeps the table additive as the
    -- record grows fields.
    CREATE TABLE IF NOT EXISTS sleep_nights (
      happen_day TEXT NOT NULL,        -- local "YYYYMMDD", as COROS keys it
      kind       TEXT NOT NULL DEFAULT 'main',
      payload    TEXT NOT NULL,
      fetched_at INTEGER NOT NULL      -- epoch ms this row last came off COROS
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sleep_nights_day_kind
      ON sleep_nights (happen_day, kind);

    -- The samples inside one night: HRV during sleep and stress, already
    -- clipped to the sleep window. Kept for the same reason as the totals and
    -- one more: COROS caps both series at a 7-day query window, so a night is
    -- only reachable for a week after it happened.
    CREATE TABLE IF NOT EXISTS sleep_night_series (
      happen_day TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);

  // feel_type caches the COROS end-of-activity feeling (sportFeelInfo.feelType,
  // 1..5; 0 = unrated). NULL = never fetched from the detail endpoint yet.
  ensureColumn(db, "training_activities", "feel_type", "INTEGER");
  migrateChatSessionProviderConstraint(db);
  // pinned_at holds the ISO timestamp a conversation was pinned; NULL = unpinned.
  ensureColumn(db, "chat_sessions", "pinned_at", "TEXT");
  // 5.7: the rolling summary that stands in for the head of a long transcript,
  // and how many entries of that head it accounts for. On the conversation
  // rather than the analysis, because a conversation can hold five of them
  // and the summary is a fact about the conversation.
  ensureColumn(db, "chat_sessions", "coach_summary", "TEXT");
  ensureColumn(db, "chat_sessions", "coach_summary_through", "INTEGER");
  // A coach's creation has versions (docs/coach-plan-canvas.md, P1.1): each is
  // a row of its own, `artifact_id` groups them, and `document_json` holds the
  // plan as the library reads it. Columns rather than fields inside the JSON,
  // because a build without them writes the JSON back without what it does not
  // know, and names only the columns it knows when it syncs.
  ensureColumn(db, "chat_plan_drafts", "artifact_id", "TEXT");
  ensureColumn(db, "chat_plan_drafts", "version", "INTEGER");
  ensureColumn(db, "chat_plan_drafts", "parent_draft_id", "TEXT");
  ensureColumn(db, "chat_plan_drafts", "author", "TEXT");
  ensureColumn(db, "chat_plan_drafts", "document_json", "TEXT");
  ensureColumn(db, "chat_plan_drafts", "change_summary", "TEXT");
  ensureColumn(db, "chat_plan_drafts", "refinements_json", "TEXT");
  // coach_seen_at marks a row as already considered by the analysis activity
  // watcher. NULL = not yet processed, so a re-synced activity is re-evaluated
  // only if the re-sync clears the stamp.
  ensureColumn(db, "training_activities", "coach_seen_at", "TEXT");
  // Nothing else here belongs to the analyses. Their table was created new
  // rather than grown, so every column it has is in the CREATE block above.
  dropLegacyAutomationTables(db);
  dropRetiredMapTables(db);
  dropRetiredCollectionTable(db);
  dropLocalTrainingPlans(db);
  migrateChatTranscriptsToSessions(db);

  // Seed the built-in COROS MCP server so existing users get a registry entry
  // with the exact resource/scope they already use. Its secrets stay under the
  // legacy corosMcp.* / mcp.coros.* settings keys.
  db.prepare(
    `INSERT INTO mcp_servers (id, name, url, transport, auth_type, scope, enabled, builtin, sort_order)
     VALUES ('coros', 'COROS', 'https://mcpus.coros.com/mcp', 'streamable-http', 'oauth',
             'openid mcp.tools offline_access', 1, 1, 0)
     ON CONFLICT(id) DO NOTHING`
  ).run();

  return db;
}

function tableExists(database: Database.Database, table: string): boolean {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function deriveSessionTitle(messagesJson: string): string {
  try {
    const parsed = JSON.parse(messagesJson) as unknown;
    if (!Array.isArray(parsed)) {
      return "New chat";
    }
    for (const entry of parsed) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as { role?: string }).role === "user" &&
        typeof (entry as { content?: string }).content === "string"
      ) {
        const content = (entry as { content: string }).content.trim();
        if (content) {
          return content.length > 48 ? `${content.slice(0, 48)}…` : content;
        }
      }
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as { kind?: string }).kind === "message" &&
        (entry as { role?: string }).role === "user" &&
        typeof (entry as { content?: string }).content === "string"
      ) {
        const content = (entry as { content: string }).content.trim();
        if (content) {
          return content.length > 48 ? `${content.slice(0, 48)}…` : content;
        }
      }
    }
  } catch {
    // fall through
  }
  return "New chat";
}

const CHAT_SESSION_PROVIDERS = [
  "chatgpt",
  "claude-api",
  "claude-code",
  "openrouter",
  "local"
];

function migrateChatSessionProviderConstraint(
  database: Database.Database
): void {
  const row = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_sessions'"
    )
    .get() as { sql: string } | undefined;
  if (
    !row ||
    CHAT_SESSION_PROVIDERS.every((provider) =>
      row.sql.includes(`'${provider}'`)
    )
  ) {
    return;
  }

  // SQLite cannot alter CHECK constraints in place, so rebuild the table.
  database.transaction(() => {
    database.exec(`
      ALTER TABLE chat_sessions RENAME TO chat_sessions_legacy;

      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK(provider IN ('chatgpt', 'claude-api', 'claude-code', 'openrouter', 'local')),
        title TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at)
        SELECT
          id,
          CASE
            WHEN provider IN ('chatgpt', 'claude-api', 'claude-code', 'openrouter', 'local') THEN provider
            WHEN provider = 'claude' THEN 'claude-code'
            ELSE 'chatgpt'
          END,
          title,
          messages_json,
          created_at,
          updated_at
        FROM chat_sessions_legacy;

      DROP TABLE chat_sessions_legacy;

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_provider_updated
        ON chat_sessions(provider, updated_at DESC);
    `);
  })();
}

/**
 * The Automation → Analysis rework drops its predecessor's tables outright.
 *
 * **Nothing is migrated, deliberately.** The shape did not narrow, it changed:
 * an automation was a definition that could be attached to several
 * conversations, each attachment carrying a trigger, and an analysis lives in
 * exactly one conversation and carries its own. There is no honest mapping
 * from one to the other. An automation attached nowhere has no conversation to
 * become an analysis in; one attached three times would become three analyses
 * the athlete never wrote, each inheriting a schedule they set once. Guessing
 * either way produces coaching that speaks without being asked, which is the
 * one failure this feature cannot afford.
 *
 * What is *not* dropped is everything the athlete would miss. Their
 * conversations are `chat_sessions` rows and are untouched, including every
 * answer an automation ever wrote into one — those are transcript entries and
 * stay exactly where they are, chip and all. What goes is the machinery: the
 * definitions, the attachments, and the log of runs against them.
 *
 * No tombstones. Each machine drops these for itself on the upgrade, and a row
 * republished by one still on the old build lands in a table that no longer
 * exists — `syncPolicy` no longer classifies these names, so the merge path
 * skips them rather than recreating anything.
 */
function dropLegacyAutomationTables(database: Database.Database): void {
  for (const table of [
    "coach_automation_bindings",
    "coach_automation_local_triggers",
    "coach_automation_runs",
    "coach_automations"
  ]) {
    if (!tableExists(database, table)) continue;
    console.log(`[db] dropping legacy automation table: ${table}`);
    database.exec(`DROP TABLE ${table}`);
  }
  for (const index of [
    "idx_binding_unique_session",
    "idx_binding_unique_per_run",
    "idx_binding_session",
    "idx_automation_runs_automation",
    "idx_automation_runs_binding",
    "idx_automation_runs_started"
  ]) {
    database.exec(`DROP INDEX IF EXISTS ${index}`);
  }
}

/**
 * Retires the local plan store: a plan is a COROS plan now, and a local one
 * has nowhere to go (docs/training-plan-coros-first.md §8).
 *
 * `training_plans` held two kinds of row. A `coros:` row was a cache of a plan
 * COROS still holds, and the only thing in it COROS does not have is what the
 * athlete set here — favourite, tags, archived — so that moves to
 * `training_plan_metadata` and the rest is dropped; the next snapshot reads the
 * plan fresh. A `local` or `coach` row is dropped outright, by decision: the
 * sessions such a plan once wrote to the calendar are ordinary COROS workouts
 * and stay exactly where they are, because nothing here asks COROS anything.
 *
 * No tombstones, the same as `dropRetiredCollectionTable`: every machine drops
 * its own tables on the upgrade, and `syncPolicy` no longer classifies them,
 * so a row published by a machine still on the old build has no table to land
 * in and is skipped by the merge.
 */
function dropLocalTrainingPlans(database: Database.Database): void {
  if (tableExists(database, "training_plans")) {
    const rows = database
      .prepare("SELECT id, document_json, updated_at FROM training_plans WHERE source = 'coros'")
      .all() as Array<{ id: string; document_json: string; updated_at: string }>;
    const keep = database.prepare(
      `INSERT OR IGNORE INTO training_plan_metadata
         (plan_id, favorite, tags_json, archived, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    let kept = 0;
    database.transaction(() => {
      for (const row of rows) {
        const plan = parseStoredJson<Record<string, unknown> | undefined>(row.document_json, undefined);
        const tags = Array.isArray(plan?.tags) ? plan.tags.filter((tag) => typeof tag === "string") : [];
        const favorite = plan?.favorite === true;
        const archived = plan?.archived === true;
        if (!favorite && !archived && tags.length === 0) continue;
        keep.run(row.id, favorite ? 1 : 0, JSON.stringify(tags), archived ? 1 : 0, row.updated_at);
        kept += 1;
      }
    })();
    console.log(`[db] retiring local training plans; kept metadata for ${kept} COROS plan(s)`);
    database.exec("DROP TABLE training_plans");
  }
  if (tableExists(database, "training_plan_workout_links")) {
    database.exec("DROP TABLE training_plan_workout_links");
  }
}

/**
 * Drops the local "collection" grouping, with its column.
 *
 * COROS serves four training endpoints — program, plan, schedule and exercise —
 * and not one of them knows about a collection. It was invented upstream, and
 * in this fork it was write-only: two bulk bars set `collection_id` and the one
 * place that read it was a count. There is nothing to migrate, because there
 * was never anywhere for the grouping to go.
 *
 * No tombstones, the same as `dropLegacyAutomationTables`: each machine drops
 * this for itself on the upgrade, and `syncPolicy` no longer classifies the
 * table, so a row republished by a machine still on the old build is skipped by
 * the merge rather than recreating anything.
 */
function dropRetiredCollectionTable(database: Database.Database): void {
  if (tableExists(database, "training_collections")) {
    console.log("[db] dropping retired table: training_collections");
    database.exec("DROP TABLE training_collections");
  }
  // The column goes with it. `SqliteSyncTarget.upsertRow` drops columns this
  // build does not have and reports the entry through `takeIncomplete`, so a
  // machine still on the old build publishing `collection_id` lands its row
  // without that column rather than aborting the merge.
  const columns = database
    .prepare("PRAGMA table_info(training_workout_metadata)")
    .all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "collection_id")) {
    console.log("[db] dropping retired column: training_workout_metadata.collection_id");
    database.exec("ALTER TABLE training_workout_metadata DROP COLUMN collection_id");
  }
}

/**
 * Drops the tables the Maps screen owned. Nothing reads them any more, and both
 * described files on disk (a downloaded map package, a route's GPX) that the
 * startup sweep in main.ts removes — so leaving the rows would leave a record
 * of files that are gone. There is nothing to migrate: a drawn route belongs to
 * a route builder this app no longer has.
 */
function dropRetiredMapTables(database: Database.Database): void {
  for (const table of ["generated_routes", "cached_coros_maps"]) {
    if (!tableExists(database, table)) continue;
    console.log(`[db] dropping retired maps table: ${table}`);
    database.exec(`DROP TABLE ${table}`);
  }
}

function migrateChatTranscriptsToSessions(database: Database.Database): void {
  if (!tableExists(database, "chat_transcripts")) {
    return;
  }

  const rows = database
    .prepare(
      "SELECT provider, messages_json, updated_at FROM chat_transcripts"
    )
    .all() as Array<{
    provider: string;
    messages_json: string;
    updated_at: string;
  }>;

  if (rows.length > 0) {
    const insert = database.prepare(
      `INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const transaction = database.transaction(
      (legacyRows: typeof rows) => {
        for (const row of legacyRows) {
          insert.run(
            crypto.randomUUID(),
            row.provider,
            deriveSessionTitle(row.messages_json),
            row.messages_json,
            row.updated_at,
            row.updated_at
          );
        }
      }
    );
    transaction(rows);
  }

  database.exec("DROP TABLE chat_transcripts");
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) {
    return;
  }
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function requireDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database has not been initialized.");
  }

  return db;
}

/**
 * Release the handle, so the file can be removed.
 *
 * The app never calls this — it owns one database for the life of the process
 * and the OS closes it at exit. The suites do: each opens a database under a
 * temp directory and deletes the tree afterwards, and Windows refuses to
 * unlink a file that is still open (EBUSY on the database, EPERM on the
 * directory holding it). So every one of them passed its assertions and then
 * died in teardown, on an error naming a temp path and nothing about the
 * subject.
 *
 * It clears the module's handle as well as closing it, because
 * `initializeDatabase` returns the existing one when there is any — a test
 * that closed without clearing would be handed the closed handle back.
 */
export function closeDatabase(): void {
  if (!db) {
    return;
  }
  const open = db;
  db = undefined;
  open.close();
}

function toLocalTrack(row: DownloadRow): LocalTrack {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    transferredAt: row.transferred_at ?? undefined
  };
}

export function listDownloads(): LocalTrack[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
       FROM downloads
       ORDER BY created_at DESC`
    )
    .all() as DownloadRow[];

  return rows.map(toLocalTrack);
}

/**
 * Returns whether a downloaded file is still available for a source URL or
 * intended filename.
 *
 * Download queue jobs are deliberately in-memory so interrupted jobs are not
 * resumed after an app restart. The downloaded media itself is persisted in
 * this table, however, so use it as the durable duplicate guard for completed
 * search-based downloads such as Apple Music tracks.
 */
export function hasAvailableDownloadForUrl(
  url: string,
  expectedTitle?: string
): boolean {
  const database = requireDatabase();
  const spotifyTrackId = spotifyTrackIdFromSourceUrl(url);
  const youtubeVideoId = youtubeVideoIdFromValue(url);
  const expectedTitleKey = downloadTitleKey(expectedTitle);
  const sourceRows = spotifyTrackId
    ? (database
        .prepare(
          "SELECT url, title, file_path FROM downloads WHERE url = ? OR url LIKE 'spotify:%'"
        )
        .all(url) as Array<{ url: string; title: string; file_path: string }>)
    : (database
        .prepare("SELECT url, title, file_path FROM downloads WHERE url = ?")
        .all(url) as Array<{ url: string; title: string; file_path: string }>);

  if (
    sourceRows.some(
      (row) =>
        fs.existsSync(row.file_path) &&
        (row.url === url ||
          (spotifyTrackId !== undefined &&
            spotifyTrackIdFromSourceUrl(row.url) === spotifyTrackId)),
    )
  ) {
    return true;
  }

  if (!expectedTitleKey) {
    if (!youtubeVideoId) {
      return false;
    }
  }

  const titleRows = database
    .prepare("SELECT title, file_path FROM downloads")
    .all() as Array<{ title: string; file_path: string }>;

  return titleRows.some(
    (row) =>
      fs.existsSync(row.file_path) &&
      ((youtubeVideoId !== undefined &&
        (youtubeVideoIdFromValue(row.title) === youtubeVideoId ||
          youtubeVideoIdFromValue(row.file_path) === youtubeVideoId)) ||
        (expectedTitleKey !== undefined &&
          downloadTitleKey(row.title) === expectedTitleKey)),
  );
}

function downloadTitleKey(title?: string): string | undefined {
  const normalized = (title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();

  return normalized || undefined;
}

function spotifyTrackIdFromSourceUrl(sourceUrl: string): string | undefined {
  if (!sourceUrl.startsWith("spotify:")) {
    return undefined;
  }

  const separator = sourceUrl.lastIndexOf(":");
  const trackId = sourceUrl.slice(separator + 1);
  return trackId || undefined;
}

function youtubeVideoIdFromValue(value: string): string | undefined {
  const urlMatch = value.match(
    /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/
  );
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const filenameMatch = value.match(/\[([A-Za-z0-9_-]{11})\](?:\.[^.]+)?$/);
  return filenameMatch?.[1];
}

export function getDownloadById(id: string): LocalTrack | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
       FROM downloads
       WHERE id = ?`
    )
    .get(id) as DownloadRow | undefined;

  return row ? toLocalTrack(row) : undefined;
}

export function isCombinedDownloadAtPath(filePath: string): boolean {
  const row = requireDatabase()
    .prepare(
      `SELECT 1
       FROM downloads
       WHERE file_path = ? AND url LIKE 'combined:%'`
    )
    .get(filePath);
  return Boolean(row);
}

export function addDownloads(filePaths: string[], url: string): LocalTrack[] {
  const database = requireDatabase();
  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO downloads
      (id, url, title, file_path, size_bytes, created_at)
    VALUES
      (@id, @url, @title, @filePath, @sizeBytes, @createdAt)
  `);

  const transaction = database.transaction((paths: string[]) => {
    for (const filePath of paths) {
      const stats = fs.statSync(filePath);
      insert.run({
        id: crypto.randomUUID(),
        url,
        title: path.basename(filePath, path.extname(filePath)),
        filePath,
        sizeBytes: stats.size,
        createdAt: now
      });
    }
  });

  transaction(filePaths);

  const select = database.prepare(
    `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
     FROM downloads
     WHERE file_path = ?`
  );

  return filePaths
    .map((filePath) => select.get(filePath) as DownloadRow | undefined)
    .filter((row): row is DownloadRow => Boolean(row))
    .map(toLocalTrack);
}

/** Registers a file whose contents replace an earlier library artifact. */
export function replaceDownload(filePath: string, url: string): LocalTrack {
  const database = requireDatabase();
  const stats = fs.statSync(filePath);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO downloads
        (id, url, title, file_path, size_bytes, created_at, transferred_at)
       VALUES
        (@id, @url, @title, @filePath, @sizeBytes, @createdAt, NULL)
       ON CONFLICT(file_path) DO UPDATE SET
         url = excluded.url,
         title = excluded.title,
         size_bytes = excluded.size_bytes,
         created_at = excluded.created_at,
         transferred_at = NULL`
    )
    .run({
      id: crypto.randomUUID(),
      url,
      title: path.basename(filePath, path.extname(filePath)),
      filePath,
      sizeBytes: stats.size,
      createdAt: now
    });

  const row = database
    .prepare(
      `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
       FROM downloads
       WHERE file_path = ?`
    )
    .get(filePath) as DownloadRow;
  return toLocalTrack(row);
}

export function markDownloadTransferred(id: string): void {
  requireDatabase()
    .prepare("UPDATE downloads SET transferred_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function clearDownloadTransferredByFileName(fileName: string): void {
  if (!fileName) {
    return;
  }

  const database = requireDatabase();
  const rows = database
    .prepare(
      `SELECT id, file_path
       FROM downloads
       WHERE transferred_at IS NOT NULL`,
    )
    .all() as Array<{ id: string; file_path: string }>;

  const clear = database.prepare(
    "UPDATE downloads SET transferred_at = NULL WHERE id = ?",
  );

  for (const row of rows) {
    if (musicFileNamesMatch(row.file_path, fileName)) {
      clear.run(row.id);
    }
  }
}

export function deleteDownload(id: string, removeFile: boolean): void {
  const existing = getDownloadById(id);
  if (!existing) {
    return;
  }

  if (removeFile && fs.existsSync(existing.filePath)) {
    fs.rmSync(existing.filePath, { force: true });
  }

  requireDatabase().prepare("DELETE FROM downloads WHERE id = ?").run(id);
}

export function getSetting(key: string): string | undefined {
  const row = requireDatabase()
    .prepare("SELECT key, value FROM app_settings WHERE key = ?")
    .get(key) as SettingRow | undefined;

  return row?.value;
}

/**
 * Hand a written row to the sync loop.
 *
 * The row is read back rather than taken from the caller, so the queued entry
 * carries exactly what the database now holds — including columns with
 * defaults the caller never set, which another machine would otherwise receive
 * as missing.
 *
 * Table and column names here are literals from this file, never remote data.
 */
function notifySyncedRow(
  table: string,
  keyColumns: readonly string[],
  values: readonly string[]
): void {
  const where = keyColumns.map((column) => `${column} = ?`).join(" AND ");
  const row = requireDatabase()
    .prepare(`SELECT * FROM ${table} WHERE ${where}`)
    .get(values) as Record<string, unknown> | undefined;
  if (row) {
    notifyRowChanged(table, values.join(RECORD_ID_SEPARATOR), row);
  }
}

function notifySyncedDelete(table: string, ...values: string[]): void {
  notifyRowDeleted(table, values.join(RECORD_ID_SEPARATOR));
}

export function setSetting(key: string, value: string): void {
  requireDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
  // The single choke point every settings write in the app passes through, so
  // the sync loop learns about all of them from one hook. A no-op until sync
  // is attached, and it swallows its own errors — a sync problem must never
  // fail an ordinary settings write.
  notifySettingChanged(key, value);
}

export function deleteSettings(keys: string[]): void {
  const database = requireDatabase();
  const remove = database.prepare("DELETE FROM app_settings WHERE key = ?");
  const transaction = database.transaction((settingKeys: string[]) => {
    for (const key of settingKeys) {
      remove.run(key);
    }
  });

  transaction(keys);
  notifySettingsDeleted(keys);
}

export interface ChatSessionRow {
  id: string;
  provider: string;
  title: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
  pinned_at: string | null;
}

/** 5.7's stored summary for one conversation, and what it covers. */
export interface ChatSessionCoachSummaryRow {
  coach_summary: string | null;
  coach_summary_through: number | null;
}

export function getChatSessionCoachSummaryRow(
  id: string
): ChatSessionCoachSummaryRow | undefined {
  return requireDatabase()
    .prepare(
      "SELECT coach_summary, coach_summary_through FROM chat_sessions WHERE id = ?"
    )
    .get(id) as ChatSessionCoachSummaryRow | undefined;
}

/**
 * Written on its own rather than through `updateSession`, which rewrites the
 * whole transcript: rolling the summary changes nothing the athlete wrote, and
 * a run that also rewrote `messages_json` would race the window's own saves
 * (5.6b) for no reason.
 */
export function setChatSessionCoachSummaryRow(
  id: string,
  summary: string | null,
  through: number | null
): void {
  requireDatabase()
    .prepare(
      `UPDATE chat_sessions
       SET coach_summary = ?, coach_summary_through = ?
       WHERE id = ?`
    )
    .run(summary, through, id);
}

export function listChatSessionRows(provider: string): ChatSessionRow[] {
  return requireDatabase()
    .prepare(
      `SELECT id, provider, title, messages_json, created_at, updated_at, pinned_at
       FROM chat_sessions
       WHERE provider = ?
       ORDER BY updated_at DESC`
    )
    .all(provider) as ChatSessionRow[];
}

export function getChatSessionRow(id: string): ChatSessionRow | undefined {
  return requireDatabase()
    .prepare(
      `SELECT id, provider, title, messages_json, created_at, updated_at, pinned_at
       FROM chat_sessions
       WHERE id = ?`
    )
    .get(id) as ChatSessionRow | undefined;
}

/**
 * Hand a written conversation to the sync loop.
 *
 * Every write site goes through here rather than building a payload of its own.
 * `notifySyncedRow` reads the row back with `SELECT *`, which is not a detail:
 * `SqliteSyncTarget.upsertRow` uses `INSERT OR REPLACE`, and SQLite's REPLACE
 * deletes the conflicting row before inserting — so a payload that lists only
 * the columns the caller happened to set wipes the rest to NULL. A hand-built
 * seven-column payload here erased `coach_summary` and `coach_summary_through`
 * on the local machine, measurably, within seconds of every save.
 */
function notifyChatSessionRow(id: string): void {
  notifySyncedRow("chat_sessions", ["id"], [id]);
}

export function insertChatSessionRow(
  id: string,
  provider: string,
  title: string,
  messagesJson: string,
  createdAt: string,
  updatedAt: string
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, provider, title, messagesJson, createdAt, updatedAt);
  // Deliberately not notified. A conversation is created empty, the moment the
  // composer opens, and syncing that would put a stranger's blank "New chat" in
  // everyone's sidebar. It travels on its first real save — or on a rename, if
  // that comes first — and carries the whole row either way.
}

export function updateChatSessionRow(
  id: string,
  title: string,
  messagesJson: string,
  updatedAt: string
): void {
  requireDatabase()
    .prepare(
      `UPDATE chat_sessions
       SET title = ?, messages_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(title, messagesJson, updatedAt, id);
  notifyChatSessionRow(id);
}

/**
 * Renames a conversation without touching `updated_at`, so a rename never
 * reshuffles the sidebar the way a new message does.
 */
export function setChatSessionTitleRow(id: string, title: string): void {
  requireDatabase()
    .prepare("UPDATE chat_sessions SET title = ? WHERE id = ?")
    .run(title, id);
  notifyChatSessionRow(id);
}

export function setChatSessionPinnedRow(
  id: string,
  pinnedAt: string | null
): void {
  requireDatabase()
    .prepare("UPDATE chat_sessions SET pinned_at = ? WHERE id = ?")
    .run(pinnedAt, id);
  notifyChatSessionRow(id);
}

export function deleteChatSessionRow(id: string): void {
  requireDatabase()
    .prepare("DELETE FROM chat_sessions WHERE id = ?")
    .run(id);
  // A tombstone, so the conversation stays deleted instead of being restored
  // by a device that still holds the original row.
  notifySyncedDelete("chat_sessions", id);
}

export interface CoachAnalysisRow {
  id: string;
  session_id: string;
  name: string;
  role: string | null;
  playbook: string;
  enabled: number;
  preset_id: string | null;
  runtime_json: string | null;
  /** The trigger, when it is allowed to travel. NULL = manual, or device-only. */
  trigger_json: string | null;
  conditions_json: string | null;
  /** 1 = the trigger is in `coach_analysis_local_triggers` and stays here. */
  device_only: number;
  sort_order: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_activity_at: number | null;
  backoff_until: string | null;
  backoff_level: number | null;
  /** NULL = never evaluated; 0/1 = the condition last tick (3.3). */
  threshold_firing: number | null;
  created_at: string;
  updated_at: string;
}

const COACH_ANALYSIS_COLUMNS = `id, session_id, name, role, playbook, enabled,
         preset_id, runtime_json, trigger_json, conditions_json, device_only,
         sort_order, last_run_at, next_run_at, last_activity_at, backoff_until,
         backoff_level, threshold_firing, created_at, updated_at`;

/** Every analysis on the machine, for the scheduler's tick. */
export function listCoachAnalysisRows(): CoachAnalysisRow[] {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_ANALYSIS_COLUMNS} FROM coach_analyses
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all() as CoachAnalysisRow[];
}

/** The analyses of one conversation, in the order they run in it (2.3). */
export function listCoachAnalysisRowsForSession(
  sessionId: string
): CoachAnalysisRow[] {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_ANALYSIS_COLUMNS} FROM coach_analyses
       WHERE session_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(sessionId) as CoachAnalysisRow[];
}

export function getCoachAnalysisRow(
  id: string
): CoachAnalysisRow | undefined {
  return requireDatabase()
    .prepare(`SELECT ${COACH_ANALYSIS_COLUMNS} FROM coach_analyses WHERE id = ?`)
    .get(id) as CoachAnalysisRow | undefined;
}

export function countCoachAnalysisRowsForSession(sessionId: string): number {
  return (
    requireDatabase()
      .prepare(
        "SELECT COUNT(*) AS count FROM coach_analyses WHERE session_id = ?"
      )
      .get(sessionId) as { count: number }
  ).count;
}

export function insertCoachAnalysisRow(row: CoachAnalysisRow): void {
  requireDatabase()
    .prepare(
      `INSERT INTO coach_analyses
         (id, session_id, name, role, playbook, enabled, preset_id,
          runtime_json, trigger_json, conditions_json, device_only, sort_order,
          last_run_at, next_run_at, last_activity_at, backoff_until,
          backoff_level, threshold_firing, created_at, updated_at)
       VALUES
         (@id, @session_id, @name, @role, @playbook, @enabled, @preset_id,
          @runtime_json, @trigger_json, @conditions_json, @device_only,
          @sort_order, @last_run_at, @next_run_at, @last_activity_at,
          @backoff_until, @backoff_level, @threshold_firing, @created_at,
          @updated_at)`
    )
    .run(row);
  notifySyncedRow("coach_analyses", ["id"], [row.id]);
}

export function updateCoachAnalysisRow(row: CoachAnalysisRow): void {
  requireDatabase()
    .prepare(
      `UPDATE coach_analyses
       SET name = @name, role = @role, playbook = @playbook,
           enabled = @enabled, preset_id = @preset_id,
           runtime_json = @runtime_json, trigger_json = @trigger_json,
           conditions_json = @conditions_json, device_only = @device_only,
           sort_order = @sort_order, last_run_at = @last_run_at,
           next_run_at = @next_run_at, last_activity_at = @last_activity_at,
           backoff_until = @backoff_until, backoff_level = @backoff_level,
           threshold_firing = @threshold_firing, updated_at = @updated_at
       WHERE id = @id`
    )
    .run(row);
  notifySyncedRow("coach_analyses", ["id"], [row.id]);
}

export function deleteCoachAnalysisRow(id: string): void {
  requireDatabase().prepare("DELETE FROM coach_analyses WHERE id = ?").run(id);
  deleteAnalysisLocalTriggerRow(id);
  notifySyncedDelete("coach_analyses", id);
}

/**
 * A conversation was deleted, so its analyses go with it. Collected before the
 * delete: a tombstone needs the id, and after the row is gone there is nothing
 * left to read it from.
 */
export function deleteCoachAnalysisRowsForSession(sessionId: string): string[] {
  const ids = (
    requireDatabase()
      .prepare("SELECT id FROM coach_analyses WHERE session_id = ?")
      .all(sessionId) as Array<{ id: string }>
  ).map((row) => row.id);
  requireDatabase()
    .prepare("DELETE FROM coach_analyses WHERE session_id = ?")
    .run(sessionId);
  for (const id of ids) {
    deleteAnalysisLocalTriggerRow(id);
    notifySyncedDelete("coach_analyses", id);
  }
  return ids;
}

export interface AnalysisLocalTriggerRow {
  analysis_id: string;
  trigger_json: string;
  conditions_json: string;
  updated_at: string;
}

/**
 * The device-only half of an analysis. None of these four touch
 * `notifySyncedRow`: the table is `device` tier, and a sync notification for
 * it would be the one thing the tier exists to prevent.
 */
export function getAnalysisLocalTriggerRow(
  analysisId: string
): AnalysisLocalTriggerRow | undefined {
  return requireDatabase()
    .prepare(
      `SELECT analysis_id, trigger_json, conditions_json, updated_at
       FROM coach_analysis_local_triggers WHERE analysis_id = ?`
    )
    .get(analysisId) as AnalysisLocalTriggerRow | undefined;
}

export function listAnalysisLocalTriggerRows(): AnalysisLocalTriggerRow[] {
  return requireDatabase()
    .prepare(
      `SELECT analysis_id, trigger_json, conditions_json, updated_at
       FROM coach_analysis_local_triggers`
    )
    .all() as AnalysisLocalTriggerRow[];
}

export function upsertAnalysisLocalTriggerRow(
  row: AnalysisLocalTriggerRow
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO coach_analysis_local_triggers
         (analysis_id, trigger_json, conditions_json, updated_at)
       VALUES (@analysis_id, @trigger_json, @conditions_json, @updated_at)
       ON CONFLICT(analysis_id) DO UPDATE SET
         trigger_json = excluded.trigger_json,
         conditions_json = excluded.conditions_json,
         updated_at = excluded.updated_at`
    )
    .run(row);
}

export function deleteAnalysisLocalTriggerRow(analysisId: string): void {
  requireDatabase()
    .prepare("DELETE FROM coach_analysis_local_triggers WHERE analysis_id = ?")
    .run(analysisId);
}

export interface CoachDailySampleRow {
  day: string;
  resting_hr: number | null;
  sleep_minutes: number | null;
}

/**
 * 3.3's local cache, upserted column by column. A snapshot that reached COROS
 * for resting HR and failed on sleep must not blank the sleep it already had,
 * so each column keeps its stored value when the incoming row says nothing.
 */
export function upsertCoachDailySamples(
  rows: CoachDailySampleRow[],
  capturedAt: string
): void {
  if (!rows.length) {
    return;
  }
  const database = requireDatabase();
  const statement = database.prepare(
    `INSERT INTO coach_daily_samples (day, resting_hr, sleep_minutes, captured_at)
     VALUES (@day, @resting_hr, @sleep_minutes, @captured_at)
     ON CONFLICT(day) DO UPDATE SET
       resting_hr = COALESCE(excluded.resting_hr, coach_daily_samples.resting_hr),
       sleep_minutes =
         COALESCE(excluded.sleep_minutes, coach_daily_samples.sleep_minutes),
       captured_at = excluded.captured_at`
  );
  const transaction = database.transaction((batch: CoachDailySampleRow[]) => {
    for (const row of batch) {
      statement.run({ ...row, captured_at: capturedAt });
    }
  });
  transaction(rows);
}

export interface SleepNightRow {
  happen_day: string;
  kind: string;
  payload: string;
  fetched_at: number;
}

/**
 * Upserts fetched nights. A row is replaced wholesale rather than merged
 * column by column: unlike the daily samples above, one COROS answer carries a
 * whole night or none of it, so there is no half-row to protect.
 */
export function upsertSleepNights(rows: SleepNightRow[]): void {
  if (!rows.length) {
    return;
  }

  const database = requireDatabase();
  const statement = database.prepare(
    `INSERT INTO sleep_nights (happen_day, kind, payload, fetched_at)
     VALUES (@happen_day, @kind, @payload, @fetched_at)
     ON CONFLICT(happen_day, kind) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`
  );
  const transaction = database.transaction((batch: SleepNightRow[]) => {
    for (const row of batch) {
      statement.run(row);
    }
  });
  transaction(rows);
}

/** Cached nights from `fromDay` (inclusive) onward, newest first. */
export function listSleepNights(fromDay: string): SleepNightRow[] {
  return requireDatabase()
    .prepare(
      `SELECT happen_day, kind, payload, fetched_at
       FROM sleep_nights
       WHERE happen_day >= ?
       ORDER BY happen_day DESC`
    )
    .all(fromDay) as SleepNightRow[];
}

/** Drops cached nights older than `beforeDay`, so the table cannot grow forever. */
export function pruneSleepNights(beforeDay: string): void {
  requireDatabase()
    .prepare("DELETE FROM sleep_nights WHERE happen_day < ?")
    .run(beforeDay);
}

export interface SleepNightSeriesRow {
  happen_day: string;
  payload: string;
  fetched_at: number;
}

export function upsertSleepNightSeries(row: SleepNightSeriesRow): void {
  requireDatabase()
    .prepare(
      `INSERT INTO sleep_night_series (happen_day, payload, fetched_at)
       VALUES (@happen_day, @payload, @fetched_at)
       ON CONFLICT(happen_day) DO UPDATE SET
         payload = excluded.payload,
         fetched_at = excluded.fetched_at`
    )
    .run(row);
}

/** Every cached night series, newest first. */
export function listSleepNightSeries(): SleepNightSeriesRow[] {
  return requireDatabase()
    .prepare(
      `SELECT happen_day, payload, fetched_at
       FROM sleep_night_series
       ORDER BY happen_day DESC`
    )
    .all() as SleepNightSeriesRow[];
}

/** Drops cached night series older than `beforeDay`. */
export function pruneSleepNightSeries(beforeDay: string): void {
  requireDatabase()
    .prepare("DELETE FROM sleep_night_series WHERE happen_day < ?")
    .run(beforeDay);
}

/** Samples from `fromDay` (inclusive) onward, ascending. */
export function listCoachDailySamples(fromDay: string): CoachDailySampleRow[] {
  return requireDatabase()
    .prepare(
      `SELECT day, resting_hr, sleep_minutes
       FROM coach_daily_samples
       WHERE day >= ?
       ORDER BY day ASC`
    )
    .all(fromDay) as CoachDailySampleRow[];
}

export interface CoachThresholdLoadRow {
  start_time: number;
  training_load: number;
}

/** Activities carrying a training load since `fromEpochSeconds`, for 3.3. */
export function listCoachThresholdLoads(
  fromEpochSeconds: number
): CoachThresholdLoadRow[] {
  return requireDatabase()
    .prepare(
      `SELECT start_time, training_load
       FROM training_activities
       WHERE start_time IS NOT NULL
         AND start_time >= ?
         AND training_load IS NOT NULL
       ORDER BY start_time ASC`
    )
    .all(fromEpochSeconds) as CoachThresholdLoadRow[];
}

export interface CoachThresholdSlotRow {
  happen_day: string;
  matched: number;
}

/**
 * Scheduled workouts from `fromDay` onward and whether one was ever matched.
 *
 * `skipped` and `rescheduled` are excluded: the athlete moved those on purpose,
 * and a rule about adherence that fires on a deliberate rest day is a rule the
 * athlete switches off.
 */
export function listCoachThresholdSlots(fromDay: string): CoachThresholdSlotRow[] {
  return requireDatabase()
    .prepare(
      `SELECT happen_day, (activity_id IS NOT NULL) AS matched
       FROM training_activity_matches
       WHERE happen_day >= ?
         AND status NOT IN ('skipped', 'rescheduled')
       ORDER BY happen_day ASC`
    )
    .all(fromDay) as CoachThresholdSlotRow[];
}

export interface CoachAnalysisRunRow {
  id: string;
  analysis_id: string;
  status: string;
  trigger_kind: string;
  trigger_payload_json: string | null;
  session_id: string | null;
  summary: string | null;
  model: string | null;
  effort: string | null;
  error: string | null;
  skip_reason: string | null;
  seen_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface CoachAnalysisTokenTotals {
  inputTokens: number;
  outputTokens: number;
  /** Runs that reported a cost, and runs that reached the provider at all. */
  countedRuns: number;
  providerRuns: number;
}

/**
 * What the analyses have spent since `sinceIso`.
 *
 * `countedRuns` and `providerRuns` are both reported so the UI can say when a
 * total is short of the truth. A provider that does not report usage — a local
 * server without `stream_options`, say — would otherwise make a budget read as
 * comfortably under when nobody has any idea.
 */
export function sumCoachAnalysisTokensSince(
  sinceIso: string
): CoachAnalysisTokenTotals {
  const row = requireDatabase()
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         SUM(CASE WHEN input_tokens IS NOT NULL
                    OR output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS countedRuns,
         COUNT(*) AS providerRuns
       FROM coach_analysis_runs
       WHERE started_at >= ?
         AND status IN ('success', 'silent', 'failed', 'cancelled')`
    )
    .get(sinceIso) as CoachAnalysisTokenTotals;
  return {
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    countedRuns: row.countedRuns ?? 0,
    providerRuns: row.providerRuns ?? 0
  };
}

const COACH_ANALYSIS_RUN_COLUMNS = `id, analysis_id, status, trigger_kind,
         trigger_payload_json, session_id, summary, model, effort, error,
         skip_reason, seen_at, input_tokens, output_tokens,
         started_at, finished_at`;

export function listCoachAnalysisRunRows(
  filter: CoachAnalysisRunQuery = {}
): CoachAnalysisRunRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.analysisId) {
    clauses.push("analysis_id = ?");
    params.push(filter.analysisId);
  }
  if (filter.sessionId) {
    clauses.push("session_id = ?");
    params.push(filter.sessionId);
  }
  if (filter.since) {
    clauses.push("started_at >= ?");
    params.push(filter.since);
  }
  if (filter.statuses?.length) {
    clauses.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
    params.push(...filter.statuses);
  }
  if (filter.unseenOnly) {
    clauses.push("seen_at IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit ? "LIMIT ?" : "";
  if (filter.limit) {
    params.push(filter.limit);
  }
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_ANALYSIS_RUN_COLUMNS}
       FROM coach_analysis_runs
       ${where}
       ORDER BY started_at DESC
       ${limit}`
    )
    .all(...params) as CoachAnalysisRunRow[];
}

export function getCoachAnalysisRunRow(
  id: string
): CoachAnalysisRunRow | undefined {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_ANALYSIS_RUN_COLUMNS} FROM coach_analysis_runs WHERE id = ?`
    )
    .get(id) as CoachAnalysisRunRow | undefined;
}

export function insertCoachAnalysisRunRow(row: CoachAnalysisRunRow): void {
  requireDatabase()
    .prepare(
      `INSERT INTO coach_analysis_runs
         (id, analysis_id, status, trigger_kind,
          trigger_payload_json, session_id, summary, model, effort, error,
          skip_reason, seen_at, input_tokens, output_tokens,
          started_at, finished_at)
       VALUES
         (@id, @analysis_id, @status, @trigger_kind,
          @trigger_payload_json, @session_id, @summary, @model, @effort, @error,
          @skip_reason, @seen_at, @input_tokens, @output_tokens,
          @started_at, @finished_at)`
    )
    .run(row);
}

export interface CoachUnseenActivityRow {
  activity_id: string;
  name: string | null;
  sport_type: number;
  sport_name: string | null;
  start_time: number | null;
  duration: number | null;
  distance: number | null;
}

/**
 * Activities the analysis watcher has not processed yet. `coach_seen_at` is
 * stamped on the row itself rather than tracked in a side table, so it survives
 * a re-sync of the activity index.
 */
export function listUnseenCoachActivityRows(
  sinceEpochSeconds?: number
): CoachUnseenActivityRow[] {
  const clause = sinceEpochSeconds
    ? "AND (start_time IS NULL OR start_time >= ?)"
    : "";
  const params = sinceEpochSeconds ? [sinceEpochSeconds] : [];
  return requireDatabase()
    .prepare(
      `SELECT activity_id, name, sport_type, sport_name, start_time, duration, distance
       FROM training_activities
       WHERE coach_seen_at IS NULL ${clause}
       ORDER BY start_time DESC`
    )
    .all(...params) as CoachUnseenActivityRow[];
}

/**
 * Activities newer than a binding's own watermark, oldest first, so a backlog
 * is analysed in the order the athlete lived it. Independent of `coach_seen_at`
 * on purpose: that column decides *when* the watcher fires, while each binding
 * decides *what* it still owes an opinion on.
 */
export function listCoachActivityRowsAfter(
  afterEpochSeconds: number | undefined,
  limit: number
): CoachUnseenActivityRow[] {
  const clause = afterEpochSeconds === undefined ? "" : "AND start_time > ?";
  const params: number[] =
    afterEpochSeconds === undefined ? [limit] : [afterEpochSeconds, limit];
  // Newest-first in SQL so the cap keeps the most recent N of a long backlog,
  // then reversed so callers see them oldest-first.
  const rows = requireDatabase()
    .prepare(
      `SELECT activity_id, name, sport_type, sport_name, start_time, duration, distance
       FROM training_activities
       WHERE start_time IS NOT NULL ${clause}
       ORDER BY start_time DESC
       LIMIT ?`
    )
    .all(...params) as CoachUnseenActivityRow[];
  return rows.reverse();
}

export function markCoachActivitiesSeen(activityIds: string[]): void {
  if (!activityIds.length) {
    return;
  }
  const database = requireDatabase();
  const seenAt = new Date().toISOString();
  const statement = database.prepare(
    "UPDATE training_activities SET coach_seen_at = ? WHERE activity_id = ?"
  );
  database.transaction((ids: string[]) => {
    for (const id of ids) statement.run(seenAt, id);
  })(activityIds);
}

/**
 * Cold start: stamps every activity already on disk without firing anything.
 * Without this, switching the feature on would replay the athlete's entire
 * history as "new".
 */
export function markAllCoachActivitiesSeen(): number {
  const result = requireDatabase()
    .prepare(
      "UPDATE training_activities SET coach_seen_at = ? WHERE coach_seen_at IS NULL"
    )
    .run(new Date().toISOString());
  return result.changes;
}

export function updateCoachAnalysisRunRow(row: CoachAnalysisRunRow): void {
  requireDatabase()
    .prepare(
      `UPDATE coach_analysis_runs
       SET status = @status, trigger_payload_json = @trigger_payload_json,
           session_id = @session_id, summary = @summary, model = @model,
           effort = @effort, error = @error, skip_reason = @skip_reason,
           seen_at = @seen_at, input_tokens = @input_tokens,
           output_tokens = @output_tokens, finished_at = @finished_at
       WHERE id = @id`
    )
    .run(row);
}

function toSpotifySyncTrack(row: SpotifySyncTrackRow): SpotifySyncTrack {
  return {
    playlistId: row.playlist_id,
    spotifyTrackId: row.spotify_track_id,
    artistName: row.artist_name,
    trackName: row.track_name,
    query: row.query,
    filename: row.filename,
    status: row.status,
    localDownloadId: row.local_download_id ?? undefined,
    filePath: row.file_path ?? undefined,
    error: row.error ?? undefined,
    updatedAt: row.updated_at
  };
}

export function listSpotifySyncTracks(playlistId: string): SpotifySyncTrack[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT playlist_id, spotify_track_id, artist_name, track_name, query,
              filename, status, local_download_id, file_path, error, updated_at
       FROM spotify_sync_tracks
       WHERE playlist_id = ?
       ORDER BY artist_name, track_name`
    )
    .all(playlistId) as SpotifySyncTrackRow[];

  return rows.map(toSpotifySyncTrack);
}

export function getSpotifySyncTrack(
  playlistId: string,
  spotifyTrackId: string
): SpotifySyncTrack | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT playlist_id, spotify_track_id, artist_name, track_name, query,
              filename, status, local_download_id, file_path, error, updated_at
       FROM spotify_sync_tracks
       WHERE playlist_id = ? AND spotify_track_id = ?`
    )
    .get(playlistId, spotifyTrackId) as SpotifySyncTrackRow | undefined;

  return row ? toSpotifySyncTrack(row) : undefined;
}

export function upsertSpotifySyncTrack(
  track: Omit<SpotifySyncTrack, "updatedAt"> & { updatedAt?: string }
): SpotifySyncTrack {
  const updatedAt = track.updatedAt ?? new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO spotify_sync_tracks (
         playlist_id, spotify_track_id, artist_name, track_name, query,
         filename, status, local_download_id, file_path, error, updated_at
       )
       VALUES (
         @playlistId, @spotifyTrackId, @artistName, @trackName, @query,
         @filename, @status, @localDownloadId, @filePath, @error, @updatedAt
       )
       ON CONFLICT(playlist_id, spotify_track_id) DO UPDATE SET
         artist_name = excluded.artist_name,
         track_name = excluded.track_name,
         query = excluded.query,
         filename = excluded.filename,
         status = excluded.status,
         local_download_id = excluded.local_download_id,
         file_path = excluded.file_path,
         error = excluded.error,
         updated_at = excluded.updated_at`
    )
    .run({
      playlistId: track.playlistId,
      spotifyTrackId: track.spotifyTrackId,
      artistName: track.artistName,
      trackName: track.trackName,
      query: track.query,
      filename: track.filename,
      status: track.status,
      localDownloadId: track.localDownloadId ?? null,
      filePath: track.filePath ?? null,
      error: track.error ?? null,
      updatedAt
    });

  return {
    ...track,
    updatedAt
  };
}

function toYouTubeHistoryEntry(row: YouTubeHistoryRow): YouTubeHistoryEntry {
  return {
    url: row.url,
    title: row.title,
    entryType: row.entry_type,
    visits: row.visits,
    lastVisitedAt: row.last_visited_at,
    downloadedAt: row.downloaded_at ?? undefined
  };
}

export function listYouTubeHistory(limit = 50): YouTubeHistoryEntry[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT url, title, entry_type, visits, last_visited_at, downloaded_at
       FROM youtube_history
       ORDER BY COALESCE(downloaded_at, last_visited_at) DESC
       LIMIT ?`
    )
    .all(limit) as YouTubeHistoryRow[];

  return rows.map(toYouTubeHistoryEntry);
}

export function recordYouTubeVisit(entry: {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
}): YouTubeHistoryEntry {
  const now = new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO youtube_history
        (url, title, entry_type, visits, last_visited_at)
       VALUES
        (@url, @title, @entryType, 1, @now)
       ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN excluded.title != '' THEN excluded.title
          ELSE youtube_history.title
        END,
        entry_type = excluded.entry_type,
        visits = youtube_history.visits + 1,
        last_visited_at = excluded.last_visited_at`
    )
    .run({
      url: entry.url,
      title: entry.title,
      entryType: entry.entryType,
      now
    });

  return getYouTubeHistoryEntry(entry.url);
}

export function markYouTubeDownloaded(entry: {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
}): YouTubeHistoryEntry {
  const now = new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO youtube_history
        (url, title, entry_type, visits, last_visited_at, downloaded_at)
       VALUES
        (@url, @title, @entryType, 1, @now, @now)
       ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN excluded.title != '' THEN excluded.title
          ELSE youtube_history.title
        END,
        entry_type = excluded.entry_type,
        downloaded_at = excluded.downloaded_at,
        last_visited_at = excluded.last_visited_at`
    )
    .run({
      url: entry.url,
      title: entry.title,
      entryType: entry.entryType,
      now
    });

  return getYouTubeHistoryEntry(entry.url);
}

function getYouTubeHistoryEntry(url: string): YouTubeHistoryEntry {
  const row = requireDatabase()
    .prepare(
      `SELECT url, title, entry_type, visits, last_visited_at, downloaded_at
       FROM youtube_history
       WHERE url = ?`
    )
    .get(url) as YouTubeHistoryRow | undefined;

  if (!row) {
    throw new Error("YouTube history entry was not found.");
  }

  return toYouTubeHistoryEntry(row);
}

function toTrainingActivity(row: TrainingActivityRow): TrainingHubActivity {
  return {
    activityId: row.activity_id,
    name: row.name ?? undefined,
    sportType: row.sport_type,
    sportName: row.sport_name ?? undefined,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    duration: row.duration ?? undefined,
    distance: row.distance ?? undefined,
    avgHr: row.avg_hr ?? undefined,
    maxHr: row.max_hr ?? undefined,
    calories: row.calories ?? undefined,
    trainingLoad: row.training_load ?? undefined,
    elevationGain: row.elevation_gain ?? undefined
  };
}

export function upsertTrainingActivities(
  activities: TrainingHubActivity[]
): void {
  if (activities.length === 0) {
    return;
  }
  const database = requireDatabase();
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO training_activities (
       activity_id, name, sport_type, sport_name, start_time, end_time,
       duration, distance, avg_hr, max_hr, calories, training_load,
       elevation_gain, synced_at
     )
     VALUES (
       @activityId, @name, @sportType, @sportName, @startTime, @endTime,
       @duration, @distance, @avgHr, @maxHr, @calories, @trainingLoad,
       @elevationGain, @syncedAt
     )
     ON CONFLICT(activity_id) DO UPDATE SET
       name = excluded.name,
       sport_type = excluded.sport_type,
       sport_name = COALESCE(excluded.sport_name, training_activities.sport_name),
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       duration = excluded.duration,
       distance = excluded.distance,
       avg_hr = excluded.avg_hr,
       max_hr = excluded.max_hr,
       calories = excluded.calories,
       training_load = excluded.training_load,
       elevation_gain = excluded.elevation_gain,
       synced_at = excluded.synced_at`
  );

  const writeAll = database.transaction((rows: TrainingHubActivity[]) => {
    for (const activity of rows) {
      if (!activity.activityId) {
        continue;
      }
      insert.run({
        activityId: activity.activityId,
        name: activity.name ?? null,
        sportType: activity.sportType,
        sportName: activity.sportName ?? null,
        startTime: activity.startTime ?? null,
        endTime: activity.endTime ?? null,
        duration: activity.duration ?? null,
        distance: activity.distance ?? null,
        avgHr: activity.avgHr ?? null,
        maxHr: activity.maxHr ?? null,
        calories: activity.calories ?? null,
        trainingLoad: activity.trainingLoad ?? null,
        elevationGain: activity.elevationGain ?? null,
        syncedAt: now
      });
    }
  });

  writeAll(activities);
}

/** Cache the COROS feeling (feelType) for one activity. 0 = rated "unrated". */
export function setTrainingActivityFeelType(
  activityId: string,
  feelType: number
): void {
  requireDatabase()
    .prepare(
      `UPDATE training_activities SET feel_type = ? WHERE activity_id = ?`
    )
    .run(feelType, activityId);
}

/**
 * The cached feeling for each of these activities, as COROS has it.
 *
 * Three states, and the screen showing them has to keep them apart: a row not
 * in the result has never been fetched, `0` means COROS was asked and the
 * athlete never rated the session, and 1..5 is the rating itself. A caller that
 * folds the first two together tells an athlete they have unrated sessions
 * before the backfill has looked.
 */
export function readTrainingActivityFeelTypes(
  activityIds: readonly string[]
): Record<string, number> {
  const feels: Record<string, number> = {};
  if (activityIds.length === 0) {
    return feels;
  }

  const db = requireDatabase();
  // Chunked: SQLite caps a statement's variables, and this is called with the
  // athlete's whole history.
  const CHUNK = 500;
  for (let index = 0; index < activityIds.length; index += CHUNK) {
    const chunk = activityIds.slice(index, index + CHUNK);
    const rows = db
      .prepare(
        `SELECT activity_id, feel_type
         FROM training_activities
         WHERE feel_type IS NOT NULL
           AND activity_id IN (${chunk.map(() => "?").join(",")})`
      )
      .all(...chunk) as { activity_id: string; feel_type: number }[];
    for (const row of rows) {
      feels[row.activity_id] = row.feel_type;
    }
  }

  return feels;
}

/**
 * Activities on/after `sinceEpochSeconds` whose feel_type has never been
 * fetched (NULL), NEWEST first — recent sessions are the most likely to be
 * rated, so they populate the heatmap soonest.
 */
export function listTrainingActivitiesMissingFeelType(
  sinceEpochSeconds: number,
  limit = 500
): { activityId: string; sportType: number }[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT activity_id, sport_type
       FROM training_activities
       WHERE feel_type IS NULL AND start_time >= ?
       ORDER BY start_time DESC
       LIMIT ?`
    )
    .all(sinceEpochSeconds, limit) as {
    activity_id: string;
    sport_type: number;
  }[];
  return rows.map((row) => ({
    activityId: row.activity_id,
    sportType: row.sport_type
  }));
}

/** How many activities in the window still need a feelType fetch. */
export function countTrainingActivitiesMissingFeelType(
  sinceEpochSeconds: number
): number {
  const row = requireDatabase()
    .prepare(
      `SELECT count(*) AS n
       FROM training_activities
       WHERE feel_type IS NULL AND start_time >= ?`
    )
    .get(sinceEpochSeconds) as { n: number };
  return row.n;
}

/** Total count of training activities on/after `sinceEpochSeconds`. */
export function countTrainingActivitiesSince(sinceEpochSeconds: number): number {
  const row = requireDatabase()
    .prepare(
      `SELECT count(*) AS n
       FROM training_activities
       WHERE start_time >= ?`
    )
    .get(sinceEpochSeconds) as { n: number };
  return row.n;
}

/** Rated activities on/after `sinceEpochSeconds`, for computing daily sRPE. */
export function listTrainingActivityRpeInputs(
  sinceEpochSeconds: number
): { startTime?: number; duration?: number; feelType?: number | null }[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT start_time, duration, feel_type
       FROM training_activities
       WHERE start_time >= ? AND feel_type IS NOT NULL AND feel_type > 0
       ORDER BY start_time ASC`
    )
    .all(sinceEpochSeconds) as {
    start_time: number | null;
    duration: number | null;
    feel_type: number | null;
  }[];
  return rows.map((row) => ({
    startTime: row.start_time ?? undefined,
    duration: row.duration ?? undefined,
    feelType: row.feel_type
  }));
}

/** One stored activity by id, as every activity list call has written it. */
export function getStoredTrainingActivity(
  activityId: string
): TrainingHubActivity | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT activity_id, name, sport_type, sport_name, start_time, end_time,
              duration, distance, avg_hr, max_hr, calories, training_load,
              elevation_gain
       FROM training_activities
       WHERE activity_id = ?`
    )
    .get(activityId) as TrainingActivityRow | undefined;

  return row ? enrichActivitiesWithSportNames([toTrainingActivity(row)])[0] : undefined;
}

/**
 * Many stored activities at once, for a caller holding a whole list of ids.
 *
 * `getStoredTrainingActivity` in a loop is a prepared statement per row, and
 * the detail-summary sweep walks the same list on every pass — a few hundred
 * runs then cost tens of thousands of statements over one sweep.
 */
export function getStoredTrainingActivities(
  activityIds: readonly string[]
): TrainingHubActivity[] {
  if (activityIds.length === 0) {
    return [];
  }

  const database = requireDatabase();
  const rows: TrainingActivityRow[] = [];
  for (let index = 0; index < activityIds.length; index += SUMMARY_QUERY_CHUNK) {
    const chunk = activityIds.slice(index, index + SUMMARY_QUERY_CHUNK);
    rows.push(
      ...(database
        .prepare(
          `SELECT activity_id, name, sport_type, sport_name, start_time, end_time,
                  duration, distance, avg_hr, max_hr, calories, training_load,
                  elevation_gain
           FROM training_activities
           WHERE activity_id IN (${chunk.map(() => "?").join(", ")})`
        )
        .all(...chunk) as TrainingActivityRow[])
    );
  }

  return enrichActivitiesWithSportNames(rows.map(toTrainingActivity));
}

/** Every activity id the local mirror holds. The detail cache uses it to tell
 *  a file worth keeping from one whose run is no longer anywhere. */
export function listStoredTrainingActivityIds(): string[] {
  const rows = requireDatabase()
    .prepare(`SELECT activity_id FROM training_activities`)
    .all() as { activity_id: string }[];
  return rows.map((row) => row.activity_id);
}

interface ActivitySummaryRow {
  activity_id: string;
  fingerprint: string;
  summary_version: number;
  zone_seconds: string | null;
  decoupling_percent: number | null;
  last_upload_time: number | null;
  computed_at: number;
}

function toActivityDetailSummary(row: ActivitySummaryRow): ActivityDetailSummary {
  let zoneSeconds: number[] | undefined;
  if (row.zone_seconds) {
    try {
      const parsed: unknown = JSON.parse(row.zone_seconds);
      if (
        Array.isArray(parsed) &&
        parsed.every((value) => typeof value === "number")
      ) {
        zoneSeconds = parsed as number[];
      }
    } catch {
      // A row this old or this broken is worth exactly as much as none.
    }
  }

  return {
    activityId: row.activity_id,
    fingerprint: row.fingerprint,
    summaryVersion: row.summary_version,
    ...(zoneSeconds ? { zoneSeconds } : {}),
    ...(row.decoupling_percent === null
      ? {}
      : { decouplingPercent: row.decoupling_percent }),
    ...(row.last_upload_time === null
      ? {}
      : { lastUploadTime: row.last_upload_time }),
    computedAt: row.computed_at
  };
}

/** SQLite binds at most 999 parameters per statement. */
const SUMMARY_QUERY_CHUNK = 500;

/**
 * Stored summaries for these activities, in no particular order and missing
 * whichever have none. Says nothing about whether they are still valid — the
 * fingerprint travels with each row and the caller checks it.
 */
export function getActivityDetailSummaries(
  activityIds: readonly string[]
): ActivityDetailSummary[] {
  if (activityIds.length === 0) {
    return [];
  }

  const database = requireDatabase();
  const found: ActivityDetailSummary[] = [];
  for (let index = 0; index < activityIds.length; index += SUMMARY_QUERY_CHUNK) {
    const chunk = activityIds.slice(index, index + SUMMARY_QUERY_CHUNK);
    const rows = database
      .prepare(
        `SELECT activity_id, fingerprint, summary_version, zone_seconds,
                decoupling_percent, last_upload_time, computed_at
         FROM training_activity_summaries
         WHERE activity_id IN (${chunk.map(() => "?").join(", ")})`
      )
      .all(...chunk) as ActivitySummaryRow[];
    for (const row of rows) {
      found.push(toActivityDetailSummary(row));
    }
  }

  return found;
}

export function upsertActivityDetailSummary(
  summary: ActivityDetailSummary
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO training_activity_summaries (
         activity_id, fingerprint, summary_version, zone_seconds,
         decoupling_percent, last_upload_time, computed_at
       )
       VALUES (@activityId, @fingerprint, @summaryVersion, @zoneSeconds,
               @decouplingPercent, @lastUploadTime, @computedAt)
       ON CONFLICT(activity_id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         summary_version = excluded.summary_version,
         zone_seconds = excluded.zone_seconds,
         decoupling_percent = excluded.decoupling_percent,
         last_upload_time = excluded.last_upload_time,
         computed_at = excluded.computed_at`
    )
    .run({
      activityId: summary.activityId,
      fingerprint: summary.fingerprint,
      summaryVersion: summary.summaryVersion,
      zoneSeconds: summary.zoneSeconds
        ? JSON.stringify(summary.zoneSeconds)
        : null,
      decouplingPercent: summary.decouplingPercent ?? null,
      lastUploadTime: summary.lastUploadTime ?? null,
      computedAt: summary.computedAt
    });
}

/**
 * Cache the parsed set-by-set breakdown of one strength activity. A session
 * with no breakdown (a gym-cardio activity, or a watch that recorded no
 * exercise laps) is stored with a NULL payload so it is never refetched.
 */
export function upsertStrengthSessionDetail(
  activityId: string,
  sportType: number,
  detail: StrengthDetail | undefined
): void {
  if (!activityId) {
    return;
  }
  requireDatabase()
    .prepare(
      `INSERT INTO strength_sessions (activity_id, sport_type, detail_json, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET
         sport_type = excluded.sport_type,
         detail_json = excluded.detail_json,
         fetched_at = excluded.fetched_at`
    )
    .run(
      activityId,
      sportType,
      detail ? JSON.stringify(detail) : null,
      new Date().toISOString()
    );
}

function sportTypePlaceholders(sportTypes: number[]): string {
  return sportTypes.map(() => "?").join(", ");
}

/**
 * Strength activities on/after `sinceEpochSeconds` that have never had their
 * breakdown fetched, NEWEST first so the most relevant sessions land first.
 */
export function listStrengthActivitiesMissingDetail(
  sinceEpochSeconds: number,
  sportTypes: number[],
  limit = 200
): { activityId: string; sportType: number }[] {
  if (sportTypes.length === 0) {
    return [];
  }
  const rows = requireDatabase()
    .prepare(
      `SELECT a.activity_id, a.sport_type
       FROM training_activities a
       LEFT JOIN strength_sessions s ON s.activity_id = a.activity_id
       WHERE s.activity_id IS NULL
         AND a.start_time >= ?
         AND a.sport_type IN (${sportTypePlaceholders(sportTypes)})
       ORDER BY a.start_time DESC
       LIMIT ?`
    )
    .all(sinceEpochSeconds, ...sportTypes, limit) as {
    activity_id: string;
    sport_type: number;
  }[];
  return rows.map((row) => ({
    activityId: row.activity_id,
    sportType: row.sport_type
  }));
}

/** How many strength activities in the window still need a breakdown fetch. */
export function countStrengthActivitiesMissingDetail(
  sinceEpochSeconds: number,
  sportTypes: number[]
): number {
  if (sportTypes.length === 0) {
    return 0;
  }
  const row = requireDatabase()
    .prepare(
      `SELECT count(*) AS n
       FROM training_activities a
       LEFT JOIN strength_sessions s ON s.activity_id = a.activity_id
       WHERE s.activity_id IS NULL
         AND a.start_time >= ?
         AND a.sport_type IN (${sportTypePlaceholders(sportTypes)})`
    )
    .get(sinceEpochSeconds, ...sportTypes) as { n: number };
  return row.n;
}

/**
 * Cached strength sessions on/after `sinceEpochSeconds`, joined with their
 * activity metadata. Rows cached with no breakdown are skipped.
 */
export function listStoredStrengthSessions(
  sinceEpochSeconds: number
): StrengthSession[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT s.activity_id, s.sport_type, s.detail_json,
              a.name, a.sport_name, a.start_time, a.duration, a.calories,
              a.avg_hr, a.max_hr, a.training_load
       FROM strength_sessions s
       JOIN training_activities a ON a.activity_id = s.activity_id
       WHERE s.detail_json IS NOT NULL AND a.start_time >= ?
       ORDER BY a.start_time DESC`
    )
    .all(sinceEpochSeconds) as {
    activity_id: string;
    sport_type: number;
    detail_json: string;
    name: string | null;
    sport_name: string | null;
    start_time: number | null;
    duration: number | null;
    calories: number | null;
    avg_hr: number | null;
    max_hr: number | null;
    training_load: number | null;
  }[];

  const sessions: StrengthSession[] = [];
  for (const row of rows) {
    let detail: StrengthDetail;
    try {
      detail = JSON.parse(row.detail_json) as StrengthDetail;
    } catch {
      // A corrupt payload should never take the whole history down.
      continue;
    }
    if (!Array.isArray(detail?.exercises) || detail.exercises.length === 0) {
      continue;
    }
    sessions.push({
      activityId: row.activity_id,
      source: "coros",
      sourceIds: { coros: row.activity_id },
      sportType: row.sport_type,
      name: row.name ?? undefined,
      sportName: row.sport_name ?? undefined,
      startTime: row.start_time ?? undefined,
      duration: row.duration ?? undefined,
      calories: row.calories ?? undefined,
      avgHr: row.avg_hr ?? undefined,
      maxHr: row.max_hr ?? undefined,
      trainingLoad: row.training_load ?? undefined,
      detail
    });
  }
  return sessions;
}

export interface StoredHevyWorkout {
  workoutId: string;
  startTime: number;
  updatedAt?: string;
  payload: Record<string, unknown>;
}

/** Persist the provider payload so settings can re-normalize it without I/O. */
export function upsertHevyWorkout(
  workoutId: string,
  startTime: number,
  updatedAt: string | undefined,
  payload: Record<string, unknown>
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO hevy_workouts
         (workout_id, start_time, updated_at, payload_json, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workout_id) DO UPDATE SET
         start_time = excluded.start_time,
         updated_at = excluded.updated_at,
         payload_json = excluded.payload_json,
         synced_at = excluded.synced_at`
    )
    .run(
      workoutId,
      startTime,
      updatedAt ?? null,
      JSON.stringify(payload),
      new Date().toISOString()
    );
}

export function deleteHevyWorkout(workoutId: string): void {
  requireDatabase().prepare("DELETE FROM hevy_workouts WHERE workout_id = ?").run(workoutId);
}

export function listStoredHevyWorkouts(sinceEpochSeconds: number): StoredHevyWorkout[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT workout_id, start_time, updated_at, payload_json
       FROM hevy_workouts
       WHERE start_time >= ?
       ORDER BY start_time DESC`
    )
    .all(sinceEpochSeconds) as Array<{
    workout_id: string;
    start_time: number;
    updated_at: string | null;
    payload_json: string;
  }>;

  const workouts: StoredHevyWorkout[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as unknown;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        continue;
      }
      workouts.push({
        workoutId: row.workout_id,
        startTime: row.start_time,
        updatedAt: row.updated_at ?? undefined,
        payload: payload as Record<string, unknown>
      });
    } catch {
      // A single corrupt cache entry must not hide the rest of the history.
    }
  }
  return workouts;
}

/** Remove stale rows in a fully reconciled history window. */
export function reconcileHevyWorkoutIds(
  sinceEpochSeconds: number,
  retainedIds: Set<string>
): void {
  const database = requireDatabase();
  const rows = database
    .prepare("SELECT workout_id FROM hevy_workouts WHERE start_time >= ?")
    .all(sinceEpochSeconds) as Array<{ workout_id: string }>;
  const remove = database.prepare("DELETE FROM hevy_workouts WHERE workout_id = ?");
  const transaction = database.transaction(() => {
    for (const row of rows) {
      if (!retainedIds.has(row.workout_id)) {
        remove.run(row.workout_id);
      }
    }
  });
  transaction();
}

export function upsertHevyExerciseTemplate(
  templateId: string,
  payload: Record<string, unknown>
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO hevy_exercise_templates (template_id, payload_json, synced_at)
       VALUES (?, ?, ?)
       ON CONFLICT(template_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         synced_at = excluded.synced_at`
    )
    .run(templateId, JSON.stringify(payload), new Date().toISOString());
}

export function listStoredHevyExerciseTemplates(): Map<string, Record<string, unknown>> {
  const rows = requireDatabase()
    .prepare("SELECT template_id, payload_json FROM hevy_exercise_templates")
    .all() as Array<{ template_id: string; payload_json: string }>;
  const templates = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as unknown;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        templates.set(row.template_id, payload as Record<string, unknown>);
      }
    } catch {
      // Ignore corrupt template rows; title-based analytics still work.
    }
  }
  return templates;
}

export function clearHevyCache(): void {
  const database = requireDatabase();
  database.transaction(() => {
    database.prepare("DELETE FROM hevy_workouts").run();
    database.prepare("DELETE FROM hevy_exercise_templates").run();
  })();
}

interface ChatPlanDraftRow {
  draft_id: string;
  plan_json: string;
  preview_json: string;
  created_at: number;
  uploaded_at: number | null;
  artifact_id: string | null;
  version: number | null;
  parent_draft_id: string | null;
  author: string | null;
  document_json: string | null;
  change_summary: string | null;
  refinements_json: string | null;
}

export type ChatPlanDraftAuthor = "coach" | "athlete" | "coros";

export interface StoredChatPlanDraftRecord {
  draftId: string;
  planJson: string;
  previewJson: string;
  createdAt: number;
  uploadedAt?: number;
  /** The creation this is a version of; a row written before versions is its own. */
  artifactId?: string;
  version?: number;
  parentDraftId?: string;
  author?: ChatPlanDraftAuthor;
  documentJson?: string;
  /** What this version changed, in its author's words. */
  changeSummary?: string;
  /** The follow-ups Coach offered with this version, as JSON (P1.8). */
  refinementsJson?: string;
}

const CHAT_PLAN_DRAFT_COLUMNS =
  "draft_id, plan_json, preview_json, created_at, uploaded_at, artifact_id, version, parent_draft_id, author, document_json, change_summary, refinements_json";

function chatPlanDraftRecord(row: ChatPlanDraftRow): StoredChatPlanDraftRecord {
  return {
    draftId: row.draft_id,
    planJson: row.plan_json,
    previewJson: row.preview_json,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at ?? undefined,
    ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
    ...(row.version ? { version: row.version } : {}),
    ...(row.parent_draft_id ? { parentDraftId: row.parent_draft_id } : {}),
    ...(row.author === "coach" || row.author === "athlete" || row.author === "coros"
      ? { author: row.author }
      : {}),
    ...(row.document_json ? { documentJson: row.document_json } : {}),
    ...(row.change_summary ? { changeSummary: row.change_summary } : {}),
    ...(row.refinements_json ? { refinementsJson: row.refinements_json } : {})
  };
}

export function saveChatPlanDraft(record: StoredChatPlanDraftRecord): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_plan_drafts (${CHAT_PLAN_DRAFT_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(draft_id) DO UPDATE SET
         plan_json = excluded.plan_json,
         preview_json = excluded.preview_json,
         created_at = excluded.created_at,
         uploaded_at = excluded.uploaded_at,
         artifact_id = excluded.artifact_id,
         version = excluded.version,
         parent_draft_id = excluded.parent_draft_id,
         author = excluded.author,
         document_json = excluded.document_json,
         change_summary = excluded.change_summary,
         refinements_json = excluded.refinements_json`
    )
    .run(
      record.draftId,
      record.planJson,
      record.previewJson,
      record.createdAt,
      record.uploadedAt ?? null,
      record.artifactId ?? null,
      record.version ?? null,
      record.parentDraftId ?? null,
      record.author ?? null,
      record.documentJson ?? null,
      record.changeSummary ?? null,
      record.refinementsJson ?? null
    );
  notifySyncedRow("chat_plan_drafts", ["draft_id"], [record.draftId]);
}

export function getChatPlanDraft(
  draftId: string
): StoredChatPlanDraftRecord | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT ${CHAT_PLAN_DRAFT_COLUMNS}
       FROM chat_plan_drafts
       WHERE draft_id = ?`
    )
    .get(draftId) as ChatPlanDraftRow | undefined;

  return row ? chatPlanDraftRecord(row) : undefined;
}

/**
 * Every version of the creation a draft belongs to, oldest first. A row from
 * before versions has no `artifact_id` and is the one version of itself.
 */
export function listChatPlanDraftVersions(artifactId: string): StoredChatPlanDraftRecord[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT ${CHAT_PLAN_DRAFT_COLUMNS}
       FROM chat_plan_drafts
       WHERE artifact_id = ? OR (artifact_id IS NULL AND draft_id = ?)
       ORDER BY COALESCE(version, 1), created_at`
    )
    .all(artifactId, artifactId) as ChatPlanDraftRow[];
  return rows.map(chatPlanDraftRecord);
}

/**
 * The conversation holding any of these drafts' cards, the most recent first
 * (P1.7). A card carries its draft id in the transcript, so this is a text
 * search, bounded by the ids being quoted.
 */
export function findChatSessionMentioning(draftIds: readonly string[]): string | undefined {
  const statement = requireDatabase().prepare(
    `SELECT id FROM chat_sessions WHERE instr(messages_json, ?) > 0 ORDER BY updated_at DESC LIMIT 1`
  );
  for (const draftId of draftIds) {
    const row = statement.get(`"draftId":"${draftId}"`) as { id: string } | undefined;
    if (row) return row.id;
  }
  return undefined;
}

export function listChatPlanDrafts(): StoredChatPlanDraftRecord[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT ${CHAT_PLAN_DRAFT_COLUMNS}
       FROM chat_plan_drafts
       ORDER BY created_at DESC`
    )
    .all() as ChatPlanDraftRow[];

  return rows.map(chatPlanDraftRecord);
}

export function markChatPlanDraftUploaded(
  draftId: string,
  uploadedAt: number
): void {
  requireDatabase()
    .prepare(
      `UPDATE chat_plan_drafts
       SET uploaded_at = ?
       WHERE draft_id = ?`
    )
    .run(uploadedAt, draftId);
  notifySyncedRow("chat_plan_drafts", ["draft_id"], [draftId]);
}

/** A conversation's own settings (P2.0), as stored; absent is Coach's for everything. */
export function getChatConversationSettingsRow(
  sessionId: string
): { sourcesJson?: string; runtimeJson?: string } | undefined {
  const row = requireDatabase()
    .prepare("SELECT sources_json, runtime_json FROM chat_conversation_settings WHERE session_id = ?")
    .get(sessionId) as { sources_json: string | null; runtime_json: string | null } | undefined;
  if (!row) return undefined;
  return {
    ...(row.sources_json ? { sourcesJson: row.sources_json } : {}),
    ...(row.runtime_json ? { runtimeJson: row.runtime_json } : {})
  };
}

export function saveChatConversationSettingsRow(
  sessionId: string,
  sourcesJson: string | null,
  runtimeJson: string | null
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_conversation_settings (session_id, sources_json, runtime_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         sources_json = excluded.sources_json,
         runtime_json = excluded.runtime_json,
         updated_at = excluded.updated_at`
    )
    .run(sessionId, sourcesJson, runtimeJson, new Date().toISOString());
  notifySyncedRow("chat_conversation_settings", ["session_id"], [sessionId]);
}

interface ChatScheduleChangeRow {
  change_set_id: string;
  session_id: string | null;
  summary: string;
  lines_json: string;
  created_at: string;
  updated_at: string;
}

/** A change set as stored; its lines are parsed by `chatScheduleChanges`. */
export interface StoredChatScheduleChange {
  changeSetId: string;
  sessionId?: string;
  summary: string;
  linesJson: string;
  createdAt: string;
  updatedAt: string;
}

function chatScheduleChangeRecord(row: ChatScheduleChangeRow): StoredChatScheduleChange {
  return {
    changeSetId: row.change_set_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    summary: row.summary,
    linesJson: row.lines_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getChatScheduleChanges(changeSetIds: readonly string[]): StoredChatScheduleChange[] {
  if (!changeSetIds.length) return [];
  const rows = requireDatabase()
    .prepare(
      `SELECT * FROM chat_schedule_changes WHERE change_set_id IN (${changeSetIds.map(() => "?").join(", ")})`
    )
    .all(...changeSetIds) as ChatScheduleChangeRow[];
  return rows.map(chatScheduleChangeRecord);
}

export function saveChatScheduleChange(record: StoredChatScheduleChange): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_schedule_changes (change_set_id, session_id, summary, lines_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(change_set_id) DO UPDATE SET
         session_id = excluded.session_id,
         summary = excluded.summary,
         lines_json = excluded.lines_json,
         updated_at = excluded.updated_at`
    )
    .run(
      record.changeSetId,
      record.sessionId ?? null,
      record.summary,
      record.linesJson,
      record.createdAt,
      record.updatedAt
    );
  notifySyncedRow("chat_schedule_changes", ["change_set_id"], [record.changeSetId]);
}

/** A conversation's change sets go with it. */
export function deleteChatScheduleChangesOf(sessionId: string): void {
  const database = requireDatabase();
  const ids = database
    .prepare("SELECT change_set_id FROM chat_schedule_changes WHERE session_id = ?")
    .all(sessionId) as Array<{ change_set_id: string }>;
  const drop = database.prepare("DELETE FROM chat_schedule_changes WHERE change_set_id = ?");
  for (const { change_set_id: id } of ids) {
    if (drop.run(id).changes > 0) notifySyncedDelete("chat_schedule_changes", id);
  }
}

export function deleteChatConversationSettingsRow(sessionId: string): void {
  const result = requireDatabase()
    .prepare("DELETE FROM chat_conversation_settings WHERE session_id = ?")
    .run(sessionId);
  if (result.changes > 0) notifySyncedDelete("chat_conversation_settings", sessionId);
}

/**
 * What a Coach creation holds before and beside its versions
 * (docs/coach-plan-canvas.md §7, P2): its brief, its outline, and the dates
 * they give it. Nothing that can be read off a version — its name, whether it
 * is saved — is kept here.
 */
export interface ChatPlanArtifactRow {
  artifactId: string;
  sessionId?: string;
  kind: "plan" | "workout";
  startMonday?: string;
  raceDay?: string;
  briefJson?: string;
  outlineJson?: string;
  outlineVersion?: number;
  createdAt: string;
  updatedAt: string;
}

interface StoredChatPlanArtifactRow {
  artifact_id: string;
  session_id: string | null;
  kind: string;
  start_monday: string | null;
  race_day: string | null;
  brief_json: string | null;
  outline_json: string | null;
  outline_version: number | null;
  created_at: string;
  updated_at: string;
}

function chatPlanArtifactFromRow(row: StoredChatPlanArtifactRow): ChatPlanArtifactRow {
  return {
    artifactId: row.artifact_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    kind: row.kind === "workout" ? "workout" : "plan",
    ...(row.start_monday ? { startMonday: row.start_monday } : {}),
    ...(row.race_day ? { raceDay: row.race_day } : {}),
    ...(row.brief_json ? { briefJson: row.brief_json } : {}),
    ...(row.outline_json ? { outlineJson: row.outline_json } : {}),
    ...(typeof row.outline_version === "number" ? { outlineVersion: row.outline_version } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getChatPlanArtifactRow(artifactId: string): ChatPlanArtifactRow | undefined {
  const row = requireDatabase()
    .prepare("SELECT * FROM chat_plan_artifacts WHERE artifact_id = ?")
    .get(artifactId) as StoredChatPlanArtifactRow | undefined;
  return row ? chatPlanArtifactFromRow(row) : undefined;
}

export function listChatPlanArtifactRows(artifactIds: readonly string[]): ChatPlanArtifactRow[] {
  if (artifactIds.length === 0) return [];
  const rows = requireDatabase()
    .prepare(
      `SELECT * FROM chat_plan_artifacts WHERE artifact_id IN (${artifactIds.map(() => "?").join(", ")})`
    )
    .all(...artifactIds) as StoredChatPlanArtifactRow[];
  return rows.map(chatPlanArtifactFromRow);
}

export function saveChatPlanArtifactRow(row: ChatPlanArtifactRow): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_plan_artifacts
         (artifact_id, session_id, kind, start_monday, race_day, brief_json, outline_json, outline_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(artifact_id) DO UPDATE SET
         session_id = excluded.session_id,
         kind = excluded.kind,
         start_monday = excluded.start_monday,
         race_day = excluded.race_day,
         brief_json = excluded.brief_json,
         outline_json = excluded.outline_json,
         outline_version = excluded.outline_version,
         updated_at = excluded.updated_at`
    )
    .run(
      row.artifactId,
      row.sessionId ?? null,
      row.kind,
      row.startMonday ?? null,
      row.raceDay ?? null,
      row.briefJson ?? null,
      row.outlineJson ?? null,
      row.outlineVersion ?? null,
      row.createdAt,
      row.updatedAt
    );
  notifySyncedRow("chat_plan_artifacts", ["artifact_id"], [row.artifactId]);
}

export function deleteChatPlanArtifactRow(artifactId: string): void {
  const result = requireDatabase()
    .prepare("DELETE FROM chat_plan_artifacts WHERE artifact_id = ?")
    .run(artifactId);
  if (result.changes > 0) notifySyncedDelete("chat_plan_artifacts", artifactId);
}

export function deleteChatPlanDraft(draftId: string): void {
  requireDatabase()
    .prepare("DELETE FROM chat_plan_drafts WHERE draft_id = ?")
    .run(draftId);
  notifySyncedDelete("chat_plan_drafts", draftId);
}

interface TrainingWorkoutMetadataRow {
  program_id: string;
  favorite: number;
  tags_json: string;
  source: TrainingWorkoutMetadata["source"];
  sync_state: TrainingWorkoutMetadata["syncState"];
  last_used_at: string | null;
  last_synced_at: string | null;
  cached_version: string | null;
}

interface TrainingActivityMatchRow {
  id: string;
  plan_id: string | null;
  plan_entry_id: string | null;
  schedule_plan_id: string;
  schedule_id_in_plan: string;
  activity_id: string | null;
  happen_day: string;
  status: TrainingActivityMatch["status"];
  confidence: number | null;
  manual: number;
  planned_duration_seconds: number | null;
  completed_duration_seconds: number | null;
  planned_distance_meters: number | null;
  completed_distance_meters: number | null;
  planned_training_load: number | null;
  completed_training_load: number | null;
  updated_at: string;
}

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * A plan document read back off disk, or nothing.
 *
 * Drafts sync between machines and the cache outlives builds, so a document can
 * arrive in a shape this build did not write. Anything missing the fields the
 * library cannot draw without is dropped rather than drawn wrong.
 */
function parsePlanDocument(json: string): TrainingPlanDocument | undefined {
  const plan = parseStoredJson<TrainingPlanDocument | undefined>(json, undefined);
  if (!plan || typeof plan.id !== "string" || !Array.isArray(plan.entries)) return undefined;
  return {
    ...plan,
    weekStages: Array.isArray(plan.weekStages) ? plan.weekStages : [],
    tags: Array.isArray(plan.tags) ? plan.tags : [],
    calendar: plan.calendar ?? "unscheduled"
  };
}

interface CorosPlanCacheRow {
  remote_id: string;
  document_json: string;
}

export function listCorosPlanCache(): TrainingPlanDocument[] {
  const rows = requireDatabase()
    .prepare("SELECT remote_id, document_json FROM coros_plan_cache")
    .all() as CorosPlanCacheRow[];
  return rows
    .map((row) => parsePlanDocument(row.document_json))
    .filter((plan): plan is TrainingPlanDocument => Boolean(plan));
}

export function getCorosPlanCache(remoteId: string): TrainingPlanDocument | undefined {
  const row = requireDatabase()
    .prepare("SELECT remote_id, document_json FROM coros_plan_cache WHERE remote_id = ?")
    .get(remoteId) as CorosPlanCacheRow | undefined;
  return row ? parsePlanDocument(row.document_json) : undefined;
}

/**
 * The running copy of a plan as the last snapshot cached it — the join
 * `linkRunningInstances` makes over the whole list, asked for one plan
 * without parsing every document in the cache.
 */
export function findCachedRunningCorosPlan(sourceRemoteId: string): string | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT remote_id FROM coros_plan_cache
        WHERE json_extract(document_json, '$.calendar') = 'running'
          AND json_extract(document_json, '$.sourcePlanId') = ?
        LIMIT 1`
    )
    .get(sourceRemoteId) as { remote_id: string } | undefined;
  return row?.remote_id;
}

/**
 * One plan as COROS last answered for it, as the library draws it. `device`
 * tier: never synced. Only the document is kept — every write reads the plan
 * from COROS again first, so COROS's own payload would be a copy nothing reads.
 */
export function saveCorosPlanCache(document: TrainingPlanDocument): void {
  if (!document.remoteId) throw new Error("Only a plan on COROS is cached.");
  requireDatabase()
    .prepare(
      `INSERT INTO coros_plan_cache (remote_id, document_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(remote_id) DO UPDATE SET
         document_json = excluded.document_json,
         fetched_at = excluded.fetched_at`
    )
    .run(document.remoteId, JSON.stringify(document), new Date().toISOString());
}

/** The whole cache becomes this list: a plan COROS no longer lists is gone. */
export function replaceCorosPlanCache(plans: readonly TrainingPlanDocument[]): void {
  const database = requireDatabase();
  database.transaction(() => {
    const keep = new Set(plans.map((plan) => plan.remoteId));
    const present = database.prepare("SELECT remote_id FROM coros_plan_cache").all() as Array<{ remote_id: string }>;
    const drop = database.prepare("DELETE FROM coros_plan_cache WHERE remote_id = ?");
    for (const row of present) if (!keep.has(row.remote_id)) drop.run(row.remote_id);
    for (const plan of plans) saveCorosPlanCache(plan);
  })();
}

export function deleteCorosPlanCache(remoteId: string): void {
  requireDatabase().prepare("DELETE FROM coros_plan_cache WHERE remote_id = ?").run(remoteId);
}

interface TrainingPlanMetadataRow {
  plan_id: string;
  favorite: number;
  tags_json: string;
  archived: number;
  origin: string | null;
  coach_json: string | null;
  updated_at: string;
}

function planMetadataFromRow(row: TrainingPlanMetadataRow): TrainingPlanMetadata {
  return {
    planId: row.plan_id,
    favorite: row.favorite === 1,
    tags: parseStoredJson<string[]>(row.tags_json, []),
    archived: row.archived === 1,
    origin: row.origin === "coach" || row.origin === "user" ? row.origin : undefined,
    coach: row.coach_json ? parseStoredJson(row.coach_json, undefined) : undefined,
    updatedAt: row.updated_at
  };
}

export function listTrainingPlanMetadata(): TrainingPlanMetadata[] {
  return (
    requireDatabase()
      .prepare(
        `SELECT plan_id, favorite, tags_json, archived, origin, coach_json, updated_at
         FROM training_plan_metadata`
      )
      .all() as TrainingPlanMetadataRow[]
  ).map(planMetadataFromRow);
}

export function getTrainingPlanMetadata(planId: string): TrainingPlanMetadata | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT plan_id, favorite, tags_json, archived, origin, coach_json, updated_at
       FROM training_plan_metadata WHERE plan_id = ?`
    )
    .get(planId) as TrainingPlanMetadataRow | undefined;
  return row ? planMetadataFromRow(row) : undefined;
}

export function saveTrainingPlanMetadata(metadata: TrainingPlanMetadata): void {
  requireDatabase()
    .prepare(
      `INSERT INTO training_plan_metadata
         (plan_id, favorite, tags_json, archived, origin, coach_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plan_id) DO UPDATE SET
         favorite = excluded.favorite,
         tags_json = excluded.tags_json,
         archived = excluded.archived,
         origin = excluded.origin,
         coach_json = excluded.coach_json,
         updated_at = excluded.updated_at`
    )
    .run(
      metadata.planId,
      metadata.favorite ? 1 : 0,
      JSON.stringify(metadata.tags),
      metadata.archived ? 1 : 0,
      metadata.origin ?? null,
      metadata.coach ? JSON.stringify(metadata.coach) : null,
      metadata.updatedAt
    );
  notifySyncedRow("training_plan_metadata", ["plan_id"], [metadata.planId]);
}

export function deleteTrainingPlanMetadata(planId: string): void {
  const result = requireDatabase()
    .prepare("DELETE FROM training_plan_metadata WHERE plan_id = ?")
    .run(planId);
  if (result.changes) notifySyncedDelete("training_plan_metadata", planId);
}

interface TrainingPlanDraftRow {
  id: string;
  base_remote_id: string | null;
  base_version: number | null;
  plan_json: string;
  saved_at: string;
}

function planDraftFromRow(row: TrainingPlanDraftRow): TrainingPlanDraftRecord | undefined {
  const plan = parsePlanDocument(row.plan_json);
  if (!plan) return undefined;
  return {
    id: row.id,
    baseRemoteId: row.base_remote_id ?? undefined,
    baseVersion: row.base_version ?? undefined,
    plan,
    savedAt: row.saved_at
  };
}

export function listTrainingPlanDrafts(): TrainingPlanDraftRecord[] {
  return (
    requireDatabase()
      .prepare(
        `SELECT id, base_remote_id, base_version, plan_json, saved_at
         FROM training_plan_drafts ORDER BY saved_at DESC`
      )
      .all() as TrainingPlanDraftRow[]
  )
    .map(planDraftFromRow)
    .filter((draft): draft is TrainingPlanDraftRecord => Boolean(draft));
}

export function getTrainingPlanDraft(id: string): TrainingPlanDraftRecord | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, base_remote_id, base_version, plan_json, saved_at
       FROM training_plan_drafts WHERE id = ?`
    )
    .get(id) as TrainingPlanDraftRow | undefined;
  return row ? planDraftFromRow(row) : undefined;
}

export function saveTrainingPlanDraft(draft: TrainingPlanDraftRecord): void {
  requireDatabase()
    .prepare(
      `INSERT INTO training_plan_drafts (id, base_remote_id, base_version, plan_json, saved_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         base_remote_id = excluded.base_remote_id,
         base_version = excluded.base_version,
         plan_json = excluded.plan_json,
         saved_at = excluded.saved_at`
    )
    .run(
      draft.id,
      draft.baseRemoteId ?? null,
      draft.baseVersion ?? null,
      JSON.stringify(draft.plan),
      draft.savedAt
    );
  notifySyncedRow("training_plan_drafts", ["id"], [draft.id]);
}

export function deleteTrainingPlanDraft(id: string): void {
  const result = requireDatabase()
    .prepare("DELETE FROM training_plan_drafts WHERE id = ?")
    .run(id);
  if (result.changes) notifySyncedDelete("training_plan_drafts", id);
}

export function listTrainingWorkoutMetadata(): TrainingWorkoutMetadata[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT program_id, favorite, tags_json, source, sync_state,
              last_used_at, last_synced_at, cached_version
       FROM training_workout_metadata`
    )
    .all() as TrainingWorkoutMetadataRow[];
  return rows.map((row) => ({
    programId: row.program_id,
    favorite: Boolean(row.favorite),
    tags: parseStoredJson<string[]>(row.tags_json, []),
    source: row.source,
    syncState: row.sync_state,
    lastUsedAt: row.last_used_at ?? undefined,
    lastSyncedAt: row.last_synced_at ?? undefined,
    cachedVersion: row.cached_version ?? undefined
  }));
}

export function listCachedTrainingLibraryWorkouts(): TrainingHubLibraryWorkout[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT cached_payload_json
       FROM training_workout_metadata
       WHERE cached_payload_json IS NOT NULL`
    )
    .all() as Array<{ cached_payload_json: string }>;
  return rows
    .map((row) =>
      parseStoredJson<TrainingHubLibraryWorkout | undefined>(
        row.cached_payload_json,
        undefined
      )
    )
    .filter((item): item is TrainingHubLibraryWorkout => Boolean(item?.id));
}

export function saveTrainingWorkoutMetadata(
  metadata: TrainingWorkoutMetadata,
  cachedPayload?: Record<string, unknown>
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO training_workout_metadata (
         program_id, favorite, tags_json, source, sync_state,
         last_used_at, last_synced_at, cached_version, cached_payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(program_id) DO UPDATE SET
         favorite = excluded.favorite,
         tags_json = excluded.tags_json,
         source = excluded.source,
         sync_state = excluded.sync_state,
         last_used_at = excluded.last_used_at,
         last_synced_at = excluded.last_synced_at,
         cached_version = excluded.cached_version,
         cached_payload_json = COALESCE(excluded.cached_payload_json, training_workout_metadata.cached_payload_json)`
    )
    .run(
      metadata.programId,
      metadata.favorite ? 1 : 0,
      JSON.stringify(metadata.tags),
      metadata.source,
      metadata.syncState,
      metadata.lastUsedAt ?? null,
      metadata.lastSyncedAt ?? null,
      metadata.cachedVersion ?? null,
      cachedPayload ? JSON.stringify(cachedPayload) : null
    );
  notifySyncedRow(
    "training_workout_metadata",
    ["program_id"],
    [metadata.programId]
  );
}

function toTrainingActivityMatch(row: TrainingActivityMatchRow): TrainingActivityMatch {
  return {
    id: row.id,
    planId: row.plan_id ?? undefined,
    planEntryId: row.plan_entry_id ?? undefined,
    schedulePlanId: row.schedule_plan_id,
    scheduleIdInPlan: row.schedule_id_in_plan,
    activityId: row.activity_id ?? undefined,
    happenDay: row.happen_day,
    status: row.status,
    confidence: row.confidence ?? undefined,
    manual: Boolean(row.manual),
    plannedDurationSeconds: row.planned_duration_seconds ?? undefined,
    completedDurationSeconds: row.completed_duration_seconds ?? undefined,
    plannedDistanceMeters: row.planned_distance_meters ?? undefined,
    completedDistanceMeters: row.completed_distance_meters ?? undefined,
    plannedTrainingLoad: row.planned_training_load ?? undefined,
    completedTrainingLoad: row.completed_training_load ?? undefined,
    updatedAt: row.updated_at
  };
}

export function listTrainingActivityMatches(): TrainingActivityMatch[] {
  return (
    requireDatabase()
      .prepare(
        `SELECT id, plan_id, plan_entry_id, schedule_plan_id, schedule_id_in_plan,
                activity_id, happen_day, status, confidence, manual,
                planned_duration_seconds, completed_duration_seconds,
                planned_distance_meters, completed_distance_meters,
                planned_training_load, completed_training_load, updated_at
         FROM training_activity_matches
         ORDER BY happen_day DESC`
      )
      .all() as TrainingActivityMatchRow[]
  ).map(toTrainingActivityMatch);
}

export function saveTrainingActivityMatch(match: TrainingActivityMatch): void {
  requireDatabase()
    .prepare(
      `INSERT INTO training_activity_matches (
         id, plan_id, plan_entry_id, schedule_plan_id, schedule_id_in_plan,
         activity_id, happen_day, status, confidence, manual,
         planned_duration_seconds, completed_duration_seconds,
         planned_distance_meters, completed_distance_meters,
         planned_training_load, completed_training_load, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         plan_id = excluded.plan_id,
         plan_entry_id = excluded.plan_entry_id,
         activity_id = excluded.activity_id,
         happen_day = excluded.happen_day,
         status = excluded.status,
         confidence = excluded.confidence,
         manual = excluded.manual,
         completed_duration_seconds = excluded.completed_duration_seconds,
         completed_distance_meters = excluded.completed_distance_meters,
         completed_training_load = excluded.completed_training_load,
         updated_at = excluded.updated_at`
    )
    .run(
      match.id,
      match.planId ?? null,
      match.planEntryId ?? null,
      match.schedulePlanId,
      match.scheduleIdInPlan,
      match.activityId ?? null,
      match.happenDay,
      match.status,
      match.confidence ?? null,
      match.manual ? 1 : 0,
      match.plannedDurationSeconds ?? null,
      match.completedDurationSeconds ?? null,
      match.plannedDistanceMeters ?? null,
      match.completedDistanceMeters ?? null,
      match.plannedTrainingLoad ?? null,
      match.completedTrainingLoad ?? null,
      match.updatedAt
    );
}
