// The Hall of Records' arithmetic: what the athlete is told they did, and the
// Twelve Labours read off it (src/records/milestones.ts, src/records/labours.ts).
//
// The rules worth holding down are the ones a screenshot would not show
// wrong: an id is the fact and not the moment (computing twice changes
// nothing, which is what "New" and the notifications are keyed on); a ladder
// distance fires once and with GPS's slack; a record is an *improvement*, so a
// first effort at a distance is none — except COROS's own current record,
// which is shown however little the backfill has reached; one milestone may
// reach several labour stages at once; a remembered fact outranks a source
// that has forgotten it.
//
// Runs under Electron for the reason test-hike-metrics does: this repo's Node
// is built without Amaro, and the module graph has extensionless imports.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const moduleUrl = (...parts) =>
  `${pathToFileURL(path.join(repoRoot, "src", ...parts)).href}${bust}`;

const records = await import(moduleUrl("records", "milestones.ts"));
const labours = await import(moduleUrl("records", "labours.ts"));
const { computeRecords, needsRecordsSummary, weekOf, dayOfEpochSeconds } = records;
const { buildLabours, LABOURS } = labours;

assert.equal(LABOURS.length, 12, "twelve labours");
assert.equal(new Set(LABOURS.map((labour) => labour.id)).size, 12, "each its own");

let nextId = 0;
/** Epoch seconds of a local morning. */
const at = (year, month, day, hour = 7) => Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000);
function activity(when, sportType, fields = {}) {
  nextId += 1;
  return {
    activityId: `a${nextId}`,
    name: `Session ${nextId}`,
    sportType,
    startTime: when,
    duration: 3600,
    distance: 10000,
    elevationGain: 50,
    ...fields
  };
}
const ids = (result) => result.milestones.map((milestone) => milestone.id);
const find = (result, id) => result.milestones.find((milestone) => milestone.id === id);
const base = { summaries: new Map(), unitSystem: "metric", today: "20261002" };

// --- Firsts and the distance ladder ---------------------------------------------

const firstRun = activity(at(2025, 3, 12), 100, { distance: 5200, duration: 2058 });
const shortHalf = activity(at(2025, 4, 6), 100, { distance: 20800 });
const half = activity(at(2025, 10, 19), 100, { distance: 21010, duration: 7540 });
const secondHalf = activity(at(2025, 11, 2), 100, { distance: 21300 });
const firstRide = activity(at(2025, 8, 10), 200, { distance: 32000 });
const longRide = activity(at(2026, 8, 23), 200, { distance: 102600 });
const swim = activity(at(2025, 5, 3), 301, { distance: 1600 });
const ladder = computeRecords({
  ...base,
  activities: [secondHalf, half, firstRun, shortHalf, firstRide, longRide, swim]
});

assert.equal(find(ladder, "start").activity.activityId, firstRun.activityId, "the beginning is the oldest activity, whatever order they arrive in");
assert.ok(find(ladder, "first:run"));
assert.equal(find(ladder, "first:ride").labour.id, "birds", "a first ride is the Birds' first stage");
assert.deepEqual(find(ladder, "first:swim").labour, { id: "hydra", stage: 1 });
assert.ok(find(ladder, "first:openwater"), "an open-water swim is a first of its own");
assert.deepEqual(find(ladder, "distance:swim:1500").labour, { id: "hydra", stage: 2 });
const halfMilestone = find(ladder, "distance:run:half");
assert.equal(
  halfMilestone.activity.activityId,
  half.activityId,
  "21.0 km is a half on GPS, 20.8 km is not"
);
assert.deepEqual(halfMilestone.labour, { id: "bull", stage: 1 });
assert.ok(halfMilestone.major, "a half is a card, not a row");
assert.equal(
  ids(ladder).filter((id) => id === "distance:run:half").length,
  1,
  "and fires once — a second half is no first"
);
assert.deepEqual(find(ladder, "distance:ride:100k").labour, { id: "birds", stage: 2 });

