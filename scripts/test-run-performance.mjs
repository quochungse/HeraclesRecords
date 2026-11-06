// Running performance: the raw curve `electron/runPerformance.ts` keeps on a
// road or track run's summary, how it is read on the account's heart-rate
// figures (ACSM's running equation over Swain's share of the reserve), the
// usual curve that a minute is compared with and the steady band it is read
// in, the athlete's one scale onto COROS's VO2max, and the Running screen's
// model over them (`runPerformanceModel.ts`).
//
// Launched through Electron rather than plain node because the modules are
// TypeScript and a distro Node built without Amaro cannot strip them; the
// resolver hook is for the extensionless imports under the model.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) => import(pathToFileURL(path.join(root, file)).href + bust);
const perf = await load("electron/runPerformance.ts");
const metrics = await load("electron/activityMetrics.ts");
const model = await load("src/running/runPerformanceModel.ts");

const PROFILE = { maxHr: 190, restingHr: 52 };
const close = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, got ${actual}`
  );

/** The heart rate a runner of effective VO2max `eff` settles at for `speed` m/min. */
const hrFor = (speed, eff) =>
  PROFILE.restingHr +
  ((perf.oxygenCost(speed) - 3.5) / (eff - 3.5)) * (PROFILE.maxHr - PROFILE.restingHr);

/**
 * A run a second at a time: pace from `paceAt(t)` (s/km), the runner's true
 * figure from `effAt(t)`, heart rate following its target with a 42-second
 * time constant (the response measured on real runs), cadence from `cadenceAt`.
 */
function simulate({ seconds, paceAt, effAt = () => 48, cadenceAt = () => 166 }) {
  const series = [];
  let hr = 95;
  for (let t = 0; t < seconds; t += 1) {
    const pace = paceAt(t);
    const target = hrFor(60_000 / pace, effAt(t));
    hr += (target - hr) * (1 - Math.exp(-1 / 42));
    series.push({ elapsed: t, pace, adjustedPace: pace, hr, cadence: cadenceAt(t) });
  }
  return series;
}

// ---------------------------------------------------------------------------
// The sports it reads, and the figure itself.
// ---------------------------------------------------------------------------

assert.equal(perf.sportHasRunPerformance(100), true, "road");
assert.equal(perf.sportHasRunPerformance(103), true, "track");
assert.equal(perf.sportHasRunPerformance(101), false, "a treadmill's pace is the watch's guess");
assert.equal(perf.sportHasRunPerformance(102), false, "on a trail the ground decides the pace");
assert.equal(perf.sportHasRunPerformance(200), false);

// 200 m/min at 150 bpm on 190/52: cost 43.5, 71.0% of the reserve.
close(perf.oxygenCost(200), 43.5, 1e-9, "ACSM: 0.2 ml/kg a metre, and 3.5 at rest");
close(perf.effectiveVo2max(200, 150, PROFILE), 59.83, 0.02, "ACSM's cost over Swain's share");
assert.equal(perf.effectiveVo2max(120, 100, PROFILE), undefined, "under 40% of the reserve is a walk, not a reading");
assert.equal(perf.effectiveVo2max(300, 200, PROFILE), undefined, "past the maximum is a strap fault");
// The run page says which of the two a step was, and an out-of-date maximum is
// not an easy stretch: it is usually the hardest one.
assert.equal(perf.readingGapReason(300, 200, PROFILE), "aboveMax");
assert.equal(perf.readingGapReason(120, 100, PROFILE), "tooEasy");
assert.equal(perf.readingGapReason(200, 150, PROFILE), undefined, "a step with a figure has no gap");
assert.equal(perf.performanceGapKind("aboveMax"), "noData");
assert.deepEqual(perf.performanceProfile(190, 52), PROFILE);
assert.equal(perf.performanceProfile(undefined, 52), undefined);
assert.equal(perf.performanceProfile(150, 120), undefined, "a reserve that small is a wrong setting");

// ---------------------------------------------------------------------------
// The raw curve: only what can be trusted is kept.
// ---------------------------------------------------------------------------

const steady = simulate({ seconds: 40 * 60, paceAt: () => 330 });
const steadyCurve = perf.runPerformanceCurve(steady, 47);
assert.equal(steadyCurve.version, perf.PERFORMANCE_SUMMARY_VERSION);
assert.equal(steadyCurve.lag, 40, "heart rate is read 40 s behind the pace, as measured");
assert.equal(steadyCurve.corosVo2max, 47, "COROS's VO2max rides along as the scale's anchor");
assert.ok(
  steadyCurve.points.every(([t]) => t >= perf.PERFORMANCE_WARM_UP_SECONDS),
  "nothing is read in the ten-minute warm-up"
);
const possible = (40 * 60 - perf.PERFORMANCE_WARM_UP_SECONDS) / perf.PERFORMANCE_STEP_SECONDS;
assert.ok(steadyCurve.points.length >= possible * 0.8, `a steady run is read almost whole, got ${steadyCurve.points.length}/${possible}`);
for (const point of perf.performancePoints(steadyCurve, PROFILE)) {
  close(point.value, 48, 0.3, `steady running reads the runner's figure at ${point.t}s`);
  close(point.share, (point.heartRate - PROFILE.restingHr) / (PROFILE.maxHr - PROFILE.restingHr), 1e-9, "each reading keeps its share of the reserve");
}
assert.equal(perf.runPerformanceCurve(steady.slice(0, 9 * 60)).points.length, 0, "under ten minutes nothing is read");
assert.equal(perf.runPerformanceCurve(steady, 7).corosVo2max, undefined, "a VO2max of 7 is not one");
assert.deepEqual(
  perf.performanceCurveFromSteps(perf.runPerformanceSteps(steady), 47),
  steadyCurve,
  "the run page's curve, built from the steps it draws, is the one the summary keeps"
);

