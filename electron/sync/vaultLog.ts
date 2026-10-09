// The vault's log in format 2 (docs/sync-v2.md §4.2–4.3).
//
//   log/<device>/<seq>.jsonl   a batch, claimed once (`expected: null`), never
//                              rewritten; `seq` counts that device's batches
//   heads/<device>.json        `{ "seq": n }`, the newest batch that device has
//                              written; only that device writes it
//   snap/<hlc>.json            the newest copy of every record, and the vector
//                              of batches it covers
//
// A reader keeps a version vector — per device, the last batch it applied —
// so finding out whether there is anything new is reading the heads, and
// reading it is asking for the next batches by name. A batch that is gone was
// compacted into the snapshot, which is then read. Coverage is counted in
// batches, not timestamps, so a batch that arrives late with an old clock is
// still read: v1's snapshot horizon and its "already folded" bookkeeping have
// no equivalent here.

import { compareHlcStrings, isValidHlc } from "./hlc";
import {
  entryIdentity,
  isValidEntry,
  parseBatch,
  serializeBatch,
  type OpEntry
} from "./oplog";
import { normalizeStoragePath, type StorageProvider } from "./storageProvider";
import { RECORD_ID_SEPARATOR } from "./syncPolicy";

export const LOG_ROOT = "log";
export const HEADS_ROOT = "heads";
export const SNAPSHOT_ROOT = "snap";

const SEQ_WIDTH = 10;
const LOG_PATTERN = /^log\/([^/]+)\/(\d{10})\.jsonl$/;
const HEAD_PATTERN = /^heads\/([^/]+)\.json$/;
const SNAPSHOT_PATTERN = /^snap\/[0-9a-f]{12}-[0-9a-f]{4}-[^/]+\.json$/;

/** Compact once this many batches are in the log, as v1 did. */
export const COMPACT_MIN_LOG_FILES = 50;
const DEFAULT_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type Vector = Record<string, number>;

export function logPathFor(device: string, seq: number): string {
  return normalizeStoragePath(
    `${LOG_ROOT}/${device}/${String(seq).padStart(SEQ_WIDTH, "0")}.jsonl`
  );
}

export function headPathFor(device: string): string {
  return normalizeStoragePath(`${HEADS_ROOT}/${device}.json`);
}

export function snapshotPathFor(hlc: string): string {
  return normalizeStoragePath(`${SNAPSHOT_ROOT}/${hlc}.json`);
}

export function parseLogPath(path: string): { device: string; seq: number } | null {
  const match = LOG_PATTERN.exec(path);
  return match ? { device: match[1], seq: Number(match[2]) } : null;
}

export function parseHeadPath(path: string): string | null {
  return HEAD_PATTERN.exec(path)?.[1] ?? null;
}

export function isSnapshotPath(path: string): boolean {
  return SNAPSHOT_PATTERN.test(path);
}

/** A batch or a snapshot: written once, never rewritten, so a copy read once
 *  is good for as long as the path exists. A head is rewritten every batch. */
export function isImmutableVaultPath(path: string): boolean {
  return LOG_PATTERN.test(path) || SNAPSHOT_PATTERN.test(path);
}

export function encodeHead(seq: number): Buffer {
  return Buffer.from(JSON.stringify({ seq }), "utf8");
}

export function parseHead(content: Buffer): number | null {
  try {
    const parsed = JSON.parse(content.toString("utf8")) as { seq?: unknown };
    return typeof parsed?.seq === "number" && Number.isInteger(parsed.seq) && parsed.seq >= 0
      ? parsed.seq
      : null;
  } catch {
    return null;
  }
}

export interface VaultSnapshot {
  readonly version: 2;
  /** Per device, the last batch whose entries this snapshot holds. */
  readonly vector: Vector;
  readonly entries: readonly OpEntry[];
}

export function encodeSnapshot(snapshot: VaultSnapshot): Buffer {
  return Buffer.from(JSON.stringify(snapshot), "utf8");
}

