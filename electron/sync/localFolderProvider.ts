// StorageProvider backed by an ordinary directory.
//
// It exists so the sync engine can be built and tested with no network, no
// OAuth and no waiting on anyone's review queue — and it stays useful after
// that, for people who point the app at a Nextcloud or Syncthing folder.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  StorageConflictError,
  StoragePathError,
  TEMP_PREFIX,
  isUnderPrefix,
  normalizeStoragePath,
  type ExpectedRevision,
  type StorageChange,
  type StorageChanges,
  type StorageContent,
  type StorageEntry,
  type StorageProvider
} from "./storageProvider";

/**
 * The revision of a stored object is a digest of its bytes.
 *
 * That keeps the provider stateless — no sidecar files, no index to race on —
 * and lines up with what the cloud backends expose (Drive's md5Checksum, a
 * WebDAV ETag). The trade-off is ABA: if an object is changed and then changed
 * back to exactly its old bytes, a writer holding the old revision will still
 * be allowed to write. For this engine that is benign, because identical bytes
 * mean the state genuinely did return to what the writer had read.
 */
function revisionOf(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
}

export interface LocalFolderProviderOptions {
  /** Directory to store objects in. Created on first write if absent. */
  readonly root: string;
}

export class LocalFolderProvider implements StorageProvider {
  readonly name = "local folder";
  readonly #root: string;

  constructor(options: LocalFolderProviderOptions) {
    this.#root = path.resolve(options.root);
  }

  /** Map a storage path to a real one, refusing anything that would escape the
   *  root even if `normalizeStoragePath` were ever loosened. */
  #resolve(storagePath: string): string {
    const normalized = normalizeStoragePath(storagePath);
    const resolved = path.resolve(this.#root, ...normalized.split("/"));
    const bounded =
      resolved === this.#root || resolved.startsWith(this.#root + path.sep);
    if (!bounded) {
      throw new StoragePathError(storagePath, "escapes the storage root");
    }
    return resolved;
  }

  /**
   * List what is under `prefix`, walking only that subtree.
   *
   * The subtree matters more than it looks. Listing costs a `readFile` per
   * entry, because a revision is a digest of the bytes — so walking the whole
   * root and filtering afterwards meant an oplog poll also read and hashed
   * every snapshot backup sitting in the same vault. `readLog` lists two
   * prefixes and `tick()` runs it every five seconds, so one 50 MB backup cost
   * 200 MB of reads a poll for data neither call wanted.
   *
   * `isUnderPrefix` matches on segment boundaries, so a prefix is always a
   * directory or an exact object path — which is why it can be resolved on disk
   * instead of matched against everything. The filter still runs: it is what
   * keeps this honest if that ever stops being true.
   */
  async list(prefix?: string): Promise<StorageEntry[]> {
    const entries: StorageEntry[] = [];
    if (!prefix) {
      await this.#walk(this.#root, "", entries);
      return entries;
    }

    const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    if (trimmed.length === 0) {
      await this.#walk(this.#root, "", entries);
      return entries;
    }

    const normalized = normalizeStoragePath(trimmed);
    await this.#walk(this.#resolve(normalized), normalized, entries);
    return entries.filter((entry) => isUnderPrefix(entry.path, normalized));
  }

