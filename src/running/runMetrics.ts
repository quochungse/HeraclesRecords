import type {
  ActivityDetailSummary,
  CorosProfileZoneFamily,
  TrainingHubActivity,
  TrainingHubThresholdZone
} from "../../electron/types";
import {
  RUN_SURFACES,
  classifyRunSurface,
  isOutdoorRunSurface,
  isRunSportType,
  type RunSurface
} from "./runSurface";
import { startOfWeekMs } from "../training/activityWindow";

// The series maths is shared with the main process, which computes the same
// figures once per run and stores them — see `electron/activityMetrics.ts`.
// Re-exported here so this module stays the one import the run screens reach
// for, and so a call site never has to know which side computed the number.
export {
  paceHrDecoupling,
  withPausesRemoved,
  type RunDecoupling
} from "../../electron/activityMetrics";

const MS_PER_DAY = 86_400_000;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** COROS sends epoch seconds on the activity list. */
function startedAtMs(activity: TrainingHubActivity): number | undefined {
  const seconds = positive(activity.startTime);
  return seconds === undefined ? undefined : seconds * 1000;
}

/**
 * How long a run took, in the sense every figure on this screen means: time
 * spent running. `duration` is COROS's activity time, pauses out — never
 * `elapsedDuration`, which put a real 10.2 km run with 48 minutes of pauses at
 * 11:36 /km against the 6:51 it was actually run at.
 */
export function runSeconds(
  activity: Pick<TrainingHubActivity, "duration">
): number | undefined {
  return positive(activity.duration);
}

/**
 * Seconds per kilometre, or nothing.
 *
 * A session that recorded no distance is not a 0:00 run and must not be given a
 * pace — an indoor run with the foot pod off comes back exactly like that, and
 * a zero would sit at the fast end of every pace chart it reached.
 */
export function paceSecondsPerKm(
  activity: TrainingHubActivity
): number | undefined {
  const distance = positive(activity.distance);
  const duration = runSeconds(activity);
  if (distance === undefined || duration === undefined) {
    return undefined;
  }

  return duration / (distance / METERS_PER_KM);
}

/**
 * Metres covered per minute per heartbeat — how much ground one beat buys.
 *
 * The one fitness signal on this screen that costs nothing to compute and still
 * moves week to week: at a fixed effort, a rising figure is the aerobic system
 * getting better. It only means that on steady running, so the caller filters
 * to easy sessions before averaging; computed here per activity so the filter
 * stays the caller's decision.
 */
export function efficiencyIndex(
  activity: TrainingHubActivity
): number | undefined {
  const distance = positive(activity.distance);
  const duration = runSeconds(activity);
  const avgHr = positive(activity.avgHr);
  if (distance === undefined || duration === undefined || avgHr === undefined) {
    return undefined;
  }

  const metersPerMinute = distance / (duration / SECONDS_PER_MINUTE);
  return metersPerMinute / avgHr;
}

/** Climb per kilometre. Absent when COROS recorded no climb for the session. */
export function elevationPerKm(
  activity: TrainingHubActivity
): number | undefined {
  const distance = positive(activity.distance);
  if (distance === undefined || activity.elevationGain === undefined) {
    return undefined;
  }

  return activity.elevationGain / (distance / METERS_PER_KM);
}

/** Monday-start weeks, matching every other weekly figure in the app. */
export function startOfRunWeekMs(timestampMs: number): number {
  return startOfWeekMs(timestampMs);
}

/**
 * Where a window of `weeks` calendar weeks begins, this week included.
 *
 * The one definition of "the last N weeks" on the Running screen. The charts
 * bucket by calendar week, so a filter that cut at `now − N × 7 days` instead
 * reached back past the oldest bucket on every day but Monday: the runs in
 * between were counted by the totals strip and dropped by the chart eighteen
 * pixels below it — 50 km against 30 km on a Tuesday, same four weeks.
 */
