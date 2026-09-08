// The append-only log every device writes its changes into.
//
// Layout:
//
//   oplog/<deviceId>/<hlc>.jsonl          one batch of entries, named by its
//                                         first
//   oplog-snapshot/<hlc>.json             periodic compaction of everything
//                                         before
//
// **`oplog-snapshot/`, not `snapshot/`, and not under `oplog/`.** Both
// constraints are load-bearing:
//
//   * `snapshot/` belongs to `syncService`, which keeps whole-state *backups*
//     there — a different feature with a different file format that the user
//     creates and restores by hand. The two shared that prefix once, and
//     `readLatestOplogSnapshot` below picked whichever path sorted last: an
//     HLC name is hex and starts with `0`, a backup name is an ISO date and
//     starts with `2`, so a backup won every time and compaction always looked
//     as though it had never run. Nothing had wired compaction up yet, so
//     nothing broke — it was waiting to.
//   * Under `oplog/` it would land in `storage.list(OPLOG_ROOT)` and
//     `readAllEntries` would try to parse a compaction snapshot as JSONL.
//     `isUnderPrefix` matches whole segments, so `oplog-snapshot` is safely
//     outside `oplog` while still reading as part of the same subsystem.
//
// The single rule that makes this safe: **a device only ever writes inside its
// own oplog directory.** Two machines can never target the same object, so the
// storage layer sees no write conflicts at all and needs no locking. Merging
// happens later, when the entries are read back and ordered by HLC — where the
// rules are explicit and testable rather than hidden in a race.
//
// Batch files are named by the HLC of their first entry. Because HLC strings
// are fixed-width hex, lexicographic order is causal order, so a plain listing
// comes back sorted.

import { compareHlcStrings, isValidHlc } from "./hlc";
import {
  normalizeStoragePath,
  type StorageProvider
} from "./storageProvider";

export const OPLOG_ROOT = "oplog";
export const OPLOG_SNAPSHOT_ROOT = "oplog-snapshot";

/** What a change touches. Mirrors the three stores syncPolicy classifies. */
export type OpScope = "table" | "setting" | "localStorage";

export interface OpEntry {
  /** Serialised HLC; also the total order these are applied in. */
  readonly hlc: string;
  readonly op: "set" | "delete";
  readonly scope: OpScope;
  /** Table name for `table`, otherwise the settings / localStorage key. */
  readonly key: string;
  /** Primary key of the row, for `table` scope only. */
  readonly recordId?: string;
  /** Row columns, or `{ value }` for the key/value scopes. Absent on delete —
   *  a delete carries no data, only the fact and the time it happened. */
  readonly payload?: Record<string, unknown>;
}

/** Identity of a change, for last-writer-wins. Takes the parts that name a
 *  destination, so it can be asked before an entry has a timestamp. */
export function entryIdentity(
  entry: Pick<OpEntry, "scope" | "key" | "recordId">
): string {
  return entry.scope === "table"
    ? `table:${entry.key}:${entry.recordId ?? ""}`
    : `${entry.scope}:${entry.key}`;
}

export function isValidEntry(value: unknown): value is OpEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<OpEntry>;
  // The format, not merely the type. `readLog` sorts the whole log with
  // `compareHlcStrings`, which throws on a malformed timestamp, so admitting
  // one bad line would break every pull from then on instead of costing the
  // one entry `parseBatch` promises.
  if (typeof entry.hlc !== "string" || !isValidHlc(entry.hlc)) return false;
  if (entry.op !== "set" && entry.op !== "delete") return false;
  if (
    entry.scope !== "table" &&
    entry.scope !== "setting" &&
    entry.scope !== "localStorage"
  ) {
    return false;
  }
  if (typeof entry.key !== "string" || entry.key.length === 0) return false;
  if (entry.scope === "table" && typeof entry.recordId !== "string") {
    return false;
  }
  if (entry.op === "set" && (!entry.payload || typeof entry.payload !== "object")) {
    return false;
  }
  return true;
}

export function serializeBatch(entries: readonly OpEntry[]): Buffer {
  return Buffer.from(
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8"
  );
}

/**
 * Parse a batch, skipping anything unreadable.
 *
 * Batches are written by other machines, possibly running a different version,
 * possibly interrupted mid-flush. One bad line must cost one entry, never the
 * whole log — dropping a device's entire history because of a trailing partial
 * write would be a far worse failure than ignoring it.
 */
