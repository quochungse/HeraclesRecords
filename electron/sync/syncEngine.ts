// Turning a pile of oplog entries from several machines into one coherent state.
//
// Two rules do the work:
//
//   1. Last writer wins, per record, ordered by HLC — not by wall clock.
//   2. A delete is a record like any other, and outranks an older set. That is
//      what stops a deletion made on one laptop from being undone by another
//      laptop that still remembers the original row.
//
// Everything the engine writes goes through `SyncTarget`, injected, so the
// merge logic is exercised by tests without a database and the SQLite binding
// is a thin adapter rather than a thing woven through the algorithm.
//
// The engine also re-checks syncPolicy on the way *in*. Entries arrive from
// other machines; a bug or a tampered vault must not be able to write rows into
// `downloads` — a table full of absolute paths belonging to a different
// computer — just because it asked nicely. A vault written by an older build
// carries credential entries, and this is where they are refused.

import { compareHlcStrings } from "./hlc";
import { entryIdentity, type OpEntry } from "./oplog";
import {
  isDeviceEncrypted,
  policyForLocalStorage,
  policyForSetting,
  policyForTable,
  shouldSyncTier,
  type SyncTier
} from "./syncPolicy";

/** Where merged state lands. Implemented over SQLite in the main process, and
 *  over plain maps in the suites. */
export interface SyncTarget {
  upsertRow(table: string, recordId: string, row: Record<string, unknown>): void;
  deleteRow(table: string, recordId: string): void;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
  setLocalStorage(key: string, value: string): void;
  deleteLocalStorage(key: string): void;
}

export interface RejectedEntry {
  readonly entry: OpEntry;
  readonly reason:
    | "unclassified"
    | "not-syncable"
    | "malformed"
    /** Sealed to one machine's keychain. The change feed cannot carry it in any
     *  usable form, so it does not carry it at all — see `isKeychainBound`. */
    | "device-encrypted"
    /** The target would not write it: a row whose columns this schema does not
     *  have, or a record id whose shape does not match the live primary key.
     *  Reported rather than thrown, so one unusable entry costs one entry and
     *  not every entry ordered after it. */
    | "target-refused";
}

/**
 * Whether the feed must ignore this entry because the value is sealed to one
 * machine's keychain.
 *
 * Every such key is `device`, so the tier would refuse it too — this is the
 * second gate, kept for the day a new credential is classified wrongly, and
 * checked first so the rejection names the real reason.
 *
 * The oplog is a stream of raw stored values, and a `safeStorage` ciphertext is
 * only meaningful on the computer that wrote it. Shipping one produced the
 * worst possible outcome: the destination stored bytes it could not open, while
 * every `Boolean(getSetting(...))` check in the app went on reporting the
 * account as connected. A credential that fails to arrive is a prompt to sign
 * in; one that arrives broken is a bug report.
 *
 * `set` and `delete` are both refused, and the symmetry matters. Deletes used
 * to travel while sets were dropped, so clearing an API key on one machine
 * deleted the *working* key on another — a credential the vault never held and
 * could not restore.
 */
function isKeychainBound(entry: Pick<OpEntry, "scope" | "key">): boolean {
  return entry.scope === "setting" && isDeviceEncrypted(entry.key);
}

export interface ApplyOptions {
  /**
   * Whether this target has already been given this exact change.
   *
   * The log is read in full on every poll — `readAllEntries` has no cursor —
   * so without an answer here every merged row and setting is rewritten to
   * SQLite every few seconds and `onApplied` never stops firing. Asked after
   * last-writer-wins rather than before it: filtering the input would let an
   * older entry win once its successor had been seen.
   */
  readonly isApplied?: (entry: OpEntry) => boolean;
}

export interface ApplyResult {
  readonly applied: number;
  readonly deleted: number;
  /** Entries that lost last-writer-wins. Counted, not applied. */
  readonly superseded: number;
  /** Entries refused by policy or by the target. Surfaced rather than
   *  swallowed: a non-empty list means either a version mismatch or something
   *  worth investigating. */
  readonly rejected: readonly RejectedEntry[];
  /** The winners actually written, in the order they were written, so a caller
   *  can remember them and answer `isApplied` next time. */
  readonly merged: readonly OpEntry[];
}

