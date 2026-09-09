import {
  listSleepNights,
  pruneSleepNights,
  upsertSleepNights,
  type SleepNightRow
} from "./database";
import { getTrainingSleepData } from "./sleepDataService";
import type {
  SleepHistorySnapshot,
  SleepHistorySource,
  TrainingHubSleepRecord
} from "./types";

/**
 * The Sleep screen's cache.
 *
 * One `getTrainingSleepData()` is not one request: `sleepDataService` does not
 * know which argument shape the COROS MCP tool accepts, so it calls the tool
 * with roughly twenty of them in sequence and merges whatever comes back. A
 * screen that fetched on every visit would spend that on every visit, for
 * nights that cannot have changed.
 *
 * So the rule here is about *which* nights are still allowed to change:
 *
 *   * A **past night that arrived complete** is finished. The athlete cannot
 *     sleep it again, and COROS will answer with the same numbers forever, so
 *     it is served from the cache and never refetched.
 *   * **Last night** is not finished — the watch may not have synced yet, and
 *     the answer changes from nothing, to partial, to complete over a morning.
 *     It carries a TTL.
 *   * A **partial night**, whatever its date, is a night COROS was still
 *     syncing when we asked. It carries the same TTL, so it can fill in.
 *
 * That leaves the common case — opening the screen twice in a morning — costing
 * one network fill at most, and revisits costing nothing.
 */

/** How long an unfinished night (last night, or any partial) may be served stale. */
export const UNSETTLED_NIGHT_TTL_MS = 30 * 60 * 1000;

/** How far back the cache keeps nights before pruning. */
export const HISTORY_RETENTION_DAYS = 400;

/** The window a plain screen open asks for. */
export const DEFAULT_HISTORY_DAYS = 30;

interface CacheEntry {
  record: TrainingHubSleepRecord;
  fetchedAt: number;
}

interface MemoryCache {
  /** Keyed `<happenDay>:<kind>`, the same identity the table uses. */
  entries: Map<string, CacheEntry>;
  hydrated: boolean;
  /** The last time a network fill actually completed, for the "updated" line. */
  lastNetworkAt?: number;
}

const cache: MemoryCache = {
  entries: new Map(),
  hydrated: false
};

export interface SleepHistoryDeps {
  now: () => number;
  fetchFromCoros: (days: number) => Promise<{
    records: TrainingHubSleepRecord[];
    mcpConnected: boolean;
  }>;
  readCache: (fromDay: string) => SleepNightRow[];
  writeCache: (rows: SleepNightRow[]) => void;
  pruneCache: (beforeDay: string) => void;
}

export function createDefaultSleepHistoryDeps(): SleepHistoryDeps {
  return {
    now: () => Date.now(),
    fetchFromCoros: async (days) => {
      const summary = await getTrainingSleepData(days);
      return { records: summary.records, mcpConnected: summary.mcpConnected };
    },
    readCache: listSleepNights,
    writeCache: upsertSleepNights,
    pruneCache: pruneSleepNights
  };
}

function entryKey(record: Pick<TrainingHubSleepRecord, "happenDay" | "kind">): string {
  return `${record.happenDay}:${record.kind ?? "main"}`;
}

function dayKeyOffset(now: number, days: number): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

/**
 * Whether a cached night may still change. Mirrors the freshness rule the
 * renderer uses (`src/training/sleepFreshness.ts`): COROS stamps a night with
 * the morning it ended, so today's key is last night — the only night still
 * arriving.
 */
function isUnsettled(entry: CacheEntry, now: number): boolean {
  if (entry.record.completeness === "partial") {
    return true;
  }

  return entry.record.happenDay >= dayKeyOffset(now, 0);
}

function isStale(entry: CacheEntry, now: number): boolean {
  return isUnsettled(entry, now) && now - entry.fetchedAt >= UNSETTLED_NIGHT_TTL_MS;
}

function hydrate(deps: SleepHistoryDeps, fromDay: string): void {
  if (cache.hydrated) {
    return;
  }

  for (const row of deps.readCache(fromDay)) {
    try {
      const record = JSON.parse(row.payload) as TrainingHubSleepRecord;
      if (record && typeof record.happenDay === "string") {
        cache.entries.set(entryKey(record), { record, fetchedAt: row.fetched_at });
      }
    } catch {
      // A row we cannot read is a row we refetch. Never fail the screen on it.
    }
  }

  cache.hydrated = true;
}

function store(deps: SleepHistoryDeps, records: TrainingHubSleepRecord[], now: number): void {
  const rows: SleepNightRow[] = [];

  for (const record of records) {
    if (!/^\d{8}$/.test(record.happenDay)) {
      continue;
    }

    cache.entries.set(entryKey(record), { record, fetchedAt: now });
    rows.push({
      happen_day: record.happenDay,
      kind: record.kind ?? "main",
      payload: JSON.stringify(record),
      fetched_at: now
    });
  }

  if (rows.length === 0) {
    return;
  }

  deps.writeCache(rows);
  deps.pruneCache(dayKeyOffset(now, -HISTORY_RETENTION_DAYS));
}

