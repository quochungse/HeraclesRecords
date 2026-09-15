// Activity details on disk.
//
// One COROS activity detail is ~2.5 MB of JSON, 98% of it the sample series, so
// it belongs nowhere near SQLite: the rows sync, and a training diary is not a
// reason to push hundreds of megabytes through someone's Drive. It is a file,
// written the first time a run is opened, and what reaches the database is the
// ~130-byte summary computed from it (`activityMetrics.ts`).
//
// **A file is validated by fingerprint, not by age.** COROS's activity list
// carries no version, updateTime or modifyTime — probed field by field on the
// live API — and the one upload stamp that exists (`lastUploadTime`) is inside
// the detail, so reading it costs the very request the cache exists to avoid.
// What the list does carry is every summary figure COROS recomputes when an
// activity is edited: the name, the sport, the distance, the duration, the
// load. So the file stores a hash of those, and a file whose hash no longer
// matches the activity is stale by definition. No extra request, and an edit on
// COROS is picked up by the next list refresh.
//
// A run deleted on COROS leaves its file behind, and that is deliberate: a
// detail is only ever asked for through a list row, so the file is unreachable
// rather than wrong, and the size sweep collects it. Deleting on a failed fetch
// would be worse — COROS answers `1001 Service exceptions` both for an activity
// that is gone and for one it could not serve this minute.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { currentOwner } from "./dataOwner";
import { listStoredTrainingActivityIds } from "./database";
import type { TrainingHubActivity } from "./types";

/** Envelope version. Bump only for a change a v1 reader cannot survive. */
const ENVELOPE_VERSION = 1;

/**
 * Brotli at quality 5, measured on a real 2.5 MB run detail: 131 KB in 25 ms,
 * back out in 2 ms. Gzip 9 is bigger *and* slower here (139 KB, 70 ms), and
 * brotli's own default quality 11 takes 5.2 seconds for 42 KB more — on the
 * path that opens a run, which makes it a non-starter.
 */
const BROTLI_QUALITY = 5;

/** Half a gigabyte, about 3 800 details. Chosen with the athlete, not derived. */
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

/** How far under the cap a sweep goes, so one eviction is not one per write. */
const SWEEP_TARGET_RATIO = 0.9;

/** COROS ids are digits, but nothing here may build a path out of a reply. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface CacheEnvelope {
  v: number;
  activityId: string;
  fingerprint: string;
  fetchedAt: number;
  lastUploadTime?: number;
  payload: Record<string, unknown>;
}

let cacheRoot: string | null = null;
let maxBytes = DEFAULT_MAX_BYTES;
/**
 * Bytes on disk as last counted, plus everything written since. Counting is a
 * readdir and a stat per file; doing it on every write would be the only
 * expensive thing about a cache hit, so it is counted once and then kept.
 */
let knownBytes: number | null = null;

/**
 * Where details live. Called once at start-up with the same path the database
 * gets; suites point it at a temporary directory instead.
 */
export function initializeActivityDetailCache(
  userDataPath: string,
  options?: { maxBytes?: number }
): void {
  cacheRoot = path.join(userDataPath, "activity-details");
  maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  knownBytes = null;
}

/** The root, or null when nothing has initialised it (a test importing part of
 *  the service, or a headless tool). Every entry point below no-ops on null. */
function root(): string | null {
  return cacheRoot;
}

/**
 * Per account, because two COROS accounts on one machine must not read each
 * other's runs. The folder is the owner *fingerprint* — an HMAC, never the id
 * itself, the same rule the sync vault follows.
 */
function accountDirectory(): string | null {
  const base = root();
  if (base === null) {
    return null;
  }
  let owner: string | null = null;
  try {
    owner = currentOwner();
  } catch {
    // No database yet: fall through to the shared folder rather than throwing
    // into whatever request asked for a detail.
  }
  return path.join(base, owner ?? "unknown");
}

function detailPath(activityId: string): string | null {
  if (!SAFE_ID.test(activityId)) {
    return null;
  }
  const dir = accountDirectory();
  return dir === null ? null : path.join(dir, `${activityId}.json.br`);
}

/** Two decimals: enough for every figure COROS sends, and stable whether the
 *  number came back from SQLite or straight off the wire. */
function field(value: string | number | undefined | null): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";
  }
  return value;
}

export type ActivityFingerprintSource = Pick<
  TrainingHubActivity,
  | "activityId"
  | "name"
  | "sportType"
  | "startTime"
  | "endTime"
  | "duration"
  | "distance"
  | "avgHr"
  | "maxHr"
  | "calories"
  | "trainingLoad"
  | "elevationGain"
>;

/**
 * The activity as COROS last described it, in sixteen hex characters.
 *
 * Every field here is one COROS recomputes on an edit, and `name` is in
 * deliberately: renaming a run changes the payload too, and a cache that kept
 * serving the old name would be wrong in the one place the athlete is looking.
 * `sportName` is *not* — the app fills it in locally from a lookup table, so it
 * differs between a fresh list and a stored row without COROS having changed
 * anything.
 */
