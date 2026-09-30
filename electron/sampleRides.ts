/**
 * Sample outdoor rides, for working on the Cycling screen without riding.
 *
 * Switched on by `HERACLES_SAMPLE_RIDES=1` (`npm run dev:sample-rides`) and
 * reached from nowhere else, the way `HERACLES_SIMULATE_PLAN_AI` stands in for
 * a model. It stands in for COROS at the **renderer's** door only: `main.ts`
 * adds these rides to the activity list the window asks for and answers their
 * details, and nothing else in the main process ever sees them — not the
 * mirror, the detail cache, the summary sweep, Coach's tools or the analysis
 * watcher. So nothing is written to the account or to this machine, and turning
 * the flag off leaves no trace. Asking Coach about one reaches COROS with an id
 * it has never heard of, and says so.
 *
 * The roads are real (`sampleRideRoutes.ts`: OpenStreetMap through a bicycle
 * router, SRTM for the ground), and each ride is worked out a second at a time
 * from them: a rider holding a power target, a speed that is what that power
 * buys on that grade against air and rolling resistance, slower through tight
 * corners, coasting down the steep side, stopping at lights and for coffee with
 * the watch auto-pausing; heart rate chasing the effort with a lag and drifting
 * up over the hours; cadence dropping to nothing while coasting. Laps, zones,
 * load and the summary figures are then computed from those samples, so the
 * list row, the detail page and the chart cannot disagree. Seeded per ride, so
 * the figures are the same on every launch — only the dates move, to stay in
 * the last few weeks.
 */
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityLap,
  TrainingHubActivityPause,
  TrainingHubActivitySeriesPoint,
  TrainingHubTrackPoint
} from "./types";
import { summarizeActivityDetail } from "./activityMetrics";
import { simplifyRoute } from "./routeSimplification";
import {
  SAMPLE_ATHLETE,
  climbOf,
  decimate,
  decodePolyline,
  haversine,
  heartRateFigures,
  insideDayWindow,
  mean,
  seededRandom,
  wander
} from "./sampleActivityKit";
import { SAMPLE_RIDE_ROUTES, type SampleRideRouteKey } from "./sampleRideRoutes";

export function sampleRidesEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.HERACLES_SAMPLE_RIDES === "1";
}

const ID_PREFIX = "sample-ride-";

export function isSampleRideId(activityId: string | undefined): boolean {
  return typeof activityId === "string" && activityId.startsWith(ID_PREFIX);
}

// --------------------------------------------------------------- the rider --

/**
 * The FTP the plans' watts are written for. The rides are ridden at the
 * account's own FTP (`setSampleRiderFtp`) by scaling every watt by the ratio,
 * so the ride page's intensity and TSS — worked out against the profile —
 * land where a tempo ride's and a recovery spin's should. Speeds follow from
 * the physics, so a lower FTP is a slower rider, not a lighter one.
 */
const PLAN_FTP = 262;

let riderFtp = PLAN_FTP;

/** The athlete every sample activity shares, on a bike. */
const RIDER = {
  ...SAMPLE_ATHLETE,
  /** Rider, bike, bottles and kit. */
  systemMassKg: 78
} as const;

interface BikeSetup {
  sportType: number;
  sportName: string;
  crr: number;
  cdA: number;
  /** Fastest the rider lets it run downhill, km/h. */
  maxDescentKmh: number;
  /** Fastest down a steep mountain road, where every bend is a braking point. */
  steepDescentKmh: number;
  /** Corner speeds, km/h: a hairpin, and a bend. */
  hairpinKmh: number;
  bendKmh: number;
  powerMeter: boolean;
}

const ROAD: BikeSetup = {
  sportType: 200,
  sportName: "Bike",
  crr: 0.0045,
  // On the hoods in a club jersey, in traffic — not a time-trial tuck.
  cdA: 0.34,
  maxDescentKmh: 52,
  steepDescentKmh: 42,
  hairpinKmh: 22,
  bendKmh: 30,
  powerMeter: true
};

