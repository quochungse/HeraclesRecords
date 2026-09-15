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
  activeElapsed,
  buildRunEfficiencyWeeks,
  buildRunWeeks,
  runIntensityMix,
  runSurfaceBreakdown,
  distanceBySurface,
  efficiencyIndex,
  elevationPerKm,
  heartRateZoneIndex,
  paceHrDecoupling,
  paceSecondsPerKm,
  runIntensity,
  runLoadBalance,
  runSeconds,
  startOfRunWeekMs,
  summariseRuns,
  verticalSpeed,
  withPausesRemoved
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
// Activity time. COROS's `duration` runs start to finish with the pauses in it;
// every figure here is about time spent running. The numbers are a real road
// run's: 10.2 km, 7 102 s start to finish, 4 190 s of it running.
// ---------------------------------------------------------------------------

const paused = run({ distance: 10_200, duration: 7102, activeDuration: 4190, avgHr: 150 });
assert.equal(runSeconds(paused), 4190);
assert.equal(runSeconds(run({ duration: 3000 })), 3000, "no activity time sent: the one clock there is");
assert.equal(runSeconds(run({ duration: 3000, activeDuration: 0 })), 3000, "a zero is not a reading");
assert.ok(
  Math.abs(paceSecondsPerKm(paused) - 4190 / 10.2) < 1e-9,
  "6:51 /km, not the 11:36 the pauses would make it"
);
assert.ok(Math.abs(efficiencyIndex(paused) - 10_200 / (4190 / 60) / 150) < 1e-9);
assert.equal(verticalSpeed(run({ duration: 7200, activeDuration: 3600, elevationGain: 600 })), 600);
assert.equal(summariseRuns([paused, run({ duration: 1000 })]).duration, 5190);
assert.equal(
  runIntensityMix([paused], [{ index: 0, hr: 140 }, { index: 1, hr: 155 }, { index: 2, hr: 170 }]).easy.duration,
  4190
);
assert.equal(
  buildRunEfficiencyWeeks(
    [run({ startTime: secondsAgo(1), duration: 1800, activeDuration: 1100 })],
    { weeks: 1, nowMs: NOW }
  )[0].count,
  0,
  "18 minutes of running is too short for efficiency, however long the stops were"
);

// Pauses sit on the wall clock; the samples go quiet through them.
const pauses = [
  { start: 1120, duration: 694 },
  { start: 2524, duration: 2218 }
];
assert.equal(activeElapsed(0, pauses), 0);
assert.equal(activeElapsed(1120, pauses), 1120, "the moment of the press");
assert.equal(activeElapsed(1500, pauses), 1120, "inside a pause lands where it began");
assert.equal(activeElapsed(1814, pauses), 1120, "and resumes from there");
assert.equal(activeElapsed(1820, pauses), 1126);
assert.equal(activeElapsed(7102, pauses), 7102 - 694 - 2218, "the end is the activity time");

const wallClock = [
  { elapsed: 0, hr: 110 },
  { elapsed: 1120, hr: 155 },
  { elapsed: 1813, hr: 112 },
  { distance: 500 },
  { elapsed: 7102, hr: 169 }
];
const onActivityTime = withPausesRemoved(wallClock, [...pauses].reverse());
assert.deepEqual(
  onActivityTime.map((point) => point.elapsed),
  [0, 1120, 1120, undefined, 4190],
  "order-independent, and a point with no clock is left alone"
);
assert.equal(onActivityTime[2].hr, 112, "only the clock moves");
assert.deepEqual(withPausesRemoved(wallClock, undefined), wallClock);
assert.notEqual(withPausesRemoved(wallClock, []), wallClock, "a copy, never the caller's array");

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

// The shape COROS actually sends, read off a live account: six ceilings whose
// `index` starts at **zero**, as percentages of a 168 bpm threshold. Position in
// the sorted list is the zone number either way, which is what makes the easy /
// moderate / hard mapping survive both a five- and a six-zone model.
const liveZones = [
  { index: 0, hr: 134, ratio: 80 },
  { index: 1, hr: 151, ratio: 90 },
  { index: 2, hr: 160, ratio: 95 },
  { index: 3, hr: 171, ratio: 102 },
  { index: 4, hr: 178, ratio: 106 },
  { index: 5, hr: 218, ratio: 130 }
];

assert.equal(heartRateZoneIndex(130, liveZones), 1, "a zero-based index is still zone 1");
assert.equal(heartRateZoneIndex(151, liveZones), 2);
assert.equal(heartRateZoneIndex(152, liveZones), 3);
assert.equal(heartRateZoneIndex(172, liveZones), 5);
assert.equal(runIntensity(140, liveZones), "easy");
assert.equal(
  runIntensity(158, liveZones),
  "moderate",
  "the grey zone this account lives in reads as moderate, not easy"
);
assert.equal(runIntensity(169, liveZones), "hard");

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

// ---------------------------------------------------------------------------
// Efficiency by week. Only steady running counts: a ten-minute shakeout spends
// most of its length with the pulse still climbing, and would read as a jump in
// fitness that never happened.
// ---------------------------------------------------------------------------

