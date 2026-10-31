// The Swimming screen's arithmetic: a swim read out of COROS's payload
// (lengths, intervals, rests, the pool), the best efforts and Critical Swim
// Speed, the sets a session is written in, the weeks, the technique trend, and
// the swim reading of the shared channel chart.
//
// Runs under Electron for the reason test-hike-metrics does: the module graph
// has extensionless imports, so the resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const moduleUrl = (...parts) => `${pathToFileURL(path.join(repoRoot, ...parts)).href}${bust}`;

const {
  SWIM_SUMMARY_VERSION,
  bestSwimEfforts,
  isSwimSportType,
  parseSwimDetail,
  poolFromLengths,
  sessionSwolf,
  styleDistancePerStroke,
  styleStrokeRate,
  styleStrokesPerLength,
  styleSwolf,
  swimLaps,
  swimStyleOf,
  swimSummaryOf
} = await import(moduleUrl("electron", "swimDetail.ts"));
const {
  buildSwimWeeks,
  combineSwimStyles,
  criticalSwimSpeed,
  formatClock,
  formatPer100,
  formatPoolLength,
  poolsSwum,
  rollingMedian,
  summariseSwims,
  swimSets,
  swimTypesPresent,
  swimmingPace,
  swimmingPaceOf,
  techniquePoints,
  techniqueValue
} = await import(moduleUrl("src", "swimming", "swimMetrics.ts"));
const { classifySwimType, swimsOfType } = await import(moduleUrl("src", "swimming", "swimType.ts"));
const { sportScreenFor } = await import(moduleUrl("src", "navigation", "sportScreens.ts"));
const { availableActivityChannels, defaultSelectedChannels } = await import(
  moduleUrl("src", "training", "activityChannels.ts")
);

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);

// --- What a swim is ------------------------------------------------------------

assert.equal(isSwimSportType(300), true);
assert.equal(isSwimSportType(301), true);
assert.equal(isSwimSportType(100), false);
assert.equal(classifySwimType(300), "pool");
assert.equal(classifySwimType(301), "open");
assert.equal(sportScreenFor(300), "swimming", "a pool swim opens on Swimming");
assert.equal(sportScreenFor(301), "swimming", "open water opens on Swimming");
assert.deepEqual(
  [1, 2, 3, 4, 5, 6, 7, 255, 0, 254].map(swimStyleOf),
  ["free", "breast", "back", "fly", "drill", "drill", "medley", "mixed", "unknown", "unknown"],
  "COROS's swimStyle codes, as its web app names them"
);

// --- A pool swim, as COROS sends it ---------------------------------------------
// Distances in centimetres, times in hundredths; lapList type 1 the lengths,
// type 2 the laps; a rest is an item with no distance.

const length = (seconds, style, strokes, relation, hr = 140) => ({
  distance: 2500,
  time: Math.round(seconds * 100),
  swimStyle: style,
  ...(strokes !== undefined ? { strokes, avgSwolf: Math.round(seconds) + strokes } : {}),
  avgHr: hr,
  swimRelationIndex: relation
});
const rest = (seconds) => ({ distance: 0, time: seconds * 100, swimStyle: 0 });
const lap = (meters, seconds, style, relation, extra = {}) => ({
  distance: meters * 100,
  time: Math.round(seconds * 100),
  swimStyle: style,
  swimRelationIndex: relation,
  ...extra
});

const poolPayload = {
  sportType: 300,
  summary: { sportType: 300, avgSwolfLen: 41, avgCadence: 29, waterTemperature: 2750 },
  lapList: [
    {
      type: 1,
      lapItemList: [
        length(25, 1, 13, 1),
        length(24, 1, 12, 1),
        length(24.5, 1, 13, 1),
        length(25.5, 1, 14, 1),
        rest(20),
        length(31, 2, 9, 2),
        length(32, 2, 10, 2),
        rest(15),
        length(40, 6, 5, 3),
        length(41, 6, undefined, 3)
      ]
    },
    {
      type: 2,
      lapItemList: [
        lap(100, 99, 1, 1, { avgHr: 142, maxHr: 150 }),
        rest(20),
        lap(50, 63, 2, 2),
        rest(15),
        lap(50, 81, 6, 3)
      ]
    }
  ]
};