export function parseBatch(content: Buffer): OpEntry[] {
  const entries: OpEntry[] = [];
  for (const line of content.toString("utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isValidEntry(parsed)) entries.push(parsed);
    } catch {
      // Unreadable line; the rest of the batch still applies.
    }
  }
  return entries;
}

export function oplogPathFor(device: string, hlc: string): string {
  return normalizeStoragePath(`${OPLOG_ROOT}/${device}/${hlc}.jsonl`);
}

export function oplogSnapshotPathFor(hlc: string): string {
  return normalizeStoragePath(`${OPLOG_SNAPSHOT_ROOT}/${hlc}.json`);
}

/**
 * Names `oplogSnapshotPathFor` produces, and nothing else.
 *
 * The HLC shape is what identifies one: 12 hex digits of milliseconds, 4 of
 * counter, then the device — `formatHlc`'s fixed widths, which is also why
 * sorting these paths as strings sorts them in causal order. Anything else in
 * the directory is something this module did not write and must not read.
 */
const OPLOG_SNAPSHOT_PATTERN =
  /^oplog-snapshot\/[0-9a-f]{12}-[0-9a-f]{4}-[^/]+\.json$/;

/** A compacted view: the surviving state plus the tombstones still inside the
 *  retention window, so a device that was offline cannot resurrect a deletion. */
export interface OplogSnapshot {
  readonly version: 1;
  /** Entries at or below this HLC are covered; older batches may be dropped. */
  readonly upTo: string;
  readonly entries: readonly OpEntry[];
}

export interface AppendResult {
  readonly path: string;
  readonly entries: number;
}

/** Write one batch into this device's own directory. */
export async function appendBatch(
  storage: StorageProvider,
  device: string,
  entries: readonly OpEntry[]
): Promise<AppendResult | null> {
  if (entries.length === 0) return null;

  const ordered = [...entries].sort((a, b) => compareHlcStrings(a.hlc, b.hlc));
  const path = oplogPathFor(device, ordered[0].hlc);
  // `null` — a batch name is an HLC this device has never issued before, so a
  // collision means a bug, not a race, and should surface as a conflict.
  await storage.put(path, serializeBatch(ordered), null);
  return { path, entries: ordered.length };
}

/** One batch file as it was read, kept so compaction knows what it may delete. */
interface ReadBatch {
  readonly path: string;
  /** The highest HLC this file holds. A batch is named by its *first* entry, so
   *  the name says nothing about how far it reaches. */
  readonly maxHlc: string;
}

export interface ReadLogResult {
  readonly entries: OpEntry[];
  readonly batches: readonly ReadBatch[];
  /** Compaction snapshots present when this read started, newest last. */
  readonly snapshotPaths: readonly string[];
}

/**
 * Read the whole log, reporting where each part came from.
 *
 * `readAllEntries` is this without the provenance. Compaction needs it: the
 * only batches it may delete are the exact ones it read and folded in, and the
 * only way to know a batch is fully covered is to have seen its highest entry.
 */
export async function readLog(
  storage: StorageProvider
): Promise<ReadLogResult> {
  const [snapshotPaths, listed] = await Promise.all([
    listOplogSnapshotPaths(storage),
    storage.list(OPLOG_ROOT)
  ]);

  const snapshot = await readOplogSnapshotAt(
    storage,
    snapshotPaths[snapshotPaths.length - 1]
  );

  const entries: OpEntry[] = snapshot ? [...snapshot.entries] : [];
  const covered = snapshot?.upTo;
  const batches: ReadBatch[] = [];

  for (const batch of listed.sort((a, b) => a.path.localeCompare(b.path))) {
    const stored = await storage.get(batch.path);
    if (!stored) continue;
    let maxHlc: string | null = null;
    for (const entry of parseBatch(stored.content)) {
      if (maxHlc === null || compareHlcStrings(entry.hlc, maxHlc) > 0) {
        maxHlc = entry.hlc;
      }
      // Skip what the snapshot already accounts for.
      if (covered && compareHlcStrings(entry.hlc, covered) <= 0) continue;
      entries.push(entry);
    }
    if (maxHlc !== null) batches.push({ path: batch.path, maxHlc });
  }

  return {
    entries: entries.sort((a, b) => compareHlcStrings(a.hlc, b.hlc)),
    batches,
    snapshotPaths
  };
}

