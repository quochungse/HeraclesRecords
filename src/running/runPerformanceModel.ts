import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import {
  BASELINE_DAYS,
  MIN_BASELINE_RUNS,
  PERFORMANCE_SUMMARY_VERSION,
  SCALE_DAYS,
  STEADY_SHARE_MAX,
  STEADY_SHARE_MIN,
  athleteScale,
  median,
  performanceBaseline,
  performanceRun,
  sessionPerformance,
  sportHasRunPerformance,
  type PerformanceBaseline,
  type PerformanceProfile,
  type PerformanceRun
} from "../../electron/runPerformance";
import { buildRunWeeks, paceSecondsPerKm, startOfRunWeekMs } from "./runMetrics";

/*
 * What the Running screen and a run's page read off the stored performance
 * curves: which runs make up the usual, the scale onto COROS's VO2max, each
 * run's figure, and the weeks. Kept out of the components so a test can reach
 * it, as `activityFilters.ts` is kept out of `ActivitiesView`.
 */

const DAY_MS = 86_400_000;

/** The band the usual is read in, as the notes under the charts state it. */
export const STEADY_BAND_PERCENT = {
  low: Math.round(STEADY_SHARE_MIN * 100),
  high: Math.round(STEADY_SHARE_MAX * 100)
} as const;

function startedAtMs(activity: TrainingHubActivity): number | undefined {
  return typeof activity.startTime === "number" && activity.startTime > 0
    ? activity.startTime * 1000
    : undefined;
}

/** Road and track runs that started in the six weeks before `atMs`. */
export function performanceHistory(
  runs: readonly TrainingHubActivity[],
  atMs: number
): TrainingHubActivity[] {
  const from = atMs - BASELINE_DAYS * DAY_MS;
  return runs.filter((activity) => {
    const at = startedAtMs(activity);
    return at !== undefined && at >= from && at < atMs && sportHasRunPerformance(activity.sportType);
  });
}

/**
 * Road and track runs in the year before `nowMs`, which the scale is read over,
 * newest first: a sweep its allowance cuts short has read the recent months.
 */
export function performanceScaleRuns(
  runs: readonly TrainingHubActivity[],
  nowMs: number
): TrainingHubActivity[] {
  const from = nowMs - SCALE_DAYS * DAY_MS;
  return runs
    .filter((activity) => {
      const at = startedAtMs(activity);
      return at !== undefined && at >= from && at <= nowMs && sportHasRunPerformance(activity.sportType);
    })
    .sort((a, b) => (startedAtMs(b) ?? 0) - (startedAtMs(a) ?? 0));
}

/**
 * The runs whose curves a screen needs for its usual: those it shows and the
 * six weeks before the oldest. The scale's year is read on its own
 * (`performanceScaleRuns`).
 */
export function performanceRunsNeeded(
  allRuns: readonly TrainingHubActivity[],
  shown: readonly TrainingHubActivity[]
): TrainingHubActivity[] {
  let oldest = Infinity;
  for (const activity of shown) {
    const at = startedAtMs(activity);
    if (at !== undefined) oldest = Math.min(oldest, at);
  }
  if (!Number.isFinite(oldest)) return [];
  const from = oldest - BASELINE_DAYS * DAY_MS;
  return allRuns.filter((activity) => {
    const at = startedAtMs(activity);
    return at !== undefined && at >= from && sportHasRunPerformance(activity.sportType);
  });
}

function storedRun(
  activity: TrainingHubActivity,
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  profile: PerformanceProfile
): PerformanceRun | undefined {
  const summary = activity.activityId ? summaries.get(activity.activityId) : undefined;
  if (summary?.performanceVersion !== PERFORMANCE_SUMMARY_VERSION) return undefined;
  return performanceRun(summary.performance, profile);
}

/** How many of these runs have a curve yet, for "Reading 12 of 31 runs". */
export function performanceCoverage(
  runs: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): { read: number; total: number } {
  const eligible = runs.filter((activity) => sportHasRunPerformance(activity.sportType));
  const read = eligible.filter((activity) => {
    const summary = activity.activityId ? summaries.get(activity.activityId) : undefined;
    return summary?.performanceVersion === PERFORMANCE_SUMMARY_VERSION;
  }).length;
  return { read, total: eligible.length };
}

