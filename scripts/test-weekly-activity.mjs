/**
 * The Overview weekly-activity chart: the calendar week it draws and the
 * per-sport blocks inside a column — and the Sleep card's column beside it, the
 * seven days up to a night.
 *
 * Run through Electron (`ELECTRON_RUN_AS_NODE=1 electron
 * --experimental-strip-types`): this machine's Node is built without Amaro, so
 * plain `node --experimental-strip-types` fails with ERR_NO_TYPESCRIPT.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const weeklyActivityUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "weeklyActivity.ts")
);

const {
  buildWeeklyActivitySeries,
  enrichDayListWithActivityTotals,
  formatDurationTotal,
  getCalendarWeekDateKeys,
  WEEKLY_ACTIVITY_RESIDUAL_KEY
} = await import(`${weeklyActivityUrl.href}?cacheBust=${Date.now()}`);

const referenceDate = new Date(2026, 5, 28);
const weekKeys = getCalendarWeekDateKeys(referenceDate);

assert.equal(weekKeys.length, 7);
assert.equal(weekKeys[0], "20260622");
assert.equal(weekKeys[6], "20260628");

const dayList = [
  { happenDay: "20260625", distance: 6500, duration: 2400, trainingLoad: 42 },
  { happenDay: "20260626", distance: 11200, duration: 3900, trainingLoad: 68 },
  { happenDay: "20260627", distance: 8200, duration: 2700, trainingLoad: 51 }
];

const distanceSeries = buildWeeklyActivitySeries(
  dayList,
  "distance",
  referenceDate,
  "metric"
);

assert.equal(distanceSeries.hasData, true);
assert.equal(distanceSeries.days.length, 7);
assert.equal(distanceSeries.days[3].value, 6.5);
assert.equal(distanceSeries.days[3].displayValue, "6.50 km");
assert.equal(distanceSeries.days[0].value, 0);
assert.equal(distanceSeries.days[0].displayValue, "—");
assert.equal(distanceSeries.weeklyTotal, "25.90 km");
assert.equal(distanceSeries.days[6].isToday, true);
assert.ok(distanceSeries.yMax >= 11.2);

const loadSeries = buildWeeklyActivitySeries(
  dayList,
  "trainingLoad",
  referenceDate,
  "metric"
);

assert.equal(loadSeries.weeklyTotal, "161");

const emptySeries = buildWeeklyActivitySeries([], "distance", referenceDate, "metric");

assert.equal(emptySeries.hasData, false);
assert.equal(emptySeries.weeklyTotal, "—");
assert.equal(emptySeries.days.every((day) => day.value === 0), true);
// An empty week still has an axis to draw, one whole unit a division.
assert.equal(emptySeries.yMax, 6);

const activityEnriched = buildWeeklyActivitySeries(
  enrichDayListWithActivityTotals(
    [{ happenDay: "20260625", trainingLoad: 42 }],
    [
      {
        activityId: "1",
        sportType: 100,
        startTime: Date.UTC(2026, 5, 25, 12, 0, 0) / 1000,
        distance: 6500,
        duration: 2400
      }
    ]
  ),
  "distance",
  referenceDate,
  "metric"
);

assert.equal(activityEnriched.hasData, true);
assert.equal(activityEnriched.days[3].value, 6.5);
assert.equal(activityEnriched.days[3].displayValue, "6.50 km");

const imperialSeries = buildWeeklyActivitySeries(
  [{ happenDay: "20260625", distance: 8_046.72 }],
  "distance",
  referenceDate,
  "imperial"
);
assert.equal(imperialSeries.days[3].value, 5);
assert.equal(imperialSeries.days[3].displayValue, "5.00 mi");
assert.equal(imperialSeries.weeklyTotal, "5.00 mi");
assert.equal(imperialSeries.yAxisUnit, "mi");

// The week is the calendar week, whichever day of it is today.
const saturday = new Date(2026, 5, 27);
assert.equal(
  buildWeeklyActivitySeries(dayList, "distance", saturday, "metric").weeklyTotal,
  "25.90 km"
);

// A day with two sports splits into one block per activity, bottom to top in
// start order, coloured by the sport each one belongs to.
const mixedDay = [
  {
    activityId: "run-1",
    name: "Morning run",
    sportType: 100,
    startTime: new Date(2026, 5, 25, 6, 0, 0).getTime() / 1000,
    distance: 6000,
    duration: 1800,
    trainingLoad: 40
  },
  {
    activityId: "ride-1",
    name: "Evening ride",
    sportType: 200,
    startTime: new Date(2026, 5, 25, 18, 0, 0).getTime() / 1000,
    distance: 24000,
    duration: 3600,
    trainingLoad: 60
  }
];

const stacked = buildWeeklyActivitySeries(
  [{ happenDay: "20260625", distance: 30000, trainingLoad: 120 }],
  "distance",
  referenceDate,
  "metric",
  mixedDay
);

const thursday = stacked.days[3];
assert.equal(thursday.value, 30);
assert.equal(thursday.segments.length, 2);
assert.deepEqual(
  thursday.segments.map((segment) => segment.key),
  ["run-1", "ride-1"]
);
assert.deepEqual(
  thursday.segments.map((segment) => segment.category),
  ["run", "bike"]
);
// Block values are chart space, the same scale as the column they divide.
assert.equal(
  thursday.segments.reduce((sum, segment) => sum + segment.value, 0),
  thursday.value
);
assert.equal(thursday.segments[0].displayValue, "6.00 km");
// Blocks are labelled by sport, not by the activity's own editable name.
assert.deepEqual(
  thursday.segments.map((segment) => [segment.label, segment.displayValue]),
  [
    ["Running", "6.00 km"],
    ["Cycling", "24.00 km"]
  ]
);
// Rest days stay blockless rather than drawing a stub of colour.
assert.equal(stacked.days[0].segments.length, 0);

// Two sessions of one sport stay two blocks and two rows — one per activity,
// each carrying its own figure rather than a merged total.
const twoRuns = buildWeeklyActivitySeries(
  [{ happenDay: "20260625", distance: 2468 }],
  "distance",
  referenceDate,
  "metric",
  [
    {
      activityId: "run-a",
      sportType: 100,
      startTime: new Date(2026, 5, 25, 6, 0, 0).getTime() / 1000,
      distance: 1000
    },
    {
      activityId: "run-b",
      sportType: 101,
      startTime: new Date(2026, 5, 25, 17, 0, 0).getTime() / 1000,
      distance: 1468
    }
  ]
);
assert.deepEqual(
  twoRuns.days[3].segments.map((segment) => [
    segment.key,
    segment.label,
    segment.displayValue
  ]),
  [
    ["run-a", "Running", "1.00 km"],
    ["run-b", "Running", "1.47 km"]
  ]
);

// COROS's daily figure above what the activities carry becomes one neutral
// block rather than quietly disappearing.
const withResidual = buildWeeklyActivitySeries(
  [{ happenDay: "20260625", trainingLoad: 150 }],
  "trainingLoad",
  referenceDate,
  "metric",
  mixedDay
);
const residualDay = withResidual.days[3];
assert.equal(residualDay.value, 150);
assert.equal(residualDay.segments.length, 3);
assert.equal(residualDay.segments[2].key, WEEKLY_ACTIVITY_RESIDUAL_KEY);
assert.equal(residualDay.segments[2].category, null);
assert.equal(residualDay.segments[2].value, 50);
assert.equal(residualDay.segments[2].label, "Unattributed");

// Activities adding up past the daily figure win: clipping a session that
// happened would be the worse lie.
const overshoot = buildWeeklyActivitySeries(
  [{ happenDay: "20260625", trainingLoad: 60 }],
  "trainingLoad",
  referenceDate,
  "metric",
  mixedDay
);
assert.equal(overshoot.days[3].value, 100);
assert.equal(overshoot.days[3].segments.length, 2);

// A strength session carries no distance, so it contributes no distance block —
// and the day it shares with a run still stacks only the run.
const strengthDay = buildWeeklyActivitySeries(
  [{ happenDay: "20260626", trainingLoad: 30 }],
  "distance",
  referenceDate,
  "metric",
  [
    {
      activityId: "gym-1",
      sportType: 402,
      startTime: new Date(2026, 5, 26, 7, 0, 0).getTime() / 1000,
      duration: 2700,
      trainingLoad: 30
    }
  ]
);
assert.equal(strengthDay.days[4].segments.length, 0);
assert.equal(strengthDay.days[4].value, 0);

assert.equal(formatDurationTotal(9000), "2h 30m");
assert.equal(formatDurationTotal(3600), "1h");
assert.equal(formatDurationTotal(0), "0m");
// The minute carry: rounding the hour remainder on its own printed "5h 60m"
// and "60m" for the two readings either side of a whole hour.
assert.equal(formatDurationTotal(21576), "6h");
assert.equal(formatDurationTotal(21546), "5h 59m");
assert.equal(formatDurationTotal(3599), "1h");
assert.equal(formatDurationTotal(3569), "59m");

// The Sleep card's column: seven days ending on the night shown, each figure
// over the days that have it.
const { buildSleepWeekTotals, sleepWeekDayKeys } = await import(
  `${pathToFileURL(path.join(repoRoot, "src", "training", "sleepWeekTotals.ts")).href}?cacheBust=${Date.now()}`
);

// Across a month's end, oldest first, the night itself last.
assert.deepEqual(sleepWeekDayKeys("20261003"), [
  "20260927",
  "20260928",
  "20260929",
  "20260930",
  "20261001",
  "20261002",
  "20261003"
]);

const sleepWeek = buildSleepWeekTotals(
  [
    { happenDay: "20261003", kind: "main", totalMinutes: 420, score: 80, napMinutes: 60 },
    { happenDay: "20261002", kind: "main", totalMinutes: 360, score: 70 },
    // Naps only: no main sleep, so neither its minutes nor a zero count.
    { happenDay: "20261001", kind: "nap-only", napMinutes: 45 },
    // Still syncing: its minutes are short of the night.
    { happenDay: "20260930", kind: "main", completeness: "partial", totalMinutes: 90, score: 40 },
    // A nap as a record of its own is part of a day, never a night.
    { happenDay: "20260929", kind: "nap", totalMinutes: 30 },
    // Outside the seven days.
    { happenDay: "20260926", kind: "main", totalMinutes: 600, score: 99 }
  ],
  [
    { date: "20260926", label: "", rhr: 70, avgSleepHrv: 90 },
    { date: "20260928", label: "", rhr: 50, avgSleepHrv: 40 },
    { date: "20261002", label: "", rhr: 0, avgSleepHrv: 0 },
    { date: "20261003", label: "", rhr: 54, avgSleepHrv: 61 }
  ],
  "20261003"
);

// (420 + 360) / 2 — the naps on the 3rd are not added, the missing days not counted.
assert.equal(sleepWeek.avgSleepMinutes, 390);
assert.equal(sleepWeek.sleepNights, 2);
assert.equal(sleepWeek.avgScore, 75);
// A 0 from COROS is a figure not filled in, not a reading.
assert.equal(sleepWeek.avgRhr, 52);
assert.equal(sleepWeek.rhrDays, 2);
assert.equal(sleepWeek.hrvMin, 40);
assert.equal(sleepWeek.hrvMax, 61);

// A week with nothing in it has no figures rather than zeros.
const emptySleepWeek = buildSleepWeekTotals([], [], "20261003");
assert.equal(emptySleepWeek.avgSleepMinutes, undefined);
assert.equal(emptySleepWeek.avgScore, undefined);
assert.equal(emptySleepWeek.avgRhr, undefined);
assert.equal(emptySleepWeek.hrvMin, undefined);

console.log("weekly activity tests passed");
