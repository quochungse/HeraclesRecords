// Sample histories for the Hall of Records, for seeing everything it can draw
// without an account that happens to have done all of it.
//
// Picked from the developer toolbar's Sample menu (development builds only),
// like the Strength screen's sample: renderer state, nothing written anywhere.
// The hall computes its milestones from these exactly as it does from COROS —
// `computeRecords` is not told — so what is on screen is what the rules make of
// such a history, not a picture of one.
//
// Four presets, each built back from today so the dates stay current:
//
//  * **Realistic** — one runner's two years in Hà Nội, for screenshots: a
//    routine with gaps, fitness that comes slowly, real races and trips, and
//    whatever the rules make of that. It ends on last Saturday's trail 50K,
//    which completes the Cretan Bull and is the first climb past 1,500 m, so
//    switching it on raises one celebration and one toast. No swims: the Hydra
//    is untouched. A club runner, so the Mares stop at their first stage.
//  * **Full history** — two and a half years of runs, rides, swims, strength
//    and hikes, a sleep log, VO2max readings, finished plans and trips: every
//    kind of milestone, folded years and months, every labour begun and seven
//    complete. The last fortnight holds two labours completing at once (the
//    Hydra and the Boar: the celebration queue), two stages reached (toasts),
//    and the month's new milestones (the rail's count and the "New" badges).
//  * **First weeks** — three weeks of a beginner: few rows, open labours drawn
//    dashed, Within reach, and a stack of toasts for the first stages.
//  * **Empty** — no activity at all: the empty hall.
//
// A sample milestone's activity has no page: its id starts with
// `SAMPLE_ACTIVITY_PREFIX`, and App says so rather than opening Activities.

import { ACTIVITY_SUMMARY_VERSION, RECORDS_SUMMARY_VERSION } from "../../electron/activityMetrics";
import type {
  ActivityDetailSummary,
  BestEffort,
  RememberedMilestone,
  TrainingHubActivity,
  TrainingHubPersonalRecordGroup
} from "../../electron/types";
import { placeCellKey, type PlaceLabelLookup, type RecordsInput } from "./milestones";

export type RecordsSamplePreset = "realistic" | "full" | "beginner" | "empty";

export const RECORDS_SAMPLE_PRESETS: ReadonlyArray<{
  value: RecordsSamplePreset;
  label: string;
  title: string;
}> = [
  {
    value: "realistic",
    label: "Records · realistic",
    title: "Hall of Records: one runner's two years, built to be believed — for screenshots. Last Saturday's 50K completes a labour"
  },
  {
    value: "full",
    label: "Records · full history",
    title: "Hall of Records: every kind of milestone, with stages and two labours completed in the last fortnight"
  },
  {
    value: "beginner",
    label: "Records · first weeks",
    title: "Hall of Records: a beginner's first three weeks — open labours and first stages"
  },
  { value: "empty", label: "Records · empty", title: "Hall of Records with no activity at all" }
];

export const SAMPLE_ACTIVITY_PREFIX = "sample-records-";

export function isSampleRecordsActivity(activityId: string): boolean {
  return activityId.startsWith(SAMPLE_ACTIVITY_PREFIX);
}

export type RecordsSampleInput = Omit<RecordsInput, "unitSystem" | "today">;

// --- Places ---------------------------------------------------------------------

interface SamplePlace {
  lat: number;
  lon: number;
  label: PlaceLabelLookup;
}

// Home is named the way Nominatim names it, with no code — a label cached
// before codes were kept — and the rest the way Photon does, so the sample
// also shows that one country in two languages is still one country.
const PLACES = {
  hanoi: { lat: 21.03, lon: 105.85, label: { city: "Hà Nội", country: "Việt Nam" } },
  bavi: { lat: 21.08, lon: 105.37, label: { city: "Ba Vì", country: "Vietnam", countryCode: "VN" } },
  tamdao: { lat: 21.46, lon: 105.64, label: { city: "Tam Đảo", country: "Vietnam", countryCode: "VN" } },
  ninhbinh: { lat: 20.25, lon: 105.97, label: { city: "Ninh Bình", country: "Vietnam", countryCode: "VN" } },
  halong: { lat: 20.95, lon: 107.08, label: { city: "Hạ Long", country: "Vietnam", countryCode: "VN" } },
  sapa: { lat: 22.34, lon: 103.84, label: { city: "Sa Pa", country: "Vietnam", countryCode: "VN" } },
  mocchau: { lat: 20.85, lon: 104.63, label: { city: "Mộc Châu", country: "Vietnam", countryCode: "VN" } },
  danang: { lat: 16.05, lon: 108.2, label: { city: "Đà Nẵng", country: "Vietnam", countryCode: "VN" } },
  dalat: { lat: 11.94, lon: 108.44, label: { city: "Đà Lạt", country: "Vietnam", countryCode: "VN" } },
  saigon: { lat: 10.78, lon: 106.7, label: { city: "Hồ Chí Minh City", country: "Vietnam", countryCode: "VN" } },
  chiangmai: { lat: 18.79, lon: 98.98, label: { city: "Chiang Mai", country: "Thailand", countryCode: "TH" } },
  bangkok: { lat: 13.73, lon: 100.54, label: { city: "Bangkok", country: "Thailand", countryCode: "TH" } },
  yty: { lat: 22.62, lon: 103.62, label: { city: "Bát Xát", country: "Vietnam", countryCode: "VN" } },
  mocchauTea: { lat: 20.92, lon: 104.68, label: { city: "Mộc Châu", country: "Vietnam", countryCode: "VN" } }
} satisfies Record<string, SamplePlace>;

