// A StorageProvider that scrambles what passes through it.
//
// The seal belongs at the storage boundary, not sprinkled through the callers.
// With this wrapper the oplog, the snapshots, the leases and anything added
// later are covered by construction — a new caller cannot forget, because there
// is no unsealed path to forget on. That was the argument for the keyring-based
// provider this replaces, and it did not change when the key did.
//
// Read `syncObfuscation.ts` before relying on any of it: the key ships in the
// build, so this stops accidental disclosure and nothing more. It is worth
// having anyway, because the vault holds a training diary and months of coach
// conversations, and a backup folder is exactly the kind of place whose
// contents get previewed, indexed and screenshotted by accident.
//
// Two asymmetries, both deliberate:
//
//   * **Every write is sealed; not every read expects one.** `get` opens what
//     arrives sealed and passes anything else through, so a vault still holding
//     plain payloads from an earlier build reads correctly rather than failing.
//   * **The path is the AAD**, so a payload only opens at the path it was
//     written to. That catches a snapshot copied into the wrong slot. It is a
//     consistency check, not a security boundary; the header says why.

import { isSealed, seal, unseal } from "./syncObfuscation";
import type {
  ExpectedRevision,
  StorageChanges,
  StorageContent,
  StorageEntry,
  StorageProvider
} from "./storageProvider";

export class ObfuscatedProvider implements StorageProvider {
  readonly #inner: StorageProvider;

  constructor(inner: StorageProvider) {
    this.#inner = inner;
    const poll = inner.pollChanges;
    if (poll) {
      this.pollChanges = (cursor) => poll.call(inner, cursor);
    }
  }

  get name(): string {
    return `${this.#inner.name} (obfuscated)`;
  }

  /** Listing is metadata only — sizes and revisions — so it passes straight
   *  through. The sizes it reports are of what is on disk, which is a little
   *  larger than the payload: the envelope header. */
  list(prefix?: string): Promise<StorageEntry[]> {
    return this.#inner.list(prefix);
  }

  async get(path: string): Promise<StorageContent | null> {
    const stored = await this.#inner.get(path);
    if (!stored || !isSealed(stored.content)) return stored;
    return {
      content: unseal(stored.content, path),
      // The revision is the inner provider's, computed over the bytes actually
      // stored. It has to be: an `expected` revision handed back to `put` is
      // compared against those same bytes.
      revision: stored.revision
    };
  }

  put(
    path: string,
    content: Buffer,
    expected?: ExpectedRevision
  ): Promise<string> {
    return this.#inner.put(path, seal(content, path), expected);
  }

  delete(path: string, expected?: ExpectedRevision): Promise<void> {
    return this.#inner.delete(path, expected);
  }

  /**
   * Assigned in the constructor, not declared as a method.
   *
   * `StorageProvider.pollChanges` is optional and callers are told to test for
   * it before falling back to `list`. A method declared here would always be
   * present, so that test would pass for a backend that has no change feed and
   * the fallback would never be taken — the wrapper would answer for a
   * capability it does not have. Latent while both providers implement it, and
   * a trap for the first one that does not.
   */
  readonly pollChanges?: (cursor?: string) => Promise<StorageChanges>;
}