/**
 * An entry before it has a timestamp.
 *
 * Policy is decided from this, never from a finished `OpEntry`, and the
 * distinction is load-bearing rather than tidy: minting a timestamp runs
 * `nextHlc()`, which persists the clock through `database.setSetting` — the
 * very function whose hook is building this entry. Deciding first is what keeps
 * a settings write from re-entering the bridge. See `ChangeBuilder.#push`.
 */
export type ProposedEntry = Omit<OpEntry, "hlc">;

/** The tier an entry's destination sits in, or undefined when nothing has
 *  classified it. */
export function tierForEntry(
  entry: Pick<OpEntry, "scope" | "key">
): SyncTier | undefined {
  switch (entry.scope) {
    case "table": {
      const policy = policyForTable(entry.key);
      // `perKey` names app_settings, whose rows travel as `setting` entries.
      // A `table` entry aimed at it is malformed by definition.
      return policy === "perKey" || policy === undefined ? undefined : policy;
    }
    case "setting":
      return policyForSetting(entry.key);
    case "localStorage":
      return policyForLocalStorage(entry.key);
  }
}

/**
 * Reduce entries to the winner for each record.
 *
 * Deliberately order-independent: the result depends only on the HLCs, never on
 * the sequence entries happened to arrive in. That is the property that makes
 * two machines converge no matter who synced first.
 */
export function resolve(entries: readonly OpEntry[]): Map<string, OpEntry> {
  const winners = new Map<string, OpEntry>();
  for (const entry of entries) {
    const identity = entryIdentity(entry);
    const current = winners.get(identity);
    if (!current || compareHlcStrings(entry.hlc, current.hlc) > 0) {
      winners.set(identity, entry);
    }
  }
  return winners;
}

/**
 * The tables a set of merged entries wrote into or deleted from.
 *
 * `ApplyResult.applied` says how much arrived, never what — which left a
 * renderer with only two moves on a pull, reload everything or reload nothing,
 * and nothing is what shipped. This is the other half of the answer, and it is
 * separate from the merge so it can be checked without one: `scope` is the
 * whole test, because a `setting` or `localStorage` entry's `key` is a key and
 * would name a table that does not exist.
 */
export function tablesTouched(entries: readonly OpEntry[]): string[] {
  const tables = new Set<string>();
  for (const entry of entries) {
    if (entry.scope === "table") tables.add(entry.key);
  }
  return [...tables];
}

/** Merge a batch of entries into `target`. */
export function applyEntries(
  target: SyncTarget,
  entries: readonly OpEntry[],
  options: ApplyOptions = {}
): ApplyResult {
  const rejected: RejectedEntry[] = [];
  const admissible: OpEntry[] = [];

  for (const entry of entries) {
    // Before the tier, so the reason names the specific problem. Both refuse
    // it — every keychain-sealed key is `device` — and a reader who sees
    // `device-encrypted` in a log knows the entry was one machine's ciphertext
    // rather than merely something in the wrong tier.
    if (isKeychainBound(entry)) {
      rejected.push({ entry, reason: "device-encrypted" });
      continue;
    }
    const tier = tierForEntry(entry);
    if (tier === undefined) {
      rejected.push({ entry, reason: "unclassified" });
      continue;
    }
    if (!shouldSyncTier(tier)) {
      // `derived` and `device` never travel, and every credential is `device`.
      rejected.push({ entry, reason: "not-syncable" });
      continue;
    }
    if (entry.scope === "table" && !entry.recordId) {
      rejected.push({ entry, reason: "malformed" });
      continue;
    }
    admissible.push(entry);
  }

  const winners = resolve(admissible);

  let applied = 0;
  let deleted = 0;

  // Apply in causal order so a target that logs or triggers on writes sees a
  // plausible history rather than an arbitrary one.
  const ordered = [...winners.values()].sort((a, b) =>
    compareHlcStrings(a.hlc, b.hlc)
  );

  const merged: OpEntry[] = [];

  for (const entry of ordered) {
    if (options.isApplied?.(entry)) continue;

    // Per entry, not around the loop. `upsertRow` and `deleteRow` throw on a
    // row this schema cannot hold, and letting that out would abandon every
    // entry sorted after it — on this poll and, since nothing is recorded as
    // progress, on every poll after that too.
    try {
      if (entry.op === "delete") {
        switch (entry.scope) {
          case "table":
            target.deleteRow(entry.key, entry.recordId as string);
            break;
          case "setting":
            target.deleteSetting(entry.key);
            break;
          case "localStorage":
            target.deleteLocalStorage(entry.key);
            break;
        }
        deleted += 1;
      } else {
        switch (entry.scope) {
          case "table":
            target.upsertRow(
              entry.key,
              entry.recordId as string,
              entry.payload ?? {}
            );
            break;
          case "setting":
            target.setSetting(entry.key, stringValue(entry.payload));
            break;
          case "localStorage":
            target.setLocalStorage(entry.key, stringValue(entry.payload));
            break;
        }
        applied += 1;
      }
      merged.push(entry);
    } catch {
      rejected.push({ entry, reason: "target-refused" });
    }
  }

  return {
    applied,
    deleted,
    superseded: admissible.length - winners.size,
    rejected,
    merged
  };
}

