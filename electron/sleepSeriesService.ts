import { callCorosMcpTool, ensureCorosMcpConnected, getCorosMcpTools, listCorosMcpTools } from "./corosMcpService";
import {
  listSleepNightSeries,
  upsertSleepNightSeries,
  type SleepNightSeriesRow
} from "./database";
import { getSleepHistory } from "./sleepHistoryService";
import {
  clipToSleepWindow,
  parseSleepHrvAssessment,
  parseSleepHrvSeries,
  parseStressSeries,
  sleepWindowBounds
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
      const snapshot = await getSleepHistory({ days: 60 });
      return snapshot.records.find((record) => record.happenDay === happenDay);
    },
    readCache: listSleepNightSeries,
    writeCache: upsertSleepNightSeries
  };
}

function todayKey(now: number): string {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function hydrate(deps: SleepSeriesDeps): void {
  if (hydrated) {
    return;
  }

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
  return happenDay < todayKey(now);
}

/**
 * The days a night's stress samples are filed under. Stress is stamped by
 * calendar day, so a night beginning before midnight lives in two of them.
 */
function stressDaysFor(record: TrainingHubSleepRecord): string[] {
  const start = record.sleepStartDay;
  const end = record.sleepEndDay ?? record.happenDay;
  return start && start !== end ? [start, end] : [end];
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

  hydrate(deps);

  const cached = memory.get(happenDay);
  const cacheUsable =
    cached !== undefined &&
    request.refresh !== true &&
    (isSettled(happenDay, now) || now - cached.fetchedAt < UNSETTLED_SERIES_TTL_MS);

  if (cacheUsable && cached) {
    return { ...cached.series, source: "cache", fetchedAt: cached.fetchedAt };
  }

  const empty: SleepNightSeries = {
    happenDay,
    hrv: [],
    stress: [],
    source: "network",
    mcpConnected: false
  };

  const connected = await deps.ensureConnected();
  if (!connected) {
    return cached ? { ...cached.series, source: "cache", mcpConnected: false } : empty;
  }

  await deps.listTools();

  const record = await deps.findNight(happenDay);
  if (!record) {
    return { ...empty, mcpConnected: true, error: "No sleep record for this night." };
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

  // Only a night that actually produced samples is worth remembering; an empty
  // answer for last night is a night still arriving, not a night with no data.
  if (hrv.length > 0 || stress.length > 0) {
    memory.set(happenDay, { series, fetchedAt: now });
    deps.writeCache({
      happen_day: happenDay,
      payload: JSON.stringify(series),
      fetched_at: now
    });
  }

  return { ...series, fetchedAt: now };
}

/** Signing out of COROS drops these the same way it drops the night totals. */
export function clearSleepSeriesCache(): void {
  memory.clear();
  hydrated = false;
}
