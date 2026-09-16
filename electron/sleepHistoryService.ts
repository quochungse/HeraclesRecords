import {
  listSleepNights,
  pruneSleepNights,
  upsertSleepNights,
  type SleepNightRow
} from "./database";
import { isCorosMcpUsable } from "./corosMcpService";
import { getTrainingDailyHealthData } from "./dailyHealthDataService";
import { getTrainingSleepData } from "./sleepDataService";
import type {
  SleepHistorySnapshot,
  TrainingHubDailyHealthRecord,
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
  /**
   * The night's heart rate, which `querySleepData` does not carry. COROS puts
   * it in the daily-health feed instead — "Sleep HR: Avg 50 bpm | Min 44 | Max
   * 71" — dated by wake-up day, so it folds straight onto the night.
   */
  fetchHeartRate: (days: number) => Promise<TrainingHubDailyHealthRecord[]>;
  readCache: (fromDay: string) => SleepNightRow[];
  writeCache: (rows: SleepNightRow[]) => void;
  pruneCache: (beforeDay: string) => void;
  /** For answers returned without asking COROS. See `isCorosMcpUsable`. */
  mcpUsable: () => boolean;
}

export function createDefaultSleepHistoryDeps(): SleepHistoryDeps {
  return {
    now: () => Date.now(),
    fetchFromCoros: async (days) => {
      const summary = await getTrainingSleepData(days);
      return { records: summary.records, mcpConnected: summary.mcpConnected };
    },
    fetchHeartRate: async (days) => {
      const summary = await getTrainingDailyHealthData(days);
      return summary.records;
    },
    readCache: listSleepNights,
    writeCache: upsertSleepNights,
    pruneCache: pruneSleepNights,
    mcpUsable: isCorosMcpUsable
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

  // A day carrying only naps may be a day whose night the watch has not
  // reported yet, so it gets last night's grace and one day beyond it — a late
  // sync lands after the day has turned. Past that it is taken at its word: a
  // day the athlete only napped, which never changes again.
  if (entry.record.kind === "nap-only") {
    return entry.record.happenDay >= dayKeyOffset(now, -1);
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
 * The heart rate for each night in the window, or nothing.
 *
 * A failure here must not cost the nights themselves: heart rate is one line on
 * a card, the sleep totals are the card.
 */
async function readHeartRate(
  deps: SleepHistoryDeps,
  days: number
): Promise<Map<string, TrainingHubDailyHealthRecord>> {
  try {
    const records = await deps.fetchHeartRate(days);
    return new Map(records.map((record) => [record.happenDay, record]));
  } catch (caught) {
    console.warn("[sleepHistoryService] sleep heart rate unavailable:", caught);
    return new Map();
  }
}

function withHeartRate(
  records: TrainingHubSleepRecord[],
  byDay: Map<string, TrainingHubDailyHealthRecord>
): TrainingHubSleepRecord[] {
  if (byDay.size === 0) {
    return records;
  }

  return records.map((record) => {
    const health = byDay.get(record.happenDay);
    if (!health) {
      return record;
    }

    return {
      ...record,
      avgHr: record.avgHr ?? health.sleepAvgHr,
      minHr: record.minHr ?? health.sleepMinHr,
      maxHr: record.maxHr ?? health.sleepMaxHr
    };
  });
}

function isMainEntry(record: TrainingHubSleepRecord): boolean {
  return record.kind !== "nap" && record.kind !== "nap-only";
}

/**
 * Everything the cache holds for one day, as the single record that day is.
 *
 * A day can be in the table more than once: `sleep_nights` is keyed
 * `<day>:<kind>`, so a day first seen while only its naps had synced keeps its
 * `nap-only` row for good once the main sleep lands under `main`. Folding here
 * is what stops that reading as two nights under one date — and what lets a
 * day whose whole sleep was naps be a day at all.
 *
 * The main sleep wins outright, naps included: COROS puts the day's
 * `Naps Total` on the main block too, so its answer is the current one. Only a
 * `kind: "nap"` row — a nap of the day, not a reading of the day — may fill in
 * what it does not carry.
 */
function foldSleepDay(entries: CacheEntry[]): CacheEntry | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const main = entries.find((entry) => isMainEntry(entry.record));
  const napOnly = entries.find((entry) => entry.record.kind === "nap-only");
  const napParts = entries.filter((entry) => entry.record.kind === "nap");
  const fetchedAt = entries.reduce(
    (newest, entry) => (entry.fetchedAt > newest ? entry.fetchedAt : newest),
    0
  );

  // Naps carried as records of their own — the JSON shapes do this — summed
  // into the day the same way COROS's own "Naps Total" line is.
  const partMinutes = napParts.reduce(
    (total, entry) =>
      entry.record.totalMinutes !== undefined ? total + entry.record.totalMinutes : total,
    0
  );
  const partWindows = napParts
    .map((entry) => ({
      start: entry.record.sleepStart,
      end: entry.record.sleepEnd,
      startDay: entry.record.sleepStartDay,
      endDay: entry.record.sleepEndDay
    }))
    .filter((window) => window.start !== undefined || window.end !== undefined);

  const base = main ?? napOnly;

  if (!base) {
    if (napParts.length === 0) {
      return undefined;
    }

    return {
      fetchedAt,
      record: {
        happenDay: napParts[0].record.happenDay,
        kind: "nap-only",
        completeness: "complete",
        napMinutes: partMinutes > 0 ? partMinutes : undefined,
        napStart: partWindows[0]?.start,
        napEnd: partWindows[0]?.end,
        napWindows: partWindows.length > 0 ? partWindows : undefined
      }
    };
  }

  const record = { ...base.record };

  // Filled in as a whole — a day wearing one row's minutes and another's
  // windows contradicts itself — and **never from the `nap-only` row**. That
  // row is not a component of the day, it is what COROS said before the night
  // synced, which is the very thing this fold exists to stop showing twice.
  // Lending from it put its minutes on top of a main sleep whose own
  // `napMinutes` was absent, so a 7h10 night first seen as 4h38 of "naps"
  // totalled 11h48 on the list, the trend, the greeting and the coach's table.
  if (record.napMinutes === undefined && partMinutes > 0) {
    record.napMinutes = partMinutes;
    record.napWindows = partWindows.length > 0 ? partWindows : undefined;
    record.napStart = partWindows[0]?.start;
    record.napEnd = partWindows[0]?.end;
  }

  return { fetchedAt, record };
}

/**
 * One folded entry per day from `fromDay` on, in no particular order.
 *
 * Everything that reads the cache reads it through here, freshness included:
 * the table is keyed `<day>:<kind>`, so a day can hold rows COROS has since
 * superseded, and those rows are never written again — asking one of them
 * whether it is stale answers "yes" forever. The fold takes the newest
 * `fetchedAt` on the day, which is the only one that describes what we know.
 */
function foldedEntriesFrom(fromDay: string): CacheEntry[] {
  const byDay = new Map<string, CacheEntry[]>();

  for (const entry of cache.entries.values()) {
    if (entry.record.happenDay < fromDay) {
      continue;
    }

    const existing = byDay.get(entry.record.happenDay);
    if (existing) {
      existing.push(entry);
    } else {
      byDay.set(entry.record.happenDay, [entry]);
    }
  }

  return [...byDay.values()]
    .map(foldSleepDay)
    .filter((entry): entry is CacheEntry => entry !== undefined);
}

/**
 * The days inside the window, newest first — one record per day.
 *
 * A bare nap is never a day of its own here: it is folded into the day it
 * belongs to. A day COROS reported nothing but naps for **is** one, because
 * the athlete slept and dropping it loses the day from the list, the trend and
 * every average taken over the window.
 */
function selectWindow(days: number, now: number): {
  records: TrainingHubSleepRecord[];
  fetchedAt?: number;
} {
  const fromDay = dayKeyOffset(now, -(Math.max(1, days) - 1));
  const selected = foldedEntriesFrom(fromDay);

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

/** Everything the cache holds for one day, folded. */
function cachedDay(happenDay: string): CacheEntry | undefined {
  return foldSleepDay(
    [...cache.entries.values()].filter(
      (entry) => entry.record.happenDay === happenDay
    )
  );
}

/**
 * True when the cache cannot answer for the window on its own: last night is
 * missing, or something in there is stale enough to be worth another ask.
 */
function needsNetwork(days: number, now: number): boolean {
  const today = dayKeyOffset(now, 0);
  // Any record for today, not only a main one: a day that has so far synced
  // as naps alone is a day we have an answer for, and asking again on every
  // call because the answer was not a night is what a TTL exists to stop.
  const lastNight = cachedDay(today);

  if (!lastNight) {
    // A night COROS does not have yet is the ordinary state of a morning, and
    // asking again the moment the answer comes back empty turns every caller
    // into a poller. The TTL governs the absence exactly as it governs a
    // partial night: ask again when it might have changed, not before.
    return (
      cache.lastNetworkAt === undefined ||
      now - cache.lastNetworkAt >= UNSETTLED_NIGHT_TTL_MS
    );
  }

  const fromDay = dayKeyOffset(now, -(Math.max(1, days) - 1));

  // Folded, not row by row. A `<day>:nap-only` row COROS has since answered as
  // a main sleep is never written again, so its `fetched_at` stays where it
  // was — and reading it on its own made every call after that "stale", which
  // is one ~20-round-trip COROS fetch per Overview load for the rest of the
  // day. The fold asks the day, whose newest row is the one that answered.
  for (const entry of foldedEntriesFrom(fromDay)) {
    if (isStale(entry, now)) {
      return true;
    }
  }

  return false;
}

/**
 * One night already on disk, or nothing. Never touches the network: a caller
 * after a single night should not spend the whole window's fetch to find a row
 * that is almost always cached, and only the caller knows whether a miss is
 * worth filling.
 *
 * Hydration uses the same retention window `getSleepHistory` does, so calling
 * this first cannot leave the in-process cache holding a narrower slice than
 * the next window request expects.
 */
export function getCachedSleepNight(
  happenDay: string,
  deps: SleepHistoryDeps = createDefaultSleepHistoryDeps()
): TrainingHubSleepRecord | undefined {
  hydrate(deps, dayKeyOffset(deps.now(), -HISTORY_RETENTION_DAYS));
  return cachedDay(happenDay)?.record;
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

  const wantsNetwork = request.refresh === true || needsNetwork(days, now);

  // A cache hit skips the network, and a flat `true` there reported a server
  // that had gone away as fine — for as long as the cache stayed fresh, which
  // is exactly when the screen has old nights on it and none arriving. An
  // attempt below overwrites this: having tried beats having asked.
  let mcpConnected = deps.mcpUsable();
  let error: string | undefined;
  let filled = false;

  if (wantsNetwork) {
    try {
      const answer = await deps.fetchFromCoros(days);
      mcpConnected = answer.mcpConnected;
      // Stamped on every answer COROS gives, including an empty one: the point
      // of the stamp is "we asked", not "we got something".
      cache.lastNetworkAt = now;
      if (answer.records.length > 0) {
        store(deps, withHeartRate(answer.records, await readHeartRate(deps, days)), now);
        filled = true;
      }
    } catch (caught) {
      // A failed fill is not a failed screen: the cache is still the truth we
      // have, and saying so beats an empty list.
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const { records, fetchedAt } = selectWindow(days, now);

  return {
    records,
    latest: records.find((record) => record.happenDay === dayKeyOffset(now, 0)),
    mcpConnected,
    fetchedAt,
    source: filled ? "network" : "cache",
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