const GRAVEL: BikeSetup = {
  sportType: 203,
  sportName: "Gravel Road Bike",
  // Packed dirt and loose stone between the villages: several times a road's.
  crr: 0.022,
  cdA: 0.4,
  maxDescentKmh: 38,
  steepDescentKmh: 30,
  hairpinKmh: 16,
  bendKmh: 23,
  // The gravel bike has no meter: its rides carry no power, as most do.
  powerMeter: false
};

interface Stop {
  /** Kilometres into the ride. */
  atKm: number;
  /** Seconds the watch stays auto-paused. */
  seconds: number;
}

interface RidePlan {
  key: string;
  name: string;
  route: SampleRideRouteKey;
  /** Times round the route — a loop ridden more than once. */
  laps: number;
  bike: BikeSetup;
  daysAgo: number;
  /** Local clock time of the start, in hours. */
  startHour: number;
  /** Watts held on the flat and rolling. */
  steadyWatts: number;
  /** Watts held on a climb over 3%. */
  climbWatts: number;
  stops: Stop[];
  temperatureC: number;
  humidityPct: number;
}

/**
 * Five weeks of a rider's mornings around Hà Nội. Hanoi riders go out before
 * the heat, so everything starts between five and six.
 */
const PLANS: readonly RidePlan[] = [
  {
    key: "westlake-tempo",
    name: "West Lake tempo laps",
    route: "westLake",
    laps: 3,
    bike: ROAD,
    daysAgo: 1,
    startHour: 5.35,
    steadyWatts: 232,
    climbWatts: 250,
    stops: [
      { atKm: 6.1, seconds: 38 },
      { atKm: 18.6, seconds: 27 },
      { atKm: 31.2, seconds: 44 }
    ],
    temperatureC: 26,
    humidityPct: 83
  },
  {
    key: "tamdao",
    name: "Tam Đảo climb",
    route: "tamDao",
    laps: 1,
    bike: ROAD,
    daysAgo: 3,
    startHour: 5.1,
    steadyWatts: 195,
    climbWatts: 238,
    stops: [{ atKm: 13.05, seconds: 17 * 60 }],
    temperatureC: 23,
    humidityPct: 88
  },
  {
    key: "socson",
    name: "Sóc Sơn gravel",
    route: "socSon",
    laps: 2,
    bike: GRAVEL,
    daysAgo: 5,
    startHour: 5.75,
    steadyWatts: 182,
    climbWatts: 225,
    stops: [{ atKm: 21.8, seconds: 6 * 60 + 20 }],
    temperatureC: 27,
    humidityPct: 79
  },
  {
    key: "bavi",
    name: "Ba Vì long ride",
    route: "baVi",
    laps: 1,
    bike: ROAD,
    daysAgo: 8,
    startHour: 5.2,
    steadyWatts: 198,
    climbWatts: 232,
    stops: [
      { atKm: 11.4, seconds: 52 },
      { atKm: 26.1, seconds: 21 * 60 },
      { atKm: 40.8, seconds: 3 * 60 + 10 }
    ],
    temperatureC: 25,
    humidityPct: 86
  },
  {
    key: "westlake-recovery",
    name: "West Lake recovery spin",
    route: "westLake",
    laps: 2,
    bike: ROAD,
    daysAgo: 11,
    startHour: 5.6,
    steadyWatts: 148,
    climbWatts: 165,
    stops: [{ atKm: 9.3, seconds: 31 }],
    temperatureC: 27,
    humidityPct: 80
  },
  {
    key: "westlake-endurance",
    name: "West Lake endurance",
    route: "westLake",
    laps: 4,
    bike: ROAD,
    daysAgo: 15,
    startHour: 5.3,
    steadyWatts: 205,
    climbWatts: 220,
    stops: [
      { atKm: 12.6, seconds: 45 },
      { atKm: 25.1, seconds: 4 * 60 },
      { atKm: 43.9, seconds: 36 }
    ],
    temperatureC: 28,
    humidityPct: 76
  },
  {
    key: "socson-2",
    name: "Sóc Sơn lakes loop",
    route: "socSon",
    laps: 1,
    bike: GRAVEL,
    daysAgo: 19,
    startHour: 6.0,
    steadyWatts: 176,
    climbWatts: 215,
    stops: [],
    temperatureC: 28,
    humidityPct: 74
  },
  {
    key: "tamdao-2",
    name: "Tam Đảo, second go",
    route: "tamDao",
    laps: 1,
    bike: ROAD,
    daysAgo: 23,
    startHour: 5.0,
    steadyWatts: 190,
    climbWatts: 229,
    stops: [{ atKm: 13.05, seconds: 24 * 60 }],
    temperatureC: 24,
    humidityPct: 90
  }
];