const efficiencyFixtures = [
  // Easy, long enough, last week: 10 km in 50 min at 140 bpm -> 200/140.
  run({
    activityId: "ef-easy",
    startTime: secondsAt(2026, 8, 9),
    distance: 10_000,
    duration: 3000,
    avgHr: 140
  }),
  // Same week, same numbers, but a hard effort — excluded once zones are known.
  run({
    activityId: "ef-hard",
    startTime: secondsAt(2026, 8, 10),
    distance: 10_000,
    duration: 3000,
    avgHr: 170
  }),
  // Easy but only 15 minutes: too short for an average to mean anything.
  run({
    activityId: "ef-short",
    startTime: secondsAt(2026, 8, 11),
    distance: 3_000,
    duration: 900,
    avgHr: 120
  }),
  // Trail, easy, long enough — its own surface line.
  run({
    activityId: "ef-trail",
    startTime: secondsAt(2026, 8, 12),
    sportType: 102,
    distance: 8_000,
    duration: 3200,
    avgHr: 140
  })
];

const efficiencyWeeks = buildRunEfficiencyWeeks(efficiencyFixtures, {
  weeks: 3,
  nowMs: NOW,
  zones
});
assert.equal(efficiencyWeeks.length, 3);

const efLastWeek = efficiencyWeeks[1];
assert.equal(efLastWeek.count, 2, "the hard run and the short run are both out");
assert.ok(Math.abs(efLastWeek.bySurface.road - 200 / 140) < 1e-9);
assert.ok(Math.abs(efLastWeek.bySurface.trail - (8000 / (3200 / 60)) / 140) < 1e-9);
assert.equal(
  efLastWeek.bySurface.track,
  undefined,
  "a surface with no run that week has no figure, not a zero"
);

// Without zones there is no way to tell easy from hard, so every long enough
// run counts — the caller is expected to say which of the two it is showing.
const efficiencyNoZones = buildRunEfficiencyWeeks(efficiencyFixtures, {
  weeks: 3,
  nowMs: NOW
});
assert.equal(efficiencyNoZones[1].count, 3, "hard running is counted, the shakeout is not");

// ---------------------------------------------------------------------------
// Intensity mix. Counted both ways because they disagree, and the disagreement
// is the point: the 80/20 rule is stated about time, not about sessions.
// ---------------------------------------------------------------------------

const mix = runIntensityMix(
  [
    run({ activityId: "m1", avgHr: 120, duration: 3600 }),
    run({ activityId: "m2", avgHr: 125, duration: 5400 }),
    run({ activityId: "m3", avgHr: 150, duration: 1800 }),
    run({ activityId: "m4", avgHr: 170, duration: 900 }),
    run({ activityId: "m5", avgHr: 172, duration: 900 }),
    run({ activityId: "m6", avgHr: undefined, duration: 1200 }),
    run({ activityId: "m7", sportType: 200, avgHr: 120, duration: 7200 })
  ],
  zones
);
assert.equal(mix.easy.count, 2);
assert.equal(mix.easy.duration, 9000);
assert.equal(mix.moderate.count, 1);
assert.equal(mix.hard.count, 2);
assert.equal(mix.hard.duration, 1800);
assert.equal(mix.unrated.count, 1, "a run with no heart rate is placed nowhere");
assert.equal(
  mix.easy.count + mix.moderate.count + mix.hard.count + mix.unrated.count,
  6,
  "the bike ride is not a run"
);
// A run long enough to count, placed by its average: zones decide easy from
// hard, and this week's Monday keeps it inside the single week asked for.
assert.equal(
  buildRunEfficiencyWeeks(
    [run({ activityId: "grey", startTime: secondsAt(2026, 8, 14, 7), avgHr: 165, duration: 3600 })],
    { weeks: 1, nowMs: NOW, zones }
  )[0].count,
  0,
  "hard running is not efficiency data"
);

// ---------------------------------------------------------------------------
// Surface breakdown. A treadmill reports no terrain, so it gets no climb
// figures rather than zeros that would drag the outdoor numbers down beside it.
// ---------------------------------------------------------------------------

const breakdown = runSurfaceBreakdown([
  run({ activityId: "s1", sportType: 100, distance: 10_000, duration: 3000, elevationGain: 50 }),
  run({ activityId: "s2", sportType: 102, distance: 5_000, duration: 2400, elevationGain: 300 }),
  run({ activityId: "s3", sportType: 101, distance: 5_000, duration: 1800, elevationGain: 0 }),
  run({ activityId: "s4", sportType: 200, distance: 40_000, duration: 3600 })
]);

assert.deepEqual(
  breakdown.map((entry) => entry.surface),
  ["road", "trail", "treadmill"],
  "render order, and a surface with no runs is left out"
);

const road = breakdown[0];
assert.equal(road.distance, 10_000);
assert.equal(road.pace, 300);
assert.equal(road.elevationPerKm, 5);
assert.ok(Math.abs(road.share - 0.5) < 1e-9, "the bike ride is not in the denominator");

const trail = breakdown[1];
assert.equal(trail.elevationPerKm, 60);
assert.equal(trail.verticalSpeed, 450, "300 m in 40 minutes is 450 m an hour");

const treadmill = breakdown[2];
assert.equal(treadmill.elevationPerKm, undefined);
assert.equal(treadmill.verticalSpeed, undefined);
assert.equal(treadmill.pace, 360);

console.log("run metrics: OK");
