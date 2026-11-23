import type {
  StressDaySeries,
  StressHeartDay,
  StressLevelMinutes
} from "./types";

/**
 * Parsers for the four COROS MCP tools behind Stress level and Heart rate. All
 * four answer in prose, dated `YYYY-MM-DD` in the athlete's COROS timezone.
 * Shapes captured live on 2026-11-23:
 *
 *   Stress Level — Last 7 days            Average Heart Rate — Last 7 days
 *   ========================              ========================
 *
 *   2026-11-23:                           2026-11-23: 57 bpm (Min: 48, Max: 73)
 *   Average Stress: 17
 *   Relaxed: 7h 20m (97%)                 Resting Heart Rate — Last 7 days
 *   Low: 10m (2%)                         ========================
 *   Medium: 5m (1%)
 *   High: 0m (0%)                         2026-11-23: 55 bpm
 *
 *   Stress Time Series — 2026-11-17 to 2026-11-23
 *   ========================
 *
 *   2026-11-17:
 *     timestamp=1794848690, timezone=28, stress=9, score=1, stressHrv=0, stressHr=0
 *
 * Node-free: the renderer reads the level bands and the day keys from here.
 */

/** How many five-minute slots a day of stress readings has. */
export const STRESS_SLOTS_PER_DAY = 288;

/** A day with no reading yet: every slot `null`. */
export function emptyStressSlots(): Array<number | null> {
  return Array.from({ length: STRESS_SLOTS_PER_DAY }, () => null);
}

// --- Day keys: local calendar days, written `YYYYMMDD` ----------------------

export function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/** A day key's local midnight. */
export function dayDate(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
}

/** The day `days` calendar days after `day` (before it when negative). */
export function shiftDay(day: string, days: number): string {
  const date = dayDate(day);
  date.setDate(date.getDate() + days);
  return dayKeyOf(date);
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    out.push(day);
  }
  return out;
}

export type StressLevelKey = keyof StressLevelMinutes;

/** COROS's four levels, calmest first, each with the highest reading it holds. */
export const STRESS_LEVELS: ReadonlyArray<{ key: StressLevelKey; max: number }> = [
  { key: "relaxed", max: 25 },
  { key: "low", max: 50 },
  { key: "medium", max: 75 },
  { key: "high", max: 100 }
];

/** The level a reading or an average falls in, by COROS's own bands. */
export function stressLevelOf(value: number): StressLevelKey {
  return (STRESS_LEVELS.find((level) => value <= level.max) ?? STRESS_LEVELS[3]).key;
}

/** Measured minutes across the four levels. */
export function measuredMinutes(levels: StressLevelMinutes | undefined): number {
  return levels ? levels.relaxed + levels.low + levels.medium + levels.high : 0;
}

/** COROS counts its offset in quarter-hours: 28 is UTC+7. */
const TIMEZONE_UNIT_MS = 15 * 60 * 1000;

function unwrap(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('"')) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : trimmed;
  } catch {
    return trimmed;
  }
}

function keyOfIso(iso: string): string {
  return iso.replace(/-/g, "");
}

/** A figure COROS reports as 0 or below is one it did not measure. */
function measured(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The response cut into its day blocks, keyed `YYYYMMDD`. A block runs from its
 * `YYYY-MM-DD:` heading to the next one, so a day's lines are never read into
 * the day before it.
 */
function dayBlocks(response: string): Map<string, string> {
  const text = unwrap(response);
  const blocks = new Map<string, string>();
  const heading = /^\s*(\d{4}-\d{2}-\d{2}):[ \t]*(.*)$/gm;
  const starts: Array<{ day: string; at: number; from: number; rest: string }> = [];

  for (const match of text.matchAll(heading)) {
    const at = match.index ?? 0;
    starts.push({ day: keyOfIso(match[1]), at, from: at + match[0].length, rest: match[2] });
  }

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].at : text.length;
    blocks.set(start.day, `${start.rest}\n${text.slice(start.from, end)}`);
  });

  return blocks;
}

/** "7h 20m", "1h", "45m", "0m" → minutes. */
function durationMinutes(value: string): number | undefined {
  const hours = value.match(/(\d+)\s*h/i);
  const minutes = value.match(/(\d+)\s*m(?!s)/i);
  if (!hours && !minutes) {
    return undefined;
  }
  return Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
}

