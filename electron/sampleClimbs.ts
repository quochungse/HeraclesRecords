/**
 * Sample climbing, for working on the Climbing screen without chalking up.
 *
 * Switched on by `HERACLES_SAMPLE_CLIMBS=1` (`npm run dev:sample-climbs`, or
 * "Climbs" in the development bar's Sample menu) and reached from nowhere else —
 * the sample rides' arrangement exactly (see `sampleRides.ts`): `main.ts` adds
 * these sessions to the activity list the window asks for and answers their
 * details, and nothing else in the main process ever sees them — not the
 * mirror, the detail cache, the summary sweep, Coach's tools or the analysis
 * watcher. Turning the flag off leaves no trace.
 *
 * Twelve weeks of a gym climber: rope routes on Mondays and Fridays (French
 * grades), a boulder session on Wednesdays (V grades), and an outdoor day on
 * the rock every fourth Saturday. The climber's level rises about a grade
 * over the weeks. Each climb is picked around that level and goes as a climb
 * at that distance from it goes — the easy ones flashed, the ones at the
 * limit worked or fallen off — with the time on the wall from its height and
 * difficulty, rests between, and a heart rate that climbs with the route and
 * falls at the foot of the wall.
 *
 * The sessions are written as COROS's own payload — a `lapList` of laps with
 * `mode`, `gradingSystem`, `hardestGrade`, `style`, `falls`, `elevGain`, in
 * hundredths of a second — and read back through `parseClimbDetail`, so the
 * screen draws what the parser makes of a real payload's shape. Seeded per
 * session, so the figures are the same on every launch; only the dates move.
 */
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivitySeriesPoint
} from "./types";
import { summarizeActivityDetail } from "./activityMetrics";
import { parseClimbDetail } from "./climbDetail";
import { CLIMB_SYSTEM } from "./climbGrades";
import { heartRateFigures, insideDayWindow, mean, seededRandom } from "./sampleActivityKit";

export function sampleClimbsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.HERACLES_SAMPLE_CLIMBS === "1";
}

const ID_PREFIX = "sample-climb-";

export function isSampleClimbId(activityId: string | undefined): boolean {
  return typeof activityId === "string" && activityId.startsWith(ID_PREFIX);
}

/** How many weeks back the history reaches, this one included. */
const WEEKS = 12;

type Kind = "indoor" | "boulder" | "outdoor";

const SPORT: Record<Kind, { sportType: number; sportName: string }> = {
  indoor: { sportType: 800, sportName: "Indoor Climb" },
  boulder: { sportType: 801, sportName: "Bouldering" },
  outdoor: { sportType: 802, sportName: "Outdoor Climb" }
};

/** COROS's style codes: 0 redpoint, 1 onsight, 2 flash, 3 attempt, 5 repeat. */
const STYLE = { redpoint: 0, onsight: 1, flash: 2, attempt: 3, repeat: 5 } as const;

/**
 * The climber's level as an index into COROS's indoor French list (6a is 6,
 * 6b is 8) and its V list (V3 is 3), rising over the weeks.
 */
function ropeLevel(weeksAgo: number): number {
  return 8.6 - (weeksAgo / WEEKS) * 1.4;
}
function boulderLevel(weeksAgo: number): number {
  return 3.6 - (weeksAgo / WEEKS) * 1.0;
}

interface SessionPlan {
  key: string;
  kind: Kind;
  name: string;
  weeksAgo: number;
  /** 0 Monday … 6 Sunday. */
  weekday: number;
  startHour: number;
  climbs: number;
}

const ROPE_NAMES = ["Lead after work", "Endurance laps", "Project night", "Volume day", "Top-rope circuit"];
const BOULDER_NAMES = ["Board session", "Bouldering", "Comp-style problems", "Power session"];
const OUTDOOR_NAMES = ["Sport crag day", "Limestone day"];

function plans(): SessionPlan[] {
  const out: SessionPlan[] = [];
  for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo -= 1) {
    const random = seededRandom(`climb-week-${weeksAgo}`);
    // A week now and then loses a session to life.
    const skip = random() < 0.2 ? Math.floor(random() * 3) : -1;
    const week: Array<Omit<SessionPlan, "key" | "weeksAgo">> = [
      { kind: "indoor", name: ROPE_NAMES[weeksAgo % ROPE_NAMES.length]!, weekday: 0, startHour: 18.5, climbs: 11 + Math.floor(random() * 5) },
      { kind: "boulder", name: BOULDER_NAMES[weeksAgo % BOULDER_NAMES.length]!, weekday: 2, startHour: 19, climbs: 12 + Math.floor(random() * 8) },
      { kind: "indoor", name: ROPE_NAMES[(weeksAgo + 2) % ROPE_NAMES.length]!, weekday: 4, startHour: 18, climbs: 10 + Math.floor(random() * 5) }
    ];
    week.forEach((plan, index) => {
      if (index === skip) return;
      out.push({ ...plan, key: `${weeksAgo}-${index}`, weeksAgo });
    });
    if (weeksAgo % 4 === 2) {
      out.push({
        key: `${weeksAgo}-out`,
        kind: "outdoor",
        name: OUTDOOR_NAMES[weeksAgo % OUTDOOR_NAMES.length]!,
        weeksAgo,
        weekday: 5,
        startHour: 8.5,
        climbs: 5 + Math.floor(random() * 3)
      });
    }
  }
  return out;
}

