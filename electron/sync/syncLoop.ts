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
  appendBatch,
  compactOplog,
  entryIdentity,
  readAllEntries,
  type CompactOplogResult,
  type OpEntry
} from "./oplog";
import { Lease } from "./lease";
import { applyEntries, type ApplyResult, type SyncTarget } from "./syncEngine";
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
   * What this device has already merged: entry identity -> the timestamp of the
   * winner it was given.
   *
   * The log has no cursor — `readAllEntries` returns all of it, every poll — so
   * this is what stops the same rows being rewritten to SQLite every few
   * seconds and `onApplied` firing forever with nothing new to report.
   *
   * In memory on purpose. A restart re-merges the log once, which is harmless:
   * the local state it would overwrite came from that same log. Persisting a
   * high-water mark instead would be wrong, because a device that was offline
   * appends entries stamped *below* whatever the others have already seen.
   */
  readonly #merged = new Map<string, string>();
  #flushTimer: unknown = null;
  #pollTimer: unknown = null;
  #firstPendingAt: number | null = null;
  #lastActivityAt: number | null = null;
  #running = false;
  #inFlight: Promise<unknown> | null = null;
  /** Work started by a timer, so callers (and the suite) can wait for it
   *  instead of guessing how many ticks a filesystem write takes. */
  #background = new Set<Promise<unknown>>();

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
    if (this.#pending.length === 0) return { pushed: 0, path: null };
    if (!this.#deps.conditions().online) {
      // Offline: keep the queue and try again on the next flush. Nothing is
      // lost and nothing is reported — this is the normal state on a train.
      return { pushed: 0, path: null };
    }

    const batch = this.#pending;
    this.#pending = [];
    this.#firstPendingAt = null;

    try {
      const written = await appendBatch(
        this.#deps.provider(),
        this.#deps.deviceId(),
        batch
      );
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

  /** Read everything other devices have written and merge it in. */
  async pull(): Promise<PullResult> {
    const provider = this.#deps.provider();
    const entries = await readAllEntries(provider);

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

    const result = applyEntries(this.#deps.target, entries, {
      isApplied: (entry) => this.#merged.get(entryIdentity(entry)) === entry.hlc
    });
    for (const entry of result.merged) {
      this.#merged.set(entryIdentity(entry), entry.hlc);
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
    this.#scheduleNextPoll();
  }

  stop(): void {
    this.#running = false;
    if (this.#pollTimer !== null) this.#deps.clearTimer(this.#pollTimer);
    if (this.#flushTimer !== null) this.#deps.clearTimer(this.#flushTimer);
    this.#pollTimer = null;
    this.#flushTimer = null;
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
    this.#inFlight = (async () => {
      try {
        await this.flush();
        if (this.#deps.conditions().online) {
          await this.pull();
          // After the pull, so anything pruned is already merged here.
          await this.compactIfDue();
        }
      } catch (error) {
        this.#deps.onError?.(error);
      } finally {
        this.#inFlight = null;
        this.#scheduleNextPoll();
      }
    })();
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
