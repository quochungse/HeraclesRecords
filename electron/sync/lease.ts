// A lease: permission for exactly one device to do something at a time.
//
// Two things in this app must not happen twice. Minting a COROS token, because
// COROS invalidates the previous one every time a new one is issued — three
// machines logging in independently would cannibalise each other's sessions,
// which is the whole reason this feature exists. And running a coach
// automation, because two machines waking at 6am would spend twice the tokens
// and produce two identical approval cards.
//
// The guarantee comes from the storage layer, not from timing. `put` with
// `expected: null` succeeds for exactly one caller: on a filesystem that is an
// atomic `link`, and on Drive it is a create followed by settling duplicates on
// `createdTime`. Taking over an *expired* lease uses the other precondition —
// compare-and-swap on the revision just read — so two devices that both decide
// a lease is stale still cannot both take it.
//
// Every lease expires. A laptop that closes mid-run must not hold the lock
// forever, so the TTL is what makes the system self-healing rather than
// something a person has to go and clear.

import { StorageConflictError } from "./storageProvider";
import type { StorageProvider } from "./storageProvider";

export const LEASE_PREFIX = "lease";

/** Long enough that a slow COROS login (measured at 1–2 s per call, and a 2FA
 *  flow is far slower) never loses the lease it is holding, short enough that a
 *  machine which simply vanished is not blocking the others for long. */
export const DEFAULT_LEASE_TTL_MS = 2 * 60 * 1000;

export interface LeaseRecord {
  readonly holder: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  /** Increments on every takeover. A holder that was paused past its expiry can
   *  compare this against what it acquired and discover it has been fenced out
   *  rather than write as if it were still in charge. */
  readonly fencingToken: number;
}

export interface LeaseHandle {
  readonly record: LeaseRecord;
  /** The storage revision this holder last wrote. Renewal and release are
   *  conditional on it, so a fenced-out holder cannot clobber the new one. */
  readonly revision: string;
}

export interface LeaseDeps {
  readonly provider: () => StorageProvider;
  readonly deviceId: () => string;
  readonly now: () => number;
  readonly ttlMs?: number;
}

export function leasePath(name: string): string {
  return `${LEASE_PREFIX}/${name}.json`;
}

export function isExpired(record: LeaseRecord, now: number): boolean {
  return now >= record.expiresAt;
}

function encode(record: LeaseRecord): Buffer {
  return Buffer.from(JSON.stringify(record), "utf8");
}

function decode(content: Buffer): LeaseRecord | null {
  try {
    const parsed = JSON.parse(content.toString("utf8")) as LeaseRecord;
    return typeof parsed?.holder === "string" &&
      typeof parsed.expiresAt === "number"
      ? parsed
      : null;
  } catch {
    // Written by a newer version, or a torn write. Treat it as no lease at all;
    // the TTL check below then lets someone take over rather than deadlocking.
    return null;
  }
}

export class Lease {
  readonly #name: string;
  readonly #deps: LeaseDeps;

  constructor(name: string, deps: LeaseDeps) {
    this.#name = name;
    this.#deps = deps;
  }

  get path(): string {
    return leasePath(this.#name);
  }

  #ttl(): number {
    return this.#deps.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  }

  /** Who holds it, or null when nobody does. Expired records are reported as
   *  they are, so callers can see who left it behind. */
  async read(): Promise<{ record: LeaseRecord; revision: string } | null> {
    const stored = await this.#deps.provider().get(this.path);
    if (!stored) return null;
    const record = decode(stored.content);
    return record ? { record, revision: stored.revision } : null;
  }

  /**
   * Take the lease, or return null if someone else holds a live one.
   *
   * Never blocks and never retries: the caller decides what to do with a "no",
   * and for both users of this class the right answer is to wait for the winner
   * to publish its result rather than to queue up behind it.
   */
  async acquire(): Promise<LeaseHandle | null> {
    const now = this.#deps.now();
    const existing = await this.read();

    if (existing && !isExpired(existing.record, now)) {
      // Already ours? Renew rather than fail — a process that restarted and
      // still has time left should keep going.
      if (existing.record.holder === this.#deps.deviceId()) {
        return this.renew({ record: existing.record, revision: existing.revision });
      }
      return null;
    }

    const record: LeaseRecord = {
      holder: this.#deps.deviceId(),
      acquiredAt: now,
      expiresAt: now + this.#ttl(),
      fencingToken: (existing?.record.fencingToken ?? 0) + 1
    };

    try {
      await this.#deps.provider().put(
        this.path,
        encode(record),
        // No lease at all: claim the name, which exactly one racer wins.
        // An expired one: compare-and-swap on what we just read.
        existing ? existing.revision : null
      );
    } catch (error) {
      if (error instanceof StorageConflictError) {
        // Someone got there first between our read and our write. That is the
        // mechanism working, not a failure.
        return null;
      }
      throw error;
    }

    // Read back before believing the write.
    //
    // A revision precondition is not atomic on every backend: LocalFolderProvider
    // compares and then renames as two operations, and Drive has no working
    // If-Match at all. Several devices that all saw the same expired lease can
    // therefore all pass the check and all write — and without this step they
    // would all think they held it, which on the COROS path means all of them
    // logging in and invalidating each other. The file itself is the arbiter:
    // whoever's record survived is the holder, and everyone else stands down.
    const settled = await this.read();
    if (!settled || settled.record.holder !== this.#deps.deviceId()) {
      return null;
    }
    return { record: settled.record, revision: settled.revision };
  }

  /** Push the expiry out. Fails (returns null) when this device has been fenced
   *  out, which is how a paused laptop learns it is no longer in charge. */
  async renew(handle: LeaseHandle): Promise<LeaseHandle | null> {
    const record: LeaseRecord = {
      ...handle.record,
      expiresAt: this.#deps.now() + this.#ttl()
    };
    try {
      const revision = await this.#deps
        .provider()
        .put(this.path, encode(record), handle.revision);
      return { record, revision };
    } catch (error) {
      if (error instanceof StorageConflictError) return null;
      throw error;
    }
  }

  /** Give it up early, so the next device does not have to wait out the TTL. */
  async release(handle: LeaseHandle): Promise<void> {
    try {
      await this.#deps.provider().delete(this.path, handle.revision);
    } catch (error) {
      // Already taken over by someone else. Nothing to release, and nothing
      // worth telling the caller about.
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  /**
   * Hold the lease for the duration of `work`.
   *
   * Returns `{ ran: false }` when another device holds it — deliberately not an
   * error, because losing a race is the expected outcome for two of the three
   * machines and should not look like a failure to the caller.
   */
  async withLease<T>(
    work: (handle: LeaseHandle) => Promise<T>
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    const handle = await this.acquire();
    if (!handle) return { ran: false };
    try {
      return { ran: true, result: await work(handle) };
    } finally {
      await this.release(handle);
    }
  }
}
