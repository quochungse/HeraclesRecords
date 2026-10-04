/**
 * Sample trail runs, for working on Running's trail view — and screenshotting
 * it — without a season on the hills first.
 *
 * Switched on by `HERACLES_SAMPLE_TRAIL_RUNS=1` (`npm run dev:sample-trail-runs`)
 * and reached from nowhere else — the sample rides' and hikes' arrangement
 * exactly (see `sampleRides.ts`): `main.ts` adds these runs to the activity
 * list the window asks for and answers their details, and nothing else in the
 * main process ever sees them — not the mirror, the detail cache, the summary
 * sweep, Coach's tools or the analysis watcher. Turning the flag off leaves no
 * trace.
 *
 * The trails are the sample hikes' (`sampleHikeRoutes.ts`: OpenStreetMap
 * footpaths, SRTM for the ground), which are where Hà Nội goes to run trails:
 * Hàm Lợn most weeks, Ba Vì and Tam Đảo for the long days. A run is a list of
 * legs over one of them — a loop, the loop twice, its one runnable climb up
 * and down half a dozen times — each at its own effort, and it is run a second at
 * a time. Speed is what that effort buys on the grade under foot, by Minetti's
 * energy cost of running on a slope; steeper than the runner's threshold they
 * power-hike instead, at the cost of walking; the descents are capped by how
 * fast rough ground can be taken, and the climbs by how many metres an hour
 * the runner has. Heart rate follows the metabolic cost rather than the speed,
 * so it rises on the climbs and falls on the way down, drifts up over the hours
 * and runs a little high in the heat. Grade-adjusted pace is the same cost read
 * back as a flat speed. Cadence, stride, ground contact, oscillation and power
 * follow the speed and the gait. Laps, zones, load and the summary figures are
 * computed from those samples, so the list row, the page and the chart cannot
 * disagree. Seeded per run, so the figures hold across launches; only the
 * dates move, to stay recent.
 */
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityLap,
  TrainingHubActivityPause,
  TrainingHubActivitySeriesPoint,
  TrainingHubTrackPoint
} from "../../electron/types";
import { summarizeActivityDetail } from "../../electron/activityMetrics";
import { simplifyRoute } from "../../electron/routeSimplification";
import {
  SAMPLE_ATHLETE,
  climbOf,
  decimate,
  heartRateFigures,
  insideDayWindow,
  mean,
  routeModel,
  seededRandom,
  wander,
  type RouteModel
} from "../../electron/sampleActivityKit";
import { SAMPLE_RIDE_ROUTES } from "../../electron/sampleRideRoutes";
const LOOP = { ...SAMPLE_RIDE_ROUTES.westLake, summit: 20 };
type SampleHikeRouteKey = "westLake";

export function sampleTrailRunsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.HERACLES_SAMPLE_TRAIL_RUNS === "1";
}

const ID_PREFIX = "sample-road-";

export function isSampleRoadRunId(activityId: string | undefined): boolean {
  return typeof activityId === "string" && activityId.startsWith(ID_PREFIX);
}

// ------------------------------------------------------------- the runner --

/** The sample rides' and hikes' athlete, running. */
const RUNNER = {
  ...SAMPLE_ATHLETE,
  bodyKg: 70,
  /** ml/kg/min — the figure COROS would state for this athlete. */
  vo2max: 54
} as const;

/** Resting metabolic power, W/kg. */
const RESTING_W_PER_KG = 1.2;
/** The aerobic reserve an effort is a share of, W/kg: VO₂max at 20.1 J per ml, less rest. */
const RESERVE_W_PER_KG = (RUNNER.vo2max * 20.1) / 60 - RESTING_W_PER_KG;

type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAY_OFFSET: Record<Weekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6
};

type RunDate =
  /** The last weekday before today, so the current week always holds a run. */
  | { recent: true }
  /** A day of the Monday-to-Sunday week that ended last Sunday, or one before it. */
  | { weeksAgo: number; day: Weekday };

/** A point on the trail, as a leg names it. */
type Mark =
  | number
  | "start"
  | "end"
  /** The route's highest point. */
  | "summit"
  /** The foot and the top of the route's repeat climb (`repeatClimb`). */
  | "climbFoot"
  | "climbTop";