interface Simulated {
  activity: TrainingHubActivity;
  detail: TrainingHubActivityDetail;
  summary: ActivityDetailSummary;
}

/** One climb as the session plans it, before the clock runs. */
interface PlannedClimb {
  gradeIndex: number;
  style: number;
  falls: number;
  height: number;
  seconds: number;
  restAfter: number;
  /** How hard it was against the climber's level: −3 easy … +2 beyond. */
  stretch: number;
}

/** Grades around the level, easier first, the hardest in the middle of the session. */
function planClimbs(plan: SessionPlan, random: () => number): PlannedClimb[] {
  const boulder = plan.kind === "boulder";
  const level = boulder ? boulderLevel(plan.weeksAgo) : ropeLevel(plan.weeksAgo);
  const out: PlannedClimb[] = [];
  for (let index = 0; index < plan.climbs; index += 1) {
    // Warm up, build to the limit two thirds in, then wind down.
    const phase = index / Math.max(1, plan.climbs - 1);
    const shape = phase < 0.66 ? -2.5 + (phase / 0.66) * 3.5 : 1 - ((phase - 0.66) / 0.34) * 3;
    const stretch = Math.round(shape + (random() - 0.5) * 1.6);
    const gradeIndex = Math.max(0, Math.round(level + stretch));
    const against = gradeIndex - level;
    let style: number;
    let falls = 0;
    const roll = random();
    if (against <= -1.5) {
      style = roll < 0.7 ? STYLE.flash : roll < 0.9 ? STYLE.onsight : STYLE.repeat;
    } else if (against <= 0.5) {
      style = roll < 0.4 ? STYLE.flash : roll < 0.75 ? STYLE.redpoint : STYLE.attempt;
    } else {
      style = roll < 0.25 ? STYLE.redpoint : STYLE.attempt;
    }
    if (style === STYLE.attempt) falls = 1 + Math.floor(random() * 2);
    else if (style === STYLE.redpoint && random() < 0.3) falls = 1;
    const height = boulder ? 3 + random() * 1.5 : plan.kind === "outdoor" ? 18 + random() * 12 : 12 + random() * 4;
    const effort = 1 + Math.max(0, against) * 0.25;
    const seconds = boulder
      ? (25 + random() * 50) * effort * (style === STYLE.attempt ? 0.7 : 1)
      : (height * 9 + 20 + random() * 40) * effort * (style === STYLE.attempt ? 0.8 : 1);
    const restAfter = boulder ? 120 + random() * 180 + Math.max(0, against) * 60 : 240 + random() * 300 + Math.max(0, against) * 120;
    out.push({ gradeIndex, style, falls, height, seconds, restAfter, stretch: against });
  }
  return out;
}