// The order is the timeline's: oldest first, ties by the time of day.
const days = ladder.milestones.map((milestone) => milestone.day);
assert.deepEqual(days, [...days].sort(), "oldest first");

// --- An id is the fact, not the moment ----------------------------------------------

const again = computeRecords({
  ...base,
  activities: [firstRun, shortHalf, half, secondHalf, firstRide, longRide, swim]
});
assert.deepEqual(ids(again), ids(ladder), "computing twice gives the same milestones");

// --- Longest yet waits for a history -----------------------------------------------

// Twelve runs creeping up to 7.1 km, then an 8 km one: past ten runs and more
// than 10% beyond the longest, and short of the 10K a ladder step would claim.
const runs = Array.from({ length: 12 }, (_, index) =>
  activity(at(2026, 1, 1 + index * 2), 100, { distance: 6000 + index * 100 })
);
runs.push(activity(at(2026, 2, 1), 100, { distance: 8000 }));
const longest = computeRecords({ ...base, activities: runs });
const longestIds = ids(longest).filter((id) => id.startsWith("longest:run"));
assert.equal(longestIds.length, 1, "only past ten runs, and only 10% beyond the last longest");
assert.equal(longestIds[0], `longest:run:${runs[runs.length - 1].activityId}`);

// --- Streaks -------------------------------------------------------------------------------

const weekly = [];
for (let week = 0; week < 4; week += 1) weekly.push(activity(at(2026, 6, 1 + week * 7), 100));
// A gap, then four again: the same streak length is no new milestone.
for (let week = 0; week < 4; week += 1) weekly.push(activity(at(2026, 7, 13 + week * 7), 100));
const streaks = computeRecords({ ...base, activities: weekly, today: "20260808" });
assert.equal(ids(streaks).filter((id) => id === "streak:weeks:4").length, 1);
const four = find(streaks, "streak:weeks:4");
assert.equal(four.day, "20260622", "reached in the fourth week, on its first session");
assert.deepEqual(four.labour, { id: "hind", stage: 1 });
assert.equal(weekOf("20260808"), "20260803", "weeks start on a Monday");

// --- Lifetime, strength and climbing --------------------------------------------------------

const long = Array.from({ length: 101 }, (_, index) =>
  activity(at(2024, 1, 1) + index * 86400, 402, { duration: 3600, distance: 0, elevationGain: 0 })
);
const volume = computeRecords({ ...base, activities: long });
assert.deepEqual(find(volume, "lifetime:hours:100").labour, { id: "stables", stage: 1 });
assert.deepEqual(find(volume, "lifetime:strength:50").labour, { id: "lion", stage: 2 });
assert.deepEqual(find(volume, "lifetime:strength:100").labour, { id: "lion", stage: 3 });
assert.equal(find(volume, "lifetime:activities:100").category, "lifetime");

const climbs = computeRecords({
  ...base,
  activities: [
    activity(at(2026, 9, 6), 104, { elevationGain: 1612 }),
    ...Array.from({ length: 6 }, (_, index) =>
      activity(at(2026, 9, 10 + index), 104, { elevationGain: 1300 })
    )
  ]
});
assert.deepEqual(find(climbs, "climb:500").labour, { id: "boar", stage: 1 });
assert.deepEqual(find(climbs, "climb:1500").labour, { id: "boar", stage: 2 });
assert.equal(find(climbs, "climb:500").activity.activityId, find(climbs, "climb:1500").activity.activityId, "one big day reaches both");
const everest = find(climbs, "climb:month:everest");
assert.deepEqual(everest.labour, { id: "boar", stage: 3 }, "8,849 m inside one month");
assert.equal(everest.day, "20260915", "reached on the session that crossed it");

// --- Records -----------------------------------------------------------------------------------

