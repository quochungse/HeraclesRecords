import type {
  SessionIntensity,
  SessionRep,
  TrainingHubActivityDetail,
  TrainingHubActivityLap,
  TrainingHubActivityPause,
  TrainingHubActivitySeriesPoint,
  TrainingHubActivityZoneBucket
} from "./types";

/*
 * What a run's or a ride's training label is read from, worked out once from
 * the detail and kept on the summary row, so a list labels a session without
 * its samples and the page it opens reads the same figures. The label itself
 * is decided in the renderer (`src/training/trainingBenefit.ts`), on the
 * account's heart-rate model, which the main process does not hold.
 *
 * Two readings, after the standards the label follows:
 *  - every second after the warm-up, by heart-rate zone and — where a pace
 *    zone applies — by pace zone together, so a second can be counted at the
 *    lower of the two (Seiler's three zones agree on internal and external
 *    load; a hot easy run's heart rate alone reads as tempo);
 *  - the work bouts of a repeat session, which decide its label whatever the
 *    session's time in zone says (Seiler & Kjerland's session-goal method).
 *
 * Node-free: the renderer computes the same thing from the detail it holds.
 */

/** Bump when the figures below change shape or meaning; a row from an older version is computed again. */
export const INTENSITY_SUMMARY_VERSION = 1;

/**
 * The sessions a label means something on: runs (road, treadmill, trail,
 * track) and rides (road, indoor, gravel, mountain). An e-bike's heart rate is
 * the motor's, a hike's climb would read as threshold work, and lifting, swims
 * and the rest have no tempo to name.
 */
const LABELLED_SPORT_TYPES: ReadonlySet<number> = new Set([
  100, 101, 102, 103, 200, 201, 203, 204, 299
]);

export function sportHasTrainingBenefit(sportType: number | undefined): boolean {
  return sportType !== undefined && LABELLED_SPORT_TYPES.has(sportType);
}

const TRAIL_RUN = 102;
const TREADMILL = 101;
/** Road, trail and track runs; a treadmill's pace is the watch's guess. */
const PACED_RUNS: ReadonlySet<number> = new Set([100, 102, 103]);

/** The heart rate is still rising and the legs warming up: Daniels' ten easy minutes. */
export const WARM_UP_SECONDS = 10 * 60;
/** A sample further from the next than this stands for one second: a dropout. */
const MAX_SAMPLE_GAP_S = 5;
/** Slower than 20:00/km is standing at a crossing, not running slowly. */
const SLOWEST_MOVING_PACE_S_PER_KM = 1200;
const HR_BUCKETS = 6;
const PACE_BUCKETS = 7;

/** A lap shorter than this is a stray press, not a step. */
const MIN_REP_SECONDS = 10;
/** A work step this many times the typical one is the run the reps were added to. */
const BODY_FACTOR = 4;
/** Manual laps: the fast ones must be this much quicker than the slow ones. */
const MANUAL_SPEED_RATIO = 1.15;
/** Laps within this of an auto-lap distance are the watch's, not a press. */
const AUTO_LAP_TOLERANCE = 0.02;
const AUTO_LAP_METERS = [1000, 1609.344];
/** Below this share of auto-length laps, the laps were pressed by hand. */
const AUTO_LAP_SHARE = 0.7;

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

/** The highest bucket whose floor a heart rate reaches; bucket 0 is everything under the first. */
export function heartRateBucket(
  zones: readonly TrainingHubActivityZoneBucket[],
  hr: number
): number {
  let found = 0;
  for (const zone of zones) {
    if (zone.index > 0 && zone.low !== undefined && hr >= zone.low && zone.index > found) {
      found = zone.index;
    }
  }
  return Math.min(found, HR_BUCKETS - 1);
}

/** The highest pace bucket whose slow edge a pace is inside; bucket 0 is slower than every edge. */
export function paceBucket(
  zones: readonly TrainingHubActivityZoneBucket[],
  pace: number
): number {
  let found = 0;
  for (const zone of zones) {
    if (zone.index > 0 && zone.high !== undefined && pace <= zone.high && zone.index > found) {
      found = zone.index;
    }
  }
  return Math.min(found, PACE_BUCKETS - 1);
}

/** The lower middle value, so the median of whole ranks is a rank; 0 of nothing. */
export function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** The parts of a detail the label is read from. */
export type IntensityInput = Pick<TrainingHubActivityDetail, "hrZones"> &
  Partial<
    Pick<
      TrainingHubActivityDetail,
      "laps" | "paceZones" | "adjustedPaceZones" | "series" | "pauses" | "duration" | "sportType"
    >
  >;

interface PaceReading {
  zones: readonly TrainingHubActivityZoneBucket[];
  pick: (point: TrainingHubActivitySeriesPoint) => number | undefined;
}

