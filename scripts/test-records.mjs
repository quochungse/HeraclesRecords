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
// And a labour stage is a standard, never a first and never a gain on the
// athlete's own past: a beginner beats their own records every week and an
// athlete at the top hardly ever does, so speed is age graded and VO2max rated
// for age and sex — the same bar for everyone of that age.
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
assert.equal(find(ladder, "first:run"), undefined, "the beginning is also the first run — one milestone, not two");
assert.equal(find(ladder, "start").sport, "run");
assert.equal(find(ladder, "first:ride").labour, undefined, "a first is a milestone, never a labour stage");
assert.equal(find(ladder, "first:swim").labour, undefined);
const fiftyRidden = find(ladder, "lifetime:ride:50km");
assert.equal(
  fiftyRidden.activity.activityId,
  longRide.activityId,
  "the Birds' first stage is 50 km ridden all told: 32 km, then the ride that passes it"
);
assert.deepEqual(fiftyRidden.labour, { id: "birds", stage: 1 });
assert.ok(find(ladder, "first:openwater"), "an open-water swim is a first of its own");
assert.deepEqual(find(ladder, "distance:swim:500").labour, { id: "hydra", stage: 1 }, "500 m in one swim, even the first");
assert.equal(find(ladder, "distance:swim:1k"), undefined, "a first swim past 1 km is one milestone, not another row");
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
for (let week = 0; week < 8; week += 1) weekly.push(activity(at(2026, 4, 6 + week * 7), 100));
// A gap, then four again: the same streak length is no new milestone.
for (let week = 0; week < 4; week += 1) weekly.push(activity(at(2026, 7, 13 + week * 7), 100));
const streaks = computeRecords({ ...base, activities: weekly, today: "20260808" });
assert.equal(ids(streaks).filter((id) => id === "streak:weeks:4").length, 1);
assert.equal(find(streaks, "streak:weeks:4").labour, undefined, "four weeks is a milestone, not yet a stage");
const eight = find(streaks, "streak:weeks:8");
assert.equal(eight.day, "20260525", "reached in the eighth week, on its first session");
assert.deepEqual(eight.labour, { id: "hind", stage: 1 });
assert.equal(weekOf("20260808"), "20260803", "weeks start on a Monday");

// --- Lifetime, strength and climbing --------------------------------------------------------

// A strength session a day for 201 days, and on the first five days a second
// one: a workout split into a session per muscle group is still one day.
const long = [
  ...Array.from({ length: 201 }, (_, index) =>
    activity(at(2024, 1, 1) + index * 86400, 402, { duration: 3600, distance: 0, elevationGain: 0 })
  ),
  ...Array.from({ length: 5 }, (_, index) =>
    activity(at(2024, 1, 1, 18) + index * 86400, 402, { duration: 3600, distance: 0, elevationGain: 0 })
  )
];
const volume = computeRecords({ ...base, activities: long });
assert.deepEqual(find(volume, "lifetime:hours:50").labour, { id: "stables", stage: 1 });
assert.equal(find(volume, "lifetime:hours:100").labour, undefined);
assert.deepEqual(find(volume, "lifetime:strength:20").labour, { id: "lion", stage: 1 });
assert.equal(find(volume, "lifetime:strength:50").labour, undefined);
assert.deepEqual(find(volume, "lifetime:strength:100").labour, { id: "lion", stage: 2 });
const lionThree = find(volume, "lifetime:strength:200");
assert.deepEqual(lionThree.labour, { id: "lion", stage: 3 });
assert.equal(lionThree.day, dayOfEpochSeconds(at(2024, 1, 1) + 199 * 86400), "the 200th day, not the 200th session");
assert.equal(lionThree.title, "200 days of strength training");
assert.equal(lionThree.detail, "205 sessions in all");
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
assert.equal(find(climbs, "climb:500").labour, undefined, "500 m is a milestone, not yet a stage");
assert.deepEqual(find(climbs, "climb:750").labour, { id: "boar", stage: 1 });
assert.deepEqual(find(climbs, "climb:1500").labour, { id: "boar", stage: 2 });
assert.equal(find(climbs, "climb:750").activity.activityId, find(climbs, "climb:1500").activity.activityId, "one big day reaches both");
const everest = find(climbs, "climb:30days:everest");
assert.deepEqual(everest.labour, { id: "boar", stage: 3 }, "8,849 m inside thirty days");
assert.equal(everest.day, "20260915", "reached on the session that crossed it");