type PlaceId = keyof typeof PLACES;

// --- Building ---------------------------------------------------------------------

/** Deterministic, so the sample reads the same every time it is switched on. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/** A COROS birthday (`YYYYMMDD`) for someone `age` today, born on `monthDay`. */
function birthdayAged(today: string, age: number, monthDay: string): number {
  return Number(`${Number(today.slice(0, 4)) - age}${monthDay}`);
}

const SPORT_NAMES: Readonly<Record<number, string>> = {
  100: "Run",
  102: "Trail Run",
  104: "Hike",
  200: "Road Bike",
  201: "Indoor Bike",
  300: "Pool Swim",
  301: "Open Water",
  402: "Strength"
};

interface SampleSession {
  daysAgo: number;
  hour?: number;
  sportType: number;
  name: string;
  /** Metres. */
  distance?: number;
  /** Seconds. */
  duration: number;
  climb?: number;
  /** Where it began; none for an indoor session. */
  place?: PlaceId;
  efforts?: BestEffort[];
}

class SampleHistory {
  readonly activities: TrainingHubActivity[] = [];
  readonly summaries = new Map<string, ActivityDetailSummary>();
  readonly placeLabels: Record<string, PlaceLabelLookup> = {};
  readonly #today: Date;
  #next = 0;

  constructor(today: string) {
    this.#today = new Date(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 1, Number(today.slice(6, 8)));
  }

