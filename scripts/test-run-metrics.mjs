// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types; runMetrics imports runSurface without an extension, so
// the resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const moduleUrl = (name) =>
  `${pathToFileURL(path.join(repoRoot, "src", "running", name)).href}${bust}`;

const {
  RUN_SURFACES,
  classifyRunSurface,
  isRunSportType,
  isOutdoorRunSurface,
  runsOnly,
  runsOnSurface
} = await import(moduleUrl("runSurface.ts"));

const {
  buildRunWeeks,
  distanceBySurface,
  efficiencyIndex,
  elevationPerKm,
  heartRateZoneIndex,
  paceHrDecoupling,
  paceSecondsPerKm,
  runIntensity,
  runLoadBalance,
  startOfRunWeekMs,
  summariseRuns,
  verticalSpeed
} = await import(moduleUrl("runMetrics.ts"));

// 14 Sep 2026 is a Monday; every fixture below is built in local time because
// the week boundary is local too.
const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const MS_PER_DAY = 86_400_000;

/** COROS sends epoch *seconds* on the activity list endpoint. */
const secondsAt = (year, month, day, hour = 9) =>
  Math.floor(new Date(year, month, day, hour, 0, 0).getTime() / 1000);
const secondsAgo = (days) => Math.floor((NOW - days * MS_PER_DAY) / 1000);

const run = (overrides = {}) => ({
  activityId: `a-${overrides.activityId ?? Math.random().toString(36).slice(2)}`,
  sportType: 100,
  startTime: secondsAgo(1),
  duration: 3000,
  distance: 10_000,
  avgHr: 150,
  trainingLoad: 100,
  elevationGain: 60,
  ...overrides
});

// ---------------------------------------------------------------------------
// Surfaces. Road, treadmill, trail and track are the four running codes; hike
// and mountain climb share the trail colour elsewhere in the app but are not
// runs, and a hiking pace in a running pace chart is noise.
// ---------------------------------------------------------------------------

assert.equal(classifyRunSurface(100), "road");
assert.equal(classifyRunSurface(101), "treadmill");
assert.equal(classifyRunSurface(102), "trail");
assert.equal(classifyRunSurface(103), "track");
assert.equal(classifyRunSurface(104), null, "hike is not a run");
assert.equal(classifyRunSurface(105), null, "mountain climb is not a run");
assert.equal(classifyRunSurface(200), null, "bike is not a run");
assert.equal(classifyRunSurface(undefined), null);

assert.equal(isRunSportType(102), true);
assert.equal(isRunSportType(104), false);
assert.equal(isRunSportType(undefined), false);

assert.deepEqual([...RUN_SURFACES], ["road", "trail", "track", "treadmill"]);
assert.equal(isOutdoorRunSurface("treadmill"), false);
assert.equal(isOutdoorRunSurface("track"), true);

const mixed = [
  run({ activityId: "road", sportType: 100 }),
  run({ activityId: "trail", sportType: 102 }),
  run({ activityId: "hike", sportType: 104 }),
  run({ activityId: "bike", sportType: 200 })
];
assert.equal(runsOnly(mixed).length, 2);
assert.equal(runsOnSurface(mixed, "trail").length, 1);
assert.equal(runsOnSurface(mixed, null).length, 2);

// ---------------------------------------------------------------------------
// Per-activity figures. Each is absent rather than zero when the reading it
// needs is missing — a zero pace sits at the fast end of every chart it reaches.
// ---------------------------------------------------------------------------

assert.equal(paceSecondsPerKm(run({ distance: 10_000, duration: 3000 })), 300);
assert.equal(paceSecondsPerKm(run({ distance: 0 })), undefined);
assert.equal(paceSecondsPerKm(run({ distance: undefined })), undefined);
assert.equal(paceSecondsPerKm(run({ duration: 0 })), undefined);

// 10 km in 50 minutes is 200 m/min; at 150 bpm that is 1.333 m per beat-minute.
const ef = efficiencyIndex(run({ distance: 10_000, duration: 3000, avgHr: 150 }));
assert.ok(Math.abs(ef - 200 / 150) < 1e-9);
assert.equal(efficiencyIndex(run({ avgHr: undefined })), undefined);
assert.equal(efficiencyIndex(run({ avgHr: 0 })), undefined);
assert.equal(efficiencyIndex(run({ distance: undefined })), undefined);

