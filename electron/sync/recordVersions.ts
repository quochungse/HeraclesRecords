// What this machine's database currently holds, per synced destination.
//
// The merge had no way to ask this. `applyEntries` resolves entries against
// each other — last writer wins over whatever the log contained — and
// `SqliteSyncTarget.upsertRow` is an unconditional `INSERT OR REPLACE`. Nothing
// anywhere compared a winning entry against the row it was about to replace,
// because SQLite kept no timestamp per row. That is what this file adds, and
// the hazard it closes was measured rather than imagined:
//
//   A pull is a full read of the log over the network and takes as long as the
//   link does. A headless analysis run finished inside one, wrote its answer
//   into a conversation and queued it for the vault. The pull had read the log
//   *before* that write existed, so the newest copy it knew of was the one
//   another machine had published two days earlier — which it then wrote over
//   the answer. The vault ended up holding the good copy (the queued entry went
//   out moments later) while this machine held the stale one, and the athlete's
//   run log said the analysis had succeeded.
//
// Two guards used to stand in for this one and neither could do the job:
//
//   * `authoredHere` — skip anything this device wrote. It covers the case
//     where the pull's snapshot *does* contain our entry, and nothing else. It
//     is also the reason the loss above was permanent: once the row had been
//     rewound, the winning entry for it was this device's own, so the skip fired
//     on every pull thereafter and the good copy sitting in the vault could
//     never come back.
//   * `#merged` — an in-memory note of what this process already applied. Empty
//     after every launch, so the whole log was re-merged on each first pull,
//     which is exactly when the race above is live.
//
// A stamp here is the one fact both needed: the HLC of the write that put the
// current contents there, whoever made it. An entry is applied only when it is
// causally later than that, which makes an own entry skippable *because* it is
// not newer rather than because of who wrote it — so recovery works, and so
// does the every-launch suppression, durably.
//
// It never travels. It describes this copy of the data rather than the data,
// and `sync_record_versions` is `device` in TABLE_POLICY.

import { requireDatabase } from "../database";
import { isNewer } from "./hlc";

export interface RecordVersionStore {
  /** The HLC of the write the local state came from, if it is known. */
  get(identity: string): string | undefined;
  /** Record that `identity` now holds what `hlc` carried. */
  set(identity: string, hlc: string): void;
}

/**
 * True when `entry` carries something this machine does not already hold.
 *
 * An unknown identity reads as "apply". That is the safe direction and the
 * useful one: a fresh install has nothing, and a machine upgrading into this
 * file has nothing either — so the first pull after the upgrade re-merges the
 * log once and repairs whatever the old guards rewound, because the vault still
 * holds it.
 */
export function shouldApply(
  store: RecordVersionStore,
  identity: string,
  hlc: string
): boolean {
  return isNewer(hlc, store.get(identity));
}

/** For suites, and for a loop running before a database exists. */
export function createMemoryRecordVersions(): RecordVersionStore {
  const held = new Map<string, string>();
  return {
    get: (identity) => held.get(identity),
    set: (identity, hlc) => {
      held.set(identity, hlc);
    }
  };
}

/**
 * The real one, read once into memory and written through.
 *
 * Every entry of every pull asks `get`, and a pull reads the whole log, so the
 * question is asked hundreds of times a poll for an answer that only this
 * process changes. The cache is not an optimisation of a slow query so much as
 * a way to keep the guard free enough that nobody is tempted to narrow it.
 */
export function createSqliteRecordVersions(): RecordVersionStore {
  const cache = new Map<string, string>();
  let loaded = false;

  const load = (): void => {
    if (loaded) return;
    const rows = requireDatabase()
      .prepare("SELECT identity, hlc FROM sync_record_versions")
      .all() as { identity: string; hlc: string }[];
    for (const row of rows) cache.set(row.identity, row.hlc);
    loaded = true;
  };

  return {
    get: (identity) => {
      load();
      return cache.get(identity);
    },
    set: (identity, hlc) => {
      load();
      // Monotonic. A stamp is a claim about what the row holds, and two writers
      // reach here — the merge and this device's own writes — so an out-of-order
      // call must not walk it backwards and re-open the window it closes.
      if (!isNewer(hlc, cache.get(identity))) return;
      cache.set(identity, hlc);
      requireDatabase()
        .prepare(
          `INSERT INTO sync_record_versions (identity, hlc)
           VALUES (?, ?)
           ON CONFLICT(identity) DO UPDATE SET hlc = excluded.hlc`
        )
        .run(identity, hlc);
    }
  };
}
