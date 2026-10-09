// The content of log files this process has already downloaded or written.
//
// The pull reads a file once (see `readIndex.ts`), but compaction still reads
// the whole log: it folds every entry, so it needs every file's content. On the
// machine that compacts, those are mostly files the pull downloaded minutes
// earlier and the batches this machine wrote itself, so they are kept here
// rather than fetched again. Only the log's own files are kept — they are never
// rewritten in place — and each under the revision it was read at, so a file
// that somehow changed is fetched again rather than served stale.
//
// In memory, bounded, and lost with the process: a miss costs one download,
// never a wrong answer.

import { isLogFilePath } from "./oplog";
import { isImmutableVaultPath } from "./vaultLog";
import type {
  ExpectedRevision,
  StorageContent,
  StorageEntry,
  StorageProvider
} from "./storageProvider";

/** A file of either format's log: claimed once and never rewritten in place. */
export function isWrittenOnce(path: string): boolean {
  return isLogFilePath(path) || isImmutableVaultPath(path);
}

/** Enough for the snapshot and a heavy hour of batches; past it the oldest go. */
export const LOG_FILE_CACHE_BYTES = 48 * 1024 * 1024;

interface Cached {
  readonly revision: string;
  readonly content: Buffer;
}

export class LogFileCache {
  readonly #maxBytes: number;
  readonly #held = new Map<string, Cached>();
  #bytes = 0;

  constructor(maxBytes = LOG_FILE_CACHE_BYTES) {
    this.#maxBytes = maxBytes;
  }

  get(path: string, revision: string): Buffer | undefined {
    const cached = this.#held.get(path);
    if (!cached || cached.revision !== revision) return undefined;
    // Most recently used last, so eviction takes the coldest first.
    this.#held.delete(path);
    this.#held.set(path, cached);
    return cached.content;
  }

  set(path: string, revision: string, content: Buffer): void {
    if (!isWrittenOnce(path) || content.length > this.#maxBytes) return;
    this.delete(path);
    this.#held.set(path, { revision, content });
    this.#bytes += content.length;
    for (const [oldest, cached] of this.#held) {
      if (this.#bytes <= this.#maxBytes) break;
      this.#held.delete(oldest);
      this.#bytes -= cached.content.length;
    }
  }

  delete(path: string): void {
    const cached = this.#held.get(path);
    if (!cached) return;
    this.#held.delete(path);
    this.#bytes -= cached.content.length;
  }
}

/**
 * `inner`, answering `get` for a log file from the cache when the revision the
 * last listing reported is the one held.
 *
 * The revision has to come from a listing on this same wrapper: `get` alone
 * cannot know it without the request it is trying to save. Anything without
 * one — a file not listed through here, a lease, the vault id — goes straight
 * to `inner`.
 */
export function withLogFileCache(
  inner: StorageProvider,
  cache: LogFileCache
): StorageProvider {
  const listed = new Map<string, string>();
  const wrapped: StorageProvider = {
    name: inner.name,
    async list(prefix?: string): Promise<StorageEntry[]> {
      const entries = await inner.list(prefix);
      for (const entry of entries) listed.set(entry.path, entry.revision);
      return entries;
    },
    async get(path: string): Promise<StorageContent | null> {
      const revision = listed.get(path);
      const hit = revision === undefined ? undefined : cache.get(path, revision);
      if (hit && revision !== undefined) return { content: hit, revision };
      const stored = await inner.get(path);
      if (stored) cache.set(path, stored.revision, stored.content);
      return stored;
    },
    async put(
      path: string,
      content: Buffer,
      expected?: ExpectedRevision
    ): Promise<string> {
      const revision = await inner.put(path, content, expected);
      // What was just written is what a reader of it will want: this machine's
      // own batches, and the snapshot it compacted.
      cache.set(path, revision, content);
      return revision;
    },
    async delete(path: string, expected?: ExpectedRevision): Promise<void> {
      cache.delete(path);
      listed.delete(path);
      await inner.delete(path, expected);
    }
  };
  if (inner.pollChanges) {
    const poll = inner.pollChanges;
    return { ...wrapped, pollChanges: (cursor) => poll.call(inner, cursor) };
  }
  return wrapped;
}