interface Leg {
  from: Mark;
  to: Mark;
  /** The share of the aerobic reserve the stretch is run at, on the flat. */
  effort: number;
  /** Seconds stood at its end — a bottle refilled, a photo at the top. */
  stopAfter?: number;
}

interface TrailRunPlan {
  key: string;
  name: string;
  route: SampleHikeRouteKey;
  daysAgo: number;
  /** Local clock time of the start, in hours — early, before the heat. */
  startHour: number;
  legs: Leg[];
  /** How well this runner holds their fitness on the day, against the season's best. */
  fitness: number;
  /** Steeper than this, the runner walks. A racer runs further up. */
  hikeFrom: number;
  /** The most metres an hour they climb at, sustained. */
  maxClimbRate: number;
  /** How fast the descents are taken, against a fell runner's 1. */
  descending: number;
  /**
   * Whether the watch pauses when they stop. Races and long days run with it
   * off; a session before work, often with it left on from the road.
   */
  autoPause: boolean;
  temperatureC: number;
  humidityPct: number;
}

const lap = (effort: number, summitStop?: number): Leg[] => [
  { from: "start", to: "summit", effort, ...(summitStop ? { stopAfter: summitStop } : {}) },
  { from: "summit", to: "end", effort: effort - 0.02 }
];

/** Warm up to the foot of the repeat climb, run it up hard and jog down, `reps` times, and home. */
const hillRepeats = (reps: number, effort: number): Leg[] => [
  { from: "start", to: "climbFoot", effort: 0.58 },
  ...Array.from({ length: reps }, (_, index): Leg[] => [
    { from: "climbFoot", to: "climbTop", effort, stopAfter: 15 },
    { from: "climbTop", to: "climbFoot", effort: 0.42, ...(index < reps - 1 ? { stopAfter: 40 } : {}) }
  ]).flat(),
  { from: "climbFoot", to: "start", effort: 0.55 }
];

/**
 * Three months of one runner's trail running out of Hà Nội: Hàm Lợn loops,
 * repeats on its steepest pitch before work, long days up Ba Vì and Tam Đảo,
 * and a 21K on Hàm Lợn run as a race two weeks back. The older the run,
 * the less fit.
 */


// ---------------------------------------------------------------- the course --

/**
 * Minetti's energy cost of running on a grade, J/kg/m (J Appl Physiol 2002):
 * 3.6 on the flat, about 9 up a 20% grade, least near a 20% descent.
 */
