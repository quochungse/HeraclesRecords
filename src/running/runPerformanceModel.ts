import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import {
  BASELINE_DAYS,
  MIN_BASELINE_RUNS,
  PERFORMANCE_SUMMARY_VERSION,
  median,
  performanceBaseline,
  performanceRun,
  performanceScale,
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

/** The runs whose curves a screen needs: those it shows and the six weeks before the oldest. */
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

/**
 * The usual as of a moment, from the runs before it. `own` is the run being
 * read, which anchors the scale on its own when there is no history yet.
 */
export function performanceContext(
  history: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  profile: PerformanceProfile,
  own?: PerformanceRun
): PerformanceContext {
  const runs = history
    .map((activity) => storedRun(activity, summaries, profile))
    .filter((run): run is PerformanceRun => run !== undefined && run.points.length > 0);
  const baseline = performanceBaseline(runs);
  const anchors = baseline || !own ? runs : [...runs, own];
  const scale = performanceScale(anchors, baseline?.shape);
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
      ...(pace !== undefined ? { pace } : {})
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

export { MIN_BASELINE_RUNS };
