/**
 * The Overview weekly-activity chart: the calendar week it draws, the per-sport
 * blocks inside a column, its legend, and the Monday-to-today tile totals.
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
  buildWeeklyActivityYAxisTicks,
  buildWeekToDateTotals,
  enrichDayListWithActivityTotals,
  formatDurationTotal,
  formatWeeklyActivityAxisTick,
  getCalendarWeekDateKeys,
  getWeeklyActivityYAxisUnitLabel,
  weeklyActivitySportLegend,
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

const yTicks = buildWeeklyActivityYAxisTicks(distanceSeries.yMax);
assert.equal(yTicks.length, 7);
assert.equal(yTicks[0], 0);
assert.equal(yTicks.at(-1), distanceSeries.yMax);
assert.equal(
  formatWeeklyActivityAxisTick(6, "distance", distanceSeries.yAxisUnit),
  "6.0"
);
assert.equal(getWeeklyActivityYAxisUnitLabel("distance", "km"), "km");
assert.equal(getWeeklyActivityYAxisUnitLabel("trainingLoad", ""), "Load");

// Week to date: Monday through today, and nothing on either side of that.
const saturday = new Date(2026, 5, 27);
const weekTotals = buildWeekToDateTotals(
  [
    // Sunday of the week before, and Sunday of this one: both out, the first
    // for being last week, the second for being later today than today.
    { happenDay: "20260621", distance: 9000, duration: 3000, trainingLoad: 60 },
    ...dayList,
    { happenDay: "20260628", distance: 5000, duration: 1800, trainingLoad: 30 }
  ],
  [
    { happenDay: "20260621", steps: 20000 },
    { happenDay: "20260622", steps: 8000 },
    { happenDay: "20260627", steps: 12000 }
  ],
  saturday
);

assert.equal(weekTotals.distance, 25900);
assert.equal(weekTotals.duration, 9000);
assert.equal(weekTotals.trainingLoad, 161);
assert.equal(weekTotals.steps, 20000);
// The distance total and the chart's legend read the same week.
assert.equal(
  buildWeeklyActivitySeries(dayList, "distance", saturday, "metric").weeklyTotal,
  "25.90 km"
);

// Nothing loaded reads as unknown; a loaded week with no training is a zero.
const nothingLoaded = buildWeekToDateTotals([], [], saturday);
assert.equal(nothingLoaded.distance, undefined);
assert.equal(nothingLoaded.trainingLoad, undefined);
assert.equal(nothingLoaded.steps, undefined);

const idleWeek = buildWeekToDateTotals(
  [{ happenDay: "20260601", distance: 12000, trainingLoad: 70 }],
  [],
  saturday
);
assert.equal(idleWeek.distance, 0);
assert.equal(idleWeek.duration, 0);
assert.equal(idleWeek.trainingLoad, 0);
// Steps ride on the MCP daily-health feed, which is absent on its own.
assert.equal(idleWeek.steps, undefined);

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

// The legend names the sports actually on the chart, in canonical order, with
// the residual entry last when one is drawn.
assert.deepEqual(
  weeklyActivitySportLegend(stacked.days).map((entry) => entry.key),
  ["run", "bike"]
);
assert.deepEqual(
  weeklyActivitySportLegend(withResidual.days).map((entry) => entry.key),
  ["run", "bike", WEEKLY_ACTIVITY_RESIDUAL_KEY]
);
assert.equal(weeklyActivitySportLegend(emptySeries.days).length, 0);
assert.equal(
  weeklyActivitySportLegend(stacked.days)[0].label,
  "Running"
);

assert.equal(formatDurationTotal(9000), "2h 30m");
assert.equal(formatDurationTotal(3600), "1h");
assert.equal(formatDurationTotal(0), "0m");
// The minute carry: rounding the hour remainder on its own printed "5h 60m"
// and "60m" for the two readings either side of a whole hour.
assert.equal(formatDurationTotal(21576), "6h");
assert.equal(formatDurationTotal(21546), "5h 59m");
assert.equal(formatDurationTotal(3599), "1h");
assert.equal(formatDurationTotal(3569), "59m");

console.log("weekly activity tests passed");