const r1 = activity(at(2025, 4, 26), 100);
const r2 = activity(at(2025, 6, 14), 100);
const r3 = activity(at(2026, 6, 20), 100);
const r4 = activity(at(2026, 9, 13), 100);
const glitch = activity(at(2026, 9, 20), 100);
const summaries = new Map([
  [r1.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 5000, seconds: 1500 }, { distance: 10000, seconds: 3200 }, { distance: 21097.5, seconds: 7600 }] }],
  [r2.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 5000, seconds: 1440 }] }],
  [r3.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 10000, seconds: 3100 }] }],
  [r4.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 21097.5, seconds: 6571 }] }],
  [glitch.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 5000, seconds: 900 }] }]
]);
const prs = computeRecords({
  ...base,
  activities: [r1, r2, r3, r4, glitch],
  summaries,
  personalRecords: [
    {
      type: 4,
      label: "All",
      records: [
        { type: 5, label: "5K", duration: 1430, happenDay: "20250614", activityId: r2.activityId },
        { type: 13, label: "Marathon", duration: 15668, happenDay: "20260927", activityId: "not-in-the-list" }
      ]
    }
  ]
});
const prIds = ids(prs).filter((id) => id.startsWith("pr:"));
assert.deepEqual(
  prIds,
  [`pr:5000:${r2.activityId}`, `pr:10000:${r3.activityId}`, `pr:21097.5:${r4.activityId}`],
  "a first effort at a distance beats nothing; each later one that is faster is a record"
);
assert.equal(
  find(prs, `pr:5000:${r2.activityId}`).title,
  "New 5K record — 23:50",
  "COROS's figure stands in for ours where it names the same run"
);
assert.ok(!prIds.includes(`pr:5000:${glitch.activityId}`), "an effort far under COROS's own record is a GPS fault");
assert.deepEqual(find(prs, `pr:5000:${r2.activityId}`).labour, { id: "mares", stage: 1 });
assert.deepEqual(
  find(prs, `pr:10000:${r3.activityId}`).labour,
  { id: "mares", stage: 3 },
  "the 10K record had stood over a year"
);
assert.deepEqual(
  find(prs, `pr:21097.5:${r4.activityId}`).labour,
  { id: "mares", stage: 2 },
  "the half completes the set of three"
);
assert.match(find(prs, `pr:21097.5:${r4.activityId}`).detail, /^17:09 faster than the record from 26 Apr 2025/);

const corosOnly = computeRecords({
  ...base,
  activities: [r2],
  personalRecords: [
    { type: 4, label: "All", records: [{ type: 5, label: "5K", duration: 1430, happenDay: "20250614", activityId: r2.activityId }] }
  ]
});
assert.equal(
  find(corosOnly, `pr:5000:${r2.activityId}`).title,
  "Your 5K record — 23:50",
  "before any backfill, COROS's current record is still on the timeline"
);
assert.equal(find(corosOnly, `pr:5000:${r2.activityId}`).labour, undefined, "but it improved nothing, so it is no labour stage");

// --- VO2max, and what is remembered ---------------------------------------------------------------

const vo2 = computeRecords({
  ...base,
  activities: [],
  vo2Readings: [
    { day: "20250312", value: 45.0 },
    { day: "20250501", value: 46.2 },
    { day: "20250601", value: 46.8 },
    { day: "20250901", value: 47.1 },
    { day: "20260922", value: 50.4 }
  ]
});
assert.deepEqual(ids(vo2), ["vo2max:first", "vo2max:high:46", "vo2max:high:47", "vo2max:high:50"]);
assert.deepEqual(find(vo2, "vo2max:high:47").labour, { id: "apples", stage: 2 });
assert.deepEqual(find(vo2, "vo2max:high:50").labour, { id: "apples", stage: 3 }, "a jump of three whole points is one new high");
assert.deepEqual(
  vo2.toRemember.find((row) => row.id === "vo2max:first"),
  { id: "vo2max:first", kind: "vo2max", day: "20250312", data: { value: 45 } },
  "the reading COROS will forget in a year is handed back to be kept"
);

