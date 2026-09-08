// Reading the tables that policy allows to leave this machine.
//
// Three features ask the same questions of the same rows — which tables are in
// scope, what identifies a record in one, what is in it right now — and they
// must answer identically or they corrupt each other's work:
//
//   * `sync/fullState.ts` republishes rows as oplog entries.
//   * `backup/backupDocument.ts` writes them into a backup file and reads them
//     back.
//   * `sync/sqliteSyncTarget.ts` merges entries from another machine.
//
// A record id computed one way here and another way there would have the same
// row arrive as two, so `recordId` in particular is a single definition on
// purpose. It used to live in the snapshot module, which meant sync imported
// backup to get at it; the shared floor belongs under both.

import { requireDatabase } from "../database";
import {
  RECORD_ID_SEPARATOR,
  shouldSyncTier,
  TABLE_POLICY,
  type SyncTier
} from "./syncPolicy";

/** Tables in scope, in a stable order so two runs produce comparable output. */
export function syncableTables(): string[] {
  return Object.keys(TABLE_POLICY)
    .filter((table) => {
      const policy = TABLE_POLICY[table];
      if (policy === "perKey") return false;
      return shouldSyncTier(policy as SyncTier);
    })
    .sort();
}

/** Every row of a table. */
export function readRows(table: string): Record<string, unknown>[] {
  // `table` comes from TABLE_POLICY, whose keys are literals in this repo's own
  // source — never from remote data — so it cannot carry an injection.
  return requireDatabase()
    .prepare(`SELECT * FROM ${table}`)
    .all() as Record<string, unknown>[];
}

export function countRows(table: string): number {
  return (
    requireDatabase().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    }
  ).n;
}

/** Every column this schema has for a table, read from the live schema. */
export function columnsOf(table: string): Set<string> {
  return new Set(
    (
      requireDatabase().prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name)
  );
}

/** A table's primary key columns, in order, read from the live schema. */
export function primaryKeyOf(table: string): string[] {
  return (
    requireDatabase().prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      pk: number;
    }>
  )
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
}

/**
 * One row value, as `better-sqlite3` will accept it.
 *
 * It binds only these five shapes, so anything else — a nested object from a
 * JSON column that has been through `JSON.parse` on its way through the oplog or
 * a backup file — is stored as JSON text and round-trips. Shared because the
 * merge path and the restore path must agree on it: the same row arriving down
 * the two routes has to land as the same bytes.
 */
export function toSqlValue(
  value: unknown
): string | number | bigint | Buffer | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Buffer.isBuffer(value)) return value;
  return JSON.stringify(value);
}

/** What names a row, everywhere. The same identity `SqliteSyncTarget` writes
 *  by, so one row means one thing on every path. */
export function recordId(
  row: Record<string, unknown>,
  key: readonly string[]
): string {
  return key.map((column) => String(row[column])).join(RECORD_ID_SEPARATOR);
}

/**
 * Rows a fresh install writes for itself, which say nothing about whether a
 * person has used the app.
 *
 * There is one, and it caused exactly the confusion this list exists to
 * prevent: a brand-new database already holds the built-in COROS MCP server, so
 * counting rows naively made every new machine claim to have data — and a
 * restore on a machine with nothing to lose would stop to ask a question with
 * only one sensible answer.
 */
const SEEDED_ROWS: Readonly<Record<string, string>> = {
  mcp_servers: "builtin = 1"
};

/** Rows in a table that a person put there. */
function countUserRows(table: string): number {
  const seeded = SEEDED_ROWS[table];
  const where = seeded ? ` WHERE NOT (${seeded})` : "";
  return (
    requireDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`)
      .get() as { n: number }
  ).n;
}

/**
 * Whether this machine holds anything a person made.
 *
 * The question a restore asks first: with nothing to lose there is nothing to
 * choose between, so it just runs.
 *
 * Rows only — settings are deliberately not counted. A preference is not what
 * anyone is afraid of losing to a restore, and several are written during an
 * ordinary first launch, so counting them would make "empty" mean "has never
 * been opened" rather than "has nothing in it". Conversations, plans, routes
 * and collections are the things worth stopping for.
 */
export function hasSyncableData(): boolean {
  return syncableTables().some((table) => countUserRows(table) > 0);
}