  date(daysAgo: number, hour = 0): Date {
    const date = new Date(this.#today);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hour, 0, 0, 0);
    return date;
  }

  day(daysAgo: number): string {
    return dayKey(this.date(daysAgo));
  }

  add(session: SampleSession): TrainingHubActivity {
    this.#next += 1;
    const activityId = `${SAMPLE_ACTIVITY_PREFIX}${this.#next}`;
    const activity: TrainingHubActivity = {
      activityId,
      name: session.name,
      sportType: session.sportType,
      sportName: SPORT_NAMES[session.sportType],
      startTime: Math.floor(this.date(session.daysAgo, session.hour ?? 7).getTime() / 1000),
      duration: Math.round(session.duration),
      ...(session.distance ? { distance: Math.round(session.distance) } : {}),
      ...(session.climb ? { elevationGain: Math.round(session.climb) } : {})
    };
    this.activities.push(activity);
    const place = session.place ? PLACES[session.place] : undefined;
    if (place) this.placeLabels[placeCellKey(place)] = place.label;
    this.summaries.set(activityId, {
      activityId,
      fingerprint: "sample",
      summaryVersion: ACTIVITY_SUMMARY_VERSION,
      recordsVersion: RECORDS_SUMMARY_VERSION,
      ...(session.efforts && session.efforts.length > 0 ? { bestEfforts: session.efforts } : {}),
      ...(place ? { startPoint: { lat: place.lat, lon: place.lon } } : {}),
      computedAt: 0
    });
    return activity;
  }
}

const EFFORT_DISTANCES = [1000, 5000, 10000, 21097.5, 42195];

/** Every standard distance a run of this length covers, each at one pace. */
function effortsAt(distance: number, secondsPerKm: number, spread = () => 0): BestEffort[] {
  return EFFORT_DISTANCES.filter((target) => target <= distance).map((target) => ({
    distance: target,
    seconds: Math.round(((target / 1000) * secondsPerKm * (1 + spread())) * 10) / 10
  }));
}

/** A race or a time trial: each distance's own time, stated. */
function raceEfforts(times: Partial<Record<number, number>>): BestEffort[] {
  return Object.entries(times).map(([distance, seconds]) => ({
    distance: Number(distance),
    seconds: seconds as number
  }));
}

// --- Full history ---------------------------------------------------------------------

/** Weeks back from this one to the first; the first Monday is that far back. */
const FULL_WEEKS = 135;
/** Two weeks off injured, so the first streak ends at ten weeks. */
const INJURY_WEEKS = new Set([10, 11]);
/** An easy run's pace, every run of the history: easy runs set no records. */
const EASY_PACE = 370;

function fullHistory(today: string): RecordsSampleInput {
  const history = new SampleHistory(today);
  const random = seeded(20260918);
  // Monday of the first week, counted in days back from today.
  const todayDate = history.date(0);
  const mondayBack = (todayDate.getDay() + 6) % 7;
  const firstMonday = mondayBack + (FULL_WEEKS - 1) * 7;
  /** Days ago of a weekday (0 = Monday) in week `week`. */
  const at = (week: number, weekday: number) => firstMonday - week * 7 - weekday;
  const past = (daysAgo: number) => daysAgo >= 1;
  const easySpread = () => random() * 0.05;
  const keyRuns = new Map<number, string>();

  // The runs that make the records, the races and the distance ladder. Every
  // other run is easy, at one pace, so nothing else breaks a record.
  const KEY_RUNS: Array<{ week: number; weekday: number; distance: number; seconds: number; name: string; place?: PlaceId; climb?: number; sportType?: number; efforts: BestEffort[] }> = [
    // A first time trial: the first improvements, the Mares' first stage.
    { week: 8, weekday: 5, distance: 5200, seconds: 1560, name: "5K time trial", efforts: raceEfforts({ 1000: 280, 5000: 1500 }) },
    { week: 16, weekday: 6, distance: 10100, seconds: 3050, name: "Hồ Tây 10K", efforts: raceEfforts({ 1000: 275, 5000: 1470, 10000: 3020 }) },
    // A long run past the half, then the race that beats it four weeks on —
    // the third of the set, the Mares' second stage.
    { week: 22, weekday: 6, distance: 21300, seconds: 7900, name: "Long run", efforts: effortsAt(21300, EASY_PACE) },
    { week: 26, weekday: 6, distance: 21150, seconds: 6760, name: "Hà Nội Half Marathon", efforts: raceEfforts({ 1000: 290, 5000: 1560, 10000: 3150, 21097.5: 6720 }) },
    { week: 40, weekday: 5, distance: 5100, seconds: 1440, name: "5K time trial", efforts: raceEfforts({ 1000: 270, 5000: 1420 }) },
    // The marathon: COROS's record, but the first at the distance, so the
    // record standing rather than an improvement.
    { week: 60, weekday: 6, distance: 42400, seconds: 14760, name: "Hà Nội Marathon", efforts: raceEfforts({ 1000: 300, 5000: 1650, 10000: 3330, 21097.5: 7180, 42195: 14700 }) },
    { week: 78, weekday: 6, distance: 10050, seconds: 2870, name: "Đà Nẵng 10K", place: "danang", efforts: raceEfforts({ 1000: 262, 5000: 1405, 10000: 2850 }) },
    // A half that beats the record set 64 weeks before: a record that stood a
    // year, the Mares complete.
    { week: 90, weekday: 6, distance: 21200, seconds: 6290, name: "Ninh Bình Half", place: "ninhbinh", efforts: raceEfforts({ 1000: 268, 5000: 1440, 10000: 2930, 21097.5: 6270 }) },
    { week: 100, weekday: 5, distance: 50300, seconds: 26100, name: "Đà Lạt Ultra Trail 50K", place: "dalat", climb: 2100, sportType: 102, efforts: effortsAt(50300, 520) },
    { week: 110, weekday: 5, distance: 5050, seconds: 1340, name: "5K time trial", efforts: raceEfforts({ 1000: 246, 5000: 1330 }) },
    // A 1K a breath under the last: COROS's record, too small a gain to be
    // news — shown as the record standing.
    { week: 122, weekday: 2, distance: 8000, seconds: 2750, name: "Kilometre repeats", efforts: raceEfforts({ 1000: 244, 5000: 1460 }) }
  ];
  const keyRunAt = new Map(KEY_RUNS.map((run) => [`${run.week}:${run.weekday}`, run]));

  for (let week = 0; week < FULL_WEEKS; week += 1) {
    if (INJURY_WEEKS.has(week)) continue;
    // Runs: Tuesday and Thursday easy, Sunday long — unless a key run is that day.
    const longRun = Math.min(8 + week * 0.6, 21.5) + (random() - 0.5) * 2;
    const days: Array<{ weekday: number; distance: number }> = [
      { weekday: 1, distance: 5000 + random() * 3000 },
      { weekday: 3, distance: 5500 + random() * 2500 },
      { weekday: 6, distance: Math.max(8, longRun) * 1000 }
    ];
    for (const { weekday, distance } of days) {
      const daysAgo = at(week, weekday);
      if (!past(daysAgo)) continue;
      if (keyRunAt.has(`${week}:${weekday}`)) continue;
      history.add({
        daysAgo,
        hour: 6,
        sportType: 100,
        name: weekday === 6 ? "Long run" : "Easy run",
        distance,
        duration: (distance / 1000) * EASY_PACE * (1 + random() * 0.04),
        climb: 20 + random() * 60,
        place: "hanoi",
        efforts: effortsAt(distance, EASY_PACE, easySpread)
      });
    }
    for (const run of KEY_RUNS.filter((candidate) => candidate.week === week)) {
      const daysAgo = at(week, run.weekday);
      if (!past(daysAgo)) continue;
      const activity = history.add({
        daysAgo,
        hour: 6,
        sportType: run.sportType ?? 100,
        name: run.name,
        distance: run.distance,
        duration: run.seconds,
        climb: run.climb ?? 40,
        place: run.place ?? "hanoi",
        efforts: run.efforts
      });
      keyRuns.set(week, activity.activityId);
    }

    // Rides from week 18, Saturdays, growing; trainer rides on Wednesdays.
    if (week >= 18) {
      const ride = BIG_RIDES.get(week);
      const distance = ride?.distance ?? Math.min(30000 + (week - 18) * 600, 80000) * (0.85 + random() * 0.3);
      const daysAgo = at(week, 5);
      if (past(daysAgo)) {
        history.add({
          daysAgo,
          hour: 6,
          sportType: 200,
          name: ride?.name ?? "Saturday ride",
          distance,
          duration: distance / 8.3,
          climb: ride?.climb ?? 200 + random() * 500,
          place: ride?.place ?? "hanoi"
        });
      }
      if (week % 6 === 0 && past(at(week, 2))) {
        history.add({ daysAgo: at(week, 2), hour: 19, sportType: 201, name: "Trainer", distance: 28000, duration: 3600 });
      }
    }

    // Swims from week 30, every other Monday, growing to 1.5 km.
    if (week >= 30 && week % 2 === 0 && past(at(week, 0))) {
      const distance = week === 80 ? 2000 : Math.min(800 + (week - 30) * 25, 1550);
      history.add({
        daysAgo: at(week, 0),
        hour: 18,
        sportType: week === 80 ? 301 : 300,
        name: week === 80 ? "Hồ Tây open water" : "Pool swim",
        distance,
        duration: distance * 1.35
      });
    }

    // Strength from week 52, Fridays: past fifty sessions, short of a hundred.
    if (week >= 52 && past(at(week, 4))) {
      history.add({ daysAgo: at(week, 4), hour: 18, sportType: 402, name: "Strength", duration: 2700 });
    }

    // Hikes, about one a month, on the climbing ladder.
    const hike = HIKES.get(week);
    if (hike && past(at(week, 6))) {
      history.add({
        daysAgo: at(week, 6),
        hour: 5,
        sportType: 104,
        name: hike.name,
        distance: hike.distance,
        duration: hike.duration,
        climb: hike.climb,
        place: hike.place
      });
    }
  }

  // The last fortnight, the news: two labours completed at once — a 3.8 km
  // swim and a trek that makes thirty days an Everest — and a new country.
  [9, 7, 5, 3].forEach((daysAgo, index) => {
    history.add({
      daysAgo,
      hour: 5 + index,
      sportType: 104,
      name: `Hoàng Liên Sơn trek, day ${index + 1}`,
      distance: 16000,
      duration: 8 * 3600,
      climb: 2350,
      place: "sapa"
    });
  });
  history.add({ daysAgo: 3, hour: 16, sportType: 301, name: "Cửa Lò open water", distance: 3850, duration: 5400 });
  history.add({ daysAgo: 10, hour: 6, sportType: 100, name: "Nimman morning run", distance: 9000, duration: 9 * EASY_PACE, climb: 30, place: "chiangmai", efforts: effortsAt(9000, EASY_PACE) });

  const activityOf = (week: number) => keyRuns.get(week);
  const dayOfWeek = (week: number, weekday: number) => history.day(at(week, weekday));
  const personalRecords: TrainingHubPersonalRecordGroup[] = [
    {
      type: 4,
      label: "All",
      records: [
        { type: 7, label: "1K", duration: 244, happenDay: dayOfWeek(122, 2), activityId: activityOf(122) },
        { type: 5, label: "5K", duration: 1330, happenDay: dayOfWeek(110, 5), activityId: activityOf(110) },
        { type: 4, label: "10K", duration: 2850, happenDay: dayOfWeek(78, 6), activityId: activityOf(78) },
        { type: 2, label: "Half Marathon", duration: 6270, happenDay: dayOfWeek(90, 6), activityId: activityOf(90) },
        { type: 13, label: "Marathon", duration: 14700, happenDay: dayOfWeek(60, 6), activityId: activityOf(60) }
      ].filter((record) => record.activityId !== undefined)
    }
  ];

  // VO2max: rated Good for a man of his age from the first reading, new
  // highs, and Excellent nearly two years in; Superior is out of reach.
  const VO2: Array<[number, number]> = [
    [4, 44.6], [12, 45.0], [20, 45.4], [30, 46.1], [38, 46.3], [46, 46.6],
    [60, 47.2], [78, 48.0], [96, 48.9], [118, 49.4]
  ];
  const vo2Readings = VO2.map(([week, value]) => ({ day: dayOfWeek(week, 6), value }));

  // Sleep: four good nights at most, then one short, for over a year — so no
  // seven in a row until the last nineteen nights, all good.
  const sleepNights: Array<{ day: string; minutes: number }> = [];
  for (let daysAgo = 420; daysAgo >= 1; daysAgo -= 1) {
    const good = daysAgo <= 19 || daysAgo % 5 !== 0;
    sleepNights.push({ day: history.day(daysAgo), minutes: good ? 425 + Math.round(random() * 50) : 372 });
  }

  // The marathon block is sixteen weeks kept at 93%, so it reaches the
  // Girdle's last two stages at once: one milestone carrying two.
  const remembered: RememberedMilestone[] = [
    { id: "plan:sample-10k", kind: "plan", day: dayOfWeek(48, 6), data: { name: "Spring 10K", weeks: 8, ratio: 0.88, done: 28, settled: 32 } },
    { id: "plan:sample-marathon", kind: "plan", day: dayOfWeek(60, 6), data: { name: "Marathon block", weeks: 16, ratio: 0.93, done: 70, settled: 75 } },
    { id: "plan:sample-trail", kind: "plan", day: dayOfWeek(99, 6), data: { name: "Trail prep", weeks: 6, ratio: 0.81, done: 21, settled: 26 } }
  ];

  return {
    activities: history.activities,
    summaries: history.summaries,
    personalRecords,
    vo2Readings,
    sleepNights,
    remembered,
    placeLabels: history.placeLabels,
    athlete: { birthday: birthdayAged(today, 33, "0412"), sex: 0 }
  };
}

const BIG_RIDES = new Map<number, { distance: number; name: string; place?: PlaceId; climb?: number }>([
  [22, { distance: 52000, name: "First long ride" }],
  [30, { distance: 62000, name: "Tam Đảo foothills", place: "tamdao", climb: 900 }],
  [40, { distance: 101500, name: "Hạ Long Bay 100", place: "halong", climb: 650 }],
  [70, { distance: 162500, name: "Mộc Châu century", place: "mocchau", climb: 2300 }],
  [95, { distance: 205000, name: "Đà Lạt 200", place: "dalat", climb: 2400 }],
  [104, { distance: 120000, name: "Sài Gòn river loop", place: "saigon", climb: 300 }]
]);

const HIKES = new Map<number, { name: string; distance: number; duration: number; climb: number; place: PlaceId }>([
  [12, { name: "Ba Vì, Đền Thượng", distance: 9000, duration: 4 * 3600, climb: 650, place: "bavi" }],
  [20, { name: "Tam Đảo, Rùng Rình", distance: 11000, duration: 5 * 3600, climb: 900, place: "tamdao" }],
  [30, { name: "Ba Vì traverse", distance: 13000, duration: 6 * 3600, climb: 995, place: "bavi" }],
  [40, { name: "Tam Đảo summit", distance: 14000, duration: 6 * 3600, climb: 1100, place: "tamdao" }],
  [52, { name: "Hàm Lợn", distance: 10000, duration: 4 * 3600, climb: 700, place: "hanoi" }],
  [66, { name: "Lảo Thẩn", distance: 18000, duration: 8 * 3600, climb: 1600, place: "sapa" }],
  [84, { name: "Ba Vì loop", distance: 12000, duration: 5 * 3600, climb: 850, place: "bavi" }],
  [110, { name: "Fansipan via Trạm Tôn", distance: 22000, duration: 11 * 3600, climb: 2600, place: "sapa" }]
]);

// --- Realistic ------------------------------------------------------------------------------
//
// One runner's two years and two months, for screenshots: what the other
// presets are built to cover, this one is built to be believed. Nothing in it
// is arranged per milestone — a routine week with the gaps a life puts in it,
// fitness that comes slowly, the races a Hà Nội runner enters, a few trips —
// and the hall makes of it what it makes. Only the end is chosen: the trail 50K
// last Saturday completes the Cretan Bull (one celebration) and is the first
// climb past 1,500 m (one toast). No swims, so one labour is still untouched.

/** Weeks back to the first, so the second anniversary falls in the open months. */
const LIVED_WEEKS = 113;
/** Weeks with no session at all: a fever the first autumn, Tết the winter after. */
const LIVED_BREAKS = new Set([8, 26]);

/** A share of the way from the first week to the fittest, eased: early weeks gain most. */
function fitnessAt(week: number): number {
  return Math.min(1, week / 105) ** 0.8;
}

interface LivedKeySession {
  week: number;
  weekday: number;
  hour?: number;
  sportType: number;
  name: string;
  distance?: number;
  duration: number;
  climb?: number;
  place?: PlaceId;
  efforts?: BestEffort[];
}

// The weeks the routine gives way: races, trips, the mountains. Week 111 is
// last week, whatever day today is.
const LIVED_KEY_SESSIONS: readonly LivedKeySession[] = [
  // The first race, three months in.
  { week: 13, weekday: 6, sportType: 100, name: "Hồ Tây 10K", distance: 10080, duration: 3521, climb: 18, efforts: raceEfforts({ 1000: 328, 5000: 1730, 10000: 3492 }) },
  { week: 23, weekday: 5, sportType: 100, name: "Tam Cốc easy run", distance: 8100, duration: 3290, climb: 35, place: "ninhbinh", efforts: effortsAt(8100, 400) },
  { week: 29, weekday: 6, sportType: 100, name: "Sông Hồng dyke long run", distance: 21240, duration: 8720, climb: 40, efforts: effortsAt(21240, 410) },
  // The first half, at the end of the first plan.
  { week: 34, weekday: 6, sportType: 100, name: "Ecopark Half Marathon", distance: 21180, duration: 7145, climb: 22, efforts: raceEfforts({ 1000: 326, 5000: 1640, 10000: 3320, 21097.5: 7112 }) },
  { week: 38, weekday: 6, hour: 5, sportType: 104, name: "Ba Vì to Đền Thượng", distance: 9600, duration: 4.2 * 3600, climb: 720, place: "bavi" },
  { week: 45, weekday: 5, sportType: 100, name: "5K time trial", distance: 5060, duration: 1540, climb: 8, efforts: raceEfforts({ 1000: 292, 5000: 1525 }) },
  { week: 49, weekday: 5, hour: 5, sportType: 104, name: "Hàm Lợn at sunrise", distance: 8200, duration: 3 * 3600, climb: 460 },
  { week: 54, weekday: 5, hour: 5, sportType: 200, name: "Ba Vì loop", distance: 104300, duration: 4.4 * 3600, climb: 850, place: "bavi" },
  { week: 57, weekday: 5, hour: 6, sportType: 104, name: "Fansipan via Trạm Tôn", distance: 11400, duration: 7.5 * 3600, climb: 1250, place: "sapa" },
  { week: 60, weekday: 6, sportType: 100, name: "Hồ Gươm 10K", distance: 10050, duration: 3135, climb: 12, efforts: raceEfforts({ 1000: 301, 5000: 1560, 10000: 3110 }) },
  // The marathon, at the end of a plan kept less well.
  { week: 66, weekday: 6, hour: 5, sportType: 100, name: "Hà Nội Marathon", distance: 42420, duration: 15150, climb: 45, efforts: raceEfforts({ 1000: 318, 5000: 1735, 10000: 3460, 21097.5: 7420, 42195: 15100 }) },
  { week: 70, weekday: 3, sportType: 100, name: "Mỹ Khê beach run", distance: 8000, duration: 2950, climb: 10, place: "danang", efforts: effortsAt(8000, 368) },
  { week: 70, weekday: 5, sportType: 100, name: "Sơn Trà easy run", distance: 11200, duration: 4280, climb: 210, place: "danang", efforts: effortsAt(11200, 382) },
  { week: 74, weekday: 6, sportType: 100, name: "Mộc Châu tea hills run", distance: 12300, duration: 4720, climb: 260, place: "mocchauTea", efforts: effortsAt(12300, 384) },
  { week: 76, weekday: 6, hour: 5, sportType: 104, name: "Rùng Rình peak, Tam Đảo", distance: 11000, duration: 5 * 3600, climb: 950, place: "tamdao" },
  // Tết in Bangkok.
  { week: 80, weekday: 3, sportType: 100, name: "Lumpini Park run", distance: 7600, duration: 2780, climb: 6, place: "bangkok", efforts: effortsAt(7600, 366) },
  { week: 80, weekday: 5, sportType: 100, name: "Benjakitti Park run", distance: 10400, duration: 3830, climb: 9, place: "bangkok", efforts: effortsAt(10400, 368) },
  { week: 84, weekday: 5, hour: 5, sportType: 200, name: "Tam Đảo foothills", distance: 92400, duration: 3.9 * 3600, climb: 980, place: "tamdao" },
  // The same half a year and a week on: a record that had stood a year.
  { week: 87, weekday: 6, sportType: 100, name: "Ecopark Half Marathon", distance: 21160, duration: 6452, climb: 22, efforts: raceEfforts({ 1000: 290, 5000: 1492, 10000: 3012, 21097.5: 6428 }) },
  { week: 90, weekday: 5, sportType: 100, name: "Bãi Cháy seafront run", distance: 9200, duration: 3290, climb: 40, place: "halong", efforts: effortsAt(9200, 358) },
  { week: 92, weekday: 5, hour: 5, sportType: 200, name: "Ba Vì – Hòa Bình loop", distance: 112600, duration: 4.8 * 3600, climb: 1120, place: "bavi" },
  // The summer block for the 50K: trail long runs in the hills.
  { week: 97, weekday: 6, hour: 5, sportType: 102, name: "Hàm Lợn trail", distance: 18200, duration: 2.7 * 3600, climb: 820, efforts: effortsAt(18200, 534) },
  { week: 98, weekday: 5, hour: 6, sportType: 104, name: "Lảo Thẩn", distance: 14300, duration: 7.2 * 3600, climb: 1150, place: "yty" },
  { week: 100, weekday: 6, hour: 5, sportType: 102, name: "Ba Vì long run", distance: 26100, duration: 4.4 * 3600, climb: 1240, place: "bavi", efforts: effortsAt(26100, 607) },
  { week: 103, weekday: 6, hour: 5, sportType: 102, name: "Tam Đảo trail", distance: 24300, duration: 4.5 * 3600, climb: 1320, place: "tamdao", efforts: effortsAt(24300, 667) },
  { week: 106, weekday: 6, hour: 5, sportType: 102, name: "Ba Vì double", distance: 32400, duration: 5.7 * 3600, climb: 1480, place: "bavi", efforts: effortsAt(32400, 633) },
  { week: 108, weekday: 6, hour: 5, sportType: 102, name: "Hàm Lợn three loops", distance: 28100, duration: 4.8 * 3600, climb: 1090, efforts: effortsAt(28100, 615) },
  // Last Saturday.
  { week: 111, weekday: 5, hour: 4, sportType: 102, name: "Sa Pa 50K", distance: 50620, duration: 31450, climb: 2240, place: "sapa", efforts: effortsAt(50620, 621) }
];

function livedHistory(today: string): RecordsSampleInput {
  const history = new SampleHistory(today);
  const random = seeded(20240805);
  const todayDate = history.date(0);
  const mondayBack = (todayDate.getDay() + 6) % 7;
  const firstMonday = mondayBack + (LIVED_WEEKS - 1) * 7;
  const at = (week: number, weekday: number) => firstMonday - week * 7 - weekday;
  const past = (daysAgo: number) => daysAgo >= 1;
  /** ±share, around 1. */
  const jitter = (share: number) => 1 + (random() * 2 - 1) * share;
  // A race takes its day, and the days around it are rest.
  const keyDays = new Set([
    ...LIVED_KEY_SESSIONS.map((session) => `${session.week}:${session.weekday}`),
    "67:1",
    "111:6"
  ]);
  // A trip week is away from the routine: no gym, no Saturday ride, no long run.
  const tripWeeks = new Set(
    LIVED_KEY_SESSIONS.filter((session) => session.place === "danang" || session.place === "bangkok").map((session) => session.week)
  );

  /**
   * A run at an average pace. Its best efforts are a little quicker than the
   * average, or what a workout says: the 1K of kilometre repeats is a rep, its
   * 5K the reps with the jogs between them.
   */
  const run = (
    week: number,
    weekday: number,
    name: string,
    distance: number,
    secondsPerKm: number,
    quick: { oneK?: number; fiveK?: number } = {}
  ) => {
    const daysAgo = at(week, weekday);
    if (!past(daysAgo) || keyDays.has(`${week}:${weekday}`)) return;
    const effortPace = (target: number) =>
      target <= 1000 ? (quick.oneK ?? secondsPerKm * 0.96)
      : target <= 5000 ? (quick.fiveK ?? secondsPerKm * 0.985)
      : secondsPerKm * 0.995;
    history.add({
      daysAgo,
      hour: weekday === 6 ? 5 : 6,
      sportType: 100,
      name,
      distance,
      duration: (distance / 1000) * secondsPerKm,
      climb: 12 + random() * 45,
      place: "hanoi",
      efforts: EFFORT_DISTANCES.filter((target) => target <= distance).map((target) => ({
        distance: target,
        seconds: Math.round((target / 1000) * effortPace(target) * 10) / 10
      }))
    });
  };

  // Every week but this one, which is the race's aftermath and drawn below.
  for (let week = 0; week < LIVED_WEEKS - 1; week += 1) {
    if (LIVED_BREAKS.has(week)) continue;
    const fitness = fitnessAt(week);
    const easyPace = () => (412 - 52 * fitness) * jitter(0.025);
    /** A kilometre at the effort of a 1K rep. */
    const repPace = () => (322 - 38 * fitness) * jitter(0.012);
    const tempoPace = () => (345 - 35 * fitness) * jitter(0.015);
    const away = tripWeeks.has(week);

    // Tuesday: easy at first, then a session that hurts.
    if (week < 16) {
      if (random() > 0.1) run(week, 1, "Easy run", (5 + random() * 2.5) * 1000, easyPace());
    } else if (week % 8 === 0) {
      const rep = repPace();
      run(week, 1, "Kilometre repeats", 9000 + random() * 1500, rep * 1.2, { oneK: rep, fiveK: rep * 1.15 });
    } else if (week % 2 === 0) {
      const tempo = tempoPace();
      run(week, 1, "Tempo", 9000 + random() * 2000, tempo * 1.08, { oneK: tempo * 0.97, fiveK: tempo });
    } else {
      const rep = repPace();
      run(week, 1, "Intervals 6 × 800 m", 8500 + random() * 1000, rep * 1.25, { oneK: rep * 1.1, fiveK: rep * 1.25 });
    }

    // Wednesday evening: the gym, once it started.
    if (week >= 40 && !away && random() > 0.15 && past(at(week, 2))) {
      history.add({
        daysAgo: at(week, 2),
        hour: 18,
        sportType: 402,
        name: ["Upper body + core", "Legs + core", "Full body"][week % 3],
        duration: 3000 + random() * 900
      });
    }

    // Thursday: easy, most weeks.
    if (random() > 0.12) {
      run(week, 3, random() > 0.5 ? "Hồ Tây easy" : "Easy run", (6 + random() * 3) * 1000, easyPace());
    }

    // Saturday: a ride every other week once there was a bike, an easy run otherwise.
    if (week >= 36 && week % 2 === 0 && !away) {
      const daysAgo = at(week, 5);
      if (past(daysAgo) && !keyDays.has(`${week}:5`) && (week === 36 || random() > 0.2)) {
        // The dyke is flat; Sóc Sơn has hills.
        const dyke = week !== 36 && random() > 0.5;
        const distance = (38 + random() * 32) * 1000;
        history.add({
          daysAgo,
          hour: 5,
          sportType: 200,
          name: week === 36 ? "First ride, Sóc Sơn" : dyke ? "Sông Hồng dyke ride" : "Sóc Sơn loop",
          distance,
          duration: distance / (6.6 + random() * 0.8),
          climb: dyke ? 40 + random() * 60 : 180 + random() * 260
        });
      }
    } else if (week >= 13 && random() > 0.18) {
      run(week, 5, "Recovery run", (5 + random() * 2) * 1000, easyPace() * 1.04);
    }

    // Sunday: the long run, growing, with a cutback every fourth week.
    const base =
      week < 13 ? 5 + week * 0.35
      : week < 35 ? 10 + (week - 13) * 0.45
      : week >= 51 && week <= 62 ? 18 + (week - 51) * 1.25
      : week > 62 && week < 66 ? 16 - (week - 62) * 2
      : 15 + random() * 6;
    const long = (week % 4 === 3 ? base * 0.75 : base) * jitter(0.05);
    if (!away) {
      run(week, 6, week >= 51 && week <= 65 ? "Marathon long run" : "Long run", long * 1000, easyPace() + 10);
    }
  }

  for (const session of LIVED_KEY_SESSIONS) {
    const daysAgo = at(session.week, session.weekday);
    if (!past(daysAgo)) continue;
    history.add({
      daysAgo,
      hour: session.hour ?? 6,
      sportType: session.sportType,
      name: session.name,
      distance: session.distance,
      duration: session.duration,
      climb: session.climb,
      place: session.place ?? "hanoi",
      efforts: session.efforts
    });
  }
  // This week, after the race: one shake-out so far.
  if (past(at(112, 1))) {
    run(112, 1, "Recovery run", 5200, 400);
  }

  // COROS's own all-time records are the best of what was run, as on a real account.
  const corosBest = new Map<number, { seconds: number; day: string; activityId: string }>();
  for (const activity of history.activities) {
    const day = dayKey(new Date((activity.startTime as number) * 1000));
    for (const effort of history.summaries.get(activity.activityId)?.bestEfforts ?? []) {
      const held = corosBest.get(effort.distance);
      if (!held || effort.seconds < held.seconds) {
        corosBest.set(effort.distance, { seconds: effort.seconds, day, activityId: activity.activityId });
      }
    }
  }
  const corosRecord = (type: number, label: string, distance: number) => {
    const best = corosBest.get(distance);
    return best ? [{ type, label, duration: Math.round(best.seconds), happenDay: best.day, activityId: best.activityId }] : [];
  };
  const personalRecords: TrainingHubPersonalRecordGroup[] = [
    {
      type: 4,
      label: "All",
      records: [
        ...corosRecord(7, "1K", 1000),
        ...corosRecord(5, "5K", 5000),
        ...corosRecord(4, "10K", 10000),
        ...corosRecord(2, "Half Marathon", 21097.5),
        ...corosRecord(13, "Marathon", 42195)
      ]
    }
  ];

  // VO2max: a whole number, as COROS states it, read every few days from the
  // first week and climbing as the fitness does — Good for his age from the
  // start, Excellent once the marathon year had done its work.
  const firstVo2 = 45;
  // Their own seeds, so what the routine drew this week does not move them.
  const vo2Random = seeded(45);
  const vo2Readings: Array<{ day: string; value: number }> = [];
  for (let daysAgo = at(0, 4); daysAgo >= 1; daysAgo -= 3) {
    const week = Math.floor((firstMonday - daysAgo) / 7);
    const value =
      daysAgo === at(0, 4)
        ? firstVo2
        : Math.min(firstVo2 + 4, Math.round(firstVo2 + 4.2 * fitnessAt(week) ** 1.6 + (vo2Random() - 0.5) * 0.8));
    vo2Readings.push({ day: history.day(daysAgo), value });
  }

  // Sleep, every night since the watch: around seven hours, more at the
  // weekend and in the weeks a race is tapered for, and short on a race
  // morning's early start.
  const raceMornings = new Set(
    LIVED_KEY_SESSIONS.filter((session) => /Marathon|10K|50K/.test(session.name)).map((session) =>
      history.day(at(session.week, session.weekday))
    )
  );
  const tapers = new Set([63, 64, 65, 66, 109, 110, 111, 112]);
  const sleepRandom = seeded(420);
  const sleepNights: Array<{ day: string; minutes: number }> = [];
  // The first night is the one after the first run.
  for (let daysAgo = at(0, 2); daysAgo >= 1; daysAgo -= 1) {
    const day = history.day(daysAgo);
    const weekday = history.date(daysAgo).getDay();
    const week = Math.floor((firstMonday - daysAgo) / 7);
    const minutes = raceMornings.has(day)
      ? 290 + sleepRandom() * 40
      : 428 + (weekday === 0 || weekday === 6 ? 22 : 0) + (tapers.has(week) ? 28 : 0) + (sleepRandom() + sleepRandom() + sleepRandom() - 1.5) * 52;
    sleepNights.push({ day, minutes: Math.round(minutes) });
  }

  const planDay = (week: number, weekday: number) => history.day(at(week, weekday));
  const remembered: RememberedMilestone[] = [
    { id: "plan:sample-lived-half", kind: "plan", day: planDay(34, 6), data: { name: "Half marathon plan", weeks: 10, ratio: 0.88, done: 35, settled: 40 } },
    { id: "plan:sample-lived-marathon", kind: "plan", day: planDay(66, 6), data: { name: "Marathon plan", weeks: 16, ratio: 0.84, done: 54, settled: 64 } }
  ];

  return {
    activities: history.activities,
    summaries: history.summaries,
    personalRecords,
    vo2Readings,
    sleepNights,
    remembered,
    placeLabels: history.placeLabels,
    athlete: { birthday: birthdayAged(today, 31, "0923"), sex: 0 }
  };
}

// --- First weeks ------------------------------------------------------------------------

function firstWeeks(today: string): RecordsSampleInput {
  const history = new SampleHistory(today);
  const run = (daysAgo: number, distance: number, name = "Easy run") =>
    history.add({
      daysAgo,
      hour: 6,
      sportType: 100,
      name,
      distance,
      duration: (distance / 1000) * 400,
      climb: 30,
      place: "hanoi",
      efforts: effortsAt(distance, 400)
    });
  run(22, 5200, "First run");
  run(20, 6000);
  history.add({ daysAgo: 18, hour: 18, sportType: 402, name: "Strength", duration: 2700 });
  run(17, 7000);
  run(15, 10100, "Sunday long run");
  history.add({ daysAgo: 13, hour: 6, sportType: 200, name: "First ride", distance: 25000, duration: 3600, climb: 120, place: "hanoi" });
  history.add({ daysAgo: 11, hour: 5, sportType: 104, name: "Hàm Lợn", distance: 8000, duration: 3 * 3600, climb: 420, place: "hanoi" });
  run(10, 6000);
  history.add({ daysAgo: 8, hour: 18, sportType: 402, name: "Strength", duration: 2700 });
  run(6, 8000);
  run(4, 12000, "Long run");
  history.add({ daysAgo: 2, hour: 6, sportType: 200, name: "Ride to Sóc Sơn", distance: 35000, duration: 5000, climb: 180, place: "hanoi" });

  // A first week of good nights since the watch, then one cut short.
  const sleepNights: Array<{ day: string; minutes: number }> = [];
  for (let daysAgo = 12; daysAgo >= 1; daysAgo -= 1) {
    sleepNights.push({ day: history.day(daysAgo), minutes: daysAgo === 4 ? 360 : 425 + (daysAgo % 3) * 15 });
  }
  return {
    activities: history.activities,
    summaries: history.summaries,
    personalRecords: [],
    vo2Readings: [
      { day: history.day(12), value: 46.0 },
      { day: history.day(3), value: 46.8 }
    ],
    sleepNights,
    remembered: [],
    placeLabels: history.placeLabels,
    athlete: { birthday: birthdayAged(today, 27, "0305"), sex: 0 }
  };
}

/** The history a preset stands for, built back from `today` (`YYYYMMDD`). */
export function sampleRecordsInput(preset: RecordsSamplePreset, today: string): RecordsSampleInput {
  if (preset === "realistic") return livedHistory(today);
  if (preset === "full") return fullHistory(today);
  if (preset === "beginner") return firstWeeks(today);
  return { activities: [], summaries: new Map(), personalRecords: [], vo2Readings: [], sleepNights: [], remembered: [], placeLabels: {} };
}
