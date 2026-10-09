// A coach conversation travels as a record per message (vault format 2).
//
// `chat_sessions.messages_json` is the whole transcript in one column, so a row
// entry carried all of it: one more question in an 823 KB conversation sent
// 823 KB, and two machines writing to one conversation needed a merge that
// built a row neither had written. Split, every record follows the one rule —
// last writer wins, whole — and a turn sends the turn (docs/sync-v2.md §4.1).
//
// In SQLite nothing changes: the column stays, the chat store and the renderer
// read it as before. Only what goes to and comes from the vault is split:
//
//   * **out** — `splitIntoItems` turns a row entry into the row without the
//     column, plus an `item` entry for each element whose content differs from
//     what was last published (and a delete for each one no longer there),
//     against `PublishedItemStore`;
//   * **in** — `SqliteSyncTarget.upsertItem` / `deleteItem` put one element in
//     place by its id, and record it as published, so the next save of the
//     conversation does not send back what just arrived.

import crypto from "node:crypto";

import { requireDatabase } from "../database";
import type { OpEntry } from "./oplog";
import { transcriptEntryId } from "./rowMergers";
import { RECORD_ID_SEPARATOR } from "./syncPolicy";
import type { PersistedChatEntry } from "../types";

/** The tables whose list column travels as items, and which column it is. */
export const ITEMISED_COLUMNS: Readonly<Record<string, string>> = {
  chat_sessions: "messages_json"
};

export function itemisedColumn(table: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(ITEMISED_COLUMNS, table)
    ? ITEMISED_COLUMNS[table]
    : undefined;
}

export type ListElement = Record<string, unknown>;

/** An element's id: its `mid`, or for one written before ids existed, the
 *  position-and-content id the transcript merge has always given it. */
export function elementId(element: ListElement, index: number): string {
  return transcriptEntryId(element as unknown as PersistedChatEntry, index);
}

/** The element as it travels: carrying its id, so the other side files it
 *  under the same one. */
export function withElementId(element: ListElement, id: string): ListElement {
  return element.mid === id ? element : { ...element, mid: id };
}

export function elementHash(element: ListElement): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(element))
    .digest("hex")
    .slice(0, 32);
}

export function itemRecordId(recordId: string, id: string): string {
  return `${recordId}${RECORD_ID_SEPARATOR}${id}`;
}

/** `[row id, element id]` of an item, or null for one that names no element.
 *  Split at the last separator: an element id never holds one. */
export function splitItemRecordId(itemId: string): [string, string] | null {
  const at = itemId.lastIndexOf(RECORD_ID_SEPARATOR);
  if (at <= 0 || at === itemId.length - 1) return null;
  return [itemId.slice(0, at), itemId.slice(at + 1)];
}

export function parseList(value: unknown): ListElement[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((element) => element && typeof element === "object" && !Array.isArray(element))
      ? (parsed as ListElement[])
      : null;
  } catch {
    return null;
  }
}

/** What this machine last published, or received, for each element. */
export interface PublishedItemStore {
  forRecord(table: string, recordId: string): Map<string, string>;
  set(table: string, recordId: string, id: string, hash: string): void;
  remove(table: string, recordId: string, id: string): void;
  clear(table: string, recordId: string): void;
}

export function createMemoryPublishedItems(): PublishedItemStore {
  const held = new Map<string, Map<string, string>>();
  const key = (table: string, recordId: string) => `${table}\u0000${recordId}`;
  return {
    forRecord: (table, recordId) => new Map(held.get(key(table, recordId)) ?? []),
    set: (table, recordId, id, hash) => {
      const k = key(table, recordId);
      const items = held.get(k) ?? new Map<string, string>();
      items.set(id, hash);
      held.set(k, items);
    },
    remove: (table, recordId, id) => {
      held.get(key(table, recordId))?.delete(id);
    },
    clear: (table, recordId) => {
      held.delete(key(table, recordId));
    }
  };
}