export function runWindowStartMs(weeks: number, nowMs: number): number {
  // Stepped through the local calendar, like `buildRunWeeks`, so a DST change
  // inside the window cannot land the start an hour off a Monday.
  const cursor = new Date(startOfRunWeekMs(nowMs));
  cursor.setDate(cursor.getDate() - Math.max(0, weeks - 1) * 7);
  return cursor.getTime();
}

export interface RunTotals {
  count: number;
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  trainingLoad: number;
  /** Metres. */
  elevationGain: number;
}

export interface RunWeek extends RunTotals {
  weekStartMs: number;
  label: string;
  /** Metres of the week's single longest run. */
  longestRunMeters: number;
  /** Metres per surface in the week, for the volume chart's stacked bars. */
  distanceBySurface: Record<RunSurface, number>;
}

function emptyTotals(): RunTotals {
  return {
    count: 0,
    distance: 0,
    duration: 0,
    trainingLoad: 0,
    elevationGain: 0
  };
}

function emptySurfaceDistances(): Record<RunSurface, number> {
  return { road: 0, trail: 0, track: 0, treadmill: 0 };
}

function addToTotals(totals: RunTotals, activity: TrainingHubActivity): void {
  totals.count += 1;
  totals.distance += positive(activity.distance) ?? 0;
  totals.duration += runSeconds(activity) ?? 0;
  totals.trainingLoad += positive(activity.trainingLoad) ?? 0;
  totals.elevationGain += positive(activity.elevationGain) ?? 0;
}

/** Every run in the list added up, ignoring dates. */
export function summariseRuns(
  activities: readonly TrainingHubActivity[]
): RunTotals {
  const totals = emptyTotals();
  for (const activity of activities) {
    if (isRunSportType(activity.sportType)) {
      addToTotals(totals, activity);
    }
  }
  return totals;
}