/**
 * The weeks before those: two or three rides a week back to twelve weeks, so
 * the charts have a history to stand on and the load ratio a real baseline — a
 * month of riding out of nothing reads as a sharp jump. Weekday laps of the
 * lake and a weekend ride further out, as a Hanoi rider's week runs.
 */
function historyPlans(): RidePlan[] {
  const plans: RidePlan[] = [];
  const weekendRoutes = [
    { route: "baVi" as const, name: "Ba Vì long ride", bike: ROAD, laps: 1, stopKm: 26.1, stopSeconds: 19 * 60 },
    { route: "tamDao" as const, name: "Tam Đảo climb", bike: ROAD, laps: 1, stopKm: 13.05, stopSeconds: 15 * 60 },
    { route: "socSon" as const, name: "Sóc Sơn gravel", bike: GRAVEL, laps: 2, stopKm: 21.8, stopSeconds: 5 * 60 }
  ];
  for (let week = 3; week < 12; week += 1) {
    const base = week * 7 + 4;
    const random = seededRandom(`history-${week}`);
    // A lighter week every fourth, as a block is ridden.
    const easyWeek = week % 4 === 3;
    const lapsNames = ["West Lake laps", "West Lake endurance", "West Lake tempo laps"];
    const weekdayRides = easyWeek ? 1 : 2;
    for (let ride = 0; ride < weekdayRides; ride += 1) {
      const tempo = !easyWeek && ride === 1 && random() < 0.6;
      plans.push({
        key: `history-${week}-lake-${ride}`,
        name: tempo ? lapsNames[2]! : lapsNames[Math.floor(random() * 2)]!,
        route: "westLake",
        laps: 2 + Math.floor(random() * 2),
        bike: ROAD,
        daysAgo: base - 1 - ride * 2,
        startHour: 5.2 + random() * 0.6,
        steadyWatts: tempo ? 228 : easyWeek ? 160 : 190 + Math.round(random() * 15),
        climbWatts: tempo ? 245 : 210,
        stops: [{ atKm: 5 + random() * 8, seconds: 25 + Math.round(random() * 30) }],
        temperatureC: 27 + Math.round(random() * 4),
        humidityPct: 74 + Math.round(random() * 14)
      });
    }
    const weekend = weekendRoutes[week % weekendRoutes.length]!;
    plans.push({
      key: `history-${week}-weekend`,
      name: weekend.name,
      route: weekend.route,
      laps: easyWeek ? 1 : weekend.laps,
      bike: weekend.bike,
      daysAgo: base - 5,
      startHour: 5.0 + random() * 0.5,
      steadyWatts: easyWeek ? 170 : 192,
      climbWatts: easyWeek ? 215 : 232,
      stops: [{ atKm: weekend.stopKm, seconds: weekend.stopSeconds }],
      temperatureC: 25 + Math.round(random() * 5),
      humidityPct: 76 + Math.round(random() * 14)
    });
  }
  return plans;
}

// ------------------------------------------------------------------ maths --

/** A route as a function of distance: position, ground height, grade, bend. */
interface RouteModel {
  length: number;
  at(distance: number): { lat: number; lon: number; elevation: number };
  grade(distance: number): number;
  /** Degrees the road turns through over the next 30 m. */
  turn(distance: number): number;
}

