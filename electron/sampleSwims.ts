/**
 * Sample swims, for working on the Swimming screen without getting wet.
 *
 * Switched on by `HERACLES_SAMPLE_SWIMS=1` (`npm run dev:sample-swims`, or
 * "Swims" in the development bar's Sample menu) and reached from nowhere else —
 * the sample rides' arrangement exactly (see `sampleRides.ts`): `main.ts` adds
 * these swims to the activity list the window asks for and answers their
 * details, and nothing else in the main process ever sees them — not the
 * mirror, the detail cache, the summary sweep, Coach's tools or the analysis
 * watcher. Turning the flag off leaves no trace.
 *
 * Twelve weeks of a club swimmer out of Hà Nội: two pool sessions a week,
 * written the way a coach writes them on the board — a warm-up of mixed
 * strokes, drills, a main set (8 × 100 at CSS, 4 × 200, 12 × 50 fast,
 * 3 × 400, IM hundreds, a CSS test of 400 then 200), a cool-down — mostly in
 * a 25 m pool, now and then in a 50 m one, and an open-water loop of Hồ Tây
 * every third Sunday. Each length is swum on its own: its time from the
 * swimmer's Critical Swim Speed, the stroke and the effort, slowed a little
 * as an interval goes on; its strokes from how far each stroke carries, which
 * shortens when the swimmer speeds up and gets longer week by week; the rests
 * at the wall are recorded as COROS records them. Heart rate rises through
 * each interval and falls at the wall.
 *
 * The pool swims are written as COROS's own payload — a `lapList` of lengths
 * and laps in centimetres and hundredths — and read back through
 * `parseSwimDetail`, so the screen draws what the parser makes of a real
 * payload's shape. Seeded per swim, so the figures are the same on every
 * launch; only the dates move, to stay on recent weeks.
 */
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityLap,
  TrainingHubActivitySeriesPoint,
  TrainingHubSwimDetail,
  TrainingHubTrackPoint
} from "./types";
import { summarizeActivityDetail } from "./activityMetrics";
import { parseSwimDetail } from "./swimDetail";
import { simplifyRoute } from "./routeSimplification";
import {
  decimate,
  heartRateFigures,
  insideDayWindow,
  mean,
  seededRandom,
  wander
} from "./sampleActivityKit";

export function sampleSwimsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.HERACLES_SAMPLE_SWIMS === "1";
}

const ID_PREFIX = "sample-swim-";

export function isSampleSwimId(activityId: string | undefined): boolean {
  return typeof activityId === "string" && activityId.startsWith(ID_PREFIX);
}

// ------------------------------------------------------------ the swimmer --

/** How many weeks back the history reaches, this one included. */
const WEEKS = 12;

/**
 * Critical Swim Speed in seconds per 100 m, a few seconds faster each month:
 * 1:45 twelve weeks ago, about 1:41 now.
 */
function cssAt(weeksAgo: number): number {
  return 105 - (WEEKS - 1 - weeksAgo) * 0.35;
}

/**
 * How far a freestyle stroke of the watch arm carries, metres — longer as the
 * technique work lands: about 14 strokes a 25 m length at CSS, near 30 a
 * minute, as a club swimmer's watch counts them.
 */
function strokeLengthAt(weeksAgo: number): number {
  return 1.4 + (WEEKS - 1 - weeksAgo) * 0.006;
}

type Stroke = "free" | "back" | "breast" | "fly" | "drill";

/** COROS's `swimStyle` codes. */
const STYLE_CODE: Record<Stroke, number> = { free: 1, breast: 2, back: 3, fly: 4, drill: 6 };
const IM_CODE = 7;

/** Seconds per 100 against freestyle at the same effort. */
const STROKE_PACE: Record<Stroke, number> = {
  free: 1,
  back: 1.13,
  breast: 1.22,
  fly: 1.08,
  drill: 1.45
};

/** Distance per stroke against freestyle's. */
const STROKE_LENGTH: Record<Exclude<Stroke, "drill">, number> = {
  free: 1,
  back: 0.95,
  breast: 0.9,
  fly: 0.88
};

