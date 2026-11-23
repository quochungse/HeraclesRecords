import {
  callCorosMcpTool,
  corosMcpAvailability,
  corosMcpFailureState,
  corosMcpToolsHaving,
  ensureCorosMcpConnected,
  getCorosMcpTools
} from "./corosMcpService";
import {
  listStressDaySeries,
  listStressHeartDays,
  pruneStressDaySeries,
  upsertStressDaySeries,
  upsertStressHeartDays,
  type StressDayRow
} from "./database";
import {
  dayDate,
  dayKeyOf,
  daysBetween,
  emptyStressSlots,
  parseAverageHeartRates,
  parseRestingHeartRates,
  parseStressDaySeries,
  parseStressLevels,
  shiftDay
} from "./stressHeartParser";
import type {
  McpAvailability,
  StressDaySeries,
  StressHeartDay,
  StressHeartSnapshot,
  StressSeriesSnapshot
} from "./types";

/**
 * The Stress level and Heart rate screens' data, from the COROS MCP server.
 *
 * Two kinds of answer, each cached by day the way the Sleep screen's nights
 * are (`sleepHistoryService.ts`):
 *
 *   * **The days** — average stress and the time in each level, the day's
 *     average, lowest and highest heart rate, and resting heart rate. Three
 *     tools, one request each, all of history in the first one (COROS answers
 *     365 days; the account's first day, 2026-07-08, was still there on
 *     2026-11-23). After that only the days that may still change are asked
 *     for.
 *   * **The series** — a stress reading every five minutes, at most 7 days a
 *     request. Asked for only for the days a screen shows.
 *
 * **A day may change until it is two days old.** Today is still being lived,
 * and yesterday's last hours reach COROS only when the watch next syncs — so a
 * day is settled once it has been read at least a whole day after it ended.
 * Until then a read is good for `UNSETTLED_TTL_MS`.
 */

const STRESS_LEVEL_TOOL = "queryStressLevel";
const AVG_HR_TOOL = "queryAvgHeartRate";
const RESTING_HR_TOOL = "queryRestingHeartRate";
const SERIES_TOOL = "queryStressTimeSeries";
const DAY_TOOLS = [STRESS_LEVEL_TOOL, AVG_HR_TOOL, RESTING_HR_TOOL];

/** How long a read of a day that may still change is served from cache. */
export const UNSETTLED_TTL_MS = 10 * 60 * 1000;

/** How far back the first fill asks. */
export const FIRST_FILL_DAYS = 365;

/** COROS's cap on one `queryStressTimeSeries` request. */
export const SERIES_REQUEST_DAYS = 7;

/** The most days one series request from the screen may cover. */
export const MAX_SERIES_SPAN_DAYS = 42;

/** How far back the series are kept. */
export const SERIES_RETENTION_DAYS = 400;

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

const dayCache = new Map<string, Entry<StressHeartDay>>();
const seriesCache = new Map<string, Entry<StressDaySeries>>();
let daysHydrated = false;
let seriesHydrated = false;

export interface StressHeartDeps {
  now: () => number;
  ensureConnected: () => Promise<boolean>;
  /** Reads the tool list only when one of these tools is missing from it. */
  listTools: (names: string[]) => Promise<void>;
  toolNames: () => string[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  readDays: () => StressDayRow[];
  writeDays: (rows: StressDayRow[]) => void;
  readSeries: () => StressDayRow[];
  writeSeries: (rows: StressDayRow[]) => void;
  pruneSeries: (beforeDay: string) => void;
  /** How the server stands, for an answer from cache. */
  mcpState: () => McpAvailability;
  /** Why an attempt failed — having tried beats having asked. */
  failureState: () => Exclude<McpAvailability, "ready">;
}

export function createDefaultStressHeartDeps(): StressHeartDeps {
  return {
    now: () => Date.now(),
    ensureConnected: ensureCorosMcpConnected,
    listTools: async (names) => {
      await corosMcpToolsHaving((tools) => names.every((name) => tools.some((tool) => tool.name === name)));
    },
    toolNames: () => getCorosMcpTools().map((tool) => tool.name),
    callTool: callCorosMcpTool,
    readDays: listStressHeartDays,
    writeDays: upsertStressHeartDays,
    readSeries: listStressDaySeries,
    writeSeries: upsertStressDaySeries,
    pruneSeries: pruneStressDaySeries,
    mcpState: corosMcpAvailability,
    failureState: corosMcpFailureState
  };
}

// --- Days on the calendar -------------------------------------------------

function todayKey(now: number): string {
  return dayKeyOf(new Date(now));
}

function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{8}$/.test(value);
}

/** Read a whole day after it ended: local midnight two days on. */
function isSettled(day: string, fetchedAt: number): boolean {
  return fetchedAt >= dayDate(shiftDay(day, 2)).getTime();
}

function isFresh(day: string, fetchedAt: number, now: number): boolean {
  return isSettled(day, fetchedAt) || now - fetchedAt < UNSETTLED_TTL_MS;
}