export interface PerformanceContext {
  /** The usual, when enough runs are read. */
  baseline?: PerformanceBaseline;
  /** Raw figure → COROS's VO2max scale. */
  scale?: number;
  /** Past runs with a curve. */
  runs: number;
}

function storedRuns(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  profile: PerformanceProfile
): PerformanceRun[] {
  return activities
    .map((activity) => storedRun(activity, summaries, profile))
    .filter((run): run is PerformanceRun => run !== undefined && run.points.length > 0);
}

/**
 * The athlete's scale onto COROS's VO2max, from the year's runs
 * (`performanceScaleRuns`) and their own read of the stored summaries: a
 * screen works it out apart from its usual, so a change of period or a run's
 * page reads it again only when the year itself changes.
 */
export function performanceAthleteScale(
  scaleRuns: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  profile: PerformanceProfile
): number | undefined {
  return athleteScale(storedRuns(scaleRuns, summaries, profile));
}

/**
 * The usual as of a moment, from the runs before it (`history`), on the
 * athlete's scale (`performanceAthleteScale`) — the same on every screen.
 * Until the year is read, or when none of its runs carries COROS's VO2max,
 * the scale is read off these runs and `own`, the run being read: a figure
 * left unscaled read 40 where COROS says 47, for as long as the year's
 * curves took to arrive.
 */
export function performanceContext(
  history: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  profile: PerformanceProfile,
  athleteScaleValue: number | undefined,
  own?: PerformanceRun
): PerformanceContext {
  const runs = storedRuns(history, summaries, profile);
  const baseline = performanceBaseline(runs);
  const scale = athleteScaleValue ?? athleteScale(own ? [...runs, own] : runs);
  return {
    ...(baseline ? { baseline } : {}),
    ...(scale !== undefined ? { scale } : {}),
    runs: runs.length
  };
}

export interface PerformanceSession {
  activity: TrainingHubActivity;
  startedAtMs: number;
  /** On COROS's scale when there is one. */
  value: number;
  /** Percent against the usual; absent without one. */
  change?: number;
  /** Seconds per km over the whole run, from the activity list. */
  pace?: number;
  /** COROS's VO2max as of the run, beside its own figure in the tooltip. */
  coros?: number;
}

/** Each run's figure, read against one context. Runs with no figure are left out. */
export function performanceSessions(
  runs: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  profile: PerformanceProfile,
  context: PerformanceContext
): PerformanceSession[] {
  const sessions: PerformanceSession[] = [];
  for (const activity of runs) {
    const at = startedAtMs(activity);
    const run = storedRun(activity, summaries, profile);
    if (at === undefined || !run) continue;
    const raw = sessionPerformance(run.points, context.baseline?.shape);
    if (raw === undefined) continue;
    const pace = paceSecondsPerKm(activity);
    sessions.push({
      activity,
      startedAtMs: at,
      value: raw * (context.scale ?? 1),
      ...(context.baseline ? { change: (raw / context.baseline.value - 1) * 100 } : {}),
      ...(pace !== undefined ? { pace } : {}),
      ...(run.corosVo2max !== undefined ? { coros: run.corosVo2max } : {})
    });
  }
  return sessions.sort((a, b) => a.startedAtMs - b.startedAtMs);
}

export interface PerformanceWeek {
  weekStartMs: number;
  label: string;
  /** Median of the week's runs, scaled; absent in a week with none. */
  value?: number;
  count: number;
}

/** One row per week of the period, oldest first and with no gaps. */
export function performanceWeeks(
  sessions: readonly PerformanceSession[],
  weeks: number,
  nowMs: number
): PerformanceWeek[] {
  return buildRunWeeks([], { weeks, nowMs }).map((week) => {
    const values = sessions
      .filter((session) => startOfRunWeekMs(session.startedAtMs) === week.weekStartMs)
      .map((session) => session.value);
    return {
      weekStartMs: week.weekStartMs,
      label: week.label,
      ...(values.length > 0 ? { value: median(values) } : {}),
      count: values.length
    };
  });
}

/** Days the trend through the runs looks back over at each run, that run included. */
export const TREND_DAYS = 7;

export interface PerformanceTrendPoint {
  x: number;
  median: number;
}

