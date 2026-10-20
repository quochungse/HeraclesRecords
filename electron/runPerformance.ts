import type { RunPerformanceCurve, TrainingHubActivitySeriesPoint } from "./types";

/*
 * Run performance: how much speed a run bought for the share of heart-rate
 * reserve it spent, on the VO2max scale (ml/kg/min), so a run is comparable
 * with the athlete's other runs and with other people's.
 *
 *  - The oxygen a speed costs is Daniels & Gilbert's, read off the
 *    grade-adjusted pace so a climb is not counted as running slowly.
 *  - The share of the reserve spent is (HR − resting) ÷ (max − resting), which
 *    Swain & Leutholtz found equal to the share of VO2 reserve.
 *  - Their ratio is an effective VO2max for each stretch of the run.
 *
 * The beats a resting heart already makes buy no speed, which is why this
 * replaced metres per beat: dividing by the whole heart rate made a faster run
 * at the same fitness read as a more efficient one.
 *
 * The raw figure runs well under a VO2max on easy running in the heat — 28
 * against COROS's 47 on the athlete this was built for — so the number shown
 * is scaled onto COROS's own VO2max: the usual run reads as COROS's estimate,
 * and a run reads above or below it by as much as it beat or fell short of
 * the usual. A percentage needs no scale; only the ml/kg/min figure does.
 *
 * The main process keeps the raw curve on the summary row — speed and heart
 * rate per step, with no profile in it — because the figure needs the
 * account's maximum and resting heart rate, which only the renderer holds and
 * which the athlete can change. Everything after the curve is worked out at
 * render time from what is stored.
 *
 * Node-free: the renderer imports this module.
 */

/** Bump when the curve changes shape or meaning; a row from an older version is computed again. */
// 2: pace may vary 7% and heart rate move 8 bpm (were 5% and 4), pace checked from
//    100 s before: on 43 real runs that reads 83% of the running rather than 71%,
//    for 0.2% more noise.
export const PERFORMANCE_SUMMARY_VERSION = 2;

/**
 * Road and track runs. A treadmill's pace is the watch's guess, and on a trail
 * the ground decides the pace as much as the legs do.
 */
const PERFORMANCE_SPORT_TYPES: ReadonlySet<number> = new Set([100, 103]);

export function sportHasRunPerformance(sportType: number | undefined): boolean {
  return sportType !== undefined && PERFORMANCE_SPORT_TYPES.has(sportType);
}

/** One reading every this many seconds of activity time. */
export const PERFORMANCE_STEP_SECONDS = 30;
/**
 * How far heart rate trails the watch's pace. Measured on 44 sharp changes of
 * pace across 14 of the athlete's interval sessions (2026-10-20): the mean
 * delay of the heart-rate response was 43 s speeding up and 39 s slowing down.
 */
export const HR_LAG_SECONDS = 40;
/** Each reading averages 90 seconds of running. */
const HALF_WINDOW_SECONDS = 45;
/** Heart rate is still finding its level: Daniels' ten easy minutes. */
export const PERFORMANCE_WARM_UP_SECONDS = 10 * 60;
/**
 * Pace must hold steady from this long before a reading… — the minute either
 * side, and the 40 s the heart trails by: a reading a minute into a rep has a
 * heart still climbing to it. Free on real runs (83% read either way), and it
 * is what lets the heart-rate check below be loose enough for steady running.
 */
const PACE_CHECK_BEFORE_SECONDS = 60 + HR_LAG_SECONDS;
/** …to this long after… */
const PACE_CHECK_AFTER_SECONDS = 60;
/** …varying by no more than this share of itself. */
const MAX_PACE_VARIATION = 0.07;
/** Heart rate must have settled: compared this far either side of the reading… */
const SETTLE_HALF_SECONDS = 30;
/** …over a few seconds at each end… */
const SETTLE_SPAN_SECONDS = 5;
/** …and moved no more than this between them. */
const MAX_HR_SETTLE_BPM = 8;
/** Share of a window that must carry a reading. */
const MIN_COVERAGE = 0.7;
/** 2:30/km to 15:00/km. Faster is the GPS jumping; slower is walking or standing. */
const FASTEST_PACE_S_PER_KM = 150;
const SLOWEST_PACE_S_PER_KM = 900;
/**
 * Fewer steps a minute than this is walking. Daniels' cost is a runner's, and a
 * walk to cool down at the end of a run read as a collapse in performance.
 */