type Effort =
  | "easy"
  | "steady"
  | "css"
  | "threshold"
  | "fast"
  | "sprint"
  | "test400"
  | "test200";

/** Pace against CSS: a test 400 is swum a shade under it, a test 200 well under. */
const EFFORT_PACE: Record<Effort, number> = {
  easy: 1.14,
  steady: 1.07,
  css: 1,
  threshold: 1.03,
  fast: 0.95,
  sprint: 0.9,
  test400: 0.975,
  test200: 0.94
};

/** A faster length is bought with a shorter, quicker stroke. */
const EFFORT_STROKE_LENGTH: Record<Effort, number> = {
  easy: 1.04,
  steady: 1.02,
  css: 1,
  threshold: 0.99,
  fast: 0.94,
  sprint: 0.88,
  test400: 0.98,
  test200: 0.93
};

/** Where heart rate settles on a long interval at each effort. */
const EFFORT_HR: Record<Effort, number> = {
  easy: 124,
  steady: 137,
  css: 155,
  threshold: 159,
  fast: 163,
  sprint: 167,
  test400: 171,
  test200: 174
};

// ------------------------------------------------------------ the sessions --

interface Rep {
  meters: number;
  /** One stroke, or an individual medley: fly, back, breast, free in quarters. */
  stroke: Stroke | "im";
  effort: Effort;
  /** Seconds at the wall after it. */
  restAfter: number;
}

function reps(count: number, meters: number, stroke: Rep["stroke"], effort: Effort, rest: number): Rep[] {
  return Array.from({ length: count }, () => ({ meters, stroke, effort, restAfter: rest }));
}

const WARM_UP: readonly Rep[] = [
  { meters: 200, stroke: "free", effort: "easy", restAfter: 20 },
  { meters: 100, stroke: "back", effort: "easy", restAfter: 15 },
  { meters: 100, stroke: "breast", effort: "easy", restAfter: 30 }
];
const DRILLS: readonly Rep[] = reps(4, 50, "drill", "easy", 15);
const COOL_DOWN: readonly Rep[] = [
  { meters: 100, stroke: "back", effort: "easy", restAfter: 10 },
  { meters: 100, stroke: "free", effort: "easy", restAfter: 0 }
];

type WorkoutKey = "css" | "threshold" | "sprint" | "endurance" | "im" | "test" | "longCourse";

const WORKOUTS: Record<WorkoutKey, { name: string; main: Rep[] }> = {
  css: { name: "CSS 8 × 100", main: reps(8, 100, "free", "css", 15) },
  threshold: { name: "Threshold 4 × 200", main: reps(4, 200, "free", "threshold", 20) },
  sprint: {
    name: "Speed 12 × 50",
    main: [...reps(12, 50, "free", "sprint", 30), ...reps(4, 50, "fly", "fast", 30)]
  },
  endurance: { name: "Aerobic 3 × 400", main: reps(3, 400, "free", "steady", 30) },
  im: {
    name: "IM 6 × 100",
    main: [...reps(6, 100, "im", "threshold", 20), ...reps(4, 100, "free", "css", 15)]
  },
  test: {
    name: "CSS test 400 + 200",
    main: [
      { meters: 400, stroke: "free", effort: "test400", restAfter: 300 },
      { meters: 200, stroke: "free", effort: "test200", restAfter: 120 }
    ]
  },
  longCourse: {
    name: "Long course 5 × 200",
    main: [...reps(5, 200, "free", "steady", 20), ...reps(4, 100, "back", "steady", 15)]
  }
};

type SwimPlan =
  | {
      kind: "pool";
      key: string;
      weeksAgo: number;
      /** Days after that week's Monday. */
      weekday: number;
      startHour: number;
      pool: 25 | 50;
      workout: WorkoutKey;
    }
  | {
      kind: "open";
      key: string;
      weeksAgo: number;
      weekday: number;
      startHour: number;
      loops: number;
    };

const TUESDAY_ROTATION: readonly WorkoutKey[] = ["css", "threshold", "sprint", "css", "im", "threshold"];