/** Every entry currently in the log, from every device, in causal order. */
export async function readAllEntries(
  storage: StorageProvider
): Promise<OpEntry[]> {
  return (await readLog(storage)).entries;
}

/**
 * The newest compaction snapshot, or null when the log has never been
 * compacted.
 *
 * Filtered by name rather than trusting everything in the directory. The prefix
 * is this module's own now, so in a healthy vault the filter matches everything
 * it finds — but "sort and take the last one" is what turned a shared prefix
 * into a silent wrong answer, and a filter is cheap insurance against whatever
 * lands there next.
 */
export async function readLatestOplogSnapshot(
  storage: StorageProvider
): Promise<OplogSnapshot | null> {
  const paths = await listOplogSnapshotPaths(storage);
  return readOplogSnapshotAt(storage, paths[paths.length - 1]);
}

/** Compaction snapshot paths, oldest first. Fixed-width hex names, so string
 *  order is causal order. */
async function listOplogSnapshotPaths(
  storage: StorageProvider
): Promise<string[]> {
  return (await storage.list(OPLOG_SNAPSHOT_ROOT))
    .filter((entry) => OPLOG_SNAPSHOT_PATTERN.test(entry.path))
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b));
}

async function readOplogSnapshotAt(
  storage: StorageProvider,
  path: string | undefined
): Promise<OplogSnapshot | null> {
  if (!path) return null;
  const stored = await storage.get(path);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored.content.toString("utf8")) as OplogSnapshot;
    if (parsed?.version !== 1 || typeof parsed.upTo !== "string") return null;
    // `upTo` is compared against every batch's `maxHlc` and fed to `hlcMillis`.
    // A malformed one off disk would throw out of the same code paths a
    // malformed entry used to.
    if (!isValidHlc(parsed.upTo)) return null;
    return {
      version: 1,
      upTo: parsed.upTo,
      entries: (parsed.entries ?? []).filter(isValidEntry)
    };
  } catch {
    return null;
  }
}

export interface CompactOptions {
  /** How long a tombstone must outlive its deletion. A device offline for
   *  longer than this can resurrect a deleted record, which is why the window
   *  is generous. */
  readonly tombstoneTtlMs?: number;
  readonly now?: () => number;
}

const DEFAULT_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Reduce the whole log to the surviving state, so a machine joining later does
 * not replay months of history.
 *
 * Tombstones are kept until they expire. Dropping one early is the classic way
 * deleted records come back to life: a device that has been offline still holds
 * the original `set`, and with nothing to outrank it, the record returns.
 */
export function compactEntries(
  entries: readonly OpEntry[],
  options: CompactOptions = {}
): OplogSnapshot | null {
  if (entries.length === 0) return null;

  const ttl = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS;
  const now = (options.now ?? Date.now)();

  const winners = new Map<string, OpEntry>();
  for (const entry of entries) {
    const identity = entryIdentity(entry);
    const current = winners.get(identity);
    if (!current || compareHlcStrings(entry.hlc, current.hlc) > 0) {
      winners.set(identity, entry);
    }
  }

  const survivors: OpEntry[] = [];
  for (const entry of winners.values()) {
    if (entry.op === "delete") {
      const age = now - hlcMillis(entry.hlc);
      if (age > ttl) continue; // expired tombstone: safe to forget
    }
    survivors.push(entry);
  }

  const upTo = entries
    .map((entry) => entry.hlc)
    .reduce((a, b) => (compareHlcStrings(a, b) >= 0 ? a : b));

  return {
    version: 1,
    upTo,
    entries: survivors.sort((a, b) => compareHlcStrings(a.hlc, b.hlc))
  };
}

function hlcMillis(hlc: string): number {
  const separator = hlc.indexOf("-");
  return Number.parseInt(hlc.slice(0, separator), 16);
}

// --- Compaction, as an operation on the vault --------------------------------

/**
 * How far back from "now" compaction is willing to claim coverage.
 *
 * `readLog` skips any entry at or below a snapshot's `upTo`, so an entry that
 * arrives *after* compaction ran but stamped *below* its `upTo` would be
 * skipped forever while never having been folded in — lost, silently. An HLC
 * carries the writer's own clock, so that needs only a device whose clock is
 * behind to flush at the wrong moment.
 *
 * Leaving the most recent hour uncovered removes the race for any skew smaller
 * than an hour, which is every machine that has ever spoken to an NTP server.
 * The cost is that the newest batches are not pruned yet, and they are the few.
 */
