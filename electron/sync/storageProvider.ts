// The storage abstraction the sync engine writes through.
//
// One interface, several backends: a plain folder (below and in
// localFolderProvider.ts), Google Drive, OneDrive, WebDAV. Nothing here may
// name a concept that belongs to only one of them — `revision` is deliberately
// an opaque string so Drive can map it onto md5Checksum, OneDrive onto eTag,
// and WebDAV onto ETag without the engine ever knowing which.
//
// Paths are always POSIX-shaped ("oplog/<device>/00001.jsonl"), relative, and
// validated: providers translate to whatever the backend actually uses.

/** One stored object, as reported by `list`. */
export interface StorageEntry {
  readonly path: string;
  readonly revision: string;
  readonly size: number;
  /** ISO-8601. Advisory only — never order or compare by it. Clocks disagree
   *  across machines, which is what the sync engine's logical clock is for. */
  readonly modifiedAt: string;
}

export interface StorageContent {
  readonly content: Buffer;
  readonly revision: string;
}

/**
 * The precondition on a write.
 *
 *   `undefined` — write unconditionally, creating or replacing.
 *   `null`      — the object must not exist yet. This is how a lease is
 *                 claimed: exactly one racer can succeed.
 *   `string`    — the object must currently be at this revision.
 */
export type ExpectedRevision = string | null | undefined;

/** A change since a cursor. `revision: null` means the object was deleted. */
export interface StorageChange {
  readonly path: string;
  readonly revision: string | null;
}

export interface StorageChanges {
  readonly changes: readonly StorageChange[];
  /** Opaque; hand it back to the next `pollChanges` call. Providers encode
   *  whatever they need — a Drive pageToken, a listing digest. */
  readonly nextCursor: string;
}

export interface StorageProvider {
  /** For logs and error messages, e.g. "local folder" or "google drive". */
  readonly name: string;

  /** Every object under `prefix` (all of them when omitted), in no guaranteed
   *  order. */
  list(prefix?: string): Promise<StorageEntry[]>;

  /** The object at `path`, or null when it does not exist. */
  get(path: string): Promise<StorageContent | null>;

  /** Write, honouring `expected`. Returns the revision the object now has.
   *  Throws StorageConflictError when the precondition fails. */
  put(
    path: string,
    content: Buffer,
    expected?: ExpectedRevision
  ): Promise<string>;

  /** Remove, honouring `expected`. Deleting something already absent succeeds
   *  when `expected` is undefined, so cleanup is idempotent. */
  delete(path: string, expected?: ExpectedRevision): Promise<void>;

  /** Incremental change feed, when the backend can provide one. Callers must
   *  fall back to `list` when this is absent. */
  pollChanges?(cursor?: string): Promise<StorageChanges>;
}

export class StorageConflictError extends Error {
  readonly code = "conflict" as const;
  readonly path: string;
  readonly expected: ExpectedRevision;
  /** The revision actually found, or null when nothing was there. */
  readonly actual: string | null;

  constructor(path: string, expected: ExpectedRevision, actual: string | null) {
    super(
      expected === null
        ? `${path} already exists.`
        : `${path} has moved on: expected revision ${String(expected)}, found ${
            actual ?? "nothing"
          }.`
    );
    this.name = "StorageConflictError";
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

export class StoragePathError extends Error {
  readonly code = "invalid-path" as const;

  constructor(path: string, reason: string) {
    super(`Invalid storage path ${JSON.stringify(path)}: ${reason}`);
    this.name = "StoragePathError";
  }
}

/** Reserved for a provider's own in-progress writes; never listed or fetched. */
export const TEMP_PREFIX = ".tmp-";

/**
 * Validate and canonicalise a path before it reaches any backend.
 *
 * Paths can arrive from data another machine wrote, so this is a security
 * boundary, not a tidiness check: `..` must never be able to walk out of the
 * sync folder and into the rest of the disk.
 */
export function normalizeStoragePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new StoragePathError(String(path), "must be a non-empty string");
  }
  if (path.includes("\\")) {
    throw new StoragePathError(path, "use '/' as the separator");
  }
  if (path.includes("\0")) {
    throw new StoragePathError(path, "contains a null byte");
  }
  if (path.startsWith("/")) {
    throw new StoragePathError(path, "must be relative");
  }

  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new StoragePathError(path, "has an empty segment");
    }
    if (segment === "." || segment === "..") {
      throw new StoragePathError(path, "must not contain '.' or '..'");
    }
    if (segment.startsWith(TEMP_PREFIX)) {
      throw new StoragePathError(
        path,
        `segments must not start with '${TEMP_PREFIX}' (reserved)`
      );
    }
  }
  return segments.join("/");
}

/** True when `path` sits under `prefix`, matching on whole segments so that
 *  "oplog" never matches "oplog-archive/...". */
export function isUnderPrefix(path: string, prefix?: string): boolean {
  if (!prefix) {
    return true;
  }
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return path === normalized || path.startsWith(`${normalized}/`);
}