/** Every swim of the twelve weeks, oldest first. */
function plans(): SwimPlan[] {
  const list: SwimPlan[] = [];
  for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo -= 1) {
    list.push({
      kind: "pool",
      key: `w${weeksAgo}-tue`,
      weeksAgo,
      weekday: 1,
      startHour: 6.25,
      pool: 25,
      // A test every six weeks; the rest of the time the rotation.
      workout: weeksAgo % 6 === 1 ? "test" : TUESDAY_ROTATION[weeksAgo % TUESDAY_ROTATION.length]!
    });
    list.push({
      kind: "pool",
      key: `w${weeksAgo}-fri`,
      weeksAgo,
      weekday: 4,
      startHour: 18.5,
      pool: weeksAgo % 4 === 2 ? 50 : 25,
      workout: weeksAgo % 4 === 2 ? "longCourse" : "endurance"
    });
    if (weeksAgo % 3 === 0) {
      list.push({ kind: "open", key: `w${weeksAgo}-sun`, weeksAgo, weekday: 6, startHour: 6, loops: weeksAgo === 0 ? 2 : 1 });
    }
  }
  return list;
}

// ------------------------------------------------------------ the pool --

interface Simulated {
  activity: TrainingHubActivity;
  detail: TrainingHubActivityDetail;
  summary: ActivityDetailSummary;
}

/** Heart rate a second at a time, easing toward a target. */
function heart(start: number) {
  let hr = start;
  return (target: number, seconds: number, random: () => number) => {
    hr += (target - hr) * (1 - Math.exp(-1 / seconds));
    return Math.round(hr + (random() - 0.5) * 2);
  };
}

const IM_ORDER: readonly Exclude<Stroke, "drill">[] = ["fly", "back", "breast", "free"];