/** Which pace a run is banded by: grade-adjusted on a trail, as its zone panel reads it. */
function paceReading(
  detail: Pick<TrainingHubActivityDetail, "paceZones" | "adjustedPaceZones">,
  sportType: number
): PaceReading | undefined {
  if (!PACED_RUNS.has(sportType)) return undefined;
  if (sportType === TRAIL_RUN) {
    const zones = detail.adjustedPaceZones ?? [];
    return zones.length > 1 ? { zones, pick: (point) => point.adjustedPace } : undefined;
  }
  const zones = detail.paceZones ?? [];
  return zones.length > 1 ? { zones, pick: (point) => point.pace } : undefined;
}

/**
 * Seconds per heart-rate bucket after the warm-up, and — on a paced run — the
 * same seconds split by pace bucket too, `joint[hr][pace]`. A second with no
 * heart rate is not counted; on a paced run, neither is one with no pace or a
 * standing one, since it cannot be placed on both.
 */
function sessionSeconds(
  series: readonly TrainingHubActivitySeriesPoint[],
  pauses: readonly TrainingHubActivityPause[],
  hrZones: readonly TrainingHubActivityZoneBucket[],
  pace: PaceReading | undefined
): { hr: number[]; joint?: number[][] } {
  const hr = new Array<number>(HR_BUCKETS).fill(0);
  const joint = pace
    ? Array.from({ length: HR_BUCKETS }, () => new Array<number>(PACE_BUCKETS).fill(0))
    : undefined;
  const ordered = [...pauses]
    .filter((pause) => pause.start >= 0 && pause.duration > 0)
    .sort((left, right) => left.start - right.start);
  // The series runs on the wall clock and in order, so the pauses behind a
  // sample only ever grow: one pointer walks them.
  let nextPause = 0;
  let pausedBefore = 0;

  for (let index = 0; index < series.length; index += 1) {
    const point = series[index]!;
    const next = series[index + 1];
    if (point.elapsed === undefined) continue;
    while (nextPause < ordered.length && ordered[nextPause]!.start + ordered[nextPause]!.duration <= point.elapsed) {
      pausedBefore += ordered[nextPause]!.duration;
      nextPause += 1;
    }
    const inPause = ordered[nextPause];
    const paused = pausedBefore + (inPause && inPause.start < point.elapsed ? point.elapsed - inPause.start : 0);
    if (point.elapsed - paused < WARM_UP_SECONDS || !finite(point.hr) || point.hr <= 0) continue;
    const gap = next?.elapsed !== undefined ? next.elapsed - point.elapsed : 1;
    const seconds = gap > 0 && gap <= MAX_SAMPLE_GAP_S ? gap : 1;
    const hrIndex = heartRateBucket(hrZones, point.hr);
    if (pace && joint) {
      const value = pace.pick(point);
      if (!finite(value) || value <= 0 || value > SLOWEST_MOVING_PACE_S_PER_KM) continue;
      joint[hrIndex]![paceBucket(pace.zones, value)]! += seconds;
    }
    hr[hrIndex]! += seconds;
  }

  const round = (row: number[]) => row.map((value) => Math.round(value));
  return joint ? { hr: round(hr), joint: joint.map(round) } : { hr: round(hr) };
}

interface LapRun {
  phase: TrainingHubActivityLap["phase"] | null;
  laps: TrainingHubActivityLap[];
}

/** Consecutive laps of one structured-workout step: COROS splits a step by its auto-laps. */
function stepsOf(laps: readonly TrainingHubActivityLap[]): LapRun[] {
  const steps: LapRun[] = [];
  for (const lap of laps) {
    const phase = lap.phase ?? null;
    const last = steps[steps.length - 1];
    if (last && last.phase === phase) last.laps.push(lap);
    else steps.push({ phase, laps: [lap] });
  }
  return steps;
}

interface Bout {
  seconds: number;
  meters: number;
  avgHr?: number;
}

function boutOf(laps: readonly TrainingHubActivityLap[]): Bout {
  const seconds = laps.reduce((sum, lap) => sum + (lap.duration ?? 0), 0);
  const meters = laps.reduce((sum, lap) => sum + (lap.distance ?? 0), 0);
  const beats = laps.reduce((sum, lap) => sum + (lap.avgHr ?? 0) * (lap.duration ?? 0), 0);
  const timed = laps.reduce((sum, lap) => sum + (lap.avgHr ? (lap.duration ?? 0) : 0), 0);
  return { seconds, meters, ...(timed > 0 ? { avgHr: beats / timed } : {}) };
}

/**
 * A structured workout's reps: each work step with a recovery step beside it.
 * A work step with none is the session itself — a long run's one block, or a
 * stray lap after the cool-down.
 */
function workoutBouts(laps: readonly TrainingHubActivityLap[]): Bout[] | undefined {
  if (!laps.some((lap) => lap.phase !== undefined)) return undefined;
  const steps = stepsOf(laps);
  const bouts: Bout[] = [];
  steps.forEach((step, at) => {
    if (step.phase !== "work") return;
    if (steps[at - 1]?.phase !== "recovery" && steps[at + 1]?.phase !== "recovery") return;
    bouts.push(boutOf(step.laps));
  });
  return bouts;
}