// A year on, COROS has forgotten March; the remembered first still anchors it.
const later = computeRecords({
  ...base,
  activities: [],
  vo2Readings: [{ day: "20260922", value: 50.4 }],
  remembered: vo2.toRemember
});
assert.equal(find(later, "vo2max:first").day, "20250312");
assert.deepEqual(
  ids(later),
  ids(vo2),
  "the same milestones, from the memory and what is left"
);

const together = computeRecords({
  ...base,
  activities: [],
  vo2Readings: [
    { day: "20250312", value: 45.5 },
    { day: "20250601", value: 47.4 },
    { day: "20250701", value: 47.6 }
  ]
});
assert.deepEqual(
  find(together, "vo2max:plus:2").labour,
  { id: "apples", stage: 2 },
  "+2 reached without a new whole number still reaches the stage"
);

// --- Sleep ----------------------------------------------------------------------------------------

const nights = [];
for (let day = 1; day <= 9; day += 1) nights.push({ day: `202608${String(day).padStart(2, "0")}`, minutes: day === 3 ? 380 : 450 });
const sleep = computeRecords({ ...base, activities: [], sleepNights: nights, today: "20260810" });
assert.deepEqual(find(sleep, "sleep:first").labour, { id: "cerberus", stage: 1 });
assert.equal(find(sleep, "sleep:streak:7"), undefined, "a short night breaks the run");
const sleep2 = computeRecords({
  ...base,
  activities: [],
  sleepNights: nights.map((night) => ({ ...night, minutes: 450 })),
  today: "20260810"
});
assert.equal(find(sleep2, "sleep:streak:7").day, "20260807");
assert.deepEqual(find(sleep2, "sleep:streak:7").labour, { id: "cerberus", stage: 2 });
const kept = computeRecords({
  ...base,
  activities: [],
  sleepNights: [],
  remembered: [{ id: "sleep:streak:30", kind: "sleep", day: "20250430", data: { nights: 30 } }]
});
assert.deepEqual(
  find(kept, "sleep:streak:30").labour,
  { id: "cerberus", stage: 3 },
  "a run of nights this machine never saw still stands"
);

// --- Plans ------------------------------------------------------------------------------------------

const plans = computeRecords({
  ...base,
  activities: [],
  remembered: [
    { id: "plan:a", kind: "plan", day: "20251130", data: { name: "Base", weeks: 6, ratio: 0.82, done: 18, settled: 22 } },
    { id: "plan:b", kind: "plan", day: "20260816", data: { name: "Build", weeks: 12, ratio: 0.91, done: 43, settled: 47 } }
  ]
});
assert.deepEqual(find(plans, "plan:a").labour, { id: "girdle", stage: 1 });
assert.deepEqual(
  find(plans, "plan:b").labour,
  { id: "girdle", stage: 3, also: [2] },
  "a 12-week plan at 91% reaches the second and third stages at once"
);

// --- Places -----------------------------------------------------------------------------------------