/** `sync_published_items`, `device` tier: what this copy has sent or taken. */
export function createSqlitePublishedItems(): PublishedItemStore {
  const db = () => requireDatabase();
  return {
    forRecord: (table, recordId) => {
      const rows = db()
        .prepare(
          "SELECT item_id, hash FROM sync_published_items WHERE table_name = ? AND record_id = ?"
        )
        .all(table, recordId) as { item_id: string; hash: string }[];
      return new Map(rows.map((row) => [row.item_id, row.hash]));
    },
    set: (table, recordId, id, hash) => {
      db()
        .prepare(
          `INSERT INTO sync_published_items (table_name, record_id, item_id, hash)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(table_name, record_id, item_id) DO UPDATE SET hash = excluded.hash`
        )
        .run(table, recordId, id, hash);
    },
    remove: (table, recordId, id) => {
      db()
        .prepare(
          "DELETE FROM sync_published_items WHERE table_name = ? AND record_id = ? AND item_id = ?"
        )
        .run(table, recordId, id);
    },
    clear: (table, recordId) => {
      db()
        .prepare("DELETE FROM sync_published_items WHERE table_name = ? AND record_id = ?")
        .run(table, recordId);
    }
  };
}

/**
 * Entries as they go out in format 2: a row of an itemised table without its
 * list column, then an item for each element that changed since it was last
 * published and a delete for each that is gone. Everything else passes through.
 *
 * The row keeps its own timestamp and the items are stamped after it, so a
 * reader applying in causal order meets the row before its elements. A list
 * that cannot be parsed sends the row alone: the elements are not this
 * function's to guess at.
 */
export function splitIntoItems(
  entries: readonly OpEntry[],
  published: PublishedItemStore,
  nextHlc: () => string,
  options: {
    /** The timestamp an element goes out under. Fresh by default; a migration
     *  passes the row's own, so the elements are no newer than what they came
     *  from. */
    readonly itemHlc?: (row: OpEntry) => string;
  } = {}
): OpEntry[] {
  const stampFor = (row: OpEntry) => (options.itemHlc ? options.itemHlc(row) : nextHlc());
  const out: OpEntry[] = [];
  for (const entry of entries) {
    const column = entry.scope === "table" ? itemisedColumn(entry.key) : undefined;
    if (!column || !entry.recordId) {
      out.push(entry);
      continue;
    }
    const table = entry.key;
    const recordId = entry.recordId;

    if (entry.op === "delete") {
      out.push(entry);
      for (const id of published.forRecord(table, recordId).keys()) {
        out.push({ hlc: nextHlc(), op: "delete", scope: "item", key: table, recordId: itemRecordId(recordId, id) });
      }
      published.clear(table, recordId);
      continue;
    }

    const payload = entry.payload ?? {};
    if (!(column in payload)) {
      out.push(entry);
      continue;
    }
    const { [column]: listValue, ...row } = payload;
    out.push({ ...entry, payload: row });
    const list = parseList(listValue);
    if (!list) continue;

    const before = published.forRecord(table, recordId);
    const present = new Set<string>();
    list.forEach((element, index) => {
      const id = elementId(element, index);
      present.add(id);
      const travelling = withElementId(element, id);
      const hash = elementHash(travelling);
      if (before.get(id) === hash) return;
      out.push({
        hlc: stampFor(entry),
        op: "set",
        scope: "item",
        key: table,
        recordId: itemRecordId(recordId, id),
        payload: { entry: travelling }
      });
      published.set(table, recordId, id, hash);
    });
    for (const id of before.keys()) {
      if (present.has(id)) continue;
      out.push({ hlc: nextHlc(), op: "delete", scope: "item", key: table, recordId: itemRecordId(recordId, id) });
      published.remove(table, recordId, id);
    }
  }
  return out;
}

/** Put one element in place by its id: replaced where it is, or inserted in id
 *  order, which is the order the transcript merge has always kept. Returns
 *  null when the list already holds exactly this. */
export function placeElement(
  list: readonly ListElement[],
  id: string,
  element: ListElement
): ListElement[] | null {
  const ids = list.map((existing, index) => elementId(existing, index));
  const at = ids.indexOf(id);
  if (at >= 0) {
    if (JSON.stringify(list[at]) === JSON.stringify(element)) return null;
    const next = [...list];
    next[at] = element;
    return next;
  }
  const after = ids.findIndex((existing) => existing > id);
  const next = [...list];
  next.splice(after < 0 ? next.length : after, 0, element);
  return next;
}

/** The list without the element of this id, or null when it is not there. */
export function removeElement(
  list: readonly ListElement[],
  id: string
): ListElement[] | null {
  const ids = list.map((existing, index) => elementId(existing, index));
  const at = ids.indexOf(id);
  if (at < 0) return null;
  return [...list.slice(0, at), ...list.slice(at + 1)];
}
