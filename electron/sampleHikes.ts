/**
 * Sample hikes, for working on the Hiking screen without walking up a
 * mountain.
 *
 * Switched on by `HERACLES_SAMPLE_HIKES=1` (`npm run dev:sample-hikes`) and
 * reached from nowhere else — the sample rides' arrangement exactly (see
 * `sampleRides.ts`): `main.ts` adds these hikes to the activity list the window
 * asks for and answers their details, and nothing else in the main process ever
 * sees them — not the mirror, the detail cache, the summary sweep, Coach's tools
 * or the analysis watcher. Turning the flag off leaves no trace.
 *
 * The trails are real (`sampleHikeRoutes.ts`: OpenStreetMap footpaths through a
 * hiking router, SRTM for the ground) and each hike is walked a second at a
 * time along them. Speed is Tobler's hiking function — fastest on a gentle
 * descent, slowing either side — scaled for how rough the trail is and capped
 * by how many metres an hour the walker can climb; the steep way down is taken
 * carefully. The walker stops: for a breather on a steep pitch, for a photo,
 * for lunch at the camp and at the top. COROS's hike mode leaves auto-pause
 * off, so on most of these the watch keeps recording through every stop — the
 * list's time is the whole day, and the moving time is the page's to find; one
 * walker has it on. Heart rate follows the climbing rate rather than the speed,
 * rises with altitude and drifts up over the hours; cadence shortens on the
 * climbs; GPS wanders a few metres under the trees. Laps, zones, load and the
 * summary figures are computed from those samples, so the list row, the detail
 * page and the chart cannot disagree. Seeded per hike, so the figures are the
 * same on every launch — only the dates move, to stay on recent weekends.
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
  heartRateFigures,
  insideDayWindow,
  mean,
  routeModel,
  seededRandom,
  wander,
  type RouteModel
} from "./sampleActivityKit";
import { SAMPLE_HIKE_ROUTES, type SampleHikeRouteKey } from "./sampleHikeRoutes";

export function sampleHikesEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.HERACLES_SAMPLE_HIKES === "1";
}

const ID_PREFIX = "sample-hike-";

export function isSampleHikeId(activityId: string | undefined): boolean {
  return typeof activityId === "string" && activityId.startsWith(ID_PREFIX);
}

// ------------------------------------------------------------- the walker --

/** The sample rides' athlete, on foot. */
const WALKER = {
  ...SAMPLE_ATHLETE,
  bodyKg: 70
} as const;

type HikeKind = "hike" | "mountain";

const SPORT: Record<HikeKind, { sportType: number; sportName: string }> = {
  hike: { sportType: 104, sportName: "Hike" },
  mountain: { sportType: 105, sportName: "Mountain Climb" }
};

/** Where on the trail a stop is made. */
type RestPlace =
  | { atKm: number }
  /** The first time the trail reaches this height — a camp, a col. */
  | { atElevation: number }
  /** The highest point of the route. */
  | { atSummit: true };

type Rest = RestPlace & { seconds: number };

type HikeDate =
  /** The last weekday before today: an early start before work. */
  | { weekday: true }
  /** A Saturday or Sunday, this many weekends back from the last one. */
  | { weekendsAgo: number; day: "sat" | "sun" };

interface HikePlan {
  key: string;
  name: string;
  route: SampleHikeRouteKey;
  kind: HikeKind;
  when: HikeDate;
  /** Local clock time of the start, in hours. */
  startHour: number;
  /** Walking speed against Tobler's hiker, who is a fit one. */
  fitness: number;
  /**
   * How much the trail slows a walker beyond its grade — roots, loose rock,
   * wet clay, the ladders near the top of Fansipan. 1 is a good path.
   */
  terrain: number;
  /** The most metres an hour this walker climbs at, sustained. */
  maxClimbRate: number;
  rests: Rest[];
  /**
   * Whether the watch pauses when they stop. COROS's hike mode ships with it
   * off, and most walkers never touch it.
   */
  autoPause: boolean;
  /** Kilograms on the back. */
  packKg: number;
  temperatureC: number;
  humidityPct: number;
}