assert.equal(elevationPerKm(run({ distance: 10_000, elevationGain: 100 })), 10);
assert.equal(
  elevationPerKm(run({ elevationGain: 0 })),
  0,
  "a flat run climbed nothing — that is a reading, not a gap"
);
assert.equal(elevationPerKm(run({ elevationGain: undefined })), undefined);

assert.equal(verticalSpeed(run({ duration: 3600, elevationGain: 600 })), 600);
assert.equal(verticalSpeed(run({ elevationGain: 0 })), 0);
assert.equal(verticalSpeed(run({ elevationGain: undefined })), undefined);

// ---------------------------------------------------------------------------
// Weekly buckets. Monday-start, and a week nobody ran is a zero bar rather than
// a missing one — dropping it slides every later bar left and makes a fortnight
// off look like uninterrupted training.
// ---------------------------------------------------------------------------

const mondayOfCurrentWeek = new Date(2026, 8, 14, 0, 0, 0).getTime();
assert.equal(startOfRunWeekMs(NOW), mondayOfCurrentWeek);
assert.equal(
  startOfRunWeekMs(new Date(2026, 8, 20, 23, 59, 0).getTime()),
  mondayOfCurrentWeek,
  "Sunday belongs to the week that opened on Monday"
);

const weekFixtures = [
  run({ activityId: "w0", startTime: secondsAt(2026, 8, 14), distance: 7_000 }),
  run({ activityId: "w1a", startTime: secondsAt(2026, 8, 8), distance: 5_000 }),
  run({ activityId: "w1b", startTime: secondsAt(2026, 8, 9), distance: 12_000 }),
  run({
    activityId: "w1c",
    startTime: secondsAt(2026, 8, 10),
    sportType: 102,
    distance: 8_000
  }),
  // Two weeks back is deliberately empty, and this one sits outside the window.
  run({ activityId: "old", startTime: secondsAt(2026, 7, 3), distance: 30_000 }),
  run({ activityId: "notarun", startTime: secondsAt(2026, 8, 9), sportType: 200 })
];

const weeks = buildRunWeeks(weekFixtures, { weeks: 4, nowMs: NOW });
assert.equal(weeks.length, 4);
assert.deepEqual(
  weeks.map((week) => week.weekStartMs),
  [
    new Date(2026, 7, 24).getTime(),
    new Date(2026, 7, 31).getTime(),
    new Date(2026, 8, 7).getTime(),
    new Date(2026, 8, 14).getTime()
  ],
  "oldest first, one bucket per week, no gaps"
);

const lastWeek = weeks[2];
assert.equal(lastWeek.count, 3, "the bike ride is not a run");
assert.equal(lastWeek.distance, 25_000);
assert.equal(lastWeek.longestRunMeters, 12_000);
assert.equal(lastWeek.distanceBySurface.road, 17_000);
assert.equal(lastWeek.distanceBySurface.trail, 8_000);
assert.equal(lastWeek.distanceBySurface.track, 0);

const emptyWeek = weeks[1];
assert.equal(emptyWeek.count, 0);
assert.equal(emptyWeek.distance, 0);
assert.ok(emptyWeek.label.length > 0, "a zero week still names itself");

assert.equal(weeks[3].count, 1);
assert.equal(
  weeks.every((week) => week.weekStartMs !== new Date(2026, 7, 3).getTime()),
  true,
  "an activity older than the window does not create a bucket"
);
assert.deepEqual(buildRunWeeks(weekFixtures, { weeks: 0, nowMs: NOW }), []);

// ---------------------------------------------------------------------------
// Acute-to-chronic load, running only. COROS ships a ratio of its own but takes
// it across every sport, so a heavy week of lifting moves it.
// ---------------------------------------------------------------------------