function weekLabel(weekStartMs: number): string {
  return new Date(weekStartMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

export interface BuildRunWeeksOptions {
  /** How many weeks back to build, the current week included. */
  weeks: number;
  /** Defaults to now; injected by tests. */
  nowMs?: number;
}

/**
 * One bucket per week, oldest first, with **no gaps**.
 *
 * A week nobody ran is a zero bar, not a missing one: dropping it slides every
 * later bar leftwards and turns a fortnight off into a chart that looks like
 * uninterrupted training.
 */
export function buildRunWeeks(
  activities: readonly TrainingHubActivity[],
  { weeks, nowMs = Date.now() }: BuildRunWeeksOptions
): RunWeek[] {
  if (weeks <= 0) {
    return [];
  }

  const currentWeekStart = startOfRunWeekMs(nowMs);
  const buckets = new Map<number, RunWeek>();

  for (let index = weeks - 1; index >= 0; index -= 1) {
    // Step a whole week back through the local calendar rather than
    // subtracting 7 × 86 400 000, which lands an hour out across a DST change
    // and silently drops a Monday into the week before.
    const cursor = new Date(currentWeekStart);
    cursor.setDate(cursor.getDate() - index * 7);
    const weekStartMs = cursor.getTime();
    buckets.set(weekStartMs, {
      weekStartMs,
      label: weekLabel(weekStartMs),
      longestRunMeters: 0,
      distanceBySurface: emptySurfaceDistances(),
      ...emptyTotals()
    });
  }

  for (const activity of activities) {
    const surface = classifyRunSurface(activity.sportType);
    const at = startedAtMs(activity);
    if (surface === null || at === undefined) {
      continue;
    }

    const bucket = buckets.get(startOfRunWeekMs(at));
    if (!bucket) {
      continue;
    }

    addToTotals(bucket, activity);
    const distance = positive(activity.distance) ?? 0;
    bucket.distanceBySurface[surface] += distance;
    bucket.longestRunMeters = Math.max(bucket.longestRunMeters, distance);
  }

  return [...buckets.values()].sort(
    (left, right) => left.weekStartMs - right.weekStartMs
  );
}

export interface RunLoadBalance {
  /** Training load over the last 7 days. */
  acute: number;
  /** Weekly-equivalent load over the last 28 days. */
  chronic: number;
  /** acute ÷ chronic. Absent while there is nothing to divide by. */
  ratio?: number;
  /**
   * How far back the athlete's oldest run is — across the whole list, not the
   * window. Under ~21 days the chronic figure is averaging over history that
   * does not exist, so the ratio reads high and the screen says so. Measured
   * inside the window it said the same about a comeback: three weeks off leaves
   * nothing in the window before this week, but those weeks are zeros that
   * happened, and they are exactly why the ratio is high.
   */
  oldestRunDaysAgo?: number;
}

/**
 * Acute-to-chronic load, running only.
 *
 * COROS ships a `trainingLoadRatio` of its own, but it is taken across every
 * sport — a heavy week of lifting moves it. The question this screen answers is
 * whether *running* volume has jumped, so it is tallied here from run load
 * alone.
 */
export function runLoadBalance(
  activities: readonly TrainingHubActivity[],
  nowMs: number = Date.now()
): RunLoadBalance {
  let acute = 0;
  let chronicTotal = 0;
  let oldestAt: number | undefined;

  for (const activity of activities) {
    const at = startedAtMs(activity);
    if (at === undefined || !isRunSportType(activity.sportType) || at > nowMs) {
      continue;
    }

    if (oldestAt === undefined || at < oldestAt) {
      oldestAt = at;
    }

    const daysAgo = (nowMs - at) / MS_PER_DAY;
    if (daysAgo > 28) {
      continue;
    }

    const load = positive(activity.trainingLoad) ?? 0;
    chronicTotal += load;
    if (daysAgo <= 7) {
      acute += load;
    }
  }

  const chronic = chronicTotal / 4;
  return {
    acute,
    chronic,
    ...(chronic > 0 ? { ratio: acute / chronic } : {}),
    ...(oldestAt !== undefined
      ? { oldestRunDaysAgo: (nowMs - oldestAt) / MS_PER_DAY }
      : {})
  };
}

export type RunIntensity = "easy" | "moderate" | "hard";

/**
 * A zone list and the model it belongs to, which travel together because the
 * band a zone takes depends on both: the same position is a different effort
 * under max heart rate than under reserve or threshold. `HeartRateZoneModel`
 * is one as it stands.
 */
export interface RunZoneScale {
  family: CorosProfileZoneFamily;
  zones: readonly TrainingHubThresholdZone[];
}

/**
 * Which zone a heart rate lands in, 1-based.
 *
 * COROS states a zone by its ceiling and caps the top one with a sentinel well
 * above any real pulse, so "the first ceiling this reaches" is the whole rule.
 */
export function heartRateZoneIndex(
  bpm: number | undefined,
  zones: readonly TrainingHubThresholdZone[]
): number | undefined {
  const beats = positive(bpm);
  if (beats === undefined || zones.length === 0) {
    return undefined;
  }

  const sorted = [...zones].sort((left, right) => left.index - right.index);
  const position = sorted.findIndex(
    (zone) => zone.hr !== undefined && beats <= zone.hr
  );
  return position === -1 ? sorted.length : position + 1;
}

/**
 * Easy / moderate / hard from a session's **average** heart rate.
 *
 * Deliberately coarse: an interval session averages into the middle and reads
 * "moderate" when it was neither. That is the known cost of classifying from
 * the activity list, which is all this screen has: it is right about the steady
 * running that makes up most of the week, which is the mix the 80/20 check is
 * asking about.
 */
export function runIntensity(
  avgHr: number | undefined,
  scale: RunZoneScale
): RunIntensity | undefined {
  if (scale.zones.length < 3) {
    return undefined;
  }

  const zone = heartRateZoneIndex(avgHr, scale.zones);
  return zone === undefined ? undefined : intensityForZone(zone, scale.family);
}

/**
 * Zones the easy band reaches past the second, per model.
 *
 * COROS sends six ceilings under every model, but they do not sit at the same
 * efforts. Reserve (59/74/84/88/95%) and threshold (80/90/95/102/106%) put the
 * second ceiling at the top of aerobic running — 74% HRR, 90% LTHR — and the
 * third at tempo. Max heart rate steps in tens (50/60/70/80/90/100%), so its
 * second ceiling is 60%, a walk for most runners, and an easy run at 72% of max
 * read as hard. One zone further brings it to 70% easy, 70–80% moderate.
 */
const MAX_HR_EASY_ZONE_SHIFT = 1;

/**
 * Easy / moderate / hard for a 1-based position in the account's zone list —
 * the one cut every reading of a run makes, from an average or from time in
 * zone. It lived in two places once, a table beside `runIntensityMix` a zone
 * off from this: 155–168 bpm on a heart-rate-reserve account was moderate by
 * average and easy by the clock, so the intensity panel called most of the
 * running easy while the efficiency chart beside it left those runs out.
 */
function intensityForZone(zone: number, family: CorosProfileZoneFamily): RunIntensity {
  const position = zone - (family === "maxHr" ? MAX_HR_EASY_ZONE_SHIFT : 0);
  if (position <= 2) {
    return "easy";
  }
  return position === 3 ? "moderate" : "hard";
}

/** The surfaces actually present in a list, in render order. */
export function surfacesPresent(
  activities: readonly TrainingHubActivity[]
): RunSurface[] {
  const seen = new Set<RunSurface>();
  for (const activity of activities) {
    const surface = classifyRunSurface(activity.sportType);
    if (surface !== null) {
      seen.add(surface);
    }
  }
  return RUN_SURFACES.filter((surface) => seen.has(surface));
}

/**
 * A run long enough for its average heart rate to mean something.
 *
 * Efficiency is a steady-state figure. A ten-minute shakeout spends most of its
 * length with the pulse still climbing, so its average sits well under the
 * effort actually being made and the week it lands in reads as a jump in
 * fitness that never happened.
 */
const MIN_EFFICIENCY_DURATION_SECONDS = 1200;

/**
 * Whether a run belongs in an efficiency comparison: long enough for its
 * average to mean something, and — given zones — easy. The one definition, so
 * the trend line and the scatter beside it cannot draw different populations
 * under the same header; the scatter used to plot every run, shakeouts and
 * intervals included, beneath a caption saying they had been left out.
 */
export function countsForEfficiency(
  activity: TrainingHubActivity,
  scale?: RunZoneScale
): boolean {
  if ((runSeconds(activity) ?? 0) < MIN_EFFICIENCY_DURATION_SECONDS) {
    return false;
  }
  return (
    scale === undefined ||
    scale.zones.length === 0 ||
    runIntensity(activity.avgHr, scale) === "easy"
  );
}

export interface RunEfficiencyWeek {
  weekStartMs: number;
  label: string;
  /** Mean efficiency index per surface, absent where the week had no run. */
  bySurface: Partial<Record<RunSurface, number>>;
  /** Mean across every qualifying run that week. */
  overall?: number;
  count: number;
}

export interface BuildRunEfficiencyOptions extends BuildRunWeeksOptions {
  /**
   * The account's heart-rate zones. Given them, only easy running counts —
   * which is the whole point, since efficiency compares like with like. Without
   * them every long enough run counts and the caller should say so.
   */
  zoneScale?: RunZoneScale;
}

/**
 * Efficiency index by week and surface.
 *
 * Kept apart from {@link buildRunWeeks} rather than folded into it: that one
 * counts every run because volume is volume, and this one counts a deliberately
 * narrow slice, because a trail climb and a road cruise at the same heart rate
 * are not evidence about each other.
 */
export function buildRunEfficiencyWeeks(
  activities: readonly TrainingHubActivity[],
  { weeks, nowMs = Date.now(), zoneScale }: BuildRunEfficiencyOptions
): RunEfficiencyWeek[] {
  const skeleton = buildRunWeeks([], { weeks, nowMs });
  const samples = new Map<number, { surface: RunSurface; value: number }[]>();

  for (const activity of activities) {
    const surface = classifyRunSurface(activity.sportType);
    const at = startedAtMs(activity);
    const value = efficiencyIndex(activity);
    if (
      surface === null ||
      at === undefined ||
      value === undefined ||
      !countsForEfficiency(activity, zoneScale)
    ) {
      continue;
    }

    const weekStart = startOfRunWeekMs(at);
    const bucket = samples.get(weekStart);
    if (bucket) {
      bucket.push({ surface, value });
    } else {
      samples.set(weekStart, [{ surface, value }]);
    }
  }

  const mean = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  return skeleton.map((week) => {
    const bucket = samples.get(week.weekStartMs) ?? [];
    const bySurface: Partial<Record<RunSurface, number>> = {};

    for (const surface of RUN_SURFACES) {
      const values = bucket
        .filter((sample) => sample.surface === surface)
        .map((sample) => sample.value);
      if (values.length > 0) {
        bySurface[surface] = mean(values);
      }
    }

    return {
      weekStartMs: week.weekStartMs,
      label: week.label,
      bySurface,
      ...(bucket.length > 0
        ? { overall: mean(bucket.map((sample) => sample.value)) }
        : {}),
      count: bucket.length
    };
  });
}

export interface RunIntensityBucket {
  count: number;
  /** Seconds. */
  duration: number;
}

export interface RunIntensityMix {
  easy: RunIntensityBucket;
  moderate: RunIntensityBucket;
  hard: RunIntensityBucket;
  /** Runs with no heart rate — no zone can place them, and none is guessed. */
  unrated: RunIntensityBucket;
  /** Runs split by COROS's own time in zone rather than by their average. */
  zoneTimed: number;
}

/** The share of a run its zone split must cover to be read instead of the
 *  average. A dropout of a few minutes passes; a strap that barely worked does
 *  not. */
const MIN_ZONE_TIME_COVERAGE = 0.8;

/**
 * The easy/moderate/hard split, by session count and by time.
 *
 * Both, because they disagree and the disagreement is the point: six short hard
 * sessions and two long easy ones is 75% hard by count and mostly easy by the
 * clock. The 80/20 rule is stated about time.
 *
 * A run whose detail has been summarised is split by **time in zone**, which is
 * the honest reading: an interval session lands partly in each band instead of
 * averaging into the middle and reading "moderate" when it was neither. The
 * rest are placed by their average heart rate, which is all the list carries.
 * Zone seconds are scaled onto the run's own duration so the bar still totals
 * the time the screen says was run — COROS scores only the samples that carried
 * a heart rate, and the difference would otherwise go missing from the total.
 */
export function runIntensityMix(
  activities: readonly TrainingHubActivity[],
  zoneScale: RunZoneScale,
  summaries?: ReadonlyMap<string, ActivityDetailSummary>
): RunIntensityMix {
  const mix: RunIntensityMix = {
    easy: { count: 0, duration: 0 },
    moderate: { count: 0, duration: 0 },
    hard: { count: 0, duration: 0 },
    unrated: { count: 0, duration: 0 },
    zoneTimed: 0
  };

  for (const activity of activities) {
    if (!isRunSportType(activity.sportType)) {
      continue;
    }

    const duration = runSeconds(activity) ?? 0;
    const zoneSeconds = summaries?.get(activity.activityId)?.zoneSeconds;
    const scored = zoneSeconds?.reduce((sum, value) => sum + value, 0) ?? 0;
    // Only a split that covers most of the run is worth stretching over it. A
    // strap that came back for the last five minutes of an easy hour scores
    // those five minutes, and scaled onto the whole run they turned it into an
    // hour of hard running — the same run read 100% easy or 100% hard depending
    // only on whether the sweep had reached it yet. Below the floor the average
    // is the better reading of what happened.
    const covered =
      zoneSeconds !== undefined &&
      scored > 0 &&
      (duration === 0 || scored >= duration * MIN_ZONE_TIME_COVERAGE);

    if (zoneSeconds && covered) {
      const scale = duration > 0 ? duration / scored : 1;
      let leader: RunIntensity = "easy";
      let leaderSeconds = -1;
      const banded: Record<RunIntensity, number> = {
        easy: 0,
        moderate: 0,
        hard: 0
      };
      // Bucket k is the time spent inside zone entry k's range — checked
      // against a real run's samples, bucket by bucket — so it takes the band
      // that entry's position does.
      zoneSeconds.forEach((seconds, index) => {
        banded[intensityForZone(index + 1, zoneScale.family)] += seconds;
      });
      for (const band of ["easy", "moderate", "hard"] as const) {
        mix[band].duration += banded[band] * scale;
        if (banded[band] > leaderSeconds) {
          leader = band;
          leaderSeconds = banded[band];
        }
      }
      // One run is one session wherever it is counted, so the count goes to
      // the band it spent the most time in rather than being split three ways.
      mix[leader].count += 1;
      mix.zoneTimed += 1;
      continue;
    }

    const bucket = mix[runIntensity(activity.avgHr, zoneScale) ?? "unrated"];
    bucket.count += 1;
    bucket.duration += duration;
  }

  return mix;
}

export interface RunSurfaceTotals extends RunTotals {
  surface: RunSurface;
  /** Share of the list's distance, 0..1. */
  share: number;
  /** Aggregate seconds per kilometre — total time over total distance. */
  pace?: number;
  /** Metres climbed per kilometre. Absent indoors, where there is no terrain. */
  elevationPerKm?: number;
  /** Metres climbed per hour. Absent indoors. */
  verticalSpeed?: number;
}

/** Per-surface totals, in render order, skipping surfaces with no runs. */
export function runSurfaceBreakdown(
  activities: readonly TrainingHubActivity[]
): RunSurfaceTotals[] {
  const totals = new Map<RunSurface, RunTotals>();
  for (const activity of activities) {
    const surface = classifyRunSurface(activity.sportType);
    if (surface === null) {
      continue;
    }
    const bucket = totals.get(surface) ?? emptyTotals();
    addToTotals(bucket, activity);
    totals.set(surface, bucket);
  }

  const overall = [...totals.values()].reduce(
    (sum, bucket) => sum + bucket.distance,
    0
  );

  return RUN_SURFACES.flatMap((surface) => {
    const bucket = totals.get(surface);
    if (!bucket || bucket.count === 0) {
      return [];
    }

    const pace =
      bucket.distance > 0 && bucket.duration > 0
        ? bucket.duration / (bucket.distance / METERS_PER_KM)
        : undefined;

    // A treadmill reports no terrain, so a zero here would be a measurement of
    // nothing dragging the outdoor figures down beside it.
    const outdoor = isOutdoorRunSurface(surface);
    const elevationPerKm =
      outdoor && bucket.distance > 0
        ? bucket.elevationGain / (bucket.distance / METERS_PER_KM)
        : undefined;
    const climbRate =
      outdoor && bucket.duration > 0
        ? bucket.elevationGain / (bucket.duration / SECONDS_PER_HOUR)
        : undefined;

    return [
      {
        surface,
        ...bucket,
        share: overall > 0 ? bucket.distance / overall : 0,
        ...(pace !== undefined ? { pace } : {}),
        ...(elevationPerKm !== undefined ? { elevationPerKm } : {}),
        ...(climbRate !== undefined ? { verticalSpeed: climbRate } : {})
      }
    ];
  });
}
