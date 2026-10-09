// How far this machine has read each device's log (vault format 2).
//
// Per device: the last batch applied, and the head last seen — its revision,
// so an unchanged head is not fetched again, and the number it said. `device`
// tier (`sync_vector`): it describes this copy. Saved in the merge's
// transaction, so a crash re-reads batches rather than skipping them.

import { requireDatabase } from "../database";

export interface VectorRecord {
  /** The last batch of this device applied here. */
  readonly seq: number;
  /** What its head said when last read, and the head's revision then. */
  readonly headSeq: number;
  readonly headRevision: string | null;
}

export interface VectorStore {
  load(): Map<string, VectorRecord>;
  save(records: ReadonlyMap<string, VectorRecord>): void;
  /** Forget everything: the next pull starts from the snapshot. */
  clear(): void;
}

export function createMemoryVectorStore(): VectorStore {
  let held = new Map<string, VectorRecord>();
  return {
    load: () => new Map(held),
    save: (records) => {
      held = new Map(records);
    },
    clear: () => {
      held = new Map();
    }
  };
}

export function createSqliteVectorStore(): VectorStore {
  const db = () => requireDatabase();
  return {
    load: () => {
      const rows = db()
        .prepare("SELECT device, seq, head_seq, head_revision FROM sync_vector")
        .all() as { device: string; seq: number; head_seq: number; head_revision: string | null }[];
      return new Map(
        rows.map((row) => [
          row.device,
          { seq: row.seq, headSeq: row.head_seq, headRevision: row.head_revision }
        ])
      );
    },
    save: (records) => {
      const statement = db().prepare(
        `INSERT INTO sync_vector (device, seq, head_seq, head_revision) VALUES (?, ?, ?, ?)
         ON CONFLICT(device) DO UPDATE SET seq = excluded.seq,
           head_seq = excluded.head_seq, head_revision = excluded.head_revision`
      );
      for (const [device, record] of records) {
        statement.run(device, record.seq, record.headSeq, record.headRevision);
      }
    },
    clear: () => {
      db().prepare("DELETE FROM sync_vector").run();
    }
  };
}