// Thirty days running, not a calendar month: a trek across the first of the
// month is one Everest, and the same climbing spread wider is none.
const acrossMonths = computeRecords({
  ...base,
  activities: [
    activity(at(2026, 8, 20), 104, { elevationGain: 2500 }),
    activity(at(2026, 8, 28), 104, { elevationGain: 2500 }),
    activity(at(2026, 9, 3), 104, { elevationGain: 2500 }),
    activity(at(2026, 9, 8), 104, { elevationGain: 1500 })
  ]
});
assert.equal(find(acrossMonths, "climb:30days:everest").day, "20260908", "August and September together");
const spread30 = computeRecords({
  ...base,
  activities: [0, 15, 30, 45].map((days) => activity(at(2026, 6, 1) + days * 86400, 104, { elevationGain: 2500 }))
});
assert.equal(find(spread30, "climb:30days:everest"), undefined, "never more than two of them inside thirty days");
assert.equal(
  buildLabours(spread30.milestones, spread30.progress).find((state) => state.definition.id === "boar").stages[2].progress.text,
  "Best 30 days 5,000 m"
);

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
  [`pr:${r2.activityId}`, `pr:${r3.activityId}`, `pr:${r4.activityId}`],
  "a first effort at a distance beats nothing; each later run that is faster is a record"
);
assert.equal(
  find(prs, `pr:${r2.activityId}`).title,
  "New 5K record — 23:50",
  "COROS's figure stands in for ours where it names the same run"
);
assert.ok(!prIds.includes(`pr:${glitch.activityId}`), "an effort far under COROS's own record is a GPS fault");
assert.match(find(prs, `pr:${r4.activityId}`).detail, /^17:09 faster than the record from 26 Apr 2025/);

const corosOnly = computeRecords({
  ...base,
  activities: [r2],
  personalRecords: [
    { type: 4, label: "All", records: [{ type: 5, label: "5K", duration: 1430, happenDay: "20250614", activityId: r2.activityId }] }
  ]
});
const current = find(corosOnly, `pr:${r2.activityId}`);
assert.equal(
  current.title,
  "Your 5K record — 23:50",
  "before any backfill, COROS's current record is still on the timeline"
);
assert.deepEqual(
  current.labour,
  { id: "mares", stage: 1 },
  "it improved nothing, but the Mares grade speed rather than count gains: 23:50 is 53.7% for a man of 30"
);
assert.match(current.context, /5K in 23:50: a 53\.7% age grade\./, "and the record's own row says so, rather than a second one");
assert.equal(find(corosOnly, `speed:${r2.activityId}`), undefined);

// Once the backfill reads what came before, it is the same milestone: the same
// id, so it is not news twice — and, set in the first weeks at the distance,
// it stays on the timeline as the record standing rather than leaving it.
const early = activity(at(2025, 6, 1), 100);
const backfilled = computeRecords({
  ...base,
  activities: [early, r2],
  summaries: new Map([[early.activityId, { recordsVersion: 2, bestEfforts: [{ distance: 5000, seconds: 1500 }] }]]),
  personalRecords: [
    { type: 4, label: "All", records: [{ type: 5, label: "5K", duration: 1430, happenDay: "20250614", activityId: r2.activityId }] }
  ]
});
assert.deepEqual(
  ids(backfilled).filter((id) => id.startsWith("pr:") || id.startsWith("record:")),
  [`pr:${r2.activityId}`],
  "one record milestone, under the id it had before the backfill"
);
assert.equal(find(backfilled, `pr:${r2.activityId}`).title, "Your 5K record — 23:50");

// A beginner breaks a record every other run. The first four weeks at a
// distance set the bar; a gain under 1% is noise; one run's records are one
// milestone.
const b1 = activity(at(2026, 7, 9), 100);
const b2 = activity(at(2026, 7, 15), 100);
const b3 = activity(at(2026, 8, 18), 100);
const b4 = activity(at(2026, 8, 25), 100);
const beginner = computeRecords({
  ...base,
  activities: [b1, b2, b3, b4],
  summaries: new Map([
    [b1.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 1000, seconds: 400 }, { distance: 5000, seconds: 2200 }] }],
    [b2.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 1000, seconds: 380 }, { distance: 5000, seconds: 2100 }] }],
    [b3.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 1000, seconds: 350 }, { distance: 5000, seconds: 1900 }] }],
    [b4.activityId, { recordsVersion: 1, bestEfforts: [{ distance: 1000, seconds: 348 }, { distance: 5000, seconds: 1800 }] }]
  ])
});
assert.deepEqual(
  ids(beginner).filter((id) => id.startsWith("pr:")),
  [`pr:${b3.activityId}`, `pr:${b4.activityId}`],
  "nothing in the first four weeks at a distance"
);
assert.equal(find(beginner, `pr:${b3.activityId}`).title, "New 1K and 5K records", "one run, one milestone");
assert.match(find(beginner, `pr:${b3.activityId}`).detail, /^1K 5:50 · 5K 31:40$/);
assert.equal(
  find(beginner, `pr:${b4.activityId}`).title,
  "New 5K record — 30:00",
  "2 s off a 5:50 kilometre is under 1%, so only the 5K counts"
);
assert.ok(
  beginner.milestones.every((milestone) => milestone.labour?.id !== "mares"),
  "a beginner's records are milestones, not the Mares: a 30:00 5K is a 42.7% age grade"
);

// --- The Mares: an age grade, the same bar for everyone of an age and sex -----------------

