// Two-way sync: what to push, when to push it, and how often to look.
//
// The hard parts are not the merge — that is step 4's engine — but the timing.
// Three rules shape this file:
//
//   * **Nothing here may block the UI.** Sync is a side channel. The app works
//     with no network at all; a failed push is queued, not surfaced as an
//     error the user has to clear.
//   * **Writes are batched.** Coach streams hundreds of deltas a second. Those
//     are not changes worth uploading, and treating them as such would burn
//     quota and bandwidth for nothing. A change enters the queue only when it
//     is finished — an assistant turn that has ended, a setting the user has
//     actually set — and the queue then waits out a quiet period before it
//     flushes.
//   * **Polling matches how likely a change is.** Fast right after activity,
//     slow when nothing is happening or the link is down, stopped only when
//     there is no window to show a change in. A fixed interval is either
//     wasteful or slow, and usually both.
//
// Timers and the clock are injected, so the suite drives the whole thing
// deterministically instead of sleeping through real seconds.

import { formatHlc, HlcClock, parseHlc } from "./hlc";
import {
  shouldApply,
  type RecordVersionStore
} from "./recordVersions";
import { isMergedTable } from "./rowMergers";
import type { OutboxStore } from "./outbox";
import {
  appendBatch,
  compactOplog,
  entryIdentity,
  listLogFiles,
  parseBatch,
  parseOplogSnapshot,
  type CompactOplogResult,
  type LogFile,
  type OpEntry
} from "./oplog";
import { LogFileCache, withLogFileCache } from "./logFileCache";
import { StorageConflictError } from "./storageProvider";
import {
  createMemoryPublishedItems,
  elementHash,
  splitIntoItems,
  splitItemRecordId,
  type ListElement,
  type PublishedItemStore
} from "./transcriptItems";
import {
  compactVault,
  encodeSnapshot,
  headPathFor,
  listVault,
  parseHead,
  readLogBatch,
  readSnapshotAt,
  snapshotPathFor,
  writeHead,
  writeLogBatch,
  type CompactVaultResult
} from "./vaultLog";
import {
  createMemoryVectorStore,
  type VectorRecord,
  type VectorStore
} from "./vectorStore";
import {
  createMemoryReadIndex,
  needsRead,
  type ReadIndexStore,
  type ReadRecord
} from "./readIndex";
import { Lease } from "./lease";
import { applyEntries, type ApplyResult, type ContentChange, type SyncTarget,
  ChangeBuilder
} from "./syncEngine";
import type { StorageProvider } from "./storageProvider";

export const SYNC_LOOP_SETTINGS = {
  clock: "sync.clock",
  lastPulledAt: "sync.lastPulledAt",
  lastCompactedAt: "sync.lastCompactedAt",
  /** Format 2: the snapshot this machine last read, or wrote when it migrated
   *  the vault. Absent, the next pull reads the newest one. */
  lastSnapshot: "sync.v2.lastSnapshot",
  /** Format 2: the app version that last read the vault from its snapshot.
   *  Another version reads it again, once, so what an older build could not
   *  take — a table or column it did not know — lands now. */
  fullReadBuild: "sync.v2.fullReadBuild"
} as const;

/** How long the format-1 log is kept, read and bridged after the newest file
 *  in it, before a format-2 machine deletes it. */
export const LEGACY_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const FORMAT_MIGRATION_LEASE = "format-migration";

const EMPTY_PULL: PullResult = {
  applied: 0,
  deleted: 0,
  superseded: 0,
  rejected: [],
  merged: [],
  contentChanges: [],
  entriesSeen: 0
};

/**
 * How rarely a device even considers compacting.
 *
 * Matched to `COMPACT_HORIZON_MS`, because that is what sets the floor: nothing
 * inside the last hour can be pruned, so looking more often than hourly finds
 * nothing new to do. Looking *less* often is the expensive direction — a pass
 * costs one full log read plus a delete per batch, while every hour it is
 * deferred leaves another hour of batches in the path of **every** poll. At a
 * poll a minute, carrying an extra hour of batches costs sixty reads of them
 * against the one read and handful of deletes that would have removed them.
 */
export const COMPACT_INTERVAL_MS = 60 * 60 * 1000;

/** One device compacts at a time. A pass is a read of the whole log plus a
 *  write and a run of deletes, and there is nothing to gain from three
 *  machines doing it at once. */
export const COMPACT_LEASE = "oplog-compaction";
/** Generous: a pass over a large log on a slow link is minutes of round trips,
 *  and losing the lease mid-pass would let a second device start over. */
export const COMPACT_LEASE_TTL_MS = 15 * 60 * 1000;

/** How long the queue waits for the next change before flushing. Long enough
 *  that a burst of edits becomes one upload, short enough that another device
 *  sees the work within a few seconds. */
export const FLUSH_DEBOUNCE_MS = 3_000;
/** A flush happens at least this often even while changes keep arriving, so a
 *  steady trickle of edits cannot postpone upload forever. */
export const FLUSH_MAX_DELAY_MS = 30_000;

export const POLL_ACTIVE_MS = 5_000;
export const POLL_IDLE_MS = 60_000;
/** Activity counts as recent for this long after the last change either way. */
export const POLL_ACTIVE_WINDOW_MS = 60_000;

/** How long a presence claim stays believable without being renewed. */
export const PRESENCE_TTL_MS = 90_000;
export const PRESENCE_PREFIX = "presence";

export interface LoopConditions {
  /** Whether there is a window to show an inbound change to. False with the
   *  last one closed — normal on macOS, where the app outlives its windows. */
  readonly appActive: boolean;
  readonly online: boolean;
  /** Epoch ms of the last change seen or made, or null if none yet. */
  readonly lastActivityAt: number | null;
  readonly now: number;
}

/**
 * How long to wait before looking again.
 *
 * `null` means "do not schedule", and only `appActive` earns it: with no window
 * there is nobody to show an inbound change to, and a timer that fires into a
 * sleeping laptop only drains its battery. `resume()` starts the loop again
 * when a window comes back.
 *
 * **Offline backs off; it does not stop.** It used to return `null` too, on the
 * same battery reasoning, with `resume()` named as what would restart it when
 * the network returned — but the main process has no network-returned event to
 * hang that on, nothing ever called `resume()`, and so a single moment of
 * `net.isOnline()` being false (a VPN reconnecting, a wifi hand-off) stopped
 * this device pulling for the rest of the process's life. It is also the wrong
 * place for the concern: an offline tick does no network work at all — `flush`
 * returns early and `pull` is skipped — so polling slowly while offline costs a
 * timer and nothing else, and the loop heals itself the moment the link is
 * back.
 */
