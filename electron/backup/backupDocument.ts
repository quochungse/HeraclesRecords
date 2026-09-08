// Collecting the machine's syncable state into one document, and putting it
// back again.
//
// A snapshot is a whole-state copy, not a diff: it is what a backup restores
// from and what a newly joined device starts from. The oplog handles the
// incremental case; this handles "give me everything worth keeping".
//
// Three rules hold throughout:
//
//   * Only what syncPolicy allows. `derived` and `device` are skipped on the
//     way out and refused on the way in — and every credential in the app is
//     `device`, so a backup carries user data and nothing else.
//   * A `safeStorage` ciphertext is never shipped: it is bound to one machine's
//     keychain, so a copy would produce a backup that looks complete and
//     restores into nothing — an account reported as connected that cannot
//     make a request. `isDeviceEncrypted` is the second gate on that, after the
//     tier.
//   * **A restore is one of two things, and the person picks which.**
//     `replace` lets the backup decide in full: rows and settings this machine
//     holds that the backup does not are removed. `merge` adds what is missing
//     and touches nothing that already exists — no removals, and a record
//     present on both sides keeps the copy already here.
//
//     Replace is the honest default for "put this machine back the way it
//     was": merging as a blanket rule looked safer and was worse, because a
//     row the source machine had deleted came back on every restore. Merge
//     earns its place as an explicit choice — importing one machine's history
//     into another that also has its own.
//
//     What the backup does not cover is untouched either way, credentials
//     included, so restoring never costs this machine a sign-in.

import crypto from "node:crypto";

import { requireDatabase } from "../database";
import {
  columnsOf,
  countRows,
  primaryKeyOf,
  readRows,
  recordId,
  syncableTables,
  toSqlValue
} from "../sync/syncableStore";
import {
  isDeviceEncrypted,
  policyForLocalStorage,
  policyForSetting,
  policyForTable,
  shouldSyncTier,
  type SyncTier
} from "../sync/syncPolicy";
import type {
  BackupDocument,
  LocalStorageEntries,
  RestoreMode,
  RestorePreview,
  RestoreResult,
  TableChange
} from "./backupTypes";

export interface CollectResult {
  readonly document: BackupDocument;
  /** Rows copied, for the line the panel shows afterwards. */
  readonly rowCount: number;
}

/** A backup's identity. 16 hex characters, the same shape and reasoning as
 *  `deviceIdentity.mint` — filename-safe, and past collision risk for the
 *  number of backups one person makes. */
function mintBackupId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export interface CollectOptions {
  readonly deviceId: string;
  /** Fingerprint of the account this data belongs to. Required: a backup with
   *  no owner is one nothing can check, and this build does not write them. */
  readonly owner: string;
  readonly localStorage: LocalStorageEntries;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

/** Gather everything policy allows into one document. */
export function collectBackup(options: CollectOptions): CollectResult {
  const {
    deviceId,
    owner,
    localStorage,
    now = () => new Date(),
    newId = mintBackupId
  } = options;
  const tables: Record<string, Record<string, unknown>[]> = {};
  let rowCount = 0;
  for (const table of syncableTables()) {
    // Empty tables are carried too, as empty arrays. They say "the backup
    // covers this table and it holds nothing", which is what lets a `replace`
    // restore clear a table the source machine had emptied. Omitting them made
    // an empty table indistinguishable from one the backup knew nothing about,
    // and a restore then left the destination's rows in place.
    const rows = readRows(table);
    tables[table] = rows;
    rowCount += rows.length;
  }

  const settings: Record<string, string> = {};
  const stored = requireDatabase()
    .prepare("SELECT key, value FROM app_settings")
    .all() as Array<{ key: string; value: string }>;

  for (const { key, value } of stored) {
    if (!shouldSyncTier(policyForSetting(key))) continue;
    // Unreachable while every keychain-sealed key is `device`, which the policy
    // suite asserts. Kept because the cost of the day that stops being true is
    // a backup full of ciphertext no machine can open.
    if (isDeviceEncrypted(key)) continue;
    settings[key] = value;
  }

  const carriedLocalStorage: Record<string, string> = {};
  for (const [key, value] of Object.entries(localStorage)) {
    if (shouldSyncTier(policyForLocalStorage(key))) {
      carriedLocalStorage[key] = value;
    }
  }

  return {
    document: {
      version: 1,
      id: newId(),
      createdAt: now().toISOString(),
      deviceId,
      owner,
      tables,
      settings,
      localStorage: carriedLocalStorage
    },
    rowCount
  };
}

/** Whether a parsed file is a backup this build can read. The one gate between
 *  a file the person picked off their disk and the restore machinery. */
export function isBackupDocument(value: unknown): value is BackupDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<BackupDocument>;
  return (
    document.version === 1 &&
    typeof document.id === "string" &&
    document.id.length > 0 &&
    typeof document.createdAt === "string" &&
    typeof document.deviceId === "string" &&
    typeof document.tables === "object" &&
    document.tables !== null &&
    typeof document.settings === "object" &&
    document.settings !== null
  );
}