/**
 * Three months of an athlete's hiking out of Hà Nội: Hàm Lợn most weekends
 * (the forest hill an hour north that the city walks up), Tam Đảo and Ba Vì
 * when there is a whole day, and two trips north-west — Fansipan up the Trạm
 * Tôn trail, down by cable car, and the summit day of Pu Ta Leng from its high
 * camp. Each gets a little fitter than the one before.
 */
const PLANS: readonly HikePlan[] = [
  {
    key: "hamlon-sunrise",
    name: "Hàm Lợn at sunrise",
    route: "hamLon",
    kind: "hike",
    when: { weekday: true },
    startHour: 5.05,
    fitness: 1.12,
    terrain: 0.96,
    maxClimbRate: 720,
    rests: [{ atSummit: true, seconds: 9 * 60 }],
    autoPause: false,
    packKg: 2,
    temperatureC: 24,
    humidityPct: 91
  },
  {
    key: "tamdao-rungrinh",
    name: "Rùng Rình peak, Tam Đảo",
    route: "tamDao",
    kind: "hike",
    when: { weekendsAgo: 0, day: "sun" },
    startHour: 6.6,
    fitness: 1.1,
    terrain: 0.9,
    maxClimbRate: 660,
    rests: [
      { atKm: 3.1, seconds: 4 * 60 + 30 },
      { atSummit: true, seconds: 18 * 60 },
      { atKm: 10.2, seconds: 3 * 60 }
    ],
    autoPause: false,
    packKg: 4,
    temperatureC: 21,
    humidityPct: 93
  },
  {
    key: "fansipan-tramton",
    name: "Fansipan via Trạm Tôn",
    route: "fansipan",
    kind: "mountain",
    when: { weekendsAgo: 1, day: "sat" },
    startHour: 6.2,
    fitness: 1.1,
    terrain: 0.8,
    maxClimbRate: 560,
    rests: [
      { atElevation: 2200, seconds: 7 * 60 },
      { atElevation: 2800, seconds: 24 * 60 },
      // The summit, photos at the marker; then the watch stops and the cable
      // car takes them down.
      { atSummit: true, seconds: 11 * 60 }
    ],
    autoPause: false,
    packKg: 6,
    temperatureC: 15,
    humidityPct: 95
  },
  {
    key: "hamlon-2",
    name: "Hàm Lợn loop",
    route: "hamLon",
    kind: "hike",
    when: { weekendsAgo: 2, day: "sun" },
    startHour: 6.0,
    fitness: 1.09,
    terrain: 0.96,
    maxClimbRate: 700,
    rests: [{ atSummit: true, seconds: 14 * 60 }],
    autoPause: false,
    packKg: 3,
    temperatureC: 27,
    humidityPct: 84
  },
  {
    key: "bavi-denthuong",
    name: "Ba Vì to Đền Thượng",
    route: "baVi",
    kind: "hike",
    when: { weekendsAgo: 3, day: "sat" },
    startHour: 6.4,
    fitness: 1.08,
    terrain: 0.97,
    maxClimbRate: 650,
    rests: [
      { atElevation: 1050, seconds: 6 * 60 },
      { atSummit: true, seconds: 26 * 60 }
    ],
    // The one walker who switched auto-pause on: the stops are in the pauses,
    // not the samples, and the list's time is already the moving time.
    autoPause: true,
    packKg: 4,
    temperatureC: 24,
    humidityPct: 88
  },
  {
    key: "hamlon-3",
    name: "Hàm Lợn loop",
    route: "hamLon",
    kind: "hike",
    when: { weekendsAgo: 4, day: "sat" },
    startHour: 5.75,
    fitness: 1.07,
    terrain: 0.96,
    maxClimbRate: 680,
    rests: [{ atSummit: true, seconds: 11 * 60 }],
    autoPause: false,
    packKg: 3,
    temperatureC: 28,
    humidityPct: 82
  },
  {
    key: "putaleng-summit",
    name: "Pu Ta Leng summit day",
    route: "puTaLeng",
    kind: "mountain",
    when: { weekendsAgo: 5, day: "sun" },
    // Out of the tent in the dark, for the sunrise over the clouds.
    startHour: 4.4,
    fitness: 1.06,
    terrain: 0.78,
    maxClimbRate: 520,
    rests: [
      { atKm: 2.3, seconds: 5 * 60 },
      { atSummit: true, seconds: 41 * 60 }
    ],
    autoPause: false,
    packKg: 4,
    temperatureC: 8,
    humidityPct: 97
  },
  {
    key: "tamdao-2",
    name: "Rùng Rình peak, Tam Đảo",
    route: "tamDao",
    kind: "hike",
    when: { weekendsAgo: 6, day: "sat" },
    startHour: 6.8,
    fitness: 1.05,
    terrain: 0.9,
    maxClimbRate: 620,
    rests: [{ atSummit: true, seconds: 21 * 60 }],
    autoPause: false,
    packKg: 4,
    temperatureC: 22,
    humidityPct: 90
  },
  {
    key: "hamlon-4",
    name: "Hàm Lợn loop",
    route: "hamLon",
    kind: "hike",
    when: { weekendsAgo: 7, day: "sun" },
    startHour: 6.2,
    fitness: 1.04,
    terrain: 0.96,
    maxClimbRate: 640,
    rests: [
      { atKm: 2.6, seconds: 3 * 60 },
      { atSummit: true, seconds: 16 * 60 }
    ],
    autoPause: false,
    packKg: 3,
    temperatureC: 30,
    humidityPct: 78
  },
  {
    key: "bavi-2",
    name: "Ba Vì to Đền Thượng",
    route: "baVi",
    kind: "hike",
    when: { weekendsAgo: 8, day: "sun" },
    startHour: 6.1,
    fitness: 1.03,
    terrain: 0.97,
    maxClimbRate: 600,
    rests: [
      { atElevation: 1050, seconds: 8 * 60 },
      { atSummit: true, seconds: 30 * 60 }
    ],
    autoPause: true,
    packKg: 4,
    temperatureC: 26,
    humidityPct: 86
  },
  {
    key: "hamlon-5",
    name: "Hàm Lợn loop",
    route: "hamLon",
    kind: "hike",
    when: { weekendsAgo: 9, day: "sat" },
    startHour: 6.0,
    fitness: 1.02,
    terrain: 0.96,
    maxClimbRate: 610,
    rests: [{ atSummit: true, seconds: 13 * 60 }],
    autoPause: false,
    packKg: 3,
    temperatureC: 31,
    humidityPct: 76
  },
  {
    key: "tamdao-3",
    name: "Rùng Rình peak, Tam Đảo",
    route: "tamDao",
    kind: "hike",
    when: { weekendsAgo: 10, day: "sun" },
    startHour: 7.0,
    fitness: 1.01,
    terrain: 0.9,
    maxClimbRate: 590,
    rests: [
      { atKm: 3.1, seconds: 6 * 60 },
      { atSummit: true, seconds: 22 * 60 }
    ],
    autoPause: false,
    packKg: 5,
    temperatureC: 23,
    humidityPct: 89
  },
  {
    key: "hamlon-6",
    name: "Hàm Lợn loop",
    route: "hamLon",
    kind: "hike",
    when: { weekendsAgo: 11, day: "sat" },
    startHour: 6.3,
    fitness: 1.0,
    terrain: 0.96,
    maxClimbRate: 580,
    rests: [
      { atKm: 2.6, seconds: 4 * 60 },
      { atSummit: true, seconds: 15 * 60 }
    ],
    autoPause: false,
    packKg: 3,
    temperatureC: 32,
    humidityPct: 74
  }
];