/**
 * One fill at a time. The screen asks for a day's series and for the weeks
 * around it at once; run side by side, both would ask COROS for today.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

// --- The days -------------------------------------------------------------

function hydrateDays(deps: StressHeartDeps): void {
  if (daysHydrated) {
    return;
  }
  for (const row of deps.readDays()) {
    try {
      const value = JSON.parse(row.payload) as StressHeartDay;
      if (value && isDayKey(value.day)) {
        dayCache.set(value.day, { value, fetchedAt: row.fetched_at });
      }
    } catch {
      // Unreadable row: fetched again with the next fill.
    }
  }
  daysHydrated = true;
}

function hasFigures(day: StressHeartDay): boolean {
  return (
    day.stressAvg !== undefined ||
    day.levels !== undefined ||
    day.avgHr !== undefined ||
    day.minHr !== undefined ||
    day.maxHr !== undefined ||
    day.restingHr !== undefined
  );
}

function daysSnapshot(
  mcpState: McpAvailability,
  source: StressHeartSnapshot["source"],
  error?: string
): StressHeartSnapshot {
  const entries = [...dayCache.values()].sort((left, right) => left.value.day.localeCompare(right.value.day));
  // A day before the first one COROS had anything for is not a day of history.
  const first = entries.findIndex((entry) => hasFigures(entry.value));
  const kept = first < 0 ? [] : entries.slice(first);
  const fetchedAt = kept.reduce<number | undefined>(
    (latest, entry) => (latest === undefined || entry.fetchedAt > latest ? entry.fetchedAt : latest),
    undefined
  );

  return { days: kept.map((entry) => entry.value), mcpState, fetchedAt, source, error };
}

/** The first day a fill has to ask for, or nothing when the cache will do. */
function daysToFill(now: number, refresh: boolean): string | undefined {
  const today = todayKey(now);
  if (dayCache.size === 0) {
    return shiftDay(today, -(FIRST_FILL_DAYS - 1));
  }

  const known = [...dayCache.keys()].sort();
  const unsettled = known.find((day) => !isSettled(day, dayCache.get(day)!.fetchedAt));
  const afterNewest = shiftDay(known[known.length - 1], 1);
  const from = unsettled !== undefined && unsettled < afterNewest ? unsettled : afterNewest;
  const start = from > today ? today : from;

  const due = daysBetween(start, today).some((day) => {
    const entry = dayCache.get(day);
    return !entry || refresh || !isFresh(day, entry.fetchedAt, now);
  });
  if (!due) {
    return undefined;
  }

  const earliest = shiftDay(today, -(FIRST_FILL_DAYS - 1));
  return start < earliest ? earliest : start;
}

export interface StressHeartDaysRequest {
  /** Ask COROS for every day that may still change, however recent the last read. */
  refresh?: boolean;
}

export function getStressHeartDays(
  request: StressHeartDaysRequest = {},
  deps: StressHeartDeps = createDefaultStressHeartDeps()
): Promise<StressHeartSnapshot> {
  return serial(async () => {
    hydrateDays(deps);
    const now = deps.now();
    const from = daysToFill(now, request.refresh === true);

    if (from === undefined) {
      return daysSnapshot(deps.mcpState(), "cache");
    }

    if (!(await deps.ensureConnected())) {
      return daysSnapshot(deps.failureState(), "cache");
    }

    await deps.listTools(DAY_TOOLS);
    const names = deps.toolNames();
    const today = todayKey(now);
    const span = daysBetween(from, today);
    const failures: string[] = [];

    async function ask<T>(tool: string, parse: (response: string) => Map<string, T>): Promise<Map<string, T> | undefined> {
      if (!names.includes(tool)) {
        failures.push(`${tool}: not offered by the COROS MCP server`);
        return undefined;
      }
      try {
        return parse(await deps.callTool(tool, { days: span.length }));
      } catch (caught) {
        failures.push(`${tool}: ${message(caught)}`);
        return undefined;
      }
    }

    const levels = await ask(STRESS_LEVEL_TOOL, parseStressLevels);
    const heart = await ask(AVG_HR_TOOL, parseAverageHeartRates);
    const resting = await ask(RESTING_HR_TOOL, parseRestingHeartRates);

    if (!levels && !heart && !resting) {
      return daysSnapshot("ready", "cache", failures.join("; "));
    }

    // Empty days are written too, so a day without a reading is not asked for
    // again — but only from the first day COROS had anything for.
    const firstKnown = [...dayCache.values()]
      .filter((entry) => hasFigures(entry.value))
      .map((entry) => entry.value.day)
      .concat([...(levels?.keys() ?? []), ...(heart?.keys() ?? []), ...(resting?.keys() ?? [])])
      .sort()[0];
    const rows: StressDayRow[] = [];

    for (const day of span) {
      const previous = dayCache.get(day)?.value;
      // A tool that failed keeps what was known; one that answered is the truth.
      const stress = levels ? levels.get(day) : previous;
      const rates = heart ? heart.get(day) : previous;
      const next: StressHeartDay = {
        day,
        stressAvg: stress?.stressAvg,
        levels: stress?.levels,
        avgHr: rates?.avgHr,
        minHr: rates?.minHr,
        maxHr: rates?.maxHr,
        restingHr: resting ? resting.get(day) : previous?.restingHr
      };

      if (!hasFigures(next) && (firstKnown === undefined || day < firstKnown)) {
        continue;
      }

      dayCache.set(day, { value: next, fetchedAt: now });
      rows.push({ day, payload: JSON.stringify(next), fetched_at: now });
    }

    deps.writeDays(rows);
    return daysSnapshot("ready", "network", failures.length > 0 ? failures.join("; ") : undefined);
  });
}

