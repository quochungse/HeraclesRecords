// Changes this machine has made and the vault has not confirmed.
//
// `SyncLoop.#pending` was an array, and an array is lost with the process. What
// that cost was not obvious, because the write itself was never in danger — it
// is in SQLite before an entry is even built. What was lost was the vault's
// only notice of it, and the loop had no way to discover that: `seedVaultIfNeeded`
// runs once per vault id and nothing else ever compares this machine's data
// against the log.
//
// So the two copies diverge in silence, and the next edit from the other
// machine settles it the wrong way. That machine's entry is built from the
// stale copy it holds, carries a newer HLC, and wins — deleting a change the
// vault was never told about. `before-quit` flushing the queue narrowed the
// window and could not close it: `flushBeforeQuit` makes one attempt and
// returns instantly when the machine is offline, which is exactly when the
// queue is most likely to be full.
//
// The fix is for the queue to be a table. An entry is durable the moment it is
// queued and is removed only when the upload it went out in returned. A launch
// picks up whatever the last one did not finish.
//
// Never leaves the machine: `sync_outbox` is `device` in TABLE_POLICY, and it
// is written through `requireDatabase()` rather than the hooked writers, so
// queueing a change cannot itself queue a change.

import { requireDatabase } from "../database";
import { compareHlcStrings } from "./hlc";
import { entryIdentity, isValidEntry, type OpEntry } from "./oplog";

export interface OutboxStore {
  /** Everything still unconfirmed, in causal order. */
  load(): OpEntry[];
  add(entries: readonly OpEntry[]): void;
  /** Confirmed as written to the vault. */
  remove(entries: readonly OpEntry[]): void;
}

/** For suites, and for a loop with no database behind it. */
export function createMemoryOutbox(): OutboxStore {
  let held: OpEntry[] = [];
  return {
    load: () => [...held],
    add: (entries) => {
      held = supersede([...held, ...entries]);
    },
    remove: (entries) => {
      const gone = new Set(entries.map((entry) => entry.hlc));
      held = held.filter((entry) => !gone.has(entry.hlc));
    }
  };
}

/**
 * Keep only the newest entry per destination.
 *
 * Last-writer-wins means an older entry for the same record is already dead: no
 * reader will ever choose it. Holding it would make an app left offline for a
 * day queue one copy of a conversation per turn, and upload all of them.
 *
 * Applied to the queue, not to the log — what has already gone out stays out.
 */
function supersede(entries: readonly OpEntry[]): OpEntry[] {
  const newest = new Map<string, OpEntry>();
  for (const entry of entries) {
    const identity = entryIdentity(entry);
    const current = newest.get(identity);
    if (!current || compareHlcStrings(entry.hlc, current.hlc) > 0) {
      newest.set(identity, entry);
    }
  }
  return [...newest.values()].sort((a, b) => compareHlcStrings(a.hlc, b.hlc));
}

export function createSqliteOutbox(): OutboxStore {
  const db = () => requireDatabase();
  return {
    load: () => {
      const rows = db()
        .prepare("SELECT entry_json FROM sync_outbox ORDER BY hlc")
        .all() as { entry_json: string }[];
      const entries: OpEntry[] = [];
      for (const row of rows) {
        try {
          const parsed: unknown = JSON.parse(row.entry_json);
          // Written by a build whose entry shape differed, or truncated. One
          // unreadable row must not stop the rest of the queue going out.
          if (isValidEntry(parsed)) entries.push(parsed);
        } catch {
          // Same.
        }
      }
      return supersede(entries);
    },
    add: (entries) => {
      if (entries.length === 0) return;
      const insert = db().prepare(
        `INSERT INTO sync_outbox (hlc, identity, entry_json)
         VALUES (?, ?, ?)
         ON CONFLICT(hlc) DO UPDATE SET entry_json = excluded.entry_json`
      );
      // Superseded rows go at the same time, in the same transaction: a crash
      // between the two would leave the queue holding a copy of a conversation
      // it has already moved past, which is only wasted upload — but the
      // transaction costs nothing and keeps the table's one invariant true.
      const drop = db().prepare(
        "DELETE FROM sync_outbox WHERE identity = ? AND hlc < ?"
      );
      db().transaction(() => {
        for (const entry of entries) {
          const identity = entryIdentity(entry);
          insert.run(entry.hlc, identity, JSON.stringify(entry));
          drop.run(identity, entry.hlc);
        }
      })();
    },
    remove: (entries) => {
      if (entries.length === 0) return;
      const statement = db().prepare("DELETE FROM sync_outbox WHERE hlc = ?");
      db().transaction(() => {
        for (const entry of entries) statement.run(entry.hlc);
      })();
    }
  };
}