const fitness = await import(moduleUrl("records", "fitnessStandards.ts"));
// Spot checks against the WMA/USATF 2025 road tables.
assert.equal(Math.round(fitness.ageStandardSeconds(5000, 30, 0)), 769, "a man of 30 is graded against the open standard");
assert.equal(Math.round(fitness.ageStandardSeconds(5000, 50, 0)), 876, "a man of 50 against 769 s / 0.8775");
assert.equal(Math.round(fitness.ageStandardSeconds(5000, 30, 1)), 837, "a woman of 30 against 834 s / 0.9959");
assert.ok(fitness.ageGrade(5000, 1709, 30, 0) >= 0.45 && fitness.ageGrade(5000, 1710, 30, 0) < 0.45, "45% is a 28:29 5K at 30");
assert.equal(fitness.ageOnDay(19900615, "20260614"), 35);
assert.equal(fitness.ageOnDay(19900615, "20260615"), 36, "a birthday counts from its own day");
assert.equal(fitness.ageOnDay(undefined, "20260615"), 30, "no birthday on the profile reads as 30");
assert.equal(fitness.athleteSex(undefined), 0, "and no sex as male");

const m1 = activity(at(2026, 1, 10), 100);
const m2 = activity(at(2026, 3, 10), 100);
const m3 = activity(at(2026, 5, 10), 100);
const m4 = activity(at(2026, 8, 10), 100);
const maresSummaries = new Map([
  [m1.activityId, { recordsVersion: 2, bestEfforts: [{ distance: 1000, seconds: 300 }, { distance: 5000, seconds: 1900 }] }],
  [m2.activityId, { recordsVersion: 2, bestEfforts: [{ distance: 5000, seconds: 1700 }] }],
  [m3.activityId, { recordsVersion: 2, bestEfforts: [{ distance: 10000, seconds: 2630 }] }],
  [m4.activityId, { recordsVersion: 2, bestEfforts: [{ distance: 21097.5, seconds: 4900 }] }]
]);
const graded = computeRecords({ ...base, activities: [m1, m2, m3, m4], summaries: maresSummaries });
assert.ok(
  !graded.milestones.some((milestone) => milestone.activity?.activityId === m1.activityId && milestone.labour),
  "31:40 is 40.4%: no stage"
);
assert.deepEqual(find(graded, `pr:${m2.activityId}`).labour, { id: "mares", stage: 1 }, "28:20 is 45.2%, on the record's own row");
assert.equal(find(graded, `speed:${m2.activityId}`), undefined);
const tenK = find(graded, `speed:${m3.activityId}`);
assert.deepEqual(tenK.labour, { id: "mares", stage: 2 }, "a first 10K is no record, so the stage has a row of its own");
assert.equal(tenK.title, "10K in 43:50 — a 60.2% age grade");
const halfGraded = find(graded, `speed:${m4.activityId}`);
assert.deepEqual(halfGraded.labour, { id: "mares", stage: 3 });
assert.equal(halfGraded.title, "Half marathon in 1:21:40 — a 70.4% age grade");
assert.ok(halfGraded.major, "the last stage is a card");
assert.ok(buildLabours(graded.milestones, graded.progress).find((state) => state.definition.id === "mares").complete);

// The same 31:40 is no stage at 30 and the first at 60.
const sixty = computeRecords({
  ...base,
  activities: [m1],
  summaries: maresSummaries,
  athlete: { birthday: 19660101, sex: 0 }
});
assert.deepEqual(find(sixty, `speed:${m1.activityId}`).labour, { id: "mares", stage: 1 });
const thirtyOnly = computeRecords({ ...base, activities: [m1], summaries: maresSummaries });
const maresOpen = buildLabours(thirtyOnly.milestones, thirtyOnly.progress).find((state) => state.definition.id === "mares");
assert.equal(maresOpen.reached, 0);
assert.equal(maresOpen.stages[0].progress.text, "Best 40.4% · 5K in 31:40", "the 1K is not graded: too short to say");
assert.ok(Math.abs(maresOpen.stages[0].progress.ratio - fitness.ageGrade(5000, 1900, 30, 0) / 0.45) < 1e-9);

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
// No profile: a man of 30, rated Good from 44.0, Excellent from 48.3, Superior from 54.0.
assert.deepEqual(ids(vo2), ["vo2max:first", "vo2max:high:46", "vo2max:high:47", "vo2max:high:50"]);
assert.deepEqual(find(vo2, "vo2max:first").labour, { id: "apples", stage: 1 }, "rated Good on the first reading");
assert.equal(find(vo2, "vo2max:first").detail, "Good for your age");
assert.equal(find(vo2, "vo2max:high:47").labour, undefined, "a new high is no stage of itself");
assert.deepEqual(find(vo2, "vo2max:high:50").labour, { id: "apples", stage: 2 });
assert.match(find(vo2, "vo2max:high:50").detail, /^Excellent for your age · Up 5\.4/);
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
    { day: "20250312", value: 47.6 },
    { day: "20250601", value: 48.0 },
    { day: "20250701", value: 48.5 }
  ]
});
assert.equal(find(together, "vo2max:high:48").labour, undefined, "48.0 is under 48.3");
assert.deepEqual(
  find(together, "vo2max:rating:excellent").labour,
  { id: "apples", stage: 2 },
  "a rating reached without a new whole number still reaches the stage"
);