/**
 * Reps pressed by hand: laps that are not the watch's auto-laps, whose speeds
 * fall into a fast set at least 15% quicker than the slow set, each fast lap
 * beside a slow one.
 */
function manualBouts(laps: readonly TrainingHubActivityLap[]): Bout[] | undefined {
  const timed = laps.filter(
    (lap) => (lap.duration ?? 0) >= MIN_REP_SECONDS && (lap.distance ?? 0) > 0
  );
  if (timed.length < 4) return undefined;
  // The last lap is whatever was left when the watch stopped.
  const judged = timed.slice(0, -1);
  const auto = judged.filter((lap) =>
    AUTO_LAP_METERS.some(
      (meters) => Math.abs((lap.distance ?? 0) - meters) / meters <= AUTO_LAP_TOLERANCE
    )
  ).length;
  if (auto / judged.length >= AUTO_LAP_SHARE) return undefined;

  const speed = (lap: TrainingHubActivityLap) => (lap.distance ?? 0) / (lap.duration ?? 1);
  const speeds = timed.map(speed).sort((left, right) => left - right);
  // Split where the sorted speeds jump the most, as a ratio.
  let split = -1;
  let widest = 1;
  for (let at = 0; at < speeds.length - 1; at += 1) {
    const ratio = speeds[at + 1]! / speeds[at]!;
    if (ratio > widest) {
      widest = ratio;
      split = at;
    }
  }
  if (split < 0) return undefined;
  const cut = speeds[split]!;
  const fast = (lap: TrainingHubActivityLap) => speed(lap) > cut;
  const fastSpeeds = speeds.slice(split + 1);
  const slowSpeeds = speeds.slice(0, split + 1);
  if (lowerMedian(fastSpeeds) < MANUAL_SPEED_RATIO * lowerMedian(slowSpeeds)) return undefined;

  const bouts: Bout[] = [];
  timed.forEach((lap, at) => {
    if (!fast(lap)) return;
    const before = timed[at - 1];
    const after = timed[at + 1];
    if ((before && !fast(before)) || (after && !fast(after))) bouts.push(boutOf([lap]));
  });
  return bouts;
}

/** Strays out, the body of the run out; what is left is the reps, if there are two. */
function keptBouts(bouts: readonly Bout[]): Bout[] {
  const real = bouts.filter((bout) => bout.seconds >= MIN_REP_SECONDS);
  const typical = lowerMedian(real.map((bout) => bout.seconds));
  const reps = real.filter((bout) => bout.seconds <= BODY_FACTOR * typical);
  return reps.length >= 2 ? reps : [];
}

/**
 * The reps of a session, if it is a repeat session, each banded by heart rate
 * (its lap's average) and — on a paced run off the trail — by its own pace. A
 * trail rep is uphill, where pace says nothing about effort.
 */
function sessionReps(
  detail: IntensityInput,
  sportType: number
): { reps: SessionRep[]; source: "workout" | "manual" } | undefined {
  const laps = detail.laps ?? [];
  const fromWorkout = workoutBouts(laps);
  const source = fromWorkout ? "workout" : "manual";
  const bouts = fromWorkout ?? (sportType < 200 && sportType !== TREADMILL ? manualBouts(laps) : undefined);
  const kept = keptBouts(bouts ?? []);
  if (kept.length === 0) return undefined;

  const paceZones =
    PACED_RUNS.has(sportType) && sportType !== TRAIL_RUN && (detail.paceZones?.length ?? 0) > 1
      ? detail.paceZones!
      : undefined;
  const reps = kept.map((bout): SessionRep => {
    const pace = bout.meters > 0 ? bout.seconds / (bout.meters / 1000) : undefined;
    return {
      seconds: Math.round(bout.seconds),
      meters: Math.round(bout.meters),
      ...(bout.avgHr !== undefined ? { hrBucket: heartRateBucket(detail.hrZones, bout.avgHr) } : {}),
      ...(paceZones && pace !== undefined ? { paceBucket: paceBucket(paceZones, pace) } : {})
    };
  });
  return { reps, source };
}

/**
 * Everything a session's label is read from, or nothing for a sport that is
 * not labelled. `sportType` is the list row's when the payload names none.
 */
export function summarizeSessionIntensity(
  detail: IntensityInput,
  sportType: number | undefined = detail.sportType
): SessionIntensity | undefined {
  if (sportType === undefined || !sportHasTrainingBenefit(sportType)) return undefined;
  const pace = paceReading(detail, sportType);
  const { hr, joint } = sessionSeconds(detail.series ?? [], detail.pauses ?? [], detail.hrZones, pace);
  const repeats = sessionReps(detail, sportType);
  return {
    version: INTENSITY_SUMMARY_VERSION,
    seconds: Math.round(detail.duration ?? 0),
    hr,
    ...(joint ? { joint } : {}),
    ...(repeats ? { reps: repeats.reps, repSource: repeats.source } : {})
  };
}
