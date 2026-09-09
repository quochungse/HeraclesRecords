import { callCorosMcpTool, ensureCorosMcpConnected, getCorosMcpTools, listCorosMcpTools } from "./corosMcpService";
import {
  listSleepNightSeries,
  pruneSleepNightSeries,
  upsertSleepNightSeries,
  type SleepNightSeriesRow
} from "./database";
import { DEFAULT_HISTORY_DAYS, getSleepHistory } from "./sleepHistoryService";
import {
  clipToSleepWindow,
  parseSleepHrvAssessment,
  parseSleepHrvSeries,
  parseStressSeries,
  sleepWindowBounds,
  sleepWindowDays
} from "./sleepSeriesParser";
import type {
  SleepHrvAssessment,
  SleepNightSeries,
  SleepSeriesPoint,
  TrainingHubSleepRecord
} from "./types";

/**
 * The curve across one night.
 *
 * COROS sends no sleep stages, so the hypnogram its phone app draws cannot be
 * reproduced. What it does send, sample by sample, is HRV during sleep
 * (`querySleepHrv`) and stress through the day (`queryStressTimeSeries`) — both
 * capped at a 7-day window, both stamped with COROS's own UTC offset. Clipped
 * to the night's own sleep window, the two are an honest picture of the night's
 * shape without inventing a stage the watch never reported.
 *
 * A night that has been slept never changes, so each one is fetched once and
 * kept. That matters more here than for the totals: COROS drops sleep history
 * after roughly nine weeks, and these samples go with it.
 */

const HRV_TOOL = "querySleepHrv";
const STRESS_TOOL = "queryStressTimeSeries";

/** How long the still-arriving night may be served from cache. */
export const UNSETTLED_SERIES_TTL_MS = 30 * 60 * 1000;

/**
 * How far back the samples are kept. A night holds around two hundred points,
 * so this table grows far faster than the totals do — and `hydrate` reads all
 * of it on the first call, which is the other half of why it needs a bound.
 */
export const SERIES_RETENTION_DAYS = 400;

interface CacheEntry {
  series: SleepNightSeries;
  fetchedAt: number;
}

const memory = new Map<string, CacheEntry>();
let hydrated = false;