export function nextPollDelay(conditions: LoopConditions): number | null {
  if (!conditions.appActive) return null;
  if (!conditions.online) return POLL_IDLE_MS;
  if (conditions.lastActivityAt === null) return POLL_IDLE_MS;
  const since = conditions.now - conditions.lastActivityAt;
  return since <= POLL_ACTIVE_WINDOW_MS ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

export interface PresenceClaim {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly at: number;
  /** The chat session this device is actively generating into, if any. */
  readonly activeSessionId: string | null;
}

export function isPresenceFresh(claim: PresenceClaim, now: number): boolean {
  return now - claim.at <= PRESENCE_TTL_MS;
}

export interface SyncLoopDeps {
  readonly provider: () => StorageProvider;
  readonly target: SyncTarget;
  readonly deviceId: () => string;
  readonly deviceName: () => string;
  readonly getSetting: (key: string) => string | undefined;
  readonly setSetting: (key: string, value: string) => void;
  readonly now: () => number;
  /** Injected so the suite advances time instead of waiting for it. */
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly conditions: () => { appActive: boolean; online: boolean };
  /**
   * What the local database already holds, per synced destination.
   *
   * Required rather than defaulted, and wired where a suite can see it: this is
   * the only thing standing between a slow pull and the newer row underneath
   * it, and a dep with a fallback is a dep nothing has to think about.
   */
  readonly recordVersions: RecordVersionStore;
  /**
   * Where queued changes live until the vault confirms them.
   *
   * Required for the same reason as `recordVersions`: a fallback would be an
   * in-memory queue again, and the whole point is that the queue outlives the
   * process that made it.
   */
  readonly outbox: OutboxStore;
  /**
   * Which files of the log this machine has read, so a pull downloads only
   * what is new. Defaulted, unlike the two above, because the fallback is
   * safe rather than lossy: an in-memory index forgets at every launch, and
   * the first pull of a launch then reads the whole log — which is what every
   * pull used to do. See `readIndex.ts`.
   */
  readonly readIndex?: ReadIndexStore;
  /**
   * Asked at every pull, after the listing and before anything is read:
   * may this build still work with the vault? Handed every revision the
   * listing found, so it can tell from the identity's revision whether there
   * is anything new to ask. False stops the pull with nothing applied; the
   * caller is expected to stop the loop. Absent, every pull proceeds.
   */
  readonly vaultGate?: (revisions: ReadonlyMap<string, string>) => Promise<boolean>;
  /**
   * The vault's data format this loop writes (docs/sync-v2.md). 1 is the
   * `oplog/` layout, read file by file; 2 is the numbered log with heads and a
   * vector, coach transcripts travelling a message at a time. Defaults to 1,
   * which is what the suites written before format 2 drive; the app runs 2.
   */
  readonly format?: 1 | 2;
  /** Format 2: what has been published of each transcript message. */
  readonly publishedItems?: PublishedItemStore;
  /** Format 2: how far each device's log has been read. */
  readonly vector?: VectorStore;
  /** The app's version, for the read-again-on-upgrade rule (format 2). */
  readonly buildId?: string;
  /** Called after inbound changes land, so the renderer can reload. */
  readonly onApplied?: (result: AppliedChanges) => void;
  readonly onError?: (error: unknown) => void;
}

export interface FlushResult {
  readonly pushed: number;
  readonly path: string | null;
}

/** What a pull wrote, and which accumulating records now read differently. */
export interface AppliedChanges extends ApplyResult {
  /** See `SyncTarget.takeContentChanges`. Committed by the time anyone sees
   *  it: taken after the merge's transaction, never from inside it. */
  readonly contentChanges: readonly ContentChange[];
}

export interface PullResult extends AppliedChanges {
  /** Entries read this time — from the files not read before, not the log. */
  readonly entriesSeen: number;
}

/** A file read by a pull, with what it held. */
interface ReadFile extends LogFile {
  readonly entries: readonly OpEntry[];
  /** A snapshot this build could not parse. */
  readonly unreadable: boolean;
}

interface NewlyRead {
  readonly files: readonly ReadFile[];
  /** Every entry from `files`, as `applyEntries` takes them. */
  readonly entries: OpEntry[];
  /** Recorded reads of files the vault no longer has. */
  readonly gone: readonly ReadRecord[];
}

/**
 * The mark that says whether an entry still has something to give.
 *
 * For most tables that is the record: a newer entry replaces an older one, so
 * one high-water mark per record answers it.
 *
 * A record that **accumulates** needs one mark per *device*. Its entries are
 * folded rather than chosen between, so an entry being older than the record's
 * newest says nothing about whether this machine has its contents — and a
 * single mark drops it. Measured: a turn written offline at 10:00 reaches the
 * vault after another machine's 11:00 entry has already been merged, and every
 * machine skipped it for good because 10:00 is not newer than 11:00.
 */
function versionKey(entry: OpEntry): string {
  const identity = entryIdentity(entry);
  if (entry.scope !== "table" || !isMergedTable(entry.key)) return identity;
  return `${identity}@${parseHlc(entry.hlc).device}`;
}

export class SyncLoop {
  readonly #deps: SyncLoopDeps;
  readonly #clock: HlcClock;
  /** Changes waiting to go out. Survives a failed flush: a push that could not
   *  reach the network must not lose the edit it was carrying. */
  #pending: OpEntry[] = [];
  readonly #readIndex: ReadIndexStore;
  /** Names this launch in the read index: a file left for a later reading is
   *  read again by the next launch, and not by this one. */
  readonly #launch: string;
  readonly #fileCache = new LogFileCache();
  readonly #format: 1 | 2;
  readonly #vector: VectorStore;
  /** Format 2: whether this process has checked its own head and batches
   *  against the number it is about to use. */
  #ownSeqChecked = false;
  #flushTimer: unknown = null;
  #pollTimer: unknown = null;
  #firstPendingAt: number | null = null;
  #lastActivityAt: number | null = null;
  #running = false;
  #held = false;
  #inFlight: Promise<unknown> | null = null;
  /** Held by whichever of `pull` / `flush` / `tick` is running. See
   *  `#exclusive`. */
  #turnstile: Promise<unknown> | null = null;
  /** Work started by a timer, so callers (and the suite) can wait for it
   *  instead of guessing how many ticks a filesystem write takes. */
  #background = new Set<Promise<unknown>>();
  /**
   * The upload currently in the air, if any.
   *
   * Tracked separately from `#background` and `#inFlight` because quit asks a
   * narrower question than "is anything happening": a pull can be abandoned
   * without losing anything, an upload cannot. `flush` takes the queue before
   * it awaits, so between those two moments `#pending` is empty and the only
   * copy of those entries is inside this promise.
   */
  #uploading: Promise<FlushResult> | null = null;

  constructor(deps: SyncLoopDeps) {
    this.#deps = deps;
    this.#readIndex = deps.readIndex ?? createMemoryReadIndex();
    this.#format = deps.format ?? 1;
    this.#vector = deps.vector ?? createMemoryVectorStore();
    this.#launch = `${deps.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const stored = deps.getSetting(SYNC_LOOP_SETTINGS.clock);
    this.#clock = new HlcClock({
      device: deps.deviceId(),
      now: deps.now,
      // Resume from the last timestamp this device issued, so a restart cannot
      // reissue one it has already used.
      last: stored ? safeParseHlc(stored) : undefined
    });
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  /**
   * Whether this device is holding changes the vault has no copy of.
   *
   * The question quit asks, and the reason it is a getter rather than a flush
   * everyone calls: with nothing outstanding — the ordinary case — the caller
   * skips the whole thing and the app closes as fast as it ever did.
   *
   * Both halves count. `#pending` is the debounce window, which is the wide
   * one: a change waits `FLUSH_DEBOUNCE_MS` before it is even attempted, so a
   * turn written and an app closed in the same breath never reached the vault.
   * `#uploading` is the narrow one, and it is the same loss a moment later —
   * `flush` empties the queue before it awaits, so those entries exist nowhere
   * else until the upload returns.
   */
  get hasUnpushedChanges(): boolean {
    // A held loop sends nothing, so quit has nothing to wait for: the queue is
    // in `sync_outbox` for the build that may send it.
    if (this.#held) return false;
    return this.#pending.length > 0 || this.#uploading !== null;
  }

  /**
   * Last chance to get queued changes into the vault, on the way out.
   *
   * Deliberately **one** attempt at the queue, plus whatever was already in the
   * air. A retry loop here would be a loop with no exit on the two cases that
   * reach it most — offline, where `flush` returns instantly and leaves the
   * queue exactly as it found it, and a vault that is refusing writes — and
   * hanging the quit forever is worse than losing the batch. What is not pushed
   * stays in the queue and is simply lost with the process; the caller bounds
   * this with a timeout as well, for a link that neither answers nor fails.
   */
  async flushBeforeQuit(): Promise<void> {
    if (this.#held) return;
    // Before the queue, not after: this upload is holding entries that are no
    // longer in `#pending`, and a `flush` that raced it would push the *next*
    // batch while the older one was still unaccounted for.
    await this.#uploading?.catch(() => undefined);
    if (this.#pending.length === 0) return;
    // Past the turnstile on purpose. Quit is bounded by a timeout and its one
    // job is to get the queue out; queueing behind a pull that may be halfway
    // through downloading the log would spend that budget on work nobody needs
    // finished. A flush racing a pull is what the loop did before the turnstile
    // existed, and it is safe: appending a batch is this device's own directory
    // and no reader is mid-write.
    await this.#flush().catch(() => undefined);
  }

  /** Format 2: a coach conversation's row goes out without its transcript,
   *  and each message that changed goes as an item of its own. */
  #split(entries: readonly OpEntry[]): OpEntry[] {
    if (this.#format !== 2 || !this.#deps.publishedItems) return [...entries];
    return splitIntoItems(entries, this.#deps.publishedItems, this.nextHlc);
  }

  /** The vault, with the log's files served from this process's cache where
   *  it already holds them. Every read and write of the log goes through it;
   *  leases do not, since they are rewritten in place. */
  #storage(): StorageProvider {
    return withLogFileCache(this.#deps.provider(), this.#fileCache);
  }

  nextHlc = (): string => {
    const stamp = this.#clock.tick();
    this.#deps.setSetting(SYNC_LOOP_SETTINGS.clock, formatHlc(stamp));
    return formatHlc(stamp);
  };

  // --- Outbound --------------------------------------------------------------

  /**
   * Queue finished changes.
   *
   * "Finished" is the caller's job: a chat session is enqueued when its
   * assistant turn ends, not while tokens are still arriving. Enqueueing per
   * token would be correct and useless — hundreds of uploads a second, each
   * superseded by the next.
   */
  enqueue(proposed: readonly OpEntry[]): void {
    if (proposed.length === 0) return;
    const entries = this.#split(proposed);
    // Stamped here, before anything is pushed or awaited, because this is the
    // moment the local database moved and a pull already in flight cannot know
    // it. The entry was built by reading the row that was just written, so its
    // HLC is exactly what this machine now holds — and from here on any winner
    // the log offers for that destination has to beat it.
    //
    // `enqueue` is the one door every local change comes through: the bridge's
    // hooks on settings and row writes, and `fullState`'s republish, all end up
    // here. A second door would be a second way to lose a write.
    for (const entry of entries) {
      // Both marks: this machine's row holds the state, and this machine's own
      // entry for it has nothing left to fold.
      this.#deps.recordVersions.set(entryIdentity(entry), entry.hlc);
      this.#deps.recordVersions.set(versionKey(entry), entry.hlc);
    }
    // Durable before it is queued, so the queue is a cache of the table rather
    // than the other way round. Everything between here and a confirmed upload
    // is recoverable by the next launch.
    try {
      this.#deps.outbox.add(entries);
    } catch (error) {
      // A queue that cannot be made durable is still a queue. Letting this
      // escape would take the change with it — the bridge catches and logs, and
      // the entry would exist nowhere — which is a worse failure than the one
      // the table was added to fix.
      this.#deps.onError?.(error);
    }
    this.#pending.push(...entries);
    this.#firstPendingAt ??= this.#deps.now();
    this.#noteActivity();
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (!this.#running) return;
    if (this.#flushTimer !== null) {
      this.#deps.clearTimer(this.#flushTimer);
    }

    // Debounce, but never past the ceiling: a steady trickle of edits would
    // otherwise keep resetting the timer and never upload anything.
    const waited = this.#firstPendingAt
      ? this.#deps.now() - this.#firstPendingAt
      : 0;
    const delay = Math.max(
      0,
      Math.min(FLUSH_DEBOUNCE_MS, FLUSH_MAX_DELAY_MS - waited)
    );

    this.#flushTimer = this.#deps.setTimer(() => {
      this.#flushTimer = null;
      this.#track(this.flush());
    }, delay);
  }

  /** Push whatever is queued. Safe to call directly for a manual "Sync now". */
  async flush(): Promise<FlushResult> {
    return this.#exclusive(() => this.#flush());
  }

  async #flush(): Promise<FlushResult> {
    if (this.#held || this.#pending.length === 0) return { pushed: 0, path: null };
    if (!this.#deps.conditions().online) {
      // Offline: keep the queue and try again on the next flush. Nothing is
      // lost and nothing is reported — this is the normal state on a train.
      return { pushed: 0, path: null };
    }

    const batch = this.#pending;
    this.#pending = [];
    this.#firstPendingAt = null;

    // Published before the first await, so `hasUnpushedChanges` never reads
    // false in the gap between the queue being taken and the upload starting.
    const upload = this.#upload(batch);
    this.#uploading = upload;
    try {
      return await upload;
    } finally {
      // Only if it is still ours: two flushes can overlap, each with its own
      // batch, and the later one is the one still outstanding.
      if (this.#uploading === upload) this.#uploading = null;
    }
  }

  async #upload(batch: OpEntry[]): Promise<FlushResult> {
    if (this.#format === 2) return this.#uploadV2(batch);
    try {
      const written = await appendBatch(
        this.#storage(),
        this.#deps.deviceId(),
        batch
      );
      // Only once the write returned. This is the one moment the vault is known
      // to hold them, and until it comes the next launch has to be able to send
      // them again — a duplicate entry costs nothing, a missing one costs the
      // change.
      this.#deps.outbox.remove(batch);
      // Its own batch is nothing a pull needs to fetch: `enqueue` stamped every
      // entry in it, so reading it back would change nothing. A record lost
      // here costs one download of it, never a change.
      if (written) {
        try {
          this.#readIndex.record([
            {
              path: written.path,
              revision: written.revision,
              state: "done",
              readBy: this.#launch,
              readAt: this.#deps.now()
            }
          ]);
        } catch (error) {
          this.#deps.onError?.(error);
        }
      }
      return { pushed: batch.length, path: written?.path ?? null };
    } catch (error) {
      // Put the work back. A queue that drops entries on a transient failure
      // loses data silently, which is the one outcome worth any amount of code
      // to avoid.
      this.#pending = [...batch, ...this.#pending];
      this.#firstPendingAt ??= this.#deps.now();
      this.#deps.onError?.(error);
      return { pushed: 0, path: null };
    }
  }

  // --- Inbound ---------------------------------------------------------------

  /**
   * Read everything other devices have written and merge it in.
   *
   * Serialised against the rest of the loop rather than only inside `tick`.
   * `tick` has always held `#inFlight` so a slow pull cannot have a second one
   * applying underneath it, but `pull` and `flush` are also public — "Sync now"
   * calls both directly — so the guard belonged on the methods, not on the one
   * caller that remembered it.
   */
  async pull(): Promise<PullResult> {
    try {
      return await this.#exclusive(() => this.#pull());
    } finally {
      // The poll's work, done early — at start-up or on "Sync now" — so the
      // next poll counts from here rather than reading the vault again soon after.
      this.#scheduleNextPoll();
    }
  }

  async #pull(): Promise<PullResult> {
    if (this.#held) return EMPTY_PULL;
    return this.#format === 2 ? this.#pullV2() : this.#pullLegacy();
  }

  /**
   * Format 1: the files of `oplog/` not read before.
   *
   * In format 2 this is the bridge (docs/sync-v2.md §7): a machine still on an
   * older build may write there after the vault moved on, and what it wrote is
   * read here and published again in format 2, for as long as the old log is
   * kept.
   */
  async #pullLegacy(options: { bridge?: boolean } = {}): Promise<PullResult> {
    const startedAt = this.#deps.now();
    const read = await this.#readNewFiles();
    // The vault's format moved past this build: nothing read, nothing applied,
    // and the caller holds the loop.
    if (!read) return EMPTY_PULL;
    return this.#merge(
      read.entries,
      (merged, incomplete) => {
        // In the same transaction as the rows: a read is recorded exactly when
        // what it read has landed, so a crash between the two re-reads the file
        // rather than skipping it.
        this.#readIndex.record(this.#readRecords(read, merged, incomplete));
        this.#readIndex.forget(
          read.gone.filter((record) => record.readAt < startedAt).map((r) => r.path)
        );
      },
      options
    );
  }

  /**
   * Apply what was read, and say what landed.
   *
   * `commit` runs inside the merge's transaction, so whatever records how far
   * this machine has read — the read index, the vector — moves exactly when the
   * rows do.
   */
  #merge(
    entries: OpEntry[],
    commit: (merged: ApplyResult, incomplete: ReadonlySet<string>) => void,
    options: { bridge?: boolean } = {}
  ): PullResult {
    // Only for the clock fold below. What may be *applied* is no longer a
    // question about who wrote an entry — see the comment on `applyEntries`.
    const mine = this.#deps.deviceId();
    const foreign = entries.filter((entry) => !entry.hlc.endsWith(`-${mine}`));

    // Fold every remote timestamp into the clock before issuing another, so
    // anything this device does next sorts after what it has just seen.
    for (const entry of foreign) {
      this.#clock.observeString(entry.hlc);
    }
    // Only what was read this time, which is what makes it a sign of activity.
    // It used to be every foreign entry in the log, and a vault any other
    // machine had ever written to has those in its snapshot for good — so the
    // loop never left the fast interval, and pulled the whole log every five
    // seconds for as long as a window was open.
    if (foreign.length > 0) {
      this.#deps.setSetting(
        SYNC_LOOP_SETTINGS.clock,
        formatHlc(this.#clock.last)
      );
      this.#noteActivity();
    }

    // Resolved over what was read; written back only where the winner is
    // causally later than what this machine already holds. Reading only the
    // files not read before changes nothing here: an entry in a file already
    // read was applied then, found already held, or lost to one that was —
    // so the stamps below already outrank it, and reading it again would skip
    // it. A file that left anything for a later reading is not skipped; see
    // `#readRecords`.
    //
    // That second half is the whole guard, and it has to be a comparison rather
    // than a rule about authorship. `applyEntries` resolves entries against each
    // other and never against the database, and `SqliteSyncTarget.upsertRow` is
    // an unconditional `INSERT OR REPLACE` — so "this entry won the log" and
    // "this entry is newer than the row it is about to replace" are different
    // questions, and only the second one is safe to act on.
    //
    // The log a pull acts on is the log as it was when `readAllEntries` began,
    // and that read is a full fetch over the network. Anything written here in
    // the meantime is invisible to it: a headless analysis run finished inside
    // one, wrote its answer into a conversation and queued it, and the pull —
    // whose newest copy of that row was one another machine had published two
    // days earlier — wrote that over the answer. Measured, not hypothetical:
    // the vault ended up holding the 96-entry transcript and this machine the
    // 93-entry one, byte for byte the other device's copy, while the run log
    // said the analysis had succeeded.
    //
    // `recordVersions` is stamped by `enqueue` at the moment of that local
    // write, so the stale winner is simply older and is skipped. It replaces
    // two guards that each covered a corner of this:
    //
    //   * skipping anything this device authored, which did nothing about a
    //     *foreign* entry older than the local row — and which made the loss
    //     above permanent, since the winning entry afterwards was this device's
    //     own and the good copy in the vault could never be applied back.
    //   * an in-memory note of what this process had merged, empty after every
    //     launch, so the whole log was re-merged on each first pull — which is
    //     precisely when the race is live.
    //
    // `localStorage` is stamped like everything else. Applying one of those
    // entries writes it to the target's inbox, in this same transaction, and
    // it leaves the inbox only when the renderer says it wrote the value — so a
    // quit in between owes nothing to a re-read of the log. It used to be a
    // queue in memory, which is why these entries were once never stamped and
    // the files holding them were read again at every launch.
    //
    // A row the target took only part of — columns this build has no schema
    // for — is the one thing not stamped: it landed, but not as the entry
    // describes it, and a later build has to be able to finish the job. Its
    // file is left for the next launch to read again (`#readRecords`).
    const versions = this.#deps.recordVersions;
    const target = this.#deps.target;
    // One transaction for the rows *and* the stamps that say this machine holds
    // them. A merge used to be a few hundred separate writes with nothing
    // spanning them, so a crash partway left a state no device had ever been
    // in — an analysis row arriving without the conversation it names, for
    // instance. Committing the stamps alongside also keeps the two from
    // disagreeing: stamps without rows would skip entries that never landed.
    //
    // The per-entry `try` inside `applyEntries` still stands. A statement that
    // fails does not abort a SQLite transaction, so one unusable entry costs
    // one entry here exactly as it did before.
    const runMerge = (): ApplyResult => {
      // Drained before, not only after. Both are filled inside the transaction,
      // so a merge that threw would leave them holding rows that were rolled
      // back — and the republish below would then publish content this database
      // does not have.
      target.takeIncomplete?.();
      target.takeRepublish?.();
      target.takeContentChanges?.();

      const merged = applyEntries(target, entries, {
        isApplied: (entry) => !shouldApply(versions, versionKey(entry), entry.hlc),
        // Winning the log is not enough to overwrite a row's other columns. An
        // entry can win and still be older than what is here — a turn written
        // on a plane reaches the vault after one written since — and its
        // transcript half is still wanted while its title is not.
        isAuthoritative: (entry, won) =>
          won && shouldApply(versions, entryIdentity(entry), entry.hlc)
      });

      const incomplete = new Set(target.takeIncomplete?.() ?? []);
      for (const entry of merged.merged) {
        const key = versionKey(entry);
        if (incomplete.has(entryIdentity(entry))) continue;
        versions.set(key, entry.hlc);
        // The record's own mark moves too, so the column guard above keeps
        // working for a merged table — `versionKey` only splits the *fold*.
        versions.set(entryIdentity(entry), entry.hlc);
      }
      commit(merged, incomplete);
      return merged;
    };
    const merged = target.transaction ? target.transaction(runMerge) : runMerge();
    const result: AppliedChanges = {
      ...merged,
      contentChanges: target.takeContentChanges?.() ?? []
    };

    // A union neither side had has to go back out, or the vault's newest entry
    // for that row stays the incoming one — which does not hold this machine's
    // half, and compaction eventually folds away the entry that did. Outside
    // the transaction because `enqueue` opens its own, and after it because
    // there is nothing to publish until the merge has committed.
    //
    // It terminates: the other machine merges this union against a copy it
    // already equals, produces nothing new, and publishes nothing.
    const republish = target.takeRepublish?.() ?? [];
    if (republish.length > 0) {
      const builder = new ChangeBuilder({ nextHlc: this.nextHlc });
      for (const row of republish) {
        builder.row(row.table, row.recordId, row.row);
      }
      this.enqueue(builder.entries);
    }
    if (options.bridge) this.#republishBridged(merged.merged, result.contentChanges);

    this.#deps.setSetting(
      SYNC_LOOP_SETTINGS.lastPulledAt,
      new Date(this.#deps.now()).toISOString()
    );
    if (result.applied > 0 || result.deleted > 0) {
      this.#deps.onApplied?.(result);
    }
    return { ...result, entriesSeen: entries.length };
  }

  /**
   * Format 2: what the heads say is new, and the snapshot when it is needed.
   *
   * A head whose revision is the one last seen is not fetched, so with nothing
   * new a pull is one listing. A device whose next batch is gone was compacted
   * past this machine, and the snapshot covering it is read; so is the newest
   * snapshot when this machine has never read one, and once after the app
   * version changes (`fullReadBuild`).
   */
  async #pullV2(): Promise<PullResult> {
    const storage = this.#storage();
    const listing = await listVault(storage);
    if (this.#deps.vaultGate && !(await this.#deps.vaultGate(listing.revisions))) {
      return EMPTY_PULL;
    }
    const self = this.#deps.deviceId();
    const held = this.#vector.load();
    const next = new Map<string, VectorRecord>(held);
    const appliedOf = (device: string) => next.get(device)?.seq ?? 0;

    // This machine's own head, written back if it is missing: a batch whose
    // head write failed is invisible to the others until one is.
    const ownSeq = held.get(self)?.seq ?? 0;
    if (ownSeq > 0 && !listing.heads.has(self)) {
      await writeHead(storage, self, ownSeq).catch((error) => this.#deps.onError?.(error));
    }

    const heads = new Map<string, { seq: number; revision: string }>();
    for (const [device, revision] of listing.heads) {
      if (device === self) continue;
      const known = held.get(device);
      if (known && known.headRevision === revision) {
        heads.set(device, { seq: known.headSeq, revision });
        continue;
      }
      const stored = await storage.get(headPathFor(device));
      const seq = stored ? parseHead(stored.content) : null;
      if (seq !== null && stored) heads.set(device, { seq, revision: stored.revision });
    }

    const buildId = this.#deps.buildId;
    const resync =
      buildId !== undefined &&
      this.#deps.getSetting(SYNC_LOOP_SETTINGS.fullReadBuild) !== buildId;
    const lastSnapshot = this.#deps.getSetting(SYNC_LOOP_SETTINGS.lastSnapshot);
    const latest = listing.snapshots[listing.snapshots.length - 1];
    const gap = [...heads].some(([device, head]) => {
      const applied = appliedOf(device);
      return head.seq > applied && !(listing.logs.get(device) ?? []).includes(applied + 1);
    });

    const entries: OpEntry[] = [];
    let snapshotRead: string | null = null;
    if (resync) {
      // Read again from the snapshot: every other device back to what it holds.
      for (const [device, record] of next) {
        if (device !== self) next.set(device, { ...record, seq: 0 });
      }
    }
    if (latest && (resync || (latest !== lastSnapshot && (gap || lastSnapshot === undefined)))) {
      const snapshot = await readSnapshotAt(storage, latest);
      if (snapshot) {
        entries.push(...snapshot.entries);
        for (const [device, seq] of Object.entries(snapshot.vector)) {
          if (device === self) continue;
          const record = next.get(device) ?? { seq: 0, headSeq: 0, headRevision: null };
          next.set(device, { ...record, seq: Math.max(record.seq, seq) });
        }
        snapshotRead = latest;
      }
    }

    for (const [device, head] of heads) {
      let seq = appliedOf(device);
      while (seq < head.seq) {
        const batch = await readLogBatch(storage, device, seq + 1);
        // Gone: compacted between the listing and now. The next pull reads the
        // snapshot that covers it.
        if (!batch) break;
        entries.push(...batch);
        seq += 1;
      }
      next.set(device, { seq, headSeq: head.seq, headRevision: head.revision });
    }

    const result = this.#merge(entries, () => {
      this.#vector.save(next);
      if (snapshotRead) {
        this.#deps.setSetting(SYNC_LOOP_SETTINGS.lastSnapshot, snapshotRead);
      }
      if (resync && buildId !== undefined) {
        this.#deps.setSetting(SYNC_LOOP_SETTINGS.fullReadBuild, buildId);
      }
    });

    // The bridge, for as long as the format-1 log is there.
    const legacy = [...listing.revisions.keys()].some(
      (path) => path.startsWith("oplog/") || path.startsWith("oplog-snapshot/")
    );
    if (!legacy) return result;
    const bridged = await this.#pullLegacy({ bridge: true });
    return {
      applied: result.applied + bridged.applied,
      deleted: result.deleted + bridged.deleted,
      superseded: result.superseded + bridged.superseded,
      rejected: [...result.rejected, ...bridged.rejected],
      merged: [...result.merged, ...bridged.merged],
      contentChanges: [...result.contentChanges, ...bridged.contentChanges],
      entriesSeen: result.entriesSeen + bridged.entriesSeen
    };
  }

  /**
   * Format 2: claim the next batch number, then move the head.
   *
   * The number is this machine's own, but a machine that lost its database —
   * or crashed between a batch and its record — can only find it in the
   * vault, so the first upload of a process checks the head and the batches
   * there. A number already taken is a conflict, answered by looking again.
   */
  async #uploadV2(batch: OpEntry[]): Promise<FlushResult> {
    try {
      const storage = this.#storage();
      const self = this.#deps.deviceId();
      let seq = (this.#vector.load().get(self)?.seq ?? 0) + 1;
      if (!this.#ownSeqChecked) {
        seq = Math.max(seq, (await this.#ownSeqInVault(storage, self)) + 1);
        this.#ownSeqChecked = true;
      }
      let path: string;
      try {
        path = await writeLogBatch(storage, self, seq, batch);
      } catch (error) {
        if (!(error instanceof StorageConflictError)) throw error;
        seq = (await this.#ownSeqInVault(storage, self)) + 1;
        path = await writeLogBatch(storage, self, seq, batch);
      }
      this.#vector.save(new Map([[self, { seq, headSeq: seq, headRevision: null }]]));
      this.#deps.outbox.remove(batch);
      // After the batch is safe: a head that fails to move only delays the
      // others seeing it, and the next batch or pull writes it again.
      await writeHead(storage, self, seq).catch((error) => this.#deps.onError?.(error));
      return { pushed: batch.length, path };
    } catch (error) {
      this.#pending = [...batch, ...this.#pending];
      this.#firstPendingAt ??= this.#deps.now();
      this.#deps.onError?.(error);
      return { pushed: 0, path: null };
    }
  }

  async #ownSeqInVault(storage: StorageProvider, self: string): Promise<number> {
    const listing = await listVault(storage);
    const logged = listing.logs.get(self) ?? [];
    let head = 0;
    if (listing.heads.has(self)) {
      const stored = await storage.get(headPathFor(self));
      head = (stored && parseHead(stored.content)) || 0;
    }
    return Math.max(head, logged[logged.length - 1] ?? 0);
  }

  /**
   * The bridge's half on the way out: what a format-1 file brought in is
   * published again in format 2, or the machines reading only the new log
   * would never see it. An ordinary record goes as the entry it arrived as, its
   * timestamp kept; a conversation goes as it now reads here, so its messages
   * are compared against what was published and only what is new travels.
   */
  #republishBridged(
    merged: readonly OpEntry[],
    contentChanges: readonly ContentChange[]
  ): void {
    const plain = merged.filter(
      (entry) => !(entry.scope === "table" && entry.key === "chat_sessions")
    );
    if (plain.length > 0) this.enqueue(plain);
    const builder = new ChangeBuilder({ nextHlc: this.nextHlc });
    for (const change of contentChanges) {
      if (change.table !== "chat_sessions") continue;
      if (change.removed) {
        builder.deleteRow(change.table, change.recordId);
        continue;
      }
      const row = this.#deps.target.readRow?.(change.table, change.recordId);
      if (row) builder.row(change.table, change.recordId, row);
    }
    if (builder.entries.length > 0) this.enqueue(builder.entries);
  }

  /**
   * Move a format-1 vault to format 2 (docs/sync-v2.md §7), once, under a
   * lease so two machines upgraded together do it once between them.
   *
   * Read the old log one last time, write a snapshot of what this machine now
   * holds — each record under the timestamp it came from, so nothing written
   * elsewhere loses to it for being older — and only then raise the vault's
   * format. Until that last step every other machine still reads format 1, and
   * a migration that stops part-way leaves a snapshot nobody reads.
   *
   * `collect` hands over every syncable record with the timestamp it holds;
   * `stillNeeded` asks the vault again once the lease is held; `raiseFormat`
   * writes the identity. False when another machine holds the lease or the
   * vault has already moved.
   */
  async migrateToV2(options: {
    readonly collect: () => readonly OpEntry[];
    readonly stillNeeded: () => Promise<boolean>;
    readonly raiseFormat: () => Promise<void>;
  }): Promise<boolean> {
    return this.#exclusive(async () => {
      const lease = new Lease(FORMAT_MIGRATION_LEASE, {
        provider: this.#deps.provider,
        deviceId: this.#deps.deviceId,
        now: this.#deps.now,
        ttlMs: COMPACT_LEASE_TTL_MS
      });
      const held = await lease.withLease(async () => {
        if (!(await options.stillNeeded())) return false;
        await this.#pullLegacy();
        const published = this.#deps.publishedItems;
        const stamped = options.collect();
        // Split against an empty record, so the snapshot holds every message
        // and not only the ones this machine has not sent yet; then recorded as
        // published, so the next save of each conversation sends nothing again.
        const entries = published
          ? splitIntoItems(stamped, createMemoryPublishedItems(), this.nextHlc, {
              itemHlc: (row) => row.hlc
            })
          : [...stamped];
        if (published) {
          for (const entry of entries) {
            if (entry.scope !== "item" || entry.op !== "set" || !entry.recordId) continue;
            const parts = splitItemRecordId(entry.recordId);
            const element = entry.payload?.entry;
            if (!parts || !element || typeof element !== "object") continue;
            published.set(entry.key, parts[0], parts[1], elementHash(element as ListElement));
          }
        }
        for (const entry of entries) {
          this.#deps.recordVersions.set(entryIdentity(entry), entry.hlc);
        }
        const path = snapshotPathFor(this.nextHlc());
        await this.#storage().put(
          path,
          encodeSnapshot({ version: 2, vector: {}, entries }),
          null
        );
        this.#deps.setSetting(SYNC_LOOP_SETTINGS.lastSnapshot, path);
        if (this.#deps.buildId !== undefined) {
          this.#deps.setSetting(SYNC_LOOP_SETTINGS.fullReadBuild, this.#deps.buildId);
        }
        await options.raiseFormat();
        return true;
      });
      return held.ran ? held.result : false;
    });
  }

  /**
   * Format 2: the old log, deleted once nothing has been written to it for
   * `LEGACY_LOG_RETENTION_MS` — by then every machine still on an old build
   * has either stopped or been bridged.
   */
  async #retireLegacyLog(): Promise<void> {
    const storage = this.#storage();
    const legacy = (await storage.list()).filter(
      (entry) => entry.path.startsWith("oplog/") || entry.path.startsWith("oplog-snapshot/")
    );
    if (legacy.length === 0) return;
    const newest = Math.max(...legacy.map((entry) => Date.parse(entry.modifiedAt) || 0));
    if (this.#deps.now() - newest < LEGACY_LOG_RETENTION_MS) return;
    for (const entry of legacy) {
      await storage.delete(entry.path).catch(() => undefined);
    }
  }

  /**
   * Download the files of the log this machine has not read yet.
   *
   * The listing is metadata only; what is fetched is each batch not read
   * before and the newest snapshot, if that is new. A pull with nothing new
   * therefore costs one listing — it used to download the whole log.
   */
  async #readNewFiles(): Promise<NewlyRead | null> {
    const storage = this.#storage();
    const listing = await listLogFiles(storage);
    if (this.#deps.vaultGate && !(await this.#deps.vaultGate(listing.revisions))) {
      return null;
    }
    const known = this.#readIndex.load();
    const fresh = (file: LogFile) =>
      needsRead(known.get(file.path), file.revision, this.#launch);

    const files: ReadFile[] = [];
    const entries: OpEntry[] = [];

    // Only the newest snapshot, as `readLog` reads it; an older one is about to
    // be deleted by the pass that wrote its successor.
    const snapshot = listing.snapshots[listing.snapshots.length - 1];
    const folded = new Set<string>();
    if (snapshot && fresh(snapshot)) {
      const stored = await storage.get(snapshot.path);
      if (stored) {
        const parsed = parseOplogSnapshot(stored.content);
        // A snapshot this build cannot read may be a newer build's: read it
        // again next launch rather than never.
        files.push({ ...snapshot, entries: parsed?.entries ?? [], unreadable: !parsed });
        for (const entry of parsed?.entries ?? []) {
          entries.push(entry);
          folded.add(entry.hlc);
        }
      }
    }

    for (const batch of listing.batches) {
      if (!fresh(batch)) continue;
      const stored = await storage.get(batch.path);
      // Deleted between the listing and now: compaction folded it into a
      // snapshot, which the next listing shows as new.
      if (!stored) continue;
      // What the snapshot read alongside already holds, by timestamp, as
      // `readLog` skips it — a batch straddling the horizon is in both.
      const parsed = parseBatch(stored.content).filter((entry) => !folded.has(entry.hlc));
      files.push({ ...batch, entries: parsed, unreadable: false });
      entries.push(...parsed);
    }

    const listed = new Set(
      [...listing.batches, ...listing.snapshots].map((file) => file.path)
    );
    const gone = [...known.values()].filter((record) => !listed.has(record.path));
    return { files, entries, gone };
  }

  /**
   * How each file read this time is recorded: `done` when nothing in it waits
   * on a later reading, `retry` when something does.
   *
   * `retry` is everything the loop has always left for the next launch to
   * read again, back when every pull read everything: a row the target took
   * only part of, and an entry this build refuses but a newer one might take —
   * unclassified, not synced by this build, or one the target threw on. Only a
   * malformed entry and one sealed to another machine's keychain are refused
   * for good. A `localStorage` entry is not among them: it waits in the
   * target's inbox until the renderer acknowledges it.
   */
  #readRecords(
    read: NewlyRead,
    merged: ApplyResult,
    incomplete: ReadonlySet<string>
  ): ReadRecord[] {
    const pending = new Set<OpEntry>();
    for (const rejected of merged.rejected) {
      if (rejected.reason !== "malformed" && rejected.reason !== "device-encrypted") {
        pending.add(rejected.entry);
      }
    }
    for (const entry of merged.merged) {
      if (incomplete.has(entryIdentity(entry))) pending.add(entry);
    }
    const readAt = this.#deps.now();
    return read.files.map((file) => {
      const retry =
        file.unreadable ||
        file.entries.some((entry) => pending.has(entry));
      return {
        path: file.path,
        revision: file.revision,
        state: retry ? "retry" : "done",
        readBy: this.#launch,
        readAt
      };
    });
  }

  // --- Compaction ------------------------------------------------------------

  /**
   * Fold the log down, at most one device at a time and at most every few
   * hours.
   *
   * Runs after a pull rather than before: the entries this device just merged
   * are then already in the database, so a pass that prunes them cannot lose
   * anything this machine had not seen.
   *
   * Never throws into the caller. Compaction is housekeeping — a vault that
   * refuses it stays correct, only larger — so a failure is reported through
   * `onError` and the next window tries again.
   */
  async compactIfDue(): Promise<CompactOplogResult | CompactVaultResult | null> {
    if (this.#held) return null;
    const now = this.#deps.now();
    const last = Number(
      this.#deps.getSetting(SYNC_LOOP_SETTINGS.lastCompactedAt) ?? 0
    );
    if (Number.isFinite(last) && now - last < COMPACT_INTERVAL_MS) {
      return null;
    }
    // Stamped before the attempt, not after. A pass that fails on a huge log
    // would otherwise be retried on the very next poll, which is the case least
    // able to afford it.
    this.#deps.setSetting(SYNC_LOOP_SETTINGS.lastCompactedAt, String(now));

    const lease = new Lease(COMPACT_LEASE, {
      provider: this.#deps.provider,
      deviceId: this.#deps.deviceId,
      now: this.#deps.now,
      ttlMs: COMPACT_LEASE_TTL_MS
    });

    try {
      const held = await lease.withLease(async () => {
        if (this.#format !== 2) {
          return compactOplog(this.#storage(), { now: this.#deps.now });
        }
        const result = await compactVault(this.#storage(), {
          now: this.#deps.now,
          nextHlc: this.nextHlc
        });
        await this.#retireLegacyLog();
        return result;
      });
      return held.ran ? held.result : null;
    } catch (error) {
      this.#deps.onError?.(error);
      return null;
    }
  }

  // --- Presence --------------------------------------------------------------

  /** Announce what this device is doing, so another one can show "in use here"
   *  rather than letting two people generate into the same session at once. */
  async announce(activeSessionId: string | null): Promise<void> {
    const claim: PresenceClaim = {
      deviceId: this.#deps.deviceId(),
      deviceName: this.#deps.deviceName(),
      at: this.#deps.now(),
      activeSessionId
    };
    await this.#deps
      .provider()
      .put(
        `${PRESENCE_PREFIX}/${claim.deviceId}.json`,
        Buffer.from(JSON.stringify(claim), "utf8")
      );
  }

  /** Other devices currently claiming to be active. Stale claims are ignored
   *  rather than deleted: the device that wrote one may simply have closed its
   *  laptop, and it will overwrite its own claim when it comes back. */
  async otherDevices(): Promise<PresenceClaim[]> {
    const provider = this.#deps.provider();
    const mine = this.#deps.deviceId();
    const now = this.#deps.now();
    const claims: PresenceClaim[] = [];

    for (const entry of await provider.list(PRESENCE_PREFIX)) {
      if (entry.path.endsWith(`/${mine}.json`)) continue;
      const stored = await provider.get(entry.path);
      if (!stored) continue;
      try {
        const claim = JSON.parse(stored.content.toString("utf8")) as PresenceClaim;
        if (claim?.deviceId && isPresenceFresh(claim, now)) claims.push(claim);
      } catch {
        // A claim written by a newer version, or a torn write. Skip it.
      }
    }
    return claims;
  }

  // --- The loop itself -------------------------------------------------------

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#adoptOutbox();
    this.#scheduleNextPoll();
  }

  /**
   * Take over whatever the last launch could not send.
   *
   * Deliberately in `start` and not the constructor: a loop is built before the
   * vault is known to be usable, and re-queueing is only meaningful once
   * something is going to try sending it. Entries already in `#pending` are
   * kept and not doubled — `attachSyncSink` replays the boot window's writes
   * before `start` runs, and those are in the table too.
   */
  #adoptOutbox(): void {
    try {
      const known = new Set(this.#pending.map((entry) => entry.hlc));
      const held = this.#deps.outbox
        .load()
        .filter((entry) => !known.has(entry.hlc));
      if (held.length === 0) return;
      // A queue left by a format-1 build holds whole conversations. Split as
      // they go out; the new items are queued durably as well, and the row
      // keeps its timestamp, so confirming the upload releases the original.
      const split = this.#split(held);
      const original = new Set(held.map((entry) => entry.hlc));
      const added = split.filter((entry) => !original.has(entry.hlc));
      if (added.length > 0) this.#deps.outbox.add(added);
      // Added to the queue, never substituted for it. `enqueue` treats a table
      // it cannot write to as a warning rather than a failure — the change is
      // still queued in memory — so replacing the queue with the table would
      // throw away exactly the entries that write failed for.
      this.#pending = [...this.#pending, ...split];
      this.#firstPendingAt ??= this.#deps.now();
      this.#scheduleFlush();
    } catch (error) {
      // A queue that cannot be read must not stop the loop: everything else
      // still works, and the next write re-queues normally.
      this.#deps.onError?.(error);
    }
  }

  /**
   * Stop sending and reading, and keep queueing.
   *
   * For a vault in a data format this build may not work with: nothing may be
   * read from it or written to it, and a change made here meanwhile must still
   * reach it once the app is updated. `enqueue` keeps writing to the durable
   * outbox — which the updated build adopts and sends — while flush, pull,
   * compaction and the flush at quit all do nothing. Final for this loop: a
   * vault's format never moves back.
   */
  hold(): void {
    this.#held = true;
    this.stop();
  }

  get isHeld(): boolean {
    return this.#held;
  }

  stop(): void {
    this.#running = false;
    if (this.#pollTimer !== null) this.#deps.clearTimer(this.#pollTimer);
    if (this.#flushTimer !== null) this.#deps.clearTimer(this.#flushTimer);
    this.#pollTimer = null;
    this.#flushTimer = null;
  }

  /**
   * One round at a time, whoever asks.
   *
   * A queue rather than a "skip if busy": a caller that asked for a flush is
   * owed one, and `tick`'s old `if (#inFlight) await it; return;` answered a
   * "Sync now" with somebody else's half-finished round. Waiting is what the
   * caller meant.
   */
  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    while (this.#turnstile) {
      await this.#turnstile.catch(() => undefined);
    }
    const running = work();
    this.#turnstile = running;
    try {
      return await running;
    } finally {
      if (this.#turnstile === running) this.#turnstile = null;
    }
  }

  #track(work: Promise<unknown>): void {
    const tracked = work.finally(() => this.#background.delete(tracked));
    this.#background.add(tracked);
  }

  /** Resolves once nothing this loop started is still running. */
  async whenIdle(): Promise<void> {
    while (this.#background.size > 0 || this.#inFlight) {
      await Promise.allSettled([...this.#background, this.#inFlight]);
    }
  }

  #noteActivity(): void {
    this.#lastActivityAt = this.#deps.now();
  }

  #scheduleNextPoll(): void {
    if (!this.#running) return;
    if (this.#pollTimer !== null) this.#deps.clearTimer(this.#pollTimer);

    const delay = nextPollDelay({
      ...this.#deps.conditions(),
      lastActivityAt: this.#lastActivityAt,
      now: this.#deps.now()
    });

    // A null delay means there is nothing worth waking for, which only a
    // missing window earns. `resume()` starts the loop again when one comes
    // back — being offline backs the interval off instead, so no restart is
    // owed to a link returning.
    if (delay === null) {
      this.#pollTimer = null;
      return;
    }

    this.#pollTimer = this.#deps.setTimer(() => {
      this.#pollTimer = null;
      this.#track(this.tick());
    }, delay);
  }

  /** One round: push what is queued, then read what has arrived. */
  async tick(): Promise<void> {
    // Never run two rounds at once — a slow pull must not have a second pull
    // applying entries underneath it.
    if (this.#inFlight) {
      await this.#inFlight;
      return;
    }
    this.#inFlight = this.#exclusive(async () => {
      try {
        await this.#flush();
        if (this.#deps.conditions().online) {
          await this.#pull();
          // After the pull, so anything pruned is already merged here.
          await this.compactIfDue();
        }
      } catch (error) {
        this.#deps.onError?.(error);
      } finally {
        this.#inFlight = null;
        this.#scheduleNextPoll();
      }
    });
    await this.#inFlight;
  }

  /** Call when a window comes back, or after the machine wakes from sleep —
   *  both are moments a pull is worth more than the idle interval. */
  resume(): void {
    if (!this.#running) return;
    this.#noteActivity();
    this.#scheduleNextPoll();
  }
}

function safeParseHlc(value: string) {
  try {
    return parseHlc(value);
  } catch {
    return undefined;
  }
}
