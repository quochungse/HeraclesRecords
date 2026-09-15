import type {
  ActivityDetailSummary,
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

// The series maths is shared with the main process, which computes the same
// figures once per run and stores them — see `electron/activityMetrics.ts`.
// Re-exported here so this module stays the one import the run screens reach
// for, and so a call site never has to know which side computed the number.
export {
  activeElapsed,
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
 * spent running. COROS's `duration` is start to finish with the pauses in it,
 * so a real 10.2 km run with two pauses totalling 48 minutes read 11:36 /km
 * against the 6:51 it was actually run at. Falls back to `duration` only where
 * COROS sent no activity time, which is the same number on a run never paused.
 */
export function runSeconds(
  activity: Pick<TrainingHubActivity, "duration" | "activeDuration">
): number | undefined {
  return positive(activity.activeDuration) ?? positive(activity.duration);
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

/** Metres climbed per hour — the number trail running is actually paced by. */
export function verticalSpeed(
  activity: TrainingHubActivity
): number | undefined {
  const duration = runSeconds(activity);
  if (duration === undefined || activity.elevationGain === undefined) {
    return undefined;
  }

  // Zero climb is a reading, not a gap: a flat run really did climb nothing,
  // and turning that into "no data" would hide every road run from the mix.
  return activity.elevationGain / (duration / SECONDS_PER_HOUR);
}

/** Monday-start weeks, matching every other weekly figure in the app. */
export function startOfRunWeekMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  // getDay() is 0 on Sunday; shift so weeks start on Monday.
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
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
  /** Metres per surface, so a filtered chart can still stack the whole week. */
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
   * How far back the oldest run inside the 28-day window is. Under ~21 days the
   * chronic figure is averaging over history that does not exist, so the ratio
   * reads high and the screen should say so rather than raise an alarm.
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

    const daysAgo = (nowMs - at) / MS_PER_DAY;
    if (daysAgo > 28) {
      continue;
    }

    const load = positive(activity.trainingLoad) ?? 0;
    chronicTotal += load;
    if (daysAgo <= 7) {
      acute += load;
    }
    if (oldestAt === undefined || at < oldestAt) {
      oldestAt = at;
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
  zones: readonly TrainingHubThresholdZone[]
): RunIntensity | undefined {
  if (zones.length < 3) {
    return undefined;
  }

  const zone = heartRateZoneIndex(avgHr, zones);
  if (zone === undefined) {
    return undefined;
  }

  if (zone <= 2) {
    return "easy";
  }
  return zone === 3 ? "moderate" : "hard";
}

/** Distance per surface across a whole list, for the surface mix panel. */
export function distanceBySurface(
  activities: readonly TrainingHubActivity[]
): Record<RunSurface, number> {
  const totals = emptySurfaceDistances();
  for (const activity of activities) {
    const surface = classifyRunSurface(activity.sportType);
    if (surface !== null) {
      totals[surface] += positive(activity.distance) ?? 0;
    }
  }
  return totals;
}

/** The surfaces actually present in a list, in render order. */
export function surfacesPresent(
  activities: readonly TrainingHubActivity[]
): RunSurface[] {
  const totals = distanceBySurface(activities);
  const seen = new Set<RunSurface>();
  for (const activity of activities) {
    const surface = classifyRunSurface(activity.sportType);
    if (surface !== null) {
      seen.add(surface);
    }
  }
  return RUN_SURFACES.filter(
    (surface) => seen.has(surface) || totals[surface] > 0
  );
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
   * Threshold heart-rate zones. Given them, only easy running counts — which is
   * the whole point, since efficiency compares like with like. Without them
   * every long enough run counts and the caller should say so.
   */
  zones?: readonly TrainingHubThresholdZone[];
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
  { weeks, nowMs = Date.now(), zones = [] }: BuildRunEfficiencyOptions
): RunEfficiencyWeek[] {
  const skeleton = buildRunWeeks([], { weeks, nowMs });
  const samples = new Map<number, { surface: RunSurface; value: number }[]>();

  for (const activity of activities) {
    const surface = classifyRunSurface(activity.sportType);
    const at = startedAtMs(activity);
    const value = efficiencyIndex(activity);
    if (surface === null || at === undefined || value === undefined) {
      continue;
    }
    if ((runSeconds(activity) ?? 0) < MIN_EFFICIENCY_DURATION_SECONDS) {
      continue;
    }
    if (zones.length > 0 && runIntensity(activity.avgHr, zones) !== "easy") {
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

/**
 * Which band each of COROS's six HR buckets belongs to. Bucket 0 is the time
 * below zone 1, so it reads as easy alongside zones 1 and 2 — the same cut
 * `runIntensity` makes from an average.
 */
const BUCKET_BANDS: readonly RunIntensity[] = [
  "easy",
  "easy",
  "easy",
  "moderate",
  "hard",
  "hard"
];

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
  zones: readonly TrainingHubThresholdZone[],
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

    if (zoneSeconds && scored > 0) {
      const scale = duration > 0 ? duration / scored : 1;
      let leader: RunIntensity = "easy";
      let leaderSeconds = -1;
      const banded: Record<RunIntensity, number> = {
        easy: 0,
        moderate: 0,
        hard: 0
      };
      zoneSeconds.forEach((seconds, index) => {
        banded[BUCKET_BANDS[index] ?? "hard"] += seconds;
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

    const bucket = mix[runIntensity(activity.avgHr, zones) ?? "unrated"];
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