export function parseSnapshot(content: Buffer): VaultSnapshot | null {
  try {
    const parsed = JSON.parse(content.toString("utf8")) as Partial<VaultSnapshot>;
    if (parsed?.version !== 2 || !parsed.vector || typeof parsed.vector !== "object") {
      return null;
    }
    const vector: Vector = {};
    for (const [device, seq] of Object.entries(parsed.vector)) {
      if (typeof seq === "number" && Number.isInteger(seq) && seq >= 0) vector[device] = seq;
    }
    return {
      version: 2,
      vector,
      entries: (Array.isArray(parsed.entries) ? parsed.entries : []).filter(isValidEntry)
    };
  } catch {
    return null;
  }
}

/** What one listing says about the log, nothing read. */
export interface VaultListing {
  /** Per device, every batch present, ascending. */
  readonly logs: ReadonlyMap<string, readonly number[]>;
  /** Per device, its head's revision. */
  readonly heads: ReadonlyMap<string, string>;
  /** Snapshot paths, oldest first. */
  readonly snapshots: readonly string[];
  /** The revision of everything listed, the vault's identity among them. */
  readonly revisions: ReadonlyMap<string, string>;
  readonly logFileCount: number;
}

export async function listVault(storage: StorageProvider): Promise<VaultListing> {
  const listed = await storage.list();
  const logs = new Map<string, number[]>();
  const heads = new Map<string, string>();
  const snapshots: string[] = [];
  let logFileCount = 0;
  for (const entry of listed) {
    const log = parseLogPath(entry.path);
    if (log) {
      logFileCount += 1;
      const seqs = logs.get(log.device) ?? [];
      seqs.push(log.seq);
      logs.set(log.device, seqs);
      continue;
    }
    const head = parseHeadPath(entry.path);
    if (head) {
      heads.set(head, entry.revision);
      continue;
    }
    if (isSnapshotPath(entry.path)) snapshots.push(entry.path);
  }
  for (const seqs of logs.values()) seqs.sort((a, b) => a - b);
  snapshots.sort((a, b) => a.localeCompare(b));
  return {
    logs,
    heads,
    snapshots,
    revisions: new Map(listed.map((entry) => [entry.path, entry.revision])),
    logFileCount
  };
}

export async function readLogBatch(
  storage: StorageProvider,
  device: string,
  seq: number
): Promise<OpEntry[] | null> {
  const stored = await storage.get(logPathFor(device, seq));
  return stored ? parseBatch(stored.content) : null;
}

export async function readSnapshotAt(
  storage: StorageProvider,
  path: string
): Promise<VaultSnapshot | null> {
  const stored = await storage.get(path);
  return stored ? parseSnapshot(stored.content) : null;
}

/** Claim the batch `seq` of `device`. Throws `StorageConflictError` when that
 *  number is taken — a head that fell behind its batches after a crash. */
export async function writeLogBatch(
  storage: StorageProvider,
  device: string,
  seq: number,
  entries: readonly OpEntry[]
): Promise<string> {
  const ordered = [...entries].sort((a, b) => compareHlcStrings(a.hlc, b.hlc));
  const path = logPathFor(device, seq);
  await storage.put(path, serializeBatch(ordered), null);
  return path;
}

/** Returns the head's revision, for telling later whether it moved. */
export async function writeHead(
  storage: StorageProvider,
  device: string,
  seq: number
): Promise<string> {
  return storage.put(headPathFor(device), encodeHead(seq));
}

/** The newest copy of each record, by HLC, with tombstones past their TTL
 *  dropped, and every element whose row is not a live record — a deleted
 *  conversation sends its own tombstone, not one per message, so this is where
 *  its messages go. Nothing is merged: a record is always one machine's copy. */