// Rated for the age and sex on the day: 40.2 is Excellent for a woman of 55,
// and an athlete at the top has all three from the first reading.
const fiftyFive = computeRecords({
  ...base,
  activities: [],
  athlete: { birthday: 19710301, sex: 1 },
  vo2Readings: [
    { day: "20260601", value: 40.2 },
    { day: "20260901", value: 41.5 }
  ]
});
assert.deepEqual(find(fiftyFive, "vo2max:first").labour, { id: "apples", stage: 2, also: [1] });
assert.deepEqual(find(fiftyFive, "vo2max:high:41").labour, { id: "apples", stage: 3 }, "Superior from 41.1");
const elite = computeRecords({ ...base, activities: [], vo2Readings: [{ day: "20260601", value: 71 }] });
assert.equal(find(elite, "vo2max:first").labour.stage, 3);
assert.deepEqual([...find(elite, "vo2max:first").labour.also].sort(), [1, 2]);

// --- Sleep ----------------------------------------------------------------------------------------

const nights = [];
for (let day = 1; day <= 9; day += 1) nights.push({ day: `202608${String(day).padStart(2, "0")}`, minutes: day === 3 ? 380 : 450 });
const sleep = computeRecords({ ...base, activities: [], sleepNights: nights, today: "20260810" });
assert.equal(find(sleep, "sleep:first").labour, undefined, "a first night is a milestone, not a stage");
assert.equal(find(sleep, "sleep:streak:7"), undefined, "a short night breaks the run");
const sleep2 = computeRecords({
  ...base,
  activities: [],
  sleepNights: nights.map((night) => ({ ...night, minutes: 450 })),
  today: "20260810"
});
assert.equal(find(sleep2, "sleep:streak:7").day, "20260807");
assert.deepEqual(find(sleep2, "sleep:streak:7").labour, { id: "cerberus", stage: 1 });

// 26 good nights of 30: four short ones are allowed, a fifth is not, and a
// night with nothing recorded is a miss like a short one.
const july = (short, missing = []) =>
  Array.from({ length: 30 }, (_, index) => index + 1)
    .filter((day) => !missing.includes(day))
    .map((day) => ({ day: `202607${String(day).padStart(2, "0")}`, minutes: short.includes(day) ? 380 : 440 }));
const month = computeRecords({ ...base, activities: [], sleepNights: july([3, 10, 17, 24]), today: "20260731" });
assert.equal(find(month, "sleep:window:30").day, "20260730");
assert.deepEqual(find(month, "sleep:window:30").labour, { id: "cerberus", stage: 2 });
assert.equal(
  find(computeRecords({ ...base, activities: [], sleepNights: july([3, 10, 17, 24, 28]), today: "20260731" }), "sleep:window:30"),
  undefined
);
assert.equal(
  find(computeRecords({ ...base, activities: [], sleepNights: july([3, 10, 17, 24], [28]), today: "20260731" }), "sleep:window:30"),
  undefined
);
const monthLabours = buildLabours(month.milestones, month.progress);
assert.equal(
  monthLabours.find((state) => state.definition.id === "cerberus").stages[2].progress.text,
  "26 / 300 of the last 365 nights"
);
const kept = computeRecords({
  ...base,
  activities: [],
  sleepNights: [],
  remembered: [{ id: "sleep:window:365", kind: "sleep", day: "20250430", data: { days: 365, good: 300 } }]
});
assert.deepEqual(
  find(kept, "sleep:window:365").labour,
  { id: "cerberus", stage: 3 },
  "a year of nights this machine never saw still stands"
);

// --- Plans ------------------------------------------------------------------------------------------