function simulatePool(plan: Extract<SwimPlan, { kind: "pool" }>, startMs: number): Simulated {
  const random = seededRandom(`swim-${plan.key}`);
  const css = cssAt(plan.weeksAgo);
  const strokeLength = strokeLengthAt(plan.weeksAgo);
  const workout = WORKOUTS[plan.workout];
  const program = [...WARM_UP, ...DRILLS, ...workout.main, ...COOL_DOWN];
  const step = heart(82);

  const series: TrainingHubActivitySeriesPoint[] = [];
  const lengthItems: Record<string, number>[] = [];
  const lapItems: Record<string, number>[] = [];
  let clock = 0;
  let meters = 0;

  program.forEach((rep, position) => {
    const count = Math.max(1, Math.round(rep.meters / plan.pool));
    const lapLengths: { seconds: number; strokes?: number; swolf?: number; hr: number[] }[] = [];
    for (let index = 0; index < count; index += 1) {
      const stroke: Stroke = rep.stroke === "im" ? IM_ORDER[Math.floor((index * 4) / count)]! : rep.stroke;
      const fatigue = 1 + 0.004 * index + meters * 0.000004;
      const pushOff = index === 0 ? 0.98 : 1;
      const seconds =
        Math.round(
          ((css * EFFORT_PACE[rep.effort] * STROKE_PACE[stroke]) / 100) *
            plan.pool *
            fatigue *
            pushOff *
            (1 + (random() - 0.5) * 0.03) *
            100
        ) / 100;
      // A push off the wall carries five metres before the first stroke.
      const strokes =
        stroke === "drill"
          ? undefined
          : Math.max(
              4,
              Math.round(
                (plan.pool - 5) /
                  (strokeLength * STROKE_LENGTH[stroke] * EFFORT_STROKE_LENGTH[rep.effort] * (1 - 0.003 * index)) +
                  (random() - 0.5) * 1.2
              )
            );
      const rate = strokes === undefined ? undefined : (strokes / seconds) * 60;
      const hrs: number[] = [];
      const whole = Math.max(1, Math.round(seconds));
      for (let second = 0; second < whole; second += 1) {
        const hr = step(EFFORT_HR[rep.effort] + (stroke === "fly" ? 4 : 0), 22, random);
        hrs.push(hr);
        meters += plan.pool / whole;
        series.push({
          elapsed: clock,
          distance: Math.round(meters * 10) / 10,
          hr,
          pace: Math.round((seconds / plan.pool) * 1000),
          ...(rate !== undefined ? { cadence: Math.round(rate) } : {})
        });
        clock += 1;
      }
      const swolf = strokes === undefined ? undefined : Math.round(seconds) + strokes;
      lengthItems.push({
        distance: plan.pool * 100,
        time: Math.round(seconds * 100),
        swimStyle: STYLE_CODE[stroke],
        ...(strokes !== undefined ? { strokes } : {}),
        ...(swolf !== undefined ? { avgSwolf: swolf } : {}),
        ...(rate !== undefined ? { avgStrokeRateLen: Math.round(rate) } : {}),
        avgHr: Math.round(mean(hrs) ?? 0),
        swimRelationIndex: position + 1
      });
      lapLengths.push({ seconds, ...(strokes !== undefined ? { strokes } : {}), ...(swolf !== undefined ? { swolf } : {}), hr: hrs });
    }

    const lapSeconds = lapLengths.reduce((sum, length) => sum + length.seconds, 0);
    const counted = lapLengths.filter((length) => length.strokes !== undefined);
    const lapStrokes = counted.reduce((sum, length) => sum + length.strokes!, 0);
    const lapHrs = lapLengths.flatMap((length) => length.hr);
    lapItems.push({
      distance: count * plan.pool * 100,
      time: Math.round(lapSeconds * 100),
      swimStyle: rep.stroke === "im" ? IM_CODE : STYLE_CODE[rep.stroke],
      ...(counted.length > 0
        ? {
            strokes: lapStrokes,
            avgSwolf: Math.round(mean(counted.map((length) => length.swolf!)) ?? 0),
            avgStrokeRateLen: Math.round(
              (lapStrokes / counted.reduce((sum, length) => sum + length.seconds, 0)) * 60
            )
          }
        : {}),
      avgHr: Math.round(mean(lapHrs) ?? 0),
      maxHr: Math.max(...lapHrs),
      swimRelationIndex: position + 1
    });

    if (rep.restAfter > 0) {
      for (let second = 0; second < rep.restAfter; second += 1) {
        series.push({ elapsed: clock, distance: Math.round(meters * 10) / 10, hr: step(104, 32, random) });
        clock += 1;
      }
      const rest = { distance: 0, time: rep.restAfter * 100, swimStyle: 0 };
      lengthItems.push(rest);
      lapItems.push(rest);
    }
  });

  const strokesTotal = lengthItems.reduce((sum, item) => sum + (item.strokes ?? 0), 0);
  const swimmingSeconds = lengthItems.reduce((sum, item) => sum + (item.distance > 0 ? item.time / 100 : 0), 0);
  const raw = {
    sportType: 300,
    summary: {
      sportType: 300,
      lengths: lengthItems.filter((item) => item.distance > 0).length,
      totalCadence: strokesTotal,
      avgCadence: Math.round((strokesTotal / swimmingSeconds) * 60),
      waterTemperature: 2750
    },
    lapList: [
      { type: 1, lapItemList: lengthItems },
      { type: 2, lapItemList: lapItems }
    ]
  };
  const swim = parseSwimDetail(raw, { sportType: 300 });
  if (!swim) {
    throw new Error(`Sample swim ${plan.key} did not parse.`);
  }

  return assemble({
    key: plan.key,
    name: workout.name,
    sportType: 300,
    sportName: "Pool Swim",
    startMs,
    distance: Math.round(meters),
    series,
    swim,
    laps: swim.intervals.map((interval) => ({
      index: interval.index,
      distance: interval.distance,
      duration: Math.round(interval.seconds),
      ...(interval.avgHr !== undefined ? { avgHr: interval.avgHr } : {}),
      ...(interval.maxHr !== undefined ? { maxHr: interval.maxHr } : {}),
      ...(interval.strokeRate !== undefined ? { avgCadence: interval.strokeRate } : {}),
      pace: Math.round((interval.seconds / interval.distance) * 1000)
    })),
    calories: Math.round((swimmingSeconds / 60) * 10 + ((clock - swimmingSeconds) / 60) * 3)
  });
}