  async #walk(
    directory: string,
    relative: string,
    into: StorageEntry[]
  ): Promise<void> {
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A root that does not exist yet is an empty store, not a failure, and
      // neither is a prefix that names nothing.
      if (code === "ENOENT") return;
      // A prefix that names an object rather than a directory: `isUnderPrefix`
      // treats an exact path as a match, so listing it yields that one entry.
      if (code === "ENOTDIR") {
        await this.#collectFile(directory, relative, into);
        return;
      }
      throw error;
    }

    for (const dirent of dirents) {
      // Half-written objects are invisible until their rename lands.
      if (dirent.name.startsWith(TEMP_PREFIX)) continue;

      const full = path.join(directory, dirent.name);
      const storagePath = relative ? `${relative}/${dirent.name}` : dirent.name;

      if (dirent.isDirectory()) {
        await this.#walk(full, storagePath, into);
        continue;
      }
      if (!dirent.isFile()) continue;

      await this.#collectFile(full, storagePath, into);
    }
  }

  /** One object's metadata. A revision is a digest of the bytes, so this reads
   *  the file — which is why `list` is careful about how many it visits. */
  async #collectFile(
    full: string,
    storagePath: string,
    into: StorageEntry[]
  ): Promise<void> {
    const [content, stat] = await Promise.all([
      fsp.readFile(full),
      fsp.stat(full)
    ]);
    into.push({
      path: storagePath,
      revision: revisionOf(content),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }

  async get(storagePath: string): Promise<StorageContent | null> {
    const resolved = this.#resolve(storagePath);
    try {
      const content = await fsp.readFile(resolved);
      return { content, revision: revisionOf(content) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if ((error as NodeJS.ErrnoException).code === "EISDIR") return null;
      throw error;
    }
  }

  /** The revision currently stored, or null when nothing is there. */
  async #currentRevision(resolved: string): Promise<string | null> {
    try {
      return revisionOf(await fsp.readFile(resolved));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") return null;
      throw error;
    }
  }

  /** Write bytes to a sibling temp file and flush them to disk, so the rename
   *  or link that follows publishes a complete object or nothing at all. */
  async #writeTemp(directory: string, content: Buffer): Promise<string> {
    await fsp.mkdir(directory, { recursive: true });
    const temp = path.join(
      directory,
      `${TEMP_PREFIX}${crypto.randomBytes(8).toString("hex")}`
    );
    const handle = await fsp.open(temp, "wx");
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return temp;
  }

  async put(
    storagePath: string,
    content: Buffer,
    expected?: ExpectedRevision
  ): Promise<string> {
    const resolved = this.#resolve(storagePath);
    const directory = path.dirname(resolved);
    const temp = await this.#writeTemp(directory, content);

    try {
      if (expected === null) {
        // Claiming a name. `link` fails with EEXIST atomically, which is what
        // makes exactly one of several racing devices win a lease.
        try {
          await fsp.link(temp, resolved);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new StorageConflictError(
              storagePath,
              expected,
              await this.#currentRevision(resolved)
            );
          }
          throw error;
        }
        return revisionOf(content);
      }

      if (typeof expected === "string") {
        const actual = await this.#currentRevision(resolved);
        if (actual !== expected) {
          throw new StorageConflictError(storagePath, expected, actual);
        }
      }

      // Atomic replace. On a local filesystem the check above and this rename
      // are not one operation, so a second writer landing in between would be
      // overwritten; the cloud providers close that window server-side, and
      // the lease design tolerates it by re-reading after every write.
      await fsp.rename(temp, resolved);
      return revisionOf(content);
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }

  async delete(storagePath: string, expected?: ExpectedRevision): Promise<void> {
    const resolved = this.#resolve(storagePath);

    if (expected !== undefined) {
      const actual = await this.#currentRevision(resolved);
      if (expected === null) {
        // "Delete only if absent" is already satisfied; nothing to do.
        if (actual === null) return;
        throw new StorageConflictError(storagePath, expected, actual);
      }
      if (actual !== expected) {
        throw new StorageConflictError(storagePath, expected, actual);
      }
    }

    await fsp.rm(resolved, { force: true });
    await this.#pruneEmptyParents(path.dirname(resolved));
  }

  /** Leave no empty directories behind, so `list` stays cheap over time. */
  async #pruneEmptyParents(directory: string): Promise<void> {
    let current = directory;
    while (current.startsWith(this.#root + path.sep)) {
      try {
        await fsp.rmdir(current);
      } catch {
        return;
      }
      current = path.dirname(current);
    }
  }

  /**
   * Change feed built by diffing the current listing against the digest carried
   * in the cursor. Linear in the number of objects, which is fine for a local
   * folder; the cloud providers replace this with a real delta endpoint.
   */
  async pollChanges(cursor?: string): Promise<StorageChanges> {
    const entries = await this.list();
    const current = new Map(entries.map((e) => [e.path, e.revision]));
    const previous = decodeCursor(cursor);

    const changes: StorageChange[] = [];
    for (const [storagePath, revision] of current) {
      if (previous.get(storagePath) !== revision) {
        changes.push({ path: storagePath, revision });
      }
    }
    for (const storagePath of previous.keys()) {
      if (!current.has(storagePath)) {
        changes.push({ path: storagePath, revision: null });
      }
    }

    return { changes, nextCursor: encodeCursor(current) };
  }
}

function encodeCursor(state: ReadonlyMap<string, string>): string {
  return Buffer.from(
    JSON.stringify(Object.fromEntries(state)),
    "utf8"
  ).toString("base64");
}

function decodeCursor(cursor?: string): Map<string, string> {
  if (!cursor) return new Map();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return new Map(Object.entries(parsed as Record<string, string>));
    }
  } catch {
    // An unreadable cursor means "start over", never a crash: the caller then
    // sees every object as changed, which is correct if wasteful.
  }
  return new Map();
}