const plans = computeRecords({
  ...base,
  activities: [],
  remembered: [
    { id: "plan:a", kind: "plan", day: "20251130", data: { name: "Base", weeks: 4, ratio: 0.82, done: 10, settled: 12 } },
    { id: "plan:b", kind: "plan", day: "20260301", data: { name: "Build", weeks: 12, ratio: 0.84, done: 38, settled: 45 } },
    { id: "plan:c", kind: "plan", day: "20260816", data: { name: "Marathon", weeks: 16, ratio: 0.91, done: 58, settled: 64 } }
  ]
});
assert.deepEqual(find(plans, "plan:a").labour, { id: "girdle", stage: 1 }, "four weeks at 80% is the first stage");
assert.equal(find(plans, "plan:b").labour, undefined, "twelve weeks at 84% is short of the second");
assert.deepEqual(
  find(plans, "plan:c").labour,
  { id: "girdle", stage: 3, also: [2] },
  "a 16-week plan at 91% reaches the second and third stages at once"
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
// A place is what "Where you've been" draws (placeClusters.ts): one region,
// at most 25 km across. Without the region index, distance alone.
const placesFirst = computeRecords({ ...base, activities: [...homeRuns, ...away], summaries: placeSummaries });
assert.equal(placesFirst.places[0].count, 6, "home is the busiest place");
assert.equal(placesFirst.places.length, 7);
assert.deepEqual(find(placesFirst, "place:count:5").labour, { id: "cattle", stage: 1 });
assert.ok(!ids(placesFirst).some((id) => id.startsWith("place:country:")), "no country is named without the regions");

const { readFileSync } = await import("node:fs");
const { buildRegionIndex } = await import(moduleUrl("trainingMap", "adminRegions.ts"));
const { placeLabelKey } = await import(moduleUrl("trainingMap", "placeClusters.ts"));
const regions = buildRegionIndex(
  JSON.parse(readFileSync(path.join(repoRoot, "src", "trainingMap", "adminRegions.json"), "utf8"))
);
const named = computeRecords({ ...base, activities: [...homeRuns, ...away], summaries: placeSummaries, regions });
assert.deepEqual(
  ids(named).filter((id) => id.startsWith("place:country:")),
  ["place:country:th", "place:country:fr"],
  "a country is the region's, known on the machine: Sa Pa is no new country, Chiang Mai and Paris are"
);
assert.equal(find(named, "place:country:th").title, "A new country: Thailand");
assert.equal(find(named, "place:country:th").labour, undefined, "a country is a milestone; the labour counts places");
assert.ok(find(named, "place:country:th").major, "the first one abroad is a card");
assert.ok(!find(named, "place:country:fr").major, "the ones after it are rows");
assert.equal(
  find(named, "place:count:5").detail,
  "The 5th: Phú Thọ",
  "a place the geocoder has not named is called by its region: Tam Đảo is in Phú Thọ since 2025"
);
const tamDao = named.places.find((place) => place.lat === 21.45);
const townNamed = computeRecords({
  ...base,
  activities: [...homeRuns, ...away],
  summaries: placeSummaries,
  regions,
  placeLabels: { [placeLabelKey(tamDao)]: { city: "Tam Đảo" } }
});
assert.equal(find(townNamed, "place:count:5").detail, "The 5th: Tam Đảo", "and by its town once named");
assert.ok(find(named, "place:pillars").major, "Paris is past the Pillars from Hà Nội");
assert.equal(find(named, "place:pillars").labour, undefined, "and one flight is no stage");

// Two regions are two places however close; one region holds starts up to 25 km apart.
{
  const near = [activity(at(2026, 1, 5), 100), activity(at(2026, 1, 6), 100)];
  const summariesOf = (points) =>
    new Map(near.map((run, index) => [run.activityId, { recordsVersion: 2, startPoint: points[index] }]));
  const border = computeRecords({
    ...base,
    activities: near,
    summaries: summariesOf([{ lat: 21.0, lon: 105.5 }, { lat: 20.99, lon: 105.5 }]),
    regions: {
      regionOf: (point) => ({ id: point.lat >= 21 ? "N" : "S", name: "", country: "XX", countryName: "" })
    }
  });
  assert.equal(border.places.length, 2, "a kilometre apart across a border: two places");
  const westHanoi = computeRecords({
    ...base,
    activities: near,
    // Hồ Tây and Hoài Đức, either side of the 105.75° line the old grid cut along.
    summaries: summariesOf([{ lat: 21.06, lon: 105.82 }, { lat: 21.03, lon: 105.7 }]),
    regions
  });
  assert.equal(westHanoi.places.length, 1, "12 km apart in one province: one place");
}

// Ten places and twenty-five, however they are spread.
const roaming = Array.from({ length: 25 }, (_, index) => activity(at(2026, 1, 1) + index * 86400, 100));
const roamed = computeRecords({
  ...base,
  activities: roaming,
  summaries: new Map(roaming.map((run, index) => [run.activityId, { recordsVersion: 2, startPoint: { lat: 10 + index, lon: 100 } }]))
});
assert.deepEqual(find(roamed, "place:count:10").labour, { id: "cattle", stage: 2 });
assert.deepEqual(find(roamed, "place:count:25").labour, { id: "cattle", stage: 3 });
assert.ok(find(roamed, "place:count:25").major);

// --- The labours ------------------------------------------------------------------------------------

const all = computeRecords({
  ...base,
  activities: [...long, firstRun, half],
  vo2Readings: [{ day: "20250312", value: 45 }, { day: "20260901", value: 46.6 }]
});
const states = buildLabours(all.milestones, all.progress);
const lion = states.find((state) => state.definition.id === "lion");
assert.equal(lion.reached, 3, "20, 100 and 200 days");
assert.ok(lion.complete);
const apples = states.find((state) => state.definition.id === "apples");
assert.equal(apples.reached, 1);
assert.equal(apples.stages[1].progress.text, "Best 46.6 / 48.3", "Excellent for a man of 30");
assert.ok(Math.abs(apples.stages[1].progress.ratio - (46.6 / 48.3 - 0.8) / 0.2) < 1e-9, "counted from a fifth under the bar");
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
assert.equal(needsRecordsSummary({ sportType: 100, distance: 5000 }, { recordsVersion: 2 }), false);
assert.equal(
  needsRecordsSummary({ sportType: 100, distance: 5000 }, { recordsVersion: 1 }),
  true,
  "a summary from before the jump guard is read again"
);
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

// --- The timeline's layout -----------------------------------------------------------------------------

const timeline = await import(moduleUrl("records", "timelineModel.ts"));
const spread = [];
for (let month = 1; month <= 12; month += 1) {
  spread.push(activity(at(2025, month, 3), 100, { distance: 4000 }));
}
for (let month = 1; month <= 9; month += 1) {
  spread.push(activity(at(2026, month, 3), 200, { distance: 4000 }));
}
// Milestones in every month: anniversaries and strength firsts are not enough,
// so stamp one row a month by hand.
const monthly = computeRecords({ ...base, activities: spread }).milestones.concat(
  spread.map((entry, index) => ({
    id: `m${index}`,
    category: "streak",
    day: dayOfEpochSeconds(entry.startTime),
    at: entry.startTime,
    kind: "Streak",
    title: `Row ${index}`,
    major: false
  }))
);
const years = timeline.groupTimeline(monthly);
assert.deepEqual(years.map((year) => year.year), ["2026", "2025"], "newest year first");
assert.equal(years[0].months[0].key, "202609", "newest month first");
const folded = timeline.foldTimeline(years, new Set());
const open2026 = folded[0].blocks.filter((block) => block.kind === "month").map((block) => block.month.key);
assert.deepEqual(open2026, ["202609", "202608", "202607", "202606"], "the newest four months are open");
const gap2026 = folded[0].blocks.find((block) => block.kind === "gap");
assert.equal(gap2026.label, "May – January");
const blocks2025 = folded[1].blocks;
assert.equal(blocks2025[blocks2025.length - 1].kind, "month", "the month the beginning sits in stays open");
assert.ok(
  blocks2025[blocks2025.length - 1].month.milestones.some((milestone) => milestone.id === "start")
);
assert.equal(blocks2025[0].kind, "gap", "the rest of that year folds into one line");
const reopened = timeline.foldTimeline(years, new Set([gap2026.id]));
assert.equal(
  reopened[0].blocks.filter((block) => block.kind === "month").length,
  9,
  "an opened gap draws its months"
);

const monthOf = (length, major = () => false) => ({
  key: "202609",
  label: "September",
  milestones: Array.from({ length }, (_, index) => ({
    id: `r${index}`,
    category: "lifetime",
    day: "20260910",
    at: 100 - index,
    kind: "Lifetime",
    title: `Row ${index}`,
    major: major(index)
  }))
});
assert.ok(
  timeline.visibleInMonth(monthOf(12), false).every((entry) => entry.kind === "milestone"),
  "two rows past ten are not worth a fold"
);
const crowded = monthOf(14, (index) => index === 9 || index === 11);
const entries = timeline.visibleInMonth(crowded, false);
const drawn = entries.filter((entry) => entry.kind === "milestone").map((entry) => entry.milestone.id);
assert.deepEqual(
  drawn,
  ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r9", "r11"],
  "every card, and minor rows up to ten"
);
const more = entries.find((entry) => entry.kind === "more");
assert.deepEqual(more.hidden.map((milestone) => milestone.id), ["r8", "r10", "r12", "r13"]);
assert.equal(entries.indexOf(more), 8, "the fold sits where its first row would have been");
const cards = timeline.visibleInMonth(monthOf(15, (index) => index < 12), false);
assert.equal(cards.filter((entry) => entry.kind === "milestone").length, 12, "every card shows, past ten too");
assert.equal(cards.find((entry) => entry.kind === "more").hidden.length, 3, "and the minor rows fold");
assert.ok(timeline.visibleInMonth(crowded, true).every((entry) => entry.kind === "milestone"));

// The beginning closes its month, whatever else that day held — and a fold
// never lands after it.
const opening = timeline.groupTimeline([
  { id: "start", category: "first", day: "20250709", at: 100, kind: "The beginning", title: "Start", major: false },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `x${index}`, category: "record", day: "20250709", at: 50 + index, kind: "Record", title: `X${index}`, major: false
  }))
])[0].months[0];
assert.equal(opening.milestones[opening.milestones.length - 1].id, "start");
const openingEntries = timeline.visibleInMonth(opening, false);
assert.equal(openingEntries[openingEntries.length - 1].milestone?.id, "start");
assert.equal(openingEntries[openingEntries.length - 2].kind, "more", "the fold lands before the beginning");

