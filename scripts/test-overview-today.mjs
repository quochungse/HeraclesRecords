/**
 * Overview's Readiness panel: where a figure sits on COROS's training status
 * bands, which band it is in, the load reading the trend comes with, and the
 * week drawn a column a day with a block a session — done, and still planned.
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
  columnIcons,
  latestTrainingLoad,
  plannedStillOpen,
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
assert.deepEqual(latestTrainingLoad([]), {}, "no days, no reading");
assert.deepEqual(
  latestTrainingLoad([
    { happenDay: "20261022", trainingLoadRatio: 1.02, staminaLevel: 150, tiredRateNew: 9 },
    { happenDay: "20261023", trainingLoadRatio: 1.09, staminaLevel: 158, tiredRateNew: 12 },
    { happenDay: "20261024", trainingLoad: 80 }
  ]),
  { percent: 109, loadImpact: 172, baseFitness: 158 },
  "the newest day that states a ratio; Load Impact is the ratio of Base Fitness"
);
assert.deepEqual(
  latestTrainingLoad([{ happenDay: "20261024", trainingLoadRatio: 0.8 }]),
  { percent: 80, loadImpact: undefined, baseFitness: undefined },
  "a ratio with no Base Fitness says nothing of Load Impact"
);

// --- A session done today answers today's plan of its sport family.
const plannedRun = { happenDay: "20261024", name: "Easy run", sportType: 1, trainingLoad: 75 };
const plannedLift = { happenDay: "20261024", name: "Upper body", sportType: 4, trainingLoad: 40 };
const doneRun = { activityId: "a-run", sportType: 100, startTime: 0, trainingLoad: 82 };
const doneRide = { activityId: "a-ride", sportType: 200, startTime: 0, trainingLoad: 60 };
assert.deepEqual(plannedStillOpen([plannedRun], [doneRun]), [], "the run done answers the run planned");
assert.deepEqual(plannedStillOpen([plannedRun, plannedLift], [doneRide]), [plannedRun, plannedLift], "a ride answers neither");
assert.deepEqual(
  plannedStillOpen([plannedRun, { ...plannedRun, name: "Strides" }], [doneRun]),
  [{ ...plannedRun, name: "Strides" }],
  "one session answers one plan"
);

// --- The week, Monday to Sunday, on Saturday 24 October 2026.
const now = new Date(2026, 9, 24, 15, 0);
const at = (day, hour) => Math.floor(new Date(2026, 9, day, hour).getTime() / 1000);
const activities = [
  { activityId: "mon-ride", sportType: 200, startTime: at(19, 7), trainingLoad: 200 },
  { activityId: "mon-lift", sportType: 402, startTime: at(19, 18), trainingLoad: 60 },
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
  { happenDay: "20261025", name: "Long run", sportType: 1, trainingLoad: 160 },
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
    ["planned:20261024:1:Core", true]
  ],
  "today: the run done answers the run planned; the core session is still to do"
);
assert.equal(sat.plannedLoad, 20);
assert.deepEqual(
  sun.blocks.map((block) => [block.load, block.planned, block.sport]),
  [
    [160, true, "run"],
    [0, true, "bike"]
  ],
  "a plan with no load still stands as a block"
);
assert.equal(chart.doneSessions, 8, "sessions this week, last week's left out");
assert.equal(chart.plannedSessions, 3, "what is left: today's core and Sunday's two");
assert.equal(chart.doneLoad, 260 + 130 + 300 + 82);
assert.equal(chart.plannedLoad, 20 + 160);
assert.deepEqual(chart.ticks, [0, 100, 200, 300], "a round axis over Thursday's 300");
assert.equal(chart.axisMax, 300);

// --- Icons: up to three a day, past that the two biggest and a count.
assert.equal(columnIcons(mon.blocks).shown.length, 2);
assert.deepEqual(
  (({ shown, more }) => [shown.map((block) => block.key), more])(columnIcons(thu.blocks)),
  [["thu-run", "thu-ride"], 2],
  "four sessions: the two biggest, in their order, and +2"
);
assert.deepEqual(
  columnIcons(wed.blocks).shown.map((block) => block.key),
  ["wed-run"],
  "the leftover load has no icon"
);

console.log("overview today OK");