/** The session as COROS writes it, and a heart rate a second to go with it. */
function simulate(plan: SessionPlan, startMs: number): Simulated {
  const random = seededRandom(`climb-${plan.key}`);
  const climbs = planClimbs(plan, random);
  const outdoor = plan.kind === "outdoor";
  const boulder = plan.kind === "boulder";
  const system = boulder ? CLIMB_SYSTEM.vScale : CLIMB_SYSTEM.french;
  // The outdoor table has "jug" and "easy" below 4a: its French indexes are two higher.
  const tableOffset = outdoor ? 2 : 0;
  const startHundredths = Math.round(startMs / 10);

  const laps: Record<string, unknown>[] = [];
  const hrs: number[] = [];
  let clock = 0;
  let hr = 88;
  const lap = (seconds: number, fields: Record<string, unknown>, target: (fraction: number) => number) => {
    const start = clock;
    const lapHrs: number[] = [];
    const whole = Math.max(1, Math.round(seconds));
    for (let second = 0; second < whole; second += 1) {
      const aim = target(second / whole);
      hr += (aim - hr) * 0.06 + (random() - 0.5) * 1.5;
      lapHrs.push(Math.round(hr));
      hrs.push(Math.round(hr));
    }
    clock += whole;
    laps.push({
      ...fields,
      time: whole * 100,
      startTimestamp: startHundredths + start * 100,
      endTimestamp: startHundredths + clock * 100,
      avgHr: Math.round(mean(lapHrs) ?? 0),
      maxHr: Math.max(...lapHrs)
    });
  };

  // A warm-up on the floor; outdoors, the walk in.
  lap(outdoor ? 1500 : 600, outdoor ? { mode: 1, sportStage: 0 } : { mode: 3 }, () => (outdoor ? 118 : 100));
  climbs.forEach((climb, index) => {
    const peak = 138 + Math.max(-2, climb.stretch) * 8 + (boulder ? 6 : 0) + random() * 6;
    lap(
      climb.seconds,
      {
        mode: 1,
        ...(outdoor ? { sportStage: 1 } : {}),
        routeIndex: index + 1,
        gradingSystem: system,
        hardestGrade: climb.gradeIndex + tableOffset,
        style: climb.style,
        falls: climb.falls,
        elevGain: Math.round(climb.height * 10) / 10
      },
      (fraction) => 112 + (peak - 112) * Math.min(1, fraction * 1.4)
    );
    if (index < climbs.length - 1) {
      lap(climb.restAfter, outdoor ? { mode: 3, sportStage: 1 } : { mode: 3 }, () => 102);
    }
  });
  if (outdoor) lap(1200, { mode: 1, sportStage: 2 }, () => 110);

  const sport = SPORT[plan.kind];
  const raw: Record<string, unknown> = {
    summary: { sportType: sport.sportType, startTimestamp: startHundredths },
    lapList: [{ type: 2, lapItemList: laps }]
  };
  const climb = parseClimbDetail(raw, { sportType: sport.sportType });
  const series: TrainingHubActivitySeriesPoint[] = hrs.map((value, second) => ({ elapsed: second, hr: value }));
  const { trainingLoad, aboveThreshold, hrZones } = heartRateFigures(hrs);
  const duration = hrs.length;
  const startTime = Math.floor(startMs / 1000);
  const activityId = `${ID_PREFIX}${plan.key}`;
  const activity: TrainingHubActivity = {
    activityId,
    name: plan.name,
    sportType: sport.sportType,
    sportName: sport.sportName,
    startTime,
    endTime: startTime + duration,
    duration,
    elapsedDuration: duration,
    distance: 0,
    avgHr: Math.round(mean(hrs) ?? 0),
    maxHr: Math.max(...hrs),
    calories: Math.round(duration / 60 * 7.5),
    trainingLoad,
    ...(climb?.heightMeters !== undefined ? { elevationGain: Math.round(climb.heightMeters) } : {})
  };
  const detail: TrainingHubActivityDetail = {
    ...activity,
    laps: [],
    hrZones,
    effect: {
      aerobic: Math.round(Math.min(5, 1 + 4 * (1 - Math.exp(-trainingLoad / 150))) * 10) / 10,
      anaerobic: Math.round(Math.min(5, 0.1 + aboveThreshold / 600) * 10) / 10
    },
    series,
    ...(climb ? { climb } : {})
  };
  const summary = summarizeActivityDetail({ activityId, fingerprint: "sample-climb", detail });
  return { activity, detail, summary };
}

let simulated: Map<string, Simulated> | null = null;

/** Every session, climbed once per launch, dated back from the moment it is first asked for. */
function sessions(): Map<string, Simulated> {
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
    // A session later this week has not been climbed yet.
    if (start.getTime() > now.getTime()) continue;
    const session = simulate(plan, start.getTime());
    simulated.set(session.activity.activityId, session);
  }
  return simulated;
}

/**
 * The activity list the window asked for, with the sample sessions in it: on
 * the first page only, and only inside a dated window when one was asked
 * for. Newest first, as COROS sends the list.
 */
export function withSampleClimbs(
  activities: TrainingHubActivity[],
  request: { page: number; startDay?: string; endDay?: string }
): TrainingHubActivity[] {
  if (request.page !== 1) return activities;
  const added = [...sessions().values()]
    .map((session) => session.activity)
    .filter((activity) => insideDayWindow(activity.startTime, request));
  return [...activities, ...added].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

export function sampleClimbDetail(activityId: string): TrainingHubActivityDetail {
  const session = sessions().get(activityId);
  if (!session) {
    throw new Error(`No sample climb ${activityId}.`);
  }
  return session.detail;
}

/** The stored summaries the window asked for, with the sample sessions' own. */
export function withSampleClimbSummaries(
  activityIds: readonly string[],
  stored: ActivityDetailSummary[]
): ActivityDetailSummary[] {
  const added = activityIds.flatMap((id) => {
    const session = isSampleClimbId(id) ? sessions().get(id) : undefined;
    return session ? [session.summary] : [];
  });
  return [...stored, ...added];
}
