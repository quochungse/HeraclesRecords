/**
 * Overview's arithmetic. The Readiness panel: where a figure sits on COROS's
 * training status bands, which band it is in, the load reading the trend comes
 * with, and the week drawn a column a day with a block a session — done, and
 * still planned. Training load distribution: load by sport, COROS's zone
 * lists, and the easy / moderate / hard split.
 *
 * Run through Electron (`ELECTRON_RUN_AS_NODE=1 electron
 * --experimental-strip-types`): this machine's Node is built without Amaro, so
 * plain `node --experimental-strip-types` fails with ERR_NO_TYPESCRIPT.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modelUrl = pathToFileURL(path.join(repoRoot, "src", "training", "overview", "todayModel.ts"));
const {
  bandMarker,
  buildWeekChart,
  latestTrainingLoad,
  thisWeekLoad,
  trainingStatusBand,
  trainingStatusMarker
} = await import(`${modelUrl.href}?cacheBust=${Date.now()}`);

const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

// --- The training status bands are the COROS app's, floor included.
for (const [percent, band] of [
  [0, "decreasing"],
  [49, "decreasing"],
  [50, "resuming"],
  [79, "resuming"],
  [80, "maintaining"],
  [99, "maintaining"],
  [100, "optimized"],
  [149, "optimized"],
  [150, "excessive"],
  [260, "excessive"]
]) {
  assert.equal(trainingStatusBand(percent), band, `${percent}% is ${band}`);
}

// Equal segments, each band stretched over its own: 109% is 9/50 of the way
// into Optimized, the fourth of five segments.
close(trainingStatusMarker(109), (3 + 9 / 50) / 5, "109% inside Optimized");
close(trainingStatusMarker(50), 1 / 5, "a band's floor is its segment's start");
close(trainingStatusMarker(80), 2 / 5, "Maintaining starts the third segment");
assert.equal(trainingStatusMarker(-4), 0, "nothing below the scale");
assert.equal(trainingStatusMarker(400), 1, "past the end pins to the end");
close(bandMarker(77, [60, 75, 90], 0, 100), (2 + 2 / 15) / 4, "a generic scale reads the same way");

// --- The load reading: one day's three figures, the newest day with a ratio.
// The days are a real account's (2026-10-27/28): `ati` over `cti` is the
// ratio, `tiredRateNew` is their difference, and `staminaLevel` comes only on
// a day with a run — the 28th had none.
assert.deepEqual(latestTrainingLoad([]), {}, "no days, no reading");
assert.deepEqual(
  latestTrainingLoad([
    { happenDay: "20261027", trainingLoadRatio: 1.09, ati: 118, cti: 108, tiredRateNew: 10, staminaLevel: 71.8 },
    { happenDay: "20261028", trainingLoadRatio: 0.95, ati: 101, cti: 106, tiredRateNew: -5 },
    { happenDay: "20261029", trainingLoad: 80 }
  ]),
  { percent: 95, loadImpact: 101, baseFitness: 106 },
  "the newest day that states a ratio: Load Impact is ati and Base Fitness cti, on a day with no run too"
);
assert.deepEqual(
  latestTrainingLoad([{ happenDay: "20261024", trainingLoadRatio: 0.8 }]),
  { percent: 80, loadImpact: undefined, baseFitness: undefined },
  "a ratio without its two figures states neither"
);

// --- This week's load against COROS's recommended range, on the same real
// days. The range is the calendar week's: 756–982.8 through Sunday the 25th,
// 763–991.9 from Monday the 26th (Base Fitness on the 25th, 109, × 7 and
// × 1.3). On Wednesday the 28th the week so far is 22 + 175 + 0, not COROS's
// rolling seven days (752), which a calendar-week range does not measure.
const realWeeks = [
  ["20261019", 7, 756, 982.8],
  ["20261020", 161, 756, 982.8],
  ["20261021", 52, 756, 982.8],
  ["20261022", 128, 756, 982.8],
  ["20261023", 72, 756, 982.8],
  ["20261024", 65, 756, 982.8],
  ["20261025", 290, 756, 982.8],
  ["20261026", 22, 763, 991.9],
  ["20261027", 175, 763, 991.9],
  ["20261028", 0, 763, 991.9]
].map(([happenDay, trainingLoad, recommendedLoadMin, recommendedLoadMax]) => ({
  happenDay,
  trainingLoad,
  recommendedLoadMin,
  recommendedLoadMax
}));
const weekOf = (dayList, now) => thisWeekLoad({ dayList, activities: [], now, unitSystem: "metric" });
assert.deepEqual(
  weekOf(realWeeks, new Date(2026, 9, 28, 9, 0)),
  { load: 197, recommended: { min: 763, max: 992 } },
  "Monday to today, against this week's range"
);
assert.deepEqual(
  weekOf(realWeeks, new Date(2026, 9, 25, 21, 0)),
  { load: 775, recommended: { min: 756, max: 983 } },
  "on a Sunday the week is whole, against its own range"
);
assert.deepEqual(weekOf([], new Date(2026, 9, 28)), {}, "no days, no reading");
assert.equal(
  thisWeekLoad({
    dayList: realWeeks,
    activities: [{ activityId: "late", sportType: 100, startTime: Math.floor(new Date(2026, 9, 28, 7).getTime() / 1000), trainingLoad: 60 }],
    now: new Date(2026, 9, 28, 9, 0),
    unitSystem: "metric"
  }).load,
  257,
  "a session COROS's daily figure has not caught up with counts, as the week chart counts it"
);

// --- A session done today answers today's plan of its sport family.
const comingUpUrl = pathToFileURL(path.join(repoRoot, "src", "training", "overview", "comingUpModel.ts"));
const { pairTodayPlan, todayItems, weekAhead } = await import(`${comingUpUrl.href}?cacheBust=${Date.now()}`);
const stillOpen = (planned, done) => pairTodayPlan(planned, done).open;
const plannedRun = { happenDay: "20261024", name: "Easy run", sportType: 1, trainingLoad: 75 };
const plannedLift = { happenDay: "20261024", name: "Upper body", sportType: 4, trainingLoad: 40 };
const doneRun = { activityId: "a-run", sportType: 100, startTime: 0, trainingLoad: 82 };
const doneRide = { activityId: "a-ride", sportType: 200, startTime: 0, trainingLoad: 60 };
assert.deepEqual(stillOpen([plannedRun], [doneRun]), [], "the run done answers the run planned");
assert.deepEqual(stillOpen([plannedRun, plannedLift], [doneRide]), [plannedRun, plannedLift], "a ride answers neither");
assert.deepEqual(
  stillOpen([plannedRun, { ...plannedRun, name: "Strides" }], [doneRun]),
  [{ ...plannedRun, name: "Strides" }],
  "one session answers one plan"
);
// An easy 5 km and a long 20 km planned, the long one run: the long plan is
// the one done, as the Calendar pairs them, whatever the order they come in.
const easy = { happenDay: "20261024", name: "Easy 5 km", sportType: 1, trainingLoad: 40 };
const long = { happenDay: "20261024", name: "Long 20 km", sportType: 1, trainingLoad: 200 };
const longRun = { activityId: "long-run", sportType: 100, startTime: 100, trainingLoad: 210 };
assert.deepEqual(
  pairTodayPlan([easy, long], [longRun]).pairs.map((pair) => pair.workout.name),
  ["Easy 5 km"],
  "plans are taken in the calendar's order; the first compatible plan takes the closest session"
);
assert.deepEqual(
  pairTodayPlan([long, easy], [{ ...longRun, activityId: "short", trainingLoad: 45 }, longRun]).pairs.map((pair) => [
    pair.workout.name,
    pair.activity.activityId
  ]),
  [
    ["Long 20 km", "long-run"],
    ["Easy 5 km", "short"]
  ],
  "each plan takes the session closest to it in load, not the first it meets"
);
// Today in the week ahead is only what is still to do.
const saturday = new Date(2026, 9, 24, 15, 0);
const ahead = weekAhead(
  [plannedRun, { happenDay: "20261025", name: "Long run", sportType: 1 }, { happenDay: "20261031", name: "Too far", sportType: 1 }],
  [{ ...doneRun, startTime: Math.floor(new Date(2026, 9, 24, 7).getTime() / 1000) }],
  saturday
);
assert.deepEqual(ahead.map((workout) => workout.name), ["Long run"], "today's run, done, is not ahead; a week on is past the seven days");
// A planned item's key is its place in the day's plan, so two plans of one
// name and order cannot collide.
const twins = todayItems(
  [{ ...plannedRun, sortNo: 1 }, { ...plannedRun, sortNo: 1 }],
  [],
  saturday
).map((item) => item.key);
assert.equal(new Set(twins).size, 2, "two identical plans, two keys");

// --- The week, Monday to Sunday, on Saturday 24 October 2026.
const now = new Date(2026, 9, 24, 15, 0);
const at = (day, hour) => Math.floor(new Date(2026, 9, day, hour).getTime() / 1000);
const activities = [
  { activityId: "mon-ride", sportType: 200, startTime: at(19, 7), trainingLoad: 200, duration: 5_400 },
  { activityId: "mon-lift", name: "Leg day", sportType: 402, startTime: at(19, 18), trainingLoad: 60, duration: 4_200 },
  { activityId: "wed-run", sportType: 100, startTime: at(21, 6), trainingLoad: 110 },
  { activityId: "thu-run", sportType: 100, startTime: at(22, 6), trainingLoad: 80 },
  { activityId: "thu-ride", sportType: 200, startTime: at(22, 12), trainingLoad: 140 },
  { activityId: "thu-swim", sportType: 300, startTime: at(22, 17), trainingLoad: 60 },
  { activityId: "thu-lift", sportType: 402, startTime: at(22, 19), trainingLoad: 20 },
  { activityId: "sat-run", sportType: 100, startTime: at(24, 7), trainingLoad: 82 },
  { activityId: "last-week", sportType: 100, startTime: at(17, 7), trainingLoad: 99 }
];
const dayList = [
  { happenDay: "20261019", trainingLoad: 260 },
  // COROS counted more on Wednesday than the run carries: the rest is a block of its own.
  { happenDay: "20261021", trainingLoad: 130 }
];
const upcoming = [
  { happenDay: "20261024", name: "Easy run", sportType: 1, trainingLoad: 75 },
  { happenDay: "20261024", name: "Core", sportType: 4, trainingLoad: 20 },
  { happenDay: "20261025", name: "Long run", sportType: 1, trainingLoad: 160, durationSeconds: 7_200 },
  { happenDay: "20261025", name: "Spin", sportType: 2 },
  { happenDay: "20261026", name: "Next week", sportType: 1, trainingLoad: 90 }
];
const chart = buildWeekChart({ dayList, activities, upcoming, now, unitSystem: "metric" });

assert.deepEqual(
  chart.columns.map((column) => column.happenDay),
  ["20261019", "20261020", "20261021", "20261022", "20261023", "20261024", "20261025"],
  "Monday to Sunday"
);
const [mon, tue, wed, thu, fri, sat, sun] = chart.columns;
assert.deepEqual(mon.blocks.map((block) => [block.key, block.load, block.planned]), [
  ["mon-ride", 200, false],
  ["mon-lift", 60, false]
], "a block a session, in start order");
assert.equal(mon.blocks[1].sport, "strength");
assert.deepEqual(wed.blocks.map((block) => [block.key, block.load]), [
  ["wed-run", 110],
  ["residual", 20]
], "load no session claims stands on its own");
assert.equal(wed.blocks[1].category, null);
assert.equal(thu.blocks.length, 4);
assert.equal(tue.isPast && tue.blocks.length === 0, true, "Tuesday was a rest day");
assert.equal(fri.isPast, true);
assert.equal(sat.isToday, true);
assert.deepEqual(
  sat.blocks.map((block) => [block.key, block.planned]),
  [
    ["sat-run", false],
    ["planned:20261024:1", true]
  ],
  "today: the run done answers the run planned; the core session is still to do"
);
assert.equal(sat.planned, 20);
assert.deepEqual(
  sun.blocks.map((block) => [block.load, block.planned, block.sport]),
  [
    [160, true, "run"],
    [0, true, "bike"]
  ],
  "a plan with no load still stands as a block"
);
const sum = (pick) => chart.columns.reduce((total, column) => total + pick(column), 0);
assert.equal(
  sum((column) => column.blocks.filter((block) => !block.planned && block.category !== null).length),
  8,
  "sessions this week, last week's left out"
);
assert.equal(sum((column) => column.blocks.filter((block) => block.planned).length), 3, "what is left: today's core and Sunday's two");
assert.equal(sum((column) => column.done), 260 + 130 + 300 + 82);
assert.equal(sum((column) => column.planned), 20 + 160);
assert.deepEqual(chart.ticks, [0, 100, 200, 300], "a round axis over Thursday's 300");
assert.equal(chart.axisMax, 300);
assert.deepEqual(
  [mon.blocks[1].name, mon.blocks[1].seconds, mon.blocks[1].value],
  ["Leg day", 4_200, 60],
  "a block carries its name and both figures, and stands at its load"
);

// --- The same week with strength read in Heracles Training Load: a strength
// block stands at its Heracles load, COROS's figure kept for the tooltip, and
// every other block, the leftover included, is as before.
{
  const heracles = (load, cardio) => ({ value: load, cardio, muscular: load - cardio, quality: "sets" });
  const lifted = activities.map((activity) =>
    activity.activityId === "mon-lift" ? { ...activity, heraclesLoad: heracles(180, 60) }
      : activity.activityId === "thu-lift" ? { ...activity, heraclesLoad: heracles(90, 20) }
        : activity
  );
  const plannedCore = upcoming.map((workout) =>
    workout.name === "Core" ? { ...workout, heraclesLoad: { value: 70, cardio: 20, muscular: 50, quality: "planned" } } : workout
  );
  const read = buildWeekChart({ dayList, activities: lifted, upcoming: plannedCore, now, unitSystem: "metric", loadSource: "heracles" });
  const [hMon, , hWed, hThu, , hSat] = read.columns;
  assert.deepEqual(hMon.blocks.map((block) => [block.key, block.load, block.corosLoad]), [
    ["mon-ride", 200, undefined],
    ["mon-lift", 180, 60]
  ], "the lift at its Heracles load, COROS's beside it");
  assert.deepEqual(hWed.blocks.map((block) => [block.key, block.load]), [["wed-run", 110], ["residual", 20]]);
  assert.equal(hThu.done, 300 + 70, "Thursday's lift adds what Heracles reads over COROS");
  assert.deepEqual(hSat.blocks.at(-1).load, 70, "a planned strength session at its Heracles estimate");
  assert.equal(hSat.blocks.at(-1).corosLoad, 20);
  const unchanged = buildWeekChart({ dayList, activities: lifted, upcoming: plannedCore, now, unitSystem: "metric" });
  assert.equal(unchanged.columns[0].blocks[1].load, 60, "with COROS chosen nothing moves");

  const coros = thisWeekLoad({ dayList, activities: lifted, now, unitSystem: "metric" });
  const both = thisWeekLoad({ dayList, activities: lifted, now, unitSystem: "metric", loadSource: "heracles" });
  assert.equal(both.load, coros.load, "the week's load against COROS's range stays COROS's");
  assert.equal(both.heraclesLoad, coros.load + (180 - 60) + (90 - 20), "the Heracles figure the columns add up to, for the hover");
  assert.equal(coros.heraclesLoad, undefined);

  // Coming up pairs by load in the chosen load, both sides alike.
  const heavyLift = { happenDay: "20261024", name: "Heavy", sportType: 4, trainingLoad: 20, heraclesLoad: { value: 200, muscular: 180, cardio: 20, quality: "planned" } };
  const light = { activityId: "light", sportType: 402, startTime: 0, trainingLoad: 20, heraclesLoad: heracles(60, 20) };
  const heavy = { activityId: "heavy", sportType: 402, startTime: 10, trainingLoad: 21, heraclesLoad: heracles(190, 21) };
  assert.equal(pairTodayPlan([heavyLift], [light, heavy], "heracles").pairs[0].activity.activityId, "heavy");
  assert.equal(pairTodayPlan([heavyLift], [light, heavy]).pairs[0].activity.activityId, "light", "in COROS's load the light one is closer");
  // A plan only COROS priced is set against COROS's figures, never Heracles's.
  // Read across scales, the 150 lift is 6.5 plans away and the 40 one only 1.
  const priced = { happenDay: "20261024", name: "Priced", sportType: 4, trainingLoad: 20 };
  const asPriced = { activityId: "as-priced", sportType: 402, startTime: 0, trainingLoad: 20, heraclesLoad: heracles(150, 20) };
  const harder = { activityId: "harder", sportType: 402, startTime: 10, trainingLoad: 40, heraclesLoad: heracles(40, 40) };
  assert.equal(pairTodayPlan([priced], [asPriced, harder], "heracles").pairs[0].activity.activityId, "as-priced");
}

// --- The same week in time: every sport on one measure, a strength session
// as long as it took rather than as light as its heart rate read.
const timed = buildWeekChart({ dayList, activities, upcoming, now, unitSystem: "metric", measure: "time" });
const [tMon, , tWed, , , , tSun] = timed.columns;
assert.equal(timed.measure, "time");
assert.deepEqual(
  tMon.blocks.map((block) => [block.key, block.value, block.load]),
  [
    ["mon-ride", 5_400, 200],
    ["mon-lift", 4_200, 60]
  ],
  "a block a session at its activity time, its load kept for the tooltip"
);
assert.equal(tMon.done, 9_600);
assert.deepEqual(
  tWed.blocks.map((block) => [block.key, block.value, block.load]),
  [
    ["wed-run", 0, 110],
    ["residual", 0, 20]
  ],
  "load no session claims has no time to draw, but stays for the tooltip and keeps the day from reading as rest"
);
assert.deepEqual(
  tSun.blocks.map((block) => [block.value, block.planned]),
  [
    [7_200, true],
    [0, true]
  ],
  "a planned session at COROS's estimate of it, none stated none drawn"
);
assert.deepEqual(timed.ticks, [0, 3_600, 7_200, 10_800], "whole hours over Monday's 2h 40m");

// --- The same week in distance: what each session covered, a strength
// session none, a planned session the distance its steps state.
const covered = activities.map((activity) => ({
  ...activity,
  distance: { "mon-ride": 42_000, "wed-run": 10_000, "thu-run": 8_000, "thu-ride": 25_000, "thu-swim": 2_000 }[activity.activityId]
}));
const planDistance = upcoming.map((workout) => workout.name === "Long run" ? { ...workout, distanceMeters: 21_100 } : workout);
const far = buildWeekChart({ dayList, activities: covered, upcoming: planDistance, now, unitSystem: "metric", measure: "distance" });
const [dMon, , dWed, dThu, , , dSun] = far.columns;
assert.equal(far.measure, "distance");
assert.deepEqual(
  dMon.blocks.map((block) => [block.key, block.value, block.seconds]),
  [
    ["mon-ride", 42_000, 5_400],
    ["mon-lift", 0, 4_200]
  ],
  "a session at the distance it covered, a lift at none, every figure kept for the tooltip"
);
assert.equal(dWed.blocks.find((block) => block.key === "residual").value, 0, "load no session claims has no distance");
assert.equal(dThu.done, 35_000);
assert.deepEqual(dSun.blocks.map((block) => block.value), [21_100, 0], "a plan at its stated distance");
assert.deepEqual(far.ticks, [0, 20_000, 40_000, 60_000], "round kilometres over Monday's 42 km");
const miles = buildWeekChart({ dayList, activities: covered, upcoming: planDistance, now, unitSystem: "imperial", measure: "distance" });
assert.equal(miles.ticks.length, 4, "three steps over Monday's 26 miles");
assert.ok(
  miles.ticks.every((tick, index) => Math.abs(tick - index * 10 * 1_609.344) < 1e-6),
  "miles step in whole tens"
);

// --- Training load distribution.
const distributionUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "overview", "distributionModel.ts")
);
const { sportLoadShares, zoneShares, intensityShares } = await import(
  `${distributionUrl.href}?cacheBust=${Date.now()}`
);
const daysAgo = (days) => Math.floor(now.getTime() / 1000) - days * 86_400;
const mix = sportLoadShares(
  [
    { activityId: "r1", sportType: 100, startTime: daysAgo(2), trainingLoad: 300 },
    { activityId: "r2", sportType: 102, startTime: daysAgo(9), trainingLoad: 100 },
    { activityId: "b1", sportType: 200, startTime: daysAgo(3), trainingLoad: 200 },
    { activityId: "s1", sportType: 402, startTime: daysAgo(5), trainingLoad: 0 },
    { activityId: "old", sportType: 200, startTime: daysAgo(40), trainingLoad: 900 }
  ],
  now
);
assert.equal(mix.total, 600, "four weeks of load, the old ride left out");
assert.deepEqual(
  mix.sports.map((sport) => [sport.category, sport.load]),
  [
    ["run", 400],
    ["bike", 200]
  ],
  "biggest first; a trail run is a run, a session with no load is no sliver"
);
close(mix.sports[0].share, 2 / 3, "a sport's share of the load");

// With strength read in Heracles Training Load, the lift counts that load and
// COROS's sums stand beside for the hover; with COROS chosen nothing moves.
{
  const lifts = [
    { activityId: "r1", sportType: 100, startTime: daysAgo(2), trainingLoad: 300 },
    {
      activityId: "s1",
      sportType: 402,
      startTime: daysAgo(5),
      trainingLoad: 60,
      heraclesLoad: { value: 200, cardio: 60, muscular: 140, quality: "sets" }
    }
  ];
  const coros = sportLoadShares(lifts, now);
  assert.equal(coros.total, 360);
  assert.equal(coros.corosTotal, 360);
  const heracles = sportLoadShares(lifts, now, undefined, "heracles");
  assert.equal(heracles.total, 500, "the lift at its Heracles load");
  assert.equal(heracles.corosTotal, 360, "COROS's figure kept for the hover");
  assert.deepEqual(
    heracles.sports.map((sport) => [sport.category, sport.load, sport.corosLoad]),
    [
      ["run", 300, 300],
      ["strength", 200, 60]
    ]
  );
}

const zones = zoneShares([
  { index: 2, value: 600 },
  { index: 0, value: 1200 },
  { index: 1, value: 1800 },
  { index: 3, value: 300 },
  { index: 4, value: 100 },
  { index: 5 }
]);
assert.equal(zones.total, 4000);
assert.deepEqual(zones.rows.map((row) => row.value), [1200, 1800, 600, 300, 100, 0], "easiest first, every zone kept");
close(zones.rows[1].share, 0.45, "a zone's share of the total");
assert.deepEqual(zoneShares([{ index: 0 }, { index: 1 }]), { total: 0, rows: [] }, "nothing in any zone is no list");
const ratioOnly = zoneShares([
  { index: 0, ratio: 30 },
  { index: 1, ratio: 70 }
]);
close(ratioOnly.rows[1].share, 0.7, "COROS's own ratio stands where it sent one");

const reserve = intensityShares(zones.rows, "restingHr");
close(reserve.easy, 0.75, "zones 1 and 2 are easy");
close(reserve.moderate, 0.15, "zone 3 is moderate");
close(reserve.hard, 0.1, "zones 4 and up are hard");
const maxHr = intensityShares(zones.rows, "maxHr");
close(maxHr.easy, 0.9, "under Max HR the easy band reaches a zone further");

// --- The sport sections' shared arithmetic.
const sportUrl = pathToFileURL(path.join(repoRoot, "src", "training", "overview", "sportModel.ts"));
const { sportWindow, sportWindowWeeks, previousWeeksAverage, plannedThisWeek, nextPlanned, longestAndLast } = await import(
  `${sportUrl.href}?cacheBust=${Date.now()}`
);
// Saturday 24 October 2026: the four weeks start on Monday 28 September.
const inWindow = sportWindow(
  [
    { activityId: "sunday-before", startTime: Math.floor(new Date(2026, 8, 27, 18).getTime() / 1000) },
    { activityId: "monday-start", startTime: Math.floor(new Date(2026, 8, 28, 7).getTime() / 1000) },
    { activityId: "today", startTime: at(24, 7) },
    { activityId: "tomorrow", startTime: at(25, 7) }
  ],
  now.getTime()
).map((activity) => activity.activityId);
assert.ok(inWindow.includes("monday-start") && inWindow.includes("today"), "four calendar weeks, this one included");
assert.ok(!inWindow.includes("sunday-before"), "cut at the Monday the sport screens cut at");
assert.ok(!inWindow.includes("tomorrow"), "nothing from the future");

assert.equal(previousWeeksAverage([40, 20, 60, 36, 28]), 39, "the four weeks before this one");
assert.equal(previousWeeksAverage([12]), undefined, "no weeks before, no average");

const plans = [
  { happenDay: "20261024", name: "Easy run", sportType: 1, volume: "8.00km" },
  { happenDay: "20261024", name: "Spin", sportType: 2, volume: "30.00km" },
  { happenDay: "20261025", name: "Long run", sportType: 1, volume: "20.00km" },
  { happenDay: "20261026", name: "Next week", sportType: 1, volume: "10.00km" }
];
assert.deepEqual(plannedThisWeek(plans, [], "run", now), { count: 2, km: 28 }, "today's run and Sunday's, not Monday's");
assert.deepEqual(
  plannedThisWeek(plans, [{ activityId: "done", sportType: 100, startTime: at(24, 7) }], "run", now),
  { count: 1, km: 20 },
  "today's run, done, is no longer planned"
);
assert.deepEqual(
  plannedThisWeek(
    [{ happenDay: "20261025", name: "Intervals", sportType: 1, volume: "4 set(s)", distanceMeters: 12000 }],
    [],
    "run",
    now
  ),
  { count: 1, km: 12 },
  "a structured session's distance, where its volume is a set count"
);
// The window on a Monday is three weeks and a day, not four.
const monday = new Date(2026, 9, 26, 12, 0).getTime();
close(sportWindowWeeks(monday), 3 + 0.5 / 7, "three whole weeks and the half day of this one");
close(sportWindowWeeks(new Date(2026, 9, 25, 23, 59, 59).getTime()), 4 - 1 / 7 / 86_400, "a Sunday night is all but four");
assert.equal(nextPlanned(plans, "bike", now)?.name, "Spin");
assert.equal(nextPlanned(plans, "swim", now), undefined);
assert.equal(nextPlanned(plans, "run", now)?.name, "Easy run", "today's run, still to do");
assert.equal(
  nextPlanned(plans, "run", now, [{ activityId: "done", sportType: 100, startTime: at(24, 7) }])?.name,
  "Long run",
  "today's run, done, is not next"
);

const { longest, last } = longestAndLast(
  [
    { activityId: "a", distance: 8000, startTime: 1 },
    { activityId: "b", distance: 21000, startTime: 2 },
    { activityId: "c", startTime: 3 }
  ],
  [
    { activityId: "a", startTime: 1 },
    { activityId: "z", startTime: 9 }
  ]
);
assert.equal(longest?.activityId, "b", "the longest by distance; a session with none is no candidate");
assert.equal(last?.activityId, "z", "the newest of all, not only the window's");

console.log("overview model OK");