function runningCost(grade: number): number {
  const i = Math.min(0.45, Math.max(-0.45, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** The same for walking — cheaper than running once the grade passes about 15%. */
function walkingCost(grade: number): number {
  const i = Math.min(0.45, Math.max(-0.45, grade));
  return 280.5 * i ** 5 - 58.7 * i ** 4 - 76.8 * i ** 3 + 51.9 * i ** 2 + 19.6 * i + 2.5;
}

/** Rough ground costs more than a track at the same speed: roots, rock, wet clay. */
const TRAIL_ROUGHNESS = 1.0;

/**
 * The climb repeats are run on: the `length` metres of the way up that gain the
 * most while staying runnable, 7–16%. Hàm Lợn's steepest pitches are over 25%,
 * and a repeat there would be a hike.
 */
function repeatClimb(route: RouteModel, length = 500): { foot: number; top: number } {
  let best = { foot: 0, top: length, gain: Number.NEGATIVE_INFINITY };
  let steepest = best;
  for (let foot = 0; foot + length <= route.summitDistance; foot += 25) {
    const gain = route.at(foot + length).elevation - route.at(foot).elevation;
    const grade = gain / length;
    if (gain > steepest.gain) steepest = { foot, top: foot + length, gain };
    if (grade >= 0.07 && grade <= 0.16 && gain > best.gain) best = { foot, top: foot + length, gain };
  }
  const chosen = Number.isFinite(best.gain) ? best : steepest;
  return { foot: chosen.foot, top: chosen.top };
}

interface Course {
  length: number;
  at(distance: number): { lat: number; lon: number; elevation: number };
  grade(distance: number): number;
  /** Where each leg ends, metres along the course. */
  legEnds: number[];
}

/** Metres between the points a course is laid out at. */
const COURSE_STEP = 2;

/** The legs laid end to end, each one along the route or back down it. */
function buildCourse(plan: TrailRunPlan): Course {
  const route = routeModel(LOOP);
  const climb = repeatClimb(route);
  const resolve = (mark: Mark): number =>
    typeof mark === "number"
      ? mark
      : mark === "start"
        ? 0
        : mark === "end"
          ? route.length
          : mark === "summit"
            ? route.summitDistance
            : mark === "climbFoot"
              ? climb.foot
              : climb.top;

  const lat: number[] = [];
  const lon: number[] = [];
  const elevation: number[] = [];
  const legEnds: number[] = [];
  for (const leg of plan.legs) {
    const from = resolve(leg.from);
    const to = resolve(leg.to);
    const steps = Math.max(1, Math.ceil(Math.abs(to - from) / COURSE_STEP));
    for (let step = lat.length === 0 ? 0 : 1; step <= steps; step += 1) {
      const place = route.at(from + ((to - from) * step) / steps);
      lat.push(place.lat);
      lon.push(place.lon);
      elevation.push(place.elevation);
    }
    legEnds.push((lat.length - 1) * COURSE_STEP);
  }

  const length = (lat.length - 1) * COURSE_STEP;
  const sample = (values: readonly number[], distance: number) => {
    const position = Math.min(Math.max(distance, 0), length) / COURSE_STEP;
    const low = Math.floor(position);
    const high = Math.min(low + 1, values.length - 1);
    const t = position - low;
    return values[low]! * (1 - t) + values[high]! * t;
  };

  return {
    length,
    legEnds,
    at: (distance) => ({
      lat: sample(lat, distance),
      lon: sample(lon, distance),
      elevation: sample(elevation, distance)
    }),
    grade: (distance) => {
      const ahead = Math.min(distance + 60, length);
      const behind = Math.max(distance - 60, 0);
      return ahead > behind
        ? (sample(elevation, ahead) - sample(elevation, behind)) / (ahead - behind)
        : 0;
    }
  };
}

// ------------------------------------------------------------- simulation --

interface SimulatedRun {
  activity: TrainingHubActivity;
  detail: TrainingHubActivityDetail;
  summary: ActivityDetailSummary;
}

/** What one second of running adds up to, beyond the series point itself. */
interface Totals {
  /** Metres of flat running the same cost would have bought. */
  flatEquivalent: number;
  calories: number;
}

function simulate(plan: TrailRunPlan, startMs: number): SimulatedRun {
  const random = seededRandom(plan.key);
  const course = buildCourse(plan);
  const total = course.length;
  const mass = RUNNER.bodyKg;

  const speedWander = wander(random, 0.96, 0.05);
  const hrWander = wander(random, 0.95, 1.4);
  const cadenceWander = wander(random, 0.9, 1.8);
  const formWander = wander(random, 0.9, 0.04);
  // GPS under the trees: a fix that wanders a few metres either side of the
  // trail and keeps wandering while the runner stands.
  const northWander = wander(random, 0.985, 2.6);
  const eastWander = wander(random, 0.985, 2.6);

  const series: TrainingHubActivitySeriesPoint[] = [];
  const track: TrainingHubTrackPoint[] = [];
  const pauses: TrainingHubActivityPause[] = [];
  const totals: Totals = { flatEquivalent: 0, calories: 0 };

  let wall = 0;
  let movingSeconds = 0;
  let distance = 0;
  let speed = 0;
  let heartRate = RUNNER.restingHr + 30;
  let stopLeft = 0;
  let leg = 0;

  const hrrToBpm = (fraction: number) =>
    RUNNER.restingHr + (RUNNER.maxHr - RUNNER.restingHr) * Math.min(0.97, fraction);

  const record = (moving: boolean, grade: number, hiking: boolean) => {
    const place = course.at(Math.min(distance, total));
    const latitude = place.lat + northWander() / 111_320;
    const longitude = place.lon + eastWander() / (111_320 * Math.cos((place.lat * Math.PI) / 180));
    const altitude = Math.round(place.elevation * 10) / 10;
    const point: TrainingHubActivitySeriesPoint = {
      elapsed: wall,
      distance: Math.round(distance * 10) / 10,
      hr: Math.round(heartRate + hrWander()),
      altitude,
      cadence: 0
    };

    if (moving && speed > 0.3) {
      // A runner's cadence barely moves with speed and quickens on the way
      // down; a power-hike is a walker's.
      const cadence = hiking
        ? Math.min(128, Math.max(88, 96 + 16 * speed + cadenceWander()))
        : Math.min(192, Math.max(150, 158 + 5 * speed + 18 * Math.max(-grade, 0) + cadenceWander()));
      const stride = (60 * speed) / cadence;
      // Grade-adjusted pace: the flat speed the same cost would have bought,
      // held to three times the speed so a scramble does not read as a sprint.
      const flatFactor = Math.min(3, runningCost(grade) / runningCost(0));
      // A foot pod's power, running or hiking: the horizontal work, plus a
      // share of the lift on the way up and a smaller one of the fall on the
      // way down.
      const power = Math.max(
        mass * speed * 0.5,
        mass * speed * (1.02 + 9.81 * grade * (grade > 0 ? 0.95 : 0.35))
      );
      point.cadence = Math.round(cadence);
      point.pace = Math.round((1000 / speed) * 10) / 10;
      point.adjustedPace = Math.round((1000 / (speed * flatFactor)) * 10) / 10;
      point.power = Math.round(power * (1 + formWander()));
      point.strideLength = Math.round(stride * 100) / 100;
      if (!hiking) {
        const oscillation =
          Math.min(10, Math.max(4.8, 5.3 + 1.05 * speed - 6 * Math.max(grade, 0))) * (1 + formWander());
        point.groundTime = Math.round(
          Math.min(330, Math.max(200, 272 - 26 * (speed - 2.8) + 140 * Math.max(grade, 0)))
        );
        point.verticalOscillation = Math.round(oscillation * 10) / 10;
        point.verticalRatio = Math.round((oscillation / stride) * 10) / 10;
      }
    }

    series.push(point);
    track.push({
      lat: Math.round(latitude * 1e6) / 1e6,
      lon: Math.round(longitude * 1e6) / 1e6,
      elevation: altitude,
      distance: Math.round(distance * 10) / 10,
      elapsed: wall
    });
  };

  const beginStop = (seconds: number) => {
    speed = 0;
    if (plan.autoPause) {
      // Nothing is sampled while the watch is paused.
      pauses.push({ start: wall, duration: seconds });
      wall += seconds;
      heartRate = Math.max(RUNNER.restingHr + 25, heartRate - Math.min(seconds / 3, 50));
      totals.calories += (seconds * RESTING_W_PER_KG * 1.4 * mass) / 4184;
    } else {
      stopLeft = seconds;
    }
  };

  const heat = Math.max(0, plan.temperatureC - 20) * 0.004 + Math.max(0, plan.humidityPct - 80) * 0.0008;

  while (distance < total) {
    const grade = course.grade(distance);
    const hours = movingSeconds / 3600;

    if (stopLeft > 0) {
      // Standing: the pulse falls fast at first, and the watch keeps sampling
      // a position that barely moves.
      heartRate += (hrrToBpm(0.3 + 0.02 * hours + heat) - heartRate) / 30;
      record(false, grade, false);
      totals.calories += (RESTING_W_PER_KG * 1.4 * mass) / 4184;
      stopLeft -= 1;
      wall += 1;
      continue;
    }

    const current = plan.legs[leg]!;
    // Ten minutes to settle into the effort, a slow fade over the hours, and
    // a climb pushed a little harder than the flat.
    const warm = Math.min(1, 0.8 + (0.2 * movingSeconds) / 600);
    const push = 0.08 * Math.min(1, Math.max(grade, 0) / 0.2);
    const effort = current.effort * warm * (1 - 0.025 * hours) + push;
    const available = effort * RESERVE_W_PER_KG * plan.fitness;

    const hiking = grade > plan.hikeFrom;
    let target = hiking
      ? Math.min((0.92 * available) / (walkingCost(grade) * TRAIL_ROUGHNESS), 1.8)
      : available / (runningCost(grade) * TRAIL_ROUGHNESS);
    if (grade < -0.04) {
      // Rough ground is taken no faster than feet can be placed on it, and
      // steep rough ground slower again.
      target = Math.min(target, Math.max(1.6, plan.descending * (4.5 - 8 * Math.max(0, -grade - 0.05))));
    }
    if (grade > 0.04) {
      target = Math.min(target, plan.maxClimbRate / 3600 / grade);
    }
    target *= 1 + speedWander();
    speed += (target - speed) / 4;

    // Heart rate follows what the second actually cost, not what was meant.
    const cost = (hiking ? walkingCost(grade) : runningCost(grade)) * TRAIL_ROUGHNESS;
    const spent = Math.max(0.6, speed * cost);
    const fraction =
      0.08 +
      (0.88 * spent) / (RESERVE_W_PER_KG * plan.fitness) +
      0.022 * hours +
      heat;
    const hrTarget = hrrToBpm(fraction);
    heartRate += (hrTarget - heartRate) / (hrTarget > heartRate ? 22 : 32);

    record(true, grade, hiking);
    totals.flatEquivalent += speed * Math.min(3, runningCost(grade) / runningCost(0));
    totals.calories += ((spent + RESTING_W_PER_KG) * mass) / 4184;

    distance += speed;
    wall += 1;
    movingSeconds += 1;

    const end = course.legEnds[leg]!;
    if (distance >= end && leg < plan.legs.length - 1) {
      leg += 1;
      if (current.stopAfter) beginStop(current.stopAfter);
    } else if (random() < 1 / 4200) {
      // A shoelace, a photo, a wrong turn at a fork.
      beginStop(8 + Math.floor(random() * 22));
    }
  }

  return summarise(plan, startMs, series, track, pauses, totals);
}

// ---------------------------------------------------------------- figures --

/** COROS's default auto-lap on foot. */
const LAP_METERS = 1000;

function average(points: readonly TrainingHubActivitySeriesPoint[], pick: (point: TrainingHubActivitySeriesPoint) => number | undefined): number | undefined {
  const values = points.flatMap((point) => {
    const value = pick(point);
    return value !== undefined && value > 0 ? [value] : [];
  });
  return mean(values);
}

function rounded(value: number | undefined, digits = 0): number | undefined {
  if (value === undefined) return undefined;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function lapsOf(series: readonly TrainingHubActivitySeriesPoint[]): TrainingHubActivityLap[] {
  const laps: TrainingHubActivityLap[] = [];
  let bucket: TrainingHubActivitySeriesPoint[] = [];
  const close = () => {
    if (bucket.length < 2) return;
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    const lapDistance = (last.distance ?? 0) - (first.distance ?? 0);
    const duration = bucket.length;
    const cadences = bucket.map((point) => point.cadence ?? 0).filter((value) => value > 0);
    laps.push({
      index: laps.length + 1,
      distance: Math.round(lapDistance),
      duration,
      avgHr: Math.round(mean(bucket.map((point) => point.hr ?? 0)) ?? 0),
      maxHr: Math.max(...bucket.map((point) => point.hr ?? 0)),
      pace: lapDistance > 0 ? duration / (lapDistance / 1000) : undefined,
      elevationGain: climbOf(bucket).gain,
      avgCadence: Math.round(mean(cadences) ?? 0),
      maxCadence: Math.max(0, ...cadences),
      strideLength: rounded(average(bucket, (point) => point.strideLength), 2),
      groundTime: rounded(average(bucket, (point) => point.groundTime)),
      verticalOscillation: rounded(average(bucket, (point) => point.verticalOscillation), 1),
      verticalRatio: rounded(average(bucket, (point) => point.verticalRatio), 1),
      avgPower: rounded(average(bucket, (point) => point.power))
    });
  };
  for (const point of series) {
    const index = Math.floor((point.distance ?? 0) / LAP_METERS);
    if (bucket.length > 0 && index !== Math.floor((bucket[0]!.distance ?? 0) / LAP_METERS)) {
      close();
      bucket = [];
    }
    bucket.push(point);
  }
  close();
  return laps;
}

function summarise(
  plan: TrailRunPlan,
  startMs: number,
  series: TrainingHubActivitySeriesPoint[],
  track: TrainingHubTrackPoint[],
  pauses: TrainingHubActivityPause[],
  totals: Totals
): SimulatedRun {
  const activityId = `${ID_PREFIX}${plan.key}`;
  const duration = series.length;
  const elapsedDuration = (series[series.length - 1]?.elapsed ?? 0) + 1;
  const distance = Math.round(series[series.length - 1]?.distance ?? 0);
  const hrs = series.map((point) => point.hr ?? 0);
  const avgHr = Math.round(mean(hrs) ?? 0);
  const maxHr = Math.max(...hrs);
  const { gain, loss } = climbOf(series);
  const cadences = series.map((point) => point.cadence ?? 0).filter((value) => value > 0);
  const { trainingLoad, aboveThreshold, hrZones } = heartRateFigures(hrs);
  const max = (pick: (point: TrainingHubActivitySeriesPoint) => number | undefined) =>
    Math.max(0, ...series.map((point) => pick(point) ?? 0));

  const startTime = Math.floor(startMs / 1000);
  const activity: TrainingHubActivity = {
    activityId,
    name: plan.name,
    sportType: 100,
    sportName: "Run",
    startTime,
    endTime: startTime + elapsedDuration,
    duration,
    elapsedDuration,
    distance,
    avgHr,
    maxHr,
    calories: Math.round(totals.calories),
    trainingLoad,
    elevationGain: gain
  };

  const detail: TrainingHubActivityDetail = {
    ...activity,
    elevationLoss: loss,
    // Over the activity time, as the pace beside it is.
    ...(totals.flatEquivalent > 0
      ? { adjustedPace: Math.round(duration / (totals.flatEquivalent / 1000)) }
      : {}),
    pauses,
    laps: lapsOf(series),
    dynamics: {
      avgCadence: Math.round(mean(cadences) ?? 0),
      maxCadence: Math.max(0, ...cadences),
      strideLength: rounded(average(series, (point) => point.strideLength), 2),
      maxStrideLength: rounded(max((point) => point.strideLength), 2),
      groundTime: rounded(average(series, (point) => point.groundTime)),
      maxGroundTime: max((point) => point.groundTime),
      verticalOscillation: rounded(average(series, (point) => point.verticalOscillation), 1),
      maxVerticalOscillation: max((point) => point.verticalOscillation),
      verticalRatio: rounded(average(series, (point) => point.verticalRatio), 1),
      maxVerticalRatio: max((point) => point.verticalRatio),
      avgPower: rounded(average(series, (point) => point.power)),
      maxPower: max((point) => point.power)
    },
    hrZones,
    effect: {
      aerobic: Math.round(Math.min(5, 1 + 4 * (1 - Math.exp(-trainingLoad / 150))) * 10) / 10,
      anaerobic: Math.round(Math.min(5, 0.1 + aboveThreshold / 900) * 10) / 10,
      vo2max: RUNNER.vo2max
    },
    weather: {
      temperatureC: plan.temperatureC,
      feelsLikeC: plan.temperatureC + (plan.temperatureC > 24 ? 3 : -1),
      humidityPct: plan.humidityPct
    },
    track: {
      points: decimate(track.map(({ elapsed: _clock, ...point }) => point), 400),
      ...(() => {
        const route = simplifyRoute(track);
        return route ? { route } : {};
      })()
    },
    series
  };

  const summary = summarizeActivityDetail({
    activityId,
    fingerprint: "sample-road-run",
    detail
  });

  return { activity, detail, summary };
}

// -------------------------------------------------------------- the door --

/** Local midnight of the day a plan was run on, counted back from `now`. */
function planDay(when: RunDate, now: Date): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if ("recent" in when) {
    do {
      day.setDate(day.getDate() - 1);
    } while (day.getDay() === 0 || day.getDay() === 6);
    return day;
  }
  // Back to the Monday of the week that ended on the last Sunday before today.
  const sinceMonday = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - sinceMonday - 7 * (when.weeksAgo + 1) + DAY_OFFSET[when.day]);
  return day;
}

let simulated: Map<string, SimulatedRun> | null = null;

/** Every run, simulated once per launch, dated back from the moment it is first asked for. */
function runs(): Map<string, SimulatedRun> {
  if (simulated) return simulated;
  const now = new Date();
  simulated = new Map();
  for (const plan of roadPlans()) {
    const start = new Date(now); start.setDate(start.getDate() - plan.daysAgo);
    start.setHours(Math.floor(plan.startHour), Math.round((plan.startHour % 1) * 60), 7, 0);
    const run = simulate(plan, start.getTime());
    simulated.set(run.activity.activityId, run);
  }
  return simulated;
}

/**
 * The activity list the window asked for, with the sample trail runs in it: on
 * the first page only, and only inside a dated window when one was asked for.
 * Newest first, as COROS sends the list.
 */
export function withSampleRoadRuns(
  activities: TrainingHubActivity[],
  request: { page: number; startDay?: string; endDay?: string }
): TrainingHubActivity[] {
  if (request.page !== 1) return activities;
  const added = [...runs().values()]
    .map((run) => run.activity)
    .filter((activity) => insideDayWindow(activity.startTime, request));
  return [...activities, ...added].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

export function sampleRoadRunDetail(activityId: string): TrainingHubActivityDetail {
  const run = runs().get(activityId);
  if (!run) {
    throw new Error(`No sample road run ${activityId}.`);
  }
  return run.detail;
}

/** The stored summaries the window asked for, with the sample trail runs' own. */
export function withSampleRoadRunSummaries(
  activityIds: readonly string[],
  stored: ActivityDetailSummary[]
): ActivityDetailSummary[] {
  const added = activityIds.flatMap((id) => {
    const run = isSampleRoadRunId(id) ? runs().get(id) : undefined;
    return run ? [run.summary] : [];
  });
  return [...stored, ...added];
}

// ------------------------------------------------------------ road plans --

const LOOP_LENGTH = (() => { const m = routeModel(LOOP); return m.length; })();

/** Consecutive stretches laid along the West Lake loop, wrapping at its start. */
function stretches(parts: ReadonlyArray<[meters: number, effort: number]>): Leg[] {
  const legs: Leg[] = [];
  let at = 0;
  for (const [meters, effort] of parts) {
    let left = meters;
    while (left > 0) {
      const room = LOOP_LENGTH - at;
      const take = Math.min(left, room);
      legs.push({ from: at, to: at + take, effort });
      at += take;
      left -= take;
      if (at >= LOOP_LENGTH - 0.5) at = 0;
    }
  }
  return legs;
}

function roadPlans(): TrailRunPlan[] {
  const plans: TrailRunPlan[] = [];
  const base = { route: "westLake" as const, hikeFrom: 1, maxClimbRate: 2000, descending: 1.4 };
  // Today is a Saturday in the screenshots; days back from it.
  for (let week = 0; week < 12; week += 1) {
    const random = seededRandom("road-week-" + week);
    const fitness = 1 - week * 0.0065;
    const off = week * 7;
    const recovery = week % 4 === 3;
    const workout = week % 2 === 0
      ? { name: "6 × 1 km intervals", legs: stretches([[2400, 0.56], ...Array.from({ length: 6 }, (_, i): [number, number][] => [[1000, 0.885], ...(i < 5 ? [[400, 0.47] as [number, number]] : [])]).flat(), [2000, 0.52]]) }
      : { name: "Tempo run", legs: stretches([[2000, 0.56], [7000, 0.8], [1500, 0.52]]) };
    if (!recovery) {
      plans.push({ ...base, key: "w" + week + "-workout", name: workout.name, daysAgo: off + 4, startHour: 5.3 + random() * 0.4, legs: workout.legs, fitness, autoPause: false, temperatureC: 24, humidityPct: 80 });
    }
    plans.push({ ...base, key: "w" + week + "-easy", name: week === 0 ? "Easy run" : random() < 0.5 ? "Easy run" : "Recovery run", daysAgo: off + 2, startHour: 5.4 + random() * 0.5, legs: stretches([[7000 + Math.round(random() * 3) * 1000, 0.58]]), fitness, autoPause: true, temperatureC: 28, humidityPct: 80 });
    if (week === 3) {
      plans.push({ ...base, key: "w3-race", name: "Hanoi Half Marathon", daysAgo: off + 6, startHour: 5.0, legs: stretches([[21100, 0.835]]), fitness, autoPause: false, temperatureC: 24, humidityPct: 85 });
    } else if (week % 2 === 1 || week === 0) {
      const km = recovery ? 14 : 16 + Math.min(8, (12 - week) % 5) * 1;
      plans.push({ ...base, key: "w" + week + "-long", name: "Long run", daysAgo: off + 6, startHour: 5.0, legs: stretches([[km * 1000, 0.6]]), fitness, autoPause: false, temperatureC: 26, humidityPct: 84 });
    }
    if (false) {
      plans.push({ ...base, key: "w" + week + "-steady", name: "Steady run", daysAgo: off + 3, startHour: 17.6, legs: stretches([[8000 + Math.round(random() * 2) * 1000, 0.66]]), fitness, autoPause: true, temperatureC: 30, humidityPct: 72 });
    }
  }
  return plans.filter((plan) => plan.daysAgo > 0);
}
