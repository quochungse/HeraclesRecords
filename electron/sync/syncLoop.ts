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
import type { OutboxStore } from "./outbox";
import {
  appendBatch,
  compactOplog,
  entryIdentity,
  readAllEntries,
  type CompactOplogResult,
  type OpEntry
} from "./oplog";
import { Lease } from "./lease";
import { applyEntries, type ApplyResult, type SyncTarget,
  ChangeBuilder
} from "./syncEngine";
import type { StorageProvider } from "./storageProvider";

export const SYNC_LOOP_SETTINGS = {
  clock: "sync.clock",
  lastPulledAt: "sync.lastPulledAt",
  lastCompactedAt: "sync.lastCompactedAt"
} as const;

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
  /** Called after inbound changes land, so the renderer can reload. */
  readonly onApplied?: (result: ApplyResult) => void;
  readonly onError?: (error: unknown) => void;
}

export interface FlushResult {
  readonly pushed: number;
  readonly path: string | null;
}

export interface PullResult extends ApplyResult {
  readonly entriesSeen: number;
}

export class SyncLoop {
  readonly #deps: SyncLoopDeps;
  readonly #clock: HlcClock;
  /** Changes waiting to go out. Survives a failed flush: a push that could not
   *  reach the network must not lose the edit it was carrying. */
  #pending: OpEntry[] = [];
  /**
   * "Already merged", for the entries whose application this process must not
   * promise on behalf of the next one.
   *
   * Two kinds land here, for the same reason at one remove. A `localStorage`
   * entry queues work for the renderer rather than performing it, so a quit
   * before it is delivered owes that work still. A row the target could take
   * only part of — columns this build has no schema for — landed, but not as
   * the entry describes it, and a later build has to be able to finish the job.
   * Both are suppressed for this process, so neither churns `onApplied` every
   * poll, and both come back on the next launch.
   */
  readonly #localStorageMerged = new Map<string, string>();
  #flushTimer: unknown = null;
  #pollTimer: unknown = null;
  #firstPendingAt: number | null = null;
  #lastActivityAt: number | null = null;
  #running = false;
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
  enqueue(entries: readonly OpEntry[]): void {
    if (entries.length === 0) return;
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
      this.#deps.recordVersions.set(entryIdentity(entry), entry.hlc);
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
    if (this.#pending.length === 0) return { pushed: 0, path: null };
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
    try {
      const written = await appendBatch(
        this.#deps.provider(),
        this.#deps.deviceId(),
        batch
      );
      // Only once the write returned. This is the one moment the vault is known
      // to hold them, and until it comes the next launch has to be able to send
      // them again — a duplicate entry costs nothing, a missing one costs the
      // change.
      this.#deps.outbox.remove(batch);
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
    return this.#exclusive(() => this.#pull());
  }

  async #pull(): Promise<PullResult> {
    const provider = this.#deps.provider();
    const entries = await readAllEntries(provider);

    // Only for the clock fold below. What may be *applied* is no longer a
    // question about who wrote an entry — see the comment on `applyEntries`.
    const mine = this.#deps.deviceId();
    const foreign = entries.filter((entry) => !entry.hlc.endsWith(`-${mine}`));

    // Fold every remote timestamp into the clock before issuing another, so
    // anything this device does next sorts after what it has just seen.
    for (const entry of foreign) {
      this.#clock.observeString(entry.hlc);
    }
    if (foreign.length > 0) {
      this.#deps.setSetting(
        SYNC_LOOP_SETTINGS.clock,
        formatHlc(this.#clock.last)
      );
      this.#noteActivity();
    }

    // Resolved over the whole log; written back only where the winner is
    // causally later than what this machine already holds.
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
    // `localStorage` is deliberately not stamped durably, and the asymmetry is
    // the point. Applying one of those entries does not write anything: it
    // queues an operation for the renderer, which performs it whenever a window
    // is next ready. Nothing acknowledges that it did, so a durable stamp would
    // record as held something that a quit in between simply loses. Held in
    // memory instead, the queue is rebuilt on the next launch and the renderer
    // writes the value again — idempotent, and the only direction in which the
    // preference cannot be lost. Making it durable means persisting the pending
    // operations and clearing them on an acknowledgement from the renderer,
    // which is the honest fix and a larger one.
    const versions = this.#deps.recordVersions;
    const durable = (entry: OpEntry): boolean => entry.scope !== "localStorage";
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

      const merged = applyEntries(target, entries, {
        isApplied: (entry) => {
          const identity = entryIdentity(entry);
          return durable(entry)
            ? !shouldApply(versions, identity, entry.hlc)
            : this.#localStorageMerged.get(identity) === entry.hlc;
        }
      });

      const incomplete = new Set(target.takeIncomplete?.() ?? []);
      for (const entry of merged.merged) {
        const identity = entryIdentity(entry);
        if (durable(entry) && !incomplete.has(identity)) {
          versions.set(identity, entry.hlc);
        } else {
          this.#localStorageMerged.set(identity, entry.hlc);
        }
      }
      return merged;
    };
    const result = target.transaction ? target.transaction(runMerge) : runMerge();

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

    this.#deps.setSetting(
      SYNC_LOOP_SETTINGS.lastPulledAt,
      new Date(this.#deps.now()).toISOString()
    );
    if (result.applied > 0 || result.deleted > 0) {
      this.#deps.onApplied?.(result);
    }
    return { ...result, entriesSeen: entries.length };
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
  async compactIfDue(): Promise<CompactOplogResult | null> {
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
      const held = await lease.withLease(() =>
        compactOplog(this.#deps.provider(), { now: this.#deps.now })
      );
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
      // Added to the queue, never substituted for it. `enqueue` treats a table
      // it cannot write to as a warning rather than a failure — the change is
      // still queued in memory — so replacing the queue with the table would
      // throw away exactly the entries that write failed for.
      this.#pending = [...this.#pending, ...held];
      this.#firstPendingAt ??= this.#deps.now();
      this.#scheduleFlush();
    } catch (error) {
      // A queue that cannot be read must not stop the loop: everything else
      // still works, and the next write re-queues normally.
      this.#deps.onError?.(error);
    }
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
