// Sample histories for the Hall of Records, for seeing everything it can draw
// without an account that happens to have done all of it.
//
// Picked from the developer toolbar's Sample menu (development builds only),
// like the Strength screen's sample: renderer state, nothing written anywhere.
// The hall computes its milestones from these exactly as it does from COROS —
// `computeRecords` is not told — so what is on screen is what the rules make of
// such a history, not a picture of one.
//
// Three presets, each built back from today so the dates stay current:
//
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

export type RecordsSamplePreset = "full" | "beginner" | "empty";

export const RECORDS_SAMPLE_PRESETS: ReadonlyArray<{
  value: RecordsSamplePreset;
  label: string;
  title: string;
}> = [
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
  chiangmai: { lat: 18.79, lon: 98.98, label: { city: "Chiang Mai", country: "Thailand", countryCode: "TH" } }
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
  // swim and a trek that makes the month an Everest — and a new country.
  const trekDay = 3;
  const monthStart = history.date(trekDay);
  const daysIntoMonth = monthStart.getDate() - 1;
  const trekDays = [Math.min(trekDay + 6, trekDay + daysIntoMonth), Math.min(trekDay + 4, trekDay + daysIntoMonth), Math.min(trekDay + 2, trekDay + daysIntoMonth), trekDay];
  trekDays.forEach((daysAgo, index) => {
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

  // VO2max: a first reading, new highs, one step past +2 that is no new whole
  // number (the "+2" row), and a peak just short of +5.
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

  // The first plan finished is eight weeks long, so it reaches the Girdle's
  // first two stages at once: one milestone carrying two.
  const remembered: RememberedMilestone[] = [
    { id: "plan:sample-10k", kind: "plan", day: dayOfWeek(48, 6), data: { name: "Spring 10K", weeks: 8, ratio: 0.88, done: 28, settled: 32 } },
    { id: "plan:sample-marathon", kind: "plan", day: dayOfWeek(60, 6), data: { name: "Marathon block", weeks: 12, ratio: 0.93, done: 52, settled: 56 } },
    { id: "plan:sample-trail", kind: "plan", day: dayOfWeek(99, 6), data: { name: "Trail prep", weeks: 6, ratio: 0.81, done: 21, settled: 26 } }
  ];

  return {
    activities: history.activities,
    summaries: history.summaries,
    personalRecords,
    vo2Readings,
    sleepNights,
    remembered,
    placeLabels: history.placeLabels
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

  const sleepNights: Array<{ day: string; minutes: number }> = [];
  for (let daysAgo = 12; daysAgo >= 1; daysAgo -= 1) {
    sleepNights.push({ day: history.day(daysAgo), minutes: daysAgo === 4 ? 360 : 410 + (daysAgo % 3) * 20 });
  }
  return {
    activities: history.activities,
    summaries: history.summaries,
    personalRecords: [],
    vo2Readings: [
      { day: history.day(15), value: 46.0 },
      { day: history.day(3), value: 46.8 }
    ],
    sleepNights,
    remembered: [],
    placeLabels: history.placeLabels
  };
}

/** The history a preset stands for, built back from `today` (`YYYYMMDD`). */
export function sampleRecordsInput(preset: RecordsSamplePreset, today: string): RecordsSampleInput {
  if (preset === "full") return fullHistory(today);
  if (preset === "beginner") return firstWeeks(today);
  return { activities: [], summaries: new Map(), personalRecords: [], vo2Readings: [], sleepNights: [], remembered: [], placeLabels: {} };
}
