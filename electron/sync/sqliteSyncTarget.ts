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
import { entryIdentity } from "./oplog";
import { rowMergerFor } from "./rowMergers";
import type { RepublishRow } from "./syncEngine";
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
  readonly #incomplete = new Set<string>();
  readonly #republish: RepublishRow[] = [];

  /**
   * Rows whose merge produced something the vault does not hold, taken and
   * cleared. See `SyncTarget.takeRepublish`.
   */
  takeRepublish(): readonly RepublishRow[] {
    return this.#republish.splice(0, this.#republish.length);
  }

  /** See `SyncTarget.transaction`. `better-sqlite3` rolls back if `work`
   *  throws, which is why `applyEntries` keeps catching per entry: one entry
   *  this schema cannot hold must not undo the merge around it. */
  transaction<T>(work: () => T): T {
    return requireDatabase().transaction(work)();
  }

  /** See `SyncTarget.takeIncomplete`. Taken and cleared in one step, for the
   *  same reason `drainLocalStorage` is. */
  takeIncomplete(): readonly string[] {
    const taken = [...this.#incomplete];
    this.#incomplete.clear();
    return taken;
  }

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

  /** The row as this database currently holds it, for a merger to union with. */
  #readRow(
    table: string,
    shape: TableShape,
    recordId: string
  ): Record<string, unknown> | undefined {
    const parts = recordId.split(RECORD_ID_SEPARATOR);
    if (parts.length !== shape.primaryKey.length) return undefined;
    const where = shape.primaryKey
      .map((column) => `${column} = ?`)
      .join(" AND ");
    return requireDatabase()
      .prepare(`SELECT * FROM ${table} WHERE ${where}`)
      .get(parts) as Record<string, unknown> | undefined;
  }

  upsertRow(
    table: string,
    recordId: string,
    row: Record<string, unknown>,
    context: { readonly winner: boolean } = { winner: true }
  ): void {
    const shape = this.#shapeOf(table);

    // A record that accumulates is unioned with what is already here rather
    // than replacing it — the coach transcript is the only one, and two
    // machines adding to the same conversation used to resolve to whichever
    // wrote last. See `rowMergers.ts`.
    const merger = rowMergerFor(table);
    let republish = false;
    if (merger) {
      const merged = merger(this.#readRow(table, shape, recordId), row, context);
      row = merged.row;
      republish = merged.republish;
    }

    // Drop columns this build does not have. An older machine writing a row
    // that a newer schema has since extended, or a newer one writing a column
    // this build has not learned about yet, must not abort the whole merge.
    const columns = Object.keys(row).filter((column) =>
      shape.columns.has(column)
    );
    // …but say so. What lands is then less than the entry carried, and a caller
    // that remembered this row as fully held would leave those columns empty
    // for good once a later build learned about them.
    if (columns.length !== Object.keys(row).length) {
      // Through `entryIdentity`, not a template of the same shape: the caller
      // looks these up by the identity it computed from the entry, and two
      // spellings of one format drift apart in silence.
      this.#incomplete.add(entryIdentity({ scope: "table", key: table, recordId }));
    }
    if (columns.length === 0) {
      throw new Error(`No known columns in row for ${table}`);
    }
    for (const key of shape.primaryKey) {
      if (!columns.includes(key)) {
        throw new Error(`Row for ${table} is missing primary key ${key}`);
      }
    }

    // Write what the payload names and leave every other column alone. That is
    // the trap the whole schema has been shaped around: with `INSERT OR REPLACE`
    // the row is written afresh, so a column an older or newer build did not
    // send comes back as its default — which is to say NULL, meaning *deleted*
    // rather than *unchanged*.
    //
    // **A partial payload has to go out as an `UPDATE`.** An upsert cannot do
    // it: `INSERT … ON CONFLICT DO UPDATE` builds the candidate row first, so a
    // `NOT NULL` column the payload omits fails the statement before the
    // conflict clause is ever reached — `chat_sessions` has four of them.
    // Measured, and it is why this is two paths rather than one clever one.
    const updatable = columns.filter(
      (column) => !shape.primaryKey.includes(column)
    );
    const keyMatch = shape.primaryKey.map((column) => `${column} = ?`).join(" AND ");
    const value = (column: string) => toSqlValue(row[column]);

    if (columns.length !== shape.columns.size && updatable.length > 0) {
      const changed = requireDatabase()
        .prepare(
          `UPDATE ${table} SET ${updatable.map((c) => `${c} = ?`).join(", ")} ` +
            `WHERE ${keyMatch}`
        )
        .run([
          ...updatable.map(value),
          ...shape.primaryKey.map(value)
        ]).changes;
      // A row that is not here yet cannot be updated into existence, so the
      // insert below still runs — and fails loudly if the payload cannot make a
      // complete row, which is the honest answer rather than a half-written one.
      if (changed > 0) {
        this.#noteRepublish(table, shape, recordId, republish);
        return;
      }
    }

    const placeholders = columns.map(() => "?").join(", ");
    const assignments = updatable
      .map((column) => `${column} = excluded.${column}`)
      .join(", ");
    const conflict = assignments
      ? `ON CONFLICT(${shape.primaryKey.join(", ")}) DO UPDATE SET ${assignments}`
      : `ON CONFLICT(${shape.primaryKey.join(", ")}) DO NOTHING`;
    requireDatabase()
      .prepare(
        `INSERT INTO ${table} (${columns.join(", ")}) ` +
          `VALUES (${placeholders}) ${conflict}`
      )
      .run(columns.map(value));

    this.#noteRepublish(table, shape, recordId, republish);
  }

  /**
   * Queue the row for publishing, read back rather than reused.
   *
   * What goes out has to be what this database now holds. The merged row was
   * built from the arriving payload — which a machine on an older schema may
   * have sent short of a column, and which a losing entry carries only the
   * merged columns of — so publishing it would announce a row nobody has.
   */
  #noteRepublish(
    table: string,
    shape: TableShape,
    recordId: string,
    republish: boolean
  ): void {
    if (!republish) return;
    const written = this.#readRow(table, shape, recordId);
    if (written) this.#republish.push({ table, recordId, row: written });
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