const swim = parseSwimDetail(poolPayload, { sportType: 300 });
assert.ok(swim, "a pool payload parses");
assert.equal(swim.poolLength, 25);
assert.equal(swim.poolUnit, "m");
assert.equal(swim.lengths.length, 8, "rests are not lengths");
assert.equal(swim.intervals.length, 3, "rests are not intervals");
assert.deepEqual(
  swim.intervals.map((interval) => interval.restAfter),
  [20, 15, undefined],
  "a rest is folded onto the interval before it"
);
assert.equal(swim.lengths[4].restBefore, 20, "the first length after a rest carries it");
assert.equal(swim.lengths[6].restBefore, 15);
assert.equal(swim.lengths[1].restBefore, undefined);
assert.deepEqual(
  swim.lengths.map((entry) => entry.interval),
  [1, 1, 1, 1, 2, 2, 3, 3],
  "lengths tie to their lap by swimRelationIndex"
);
assert.equal(swim.lengths[0].seconds, 25, "a length's time is kept to the hundredth");
assert.equal(swim.lengths[2].seconds, 24.5);
assert.equal(swim.intervals[0].strokes, 52, "a lap with no stroke count adds its lengths'");
assert.equal(swim.intervals[0].swolf, 38, "a lap's SWOLF is its lengths' average");
assert.equal(swim.intervals[0].lengths, 4);
assert.equal(swim.intervals[0].avgHr, 142);
assert.equal(swim.intervals[1].style, "breast");
assert.equal(swim.lengths[6].style, "drill");
assert.equal(swim.lengths[6].strokes, undefined, "a drill is timed, not counted");
assert.equal(swim.lengths[6].swolf, undefined, "a drill has no SWOLF");
assert.equal(swim.swimSeconds, 243, "swimming time adds the intervals");
assert.equal(swim.restSeconds, 35, "rest time adds the rests");
assert.equal(swim.totalStrokes, 71, "strokes add the counted lengths");
assert.equal(swim.avgSwolf, 41, "COROS's own session SWOLF is kept");
assert.equal(swim.avgStrokeRate, 29);
assert.equal(swim.waterTemperatureC, 27.5, "water temperature arrives in hundredths of a degree");
near(swim.lengths[0].strokeRate, (13 / 25) * 60, 0.5, "a length's stroke rate is worked out when COROS sends none");

// Without laps: the lengths split into intervals where a rest broke them.
const lengthsOnly = parseSwimDetail(
  { sportType: 300, lapList: [poolPayload.lapList[0]] },
  { sportType: 300 }
);
assert.equal(lengthsOnly.intervals.length, 3);
assert.deepEqual(lengthsOnly.intervals.map((interval) => interval.distance), [100, 50, 50]);
assert.deepEqual(lengthsOnly.intervals.map((interval) => interval.style), ["free", "breast", "drill"]);
assert.equal(lengthsOnly.intervals[0].restAfter, 20);

// Without relation indexes: lengths are assigned in order, by distance.
const strip = (item) => {
  const { swimRelationIndex: _relation, ...rest } = item;
  return rest;
};
const unrelated = parseSwimDetail(
  {
    sportType: 300,
    lapList: poolPayload.lapList.map((group) => ({ ...group, lapItemList: group.lapItemList.map(strip) }))
  },
  { sportType: 300 }
);
assert.deepEqual(unrelated.lengths.map((entry) => entry.interval), [1, 1, 1, 1, 2, 2, 3, 3]);

// A payload naming no sport still reads as a swim when its lengths carry strokes.
assert.ok(parseSwimDetail({ lapList: poolPayload.lapList }), "lengths with a swimStyle are a swim");
// And a run is never one.
assert.equal(
  parseSwimDetail({ lapList: [{ type: 2, lapItemList: [{ distance: 100000, time: 30000 }] }] }, { sportType: 100 }),
  undefined
);