// Intervals: 4-minute reps at 4:45 with 2-minute jogs. No reading where the
// heart is still catching up with the legs; what is read is still the runner.
const changes = [];
const intervals = simulate({
  seconds: 60 * 60,
  paceAt: (t) => {
    if (t < 900) return 360;
    const cycle = (t - 900) % 360;
    return cycle < 240 ? 285 : 410;
  }
});
for (let t = 900; t < 3600; t += 360) changes.push(t, t + 240);
const intervalPoints = perf.performancePoints(perf.runPerformanceCurve(intervals), PROFILE);
assert.ok(intervalPoints.length > 0, "the middle of a long rep is steady enough to read");
for (const point of intervalPoints) {
  const fromChange = Math.min(...changes.map((at) => (point.t >= at ? point.t - at : Infinity)));
  assert.ok(fromChange >= 60, `no reading ${fromChange}s after a change of pace (at ${point.t}s)`);
  close(point.value, 48, 48 * 0.03, `a settled stretch reads the runner at ${point.t}s`);
}

// A walk to cool down at the end is not running slowly.
const walkedEnd = simulate({
  seconds: 45 * 60,
  paceAt: (t) => (t < 35 * 60 ? 330 : 720),
  cadenceAt: (t) => (t < 35 * 60 ? 166 : 112)
});
assert.ok(
  perf.runPerformanceCurve(walkedEnd).points.every(([t]) => t < 35 * 60),
  "nothing is read once the cadence says walking"
);

// Every step says why it was not read, in two kinds the page tells apart.
const reasonsOf = (series) => perf.runPerformanceSteps(series).map((step) => step.reason ?? "read");
const walkedReasons = reasonsOf(walkedEnd);
assert.equal(walkedReasons[0], "warmUp");
assert.ok(walkedReasons.slice(-10).every((reason) => reason === "walking" || reason === "end"), "the walk reads as walking");
assert.equal(walkedReasons.at(-1), "end", "the last 85 s have no heart rate after them to read");
const intervalReasons = reasonsOf(intervals);
assert.ok(intervalReasons.includes("paceChanging"), "a change of pace is not steady");
const paused = steady.map((point) => (point.elapsed >= 1500 && point.elapsed < 1600 ? { ...point, adjustedPace: undefined, pace: undefined } : point));
assert.equal(reasonsOf(paused)[1530 / 30], "stopped", "no pace at all is nothing to compare");
const noPulse = steady.map((point) => (point.elapsed >= 1400 && point.elapsed < 1700 ? { ...point, hr: undefined } : point));
assert.ok(reasonsOf(noPulse).includes("noHeartRate"));
assert.equal(perf.performanceGapKind("walking"), "noData");
assert.equal(perf.performanceGapKind("stopped"), "noData");
assert.equal(perf.performanceGapKind("paceChanging"), "unsteady");
assert.equal(perf.performanceGapKind("heartRateSettling"), "unsteady");
assert.equal(perf.performanceGapKind("warmUp"), "unsteady");
// A heart a little restless at a steady pace is still read: swings of up to ~7 bpm a minute, as real runs show.
const restless = steady.map((point) => ({ ...point, hr: point.hr + 3.5 * Math.sin(point.elapsed / 25) }));
const restlessRead = reasonsOf(restless).filter((reason) => reason === "read").length;
assert.ok(restlessRead >= possible * 0.8, `a restless pulse on steady running is read: ${restlessRead}/${possible}`);