/**
 * The nights inside the window, newest first. Naps are dropped: the detail
 * screen lists nights, and a nap is already folded into its night's
 * `napMinutes` by `sleepDataService`.
 */
function selectWindow(days: number, now: number): {
  records: TrainingHubSleepRecord[];
  fetchedAt?: number;
} {
  const fromDay = dayKeyOffset(now, -(Math.max(1, days) - 1));
  const selected: CacheEntry[] = [];

  for (const entry of cache.entries.values()) {
    if (entry.record.kind === "nap" || entry.record.happenDay < fromDay) {
      continue;
    }
    selected.push(entry);
  }

  selected.sort((left, right) =>
    right.record.happenDay.localeCompare(left.record.happenDay)
  );

  return {
    records: selected.map((entry) => entry.record),
    fetchedAt: selected.reduce<number | undefined>(
      (newest, entry) =>
        newest === undefined || entry.fetchedAt > newest ? entry.fetchedAt : newest,
      undefined
    )
  };
}

/**
 * True when the cache cannot answer for the window on its own: last night is
 * missing, or something in there is stale enough to be worth another ask.
 */
function needsNetwork(days: number, now: number): boolean {
  const today = dayKeyOffset(now, 0);
  const lastNight = cache.entries.get(`${today}:main`);

  if (!lastNight) {
    return true;
  }

  const fromDay = dayKeyOffset(now, -(Math.max(1, days) - 1));

  for (const entry of cache.entries.values()) {
    if (entry.record.happenDay < fromDay) {
      continue;
    }
    if (isStale(entry, now)) {
      return true;
    }
  }

  return false;
}

export interface SleepHistoryRequest {
  days?: number;
  /** Skip every freshness check and ask COROS. The screen's Refresh button. */
  refresh?: boolean;
}

export async function getSleepHistory(
  request: SleepHistoryRequest = {},
  deps: SleepHistoryDeps = createDefaultSleepHistoryDeps()
): Promise<SleepHistorySnapshot> {
  const days = Math.max(1, request.days ?? DEFAULT_HISTORY_DAYS);
  const now = deps.now();
  const retentionFrom = dayKeyOffset(now, -HISTORY_RETENTION_DAYS);

  hydrate(deps, retentionFrom);

  const cachedBefore = cache.entries.size;
  const wantsNetwork = request.refresh === true || needsNetwork(days, now);

  let mcpConnected = true;
  let error: string | undefined;
  let filled = false;

  if (wantsNetwork) {
    try {
      const answer = await deps.fetchFromCoros(days);
      mcpConnected = answer.mcpConnected;
      if (answer.records.length > 0) {
        store(deps, answer.records, now);
        cache.lastNetworkAt = now;
        filled = true;
      }
    } catch (caught) {
      // A failed fill is not a failed screen: the cache is still the truth we
      // have, and saying so beats an empty list.
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const { records, fetchedAt } = selectWindow(days, now);
  const source: SleepHistorySource = !filled
    ? "cache"
    : cachedBefore === 0
      ? "network"
      : "mixed";

  return {
    records,
    latest: records.find((record) => record.happenDay === dayKeyOffset(now, 0)),
    mcpConnected,
    fetchedAt,
    source,
    error
  };
}

/**
 * The Overview panel's answer, served through the same cache so opening the app
 * does not re-spend a fetch on a night already on disk.
 */
export async function getCachedSleepSummary(
  days = 14,
  deps: SleepHistoryDeps = createDefaultSleepHistoryDeps()
): Promise<{
  latest?: TrainingHubSleepRecord;
  records: TrainingHubSleepRecord[];
  mcpConnected: boolean;
}> {
  const snapshot = await getSleepHistory({ days }, deps);
  return {
    latest: snapshot.latest,
    records: snapshot.records,
    mcpConnected: snapshot.mcpConnected
  };
}

/**
 * Drops the in-process cache. Signing out of COROS calls this: the nights on
 * disk belong to the account that fetched them, and an account signing in after
 * another one must not be handed the previous one's sleep out of memory. What
 * is already in `sleep_nights` outlives the sign-out, the same way every other
 * derived COROS table on this machine does.
 */
export function clearSleepHistoryCache(): void {
  cache.entries.clear();
  cache.hydrated = false;
  cache.lastNetworkAt = undefined;
}

/** Exported for the same reason: the freshness rule is the bit worth pinning. */
export const sleepHistoryInternals = {
  dayKeyOffset,
  isUnsettled,
  isStale,
  needsNetwork
};