// ------------------------------------------------------------ open water --

/** A buoyed loop off the eastern shore of Hồ Tây, about 1.4 km round. */
const LAKE = { lat: 21.0558, lon: 105.8262, eastMeters: 300, northMeters: 120 };
const METERS_PER_DEGREE_LAT = 111_320;

function simulateOpen(plan: Extract<SwimPlan, { kind: "open" }>, startMs: number): Simulated {
  const random = seededRandom(`swim-${plan.key}`);
  const css = cssAt(plan.weeksAgo);
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((LAKE.lat * Math.PI) / 180);
  const step = heart(84);
  const perimeter =
    2 * Math.PI * Math.sqrt((LAKE.eastMeters ** 2 + LAKE.northMeters ** 2) / 2);
  const course = perimeter * plan.loops;

  const series: TrainingHubActivitySeriesPoint[] = [];
  const track: TrainingHubTrackPoint[] = [];
  const laps: TrainingHubActivityLap[] = [];
  // The line wanders off the buoys a few metres and back, as a swimmer does
  // between sightings — slowly, not a fresh error every second.
  const driftEast = wander(random, 0.97, 4);
  const driftNorth = wander(random, 0.97, 4);
  let swum = 0;
  let measured = 0;
  let clock = 0;
  let lap = { start: 0, from: 0, hrs: [] as number[], rates: [] as number[] };

  while (swum < course) {
    // Sighting, chop and the turn at each buoy: open water is never one pace.
    const pace = css * 1.08 * (1 + (random() - 0.5) * 0.08);
    const speed = 100 / pace;
    swum += speed;
    // GPS only fixes when the wrist clears the water, so the measured line cuts
    // the course a little short.
    measured += speed * 0.97;
    const angle = (swum / perimeter) * 2 * Math.PI;
    const x = LAKE.eastMeters * Math.cos(angle) + driftEast();
    const y = LAKE.northMeters * Math.sin(angle) + driftNorth();
    const rate = Math.round(30 + (random() - 0.5) * 3);
    const hr = step(152, 40, random);
    series.push({ elapsed: clock, distance: Math.round(measured * 10) / 10, hr, pace: Math.round(pace * 10), cadence: rate });
    track.push({
      lat: LAKE.lat + y / METERS_PER_DEGREE_LAT,
      lon: LAKE.lon + x / metersPerDegreeLon,
      distance: Math.round(measured),
      elapsed: clock
    });
    lap.hrs.push(hr);
    lap.rates.push(rate);
    clock += 1;
    if (measured - lap.from >= 500 || swum >= course) {
      laps.push({
        index: laps.length + 1,
        distance: Math.round(measured - lap.from),
        duration: clock - lap.start,
        avgHr: Math.round(mean(lap.hrs) ?? 0),
        maxHr: Math.max(...lap.hrs),
        avgCadence: Math.round(mean(lap.rates) ?? 0),
        pace: Math.round(((clock - lap.start) / Math.max(1, measured - lap.from)) * 1000)
      });
      lap = { start: clock, from: measured, hrs: [], rates: [] };
    }
  }

  const raw = { sportType: 301, summary: { sportType: 301, avgCadence: 30, waterTemperature: 2550 } };
  const swim = parseSwimDetail(raw, { sportType: 301, laps });
  if (!swim) {
    throw new Error(`Sample swim ${plan.key} did not parse.`);
  }

  return assemble({
    key: plan.key,
    name: "Hồ Tây open water",
    sportType: 301,
    sportName: "Open Water",
    startMs,
    distance: Math.round(measured),
    series,
    swim,
    laps,
    calories: Math.round((clock / 60) * 10),
    track
  });
}

// ------------------------------------------------------------ the record --

