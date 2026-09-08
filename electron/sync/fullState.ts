// Republishing everything this machine holds, as ordinary oplog changes.
//
// The oplog is a log of *changes*, so it only ever knew about a record that
// was written while sync was running. That leaves two moments where the log
// and the database disagree about what is true, and both of them are silent:
//
//   * **Switching sync on.** Months of conversations, plans and routes already
//     sit in SQLite, and none of them were ever a change. Without this, the
//     second machine joins an empty account and the person watches nothing
//     arrive.
//   * **Finishing a restore.** `applySnapshot` writes through the raw database
//     precisely so a merge cannot echo back out — which also means a restore
//     mints no timestamps and, to the merge rules, never happened. The log
//     still holds whatever it held, and the next pull puts it all back.
//
// One answer serves both: state the whole of what is here, now, with fresh
// timestamps. Because every entry is minted at publish time it outranks
// anything already in the log, so this is how a machine says "this is the
// truth" rather than merely "here is another opinion".
//
// **Publishing is a union, not a takeover.** Records are identified by their
// primary key, so two machines that both publish converge on the union of what
// they hold; only a genuine id collision picks a winner, and then the two
// copies are almost always the same record anyway. That is what makes it safe
// to run on a machine that already has data.
//
// Removals are the exception and have to be asked for. A `set` for everything
// present says nothing about what is absent, so a caller that has *deleted*
// things — a restore — passes what it had beforehand and gets tombstones for
// the difference.

import { requireDatabase } from "../database";
import type { OpEntry } from "./oplog";
import {
  primaryKeyOf,
  readRows,
  recordId,
  syncableTables
} from "./syncableStore";
import { ChangeBuilder } from "./syncEngine";

/**
 * What this machine currently holds, named the way the oplog names it.
 *
 * Only identities, never payloads: it exists to be diffed against a later
 * capture, and holding whole rows would mean keeping a second copy of the
 * database in memory to answer a question about which keys went away.
 */
export interface SyncableStateCapture {
  /** table -> record ids present. */
  readonly rows: ReadonlyMap<string, ReadonlySet<string>>;
  readonly settings: ReadonlySet<string>;
}

export function captureSyncableState(): SyncableStateCapture {
  const rows = new Map<string, Set<string>>();
  for (const table of syncableTables()) {
    const key = primaryKeyOf(table);
    // A table with no primary key cannot be addressed by the oplog at all —
    // `SqliteSyncTarget` refuses to write into one — so there is nothing here
    // to publish or to tombstone.
    if (key.length === 0) continue;
    rows.set(
      table,
      new Set(readRows(table).map((row) => recordId(row, key)))
    );
  }

  const settings = new Set(
    (
      requireDatabase().prepare("SELECT key FROM app_settings").all() as Array<{
        key: string;
      }>
    ).map((row) => row.key)
  );

  return { rows, settings };
}

export interface FullStateOptions {
  /**
   * What the machine held before whatever just changed it.
   *
   * Anything in here and not here any more becomes a tombstone. Omit it when
   * publishing an untouched machine — seeding deletes nothing, and inventing
   * tombstones from an empty "before" would tell the other device to drop
   * every record it has.
   */
  readonly before?: SyncableStateCapture;
}

/**
 * Every syncable thing on this machine, as entries ready to enqueue.
 *
 * Built through `ChangeBuilder`, which is the point rather than a convenience:
 * it applies `syncPolicy` per destination, so a `device`-tier row or a
 * keychain-sealed setting is dropped here exactly as it would be on any other
 * path. There is no way to publish more than an ordinary edit could.
 *
 * localStorage is absent, and cannot be otherwise: it lives in the renderer,
 * which the main process cannot read. The renderer publishes its own half by
 * comparing against the last snapshot it sent.
 */
export function collectFullStateEntries(
  nextHlc: () => string,
  options: FullStateOptions = {}
): readonly OpEntry[] {
  const builder = new ChangeBuilder({ nextHlc });

  const present = new Map<string, Set<string>>();
  for (const table of syncableTables()) {
    const key = primaryKeyOf(table);
    if (key.length === 0) continue;
    const ids = new Set<string>();
    for (const row of readRows(table)) {
      const id = recordId(row, key);
      ids.add(id);
      builder.row(table, id, row);
    }
    present.set(table, ids);
  }

  const settings = requireDatabase()
    .prepare("SELECT key, value FROM app_settings")
    .all() as Array<{ key: string; value: string }>;
  for (const { key, value } of settings) {
    builder.setting(key, value);
  }

  const before = options.before;
  if (before) {
    for (const [table, ids] of before.rows) {
      const kept = present.get(table);
      for (const id of ids) {
        if (kept?.has(id)) continue;
        builder.deleteRow(table, id);
      }
    }
    const keptSettings = new Set(settings.map((row) => row.key));
    for (const key of before.settings) {
      if (keptSettings.has(key)) continue;
      builder.deleteSetting(key);
    }
  }

  return builder.entries;
}

/** Where published entries go. Narrowed to what this module uses so it does
 *  not have to import `SyncLoop` and everything that reaches. `flush` reports
 *  what actually left the machine, which is the only way to tell an upload from
 *  a queue that silently kept everything. */
export interface FullStateSink {
  readonly enqueue: (entries: readonly OpEntry[]) => void;
  readonly flush: () => Promise<{ readonly pushed: number }>;
}

/**
 * How many entries go into one uploaded batch.
 *
 * A batch is a single object in the vault, and a full publish can carry every
 * chat transcript the person owns — tens of megabytes in one PUT, retried from
 * the beginning on any network hiccup. Chunking turns that into uploads that
 * can fail and be retried individually, and lets the second machine start
 * receiving before the first has finished sending.
 */
export const PUBLISH_CHUNK_SIZE = 200;

export interface PublishFullStateResult {
  readonly entries: number;
  readonly batches: number;
}

/**
 * Publish in uploadable pieces. Entries keep the order they were minted in, so
 * the log stays causally sensible even split across batches.
 *
 * **Throws the moment a batch does not go out.** A flush that finds the machine
 * offline, or whose upload fails, keeps the entries queued and reports nothing
 * pushed — and returning normally there is what let the callers record the
 * vault as seeded over a publish that never happened. The queue is in memory,
 * so quitting before it drained left months of history on this computer with
 * the flag saying it had been sent.
 *
 * Carrying on to the next chunk would be wrong for a second reason: `flush`
 * keeps the unsent batch, so every following chunk piles onto the same queue
 * and the whole publish ends up in one PUT — exactly what chunking exists to
 * avoid.
 */
export async function publishFullState(
  sink: FullStateSink,
  entries: readonly OpEntry[]
): Promise<PublishFullStateResult> {
  let batches = 0;
  for (let index = 0; index < entries.length; index += PUBLISH_CHUNK_SIZE) {
    sink.enqueue(entries.slice(index, index + PUBLISH_CHUNK_SIZE));
    const { pushed } = await sink.flush();
    if (pushed === 0) {
      throw new Error(
        `Publishing this machine's data stopped after ${batches} of ` +
          `${Math.ceil(entries.length / PUBLISH_CHUNK_SIZE)} batches: the ` +
          "destination did not take the next one. The entries stay queued and " +
          "the next attempt starts over."
      );
    }
    batches += 1;
  }
  return { entries: entries.length, batches };
}