/** `queryStressLevel`: each day's average and the time in each level. */
export function parseStressLevels(response: string): Map<string, Pick<StressHeartDay, "stressAvg" | "levels">> {
  const out = new Map<string, Pick<StressHeartDay, "stressAvg" | "levels">>();

  for (const [day, block] of dayBlocks(response)) {
    const average = block.match(/Average Stress:\s*(-?\d+(?:\.\d+)?)/i);
    const level = (name: string) => {
      const match = block.match(new RegExp(`^\\s*${name}:\\s*([^(\\n]*)`, "im"));
      return match ? durationMinutes(match[1]) : undefined;
    };
    const relaxed = level("Relaxed");
    const low = level("Low");
    const medium = level("Medium");
    const high = level("High");
    const levels: StressLevelMinutes | undefined =
      relaxed !== undefined || low !== undefined || medium !== undefined || high !== undefined
        ? { relaxed: relaxed ?? 0, low: low ?? 0, medium: medium ?? 0, high: high ?? 0 }
        : undefined;
    const stressAvg = average ? measured(Number(average[1])) : undefined;
    const anyMeasured = measuredMinutes(levels) > 0;

    if (stressAvg === undefined && !anyMeasured) {
      continue;
    }

    out.set(day, {
      stressAvg,
      levels: anyMeasured ? levels : undefined
    });
  }

  return out;
}

/** `queryAvgHeartRate`: "57 bpm (Min: 48, Max: 73)" for each day. */
export function parseAverageHeartRates(
  response: string
): Map<string, Pick<StressHeartDay, "avgHr" | "minHr" | "maxHr">> {
  const out = new Map<string, Pick<StressHeartDay, "avgHr" | "minHr" | "maxHr">>();

  for (const [day, block] of dayBlocks(response)) {
    const avg = block.match(/(\d+(?:\.\d+)?)\s*bpm/i);
    const min = block.match(/Min:\s*(\d+(?:\.\d+)?)/i);
    const max = block.match(/Max:\s*(\d+(?:\.\d+)?)/i);
    const record = {
      avgHr: avg ? measured(Number(avg[1])) : undefined,
      minHr: min ? measured(Number(min[1])) : undefined,
      maxHr: max ? measured(Number(max[1])) : undefined
    };

    if (record.avgHr !== undefined || record.minHr !== undefined || record.maxHr !== undefined) {
      out.set(day, record);
    }
  }

  return out;
}

/** `queryRestingHeartRate`: one figure a day. */
export function parseRestingHeartRates(response: string): Map<string, number> {
  const out = new Map<string, number>();

  for (const [day, block] of dayBlocks(response)) {
    const match = block.match(/(\d+(?:\.\d+)?)\s*bpm/i);
    const value = match ? measured(Number(match[1])) : undefined;
    if (value !== undefined) {
      out.set(day, value);
    }
  }

  return out;
}

/**
 * `queryStressTimeSeries`: each day block's readings on its five-minute grid.
 *
 * A reading is placed by the wall clock COROS stamped it with (its own offset
 * folded in), counted from the midnight of the block it sat under — so a day is
 * the day COROS filed it as, even read on a machine in another timezone. A
 * negative reading is COROS saying it could not measure. `stressHrv` and
 * `stressHr` are always 0 (probed over 7 days), so only `stress` is read.
 */
export function parseStressDaySeries(response: string): StressDaySeries[] {
  const out: StressDaySeries[] = [];
  const point = /timestamp=(\d+),\s*timezone=(-?\d+),\s*stress=(-?\d+(?:\.\d+)?)/gi;

  for (const [day, block] of dayBlocks(response)) {
    const midnight = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
    const slots = emptyStressSlots();

    for (const match of block.matchAll(point)) {
      const value = Number(match[3]);
      if (!Number.isFinite(value) || value < 0) {
        continue;
      }
      const localAt = Number(match[1]) * 1000 + Number(match[2]) * TIMEZONE_UNIT_MS;
      const slot = Math.floor((localAt - midnight) / (5 * 60 * 1000));
      if (slot >= 0 && slot < STRESS_SLOTS_PER_DAY) {
        slots[slot] = Math.round(value);
      }
    }

    out.push({ day, slots });
  }

  return out.sort((left, right) => left.day.localeCompare(right.day));
}
