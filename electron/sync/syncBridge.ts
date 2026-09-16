// Where the rest of the app tells the sync loop that something changed.
//
// Two choke points cover almost everything worth syncing:
//
//   * `database.setSetting` / `deleteSettings` — every settings key in the app
//     goes through these, so one hook covers the whole `preference` tier plus
//     the handful of `personal` keys, with no store having to remember.
//   * `chatHistoryStore.saveChatSession` — already the turn boundary, because
//     the renderer batches a conversation before persisting it. Hooking here
//     rather than at the stream means a reply becomes one entry, not one per
//     token.
//
// Everything is a no-op until a loop is attached, so the app runs exactly as
// before when sync is off. That matters more than it
// looks: these hooks sit on the hot path of ordinary settings writes, and must
// never be able to fail an operation that has nothing to do with sync.
//
// Inbound changes do **not** echo back out. SqliteSyncTarget and applySnapshot
// write through `requireDatabase().prepare(...)` directly rather than through
// `setSetting`, so merged entries never reach these hooks and cannot bounce
// between two devices forever.

import { ChangeBuilder } from "./syncEngine";
import type { OpEntry } from "./oplog";

export interface ChangeSink {
  readonly enqueue: (entries: readonly OpEntry[]) => void;
  readonly nextHlc: () => string;
}

let sink: ChangeSink | null = null;

/**
 * Changes made before a loop existed to take them, newest per destination.
 *
 * The loop is built by `prepareSync()`, which at start-up waits on the COROS
 * re-login first — the vault's owner is the account, so it has to. That is a
 * network round trip, and until it returns these hooks had nowhere to put a
 * change and dropped it: a write in that window reached SQLite and never
 * reached the vault at all, with nothing anywhere recording that it had not.
 *
 * It is a short window and it matters twice over. The write is unpublished, so
 * the vault's newest copy of that row is an older one — and `recordVersions`
 * only learns what this machine holds from `enqueue`, so an unqueued write
 * leaves no stamp either, and the first pull would merge that older copy
 * straight over it. Holding the change until a sink arrives fixes both: it is
 * published, and it is stamped.
 *
 * Keyed by destination so a settings key written fifty times before the vault
 * opened replays once. A replayed entry is timestamped when it replays, which
 * is correct — an HLC orders writes against other devices, and this device has
 * issued nothing in between.
 */
const deferred = new Map<string, (builder: ChangeBuilder) => void>();

/**
 * Bounded, because a machine whose vault never opens must not grow a queue for
 * the life of the process. Distinct destinations, not writes, so reaching this
 * takes a genuinely busy start-up rather than a loop over one key.
 */
const MAX_DEFERRED = 500;

/**
 * Whether anything has decided yet whether this process has a vault.
 *
 * `prepareSync()` always runs at start-up and always ends in one of these calls,
 * so this is false for exactly the boot window and nothing else. After it, a
 * missing sink means sync is off rather than not ready, and a change with
 * nowhere to go is dropped as it always was — holding one for a machine that
 * has no vault would be a queue for the life of the process.
 */
let sinkDecided = false;

/** Attach the running loop, or say there will not be one. Always called by
 *  `prepareSync()`, which is what closes the boot window above. */
export function attachSyncSink(next: ChangeSink | null): void {
  sink = next;
  sinkDecided = true;
  if (deferred.size === 0) return;
  const held = [...deferred.values()];
  deferred.clear();
  // Only a real sink replays them. Told there is no vault, they are dropped:
  // there is nowhere for them to go and no later moment that changes that.
  if (sink) for (const fill of held) build(fill);
}

export function isSyncAttached(): boolean {
  return sink !== null;
}

/** Test seam: the destinations waiting for a sink. */
export function deferredChangeCount(): number {
  return deferred.size;
}

/** Test seam: put the process back in the boot window. */
export function resetSyncSinkForTests(): void {
  sink = null;
  sinkDecided = false;
  deferred.clear();
}

/**
 * A timestamp for the probe below, never for an entry anyone keeps.
 *
 * Well-formed so it cannot be mistaken for a bug if it ever surfaces in a log,
 * and all zeroes so it sorts before every real one.
 */
const PROBE_HLC = "000000000000-0000-0000000000000000";

/**
 * Whether a change would survive policy, asked without a sink to mint for it.
 *
 * The point is what it is *not*: a second copy of the rule. `ChangeBuilder` is
 * the only thing that decides what may leave this machine, so the probe runs
 * the caller's own fill through one and throws the result away. Without this a
 * credential written during the boot window would sit in the deferred map for
 * the length of it — refused at replay, certainly, but held in a sync buffer in
 * the meantime, which is not where this project puts one.
 */
function wouldTravel(fill: (builder: ChangeBuilder) => void): boolean {
  try {
    const probe = new ChangeBuilder({ nextHlc: () => PROBE_HLC });
    fill(probe);
    return probe.entries.length > 0;
  } catch {
    return false;
  }
}

function build(fill: (builder: ChangeBuilder) => void, identity?: string): void {
  if (!sink) {
    // Only what a sink could have carried, and only while it is still unknown
    // whether one is coming. Without an identity there is nothing to replace a
    // second write with, and a queue that grew per write rather than per
    // destination would hold whole transcripts.
    if (sinkDecided || identity === undefined) return;
    if (!wouldTravel(fill)) return;
    // Re-inserted rather than updated, so the map keeps write order: a replay
    // has to reach the vault in the order the writes happened.
    deferred.delete(identity);
    deferred.set(identity, fill);
    if (deferred.size > MAX_DEFERRED) {
      const oldest = deferred.keys().next();
      if (!oldest.done) deferred.delete(oldest.value);
    }
    return;
  }
  try {
    const builder = new ChangeBuilder({ nextHlc: sink.nextHlc });
    fill(builder);
    // ChangeBuilder drops anything policy refuses, so a `device`-tier key
    // reaching here — every credential in the app included — simply produces
    // nothing.
    if (builder.entries.length > 0) sink.enqueue(builder.entries);
  } catch (error) {
    // A sync problem must never break the write that triggered it. The loop
    // will pick the change up on its next full pass either way.
    console.warn("[sync] could not queue a change", error);
  }
}

export function notifySettingChanged(key: string, value: string): void {
  build((builder) => builder.setting(key, value), `setting:${key}`);
}

export function notifySettingsDeleted(keys: readonly string[]): void {
  for (const key of keys) {
    build((builder) => builder.deleteSetting(key), `setting:${key}`);
  }
}

export function notifyRowChanged(
  table: string,
  recordId: string,
  row: Record<string, unknown>
): void {
  build((builder) => builder.row(table, recordId, row), `table:${table}:${recordId}`);
}

export function notifyRowDeleted(table: string, recordId: string): void {
  build((builder) => builder.deleteRow(table, recordId), `table:${table}:${recordId}`);
}