const homeRuns = Array.from({ length: 6 }, (_, index) => activity(at(2026, 1, 2 + index), 100));
const away = [
  activity(at(2026, 2, 1), 100),
  activity(at(2026, 3, 1), 100),
  activity(at(2026, 4, 1), 100),
  activity(at(2026, 5, 1), 104),
  activity(at(2026, 7, 9), 100),
  activity(at(2026, 8, 1), 100)
];
const placeSummaries = new Map([
  ...homeRuns.map((run) => [run.activityId, { recordsVersion: 1, startPoint: { lat: 21.03, lon: 105.8 } }]),
  [away[0].activityId, { recordsVersion: 1, startPoint: { lat: 20.95, lon: 107.08 } }],
  [away[1].activityId, { recordsVersion: 1, startPoint: { lat: 22.34, lon: 103.84 } }],
  [away[2].activityId, { recordsVersion: 1, startPoint: { lat: 21.13, lon: 105.36 } }],
  [away[3].activityId, { recordsVersion: 1, startPoint: { lat: 21.45, lon: 105.64 } }],
  [away[4].activityId, { recordsVersion: 1, startPoint: { lat: 18.79, lon: 98.98 } }],
  [away[5].activityId, { recordsVersion: 1, startPoint: { lat: 48.86, lon: 2.35 } }]
]);
const placesFirst = computeRecords({ ...base, activities: [...homeRuns, ...away], summaries: placeSummaries });
const homeKey = placesFirst.places[0].key;
assert.equal(placesFirst.places[0].count, 6, "home is the busiest cell");
assert.deepEqual(find(placesFirst, "place:count:5").labour, { id: "cattle", stage: 1 });
assert.ok(!ids(placesFirst).some((id) => id.startsWith("place:country:")), "no country is named until the geocoder has answered");
const named = computeRecords({
  ...base,
  activities: [...homeRuns, ...away],
  summaries: placeSummaries,
  placeLabels: {
    [homeKey]: { city: "Hà Nội", country: "Việt Nam" },
    [placesFirst.places.find((cell) => cell.lat === 18.79).key]: { city: "Chiang Mai", country: "Thailand" }
  }
});
assert.deepEqual(find(named, "place:country:thailand").labour, { id: "cattle", stage: 2 });
assert.ok(!find(named, "place:country:việt-nam"), "home is no new country");
assert.deepEqual(find(named, "place:pillars").labour, { id: "cattle", stage: 3 }, "Paris is past the Pillars from Hà Nội");

// --- The labours ------------------------------------------------------------------------------------

const all = computeRecords({
  ...base,
  activities: [...long, firstRun, half],
  vo2Readings: [{ day: "20250312", value: 45 }, { day: "20260901", value: 46.6 }]
});
const states = buildLabours(all.milestones, all.progress);
const lion = states.find((state) => state.definition.id === "lion");
assert.equal(lion.reached, 3, "first session, 50 and 100");
assert.ok(lion.complete);
const apples = states.find((state) => state.definition.id === "apples");
assert.equal(apples.reached, 1);
assert.equal(apples.stages[1].progress.text, "46.6 / 47");
assert.ok(Math.abs(apples.stages[1].progress.ratio - 0.8) < 1e-9);
assert.ok(
  all.withinReach.some((entry) => entry.id === "apples:2" && entry.label === "Hesperides · II"),
  "a stage 80% there is within reach, labelled by its labour"
);
assert.ok(all.withinReach.length <= 3);
assert.ok(
  all.withinReach.every((entry, index, list) => index === 0 || list[index - 1].ratio >= entry.ratio),
  "closest first"
);
assert.ok(
  !all.withinReach.some((entry) => entry.id === "bull:3"),
  "only the first open stage of a labour is offered"
);

// --- What still needs a detail fetch ------------------------------------------------------------------

assert.equal(needsRecordsSummary({ sportType: 100, distance: 5000 }, undefined), true);
assert.equal(needsRecordsSummary({ sportType: 100, distance: 5000 }, { recordsVersion: 1 }), false);
assert.equal(needsRecordsSummary({ sportType: 101, distance: 5000 }, undefined), false, "a treadmill has no start and no record");
assert.equal(needsRecordsSummary({ sportType: 402, distance: 0 }, undefined), false);
assert.equal(needsRecordsSummary({ sportType: 200, distance: 30000 }, {}), true, "a ride's start is a place");

// --- Imperial ------------------------------------------------------------------------------------------

const miles = computeRecords({
  ...base,
  unitSystem: "imperial",
  activities: Array.from({ length: 18 }, (_, index) => activity(at(2026, 1, 1 + index), 100, { distance: 10000 }))
});
assert.ok(find(miles, "lifetime:run:100mi"), "a lifetime distance is counted in the athlete's own unit");
assert.equal(dayOfEpochSeconds(at(2026, 1, 1)), "20260101");

console.log("records: OK");