export interface SleepSeriesDeps {
  now: () => number;
  ensureConnected: () => Promise<boolean>;
  listTools: () => Promise<void>;
  toolNames: () => string[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  findNight: (happenDay: string) => Promise<TrainingHubSleepRecord | undefined>;
  readCache: () => SleepNightSeriesRow[];
  writeCache: (row: SleepNightSeriesRow) => void;
  pruneCache: (beforeDay: string) => void;
}

export function createDefaultSleepSeriesDeps(): SleepSeriesDeps {
  return {
    now: () => Date.now(),
    ensureConnected: ensureCorosMcpConnected,
    listTools: async () => {
      try {
        await listCorosMcpTools();
      } catch {
        // Fall back to the cached tool list, as the sleep service does.
      }
    },
    toolNames: () => getCorosMcpTools().map((tool) => tool.name),
    callTool: callCorosMcpTool,
    findNight: async (happenDay) => {
      // The same window the screen lists, so a night it can select is a night
      // this can find, and no wider — the lookup pays for the window it asks.
      const snapshot = await getSleepHistory({ days: DEFAULT_HISTORY_DAYS });
      return snapshot.records.find((record) => record.happenDay === happenDay);
    },
    readCache: listSleepNightSeries,
    writeCache: upsertSleepNightSeries,
    pruneCache: pruneSleepNightSeries
  };
}

function dayKeyOffset(now: number, days: number): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function hydrate(deps: SleepSeriesDeps, now: number): void {
  if (hydrated) {
    return;
  }

  // Pruned before reading rather than after writing: the first read of a table
  // left behind by an older install would otherwise pull every night it holds
  // into memory before anything trimmed it.
  deps.pruneCache(dayKeyOffset(now, -SERIES_RETENTION_DAYS));

  for (const row of deps.readCache()) {
    try {
      const series = JSON.parse(row.payload) as SleepNightSeries;
      if (series && typeof series.happenDay === "string") {
        memory.set(series.happenDay, { series, fetchedAt: row.fetched_at });
      }
    } catch {
      // Unreadable row: refetch rather than fail the screen.
    }
  }

  hydrated = true;
}

function isSettled(happenDay: string, now: number): boolean {
  return happenDay < dayKeyOffset(now, 0);
}

/**
 * The days a night's stress samples are filed under. Stress is stamped by
 * calendar day, so a night beginning before midnight lives in two of them —
 * and which two is decided by `sleepWindowDays`, the same function the clipping
 * bounds come from.
 */
function stressDaysFor(record: TrainingHubSleepRecord): string[] {
  const days = sleepWindowDays(record) ?? {
    startDay: record.happenDay,
    endDay: record.happenDay
  };

  return days.startDay !== days.endDay
    ? [days.startDay, days.endDay]
    : [days.endDay];
}

async function fetchSeries(
  deps: SleepSeriesDeps,
  record: TrainingHubSleepRecord
): Promise<{
  hrv: SleepSeriesPoint[];
  stress: SleepSeriesPoint[];
  assessment?: SleepHrvAssessment;
  error?: string;
}> {
  const names = deps.toolNames();
  let hrv: SleepSeriesPoint[] = [];
  let stress: SleepSeriesPoint[] = [];
  let assessment: SleepHrvAssessment | undefined;
  const failures: string[] = [];

  if (names.includes(HRV_TOOL)) {
    try {
      // HRV is filed by wake-up day, which is the night's own key.
      const response = await deps.callTool(HRV_TOOL, {
        startDate: record.happenDay,
        endDate: record.happenDay,
        days: 1
      });
      hrv = parseSleepHrvSeries(response);
      assessment = parseSleepHrvAssessment(response, record.happenDay);
    } catch (caught) {
      failures.push(`sleep HRV: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  if (names.includes(STRESS_TOOL)) {
    const days = stressDaysFor(record);
    try {
      const response = await deps.callTool(STRESS_TOOL, {
        startDate: days[0],
        endDate: days[days.length - 1],
        days: days.length
      });
      stress = parseStressSeries(response);
    } catch (caught) {
      failures.push(`stress: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  return {
    hrv,
    stress,
    assessment,
    error: failures.length > 0 ? failures.join("; ") : undefined
  };
}

export interface SleepSeriesRequest {
  happenDay: string;
  refresh?: boolean;
}

export async function getSleepNightSeries(
  request: SleepSeriesRequest,
  deps: SleepSeriesDeps = createDefaultSleepSeriesDeps()
): Promise<SleepNightSeries> {
  const { happenDay } = request;
  const now = deps.now();

  hydrate(deps, now);

  const cached = memory.get(happenDay);
  const cacheUsable =
    cached !== undefined &&
    request.refresh !== true &&
    (isSettled(happenDay, now) || now - cached.fetchedAt < UNSETTLED_SERIES_TTL_MS);

  if (cached && cacheUsable) {
    return { ...cached.series, source: "cache", fetchedAt: cached.fetchedAt };
  }

  const connected = await deps.ensureConnected();
  if (!connected) {
    return cached
      ? {
          ...cached.series,
          source: "cache",
          fetchedAt: cached.fetchedAt,
          mcpConnected: false
        }
      : { happenDay, hrv: [], stress: [], source: "cache", mcpConnected: false };
  }

  await deps.listTools();

  const record = await deps.findNight(happenDay);
  if (!record) {
    return {
      happenDay,
      hrv: [],
      stress: [],
      source: "network",
      mcpConnected: true,
      error: "No sleep record for this night."
    };
  }

  const bounds = sleepWindowBounds(record);
  const fetched = await fetchSeries(deps, record);

  // Without a window there is nothing to clip to, and an unclipped day of
  // stress readings drawn under a "night" heading would be a lie of framing.
  const hrv = bounds ? clipToSleepWindow(fetched.hrv, bounds) : [];
  const stress = bounds ? clipToSleepWindow(fetched.stress, bounds) : [];

  const series: SleepNightSeries = {
    happenDay,
    hrv,
    stress,
    assessment: fetched.assessment,
    windowStart: bounds?.startLocal,
    windowEnd: bounds?.endLocal,
    source: "network",
    mcpConnected: true,
    error:
      fetched.error ??
      (bounds ? undefined : "This night has no sleep window, so nothing can be placed on a clock.")
  };

  // An empty answer is worth remembering too, as long as the night is over.
  //
  // COROS only keeps these samples for about a week, so most nights in the list
  // legitimately have none — and not caching that emptiness meant every click
  // on an old night spent two MCP calls to be told nothing again. Last night is
  // the exception: empty there means "not synced yet", which the TTL should
  // keep asking about.
  const worthKeeping =
    hrv.length > 0 || stress.length > 0 || isSettled(happenDay, now);

  if (worthKeeping) {
    memory.set(happenDay, { series, fetchedAt: now });
    deps.writeCache({
      happen_day: happenDay,
      payload: JSON.stringify(series),
      fetched_at: now
    });
    deps.pruneCache(dayKeyOffset(now, -SERIES_RETENTION_DAYS));
  }

  return { ...series, fetchedAt: now };
}

/** Signing out of COROS drops these the same way it drops the night totals. */
export function clearSleepSeriesCache(): void {
  memory.clear();
  hydrated = false;
}