function routeModel(key: SampleRideRouteKey): RouteModel {
  const source = SAMPLE_RIDE_ROUTES[key];
  const points = decodePolyline(source.polyline);
  const along = [0];
  for (let index = 1; index < points.length; index += 1) {
    along.push(along[index - 1]! + haversine(points[index - 1]!, points[index]!));
  }
  const length = along[along.length - 1]!;

  // SRTM reads the treetops and the rooftops, a few metres either way from one
  // cell to the next. A barometric altimeter reads smoother than that, so the
  // ground is averaged over 300 m before anything is taken from it.
  const raw = source.elevations;
  const smooth = raw.map((_, index) => {
    const window = raw.slice(Math.max(0, index - 1), index + 2);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
  const elevationAt = (distance: number) => {
    const position = Math.min(Math.max(distance, 0), length) / source.elevationStep;
    const low = Math.floor(position);
    const high = Math.min(low + 1, smooth.length - 1);
    const t = position - low;
    return (smooth[Math.min(low, smooth.length - 1)] ?? 0) * (1 - t) + (smooth[high] ?? 0) * t;
  };

  let cursor = 0;
  const locate = (distance: number) => {
    const target = Math.min(Math.max(distance, 0), length);
    if (along[cursor]! > target) cursor = 0;
    while (cursor < along.length - 2 && along[cursor + 1]! < target) cursor += 1;
    const span = along[cursor + 1]! - along[cursor]!;
    const t = span > 0 ? (target - along[cursor]!) / span : 0;
    const from = points[cursor]!;
    const to = points[cursor + 1] ?? from;
    return { lat: from[0] + (to[0] - from[0]) * t, lon: from[1] + (to[1] - from[1]) * t, index: cursor };
  };

  const headingAt = (distance: number) => {
    const a = locate(distance);
    const b = locate(Math.min(distance + 8, length));
    return (Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180) / Math.PI;
  };

  return {
    length,
    at: (distance) => {
      const point = locate(distance);
      return { lat: point.lat, lon: point.lon, elevation: elevationAt(distance) };
    },
    grade: (distance) => {
      const ahead = Math.min(distance + 60, length);
      const behind = Math.max(distance - 60, 0);
      return ahead > behind ? (elevationAt(ahead) - elevationAt(behind)) / (ahead - behind) : 0;
    },
    turn: (distance) => {
      if (distance + 30 >= length) return 0;
      let delta = Math.abs(headingAt(distance + 30) - headingAt(distance));
      if (delta > 180) delta = 360 - delta;
      return delta;
    }
  };
}

const AIR_DENSITY = 1.17;
const GRAVITY = 9.81;

/** The speed, m/s, that `watts` holds on a grade. Bisection: the curve is monotone. */
function steadySpeed(watts: number, grade: number, bike: BikeSetup): number {
  const theta = Math.atan(grade);
  const resist = RIDER.systemMassKg * GRAVITY * (bike.crr * Math.cos(theta) + Math.sin(theta));
  const drag = 0.5 * AIR_DENSITY * bike.cdA;
  let low = 0.3;
  let high = 30;
  for (let step = 0; step < 50; step += 1) {
    const mid = (low + high) / 2;
    if (resist * mid + drag * mid ** 3 > watts) high = mid;
    else low = mid;
  }
  return low;
}

// ------------------------------------------------------------- simulation --

interface SimulatedRide {
  activity: TrainingHubActivity;
  detail: TrainingHubActivityDetail;
  summary: ActivityDetailSummary;
}

function simulate(plan: RidePlan, startMs: number): SimulatedRide {
  const random = seededRandom(plan.key);
  const scale = riderFtp / PLAN_FTP;
  const route = routeModel(plan.route);
  const total = route.length * plan.laps;
  const bike = plan.bike;
  const powerWander = wander(random, 0.93, 0.07);
  const speedWander = wander(random, 0.98, 0.05);
  const cadenceWander = wander(random, 0.9, 2.5);
  const hrWander = wander(random, 0.95, 1.4);

  const series: TrainingHubActivitySeriesPoint[] = [];
  const track: TrainingHubTrackPoint[] = [];
  const pauses: TrainingHubActivityPause[] = [];
  const stops = [...plan.stops].sort((a, b) => a.atKm - b.atKm);

  let wall = 0;
  let moving = 0;
  let distance = 0;
  let speed = 0;
  let heartRate = RIDER.restingHr + 28;
  let effort = 0;
  let coastLeft = 0;
  let surgeLeft = 0;
  let lastTarget = 0;

  while (distance < total) {
    const onRoute = distance % route.length;
    const grade = route.grade(onRoute);
    const turn = route.turn(onRoute);
    const nextStop = stops[0];
    const toStop = nextStop ? nextStop.atKm * 1000 - distance : Number.POSITIVE_INFINITY;

    // What the rider is trying to do this second.
    // Climbing is held near the plan's figure — a little more where it kicks
    // up, never much: fifty minutes up Tam Đảo is not ridden over threshold.
    let watts =
      grade > 0.03
        ? plan.climbWatts + Math.min(20, (grade - 0.03) * 300)
        : grade < -0.025
          ? plan.steadyWatts * 0.25
          : plan.steadyWatts;
    watts *= (1 + powerWander()) * scale;

    // Out of the saddle away from a light or a hairpin: a few seconds well over
    // threshold, which is where a ride's peak power comes from.
    if (surgeLeft === 0 && coastLeft === 0 && lastTarget - speed > 2.5 && random() < 0.3) {
      surgeLeft = 5 + Math.floor(random() * 5);
    }
    if (surgeLeft > 0) {
      surgeLeft -= 1;
      watts = Math.min(780 * scale, watts * (1.75 + random() * 0.4));
    }

    let target = steadySpeed(Math.max(watts, 0), grade, bike) * (1 + speedWander());
    target = Math.min(target, (grade < -0.05 ? bike.steepDescentKmh : bike.maxDescentKmh) / 3.6);
    if (turn > 70) target = Math.min(target, bike.hairpinKmh / 3.6);
    else if (turn > 35) target = Math.min(target, bike.bendKmh / 3.6);
    if (toStop < 60) target = Math.min(target, Math.max(0, toStop / 12));
    lastTarget = target;

    // Coasting: long stretches down the steep side with a few turns of the
    // pedals between them, a few seconds into a corner, and up to a stop.
    const braking = target < speed - 0.8;
    if (coastLeft > 0) coastLeft -= 1;
    else if (grade < -0.035 && random() < 0.5) {
      coastLeft = 8 + Math.floor(random() * 30);
    } else if (braking && random() < 0.5) {
      coastLeft = 2 + Math.floor(random() * 6);
    }
    const coasting = coastLeft > 0 || toStop < 25;
    const reported = coasting ? 0 : Math.max(0, Math.round(watts + (random() - 0.5) * 30));

    speed += (target - speed) / (target > speed ? 7 : 2.5);
    speed = Math.max(speed, 0);

    // Heart rate chases a 30-second view of the effort, and drifts up with time.
    effort += (reported - effort) / 30;
    const intensity = effort / riderFtp;
    // Freewheeling down a mountain after climbing it does not bring the pulse
    // back to an easy spin's: the floor is where a descent's HR sits.
    const fraction = Math.min(0.99, Math.max(0.44, 0.245 + 0.6075 * intensity));
    const drift = (moving / 3600) * 3.2;
    const hrTarget = Math.min(
      RIDER.maxHr - 4,
      RIDER.restingHr + (RIDER.maxHr - RIDER.restingHr) * fraction + drift
    );
    heartRate += (hrTarget - heartRate) / (hrTarget > heartRate ? 30 : 60);

    const place = route.at(onRoute);
    const cadence =
      reported === 0
        ? 0
        : Math.round((surgeLeft > 0 ? 101 : grade > 0.05 ? 76 : 88) + cadenceWander());
    const point: TrainingHubActivitySeriesPoint = {
      elapsed: wall,
      distance: Math.round(distance * 10) / 10,
      hr: Math.round(heartRate + hrWander()),
      altitude: Math.round(place.elevation * 10) / 10,
      cadence,
      ...(speed > 1 ? { pace: Math.round((1000 / speed) * 10) / 10 } : {}),
      ...(bike.powerMeter ? { power: reported } : {})
    };
    series.push(point);
    track.push({
      lat: Math.round(place.lat * 1e6) / 1e6,
      lon: Math.round(place.lon * 1e6) / 1e6,
      elevation: point.altitude,
      distance: point.distance,
      elapsed: wall
    });

    distance += speed;
    wall += 1;
    moving += 1;

    // Stopped: the watch auto-pauses and records nothing until the wheels turn.
    if (nextStop && toStop <= 2 && speed < 1.5) {
      pauses.push({ start: wall, duration: nextStop.seconds });
      wall += nextStop.seconds;
      heartRate = Math.max(RIDER.restingHr + 30, heartRate - Math.min(nextStop.seconds / 6, 45));
      effort *= Math.exp(-nextStop.seconds / 60);
      speed = 0;
      stops.shift();
    }
  }

  return summarise(plan, startMs, series, track, pauses, scale);
}

// ---------------------------------------------------------------- figures --

const LAP_METERS = 5000;

function lapsOf(series: readonly TrainingHubActivitySeriesPoint[], powerMeter: boolean): TrainingHubActivityLap[] {
  const laps: TrainingHubActivityLap[] = [];
  let bucket: TrainingHubActivitySeriesPoint[] = [];
  const close = () => {
    if (bucket.length < 2) return;
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    const lapDistance = (last.distance ?? 0) - (first.distance ?? 0);
    const duration = bucket.length;
    const pedalled = bucket.map((point) => point.cadence ?? 0).filter((value) => value > 0);
    const { gain } = climbOf(bucket);
    laps.push({
      index: laps.length + 1,
      distance: Math.round(lapDistance),
      duration,
      avgHr: Math.round(mean(bucket.map((point) => point.hr ?? 0)) ?? 0),
      maxHr: Math.max(...bucket.map((point) => point.hr ?? 0)),
      pace: lapDistance > 0 ? duration / (lapDistance / 1000) : undefined,
      elevationGain: gain,
      avgCadence: Math.round(mean(pedalled) ?? 0),
      maxCadence: Math.max(0, ...pedalled),
      ...(powerMeter ? { avgPower: Math.round(mean(bucket.map((point) => point.power ?? 0)) ?? 0) } : {})
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
  plan: RidePlan,
  startMs: number,
  series: TrainingHubActivitySeriesPoint[],
  track: TrainingHubTrackPoint[],
  pauses: TrainingHubActivityPause[],
  scale: number
): SimulatedRide {
  const activityId = `${ID_PREFIX}${plan.key}`;
  const duration = series.length;
  const elapsedDuration = (series[series.length - 1]?.elapsed ?? 0) + 1;
  const distance = Math.round(series[series.length - 1]?.distance ?? 0);
  const hrs = series.map((point) => point.hr ?? 0);
  const avgHr = Math.round(mean(hrs) ?? 0);
  const maxHr = Math.max(...hrs);
  const { gain, loss } = climbOf(series);
  const powers = series.map((point) => point.power ?? 0);
  const pedalled = series.map((point) => point.cadence ?? 0).filter((value) => value > 0);

  // Banister's TRIMP, on the athlete's zones — see `heartRateFigures`.
  const { trainingLoad, aboveThreshold, hrZones } = heartRateFigures(hrs);

  // A ride's work in kilojoules is its calories near enough: the body turns
  // about a quarter of what it burns into the pedals, and a kcal is 4.18 kJ.
  const modelWork = series.reduce(
    (sum, point, index) =>
      sum + (point.power ?? (point.cadence ? plan.steadyWatts * scale : 0)) * (index === 0 ? 0 : 1),
    0
  );
  const calories = Math.round(modelWork / 1000);

  const startTime = Math.floor(startMs / 1000);
  const activity: TrainingHubActivity = {
    activityId,
    name: plan.name,
    sportType: plan.bike.sportType,
    sportName: plan.bike.sportName,
    startTime,
    endTime: startTime + elapsedDuration,
    duration,
    elapsedDuration,
    distance,
    avgHr,
    maxHr,
    calories,
    trainingLoad,
    elevationGain: gain
  };

  const detail: TrainingHubActivityDetail = {
    ...activity,
    elevationLoss: loss,
    pauses,
    laps: lapsOf(series, plan.bike.powerMeter),
    dynamics: {
      avgCadence: Math.round(mean(pedalled) ?? 0),
      maxCadence: Math.max(0, ...pedalled),
      ...(plan.bike.powerMeter
        ? {
            avgPower: Math.round(mean(powers) ?? 0),
            maxPower: Math.max(...powers)
          }
        : {})
    },
    hrZones,
    effect: {
      aerobic: Math.round(Math.min(5, 1 + 4 * (1 - Math.exp(-trainingLoad / 120))) * 10) / 10,
      anaerobic: Math.round(Math.min(5, 0.4 + aboveThreshold / 700) * 10) / 10
    },
    weather: {
      temperatureC: plan.temperatureC,
      feelsLikeC: plan.temperatureC + 3,
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
    fingerprint: "sample-ride",
    detail
  });

  return { activity, detail, summary };
}

// -------------------------------------------------------------- the door --

let simulated: Map<string, SimulatedRide> | null = null;

/**
 * Ride at this FTP from now on — the account's, read by `main.ts` before the
 * list goes out. Absent (signed out, or no FTP on the profile) keeps the one
 * the plans were written for. A change rebuilds the rides, so the list, the
 * pages and the summaries always come from the same rider.
 */
export function setSampleRiderFtp(ftp: number | undefined): void {
  const next = ftp !== undefined && Number.isFinite(ftp) && ftp > 0 ? Math.round(ftp) : PLAN_FTP;
  if (next !== riderFtp) {
    riderFtp = next;
    simulated = null;
  }
}

/** Every ride, built once per launch, dated back from the moment it is first asked for. */
function rides(): Map<string, SimulatedRide> {
  if (simulated) return simulated;
  const today = new Date();
  simulated = new Map();
  for (const plan of [...PLANS, ...historyPlans()]) {
    const start = new Date(today);
    start.setDate(start.getDate() - plan.daysAgo);
    start.setHours(Math.floor(plan.startHour), Math.round((plan.startHour % 1) * 60), 7, 0);
    const ride = simulate(plan, start.getTime());
    simulated.set(ride.activity.activityId, ride);
  }
  return simulated;
}

/**
 * The activity list the window asked for, with the sample rides in it: on the
 * first page only, so a paged read does not meet them twice, and only inside a
 * dated window when one was asked for. Newest first, as COROS sends the list.
 */
export function withSampleRides(
  activities: TrainingHubActivity[],
  request: { page: number; startDay?: string; endDay?: string }
): TrainingHubActivity[] {
  if (request.page !== 1) return activities;
  const added = [...rides().values()]
    .map((ride) => ride.activity)
    .filter((activity) => insideDayWindow(activity.startTime, request));
  return [...activities, ...added].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

export function sampleRideDetail(activityId: string): TrainingHubActivityDetail {
  const ride = rides().get(activityId);
  if (!ride) {
    throw new Error(`No sample ride ${activityId}.`);
  }
  return ride.detail;
}

/** The stored summaries the window asked for, with the sample rides' own. */
export function withSampleRideSummaries(
  activityIds: readonly string[],
  stored: ActivityDetailSummary[]
): ActivityDetailSummary[] {
  const added = activityIds.flatMap((id) => {
    const ride = isSampleRideId(id) ? rides().get(id) : undefined;
    return ride ? [ride.summary] : [];
  });
  return [...stored, ...added];
}