const MIN_RUNNING_CADENCE = 140;
const MAX_SECONDS = 8 * 3600;

type Prefix = { sum: Float64Array; squares: Float64Array; count: Float64Array };

function prefixOf(values: Float64Array): Prefix {
  const n = values.length;
  const sum = new Float64Array(n + 1);
  const squares = new Float64Array(n + 1);
  const count = new Float64Array(n + 1);
  for (let index = 0; index < n; index += 1) {
    const value = values[index]!;
    const ok = Number.isFinite(value);
    sum[index + 1] = sum[index]! + (ok ? value : 0);
    squares[index + 1] = squares[index]! + (ok ? value * value : 0);
    count[index + 1] = count[index]! + (ok ? 1 : 0);
  }
  return { sum, squares, count };
}

/** Mean, spread and coverage of [from, to) seconds. */
function windowOf(prefix: Prefix, from: number, to: number) {
  const n = prefix.count.length - 1;
  const a = Math.max(0, Math.min(n, from));
  const b = Math.max(0, Math.min(n, to));
  const count = prefix.count[b]! - prefix.count[a]!;
  if (count <= 0) {
    return { count: 0, mean: NaN, sd: NaN };
  }
  const mean = (prefix.sum[b]! - prefix.sum[a]!) / count;
  const variance = Math.max(0, (prefix.squares[b]! - prefix.squares[a]!) / count - mean * mean);
  return { count, mean, sd: Math.sqrt(variance) };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Why a step has no reading, in two kinds the run page tells apart: the data
 * to compare was not there, or it was there and not steady enough to read.
 */
export type PerformanceGapReason =
  | "stopped"
  | "walking"
  | "noHeartRate"
  | "tooEasy"
  | "aboveMax"
  | "end"
  | "warmUp"
  | "paceChanging"
  | "heartRateSettling";

export type PerformanceGapKind = "noData" | "unsteady";

export function performanceGapKind(reason: PerformanceGapReason): PerformanceGapKind {
  return reason === "warmUp" || reason === "paceChanging" || reason === "heartRateSettling"
    ? "unsteady"
    : "noData";
}

export interface PerformanceStep {
  /** Seconds of activity time. */
  t: number;
  /** `[t, metres a minute, bpm]` where the step can be read. */
  reading?: [number, number, number];
  reason?: PerformanceGapReason;
}

/**
 * Every step of the run, read or not. A step is read only where it can be
 * trusted: past the warm-up, with pace steady around it and heart rate
 * settled, so the start of a rep and the recovery after it — where the heart
 * has not caught up with the legs — say nothing rather than something wrong.
 * The run page draws the reasons; the summary keeps the readings alone.
 */
export function runPerformanceSteps(
  series: readonly TrainingHubActivitySeriesPoint[]
): PerformanceStep[] {
  let end = 0;
  for (const point of series) {
    if (typeof point.elapsed === "number" && Number.isFinite(point.elapsed)) {
      end = Math.max(end, point.elapsed);
    }
  }
  const n = Math.min(Math.round(end) + 1, MAX_SECONDS);

  const speed = new Float64Array(n).fill(NaN);
  const walk = new Float64Array(n).fill(NaN);
  const heart = new Float64Array(n).fill(NaN);
  for (const point of series) {
    if (typeof point.elapsed !== "number" || !Number.isFinite(point.elapsed)) continue;
    const index = Math.round(point.elapsed);
    if (index < 0 || index >= n) continue;
    const pace =
      typeof point.adjustedPace === "number" && point.adjustedPace > 0
        ? point.adjustedPace
        : point.pace;
    const walking =
      typeof point.cadence === "number" && point.cadence > 0 && point.cadence < MIN_RUNNING_CADENCE;
    if (walking) {
      walk[index] = 1;
    } else if (
      typeof pace === "number" &&
      pace >= FASTEST_PACE_S_PER_KM &&
      pace <= SLOWEST_PACE_S_PER_KM
    ) {
      speed[index] = 60_000 / pace;
    }
    if (typeof point.hr === "number" && point.hr >= 40 && point.hr <= 230) {
      heart[index] = point.hr;
    }
  }

  const speedPrefix = prefixOf(speed);
  const walkPrefix = prefixOf(walk);
  const heartPrefix = prefixOf(heart);
  const windowSeconds = HALF_WINDOW_SECONDS * 2 + 1;
  const checkSeconds = PACE_CHECK_BEFORE_SECONDS + PACE_CHECK_AFTER_SECONDS + 1;
  const spanSeconds = SETTLE_SPAN_SECONDS * 2 + 1;
  const lastReadable =
    n - 1 - HR_LAG_SECONDS - Math.max(HALF_WINDOW_SECONDS, SETTLE_HALF_SECONDS + SETTLE_SPAN_SECONDS);
  const steps: PerformanceStep[] = [];

  for (let t = 0; t < n; t += PERFORMANCE_STEP_SECONDS) {
    const gap = (reason: PerformanceGapReason) => steps.push({ t, reason });
    if (t < PERFORMANCE_WARM_UP_SECONDS) {
      gap("warmUp");
      continue;
    }
    if (t > lastReadable) {
      gap("end");
      continue;
    }

    const run = windowOf(speedPrefix, t - HALF_WINDOW_SECONDS, t + HALF_WINDOW_SECONDS + 1);
    if (run.count < windowSeconds * MIN_COVERAGE) {
      const walked = windowOf(walkPrefix, t - HALF_WINDOW_SECONDS, t + HALF_WINDOW_SECONDS + 1);
      gap(walked.count >= windowSeconds * (1 - MIN_COVERAGE) ? "walking" : "stopped");
      continue;
    }

    const centre = t + HR_LAG_SECONDS;
    const pulse = windowOf(heartPrefix, centre - HALF_WINDOW_SECONDS, centre + HALF_WINDOW_SECONDS + 1);
    if (pulse.count < windowSeconds * MIN_COVERAGE) {
      gap("noHeartRate");
      continue;
    }

    const check = windowOf(speedPrefix, t - PACE_CHECK_BEFORE_SECONDS, t + PACE_CHECK_AFTER_SECONDS + 1);
    if (check.count < checkSeconds * MIN_COVERAGE) {
      gap("stopped");
      continue;
    }
    if (check.sd / check.mean > MAX_PACE_VARIATION) {
      gap("paceChanging");
      continue;
    }

    const before = windowOf(
      heartPrefix,
      centre - SETTLE_HALF_SECONDS - SETTLE_SPAN_SECONDS,
      centre - SETTLE_HALF_SECONDS + SETTLE_SPAN_SECONDS + 1
    );
    const after = windowOf(
      heartPrefix,
      centre + SETTLE_HALF_SECONDS - SETTLE_SPAN_SECONDS,
      centre + SETTLE_HALF_SECONDS + SETTLE_SPAN_SECONDS + 1
    );
    if (before.count < spanSeconds * MIN_COVERAGE || after.count < spanSeconds * MIN_COVERAGE) {
      gap("noHeartRate");
      continue;
    }
    if (Math.abs(after.mean - before.mean) > MAX_HR_SETTLE_BPM) {
      gap("heartRateSettling");
      continue;
    }

    steps.push({ t, reading: [t, round1(run.mean), round1(pulse.mean)] });
  }
  return steps;
}

/**
 * The curve kept of steps already read — the readings alone. The run page reads
 * the steps itself, for the reasons it draws, and builds its curve from them.
 */
export function performanceCurveFromSteps(
  steps: readonly PerformanceStep[],
  /** COROS's VO2max as of this run (`summary.currentVo2Max`), the scale's anchor. */
  corosVo2max?: number
): RunPerformanceCurve {
  return {
    version: PERFORMANCE_SUMMARY_VERSION,
    step: PERFORMANCE_STEP_SECONDS,
    lag: HR_LAG_SECONDS,
    ...(typeof corosVo2max === "number" && corosVo2max >= 15 && corosVo2max <= 95
      ? { corosVo2max }
      : {}),
    points: steps.flatMap((step) => (step.reading ? [step.reading] : []))
  };
}

/** The run's raw performance curve, from its series on activity time (pauses out): its readings. */
export function runPerformanceCurve(
  series: readonly TrainingHubActivitySeriesPoint[],
  corosVo2max?: number
): RunPerformanceCurve {
  return performanceCurveFromSteps(runPerformanceSteps(series), corosVo2max);
}

// ---------------------------------------------------------------------------
// Reading the curve: render time, on the account's heart-rate figures.
// ---------------------------------------------------------------------------

export interface PerformanceProfile {
  maxHr: number;
  restingHr: number;
}

/** A profile the figure can be read on, or nothing. */
export function performanceProfile(
  maxHr: number | undefined,
  restingHr: number | undefined
): PerformanceProfile | undefined {
  if (
    typeof maxHr !== "number" ||
    typeof restingHr !== "number" ||
    !Number.isFinite(maxHr) ||
    !Number.isFinite(restingHr) ||
    restingHr < 25 ||
    maxHr <= restingHr + 40
  ) {
    return undefined;
  }
  return { maxHr, restingHr };
}

/** Below this share of the reserve the effort is too light to read: a walk, a jog to the start. */
const MIN_RESERVE_SHARE = 0.4;
/**
 * Past this share the heart is above the profile's maximum, which says the
 * maximum is out of date rather than anything about the run.
 */
const MAX_RESERVE_SHARE = 1.02;

function reserveShare(heartRate: number, profile: PerformanceProfile): number {
  return (heartRate - profile.restingHr) / (profile.maxHr - profile.restingHr);
}

/** Daniels & Gilbert: oxygen cost of running at `speed` metres a minute, ml/kg/min. */
export function oxygenCost(speed: number): number {
  return -4.6 + 0.182258 * speed + 0.000104 * speed * speed;
}

/** Effective VO2max of a stretch, or nothing when the effort is too light or past the maximum. */
export function effectiveVo2max(
  speed: number,
  heartRate: number,
  profile: PerformanceProfile
): number | undefined {
  const share = reserveShare(heartRate, profile);
  if (!(share >= MIN_RESERVE_SHARE) || share > MAX_RESERVE_SHARE) {
    return undefined;
  }
  const value = 3.5 + (oxygenCost(speed) - 3.5) / share;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Why a step that was read has no figure on this profile: the heart above its
 * maximum, or the effort too light. Nothing when it has one.
 */
export function readingGapReason(
  speed: number,
  heartRate: number,
  profile: PerformanceProfile
): "tooEasy" | "aboveMax" | undefined {
  if (effectiveVo2max(speed, heartRate, profile) !== undefined) return undefined;
  return reserveShare(heartRate, profile) > MAX_RESERVE_SHARE ? "aboveMax" : "tooEasy";
}

export interface PerformancePoint {
  /** Seconds of activity time. */
  t: number;
  /** Effective VO2max, ml/kg/min. */
  value: number;
  /** Grade-adjusted speed, metres a minute, and heart rate 40 s later. */
  speed: number;
  heartRate: number;
}

export function performancePoints(
  curve: RunPerformanceCurve | undefined,
  profile: PerformanceProfile
): PerformancePoint[] {
  if (!curve || curve.version !== PERFORMANCE_SUMMARY_VERSION) {
    return [];
  }
  const out: PerformancePoint[] = [];
  for (const [t, speed, heartRate] of curve.points) {
    const value = effectiveVo2max(speed, heartRate, profile);
    if (value !== undefined) {
      out.push({ t, value, speed, heartRate });
    }
  }
  return out;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** A run's level: its median over minutes 10–40, where fatigue has not yet set in. */
const LEVEL_FROM_SECONDS = 10 * 60;
const LEVEL_TO_SECONDS = 40 * 60;
/** Five minutes of readings before a level means anything. */
const MIN_LEVEL_POINTS = 10;
/** Runs that must reach a minute before the usual curve is drawn there. */
export const MIN_SHAPE_RUNS = 3;
const SHAPE_SMOOTH_MINUTES = 3;
const FIRST_SHAPE_MINUTE = 10;

/**
 * The athlete's usual curve over a run: at each minute, how far their
 * performance has fallen from the run's own level, as the median over past
 * runs. Flat at 1 until fatigue sets in, then falling.
 */
export interface PerformanceShape {
  /** Index 0 is minute 10. */
  values: number[];
  /** The last minute at least `MIN_SHAPE_RUNS` runs reached; later minutes hold its value. */
  lastMinute: number;
}

function runLevel(points: readonly PerformancePoint[]): number | undefined {
  const early = points
    .filter((point) => point.t >= LEVEL_FROM_SECONDS && point.t <= LEVEL_TO_SECONDS)
    .map((point) => point.value);
  return early.length >= MIN_LEVEL_POINTS ? median(early) : undefined;
}

export function performanceShape(
  runs: readonly (readonly PerformancePoint[])[]
): PerformanceShape | undefined {
  const byMinute: number[][] = [];
  for (const points of runs) {
    const level = runLevel(points);
    if (level === undefined) continue;
    const minutes = new Map<number, number[]>();
    for (const point of points) {
      const minute = Math.floor(point.t / 60);
      if (minute < FIRST_SHAPE_MINUTE) continue;
      const list = minutes.get(minute);
      if (list) list.push(point.value / level);
      else minutes.set(minute, [point.value / level]);
    }
    for (const [minute, values] of minutes) {
      (byMinute[minute - FIRST_SHAPE_MINUTE] ??= []).push(median(values));
    }
  }

  const raw: number[] = [];
  for (let index = 0; index < byMinute.length; index += 1) {
    const values = byMinute[index] ?? [];
    if (values.length < MIN_SHAPE_RUNS) break;
    raw.push(median(values));
  }
  if (raw.length === 0) {
    return undefined;
  }

  const smooth = raw.map((_, index) => {
    const from = Math.max(0, index - SHAPE_SMOOTH_MINUTES);
    const window = raw.slice(from, index + SHAPE_SMOOTH_MINUTES + 1);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
  const fresh = smooth.slice(0, LEVEL_TO_SECONDS / 60 - FIRST_SHAPE_MINUTE + 1);
  const scale = median(fresh);
  return {
    values: smooth.map((value) => value / scale),
    lastMinute: FIRST_SHAPE_MINUTE + smooth.length - 1
  };
}

/** The usual share of a run's level at `t` seconds; 1 without a shape, held past its last minute. */
export function shapeAt(shape: PerformanceShape | undefined, t: number): number {
  if (!shape) return 1;
  const index = Math.floor(t / 60) - FIRST_SHAPE_MINUTE;
  if (index < 0) return 1;
  return shape.values[Math.min(index, shape.values.length - 1)]!;
}

/** Three minutes of readings before a run has a figure. */
const MIN_SESSION_POINTS = 6;

/**
 * A run's figure: its readings brought back to the start of a run along the
 * usual curve, then the median. A long run is not marked down for the fatigue
 * every long run has — only for more than usual. Without a shape, the readings
 * as they are.
 */
export function sessionPerformance(
  points: readonly PerformancePoint[],
  shape: PerformanceShape | undefined
): number | undefined {
  if (points.length < MIN_SESSION_POINTS) return undefined;
  return median(points.map((point) => point.value / shapeAt(shape, point.t)));
}

/** Runs before a run that make up its usual. */
export const BASELINE_DAYS = 42;
/** Runs with a figure before there is a usual to compare with. */
export const MIN_BASELINE_RUNS = 3;
/** Within this share of the usual reads as usual. */
export const PERFORMANCE_BAND = 0.03;

/** One run as the baseline reads it. */
export interface PerformanceRun {
  points: readonly PerformancePoint[];
  corosVo2max?: number;
}

export function performanceRun(
  curve: RunPerformanceCurve | undefined,
  profile: PerformanceProfile
): PerformanceRun {
  const points = performancePoints(curve, profile);
  return curve?.corosVo2max === undefined ? { points } : { points, corosVo2max: curve.corosVo2max };
}

export interface PerformanceBaseline {
  /** The usual raw figure, ml/kg/min before scaling. */
  value: number;
  /** Runs it was read from. */
  runs: number;
  shape?: PerformanceShape;
}

/** The usual from a set of past runs, or nothing when there are too few. */
export function performanceBaseline(
  runs: readonly PerformanceRun[]
): PerformanceBaseline | undefined {
  const shape = performanceShape(runs.map((run) => run.points));
  const sessions = runs
    .map((run) => sessionPerformance(run.points, shape))
    .filter((value): value is number => value !== undefined);
  if (sessions.length < MIN_BASELINE_RUNS) {
    return undefined;
  }
  return { value: median(sessions), runs: sessions.length, ...(shape ? { shape } : {}) };
}

/**
 * What a raw figure is multiplied by to read on COROS's VO2max scale: COROS's
 * median VO2max over these runs, over their median raw figure. Read from the
 * runs that have both. Nothing when none has, and the raw figure stands.
 */
export function performanceScale(
  runs: readonly PerformanceRun[],
  shape: PerformanceShape | undefined
): number | undefined {
  const raw: number[] = [];
  const coros: number[] = [];
  for (const run of runs) {
    const value = sessionPerformance(run.points, shape);
    if (value === undefined || run.corosVo2max === undefined) continue;
    raw.push(value);
    coros.push(run.corosVo2max);
  }
  if (raw.length === 0) return undefined;
  return median(coros) / median(raw);
}

export type PerformanceVerdict = "better" | "usual" | "worse";

export function performanceVerdict(value: number, usual: number): PerformanceVerdict {
  const change = value / usual - 1;
  return change >= PERFORMANCE_BAND ? "better" : change <= -PERFORMANCE_BAND ? "worse" : "usual";
}

/** A run must last this long before its end says anything about durability. */
const DURABILITY_MIN_SECONDS = 60 * 60;
const DURABILITY_TAIL_SECONDS = 20 * 60;

export interface PerformanceDurability {
  /** The last twenty minutes against minutes 10–40, percent. */
  change: number;
  /** The same on the usual curve, percent; absent without one. */
  usual?: number;
  fromMinute: number;
  toMinute: number;
}

export function performanceDurability(
  points: readonly PerformancePoint[],
  shape: PerformanceShape | undefined,
  durationSeconds: number
): PerformanceDurability | undefined {
  if (durationSeconds < DURABILITY_MIN_SECONDS) return undefined;
  const level = runLevel(points);
  const tail = points.filter((point) => point.t >= durationSeconds - DURABILITY_TAIL_SECONDS);
  if (level === undefined || tail.length < MIN_SESSION_POINTS) return undefined;
  const change = (median(tail.map((point) => point.value)) / level - 1) * 100;
  return {
    change,
    ...(shape ? { usual: (median(tail.map((point) => shapeAt(shape, point.t))) - 1) * 100 } : {}),
    fromMinute: Math.round((durationSeconds - DURABILITY_TAIL_SECONDS) / 60),
    toMinute: Math.round(durationSeconds / 60)
  };
}