assert.deepEqual(
  timeline.filtersInUse(monthly),
  ["all", "firsts", "totals", "streaks"],
  "only filters with something behind them"
);

// --- What the athlete is told ------------------------------------------------------------------------

const notices = await import(moduleUrl("records", "recordsNotices.ts"));
const told = computeRecords({
  ...base,
  today: "20261002",
  activities: [
    activity(at(2025, 3, 12), 100, { distance: 5000 }),
    activity(at(2026, 9, 25), 200, { distance: 30000 }),
    activity(at(2026, 9, 28), 200, { distance: 101000 })
  ]
});
const toldLabours = buildLabours(told.milestones, told.progress);

const first = notices.reckonNotices(null, told.milestones, toldLabours, "20261002");
assert.deepEqual(first.announce, [], "the first reckoning announces nothing: that history was lived, not news");
assert.deepEqual(first.fresh, []);
assert.deepEqual(new Set(first.next.seen), new Set(ids(told)), "it marks every milestone seen");
assert.ok(first.next.announced.includes("birds:2"));

const empty = { v: 1, seen: [], announced: [] };
const reckoned = notices.reckonNotices(empty, told.milestones, toldLabours, "20261002");
assert.deepEqual(
  reckoned.announce.map((entry) => entry.key).sort(),
  ["birds:1", "birds:2"],
  "stages reached in the last fortnight are announced; the first run of 2025 is not"
);
assert.ok(!reckoned.fresh.includes("start"), "a milestone from last year is marked seen, not new");
assert.ok(reckoned.fresh.includes("first:ride"));
assert.ok(reckoned.next.seen.includes("start"));
assert.equal(
  notices.reckonNotices(reckoned.next, told.milestones, toldLabours, "20261002").announce.length,
  0,
  "a stage is announced once"
);
assert.equal(
  notices.reckonNotices(reckoned.next, told.milestones, toldLabours, "20261002").next,
  undefined,
  "and a reckoning that moves nothing writes nothing"
);