// --- The series -----------------------------------------------------------

function hydrateSeries(deps: StressHeartDeps, now: number): void {
  if (seriesHydrated) {
    return;
  }
  // Pruned before reading, so an old table is not pulled whole into memory.
  deps.pruneSeries(shiftDay(todayKey(now), -SERIES_RETENTION_DAYS));
  for (const row of deps.readSeries()) {
    try {
      const value = JSON.parse(row.payload) as StressDaySeries;
      if (value && isDayKey(value.day) && Array.isArray(value.slots)) {
        seriesCache.set(value.day, { value, fetchedAt: row.fetched_at });
      }
    } catch {
      // Unreadable row: fetched again when asked for.
    }
  }
  seriesHydrated = true;
}

/** Consecutive days, cut into requests COROS will take. */
function seriesRequests(days: string[]): string[][] {
  const out: string[][] = [];
  for (const day of days) {
    const last = out[out.length - 1];
    if (last && last.length < SERIES_REQUEST_DAYS && shiftDay(last[last.length - 1], 1) === day) {
      last.push(day);
    } else {
      out.push([day]);
    }
  }
  return out;
}

export interface StressSeriesRequest {
  fromDay: string;
  toDay: string;
  refresh?: boolean;
}

export function getStressSeries(
  request: StressSeriesRequest,
  deps: StressHeartDeps = createDefaultStressHeartDeps()
): Promise<StressSeriesSnapshot> {
  return serial(async () => {
    const now = deps.now();
    hydrateSeries(deps, now);

    const today = todayKey(now);
    if (!isDayKey(request.fromDay) || !isDayKey(request.toDay)) {
      return { days: [], mcpState: deps.mcpState(), error: "Days are written YYYYMMDD." };
    }
    const to = request.toDay > today ? today : request.toDay;
    const floor = shiftDay(to, -(MAX_SERIES_SPAN_DAYS - 1));
    const from = request.fromDay < floor ? floor : request.fromDay;
    const wanted = from <= to ? daysBetween(from, to) : [];

    const answer = (mcpState: McpAvailability, error?: string): StressSeriesSnapshot => ({
      days: wanted.flatMap((day) => {
        const entry = seriesCache.get(day);
        return entry ? [entry.value] : [];
      }),
      mcpState,
      error
    });

    const due = wanted.filter((day) => {
      const entry = seriesCache.get(day);
      return !entry || (!isSettled(day, entry.fetchedAt) && (request.refresh === true || now - entry.fetchedAt >= UNSETTLED_TTL_MS));
    });
    if (due.length === 0) {
      return answer(deps.mcpState());
    }

    if (!(await deps.ensureConnected())) {
      return answer(deps.failureState());
    }

    await deps.listTools([SERIES_TOOL]);
    if (!deps.toolNames().includes(SERIES_TOOL)) {
      return answer("ready", `${SERIES_TOOL}: not offered by the COROS MCP server`);
    }

    const failures: string[] = [];
    const rows: StressDayRow[] = [];

    for (const days of seriesRequests(due)) {
      try {
        const response = await deps.callTool(SERIES_TOOL, {
          startDate: days[0],
          endDate: days[days.length - 1]
        });
        const parsed = new Map(parseStressDaySeries(response).map((series) => [series.day, series]));
        for (const day of days) {
          // A day COROS sent no block for had no reading: kept as that, so it
          // is not asked for again once it has settled.
          const value: StressDaySeries = parsed.get(day) ?? { day, slots: emptyStressSlots() };
          seriesCache.set(day, { value, fetchedAt: now });
          rows.push({ day, payload: JSON.stringify(value), fetched_at: now });
        }
      } catch (caught) {
        failures.push(message(caught));
      }
    }

    deps.writeSeries(rows);
    return answer("ready", failures.length > 0 ? failures.join("; ") : undefined);
  });
}

/** Signing out of COROS: the cached days belong to the account that left. */
export function clearStressHeartCache(): void {
  dayCache.clear();
  seriesCache.clear();
  daysHydrated = false;
  seriesHydrated = false;
}