// ---------------------------------------------------------------------------
// The usual curve, and a run read against it.
// ---------------------------------------------------------------------------

/**
 * A run whose true figure falls 6% between minute 50 and minute 90, as long
 * runs do — at 6:20/km, steady aerobic running for these figures (66–76% of the
 * reserve), the band the usual is read in.
 */
const drifting = (minutes, level = 48) =>
  simulate({
    seconds: minutes * 60,
    paceAt: () => 380,
    effAt: (t) => level * (1 - 0.06 * Math.min(1, Math.max(0, (t / 60 - 50) / 40)))
  });
const history = [95, 92, 70, 60, 45].map((minutes) =>
  perf.performancePoints(perf.runPerformanceCurve(drifting(minutes)), PROFILE)
);
const shape = perf.performanceShape(history);
assert.ok(shape, "five runs make a shape");
close(perf.shapeAt(shape, 30 * 60), 1, 0.01, "flat while fresh");
close(perf.shapeAt(shape, 68 * 60), 1 - 0.06 * (18 / 40), 0.012, "the usual fall by minute 68");
assert.ok(shape.lastMinute < 92, `only three runs need reach a minute, and only two passed 70: last ${shape.lastMinute}`);
// The last reading of a 70-minute run is at 68: it needs the lag and half a window after it.
assert.ok(shape.lastMinute >= 67, `three runs were read to minute 67: last ${shape.lastMinute}`);
assert.equal(perf.shapeAt(shape, 120 * 60), perf.shapeAt(shape, shape.lastMinute * 60), "held past its last minute");
assert.equal(perf.shapeAt(undefined, 80 * 60), 1, "no shape: no correction");
assert.equal(perf.performanceShape(history.slice(0, 2)), undefined, "two runs are not a usual");

const longRun = history[0];
const flatRead = perf.sessionPerformance(longRun, undefined);
const shapedRead = perf.sessionPerformance(longRun, shape);
assert.ok(flatRead < shapedRead, `read flat, a long run is marked down for its own fatigue: ${flatRead} < ${shapedRead}`);
close(shapedRead, 48, 0.6, "against the usual curve a long run reads the runner");

// ---------------------------------------------------------------------------
// Baseline, scale, verdict.
// ---------------------------------------------------------------------------

const runs = history.map((points) => ({ points, corosVo2max: 47 }));
assert.equal(perf.performanceBaseline(runs.slice(0, 2)), undefined, "fewer than three runs: no usual");
const baseline = perf.performanceBaseline(runs);
close(baseline.value, 48, 0.6, "the usual is the median run");
const scale = perf.performanceScale(runs, baseline.shape);
close(scale * baseline.value, 47, 0.01, "scaled, the usual reads as COROS's VO2max");
assert.equal(perf.performanceScale(history.map((points) => ({ points })), baseline.shape), undefined, "no anchor, no scale");
close(perf.athleteScale(runs), scale, 1e-9, "the athlete's scale reads its own shape over the same runs");

// The usual is read in the steady band. A tempo run — every reading above 80%
// of the reserve — is drawn but does not move it, however it went; a block of
// nothing but hard running still has a usual.
const tempoRun = (level) =>
  perf.performanceRun(perf.runPerformanceCurve(simulate({ seconds: 45 * 60, paceAt: () => 280, effAt: () => level }), 47), PROFILE);
const tempo = tempoRun(55);
assert.ok(tempo.points.length > 20, "a tempo run is read");
assert.ok(tempo.points.every((point) => point.share > perf.STEADY_SHARE_MAX), "and sits above the band");
close(perf.performanceBaseline([...runs, tempo, tempo]).value, baseline.value, 1e-9, "tempo runs leave the usual where it was");
close(
  perf.performanceScale([...runs, tempo, tempo], baseline.shape),
  scale,
  1e-9,
  "or the scale"
);
const hardBlock = [tempoRun(54), tempoRun(55), tempoRun(56)];
close(perf.performanceBaseline(hardBlock).value, 55, 0.3, "with too few steady runs, every reading counts");

assert.equal(perf.performanceVerdict(49.5, 48), "better");
assert.equal(perf.performanceVerdict(47, 48), "usual", "within 3% is as usual");
assert.equal(perf.performanceVerdict(46.5, 48), "worse");

assert.equal(
  perf.shapeAt(shape, (shape.lastMinute + 30) * 60),
  perf.shapeAt(shape, shape.lastMinute * 60),
  "past the minutes the history reaches, the usual is held at its last level"
);

