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
//     synchronously. Those operations wait in `sync_local_storage_inbox` — in
//     the merge's transaction, so they are as durable as the rows — and are
//     handed to the renderer over IPC by the service that owns the window,
//     leaving the inbox only when the renderer says it applied them.

import { requireDatabase } from "../database";
import { policyForTable, RECORD_ID_SEPARATOR } from "./syncPolicy";
import { toSqlValue } from "./syncableStore";
import { entryIdentity } from "./oplog";
import { rowMergerFor } from "./rowMergers";
import type { ContentChange, RepublishRow } from "./syncEngine";
import type { SyncTarget } from "./syncEngine";
import {
  createSqlitePublishedItems,
  elementHash,
  itemisedColumn,
  parseList,
  placeElement,
  removeElement,
  splitItemRecordId,
  withElementId,
  type ListElement,
  type PublishedItemStore
} from "./transcriptItems";

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
  readonly #incomplete = new Set<string>();
  /** By identity, read only when taken: see `takeRepublish`. */
  readonly #republish = new Map<string, { table: string; recordId: string }>();
  /** Keyed by identity, so a record folded from three entries is listed once. */
  readonly #contentChanges = new Map<string, ContentChange>();
  readonly #published: PublishedItemStore;

  /** `published` is where an element taken in is recorded as held, so the
   *  next save of its row does not send it back out. */
  constructor(published: PublishedItemStore = createSqlitePublishedItems()) {
    this.#published = published;
  }

  /**
   * Rows whose merge produced something the vault does not hold, taken and
   * cleared. See `SyncTarget.takeRepublish`.
   *
   * Read here, once the merge is over, never when the row was noted: what goes
   * out has to be what this database now holds, and a row read partway through
   * lacks what the rest of the merge put in it — messages that arrived after
   * the one that noted it, which went out as deleted. A row gone by now is not
   * published at all.
   */
  takeRepublish(): readonly RepublishRow[] {
    const taken: RepublishRow[] = [];
    for (const { table, recordId } of this.#republish.values()) {
      const row = this.#readRow(table, this.#shapeOf(table), recordId);
      if (row) taken.push({ table, recordId, row });
    }
    this.#republish.clear();
    return taken;
  }

  #noteRepublish(table: string, recordId: string): void {
    this.#republish.set(entryIdentity({ scope: "table", key: table, recordId }), { table, recordId });
  }

  /** See `SyncTarget.takeContentChanges`. */
  takeContentChanges(): readonly ContentChange[] {
    const taken = [...this.#contentChanges.values()];
    this.#contentChanges.clear();
    return taken;
  }

  #noteContentChange(table: string, recordId: string, removed: boolean): void {
    const identity = entryIdentity({ scope: "table", key: table, recordId });
    // A removal outranks an edit of the same record in the same merge.
    const held = this.#contentChanges.get(identity);
    this.#contentChanges.set(identity, {
      table,
      recordId,
      removed: removed || Boolean(held?.removed)
    });
  }

  /** See `SyncTarget.transaction`. `better-sqlite3` rolls back if `work`
   *  throws, which is why `applyEntries` keeps catching per entry: one entry
   *  this schema cannot hold must not undo the merge around it. */
  transaction<T>(work: () => T): T {
    return requireDatabase().transaction(work)();
  }

  /** See `SyncTarget.takeIncomplete`. Taken and cleared in one step: a getter
   *  and a clearer called in turn is how a queue gets emptied before it is
   *  read. */
  takeIncomplete(): readonly string[] {
    const taken = [...this.#incomplete];
    this.#incomplete.clear();
    return taken;
  }

  /**
   * The localStorage writes the renderer has not yet said it performed — read,
   * not taken.
   *
   * They used to be a queue in memory, drained as they were sent, with nothing
   * to say a renderer had taken them: a quit in between lost them, so the loop
   * could never record those entries as held and read the files carrying them
   * again at every launch (the whole snapshot, in practice). Now they leave
   * only through `acknowledgeLocalStorage`, and until then every send repeats
   * them — writing the same value twice is harmless, losing it is not.
   */
  pendingLocalStorage(): PendingLocalStorageOp[] {
    const rows = requireDatabase()
      .prepare("SELECT key, op, value FROM sync_local_storage_inbox ORDER BY key")
      .all() as { key: string; op: string; value: string | null }[];
    return rows.map((row) =>
      row.op === "delete"
        ? { op: "delete", key: row.key }
        : { op: "set", key: row.key, value: row.value ?? "" }
    );
  }

  /**
   * The renderer applied these. Each leaves the inbox only if it is still what
   * was sent: a newer value merged for the same key in the meantime is owed to
   * the renderer still.
   */
  acknowledgeLocalStorage(ops: readonly PendingLocalStorageOp[]): void {
    const statement = requireDatabase().prepare(
      "DELETE FROM sync_local_storage_inbox WHERE key = ? AND op = ? AND value IS ?"
    );
    for (const op of ops) {
      statement.run(op.key, op.op, op.op === "delete" ? null : op.value ?? "");
    }
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
    let changed = false;
    if (merger) {
      const merged = merger(this.#readRow(table, shape, recordId), row, context);
      row = merged.row;
      republish = merged.republish;
      changed = merged.changed;
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
      const updated = requireDatabase()
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
      if (updated > 0) {
        if (republish) this.#noteRepublish(table, recordId);
        if (changed) this.#noteContentChange(table, recordId, false);
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

    if (republish) this.#noteRepublish(table, recordId);
    // After the write, never before: an entry this schema refuses throws above,
    // and a change announced for a row that never landed would stop an
    // analysis over nothing.
    if (changed) this.#noteContentChange(table, recordId, false);
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
    const removed = requireDatabase()
      .prepare(`DELETE FROM ${table} WHERE ${where}`)
      .run(parts).changes;
    // A conversation deleted on another machine is the largest change its
    // content can have. Only a merging table is watched this way.
    if (removed > 0 && rowMergerFor(table)) {
      this.#noteContentChange(table, recordId, true);
    }
    if (itemisedColumn(table)) this.#published.clear(table, recordId);
  }

  /**
   * One element of an itemised row, put in place by its id.
   *
   * A row that is not here refuses the element rather than dropping it: the
   * row may be in a batch compacted away mid-pull, and a dropped element would
   * be stamped as held and skipped when the snapshot brings the row. Refused,
   * it is applied again then. A conversation deleted here refuses its elements
   * the same way, and compaction drops them.
   *
   * An element this machine edited after the one arriving is kept
   * (`outranks`), and its row is published again: the vault's newest copy is
   * now the older one, so this machine's — recorded as published when it was
   * first sent — is unrecorded and goes out again.
   */
  upsertItem(table: string, itemId: string, element: Record<string, unknown>): void {
    const target = this.#itemTarget(table, itemId);
    if (!target) throw new Error(`${table} ${itemId} has no row here`);
    const travelling = withElementId(element, target.id);
    const placed = placeElement(target.list, target.id, travelling);
    if (placed.kept) {
      this.#published.remove(table, target.recordId, target.id);
      this.#noteRepublish(table, target.recordId);
      return;
    }
    this.#published.set(table, target.recordId, target.id, elementHash(travelling));
    if (placed.list) this.#writeList(table, target, placed.list);
  }

  deleteItem(table: string, itemId: string): void {
    const target = this.#itemTarget(table, itemId);
    if (!target) return;
    const next = removeElement(target.list, target.id);
    this.#published.remove(table, target.recordId, target.id);
    if (next) this.#writeList(table, target, next);
  }

  #itemTarget(
    table: string,
    itemId: string
  ): { recordId: string; id: string; column: string; list: ListElement[] } | null {
    const column = itemisedColumn(table);
    if (!column) throw new Error(`${table} has no items`);
    const parts = splitItemRecordId(itemId);
    if (!parts) throw new Error(`Malformed item id for ${table}`);
    const [recordId, id] = parts;
    const shape = this.#shapeOf(table);
    const row = this.#readRow(table, shape, recordId);
    if (!row) return null;
    const list = parseList(row[column]);
    if (!list) throw new Error(`The ${column} of ${table} ${recordId} cannot be read`);
    return { recordId, id, column, list };
  }

  #writeList(
    table: string,
    target: { recordId: string; column: string },
    list: readonly ListElement[]
  ): void {
    const shape = this.#shapeOf(table);
    const keyMatch = shape.primaryKey.map((column) => `${column} = ?`).join(" AND ");
    requireDatabase()
      .prepare(`UPDATE ${table} SET ${target.column} = ? WHERE ${keyMatch}`)
      .run(JSON.stringify(list), ...target.recordId.split(RECORD_ID_SEPARATOR));
    this.#noteContentChange(table, target.recordId, false);
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

  /** One row per key: entries arrive in causal order, so the last write for a
   *  key is the one the renderer needs. */
  setLocalStorage(key: string, value: string): void {
    this.#writeInbox(key, "set", value);
  }

  deleteLocalStorage(key: string): void {
    this.#writeInbox(key, "delete", null);
  }

  /** Forget what waits for these keys: the renderer has a newer value of its
   *  own for each. */
  discardPendingLocalStorage(keys: readonly string[]): void {
    const statement = requireDatabase().prepare(
      "DELETE FROM sync_local_storage_inbox WHERE key = ?"
    );
    for (const key of keys) statement.run(key);
  }

  #writeInbox(key: string, op: "set" | "delete", value: string | null): void {
    requireDatabase()
      .prepare(
        `INSERT INTO sync_local_storage_inbox (key, op, value) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET op = excluded.op, value = excluded.value`
      )
      .run(key, op, value);
  }

  /** The record id for a row, matching what deleteRow expects. */
  recordIdFor(table: string, row: Record<string, unknown>): string {
    return this.#shapeOf(table)
      .primaryKey.map((column) => String(row[column]))
      .join(RECORD_ID_SEPARATOR);
  }
}
