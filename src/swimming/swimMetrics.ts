import type {
  ActivityDetailSummary,
  SwimStyleTotals,
  SwimSummary,
  TrainingHubActivity,
  TrainingHubSwimInterval,
  UnitSystem
} from "../../electron/types";
import {
  SWIM_STYLES,
  SWIM_SUMMARY_VERSION,
  secondsPer100m,
  styleDistancePerStroke,
  styleStrokeRate,
  styleSwolf
} from "../../electron/swimDetail";
import { formatSwimPace } from "../../electron/activityReading";
import { metersToSwimDistance, swimDistanceUnit } from "../../electron/unitSystem";
import { startOfRunWeekMs } from "../running/runMetrics";
import { SWIM_TYPES, classifySwimType, isSwimSportType, type SwimType } from "./swimType";
import { formatDecimal, getIntlLocale } from "../i18n/core";

// "The last N weeks" is one definition across the sport screens — calendar
// weeks from a Monday, this one included — owned by the run module.
export { runWindowStartMs as swimWindowStartMs } from "../running/runMetrics";

const MS_PER_DAY = 86_400_000;
const METERS_PER_YARD = 0.9144;

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** COROS sends epoch seconds on the activity list. */
function startedAtMs(activity: TrainingHubActivity): number | undefined {
  const seconds = positive(activity.startTime);
  return seconds === undefined ? undefined : seconds * 1000;
}

/**
 * How long a swim took, as the list states it: COROS's activity time. In the
 * pool a rest at the wall is recorded as an interval of its own, so this time
 * can hold the rests as well as the swimming, and a pace over it is the
 * session's rather than the swimming's. The swim page reads the two apart
 * from the lengths.
 */
export function swimSeconds(activity: Pick<TrainingHubActivity, "duration">): number | undefined {
  return positive(activity.duration);
}