function assemble(input: {
  key: string;
  name: string;
  sportType: number;
  sportName: string;
  startMs: number;
  distance: number;
  series: TrainingHubActivitySeriesPoint[];
  swim: TrainingHubSwimDetail;
  laps: TrainingHubActivityLap[];
  calories: number;
  track?: TrainingHubTrackPoint[];
}): Simulated {
  const activityId = `${ID_PREFIX}${input.key}`;
  const hrs = input.series.map((point) => point.hr ?? 0);
  const { trainingLoad, aboveThreshold, hrZones } = heartRateFigures(hrs);
  const duration = input.series.length;
  const startTime = Math.floor(input.startMs / 1000);
  const activity: TrainingHubActivity = {
    activityId,
    name: input.name,
    sportType: input.sportType,
    sportName: input.sportName,
    startTime,
    endTime: startTime + duration,
    duration,
    elapsedDuration: duration,
    distance: input.distance,
    avgHr: Math.round(mean(hrs) ?? 0),
    maxHr: Math.max(...hrs),
    calories: input.calories,
    trainingLoad
  };
  const detail: TrainingHubActivityDetail = {
    ...activity,
    laps: input.laps,
    ...(input.swim.avgStrokeRate !== undefined ? { dynamics: { avgCadence: input.swim.avgStrokeRate } } : {}),
    hrZones,
    effect: {
      aerobic: Math.round(Math.min(5, 1 + 4 * (1 - Math.exp(-trainingLoad / 150))) * 10) / 10,
      anaerobic: Math.round(Math.min(5, 0.1 + aboveThreshold / 600) * 10) / 10
    },
    ...(input.track
      ? {
          track: {
            points: decimate(input.track.map(({ elapsed: _clock, ...point }) => point), 400),
            ...(() => {
              const route = simplifyRoute(input.track);
              return route ? { route } : {};
            })()
          }
        }
      : {}),
    series: input.series,
    swim: input.swim
  };
  const summary = summarizeActivityDetail({ activityId, fingerprint: "sample-swim", detail });
  return { activity, detail, summary };
}

// -------------------------------------------------------------- the door --

let simulated: Map<string, Simulated> | null = null;

/** Every swim, swum once per launch, dated back from the moment it is first asked for. */
function swims(): Map<string, Simulated> {
  if (simulated) return simulated;
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  simulated = new Map();
  for (const plan of plans()) {
    const start = new Date(monday);
    start.setDate(start.getDate() - plan.weeksAgo * 7 + plan.weekday);
    start.setHours(Math.floor(plan.startHour), Math.round((plan.startHour % 1) * 60), 0, 0);
    // A session later this week has not been swum yet.
    if (start.getTime() > now.getTime()) {
      continue;
    }
    const swim = plan.kind === "pool" ? simulatePool(plan, start.getTime()) : simulateOpen(plan, start.getTime());
    simulated.set(swim.activity.activityId, swim);
  }
  return simulated;
}

/**
 * The activity list the window asked for, with the sample swims in it: on the
 * first page only, and only inside a dated window when one was asked for.
 * Newest first, as COROS sends the list.
 */
export function withSampleSwims(
  activities: TrainingHubActivity[],
  request: { page: number; startDay?: string; endDay?: string }
): TrainingHubActivity[] {
  if (request.page !== 1) return activities;
  const added = [...swims().values()]
    .map((swim) => swim.activity)
    .filter((activity) => insideDayWindow(activity.startTime, request));
  return [...activities, ...added].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

export function sampleSwimDetail(activityId: string): TrainingHubActivityDetail {
  const swim = swims().get(activityId);
  if (!swim) {
    throw new Error(`No sample swim ${activityId}.`);
  }
  return swim.detail;
}

/** The stored summaries the window asked for, with the sample swims' own. */
export function withSampleSwimSummaries(
  activityIds: readonly string[],
  stored: ActivityDetailSummary[]
): ActivityDetailSummary[] {
  const added = activityIds.flatMap((id) => {
    const swim = isSampleSwimId(id) ? swims().get(id) : undefined;
    return swim ? [swim.summary] : [];
  });
  return [...stored, ...added];
}