/**
 * The trend through the runs: at each run, the median of the runs in the seven
 * days up to it, so the line goes from the first run to the last and one hot
 * day moves it only so far. A calendar week's median, drawn at the middle of
 * its week, starts days after the period does and ends days before. `sessions`
 * oldest first, as `performanceSessions` gives them.
 */
export function performanceRollingMedian(
  sessions: readonly Pick<PerformanceSession, "startedAtMs" | "value">[],
  days = TREND_DAYS
): PerformanceTrendPoint[] {
  const span = days * DAY_MS;
  let from = 0;
  return sessions.map((session, index) => {
    while (sessions[from]!.startedAtMs <= session.startedAtMs - span) from += 1;
    return {
      x: session.startedAtMs,
      median: median(sessions.slice(from, index + 1).map((entry) => entry.value))
    };
  });
}

/** Form over the period on screen: the median of its runs. */
export function performanceForm(sessions: readonly PerformanceSession[]): number | undefined {
  return sessions.length > 0 ? median(sessions.map((session) => session.value)) : undefined;
}

/**
 * First and last weeks with a reading must be twenty days apart before their
 * difference is a trend, as the efficiency chart this replaced held.
 */
const MIN_TREND_SPAN_MS = 20 * DAY_MS;

export function performanceTrend(
  weeks: readonly PerformanceWeek[]
): { sinceMs: number; change: number } | undefined {
  const read = weeks.filter((week) => week.value !== undefined);
  const first = read[0];
  const last = read[read.length - 1];
  if (!first || !last || last.weekStartMs - first.weekStartMs < MIN_TREND_SPAN_MS) return undefined;
  return { sinceMs: first.weekStartMs, change: (last.value! / first.value! - 1) * 100 };
}

/**
 * An axis that covers `min`–`max` on round steps (1, 2, 5, 10, …), at most
 * about six ticks. Left to itself the chart labelled a −13 to +27 range
 * +27 / +17 / +7 / −3, figures nobody reads a percentage in.
 */
export function niceScale(
  min: number,
  max: number,
  { includeZero = false, symmetric = false }: { includeZero?: boolean; symmetric?: boolean } = {}
): { domain: [number, number]; ticks: number[] } {
  let low = includeZero ? Math.min(0, min) : min;
  let high = includeZero ? Math.max(0, max) : max;
  if (symmetric) {
    const reach = Math.max(Math.abs(low), Math.abs(high));
    low = -reach;
    high = reach;
  }
  if (!(high > low)) {
    low -= 1;
    high += 1;
  }
  const rough = (high - low) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough)!;
  const from = Math.floor(low / step) * step;
  const to = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = from; tick <= to + step / 2; tick += step) {
    ticks.push(Math.round(tick * 1e6) / 1e6);
  }
  return { domain: [from, to], ticks };
}

/**
 * Where zero falls, 0 at the top to 1 at the bottom, in the box around values
 * spanning `min`–`max`. An SVG gradient's offsets count in the bounding box of
 * the shape it paints, not the plot, so a split at the plot's zero landed above
 * zero on a curve that never reached the axis's ends, painting better minutes
 * as worse. A curve wholly above zero is all above (1), wholly below all below (0).
 */
export function zeroOffsetIn(min: number, max: number): number {
  if (!(max > min)) return max >= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, max / (max - min)));
}

/**
 * Where a line crosses the usual, as offsets (0 left to 1 right) across the box
 * of the line: the usual is a curve of its own in ml/kg/min, so no height splits
 * better from worse there and the colour changes along the axis instead. `diff`
 * is the reading less the usual at `x`; the points are in the axis's order.
 * `startsBelow` says which side the first reading is on, and each offset after
 * it changes sides.
 */
export function usualCrossings(points: readonly { x: number; diff: number }[]): {
  startsBelow: boolean;
  offsets: number[];
} {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return { startsBelow: false, offsets: [] };
  const width = last.x - first.x;
  const offsets: number[] = [];
  let below = first.diff < 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    if (to.diff < 0 === below) continue;
    below = !below;
    if (!(width > 0)) continue;
    const share = from.diff === to.diff ? 0 : from.diff / (from.diff - to.diff);
    const x = from.x + (to.x - from.x) * share;
    offsets.push(Math.min(1, Math.max(0, (x - first.x) / width)));
  }
  return { startsBelow: first.diff < 0, offsets };
}

export { MIN_BASELINE_RUNS };