/** `1:38.4` under ten minutes, `12:05` above — how a swimmer writes a time. */
export function formatClock(seconds: number): string {
  if (seconds < 600) {
    const tenths = Math.round(seconds * 10);
    const whole = Math.floor(tenths / 10);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
  }
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = String(rounded % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** `1:52 /100m` (or /100yd) from seconds per 100 m. */
export function formatPer100(secondsPer100: number | undefined, unitSystem: UnitSystem): string {
  return secondsPer100 === undefined ? "—" : formatSwimPace(secondsPer100 * 10, unitSystem);
}

/** A pool's length in its own unit: `25 m`, `50 m`, `33⅓ m`, `25 yd`. */
export function formatPoolLength(poolLength: number, poolUnit: "m" | "yd" = "m"): string {
  const value = poolUnit === "yd" ? poolLength / METERS_PER_YARD : poolLength;
  const whole = Math.round(value);
  if (Math.abs(value - whole) < 0.05) {
    return `${whole} ${poolUnit}`;
  }
  const thirds = Math.round(value * 3);
  if (Math.abs(value * 3 - thirds) < 0.05 && thirds % 3 === 1) {
    return `${Math.floor(value)}⅓ ${poolUnit}`;
  }
  return `${formatDecimal(value, 1)} ${poolUnit}`;
}

/** Metres a stroke, in the swim unit: `1.84 m`. */
export function formatDistancePerStroke(meters: number | undefined, unitSystem: UnitSystem): string {
  return meters === undefined
    ? "—"
    : `${formatDecimal(metersToSwimDistance(meters, unitSystem), 2)} ${swimDistanceUnit(unitSystem)}`;
}

// --------------------------------------------------------------- totals --

export interface SwimTotals {
  count: number;
  /** Metres. */
  distance: number;
  /** Seconds, the list's time. */
  duration: number;
  trainingLoad: number;
}

function emptyTotals(): SwimTotals {
  return { count: 0, distance: 0, duration: 0, trainingLoad: 0 };
}

function addToTotals(totals: SwimTotals, activity: TrainingHubActivity): void {
  totals.count += 1;
  totals.distance += positive(activity.distance) ?? 0;
  totals.duration += swimSeconds(activity) ?? 0;
  totals.trainingLoad += positive(activity.trainingLoad) ?? 0;
}

/** Every swim in the list added up, ignoring dates. */
export function summariseSwims(activities: readonly TrainingHubActivity[]): SwimTotals {
  const totals = emptyTotals();
  for (const activity of activities) {
    if (isSwimSportType(activity.sportType)) {
      addToTotals(totals, activity);
    }
  }
  return totals;
}

// ---------------------------------------------------------------- weeks --

/** What one kind of swim added to a week, one field per thing the chart can measure. */
export interface SwimTypeVolume {
  distance: number;
  duration: number;
  count: number;
}

export interface SwimWeek extends SwimTotals {
  weekStartMs: number;
  label: string;
  /** Metres of the week's single longest swim. */
  longestSwimMeters: number;
  /** Seconds of the week's single longest swim. */
  longestSwimSeconds: number;
  byType: Record<SwimType, SwimTypeVolume>;
}

function emptyTypeVolumes(): Record<SwimType, SwimTypeVolume> {
  const volumes = {} as Record<SwimType, SwimTypeVolume>;
  for (const type of SWIM_TYPES) {
    volumes[type] = { distance: 0, duration: 0, count: 0 };
  }
  return volumes;
}

function weekLabel(weekStartMs: number): string {
  return new Date(weekStartMs).toLocaleDateString(getIntlLocale(), { month: "short", day: "numeric" });
}

/**
 * One bucket per week, oldest first, with no gaps — the same shape as
 * `buildRunWeeks` and `buildHikeWeeks`.
 */
export function buildSwimWeeks(
  activities: readonly TrainingHubActivity[],
  { weeks, nowMs = Date.now() }: { weeks: number; nowMs?: number }
): SwimWeek[] {
  if (weeks <= 0) {
    return [];
  }

  const currentWeekStart = startOfRunWeekMs(nowMs);
  const buckets = new Map<number, SwimWeek>();
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const cursor = new Date(currentWeekStart);
    cursor.setDate(cursor.getDate() - index * 7);
    const weekStartMs = cursor.getTime();
    buckets.set(weekStartMs, {
      weekStartMs,
      label: weekLabel(weekStartMs),
      longestSwimMeters: 0,
      longestSwimSeconds: 0,
      byType: emptyTypeVolumes(),
      ...emptyTotals()
    });
  }

  for (const activity of activities) {
    const type = classifySwimType(activity.sportType);
    const at = startedAtMs(activity);
    if (type === null || at === undefined) {
      continue;
    }
    const bucket = buckets.get(startOfRunWeekMs(at));
    if (!bucket) {
      continue;
    }
    addToTotals(bucket, activity);
    const distance = positive(activity.distance) ?? 0;
    const duration = swimSeconds(activity) ?? 0;
    const volume = bucket.byType[type];
    volume.distance += distance;
    volume.duration += duration;
    volume.count += 1;
    bucket.longestSwimMeters = Math.max(bucket.longestSwimMeters, distance);
    bucket.longestSwimSeconds = Math.max(bucket.longestSwimSeconds, duration);
  }

  return [...buckets.values()].sort((left, right) => left.weekStartMs - right.weekStartMs);
}

/** The kinds of swim actually present in a list, in render order. */
export function swimTypesPresent(activities: readonly TrainingHubActivity[]): SwimType[] {
  const seen = new Set<SwimType>();
  for (const activity of activities) {
    const type = classifySwimType(activity.sportType);
    if (type !== null) {
      seen.add(type);
    }
  }
  return SWIM_TYPES.filter((type) => seen.has(type));
}

/**
 * What a week of swimming is measured in. Swimmers count metres — a week is
 * "eight kilometres", a set "ten hundreds" — so the chart opens on distance, in
 * the swim unit (metres or yards, never kilometres), with time and the number
 * of swims a switch away.
 */
export type SwimVolumeMeasure = "distance" | "time" | "count";

export function measuredSwim(
  volume: { distance: number; duration: number; count: number },
  measure: SwimVolumeMeasure,
  unitSystem: UnitSystem
): number {
  if (measure === "time") return volume.duration / 3600;
  if (measure === "count") return volume.count;
  return metersToSwimDistance(volume.distance, unitSystem);
}

// ------------------------------------------------------------ summaries --

/** A swim's own summary, when it carries the current swim figures. */
export function swimSummaryFor(
  activity: Pick<TrainingHubActivity, "activityId">,
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): SwimSummary | undefined {
  const summary = summaries.get(activity.activityId);
  return summary?.swim && summary.swimVersion === SWIM_SUMMARY_VERSION ? summary.swim : undefined;
}

/** Strokes added up over many swims, in `SWIM_STYLES` order. */
export function combineSwimStyles(summaries: readonly SwimSummary[]): SwimStyleTotals[] {
  const totals = new Map<string, SwimStyleTotals>();
  for (const summary of summaries) {
    for (const entry of summary.byStyle) {
      const current = totals.get(entry.style) ?? {
        style: entry.style,
        meters: 0,
        seconds: 0,
        lengths: 0
      };
      current.meters += entry.meters;
      current.seconds += entry.seconds;
      current.lengths += entry.lengths;
      if (entry.counted) {
        const counted = current.counted ?? { lengths: 0, meters: 0, seconds: 0, strokes: 0 };
        counted.lengths += entry.counted.lengths;
        counted.meters += entry.counted.meters;
        counted.seconds += entry.counted.seconds;
        counted.strokes += entry.counted.strokes;
        current.counted = counted;
      }
      totals.set(entry.style, current);
    }
  }
  return SWIM_STYLES.flatMap((style) => {
    const entry = totals.get(style);
    return entry ? [entry] : [];
  });
}

/** A swim's freestyle, the stroke a trend is read on. */
export function freestyleOf(summary: SwimSummary): SwimStyleTotals | undefined {
  return summary.byStyle.find((entry) => entry.style === "free");
}

/**
 * The fewest metres of counted freestyle a swim needs before its SWOLF or
 * stroke figures stand for the session rather than for a warm-up length.
 */
export const TREND_MIN_FREESTYLE_METERS = 200;

/**
 * What a swim is read by over time, all on freestyle: SWOLF, the distance
 * each stroke carries, the pace and the stroke rate. Speed is distance per
 * stroke times stroke rate, so the last two say how a pace was bought.
 */
export type SwimTechniqueMetric = "swolf" | "dps" | "pace" | "rate";

/** Whether a smaller figure is the better one. */
export function lowerIsBetter(metric: SwimTechniqueMetric): boolean {
  return metric === "swolf" || metric === "pace";
}

/** SWOLF and strokes a length are only comparable in one length of pool. */
export function metricNeedsOnePool(metric: SwimTechniqueMetric): boolean {
  return metric === "swolf";
}

function samePool(left: number | undefined, right: number | undefined): boolean {
  return left !== undefined && right !== undefined && Math.abs(left - right) < 0.1;
}

/** One swim's figure for a technique metric, or nothing when it swam too little freestyle. */
export function techniqueValue(summary: SwimSummary, metric: SwimTechniqueMetric): number | undefined {
  const free = freestyleOf(summary);
  if (!free) {
    return undefined;
  }
  if (metric === "pace") {
    return free.meters >= TREND_MIN_FREESTYLE_METERS ? secondsPer100m(free.seconds, free.meters) : undefined;
  }
  if (!free.counted || free.counted.meters < TREND_MIN_FREESTYLE_METERS) {
    return undefined;
  }
  if (metric === "swolf") return styleSwolf(free);
  if (metric === "dps") return styleDistancePerStroke(free);
  return styleStrokeRate(free);
}

export interface TechniquePoint {
  activityId: string;
  /** Epoch ms. */
  at: number;
  value: number;
  name?: string;
}

/** One point per pool swim that says something, oldest first. */
export function techniquePoints(
  swims: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  metric: SwimTechniqueMetric,
  poolLength?: number
): TechniquePoint[] {
  const points: TechniquePoint[] = [];
  for (const activity of swims) {
    const at = startedAtMs(activity);
    const summary = swimSummaryFor(activity, summaries);
    if (at === undefined || !summary || summary.poolLength === undefined) {
      continue;
    }
    if (metricNeedsOnePool(metric) && poolLength !== undefined && !samePool(summary.poolLength, poolLength)) {
      continue;
    }
    const value = techniqueValue(summary, metric);
    if (value !== undefined) {
      points.push({ activityId: activity.activityId, at, value, ...(activity.name ? { name: activity.name } : {}) });
    }
  }
  return points.sort((left, right) => left.at - right.at);
}

function medianOf(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The median of each point and the ones before it, `window` swims at a time. */
export function rollingMedian(points: readonly TechniquePoint[], window = 5): number[] {
  return points.map((_, index) =>
    medianOf(points.slice(Math.max(0, index - window + 1), index + 1).map((point) => point.value))!
  );
}

export function medianTechnique(points: readonly TechniquePoint[]): number | undefined {
  return medianOf(points.map((point) => point.value));
}

export interface PoolSwum {
  poolLength: number;
  poolUnit: "m" | "yd";
  count: number;
}

/** The pools swum in, the most used first. */
export function poolsSwum(
  swims: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): PoolSwum[] {
  const pools: PoolSwum[] = [];
  for (const activity of swims) {
    const summary = swimSummaryFor(activity, summaries);
    if (summary?.poolLength === undefined) {
      continue;
    }
    const known = pools.find((pool) => samePool(pool.poolLength, summary.poolLength));
    if (known) {
      known.count += 1;
    } else {
      pools.push({ poolLength: summary.poolLength, poolUnit: summary.poolUnit ?? "m", count: 1 });
    }
  }
  return pools.sort((left, right) => right.count - left.count || left.poolLength - right.poolLength);
}

function inWindow(activity: TrainingHubActivity, fromMs: number, toMs: number): boolean {
  const at = startedAtMs(activity);
  return at !== undefined && at >= fromMs && at <= toMs;
}

export interface SwimBest {
  distance: number;
  seconds: number;
  activity: TrainingHubActivity;
}

/** The fastest freestyle effort over a distance in a window of days, and the swim it came from. */
export function bestEffortIn(
  swims: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  distance: number,
  { days, nowMs = Date.now() }: { days: number; nowMs?: number }
): SwimBest | undefined {
  const from = nowMs - days * MS_PER_DAY;
  let best: SwimBest | undefined;
  for (const activity of swims) {
    if (!inWindow(activity, from, nowMs)) {
      continue;
    }
    const effort = swimSummaryFor(activity, summaries)?.best.find((entry) => entry.distance === distance);
    if (effort && (!best || effort.seconds < best.seconds)) {
      best = { distance, seconds: effort.seconds, activity };
    }
  }
  return best;
}

/**
 * Critical Swim Speed: the pace a swimmer can hold for a long time without
 * tiring, the swimmer's threshold — (400 − 200) m over (T400 − T200). Only
 * exact when both were swum flat out; from training swims it reads a little
 * slow, never fast. Nothing when the 400 was no slower a metre than the 200,
 * which means the 200 was not a hard one and the formula has nothing to say.
 */
export function criticalSwimSpeed(t200: number, t400: number): { secondsPer100: number } | undefined {
  if (!(t200 > 0) || !(t400 > 2 * t200)) {
    return undefined;
  }
  const metersPerSecond = 200 / (t400 - t200);
  return { secondsPer100: 100 / metersPerSecond };
}

/** The swims of a window that read a technique metric, its median and the window before's. */
export function techniqueWindow(
  swims: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  metric: SwimTechniqueMetric,
  { days, nowMs = Date.now(), poolLength }: { days: number; nowMs?: number; poolLength?: number }
): { median?: number; previous?: number; count: number } {
  const from = nowMs - days * MS_PER_DAY;
  const before = from - days * MS_PER_DAY;
  const current = techniquePoints(
    swims.filter((activity) => inWindow(activity, from, nowMs)),
    summaries,
    metric,
    poolLength
  );
  const previous = techniquePoints(
    swims.filter((activity) => inWindow(activity, before, from - 1)),
    summaries,
    metric,
    poolLength
  );
  const median = medianTechnique(current);
  const previousMedian = medianTechnique(previous);
  return {
    count: current.length,
    ...(median !== undefined ? { median } : {}),
    ...(previousMedian !== undefined ? { previous: previousMedian } : {})
  };
}

/**
 * Seconds a swim spent swimming: its lengths added up once its summary has
 * been read, the list's time until then — which in the pool can hold the
 * rests at the wall, and would put a 1:50 swimmer at 2:10.
 */
export function swimmingSeconds(
  activity: TrainingHubActivity,
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): number | undefined {
  const summary = swimSummaryFor(activity, summaries);
  return summary && summary.swimSeconds > 0 ? summary.swimSeconds : swimSeconds(activity);
}

/** Seconds per 100 m over the swimming, rests out. */
export function swimmingPace(
  activity: TrainingHubActivity,
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): number | undefined {
  const distance = positive(activity.distance);
  const seconds = swimmingSeconds(activity, summaries);
  return distance === undefined || seconds === undefined ? undefined : secondsPer100m(seconds, distance);
}

/** The same over many swims: their distance over their swimming. */
export function swimmingPaceOf(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): number | undefined {
  let meters = 0;
  let seconds = 0;
  for (const activity of activities) {
    const distance = positive(activity.distance);
    const swum = swimmingSeconds(activity, summaries);
    if (distance !== undefined && swum !== undefined) {
      meters += distance;
      seconds += swum;
    }
  }
  return secondsPer100m(seconds, meters);
}


// ----------------------------------------------------------------- sets --

/** A run of intervals swum alike — the same distance, the same stroke — as a swimmer writes a set. */
export interface SwimSet {
  /** Position of the set's first interval in the list. */
  start: number;
  count: number;
  distance: number;
  style: TrainingHubSwimInterval["style"];
  /** Seconds per 100 m over the set's swimming. */
  pace?: number;
  /** The rest most often taken between its intervals. */
  rest?: number;
}

/** Equal within a metre: a 100 is a 100 whatever the watch rounded it to. */
function sameDistance(left: number, right: number): boolean {
  return Math.abs(left - right) < 1;
}

/**
 * How far an interval's pace may sit from the one before it and still be the
 * same set: a descending set drops two or three seconds a hundred a rep, while
 * an easy warm-up hundred before a hard set is ten per cent and more slower.
 */
const SET_PACE_TOLERANCE = 0.06;

function samePace(left: TrainingHubSwimInterval, right: TrainingHubSwimInterval): boolean {
  const a = secondsPer100m(left.seconds, left.distance);
  const b = secondsPer100m(right.seconds, right.distance);
  return a !== undefined && b !== undefined && Math.abs(a - b) <= a * SET_PACE_TOLERANCE;
}

/**
 * The sets in a swim: two or more intervals in a row of one distance, one
 * stroke and about one pace — `8 × 100 m` — which is how a session is written
 * on the board and how a swimmer remembers it. An interval that stands alone
 * is no set and keeps no header.
 */
export function swimSets(intervals: readonly TrainingHubSwimInterval[]): SwimSet[] {
  const sets: SwimSet[] = [];
  let start = 0;
  while (start < intervals.length) {
    const first = intervals[start]!;
    let end = start + 1;
    while (
      end < intervals.length &&
      sameDistance(intervals[end]!.distance, first.distance) &&
      intervals[end]!.style === first.style &&
      samePace(intervals[end - 1]!, intervals[end]!)
    ) {
      end += 1;
    }
    const count = end - start;
    if (count >= 2) {
      const members = intervals.slice(start, end);
      const seconds = members.reduce((sum, interval) => sum + interval.seconds, 0);
      const meters = members.reduce((sum, interval) => sum + interval.distance, 0);
      // The rests between them, not the one after the last: that one leads
      // into the next set.
      const rests = members.slice(0, -1).flatMap((interval) =>
        interval.restAfter !== undefined ? [Math.round(interval.restAfter)] : []
      );
      const counts = new Map<number, number>();
      for (const rest of rests) {
        counts.set(rest, (counts.get(rest) ?? 0) + 1);
      }
      const rest = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      const pace = secondsPer100m(seconds, meters);
      sets.push({
        start,
        count,
        distance: first.distance,
        style: first.style,
        ...(pace !== undefined ? { pace } : {}),
        ...(rest !== undefined ? { rest } : {})
      });
    }
    start = end;
  }
  return sets;
}