// --- Restore -----------------------------------------------------------------

/** What a restore would do, computed without writing anything. The UI shows
 *  this before asking for confirmation: a restore overwrites, and the person
 *  doing it deserves to see the size of that before it happens. */
export function previewRestore(
  snapshot: BackupDocument,
  mode: RestoreMode = "replace"
): RestorePreview {
  const tables: TableChange[] = [];
  const refused: string[] = [];
  let totalIncomingRows = 0;
  let totalExistingRows = 0;
  let rowsWriting = 0;
  let rowsRemoved = 0;

  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const policy = policyForTable(table);
    if (
      policy === undefined ||
      policy === "perKey" ||
      !shouldSyncTier(policy as SyncTier)
    ) {
      refused.push(`table:${table}`);
      continue;
    }
    const existing = countRows(table);
    // Replace writes every row it carries, overwriting where they collide.
    // Merge writes only the ones this machine does not already have, so the
    // count the confirmation shows is the count of new records.
    const writing =
      mode === "replace" ? rows.length : countIncomingAbsentHere(table, rows);
    const removing = mode === "replace" ? countRowsAbsentFrom(table, rows) : 0;
    tables.push({ table, incoming: rows.length, existing, writing, removing });
    totalIncomingRows += rows.length;
    totalExistingRows += existing;
    rowsWriting += writing;
    rowsRemoved += removing;
  }

  let settings = 0;
  for (const key of Object.keys(snapshot.settings)) {
    // A backup written by a build that carried credentials has them here. The
    // tier refuses them, which is what leaves this machine's own sign-ins
    // alone rather than overwriting them with another computer's.
    if (shouldSyncTier(policyForSetting(key)) && !isDeviceEncrypted(key)) {
      settings += 1;
    } else {
      refused.push(`setting:${key}`);
    }
  }

  let localStorage = 0;
  for (const key of Object.keys(snapshot.localStorage ?? {})) {
    if (shouldSyncTier(policyForLocalStorage(key))) localStorage += 1;
    else refused.push(`localStorage:${key}`);
  }

  return {
    mode,
    createdAt: snapshot.createdAt,
    deviceId: snapshot.deviceId,
    tables: tables.sort((a, b) => a.table.localeCompare(b.table)),
    settings,
    localStorage,
    settingsRemoved: mode === "replace" ? settingsAbsentFrom(snapshot) : [],
    rowsWriting,
    rowsRemoved,
    refused: refused.sort(),
    totalIncomingRows,
    totalExistingRows
  };
}

/** How many rows the backup has that this machine does not — what a merge
 *  would actually add. Compared by primary key, the same identity everything
 *  else here uses. */
function countIncomingAbsentHere(
  table: string,
  rows: readonly Record<string, unknown>[]
): number {
  const key = primaryKeyOf(table);
  if (key.length === 0) return rows.length;
  const here = new Set(readRows(table).map((row) => recordId(row, key)));
  return rows.filter((row) => !here.has(recordId(row, key))).length;
}

/** How many rows in `table` the backup does not have. Compared by primary key,
 *  so a row the backup holds a different version of counts as kept, not
 *  removed. */
function countRowsAbsentFrom(
  table: string,
  rows: readonly Record<string, unknown>[]
): number {
  const key = primaryKeyOf(table);
  if (key.length === 0) return 0;
  const incoming = new Set(rows.map((row) => recordId(row, key)));
  return readRows(table).filter((row) => !incoming.has(recordId(row, key)))
    .length;
}

/**
 * Settings this machine holds, in a tier the backup covers, that the backup
 * does not have — the ones a restore clears.
 *
 * Credentials cannot appear here: they are `device`, so the tier filter drops
 * them. That is the property that makes a restore safe to run on a machine
 * already signed in to everything — it replaces the user's data and does not
 * touch a single account.
 */