const loadFixtures = [
  run({ activityId: "l1", startTime: secondsAgo(2), trainingLoad: 100 }),
  run({ activityId: "l2", startTime: secondsAgo(5), trainingLoad: 80 }),
  run({ activityId: "l3", startTime: secondsAgo(20), trainingLoad: 60 }),
  run({ activityId: "l4", startTime: secondsAgo(40), trainingLoad: 500 }),
  run({
    activityId: "lift",
    startTime: secondsAgo(3),
    sportType: 402,
    trainingLoad: 400
  })
];

const balance = runLoadBalance(loadFixtures, NOW);
assert.equal(balance.acute, 180, "strength load stays out of the running ratio");
assert.equal(balance.chronic, 60, "240 across 28 days is 60 a week");
assert.equal(balance.ratio, 3);
assert.ok(Math.abs(balance.oldestRunDaysAgo - 20) < 0.01);

const emptyBalance = runLoadBalance([], NOW);
assert.equal(emptyBalance.acute, 0);
assert.equal(emptyBalance.ratio, undefined, "nothing to divide by");
assert.equal(emptyBalance.oldestRunDaysAgo, undefined);

// ---------------------------------------------------------------------------
// Zones. COROS states a zone by its ceiling and caps the top one with a
// sentinel far above any real pulse.
// ---------------------------------------------------------------------------

const zones = [
  { index: 1, hr: 130 },
  { index: 2, hr: 145 },
  { index: 3, hr: 160 },
  { index: 4, hr: 175 },
  { index: 5, hr: 404 }
];

assert.equal(heartRateZoneIndex(120, zones), 1);
assert.equal(heartRateZoneIndex(130, zones), 1, "the ceiling belongs to its zone");
assert.equal(heartRateZoneIndex(131, zones), 2);
assert.equal(heartRateZoneIndex(170, zones), 4);
assert.equal(heartRateZoneIndex(200, zones), 5);
assert.equal(heartRateZoneIndex(undefined, zones), undefined);
assert.equal(heartRateZoneIndex(150, []), undefined);

assert.equal(runIntensity(120, zones), "easy");
assert.equal(runIntensity(140, zones), "easy");
assert.equal(runIntensity(150, zones), "moderate");
assert.equal(runIntensity(170, zones), "hard");
assert.equal(runIntensity(200, zones), "hard");
assert.equal(runIntensity(150, zones.slice(0, 2)), undefined, "too few zones to judge");
assert.equal(runIntensity(undefined, zones), undefined);

// ---------------------------------------------------------------------------
// Decoupling. Same heart rate, slower second half: the run cost more as it went
// on, which is what the figure is meant to catch.
// ---------------------------------------------------------------------------

const drifting = Array.from({ length: 40 }, (_, index) => ({
  elapsed: index * 100,
  hr: 150,
  pace: index < 20 ? 300 : 330
}));

const decoupling = paceHrDecoupling(drifting);
assert.ok(Math.abs(decoupling.firstHalf - 200 / 150) < 1e-9);
assert.ok(Math.abs(decoupling.secondHalf - (60_000 / 330) / 150) < 1e-9);
assert.ok(
  decoupling.percent > 9 && decoupling.percent < 9.2,
  `expected ~9.09% drift, got ${decoupling.percent}`
);

const steady = Array.from({ length: 40 }, (_, index) => ({
  elapsed: index * 100,
  hr: 150,
  pace: 300
}));
assert.ok(Math.abs(paceHrDecoupling(steady).percent) < 1e-9);

assert.equal(paceHrDecoupling(undefined), undefined);
assert.equal(paceHrDecoupling(drifting.slice(0, 10)), undefined, "too few samples");
assert.equal(
  paceHrDecoupling(drifting.map(({ elapsed }) => ({ elapsed }))),
  undefined,
  "no pace or HR channel to compare"
);

// ---------------------------------------------------------------------------
// Totals.
// ---------------------------------------------------------------------------

const totals = summariseRuns(mixed);
assert.equal(totals.count, 2, "hike and bike are not runs");
assert.equal(totals.distance, 20_000);

const bySurface = distanceBySurface(weekFixtures);
assert.equal(bySurface.trail, 8_000);
assert.equal(bySurface.road, 54_000);
assert.equal(bySurface.treadmill, 0);

console.log("run metrics: OK");