export function activityDetailFingerprint(
  activity: ActivityFingerprintSource
): string {
  const canonical = [
    field(activity.activityId),
    field(activity.sportType),
    field(activity.startTime),
    field(activity.endTime),
    field(activity.duration),
    field(activity.distance),
    field(activity.avgHr),
    field(activity.maxHr),
    field(activity.calories),
    field(activity.trainingLoad),
    field(activity.elevationGain),
    field(activity.name)
  ].join("|");

  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/**
 * The cached payload for an activity, or null when there is none, it is stale,
 * or anything at all goes wrong reading it.
 *
 * A stale file is deleted on sight: the caller is about to fetch a replacement,
 * and leaving it costs space the sweep would otherwise have to reclaim.
 */
export function readCachedActivityDetail(
  activityId: string,
  fingerprint: string
): Record<string, unknown> | null {
  const file = detailPath(activityId);
  if (file === null) {
    return null;
  }

  let envelope: CacheEnvelope;
  try {
    const parsed: unknown = JSON.parse(
      zlib.brotliDecompressSync(fs.readFileSync(file)).toString("utf8")
    );
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    envelope = parsed as CacheEnvelope;
  } catch {
    // Missing is the common case and reads the same as unreadable: fetch it.
    return null;
  }

  if (envelope.v !== ENVELOPE_VERSION || !envelope.payload) {
    removeFile(file);
    return null;
  }

  if (envelope.fingerprint !== fingerprint) {
    removeFile(file);
    return null;
  }

  // mtime is this cache's "last used" — atime is unreliable on a Linux desktop
  // (relatime updates it once a day) and nothing else survives a restart.
  try {
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch {
    // Not being able to touch it only costs it its place in the queue.
  }

  return envelope.payload;
}

/**
 * Store one payload. Best-effort throughout: a cache that throws into the
 * request path would turn a full disk into a run that will not open.
 */
export function writeCachedActivityDetail(
  activityId: string,
  fingerprint: string,
  payload: Record<string, unknown>
): void {
  const file = detailPath(activityId);
  if (file === null) {
    return;
  }

  const envelope: CacheEnvelope = {
    v: ENVELOPE_VERSION,
    activityId,
    fingerprint,
    fetchedAt: Date.now(),
    ...(typeof payload.lastUploadTime === "number"
      ? { lastUploadTime: payload.lastUploadTime }
      : {}),
    payload
  };

  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = zlib.brotliCompressSync(
      Buffer.from(JSON.stringify(envelope), "utf8"),
      { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }
    );
    // Write then rename: a half-written file must never be readable as a cache
    // hit, and a crash mid-write is otherwise exactly that.
    fs.writeFileSync(temporary, body);
    const previous = sizeOf(file);
    fs.renameSync(temporary, file);
    if (knownBytes !== null) {
      knownBytes += body.length - previous;
    }
    sweepIfNeeded();
  } catch {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Nothing left to do about it.
    }
  }
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function removeFile(file: string): void {
  const size = knownBytes === null ? 0 : sizeOf(file);
  try {
    fs.rmSync(file, { force: true });
    if (knownBytes !== null) {
      knownBytes = Math.max(0, knownBytes - size);
    }
  } catch {
    // Best effort; the sweep will pass this way again.
  }
}

interface CacheFile {
  path: string;
  activityId: string;
  /** True for the folder of the account signed in now. */
  owned: boolean;
  bytes: number;
  usedAt: number;
}

function listCacheFiles(): CacheFile[] {
  const base = root();
  if (base === null) {
    return [];
  }

  const owned = accountDirectory();
  const files: CacheFile[] = [];
  let accounts: fs.Dirent[];
  try {
    accounts = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const account of accounts) {
    if (!account.isDirectory()) {
      continue;
    }
    const dir = path.join(base, account.name);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json.br")) {
        continue;
      }
      const file = path.join(dir, entry);
      try {
        const stats = fs.statSync(file);
        files.push({
          path: file,
          activityId: entry.slice(0, -".json.br".length),
          owned: dir === owned,
          bytes: stats.size,
          usedAt: stats.mtimeMs
        });
      } catch {
        // Vanished under us; nothing to account for.
      }
    }
  }

  // Oldest use first, so a sweep is decided by what the files say rather than
  // by the order a directory happens to hand them back.
  return files.sort((left, right) => left.usedAt - right.usedAt);
}

/** Files and bytes held right now. A full scan — for tests and diagnostics. */
export function activityDetailCacheStats(): { files: number; bytes: number } {
  const files = listCacheFiles();
  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0)
  };
}

function sweepIfNeeded(): void {
  if (knownBytes === null) {
    knownBytes = activityDetailCacheStats().bytes;
  }
  if (knownBytes <= maxBytes) {
    return;
  }
  sweepActivityDetailCache();
}

/**
 * Bring the directory back under the cap.
 *
 * Orphans go first — a file whose activity is no longer in the local mirror is
 * either a deleted run or one from an account that has since signed out, and
 * neither will ever be read again. Only then does it start on real entries,
 * oldest use first.
 */
export function sweepActivityDetailCache(): { removed: number; bytes: number } {
  const files = listCacheFiles();
  let total = files.reduce((sum, file) => sum + file.bytes, 0);
  const target = Math.floor(maxBytes * SWEEP_TARGET_RATIO);

  if (total <= maxBytes) {
    knownBytes = total;
    return { removed: 0, bytes: total };
  }

  let known: Set<string> | null = null;
  try {
    known = new Set(listStoredTrainingActivityIds());
  } catch {
    // Without the mirror nothing can be called an orphan; age alone decides.
  }

  const orphan = (file: CacheFile): boolean =>
    known !== null && (!file.owned || !known.has(file.activityId));

  const queue = [...files].sort((left, right) => {
    const leftOrphan = orphan(left);
    const rightOrphan = orphan(right);
    if (leftOrphan !== rightOrphan) {
      return leftOrphan ? -1 : 1;
    }
    return left.usedAt - right.usedAt;
  });

  let removed = 0;
  for (const file of queue) {
    if (total <= target) {
      break;
    }
    try {
      fs.rmSync(file.path, { force: true });
      total -= file.bytes;
      removed += 1;
    } catch {
      // Leave it; the next sweep tries again.
    }
  }

  knownBytes = total;
  return { removed, bytes: total };
}