// --------------------------------------------------------------- the trail --

/** The trail, as the kit reads it for the trail runs too. */
type TrailModel = RouteModel;

function trailModel(key: SampleHikeRouteKey): TrailModel {
  return routeModel(SAMPLE_HIKE_ROUTES[key]);
}

/**
 * Tobler's hiking function, km/h: 6 on a 5% descent, 5 on the flat, 2.5 up a
 * 20% grade — the rate a fit walker holds on a good path.
 */
function toblerKmh(grade: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(grade + 0.05));
}

// ------------------------------------------------------------- simulation --

interface SimulatedHike {
  activity: TrainingHubActivity;
  detail: TrainingHubActivityDetail;
  summary: ActivityDetailSummary;
}

interface Stop {
  /** Metres along the trail. */
  at: number;
  seconds: number;
}

function resolveRests(plan: HikePlan, trail: TrailModel): Stop[] {
  return plan.rests
    .flatMap((rest): Stop[] => {
      const at =
        "atKm" in rest
          ? rest.atKm * 1000
          : "atElevation" in rest
            ? trail.distanceAtElevation(rest.atElevation)
            : trail.summitDistance;
      return at === undefined ? [] : [{ at: Math.min(at, trail.length - 1), seconds: rest.seconds }];
    })
    .sort((left, right) => left.at - right.at);
}

