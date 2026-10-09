// Which files of the log this machine has already read.
//
// A pull used to download the whole log — the snapshot and every batch — every
// few seconds, to find out what it already had: `recordVersions` turned all of
// it into no-ops, but only after it had crossed the network. The files are
// immutable (see `listLogFiles`), so a path and revision read once never needs
// reading again, and that is all this records.
//
// Skipping a file is safe exactly when reading it again would change nothing,
// so a file is `done` only when every entry in it has been dealt with for
// good: applied, found already held, or refused for a reason no later build
// could undo. Everything else this build leaves for a later reading is `retry`,
// re-read once per launch — the behaviour the loop already promised for those
// entries when every pull read everything (see `SyncLoop.#localStorageMerged`):
//
//   * a `localStorage` entry, which only queues work for the renderer and is
//     owed again if the app quits before a window takes it;
//   * a row the target could take only part of — columns this build has no
//     schema for;
//   * an entry this build does not classify, or a table it will not sync,
//     which a newer build may;
//   * one the target threw on.
//
// Never leaves the machine: `sync_read_files` is `device` in TABLE_POLICY — it
// describes this copy, and carried to another machine it would claim reads that
// machine never made. Written through `requireDatabase()`, so recording a read
// cannot queue a change.

import { requireDatabase } from "../database";

export type ReadState = "done" | "retry";

export interface ReadRecord {
  readonly path: string;
  readonly revision: string;
  readonly state: ReadState;
  /** The launch that read it. A `retry` file is read again by any other. */
  readonly readBy: string;
  readonly readAt: number;
}

export interface ReadIndexStore {
  /** Everything recorded, read fresh: called once at the start of a pull. */
  load(): Map<string, ReadRecord>;
  /** Called inside the merge's transaction, so a read is recorded exactly
   *  when what it read has landed. */
  record(records: readonly ReadRecord[]): void;
  /** Drop the records of files no longer in the vault: compaction deleted
   *  them, and a path is never reused. */
  forget(paths: readonly string[]): void;
}

/** Whether a file needs reading, given what was recorded for it. */
export function needsRead(
  recorded: ReadRecord | undefined,
  revision: string,
  launch: string
): boolean {
  if (!recorded || recorded.revision !== revision) return true;
  return recorded.state === "retry" && recorded.readBy !== launch;
}

/**
 * For suites, and for a loop with no database behind it. Empty at every
 * launch, which is what every pull used to be: the first one reads the whole
 * log, and only the ones after it are incremental.
 */
export function createMemoryReadIndex(): ReadIndexStore {
  const held = new Map<string, ReadRecord>();
  return {
    load: () => new Map(held),
    record: (records) => {
      for (const record of records) held.set(record.path, record);
    },
    forget: (paths) => {
      for (const path of paths) held.delete(path);
    }
  };
}

export function createSqliteReadIndex(): ReadIndexStore {
  const db = () => requireDatabase();
  return {
    load: () => {
      const rows = db()
        .prepare(
          "SELECT path, revision, state, read_by, read_at FROM sync_read_files"
        )
        .all() as {
        path: string;
        revision: string;
        state: string;
        read_by: string;
        read_at: number;
      }[];
      const out = new Map<string, ReadRecord>();
      for (const row of rows) {
        out.set(row.path, {
          path: row.path,
          revision: row.revision,
          // Anything but `done` is read again: an unknown state is a reason to
          // look, never a reason to skip.
          state: row.state === "done" ? "done" : "retry",
          readBy: row.read_by,
          readAt: row.read_at
        });
      }
      return out;
    },
    record: (records) => {
      const statement = db().prepare(
        `INSERT INTO sync_read_files (path, revision, state, read_by, read_at)
         VALUES (@path, @revision, @state, @readBy, @readAt)
         ON CONFLICT(path) DO UPDATE SET
           revision = excluded.revision,
           state = excluded.state,
           read_by = excluded.read_by,
           read_at = excluded.read_at`
      );
      for (const record of records) statement.run(record);
    },
    forget: (paths) => {
      const statement = db().prepare("DELETE FROM sync_read_files WHERE path = ?");
      for (const path of paths) statement.run(path);
    }
  };
}