const seenNow = notices.markSeen(reckoned.next, reckoned.fresh);
assert.deepEqual(notices.reckonNotices(seenNow, told.milestones, toldLabours, "20261002").fresh, []);
assert.equal(notices.markSeen(seenNow, reckoned.fresh), undefined, "seeing them twice moves nothing");

// A labour finished in one milestone is the celebration, not three toasts.
const swims = computeRecords({
  ...base,
  today: "20261002",
  activities: [
    activity(at(2025, 1, 1), 100),
    activity(at(2026, 9, 30), 300, { distance: 4000 })
  ]
});
const swimLabours = buildLabours(swims.milestones, swims.progress);
const hydra = notices
  .reckonNotices({ ...empty, announced: [] }, swims.milestones, swimLabours, "20261002")
  .announce.filter((entry) => entry.labourId === "hydra");
assert.equal(hydra.length, 3, "500 m, 1.5 km and 3.8 km in one swim");
assert.ok(hydra.every((entry) => entry.completes), "each of them completes the labour, so the screen celebrates once");

// Sync carries the record whole and the last writer wins, so the other
// machine's copy can land short of what this one was told. This machine reads
// the union with its own copy and writes the union back — and only then.
{
  const store = new Map();
  let writes = 0;
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        writes += 1;
        store.set(key, String(value));
      },
      removeItem: (key) => store.delete(key)
    }
  };
  const here = { v: 1, seen: ["start", "first:ride"], announced: ["birds:1"] };
  notices.writeNoticeState(here);
  assert.equal(writes, 2, "both copies are written");
  writes = 0;
  notices.writeNoticeState(here);
  assert.equal(writes, 0, "an unchanged write is no write, so no sync change");

  // The other machine, which had not pulled this one, publishes its own copy.
  store.set(notices.NOTICES_STORAGE_KEY, JSON.stringify({ v: 1, seen: ["start", "first:swim"], announced: ["hydra:1"] }));
  const union = notices.readNoticeState();
  assert.deepEqual(new Set(union.seen), new Set(["start", "first:ride", "first:swim"]), "nothing seen here is unseen by the pull");
  assert.deepEqual(new Set(union.announced), new Set(["birds:1", "hydra:1"]), "and no stage is announced twice");
  writes = 0;
  notices.writeNoticeState(union);
  assert.equal(writes, 2, "the union goes back out, mending the synced copy");
  assert.deepEqual(
    new Set(JSON.parse(store.get(notices.NOTICES_STORAGE_KEY)).seen),
    new Set(union.seen)
  );
  assert.equal(notices.unionNoticeStates(null, null), null, "nothing either side is a first reckoning");
  delete globalThis.window;
}

assert.equal(notices.parseNoticeState("{oops"), null);
assert.equal(notices.parseNoticeState(JSON.stringify({ v: 2, seen: [], announced: [] })), null);
assert.deepEqual(
  notices.parseNoticeState(JSON.stringify({ v: 1, seen: ["a", 3], announced: ["lion:1"] })),
  { v: 1, seen: ["a"], announced: ["lion:1"] }
);

// --- The developer toolbar's sample histories -------------------------------------------------------
//
// What they are for is seeing every kind of thing the hall draws, so that is
// what is held: every category and filter, labours open, begun and complete,
// and — whatever day it is switched on — two labours completed in the last
// fortnight (the celebration queue), stages to toast, and a month of news.

