// SyncTarget over the real database.
//
// A thin adapter: all the merge rules live in syncEngine.ts, and this file only
// turns a decision into a statement. Two things it does own, because they have
// no meaning above the storage layer:
//
//   * Table and column names arrive inside oplog entries written by another
//     machine, so nothing is interpolated into SQL until it has been checked
//     against the schema this build actually has.
//   * localStorage lives in the renderer, which the main process cannot reach
//     synchronously. Those operations are queued here and handed to the
//     renderer over IPC by the service that owns the window.

import { requireDatabase } from "../database";
import { policyForTable, RECORD_ID_SEPARATOR } from "./syncPolicy";
import { toSqlValue } from "./syncableStore";
import type { SyncTarget } from "./syncEngine";

/** A localStorage write the renderer still has to perform. */
export interface PendingLocalStorageOp {
  readonly op: "set" | "delete";
  readonly key: string;
  readonly value?: string;
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export { RECORD_ID_SEPARATOR } from "./syncPolicy";

interface TableShape {
  readonly columns: ReadonlySet<string>;
  readonly primaryKey: readonly string[];
}

export class SqliteSyncTarget implements SyncTarget {
  readonly #shapes = new Map<string, TableShape>();
  readonly #pendingLocalStorage: PendingLocalStorageOp[] = [];

  /**
   * Take the queue and empty it in one step.
   *
   * The only way to read it, and deliberately the only way. A separate getter
   * and clearer used to sit here, and "read it, then clear it" was the sole way
   * anyone called them — with the getter handing back the live array, so the
   * clear emptied the value just read. The caller sent an empty list to the
   * renderer every time and no synced localStorage key ever arrived. One
   * operation cannot be got wrong that way.
   */
  drainLocalStorage(): PendingLocalStorageOp[] {
    return this.#pendingLocalStorage.splice(0, this.#pendingLocalStorage.length);
  }

  /** Read the live schema for a table, refusing anything policy does not allow
   *  or the database does not have. Cached: PRAGMA on every row would be slow
   *  and the schema cannot change while the app runs. */
  #shapeOf(table: string): TableShape {
    const cached = this.#shapes.get(table);
    if (cached) return cached;

    if (!SAFE_IDENTIFIER.test(table)) {
      throw new Error(`Refusing to touch table with unsafe name: ${table}`);
    }
    // Defence in depth. syncEngine already filters on policy, but this layer is
    // the one holding a SQL cursor, so it refuses independently: an unknown
    // table, app_settings (whose rows travel as `setting` entries), and the
    // tiers that must never be written from a remote machine — `derived` would
    // overwrite this machine's cache, `device` would import another computer's
    // absolute paths.
    const policy = policyForTable(table);
    if (policy === undefined || policy === "perKey") {
      throw new Error(`Refusing to sync into unclassified table: ${table}`);
    }
    if (policy === "derived" || policy === "device") {
      throw new Error(
        `Refusing to sync into ${policy} table: ${table}`
      );
    }

    const info = requireDatabase()
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string; pk: number }>;

    if (info.length === 0) {
      throw new Error(`No such table in this schema: ${table}`);
    }

    const shape: TableShape = {
      columns: new Set(info.map((column) => column.name)),
      primaryKey: info
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name)
    };
    if (shape.primaryKey.length === 0) {
      throw new Error(`Table has no primary key, cannot sync: ${table}`);
    }

    this.#shapes.set(table, shape);
    return shape;
  }

  upsertRow(
    table: string,
    _recordId: string,
    row: Record<string, unknown>
  ): void {
    const shape = this.#shapeOf(table);

    // Drop columns this build does not have. An older machine writing a row
    // that a newer schema has since extended, or a newer one writing a column
    // this build has not learned about yet, must not abort the whole merge.
    const columns = Object.keys(row).filter((column) =>
      shape.columns.has(column)
    );
    if (columns.length === 0) {
      throw new Error(`No known columns in row for ${table}`);
    }
    for (const key of shape.primaryKey) {
      if (!columns.includes(key)) {
        throw new Error(`Row for ${table} is missing primary key ${key}`);
      }
    }

    const placeholders = columns.map(() => "?").join(", ");
    requireDatabase()
      .prepare(
        `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) ` +
          `VALUES (${placeholders})`
      )
      .run(columns.map((column) => toSqlValue(row[column])));
  }

  deleteRow(table: string, recordId: string): void {
    const shape = this.#shapeOf(table);
    const parts = recordId.split(RECORD_ID_SEPARATOR);
    if (parts.length !== shape.primaryKey.length) {
      throw new Error(
        `Record id for ${table} has ${parts.length} parts, ` +
          `expected ${shape.primaryKey.length}`
      );
    }
    const where = shape.primaryKey
      .map((column) => `${column} = ?`)
      .join(" AND ");
    requireDatabase().prepare(`DELETE FROM ${table} WHERE ${where}`).run(parts);
  }

  setSetting(key: string, value: string): void {
    requireDatabase()
      .prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }

  deleteSetting(key: string): void {
    requireDatabase()
      .prepare("DELETE FROM app_settings WHERE key = ?")
      .run(key);
  }

  setLocalStorage(key: string, value: string): void {
    this.#pendingLocalStorage.push({ op: "set", key, value });
  }

  deleteLocalStorage(key: string): void {
    this.#pendingLocalStorage.push({ op: "delete", key });
  }

  /** The record id for a row, matching what deleteRow expects. */
  recordIdFor(table: string, row: Record<string, unknown>): string {
    return this.#shapeOf(table)
      .primaryKey.map((column) => String(row[column]))
      .join(RECORD_ID_SEPARATOR);
  }
}