function stringValue(payload: Record<string, unknown> | undefined): string {
  const value = payload?.value;
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

// --- Building entries from local changes ------------------------------------

export interface ChangeBuilderDeps {
  /** Issues the next causal timestamp for this device. */
  readonly nextHlc: () => string;
}

/**
 * Build outbound entries, dropping anything policy says must not leave.
 *
 * The same check runs on the way out and on the way in. That is not redundant:
 * outbound protects this user's secrets from being uploaded, inbound protects
 * this machine from whatever another one uploaded.
 */
export class ChangeBuilder {
  readonly #deps: ChangeBuilderDeps;
  readonly #entries: OpEntry[] = [];
  readonly #skipped: string[] = [];

  constructor(deps: ChangeBuilderDeps) {
    this.#deps = deps;
  }

  get entries(): readonly OpEntry[] {
    return this.#entries;
  }

  /** Destinations refused by policy, for logging and for tests to assert on. */
  get skipped(): readonly string[] {
    return this.#skipped;
  }

  #allows(entry: ProposedEntry): boolean {
    // A keychain-sealed value is dropped here rather than at the far end, so
    // the vault never holds one machine's ciphertext at all. Checked first for
    // the same reason as on the inbound path.
    if (isKeychainBound(entry)) {
      this.#skipped.push(entryIdentity(entry));
      return false;
    }
    if (!shouldSyncTier(tierForEntry(entry))) {
      this.#skipped.push(entryIdentity(entry));
      return false;
    }
    return true;
  }

  /**
   * Admit an entry, and only then give it a timestamp.
   *
   * The order is the whole point. `nextHlc()` persists the clock with
   * `setSetting`, so calling it from inside a `setSetting` hook queues another
   * change — and `sync.clock` is `device`, which this method is what refuses.
   * Minting first meant the refusal came too late: every settings write in the
   * app recursed until the stack overflowed (1206 nested writes, measured),
   * with the `RangeError` swallowed by the bridge's own catch.
   */
  #push(proposed: ProposedEntry): this {
    if (!this.#allows(proposed)) return this;
    this.#entries.push({ ...proposed, hlc: this.#deps.nextHlc() });
    return this;
  }

  row(table: string, recordId: string, row: Record<string, unknown>): this {
    return this.#push({
      op: "set",
      scope: "table",
      key: table,
      recordId,
      payload: row
    });
  }

  deleteRow(table: string, recordId: string): this {
    return this.#push({
      op: "delete",
      scope: "table",
      key: table,
      recordId
    });
  }

  setting(key: string, value: string): this {
    return this.#push({
      op: "set",
      scope: "setting",
      key,
      payload: { value }
    });
  }

  deleteSetting(key: string): this {
    return this.#push({
      op: "delete",
      scope: "setting",
      key
    });
  }

  /**
   * A renderer preference.
   *
   * Called from `localStorageSync.diffLocalStorage`, never from a hook on a
   * write: localStorage is written from a dozen places in the renderer, so the
   * renderer hands over everything policy allows and the main process works out
   * what moved. That is the whole outbound half — theme, units, accent palette,
   * sport colours, startup view and every `coroslink.selection.v1.*` — and it
   * meets `SqliteSyncTarget.setLocalStorage` / `drainLocalStorage` /
   * `applySyncedLocalStorageOps` coming the other way.
   */
  localStorage(key: string, value: string): this {
    return this.#push({
      op: "set",
      scope: "localStorage",
      key,
      payload: { value }
    });
  }

  deleteLocalStorage(key: string): this {
    return this.#push({
      op: "delete",
      scope: "localStorage",
      key
    });
  }
}