function settingsAbsentFrom(snapshot: BackupDocument): string[] {
  const kept = new Set<string>(Object.keys(snapshot.settings));

  return (
    requireDatabase().prepare("SELECT key FROM app_settings").all() as Array<{
      key: string;
    }>
  )
    .map(({ key }) => key)
    .filter((key) => !kept.has(key))
    .filter((key) => shouldSyncTier(policyForSetting(key)))
    .sort();
}

/**
 * Write a snapshot into the database.
 *
 * Runs inside one transaction: a restore that fails halfway would leave the app
 * holding half of one machine's state and half of another's, which is worse
 * than either.
 */
export function applyBackup(
  snapshot: BackupDocument,
  mode: RestoreMode = "replace"
): RestoreResult {
  const preview = previewRestore(snapshot, mode);
  const database = requireDatabase();

  let rowsWritten = 0;
  let settingsWritten = 0;
  let rowsRemoved = 0;

  const write = database.transaction(() => {
    for (const { table } of preview.tables) {
      const rows = snapshot.tables[table] ?? [];
      const key = primaryKeyOf(table);
      const incoming = new Set(rows.map((row) => recordId(row, key)));

      // Rows the backup does not have go — in `replace` only. Deleted by
      // primary key rather than by emptying the table, so a `DELETE` that no
      // row in the backup would have re-created stays visible in the count —
      // and a table with no primary key (which `SqliteSyncTarget` refuses to
      // sync at all) is left alone rather than truncated.
      if (mode === "replace" && key.length > 0) {
        const where = key.map((column) => `${column} = ?`).join(" AND ");
        const remove = database.prepare(`DELETE FROM ${table} WHERE ${where}`);
        for (const row of readRows(table)) {
          if (incoming.has(recordId(row, key))) continue;
          remove.run(key.map((column) => toSqlValue(row[column])));
          rowsRemoved += 1;
        }
      }

      if (rows.length === 0) continue;
      // Only columns this schema actually has. A backup written after an
      // `ensureColumn` carries the new column in every row, and naming it in
      // the INSERT would raise "table X has no column named …" inside the
      // transaction — rolling the whole restore back rather than losing one
      // field. `SqliteSyncTarget` drops unknown columns for the same reason;
      // the two paths are documented as following the same rules.
      const known = columnsOf(table);
      const columns = Object.keys(rows[0]).filter((column) =>
        known.has(column)
      );
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => "?").join(", ");
      // OR IGNORE is what makes a merge additive: a row whose primary key is
      // already here — or that would collide with any other unique constraint,
      // such as `training_plans.remote_id` — is skipped, leaving this
      // machine's copy exactly as it was.
      const conflict = mode === "replace" ? "REPLACE" : "IGNORE";
      const statement = database.prepare(
        `INSERT OR ${conflict} INTO ${table} (${columns.join(", ")}) ` +
          `VALUES (${placeholders})`
      );
      for (const row of rows) {
        const outcome = statement.run(
          columns.map((column) => toSqlValue(row[column]))
        );
        // `changes` is 0 for a row IGNORE skipped, so the count reports what
        // was actually written rather than what was offered.
        rowsWritten += outcome.changes;
      }
    }

    const upsert = database.prepare(
      mode === "replace"
        ? "INSERT INTO app_settings (key, value) VALUES (?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        : "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)"
    );
    for (const [key, value] of Object.entries(snapshot.settings)) {
      // The same two conditions `previewRestore` counted, so what the
      // confirmation promised is what gets written.
      if (!shouldSyncTier(policyForSetting(key))) continue;
      if (isDeviceEncrypted(key)) continue;
      settingsWritten += upsert.run(key, value).changes;
    }

    // The settings half of replacing, and empty under `merge`, which removes
    // nothing. `settingsRemoved` covers only the tiers the backup carries, so
    // no credential is on it and a restore cannot sign this machine out of
    // anything.
    const remove = database.prepare("DELETE FROM app_settings WHERE key = ?");
    for (const key of preview.settingsRemoved) {
      remove.run(key);
    }
  });
  write();

  const localStorage: Record<string, string> = {};
  for (const [key, value] of Object.entries(snapshot.localStorage ?? {})) {
    if (shouldSyncTier(policyForLocalStorage(key))) {
      localStorage[key] = value;
    }
  }

  return {
    mode,
    rowsWritten,
    settingsWritten,
    rowsRemoved,
    settingsRemoved: preview.settingsRemoved.length,
    localStorage,
    refused: preview.refused
  };
}