const samples = await import(moduleUrl("records", "sampleRecords.ts"));
for (const today of ["20261002", "20261001", "20261004", "20260301", "20270115"]) {
  const input = samples.sampleRecordsInput("full", today);
  const full = computeRecords({ ...input, unitSystem: "metric", today });
  const fullLabours = buildLabours(full.milestones, full.progress);
  assert.ok(
    input.activities.every((entry) => samples.isSampleRecordsActivity(entry.activityId)),
    "every sample activity says it is one, so App does not try to open it"
  );
  assert.deepEqual(
    timeline.filtersInUse(full.milestones),
    timeline.TIMELINE_FILTERS,
    `${today}: the full history has something behind every filter`
  );
  const kinds = new Set(full.milestones.map((milestone) => milestone.id.split(":")[0]));
  for (const kind of ["start", "first", "distance", "climb", "longest", "week", "streak", "lifetime", "anniversary", "pr", "vo2max", "sleep", "plan", "place"]) {
    assert.ok(kinds.has(kind), `${today}: the full history has a ${kind} milestone`);
  }
  assert.ok(full.milestones.some((milestone) => milestone.title.startsWith("Your ")), "COROS's record standing");
  assert.ok(full.milestones.some((milestone) => /^New .* records$/.test(milestone.title)), "several records on one run");
  assert.ok(full.milestones.some((milestone) => milestone.labour?.also), "one milestone reaching two stages");
  const complete = fullLabours.filter((state) => state.complete).map((state) => state.definition.id);
  const begun = fullLabours.filter((state) => !state.complete && state.reached > 0);
  assert.equal(complete.length + begun.length, 12, `${today}: every labour begun in the full history`);
  assert.ok(begun.length >= 3 && complete.length >= 3, "and some of each");
  const told = notices.reckonNotices({ v: 1, seen: [], announced: [] }, full.milestones, fullLabours, today);
  assert.deepEqual(
    told.announce.filter((entry) => entry.completes).map((entry) => entry.labourId).sort(),
    ["boar", "hydra"],
    `${today}: two labours complete in the last fortnight — the celebration queue`
  );
  assert.ok(told.announce.filter((entry) => !entry.completes).length >= 2, `${today}: stages to toast`);
  assert.ok(told.fresh.length >= 5, `${today}: a month of news for the rail and the badges`);
  assert.ok(full.withinReach.length >= 2, "something within reach");
}

// The realistic preset is for screenshots, so what is held is that it reads as
// one athlete's history rather than a catalogue: whichever day it is switched
// on, last Saturday's 50K completes one labour (one celebration) and reaches
// one other stage (one toast); some labours are complete, most are under way,
// one is untouched; nothing is dated before the beginning; the year's open
// months are not empty; and what is drawn does not depend on the weekday.
let realisticShape;
for (const today of ["20261003", "20261005", "20261008", "20261011", "20270115"]) {
  const input = samples.sampleRecordsInput("realistic", today);
  const lived = computeRecords({ ...input, unitSystem: "metric", today });
  const livedLabours = buildLabours(lived.milestones, lived.progress);
  assert.ok(input.activities.every((entry) => samples.isSampleRecordsActivity(entry.activityId)));
  const start = lived.milestones.find((milestone) => milestone.id === "start");
  assert.ok(start, `${today}: the realistic history has a beginning`);
  assert.ok(
    lived.milestones.every((milestone) => milestone.day >= start.day),
    `${today}: nothing before the beginning`
  );
  const complete = livedLabours.filter((state) => state.complete).map((state) => state.definition.id);
  const untouched = livedLabours.filter((state) => state.reached === 0).map((state) => state.definition.id);
  assert.deepEqual(complete.sort(), ["bull", "hind", "stables"], `${today}: three labours complete`);
  assert.equal(
    livedLabours.find((state) => state.definition.id === "mares").reached,
    1,
    `${today}: a 1:47 half is a club runner's — the Mares stop at their first stage`
  );
  assert.deepEqual(untouched, ["hydra"], `${today}: no swims, so the Hydra alone is untouched`);
  const told = notices.reckonNotices({ v: 1, seen: [], announced: [] }, lived.milestones, livedLabours, today);
  assert.deepEqual(
    told.announce.map((entry) => `${entry.key}${entry.completes ? " completes" : ""}`).sort(),
    ["boar:2", "bull:3 completes"],
    `${today}: the 50K is one celebration and one toast`
  );
  assert.ok(lived.withinReach.length === 3, `${today}: Within reach is full`);
  const open = timeline
    .foldTimeline(timeline.groupTimeline(lived.milestones), new Set())
    .flatMap(({ blocks }) => blocks)
    .filter((block) => block.kind === "month")
    .slice(0, timeline.OPEN_MONTHS);
  assert.ok(
    open.every((block) => block.month.milestones.length >= 1) &&
      open.reduce((total, block) => total + block.month.milestones.length, 0) >= 7,
    `${today}: the open months carry the screenshot`
  );
  const shape = {
    milestones: lived.milestones.length,
    stages: livedLabours.reduce((total, state) => total + state.reached, 0),
    kinds: [...new Set(lived.milestones.map((milestone) => milestone.id.split(":")[0]))].sort()
  };
  realisticShape ??= shape;
  if (!today.startsWith("2027")) {
    assert.deepEqual(shape, realisticShape, `${today}: the same history whatever the weekday`);
  }
}

const firstWeeksToday = "20261002";
const firstWeeks = computeRecords({ ...samples.sampleRecordsInput("beginner", firstWeeksToday), unitSystem: "metric", today: firstWeeksToday });
const firstLabours = buildLabours(firstWeeks.milestones, firstWeeks.progress);
assert.ok(firstLabours.filter((state) => state.reached === 0).length >= 4, "the first weeks leave labours open, drawn dashed");
assert.ok(
  notices.reckonNotices({ v: 1, seen: [], announced: [] }, firstWeeks.milestones, firstLabours, firstWeeksToday).announce.length >= 2,
  "and stack a few first stages as toasts"
);
assert.deepEqual(
  computeRecords({ ...samples.sampleRecordsInput("empty", firstWeeksToday), unitSystem: "metric", today: firstWeeksToday }).milestones,
  [],
  "the empty preset is the empty hall"
);

console.log("records: OK");
