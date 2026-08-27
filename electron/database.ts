import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { enrichActivitiesWithSportNames } from "./corosSportTypes";
import { musicFileNamesMatch } from "./musicFileNames";
import Database from "better-sqlite3";
import type {
  CachedCorosMapPackage,
  CoachAutomationRunQuery,
  GeneratedRoute,
  LocalTrack,
  NativeCorosPlanDetail,
  SpotifySyncTrack,
  SpotifySyncTrackStatus,
  StrengthDetail,
  StrengthSession,
  TrainingActivityMatch,
  TrainingCollection,
  TrainingHubActivity,
  TrainingHubLibraryWorkout,
  TrainingPlanDocument,
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

interface GeneratedRouteRow {
  id: string;
  name: string;
  created_at: string;
  start_location: string;
  destination_location: string | null;
  distance_meters: number;
  duration_seconds: number | null;
  ascent_meters: number | null;
  descent_meters: number | null;
  mode: GeneratedRoute["mode"];
  activity_type: string | null;
  surface_preference: GeneratedRoute["surfacePreference"];
  avoid_highways: number;
  elevation_preference: GeneratedRoute["elevationPreference"];
  points_json: string;
  bounds_json: string | null;
  gpx_path: string | null;
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

interface CachedCorosMapRow {
  package_id: string;
  title: string;
  region: string;
  parent: string;
  type: CachedCorosMapPackage["type"];
  size_bytes: number;
  download_url: string;
  file_path: string;
  extracted_path: string | null;
  downloaded_at: string;
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

    CREATE TABLE IF NOT EXISTS generated_routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      start_location TEXT NOT NULL,
      destination_location TEXT,
      distance_meters INTEGER NOT NULL,
      duration_seconds REAL,
      ascent_meters REAL,
      descent_meters REAL,
      mode TEXT NOT NULL,
      surface_preference TEXT NOT NULL,
      avoid_highways INTEGER NOT NULL,
      elevation_preference TEXT NOT NULL,
      points_json TEXT NOT NULL,
      bounds_json TEXT,
      gpx_path TEXT,
      activity_type TEXT
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

    CREATE TABLE IF NOT EXISTS cached_coros_maps (
      package_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      region TEXT NOT NULL,
      parent TEXT NOT NULL,
      type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      download_url TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      extracted_path TEXT,
      downloaded_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS chat_plan_drafts (
      draft_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      uploaded_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_chat_plan_drafts_created
      ON chat_plan_drafts(created_at DESC);

    CREATE TABLE IF NOT EXISTS training_plans (
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

    CREATE INDEX IF NOT EXISTS idx_training_plans_source_updated
      ON training_plans(source, updated_at DESC);

    CREATE TABLE IF NOT EXISTS training_workout_metadata (
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

    CREATE TABLE IF NOT EXISTS training_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS training_plan_workout_links (
      plan_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      program_id TEXT,
      happen_day TEXT,
      remote_plan_program_id TEXT,
      PRIMARY KEY (plan_id, entry_id)
    );

    CREATE INDEX IF NOT EXISTS idx_training_plan_workout_program
      ON training_plan_workout_links(program_id);

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

    -- Coach automations. The definition knows nothing about conversations;
    -- coach_automation_bindings holds every place it is active.
    CREATE TABLE IF NOT EXISTS coach_automations (
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

    CREATE TABLE IF NOT EXISTS coach_automation_bindings (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      session_id TEXT,
      title_template TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES coach_automations(id) ON DELETE CASCADE
    );

    -- One automation cannot be attached twice to the same conversation.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_binding_unique_session
      ON coach_automation_bindings (automation_id, session_id)
      WHERE session_id IS NOT NULL;

    -- At most one "new conversation per run" binding per automation.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_binding_unique_per_run
      ON coach_automation_bindings (automation_id)
      WHERE session_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_binding_session
      ON coach_automation_bindings (session_id);

    -- Every activity trigger asks "what landed after this binding's watermark",
    -- once per binding, and the answer is ordered by start_time.
    CREATE INDEX IF NOT EXISTS idx_training_activities_start_time
      ON training_activities (start_time);

    CREATE TABLE IF NOT EXISTS coach_automation_runs (
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

    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
      ON coach_automation_runs (automation_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_automation_runs_binding
      ON coach_automation_runs (binding_id, started_at DESC);

    -- The monthly spend (13) asks "what did every automation cost since the
    -- 1st", which narrows by nothing but the date. The two indexes above are
    -- both prefixed by an id, so neither can serve it — without this the budget
    -- guard rail scans the whole run log on every run.
    CREATE INDEX IF NOT EXISTS idx_automation_runs_started
      ON coach_automation_runs (started_at);

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
  `);

  ensureColumn(db, "generated_routes", "activity_type", "TEXT");
  // feel_type caches the COROS end-of-activity feeling (sportFeelInfo.feelType,
  // 1..5; 0 = unrated). NULL = never fetched from the detail endpoint yet.
  ensureColumn(db, "training_activities", "feel_type", "INTEGER");
  migrateChatSessionProviderConstraint(db);
  // pinned_at holds the ISO timestamp a conversation was pinned; NULL = unpinned.
  ensureColumn(db, "chat_sessions", "pinned_at", "TEXT");
  // 5.7: the rolling summary that stands in for the head of a long transcript,
  // and how many entries of that head it accounts for. On the conversation
  // rather than the binding, because five automations can be attached to one
  // conversation and the summary is a fact about the conversation.
  ensureColumn(db, "chat_sessions", "coach_summary", "TEXT");
  ensureColumn(db, "chat_sessions", "coach_summary_through", "INTEGER");
  // coach_seen_at marks a row as already considered by the automation activity
  // watcher. NULL = not yet processed, so a re-synced activity is re-evaluated
  // only if the re-sync clears the stamp.
  ensureColumn(db, "training_activities", "coach_seen_at", "TEXT");
  // last_activity_at is the start_time (epoch seconds) of the newest activity
  // this binding has already analysed. NULL = it never analysed one, in which
  // case the attach time acts as the floor instead.
  ensureColumn(db, "coach_automation_bindings", "last_activity_at", "INTEGER");
  // backoff_until / backoff_level are section 10's per-binding backoff. A failed
  // run leaves the other two clocks alone on purpose, so this is the only thing
  // holding a dead provider off; NULL/0 mean the binding is healthy.
  ensureColumn(db, "coach_automation_bindings", "backoff_until", "TEXT");
  ensureColumn(db, "coach_automation_bindings", "backoff_level", "INTEGER");
  // threshold_firing is 3.3's per-binding transition state, and its three
  // values all matter: NULL = never evaluated, 0 = the condition was false last
  // tick, 1 = it was true. NULL is what stops a binding attached today firing
  // on a condition that has held all week.
  ensureColumn(db, "coach_automation_bindings", "threshold_firing", "INTEGER");
  // What each run cost (13). NULL means the provider reported
  // nothing, which is not the same as a run that cost nothing — the budget has
  // to be able to say what it cannot see.
  ensureColumn(db, "coach_automation_runs", "input_tokens", "INTEGER");
  ensureColumn(db, "coach_automation_runs", "output_tokens", "INTEGER");
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

export function setSetting(key: string, value: string): void {
  requireDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
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
}

/**
 * Renames a conversation without touching `updated_at`, so a rename never
 * reshuffles the sidebar the way a new message does.
 */
export function setChatSessionTitleRow(id: string, title: string): void {
  requireDatabase()
    .prepare("UPDATE chat_sessions SET title = ? WHERE id = ?")
    .run(title, id);
}

export function setChatSessionPinnedRow(
  id: string,
  pinnedAt: string | null
): void {
  requireDatabase()
    .prepare("UPDATE chat_sessions SET pinned_at = ? WHERE id = ?")
    .run(pinnedAt, id);
}

export function deleteChatSessionRow(id: string): void {
  requireDatabase()
    .prepare("DELETE FROM chat_sessions WHERE id = ?")
    .run(id);
}

export interface CoachAutomationRow {
  id: string;
  name: string;
  role: string | null;
  playbook: string;
  enabled: number;
  preset_id: string | null;
  trigger_json: string;
  conditions_json: string;
  runtime_json: string | null;
  created_at: string;
  updated_at: string;
}

const COACH_AUTOMATION_COLUMNS = `id, name, role, playbook, enabled, preset_id,
         trigger_json, conditions_json, runtime_json, created_at, updated_at`;

export function listCoachAutomationRows(): CoachAutomationRow[] {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_AUTOMATION_COLUMNS}
       FROM coach_automations
       ORDER BY created_at ASC`
    )
    .all() as CoachAutomationRow[];
}

export function getCoachAutomationRow(
  id: string
): CoachAutomationRow | undefined {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_AUTOMATION_COLUMNS}
       FROM coach_automations
       WHERE id = ?`
    )
    .get(id) as CoachAutomationRow | undefined;
}

export function insertCoachAutomationRow(row: CoachAutomationRow): void {
  requireDatabase()
    .prepare(
      `INSERT INTO coach_automations
         (id, name, role, playbook, enabled, preset_id, trigger_json,
          conditions_json, runtime_json, created_at, updated_at)
       VALUES
         (@id, @name, @role, @playbook, @enabled, @preset_id, @trigger_json,
          @conditions_json, @runtime_json, @created_at, @updated_at)`
    )
    .run(row);
}

export function updateCoachAutomationRow(row: CoachAutomationRow): void {
  requireDatabase()
    .prepare(
      `UPDATE coach_automations
       SET name = @name, role = @role, playbook = @playbook, enabled = @enabled,
           preset_id = @preset_id, trigger_json = @trigger_json,
           conditions_json = @conditions_json, runtime_json = @runtime_json,
           updated_at = @updated_at
       WHERE id = @id`
    )
    .run(row);
}

export function deleteCoachAutomationRow(id: string): void {
  requireDatabase()
    .prepare("DELETE FROM coach_automations WHERE id = ?")
    .run(id);
}

/**
 * Bindings declare `ON DELETE CASCADE`, but this database never turns on
 * `PRAGMA foreign_keys`, so the cascade would silently not fire. The store
 * deletes the bindings itself through this call.
 */
export function deleteCoachAutomationBindingRowsForAutomation(
  automationId: string
): void {
  requireDatabase()
    .prepare("DELETE FROM coach_automation_bindings WHERE automation_id = ?")
    .run(automationId);
}

export function countCoachAutomationBindingRows(automationId: string): number {
  const row = requireDatabase()
    .prepare(
      "SELECT COUNT(*) AS count FROM coach_automation_bindings WHERE automation_id = ?"
    )
    .get(automationId) as { count: number };
  return row.count;
}

export interface CoachAutomationBindingRow {
  id: string;
  automation_id: string;
  mode: string;
  session_id: string | null;
  title_template: string | null;
  enabled: number;
  sort_order: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_activity_at: number | null;
  backoff_until: string | null;
  backoff_level: number | null;
  /** NULL = never evaluated; 0/1 = the condition last tick (3.3). */
  threshold_firing: number | null;
  created_at: string;
}

const COACH_BINDING_COLUMNS = `id, automation_id, mode, session_id, title_template,
         enabled, sort_order, last_run_at, next_run_at, last_activity_at,
         backoff_until, backoff_level, threshold_firing, created_at`;

export function listCoachAutomationBindingRows(
  automationId: string
): CoachAutomationBindingRow[] {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_BINDING_COLUMNS}
       FROM coach_automation_bindings
       WHERE automation_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(automationId) as CoachAutomationBindingRow[];
}

export function listCoachAutomationBindingRowsForSession(
  sessionId: string
): CoachAutomationBindingRow[] {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_BINDING_COLUMNS}
       FROM coach_automation_bindings
       WHERE session_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(sessionId) as CoachAutomationBindingRow[];
}

export function getCoachAutomationBindingRow(
  id: string
): CoachAutomationBindingRow | undefined {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_BINDING_COLUMNS}
       FROM coach_automation_bindings
       WHERE id = ?`
    )
    .get(id) as CoachAutomationBindingRow | undefined;
}

export function insertCoachAutomationBindingRow(
  row: CoachAutomationBindingRow
): void {
  requireDatabase()
    .prepare(
      `INSERT INTO coach_automation_bindings
         (id, automation_id, mode, session_id, title_template, enabled,
          sort_order, last_run_at, next_run_at, last_activity_at,
          backoff_until, backoff_level, threshold_firing, created_at)
       VALUES
         (@id, @automation_id, @mode, @session_id, @title_template, @enabled,
          @sort_order, @last_run_at, @next_run_at, @last_activity_at,
          @backoff_until, @backoff_level, @threshold_firing, @created_at)`
    )
    .run(row);
}

export function updateCoachAutomationBindingRow(
  row: CoachAutomationBindingRow
): void {
  requireDatabase()
    .prepare(
      `UPDATE coach_automation_bindings
       SET mode = @mode, session_id = @session_id,
           title_template = @title_template, enabled = @enabled,
           sort_order = @sort_order, last_run_at = @last_run_at,
           next_run_at = @next_run_at, last_activity_at = @last_activity_at,
           backoff_until = @backoff_until, backoff_level = @backoff_level,
           threshold_firing = @threshold_firing
       WHERE id = @id`
    )
    .run(row);
}

export function deleteCoachAutomationBindingRow(id: string): void {
  requireDatabase()
    .prepare("DELETE FROM coach_automation_bindings WHERE id = ?")
    .run(id);
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

export interface CoachAutomationRunRow {
  id: string;
  automation_id: string;
  binding_id: string;
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

export interface CoachAutomationTokenTotals {
  inputTokens: number;
  outputTokens: number;
  /** Runs that reported a cost, and runs that reached the provider at all. */
  countedRuns: number;
  providerRuns: number;
}

/**
 * What the automations have spent since `sinceIso`.
 *
 * `countedRuns` and `providerRuns` are both reported so the UI can say when a
 * total is short of the truth. A provider that does not report usage — a local
 * server without `stream_options`, say — would otherwise make a budget read as
 * comfortably under when nobody has any idea.
 */
export function sumCoachAutomationTokensSince(
  sinceIso: string
): CoachAutomationTokenTotals {
  const row = requireDatabase()
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         SUM(CASE WHEN input_tokens IS NOT NULL
                    OR output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS countedRuns,
         COUNT(*) AS providerRuns
       FROM coach_automation_runs
       WHERE started_at >= ?
         AND status IN ('success', 'silent', 'failed', 'cancelled')`
    )
    .get(sinceIso) as CoachAutomationTokenTotals;
  return {
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    countedRuns: row.countedRuns ?? 0,
    providerRuns: row.providerRuns ?? 0
  };
}

const COACH_RUN_COLUMNS = `id, automation_id, binding_id, status, trigger_kind,
         trigger_payload_json, session_id, summary, model, effort, error,
         skip_reason, seen_at, input_tokens, output_tokens,
         started_at, finished_at`;

export function listCoachAutomationRunRows(
  filter: CoachAutomationRunQuery = {}
): CoachAutomationRunRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.automationId) {
    clauses.push("automation_id = ?");
    params.push(filter.automationId);
  }
  if (filter.bindingId) {
    clauses.push("binding_id = ?");
    params.push(filter.bindingId);
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
      `SELECT ${COACH_RUN_COLUMNS}
       FROM coach_automation_runs
       ${where}
       ORDER BY started_at DESC
       ${limit}`
    )
    .all(...params) as CoachAutomationRunRow[];
}

export function getCoachAutomationRunRow(
  id: string
): CoachAutomationRunRow | undefined {
  return requireDatabase()
    .prepare(
      `SELECT ${COACH_RUN_COLUMNS} FROM coach_automation_runs WHERE id = ?`
    )
    .get(id) as CoachAutomationRunRow | undefined;
}

export function insertCoachAutomationRunRow(row: CoachAutomationRunRow): void {
  requireDatabase()
    .prepare(
      `INSERT INTO coach_automation_runs
         (id, automation_id, binding_id, status, trigger_kind,
          trigger_payload_json, session_id, summary, model, effort, error,
          skip_reason, seen_at, input_tokens, output_tokens,
          started_at, finished_at)
       VALUES
         (@id, @automation_id, @binding_id, @status, @trigger_kind,
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
 * Activities the automation watcher has not processed yet. `coach_seen_at` is
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

export function updateCoachAutomationRunRow(row: CoachAutomationRunRow): void {
  requireDatabase()
    .prepare(
      `UPDATE coach_automation_runs
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

function toGeneratedRoute(row: GeneratedRouteRow): GeneratedRoute {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    startLocation: row.start_location,
    destinationLocation: row.destination_location ?? undefined,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds ?? undefined,
    ascentMeters: row.ascent_meters ?? undefined,
    descentMeters: row.descent_meters ?? undefined,
    mode: row.mode,
    activityType:
      (row.activity_type as GeneratedRoute["activityType"] | null) ??
      (row.surface_preference === "trail" ? "hiking" : "walking"),
    surfacePreference: row.surface_preference,
    avoidHighways: Boolean(row.avoid_highways),
    elevationPreference: row.elevation_preference,
    points: JSON.parse(row.points_json) as GeneratedRoute["points"],
    bounds: row.bounds_json
      ? (JSON.parse(row.bounds_json) as GeneratedRoute["bounds"])
      : undefined,
    gpxPath: row.gpx_path ?? undefined
  };
}

export function listGeneratedRoutes(limit = 20): GeneratedRoute[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT id, name, created_at, start_location, destination_location,
              distance_meters, duration_seconds, ascent_meters, descent_meters,
              mode, activity_type, surface_preference, avoid_highways,
              elevation_preference, points_json, bounds_json, gpx_path
       FROM generated_routes
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as GeneratedRouteRow[];

  return rows.map(toGeneratedRoute);
}

export function getGeneratedRoute(id: string): GeneratedRoute | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, name, created_at, start_location, destination_location,
              distance_meters, duration_seconds, ascent_meters, descent_meters,
              mode, activity_type, surface_preference, avoid_highways,
              elevation_preference, points_json, bounds_json, gpx_path
       FROM generated_routes
       WHERE id = ?`
    )
    .get(id) as GeneratedRouteRow | undefined;

  return row ? toGeneratedRoute(row) : undefined;
}

export function addGeneratedRoute(route: GeneratedRoute): GeneratedRoute {
  requireDatabase()
    .prepare(
      `INSERT INTO generated_routes (
         id, name, created_at, start_location, destination_location,
         distance_meters, duration_seconds, ascent_meters, descent_meters,
         mode, activity_type, surface_preference, avoid_highways,
         elevation_preference, points_json, bounds_json, gpx_path
       )
       VALUES (
         @id, @name, @createdAt, @startLocation, @destinationLocation,
         @distanceMeters, @durationSeconds, @ascentMeters, @descentMeters,
         @mode, @activityType, @surfacePreference, @avoidHighways,
         @elevationPreference, @pointsJson, @boundsJson, @gpxPath
       )`
    )
    .run({
      id: route.id,
      name: route.name,
      createdAt: route.createdAt,
      startLocation: route.startLocation,
      destinationLocation: route.destinationLocation ?? null,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds ?? null,
      ascentMeters: route.ascentMeters ?? null,
      descentMeters: route.descentMeters ?? null,
      mode: route.mode,
      activityType: route.activityType,
      surfacePreference: route.surfacePreference,
      avoidHighways: route.avoidHighways ? 1 : 0,
      elevationPreference: route.elevationPreference,
      pointsJson: JSON.stringify(route.points),
      boundsJson: route.bounds ? JSON.stringify(route.bounds) : null,
      gpxPath: route.gpxPath ?? null
    });

  return route;
}

export function deleteGeneratedRoute(id: string): boolean {
  const result = requireDatabase()
    .prepare(`DELETE FROM generated_routes WHERE id = ?`)
    .run(id);
  return result.changes > 0;
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

export function listStoredTrainingActivities(limit = 500): TrainingHubActivity[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT activity_id, name, sport_type, sport_name, start_time, end_time,
              duration, distance, avg_hr, max_hr, calories, training_load,
              elevation_gain
       FROM training_activities
       ORDER BY start_time DESC
       LIMIT ?`
    )
    .all(limit) as TrainingActivityRow[];

  return enrichActivitiesWithSportNames(rows.map(toTrainingActivity));
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

function toCachedCorosMap(row: CachedCorosMapRow): CachedCorosMapPackage {
  return {
    packageId: row.package_id,
    title: row.title,
    region: row.region,
    parent: row.parent,
    type: row.type,
    sizeBytes: row.size_bytes,
    downloadUrl: row.download_url,
    filePath: row.file_path,
    extractedPath: row.extracted_path ?? undefined,
    downloadedAt: row.downloaded_at
  };
}

export function listCachedCorosMaps(): CachedCorosMapPackage[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT package_id, title, region, parent, type, size_bytes,
              download_url, file_path, extracted_path, downloaded_at
       FROM cached_coros_maps
       ORDER BY downloaded_at DESC`
    )
    .all() as CachedCorosMapRow[];

  return rows.map(toCachedCorosMap);
}

export function getCachedCorosMap(
  packageId: string
): CachedCorosMapPackage | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT package_id, title, region, parent, type, size_bytes,
              download_url, file_path, extracted_path, downloaded_at
       FROM cached_coros_maps
       WHERE package_id = ?`
    )
    .get(packageId) as CachedCorosMapRow | undefined;

  return row ? toCachedCorosMap(row) : undefined;
}

export function upsertCachedCorosMap(
  cached: CachedCorosMapPackage
): CachedCorosMapPackage {
  requireDatabase()
    .prepare(
      `INSERT INTO cached_coros_maps (
         package_id, title, region, parent, type, size_bytes, download_url,
         file_path, extracted_path, downloaded_at
       )
       VALUES (
         @packageId, @title, @region, @parent, @type, @sizeBytes,
         @downloadUrl, @filePath, @extractedPath, @downloadedAt
       )
       ON CONFLICT(package_id) DO UPDATE SET
         title = excluded.title,
         region = excluded.region,
         parent = excluded.parent,
         type = excluded.type,
         size_bytes = excluded.size_bytes,
         download_url = excluded.download_url,
         file_path = excluded.file_path,
         extracted_path = excluded.extracted_path,
         downloaded_at = excluded.downloaded_at`
    )
    .run({
      packageId: cached.packageId,
      title: cached.title,
      region: cached.region,
      parent: cached.parent,
      type: cached.type,
      sizeBytes: cached.sizeBytes,
      downloadUrl: cached.downloadUrl,
      filePath: cached.filePath,
      extractedPath: cached.extractedPath ?? null,
      downloadedAt: cached.downloadedAt
    });

  return cached;
}

export function updateCachedCorosMapExtractedPath(
  packageId: string,
  extractedPath: string
): CachedCorosMapPackage {
  requireDatabase()
    .prepare(
      `UPDATE cached_coros_maps
       SET extracted_path = ?
       WHERE package_id = ?`
    )
    .run(extractedPath, packageId);

  const cached = getCachedCorosMap(packageId);
  if (!cached) {
    throw new Error("Cached COROS map package was not found.");
  }

  return cached;
}

export function deleteCachedCorosMapRecord(packageId: string): void {
  requireDatabase()
    .prepare("DELETE FROM cached_coros_maps WHERE package_id = ?")
    .run(packageId);
}

interface ChatPlanDraftRow {
  draft_id: string;
  plan_json: string;
  preview_json: string;
  created_at: number;
  uploaded_at: number | null;
}

export interface StoredChatPlanDraftRecord {
  draftId: string;
  planJson: string;
  previewJson: string;
  createdAt: number;
  uploadedAt?: number;
}

export function saveChatPlanDraft(record: StoredChatPlanDraftRecord): void {
  requireDatabase()
    .prepare(
      `INSERT INTO chat_plan_drafts (draft_id, plan_json, preview_json, created_at, uploaded_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(draft_id) DO UPDATE SET
         plan_json = excluded.plan_json,
         preview_json = excluded.preview_json,
         created_at = excluded.created_at,
         uploaded_at = excluded.uploaded_at`
    )
    .run(
      record.draftId,
      record.planJson,
      record.previewJson,
      record.createdAt,
      record.uploadedAt ?? null
    );
}

export function getChatPlanDraft(
  draftId: string
): StoredChatPlanDraftRecord | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT draft_id, plan_json, preview_json, created_at, uploaded_at
       FROM chat_plan_drafts
       WHERE draft_id = ?`
    )
    .get(draftId) as ChatPlanDraftRow | undefined;

  if (!row) {
    return undefined;
  }

  return {
    draftId: row.draft_id,
    planJson: row.plan_json,
    previewJson: row.preview_json,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at ?? undefined
  };
}

export function listChatPlanDrafts(): StoredChatPlanDraftRecord[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT draft_id, plan_json, preview_json, created_at, uploaded_at
       FROM chat_plan_drafts
       ORDER BY created_at DESC`
    )
    .all() as ChatPlanDraftRow[];

  return rows.map((row) => ({
    draftId: row.draft_id,
    planJson: row.plan_json,
    previewJson: row.preview_json,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at ?? undefined
  }));
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
}

export function pruneChatPlanDrafts(cutoffMs: number): number {
  const result = requireDatabase()
    .prepare("DELETE FROM chat_plan_drafts WHERE created_at < ? AND uploaded_at IS NULL")
    .run(cutoffMs);
  return result.changes;
}

export function deleteChatPlanDraft(draftId: string): void {
  requireDatabase()
    .prepare("DELETE FROM chat_plan_drafts WHERE draft_id = ?")
    .run(draftId);
}

interface TrainingPlanRow {
  id: string;
  document_json: string;
  raw_remote_json: string | null;
}

interface TrainingWorkoutMetadataRow {
  program_id: string;
  favorite: number;
  tags_json: string;
  collection_id: string | null;
  source: TrainingWorkoutMetadata["source"];
  sync_state: TrainingWorkoutMetadata["syncState"];
  last_used_at: string | null;
  last_synced_at: string | null;
  cached_version: string | null;
}

interface TrainingCollectionRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
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

export function saveTrainingPlanDocument(
  document: TrainingPlanDocument,
  rawRemote?: Record<string, unknown>
): void {
  const seenEntryIds = new Set<string>();
  const duplicateEntryIds = new Set<string>();
  for (const entry of document.entries) {
    if (seenEntryIds.has(entry.id)) duplicateEntryIds.add(entry.id);
    seenEntryIds.add(entry.id);
  }
  if (duplicateEntryIds.size > 0) {
    throw new Error(
      `Training plan "${document.name}" contains duplicate entry IDs: ${
        [...duplicateEntryIds].join(", ")
      }`
    );
  }
  const database = requireDatabase();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO training_plans (
           id, remote_id, source, name, document_json, raw_remote_json,
           remote_version, remote_updated_at, sync_state, last_synced_at,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           remote_id = excluded.remote_id,
           source = excluded.source,
           name = excluded.name,
           document_json = excluded.document_json,
           raw_remote_json = COALESCE(excluded.raw_remote_json, training_plans.raw_remote_json),
           remote_version = excluded.remote_version,
           remote_updated_at = excluded.remote_updated_at,
           sync_state = excluded.sync_state,
           last_synced_at = excluded.last_synced_at,
           updated_at = excluded.updated_at,
           archived_at = excluded.archived_at`
      )
      .run(
        document.id,
        document.remoteId ?? null,
        document.source,
        document.name,
        JSON.stringify(document),
        rawRemote ? JSON.stringify(rawRemote) : null,
        document.remoteVersion ?? null,
        document.remoteUpdatedAt ?? null,
        document.syncState,
        document.lastSyncedAt ?? null,
        document.createdAt,
        document.updatedAt,
        document.archived ? document.updatedAt : null
      );

    database
      .prepare("DELETE FROM training_plan_workout_links WHERE plan_id = ?")
      .run(document.id);
    const insertLink = database.prepare(
      `INSERT INTO training_plan_workout_links
       (plan_id, entry_id, program_id, happen_day, remote_plan_program_id)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const entry of document.entries) {
      insertLink.run(
        document.id,
        entry.id,
        entry.programId ?? null,
        entry.workout?.schedule_date ?? null,
        entry.remotePlanProgramId ?? null
      );
    }
  })();
}

export function listTrainingPlanDocuments(): TrainingPlanDocument[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT id, document_json, raw_remote_json
       FROM training_plans
       ORDER BY updated_at DESC`
    )
    .all() as TrainingPlanRow[];
  return rows
    .map((row) => parseStoredJson<TrainingPlanDocument | undefined>(row.document_json, undefined))
    .filter((plan): plan is TrainingPlanDocument => Boolean(plan));
}

export function getTrainingPlanDocument(
  id: string
): TrainingPlanDocument | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, document_json, raw_remote_json
       FROM training_plans
       WHERE id = ? OR remote_id = ?`
    )
    .get(id, id) as TrainingPlanRow | undefined;
  return row
    ? parseStoredJson<TrainingPlanDocument | undefined>(row.document_json, undefined)
    : undefined;
}

export function getNativePlanRawPayload(
  id: string
): NativeCorosPlanDetail["rawPayload"] | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, document_json, raw_remote_json
       FROM training_plans
       WHERE id = ? OR remote_id = ?`
    )
    .get(id, id) as TrainingPlanRow | undefined;
  return row?.raw_remote_json
    ? parseStoredJson<Record<string, unknown> | undefined>(row.raw_remote_json, undefined)
    : undefined;
}

export function deleteTrainingPlanDocument(id: string): void {
  const database = requireDatabase();
  database.transaction(() => {
    database.prepare("DELETE FROM training_plan_workout_links WHERE plan_id = ?").run(id);
    database.prepare("DELETE FROM training_plans WHERE id = ?").run(id);
  })();
}

export function listTrainingWorkoutMetadata(): TrainingWorkoutMetadata[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT program_id, favorite, tags_json, collection_id, source, sync_state,
              last_used_at, last_synced_at, cached_version
       FROM training_workout_metadata`
    )
    .all() as TrainingWorkoutMetadataRow[];
  return rows.map((row) => ({
    programId: row.program_id,
    favorite: Boolean(row.favorite),
    tags: parseStoredJson<string[]>(row.tags_json, []),
    collectionId: row.collection_id ?? undefined,
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
         program_id, favorite, tags_json, collection_id, source, sync_state,
         last_used_at, last_synced_at, cached_version, cached_payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(program_id) DO UPDATE SET
         favorite = excluded.favorite,
         tags_json = excluded.tags_json,
         collection_id = excluded.collection_id,
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
      metadata.collectionId ?? null,
      metadata.source,
      metadata.syncState,
      metadata.lastUsedAt ?? null,
      metadata.lastSyncedAt ?? null,
      metadata.cachedVersion ?? null,
      cachedPayload ? JSON.stringify(cachedPayload) : null
    );
}

export function listTrainingCollections(): TrainingCollection[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT id, name, description, color, created_at, updated_at
       FROM training_collections
       ORDER BY name COLLATE NOCASE`
    )
    .all() as TrainingCollectionRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function saveTrainingCollection(collection: TrainingCollection): void {
  requireDatabase()
    .prepare(
      `INSERT INTO training_collections
       (id, name, description, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         color = excluded.color,
         updated_at = excluded.updated_at`
    )
    .run(
      collection.id,
      collection.name,
      collection.description ?? null,
      collection.color ?? null,
      collection.createdAt,
      collection.updatedAt
    );
}

export function deleteTrainingCollection(id: string): void {
  const database = requireDatabase();
  database.transaction(() => {
    database
      .prepare("UPDATE training_workout_metadata SET collection_id = NULL WHERE collection_id = ?")
      .run(id);
    database.prepare("DELETE FROM training_collections WHERE id = ?").run(id);
  })();
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