// Open water: no lengths, no pool; the intervals are the watch's laps.
const open = parseSwimDetail(
  { sportType: 301, summary: { waterTemperature: 24 } },
  {
    sportType: 301,
    laps: [
      { index: 1, distance: 500, duration: 560, avgHr: 150, avgCadence: 30 },
      { index: 2, distance: 480, duration: 545, avgHr: 154 }
    ]
  }
);
assert.equal(open.poolLength, undefined, "open water has no pool");
assert.equal(open.lengths.length, 0);
assert.deepEqual(open.intervals.map((interval) => interval.distance), [500, 480]);
assert.equal(open.intervals[0].strokeRate, 30);
assert.equal(open.waterTemperatureC, 24, "a whole-degree water temperature is taken as it is");

// --- The pool, from its lengths ---------------------------------------------------

assert.deepEqual(poolFromLengths([25, 25, 25, 50]), { poolLength: 25, poolUnit: "m" }, "a drill logged at 50 m does not move it");
assert.deepEqual(poolFromLengths([50, 50]), { poolLength: 50, poolUnit: "m" });
assert.deepEqual(poolFromLengths([22.86, 22.86, 22.86]), { poolLength: 22.86, poolUnit: "yd" }, "25 yd");
assert.equal(poolFromLengths([33.33, 33.33]).poolUnit, "m");
near(poolFromLengths([33.33, 33.33]).poolLength, 33.333, 0.001, "33⅓ m");
assert.equal(poolFromLengths([30.48]).poolUnit, "yd", "33⅓ yd");
assert.equal(poolFromLengths([]), undefined);
assert.equal(formatPoolLength(25, "m"), "25 m");
assert.equal(formatPoolLength(33.333, "m"), "33⅓ m");
assert.equal(formatPoolLength(22.86, "yd"), "25 yd");
assert.equal(formatPoolLength(30.48, "yd"), "33⅓ yd");

// --- Best efforts: freestyle, without stopping -------------------------------------

const free = (seconds, interval, extra = {}) => ({ style: "free", distance: 25, seconds, interval, ...extra });
const efforts = bestSwimEfforts([
  ...Array.from({ length: 8 }, (_, index) => free(20, 1, { index })),
  free(18, 2, { restBefore: 30 }),
  free(18, 2),
  { style: "back", distance: 25, seconds: 15, interval: 2 },
  free(18, 2),
  free(18, 2)
]);
assert.deepEqual(
  efforts.map((effort) => [effort.distance, effort.seconds]),
  [
    [100, 80],
    [200, 160]
  ],
  "a backstroke length breaks the run: the fast hundred is never swum in one piece"
);
assert.deepEqual(
  bestSwimEfforts([...Array.from({ length: 4 }, () => free(18, 1)), ...Array.from({ length: 4 }, () => free(18, 2))]).map(
    (effort) => effort.distance
  ),
  [100],
  "a new interval is a new swim: two hundreds are no 200"
);
const yards = bestSwimEfforts(Array.from({ length: 10 }, () => ({ style: "free", distance: 22.86, seconds: 20, interval: 1 })));
near(yards[0].seconds, (100 * 100) / 114.3, 0.1, "a 25 yd pool's 100 m is five lengths, scaled to the distance");

// --- The summary a list reads -------------------------------------------------------

const summary = swimSummaryOf(swim);
assert.equal(summary.version, SWIM_SUMMARY_VERSION);
assert.equal(summary.poolLength, 25);
assert.equal(summary.lengths, 8);
assert.deepEqual(summary.byStyle.map((entry) => entry.style), ["free", "breast", "drill"], "strokes in the app's order");
const freeTotals = summary.byStyle[0];
assert.equal(freeTotals.meters, 100);
assert.equal(freeTotals.counted.strokes, 52);
near(styleSwolf(freeTotals), (99 + 52) / 4, 0.001, "SWOLF is seconds plus strokes, a length");
near(styleStrokesPerLength(freeTotals), 13, 0.001);
near(styleDistancePerStroke(freeTotals), 100 / 52, 0.001);
near(styleStrokeRate(freeTotals), (52 / 99) * 60, 0.001);
near(sessionSwolf(summary.byStyle), (99 + 52 + 63 + 19) / 6, 0.001, "a row's SWOLF leaves the drills out");
assert.equal(sessionSwolf([]), undefined);