// ---------------------------------------------------------------------------
// The summary keeps the curve for road and track runs only.
// ---------------------------------------------------------------------------

const summarize = (sportType, summary) =>
  metrics.summarizeActivityDetail({
    activityId: "a",
    fingerprint: "f",
    detail: { sportType, series: steady, hrZones: [], pauses: [] },
    raw: { summary },
    now: 1
  });
const road = summarize(100, { currentVo2Max: 47 });
assert.equal(road.performanceVersion, perf.PERFORMANCE_SUMMARY_VERSION);
assert.equal(road.performance.corosVo2max, 47);
assert.equal(summarize(100, { currentVo2Max: 0, hrmVo2Max: 45 }).performance.corosVo2max, 45, "as the page reads it");
assert.equal(summarize(101, { currentVo2Max: 47 }).performance, undefined, "a treadmill keeps none");
assert.equal(summarize(200, {}).performanceVersion, undefined, "a ride keeps none");
assert.ok(JSON.stringify(road.performance).length < 4000, "small enough to keep on every run's row");

// ---------------------------------------------------------------------------
// The Running screen's model.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12);
const activity = (id, daysAgo, sportType = 100, extra = {}) => ({
  activityId: id,
  sportType,
  startTime: (NOW - daysAgo * DAY) / 1000,
  distance: 10_000,
  duration: 3000,
  ...extra
});
const all = [
  activity("old", 60),
  activity("r1", 30),
  activity("r2", 20),
  activity("tm", 15, 101),
  activity("trail", 12, 102),
  activity("r3", 10),
  activity("r4", 3)
];
assert.deepEqual(
  model.performanceHistory(all, NOW - 3 * DAY).map((a) => a.activityId),
  ["r1", "r2", "r3"],
  "six weeks before the run, road and track only, the run itself excluded"
);
assert.deepEqual(
  model.performanceRunsNeeded(all, [all[3 + 2], all[6]]).map((a) => a.activityId),
  ["r1", "r2", "r3", "r4"],
  "the runs shown and the six weeks before the oldest; the scale's year is a read of its own"
);
assert.deepEqual(
  model.performanceScaleRuns([...all, activity("y-old", 400)], NOW).map((a) => a.activityId),
  ["r4", "r3", "r2", "r1", "old"],
  "the scale's year: road and track runs, none older than a year, newest first so a capped sweep reads the recent months"
);
assert.deepEqual(model.performanceRunsNeeded(all, []), [], "nothing shown, nothing needed");

const curveOf = (level, coros = 47) => ({
  ...perf.runPerformanceCurve(drifting(50, level), coros)
});
const summaries = new Map(
  [
    ["r1", curveOf(47)],
    ["r2", curveOf(48)],
    ["r3", curveOf(49)],
    ["r4", curveOf(51)]
  ].map(([id, performance]) => [
    id,
    { activityId: id, fingerprint: "f", summaryVersion: 2, computedAt: 0, performanceVersion: perf.PERFORMANCE_SUMMARY_VERSION, performance }
  ])
);
summaries.set("old", {
  activityId: "old",
  fingerprint: "f",
  summaryVersion: 2,
  computedAt: 0,
  performanceVersion: perf.PERFORMANCE_SUMMARY_VERSION - 1,
  performance: curveOf(40)
});
assert.deepEqual(
  model.performanceCoverage(all, summaries),
  { read: 4, total: 5 },
  "an older curve counts as unread; a treadmill and a trail run count as nothing"
);

const context = model.performanceContext(
  model.performanceHistory(all, NOW),
  summaries,
  PROFILE,
  model.performanceAthleteScale(model.performanceScaleRuns(all, NOW), summaries, PROFILE)
);
assert.equal(context.runs, 4);
close(context.baseline.value * context.scale, 47, 0.01, "over the same runs, the usual reads as COROS's VO2max");
const sessions = model.performanceSessions(all, summaries, PROFILE, context);
assert.deepEqual(
  sessions.map((session) => session.activity.activityId),
  ["r1", "r2", "r3", "r4"],
  "oldest first, and only runs with a current curve"
);
assert.ok(sessions[3].change > 3, `the best run reads above the usual: ${sessions[3].change}`);
assert.ok(sessions[0].pace > 0, "the list's pace rides along for the quadrant");