export const COMPACT_HORIZON_MS = 60 * 60 * 1000;

/** Below this there is nothing worth the round trips. */
export const COMPACT_MIN_BATCHES = 50;

export interface CompactOplogOptions extends CompactOptions {
  /** Skip unless the log has at least this many batch files. */
  readonly minBatches?: number;
  readonly horizonMs?: number;
}

export interface CompactOplogResult {
  /** Null when nothing was written, either because the log is small or because
   *  everything in it is newer than the horizon. */
  readonly snapshotPath: string | null;
  readonly batchesDeleted: number;
  readonly snapshotsDeleted: number;
  readonly entriesKept: number;
}

/**
 * Fold the log down to its surviving state and delete what the fold covers.
 *
 * Without this the log only grows, and `readLog` downloads and parses every
 * batch ever written on **every poll** — on Drive, one HTTP GET per batch,
 * every few seconds. Days of ordinary use is enough to make sync unusable, so
 * pruning is the point and writing the snapshot is only what makes pruning
 * safe.
 *
 * **The order is the safety property.** The snapshot is written first and
 * batches are deleted second. A crash in between leaves batches whose contents
 * the snapshot already holds — duplicates, which last-writer-wins merges away.
 * The other order would delete history that nothing had recorded yet.
 *
 * A batch is deleted only when all three hold: this pass read it, its highest
 * entry is at or below the `upTo` just published, and the write succeeded. A
 * batch straddling the horizon therefore survives with some of its entries
 * duplicated in the snapshot, which is correct and costs one file.
 *
 * Call this under a lease. Two devices compacting at once is not corrupting —
 * both write a snapshot and delete batches they read — but it is twice the work
 * for one result.
 */
export async function compactOplog(
  storage: StorageProvider,
  options: CompactOplogOptions = {}
): Promise<CompactOplogResult> {
  const nothing: CompactOplogResult = {
    snapshotPath: null,
    batchesDeleted: 0,
    snapshotsDeleted: 0,
    entriesKept: 0
  };

  const minBatches = options.minBatches ?? COMPACT_MIN_BATCHES;
  const horizonMs = options.horizonMs ?? COMPACT_HORIZON_MS;
  const now = (options.now ?? Date.now)();

  const log = await readLog(storage);
  if (log.batches.length < minBatches) return nothing;

  // Only what is comfortably in the past. See COMPACT_HORIZON_MS.
  const horizon = now - horizonMs;
  const foldable = log.entries.filter(
    (entry) => hlcMillis(entry.hlc) <= horizon
  );
  if (foldable.length === 0) return nothing;

  const snapshot = compactEntries(foldable, {
    tombstoneTtlMs: options.tombstoneTtlMs,
    now: () => now
  });
  if (!snapshot) return nothing;

  const snapshotPath = oplogSnapshotPathFor(snapshot.upTo);
  // Republishing the same `upTo` means nothing has aged past the horizon since
  // the last pass. Rewriting it would be a no-op that still risks a conflict.
  if (log.snapshotPaths.includes(snapshotPath)) return nothing;

  await storage.put(
    snapshotPath,
    Buffer.from(JSON.stringify(snapshot), "utf8"),
    null
  );

  let batchesDeleted = 0;
  for (const batch of log.batches) {
    if (compareHlcStrings(batch.maxHlc, snapshot.upTo) > 0) continue;
    try {
      await storage.delete(batch.path);
      batchesDeleted += 1;
    } catch {
      // Another device pruning the same vault, or a batch already gone. The
      // snapshot holds its contents either way, so there is nothing to recover
      // and nothing to report.
    }
  }

  // Superseded snapshots last: until the batches are gone, an older snapshot is
  // still a usable fallback for a reader that cannot see the new one yet.
  let snapshotsDeleted = 0;
  for (const path of log.snapshotPaths) {
    if (path === snapshotPath) continue;
    try {
      await storage.delete(path);
      snapshotsDeleted += 1;
    } catch {
      // Same reasoning as above.
    }
  }

  return {
    snapshotPath,
    batchesDeleted,
    snapshotsDeleted,
    entriesKept: snapshot.entries.length
  };
}