function simulate(plan: HikePlan, startMs: number): SimulatedHike {
  const random = seededRandom(plan.key);
  const trail = trailModel(plan.route);
  const total = trail.length;
  const rests = resolveRests(plan, trail);
  const massKg = WALKER.bodyKg + plan.packKg;

  const speedWander = wander(random, 0.97, 0.08);
  const hrWander = wander(random, 0.95, 1.5);
  const cadenceWander = wander(random, 0.9, 2.5);
  // GPS under the trees: a fix that wanders a few metres either side of the
  // trail and keeps wandering while the walker stands still.
  const northWander = wander(random, 0.985, 2.8);
  const eastWander = wander(random, 0.985, 2.8);

  const series: TrainingHubActivitySeriesPoint[] = [];
  const track: TrainingHubTrackPoint[] = [];
  const pauses: TrainingHubActivityPause[] = [];

  let wall = 0;
  let movingSeconds = 0;
  let distance = 0;
  let speed = 0;
  let heartRate = WALKER.restingHr + 24;
  let stopLeft = 0;
  let calories = 0;

  const hrrToBpm = (fraction: number) =>
    WALKER.restingHr + (WALKER.maxHr - WALKER.restingHr) * Math.min(0.96, fraction);

  const record = (moving: boolean, grade: number) => {
    const place = trail.at(Math.min(distance, total));
    const north = northWander();
    const east = eastWander();
    const latitude = place.lat + north / 111_320;
    const longitude = place.lon + east / (111_320 * Math.cos((place.lat * Math.PI) / 180));
    // A step is shorter the slower the walk — 0.77 m at 5 km/h, a third of a
    // metre crawling up a steep pitch — and shorter again on the way down.
    const step =
      Math.min(0.85, Math.max(0.3, 0.14 + 0.125 * speed * 3.6)) *
      (1 - 0.8 * Math.max(-grade, 0));
    const cadence = moving
      ? Math.round(Math.min(128, Math.max(48, (60 * speed) / step + cadenceWander())))
      : 0;
    const altitude = Math.round(place.elevation * 10) / 10;
    series.push({
      elapsed: wall,
      distance: Math.round(distance * 10) / 10,
      hr: Math.round(heartRate + hrWander()),
      altitude,
      cadence,
      ...(moving && speed > 0.1 ? { pace: Math.round((1000 / speed) * 10) / 10 } : {})
    });
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
      // The watch stops recording a few seconds after the walker does and
      // starts again with the first steps: nothing is sampled in between.
      pauses.push({ start: wall, duration: seconds });
      wall += seconds;
      heartRate = Math.max(WALKER.restingHr + 18, heartRate - Math.min(seconds / 4, 55));
      calories += (seconds / 60) * 1.3;
    } else {
      stopLeft = seconds;
    }
  };

  while (distance < total) {
    const grade = trail.grade(distance);
    const hours = movingSeconds / 3600;

    if (stopLeft > 0) {
      // Standing: the pulse falls back towards a resting walker's, fast at
      // first, and the watch keeps sampling a position that barely moves.
      const restTarget = hrrToBpm(0.14 + 0.01 * hours);
      heartRate += (restTarget - heartRate) / 40;
      record(false, grade);
      calories += 1.3 / 60;
      stopLeft -= 1;
      wall += 1;
      continue;
    }

    // Tobler's walker on this trail, getting slower over a long day.
    let kmh =
      toblerKmh(grade) *
      plan.fitness *
      plan.terrain *
      (1 - 0.025 * hours) *
      (1 + speedWander());
    // The steep way down is picked through rather than walked: knees, poles,
    // one foot placed at a time.
    if (grade < -0.15) kmh *= 0.82;
    // Up a steep pitch it is the lungs that set the pace, not the legs.
    if (grade > 0.02) kmh = Math.min(kmh, plan.maxClimbRate / (1000 * grade));
    kmh = Math.max(kmh, 1.2);
    speed += (kmh / 3.6 - speed) / 3;

    // Heart rate follows the climbing rate far more than the speed, and the
    // thinner air above 1,500 m adds to it.
    const altitude = trail.at(distance).elevation;
    const upRate = speed * 3600 * Math.max(grade, 0);
    const downRate = speed * 3600 * Math.max(-grade, 0);
    const fraction =
      0.2 +
      0.042 * speed * 3.6 +
      0.00088 * upRate +
      0.00012 * downRate +
      0.00004 * Math.max(0, altitude - 1500) +
      0.012 * hours +
      0.002 * plan.packKg;
    // A walker is not a runner: even the steepest pitch at altitude is held
    // below threshold, or it is not held for long.
    const hrTarget = Math.min(WALKER.zoneCeilings[3] - 2, hrrToBpm(fraction));
    heartRate += (hrTarget - heartRate) / (hrTarget > heartRate ? 25 : 40);

    record(true, grade);

    // ACSM's walking equation for the oxygen cost, 5 kcal a litre — raised by
    // the third a watch's heart-rate estimate lands above it on a long climb.
    const metresPerMinute = speed * 60;
    const vo2 =
      3.5 +
      0.1 * metresPerMinute +
      1.8 * metresPerMinute * Math.max(grade, 0) +
      0.3 * metresPerMinute * Math.max(-grade, 0);
    calories += (1.3 * vo2 * massKg * 5) / 1000 / 60;

    distance += speed;
    wall += 1;
    movingSeconds += 1;

    const next = rests[0];
    if (next && distance >= next.at) {
      rests.shift();
      beginStop(next.seconds);
    } else if (grade > 0.12 && random() < 1 / 720) {
      // Hands on knees on a steep pitch.
      beginStop(20 + Math.floor(random() * 55));
    } else if (random() < 1 / 3000) {
      // A view, a photo, a shoelace.
      beginStop(15 + Math.floor(random() * 40));
    }
  }

  // A stop planned at the very end — the summit, on a route that ends there —
  // is still in the recording until the watch is stopped.
  while (stopLeft > 0) {
    const restTarget = hrrToBpm(0.14 + (0.01 * movingSeconds) / 3600);
    heartRate += (restTarget - heartRate) / 40;
    record(false, 0);
    calories += 1.3 / 60;
    stopLeft -= 1;
    wall += 1;
  }

  return summarise(plan, startMs, series, track, pauses, Math.round(calories));
}