const weeks = model.performanceWeeks(sessions, 6, NOW);
assert.equal(weeks.length, 6, "one row per week, no gaps");
assert.equal(weeks.filter((week) => week.value !== undefined).length, 4);
assert.ok(model.performanceTrend(weeks).change > 0, "four weeks of rising runs is a trend");
assert.equal(model.performanceTrend(weeks.slice(-1)), undefined, "a single week is not one");
{
  // The trend through the runs: at each run, the median of the seven days up
  // to it, that run included. A run exactly seven days back has left the window.
  const at = (day, value) => ({ startedAtMs: NOW - day * DAY, value });
  const line = model.performanceRollingMedian([at(20, 40), at(15, 50), at(14, 44), at(12, 46), at(5, 42)]);
  assert.deepEqual(
    line.map((point) => point.x),
    [20, 15, 14, 12, 5].map((day) => NOW - day * DAY),
    "a point at every run, from the first to the last"
  );
  assert.deepEqual(line.map((point) => point.median), [40, 45, 44, 46, 42]);
  assert.deepEqual(model.performanceRollingMedian([]), []);
}
{
  const values = sessions.map((s) => s.value).sort((a, b) => a - b);
  close(model.performanceForm(sessions), (values[1] + values[2]) / 2, 1e-9, "form is the median of the period's runs");
  assert.equal(model.performanceForm([]), undefined);
}

// One scale over the year, not over the six weeks: earlier, fitter months with
// the same COROS figure leave the last six weeks' usual below it, and a run's
// page reads with the scale the Running screen does.
{
  const year = [
    ...all,
    activity("y1", 300),
    activity("y2", 250),
    activity("y3", 200),
    activity("y4", 150),
    activity("y5", 100)
  ];
  // The year's own read holds every run of the year; the screen's holds only
  // the six weeks its usual needs.
  const yearRead = new Map(summaries);
  for (const id of ["y1", "y2", "y3", "y4", "y5"]) {
    yearRead.set(id, { ...summaries.get("r1"), activityId: id, performance: curveOf(53) });
  }
  const scale = model.performanceAthleteScale(model.performanceScaleRuns(year, NOW), yearRead, PROFILE);
  const screen = model.performanceContext(model.performanceHistory(year, NOW), summaries, PROFILE, scale);
  assert.equal(screen.scale, scale, "the context takes the athlete's scale as given");
  assert.ok(
    screen.baseline.value * screen.scale < 46,
    `six weeks short of the year read below COROS's 47: ${screen.baseline.value * screen.scale}`
  );
  assert.notEqual(
    model.performanceAthleteScale(model.performanceScaleRuns(year, NOW), summaries, PROFILE),
    scale,
    "worked out from the screen's own read, the year's runs would be missing"
  );
}

// The year not read yet: the six weeks stand in for it, so the figures are on
// COROS's scale rather than raw.
{
  const waiting = model.performanceContext(model.performanceHistory(all, NOW), summaries, PROFILE, undefined);
  close(waiting.scale, context.scale, 1e-9, "the six weeks' own scale until the year is read");
}

// Nothing anchored at all: the run alone anchors the scale, so the figure is still on COROS's scale.
const own = perf.performanceRun(curveOf(48, 46), PROFILE);
const alone = model.performanceContext([], summaries, PROFILE, undefined, own);
assert.equal(alone.baseline, undefined);
close(perf.sessionPerformance(own.points, undefined) * alone.scale, 46, 0.01, "anchored on its own COROS VO2max");

// Axes on round steps, never +27 / +17 / +7.
assert.deepEqual(model.niceScale(-13, 27, { includeZero: true }), { domain: [-20, 30], ticks: [-20, -10, 0, 10, 20, 30] });
assert.deepEqual(model.niceScale(-4, 3, { includeZero: true }).ticks, [-4, -2, 0, 2, 4]);
assert.deepEqual(model.niceScale(-9.6, 4, { symmetric: true }).domain, [-10, 10], "a quadrant is centred");
assert.deepEqual(model.niceScale(44.3, 49.1).ticks, [44, 45, 46, 47, 48, 49, 50]);

// The better/worse split sits at zero in the painted shape's own box, not the
// plot's: a line from −2 to +8 on a −10…+10 axis splits at 0.8, not 0.5.
close(model.zeroOffsetIn(-2, 8), 0.8, 1e-9, "zero in the line's box");
assert.equal(model.zeroOffsetIn(1, 5), 1, "wholly above zero is all better");
assert.equal(model.zeroOffsetIn(-5, -1), 0, "wholly below zero is all worse");
assert.equal(model.zeroOffsetIn(3, 3), 1, "a flat line above zero is better");
assert.equal(model.zeroOffsetIn(-3, -3), 0, "a flat line below zero is worse");

console.log("run performance: ok");