// The laps every other reader reads: the intervals, not sixty lengths and the rests.
const laps = swimLaps(swim);
assert.deepEqual(laps.map((entry) => entry.distance), [100, 50, 50]);
assert.equal(laps[0].duration, 99);
assert.equal(laps[0].avgHr, 142);
assert.equal(laps[0].pace, 990, "seconds a kilometre, as every lap states its pace");
assert.equal(laps[0].avgCadence, swim.intervals[0].strokeRate, "a lap's cadence is the stroke rate");
assert.equal(summary.byStyle[2].counted, undefined, "drills carry no count");
assert.equal(summary.swimSeconds, 243);
assert.equal(summary.restSeconds, 35);

const combined = combineSwimStyles([summary, summary]);
assert.equal(combined[0].meters, 200);
assert.equal(combined[0].counted.strokes, 104);

// --- Critical Swim Speed ---------------------------------------------------------------

near(criticalSwimSpeed(140, 300).secondsPer100, 80, 0.001, "(400 − 200) m over (T400 − T200)");
assert.equal(criticalSwimSpeed(150, 290), undefined, "a 400 no slower a metre than the 200 says nothing");
assert.equal(criticalSwimSpeed(0, 300), undefined);
assert.equal(formatPer100(100, "metric"), "1:40 /100m");
assert.equal(formatPer100(100, "imperial"), "1:31 /100yd");
assert.equal(formatPer100(undefined, "metric"), "—");
assert.equal(formatClock(98.44), "1:38.4");
assert.equal(formatClock(59.96), "1:00.0", "a tenth that rounds up carries into the second");
assert.equal(formatClock(725), "12:05");
assert.equal(formatClock(3725), "1:02:05");

// --- Sets, as a swimmer writes them ------------------------------------------------------

const interval = (index, distance, style, restAfter) => ({ index, distance, seconds: distance, style, restAfter });
const sets = swimSets([
  interval(1, 200, "free", 30),
  interval(2, 100, "free", 15),
  interval(3, 100, "free", 15),
  interval(4, 100, "free", 20),
  interval(5, 100, "free", 40),
  interval(6, 50, "fly", 30),
  interval(7, 50, "fly", undefined),
  interval(8, 100, "back", undefined)
]);
assert.deepEqual(
  sets.map((set) => [set.start, set.count, set.distance, set.style, set.rest]),
  [
    [1, 4, 100, "free", 15],
    [5, 2, 50, "fly", 30]
  ],
  "runs of one distance and stroke; the rest is the one between them, not after the last"
);
const paced = (index, seconds) => ({ index, distance: 100, seconds, style: "free", restAfter: 15 });
assert.deepEqual(
  swimSets([paced(1, 110), paced(2, 96), paced(3, 94), paced(4, 92), paced(5, 90)]).map((set) => [set.start, set.count]),
  [[1, 4]],
  "an easy warm-up hundred is not the first rep of the hard set after it; a descending set stays one"
);

// --- The screen: kinds, weeks, totals -------------------------------------------------------