// ---------------------------------------------------------------- figures --

/** COROS's default auto-lap on foot. */
const LAP_METERS = 1000;

function lapsOf(series: readonly TrainingHubActivitySeriesPoint[]): TrainingHubActivityLap[] {
  const laps: TrainingHubActivityLap[] = [];
  let bucket: TrainingHubActivitySeriesPoint[] = [];
  const close = () => {
    if (bucket.length < 2) return;
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    const lapDistance = (last.distance ?? 0) - (first.distance ?? 0);
    const duration = bucket.length;
    const stepping = bucket.map((point) => point.cadence ?? 0).filter((value) => value > 0);
    const { gain } = climbOf(bucket);
    laps.push({
      index: laps.length + 1,
      distance: Math.round(lapDistance),
      duration,
      avgHr: Math.round(mean(bucket.map((point) => point.hr ?? 0)) ?? 0),
      maxHr: Math.max(...bucket.map((point) => point.hr ?? 0)),
      pace: lapDistance > 0 ? duration / (lapDistance / 1000) : undefined,
      elevationGain: gain,
      avgCadence: Math.round(mean(stepping) ?? 0),
      maxCadence: Math.max(0, ...stepping)
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
  plan: HikePlan,
  startMs: number,
  series: TrainingHubActivitySeriesPoint[],
  track: TrainingHubTrackPoint[],
  pauses: TrainingHubActivityPause[],
  calories: number
): SimulatedHike {
  const activityId = `${ID_PREFIX}${plan.key}`;
  const duration = series.length;
  const elapsedDuration = (series[series.length - 1]?.elapsed ?? 0) + 1;
  const distance = Math.round(series[series.length - 1]?.distance ?? 0);
  const hrs = series.map((point) => point.hr ?? 0);
  const avgHr = Math.round(mean(hrs) ?? 0);
  const maxHr = Math.max(...hrs);
  const { gain, loss } = climbOf(series);
  const stepping = series.map((point) => point.cadence ?? 0).filter((value) => value > 0);
  const { trainingLoad, aboveThreshold, hrZones } = heartRateFigures(hrs);
  const sport = SPORT[plan.kind];

  const startTime = Math.floor(startMs / 1000);
  const activity: TrainingHubActivity = {
    activityId,
    name: plan.name,
    sportType: sport.sportType,
    sportName: sport.sportName,
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
    laps: lapsOf(series),
    dynamics: {
      avgCadence: Math.round(mean(stepping) ?? 0),
      maxCadence: Math.max(0, ...stepping)
    },
    hrZones,
    effect: {
      aerobic: Math.round(Math.min(5, 1 + 4 * (1 - Math.exp(-trainingLoad / 150))) * 10) / 10,
      anaerobic: Math.round(Math.min(5, 0.1 + aboveThreshold / 900) * 10) / 10
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
    fingerprint: "sample-hike",
    detail
  });

  return { activity, detail, summary };
}

// -------------------------------------------------------------- the door --

/** The day a plan was walked, counted back from `today`. */
function planDay(when: HikeDate, today: Date): Date {
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);
  if ("weekday" in when) {
    do {
      day.setDate(day.getDate() - 1);
    } while (day.getDay() === 0 || day.getDay() === 6);
    return day;
  }
  // Back to the last Saturday that has been (today, if it is one), then whole
  // weekends from there.
  const sinceSaturday = (day.getDay() + 1) % 7;
  day.setDate(day.getDate() - sinceSaturday - 7 * when.weekendsAgo + (when.day === "sun" ? 1 : 0));
  return day;
}

let simulated: Map<string, SimulatedHike> | null = null;

/** Every hike, walked once per launch, dated back from the moment it is first asked for. */
function hikes(): Map<string, SimulatedHike> {
  if (simulated) return simulated;
  const now = new Date();
  simulated = new Map();
  for (const plan of PLANS) {
    const start = planDay(plan.when, now);
    start.setHours(Math.floor(plan.startHour), Math.round((plan.startHour % 1) * 60), 12, 0);
    // A walk that has not happened yet — this weekend's, early on the
    // Saturday — is last weekend's instead.
    if (start.getTime() > now.getTime()) {
      start.setDate(start.getDate() - 7);
    }
    const hike = simulate(plan, start.getTime());
    simulated.set(hike.activity.activityId, hike);
  }
  return simulated;
}

/**
 * The activity list the window asked for, with the sample hikes in it: on the
 * first page only, and only inside a dated window when one was asked for.
 * Newest first, as COROS sends the list.
 */
export function withSampleHikes(
  activities: TrainingHubActivity[],
  request: { page: number; startDay?: string; endDay?: string }
): TrainingHubActivity[] {
  if (request.page !== 1) return activities;
  const added = [...hikes().values()]
    .map((hike) => hike.activity)
    .filter((activity) => insideDayWindow(activity.startTime, request));
  return [...activities, ...added].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

export function sampleHikeDetail(activityId: string): TrainingHubActivityDetail {
  const hike = hikes().get(activityId);
  if (!hike) {
    throw new Error(`No sample hike ${activityId}.`);
  }
  return hike.detail;
}

/** The stored summaries the window asked for, with the sample hikes' own. */
export function withSampleHikeSummaries(
  activityIds: readonly string[],
  stored: ActivityDetailSummary[]
): ActivityDetailSummary[] {
  const added = activityIds.flatMap((id) => {
    const hike = isSampleHikeId(id) ? hikes().get(id) : undefined;
    return hike ? [hike.summary] : [];
  });
  return [...stored, ...added];
}