export function newestRecords(
  entries: readonly OpEntry[],
  now: number,
  tombstoneTtlMs = DEFAULT_TOMBSTONE_TTL_MS
): OpEntry[] {
  const winners = new Map<string, OpEntry>();
  for (const entry of entries) {
    const identity = entryIdentity(entry);
    const held = winners.get(identity);
    if (!held || compareHlcStrings(entry.hlc, held.hlc) > 0) winners.set(identity, entry);
  }
  const live = new Set(
    [...winners.values()]
      .filter((entry) => entry.scope === "table" && entry.op === "set")
      .map((entry) => entryIdentity(entry))
  );
  return [...winners.values()]
    .filter((entry) => {
      if (entry.scope === "item") {
        const recordId = entry.recordId ?? "";
        const at = recordId.lastIndexOf(RECORD_ID_SEPARATOR);
        const row = at > 0 ? recordId.slice(0, at) : "";
        if (!live.has(entryIdentity({ scope: "table", key: entry.key, recordId: row }))) {
          return false;
        }
      }
      if (entry.op !== "delete") return true;
      const separator = entry.hlc.indexOf("-");
      const millis = Number.parseInt(entry.hlc.slice(0, separator), 16);
      return now - millis <= tombstoneTtlMs;
    })
    .sort((a, b) => compareHlcStrings(a.hlc, b.hlc));
}

export interface CompactVaultResult {
  readonly snapshotPath: string | null;
  readonly logsDeleted: number;
  readonly snapshotsDeleted: number;
}

/**
 * Fold the log into a new snapshot and delete what it covers.
 *
 * The base is the newest snapshot; onto it go each device's batches after the
 * snapshot's vector, in order, stopping at the first one missing. The new
 * snapshot is written first and the batches deleted after, so a crash in
 * between leaves duplicates, never a gap. A reader whose next batch has gone
 * finds the snapshot covering it.
 */
export async function compactVault(
  storage: StorageProvider,
  options: { now: () => number; nextHlc: () => string; minLogFiles?: number }
): Promise<CompactVaultResult> {
  const nothing = { snapshotPath: null, logsDeleted: 0, snapshotsDeleted: 0 };
  const listing = await listVault(storage);
  if (listing.logFileCount < (options.minLogFiles ?? COMPACT_MIN_LOG_FILES)) return nothing;

  const basePath = listing.snapshots[listing.snapshots.length - 1];
  const base = basePath ? await readSnapshotAt(storage, basePath) : null;
  if (basePath && !base) return nothing; // a snapshot this build cannot read
  const vector: Vector = { ...(base?.vector ?? {}) };
  const entries: OpEntry[] = [...(base?.entries ?? [])];

  for (const [device, seqs] of listing.logs) {
    let next = (vector[device] ?? 0) + 1;
    for (const seq of seqs) {
      if (seq < next) continue;
      if (seq !== next) break;
      const batch = await readLogBatch(storage, device, seq);
      if (!batch) break;
      entries.push(...batch);
      vector[device] = seq;
      next = seq + 1;
    }
  }

  const hlc = options.nextHlc();
  if (!isValidHlc(hlc)) return nothing;
  const snapshotPath = snapshotPathFor(hlc);
  await storage.put(
    snapshotPath,
    encodeSnapshot({ version: 2, vector, entries: newestRecords(entries, options.now()) }),
    null
  );

  let logsDeleted = 0;
  for (const [device, seqs] of listing.logs) {
    for (const seq of seqs) {
      if (seq > (vector[device] ?? 0)) continue;
      try {
        await storage.delete(logPathFor(device, seq));
        logsDeleted += 1;
      } catch {
        // Already gone, or another device pruning: the snapshot holds it.
      }
    }
  }
  let snapshotsDeleted = 0;
  for (const path of listing.snapshots) {
    try {
      await storage.delete(path);
      snapshotsDeleted += 1;
    } catch {
      // Same reasoning.
    }
  }
  return { snapshotPath, logsDeleted, snapshotsDeleted };
}