// 14 Sep 2026 is a Monday; fixtures are local time because weeks are.
const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const at = (daysAgo) => Math.floor((NOW - daysAgo * 86_400_000) / 1000);
const activities = [
  { activityId: "a", sportType: 300, startTime: at(0), distance: 2000, duration: 2700, trainingLoad: 50 },
  { activityId: "b", sportType: 300, startTime: at(3), distance: 3000, duration: 3600, trainingLoad: 70 },
  { activityId: "c", sportType: 301, startTime: at(4), distance: 1500, duration: 1800, trainingLoad: 40 },
  { activityId: "d", sportType: 100, startTime: at(1), distance: 10000, duration: 3000 }
];
assert.deepEqual(swimsOfType(activities, null).map((activity) => activity.activityId), ["a", "b", "c"]);
assert.deepEqual(swimTypesPresent(activities), ["pool", "open"]);
const totals = summariseSwims(activities);
assert.equal(totals.count, 3);
assert.equal(totals.distance, 6500);
near(swimmingPace(activities[0], new Map()), 135, 0.001, "a swim not read yet is paced over the list's time");
const readSummaries = new Map([["a", { activityId: "a", swimVersion: SWIM_SUMMARY_VERSION, swim: { version: SWIM_SUMMARY_VERSION, swimSeconds: 2400, restSeconds: 300, byStyle: [], best: [] } }]]);
near(swimmingPace(activities[0], readSummaries), 120, 0.001, "a read swim is paced over its swimming, rests out");
near(swimmingPaceOf(activities.slice(0, 2), readSummaries), ((2400 + 3600) / 5000) * 100, 0.001, "many swims: distance over swimming");
const weeks = buildSwimWeeks(activities, { weeks: 3, nowMs: NOW });
assert.equal(weeks.length, 3);
assert.equal(weeks[2].distance, 2000, "this week");
assert.equal(weeks[1].distance, 4500, "last week, pool and open water together");
assert.equal(weeks[1].byType.open.distance, 1500);
assert.equal(weeks[1].longestSwimMeters, 3000);

// --- The technique trend --------------------------------------------------------------------

const withPool = (poolLength, seconds, strokes, lengths) => ({
  version: SWIM_SUMMARY_VERSION,
  poolLength,
  poolUnit: "m",
  lengths,
  swimSeconds: seconds,
  restSeconds: 0,
  byStyle: [
    {
      style: "free",
      meters: lengths * poolLength,
      seconds,
      lengths,
      counted: { lengths, meters: lengths * poolLength, seconds, strokes }
    }
  ],
  best: []
});
const summaries = new Map([
  ["a", { activityId: "a", swimVersion: SWIM_SUMMARY_VERSION, swim: withPool(25, 400, 200, 16) }],
  ["b", { activityId: "b", swimVersion: SWIM_SUMMARY_VERSION, swim: withPool(50, 400, 180, 8) }],
  ["x", { activityId: "x", swimVersion: SWIM_SUMMARY_VERSION - 1, swim: withPool(25, 400, 200, 16) }]
]);
const pools = poolsSwum([...activities, { activityId: "x", sportType: 300, startTime: at(2) }], summaries);
assert.deepEqual(pools.map((pool) => pool.poolLength), [25, 50], "an out-of-date summary is not read");
const swolfPoints = techniquePoints(activities, summaries, "swolf", 25);
assert.deepEqual(swolfPoints.map((point) => point.activityId), ["a"], "SWOLF is read in one pool");
near(swolfPoints[0].value, (400 + 200) / 16, 0.001);
const dpsPoints = techniquePoints(activities, summaries, "dps", 25);
assert.deepEqual(dpsPoints.map((point) => point.activityId), ["b", "a"], "distance per stroke travels between pools, oldest first");
assert.equal(techniqueValue(withPool(25, 100, 50, 4), "swolf"), undefined, "too little freestyle to read");
assert.deepEqual(
  rollingMedian([1, 9, 3, 7, 5].map((value) => ({ value })), 3),
  [1, 5, 3, 7, 5],
  "the median of each point and the two before it"
);

// --- The channel chart reads a swim -------------------------------------------------------------

const samples = Array.from({ length: 20 }, (_, index) => ({
  elapsed: index,
  distance: index,
  hr: 140 + index,
  pace: 1050,
  cadence: 30
}));
const channels = availableActivityChannels(samples, "swim", 300);
assert.ok(channels.some((channel) => channel.key === "pace"), "a swim reads a pace");
assert.equal(channels.find((channel) => channel.key === "cadence")?.label, "Stroke rate", "a swim's cadence is its stroke rate");
assert.deepEqual(defaultSelectedChannels(channels, "swim"), ["pace", "hr"]);
assert.equal(
  availableActivityChannels(samples, "pace", 100).find((channel) => channel.key === "cadence")?.label,
  "Cadence",
  "a run keeps its cadence"
);

console.log("swim metrics: ok");
