import assert from "node:assert/strict";
import {
  mergeActivityDetailWithList,
  parseActivityDetail
} from "../dist-electron/trainingHubService.js";

const trailDetailFixture = {
  summary: {
    name: "Trail Verrières Igny Gilles Ludo Quentin & Yann",
    sportType: 102,
    totalTime: 1443564,
    distance: 2974700,
    avgHr: 151,
    maxHr: 176,
    calories: 2675000,
    elevGain: 100500,
    trainingLoad: 665
  },
  frequencyList: [
    { distance: 0, altitude: 12000 },
    { distance: 100000, altitude: 12500 },
    { distance: 200000, altitude: 13000 },
    { distance: 300000, altitude: 12800 }
  ],
  lapList: [
    {
      type: 1,
      lapItemList: [
        {
          distance: 742000,
          totalTime: 360000,
          avgHr: 142,
          maxHr: 158,
          ascent: 25000
        },
        {
          distance: 755000,
          totalTime: 370000,
          avgHr: 149,
          maxHr: 165,
          ascent: 28000
        }
      ]
    },
    {
      type: 2,
      lapItemList: [
        {
          distance: 742000,
          totalTime: 360000,
          avgHr: 142,
          maxHr: 158,
          ascent: 25000
        },
        {
          distance: 755000,
          totalTime: 370000,
          avgHr: 149,
          maxHr: 165,
          ascent: 28000
        }
      ]
    }
  ],
  graphList: [
    {
      gpsLat: [488000000, 488100000, 488200000, 488300000],
      gpsLon: [22000000, 22100000, 22200000, 22300000],
      altitude: [12000, 12500, 13000, 12800],
      distance: [0, 100000, 200000, 300000]
    }
  ]
};

const listActivity = {
  activityId: "trail-1",
  name: "Trail Verrières Igny Gilles Ludo Quentin & Yann",
  sportType: 102,
  startTime: 1719477060,
  duration: 14436,
  distance: 29700,
  avgHr: 151,
  maxHr: 176,
  calories: 2675,
  trainingLoad: 665,
  elevationGain: 1005
};

const detail = parseActivityDetail(trailDetailFixture);

assert.equal(detail.duration, 14436);
assert.equal(detail.distance, 29747);
assert.equal(detail.calories, 2675);
assert.equal(detail.elevationGain, 1005);
assert.equal(detail.laps.length, 2);
assert.equal(detail.laps[0]?.distance, 7420);
assert.equal(detail.laps[0]?.duration, 3600);
assert.equal(detail.laps[0]?.elevationGain, 250);
assert.ok(detail.track);
assert.ok((detail.track?.points.length ?? 0) >= 2);
assert.equal(detail.track?.points[0]?.elevation, 120);
assert.equal(detail.track?.points[0]?.lat, 48.8);
assert.equal(detail.track?.points[0]?.lon, 2.2);

const merged = mergeActivityDetailWithList(
  {
    ...detail,
    duration: 1443564,
    distance: 2974700,
    calories: undefined,
    elevationGain: undefined
  },
  listActivity
);

assert.equal(merged.duration, 14436);
assert.equal(merged.distance, 29700);
assert.equal(merged.calories, 2675);
assert.equal(merged.elevationGain, 1005);

const flatLapFixture = {
  summary: {
    totalTime: 248900,
    distance: 658000
  },
  lapList: [
    {
      distance: 1000000,
      totalTime: 37700,
      avgHr: 168,
      maxHr: 176
    },
    {
      distance: 1000000,
      totalTime: 37700,
      avgHr: 174,
      maxHr: 182
    }
  ]
};

const flatDetail = parseActivityDetail(flatLapFixture);

assert.equal(flatDetail.duration, 2489);
assert.equal(flatDetail.distance, 6580);
assert.equal(flatDetail.laps.length, 2);
assert.equal(flatDetail.laps[0]?.distance, 10000);
assert.equal(flatDetail.laps[0]?.duration, 377);
assert.equal(flatDetail.track, undefined);

const frequencyOnlyFixture = {
  summary: {
    totalTime: 360000,
    distance: 1000000
  },
  frequencyList: [
    { distance: 0, altitude: 9500 },
    { distance: 50000, altitude: 9800 },
    { distance: 100000, altitude: 10200 }
  ]
};

const frequencyDetail = parseActivityDetail(frequencyOnlyFixture);

assert.ok(frequencyDetail.track);
assert.equal(frequencyDetail.track?.points.length, 3);
assert.equal(frequencyDetail.track?.points[0]?.elevation, 95);
assert.equal(frequencyDetail.track?.points[0]?.lat, undefined);

const walkFixture = {
  summary: {
    totalTime: 220500,
    distance: 346000
  },
  lapList: [
    {
      type: 10,
      lapItemList: [
        { distance: 86500, time: 52500, avgHr: 132, maxHr: 146, elevGain: 600 },
        { distance: 86300, time: 52700, avgHr: 133, maxHr: 146, elevGain: 500 },
        { distance: 87500, time: 51000, avgHr: 137, maxHr: 145, elevGain: 400 },
        { distance: 78400, time: 58700, avgHr: 128, maxHr: 139, elevGain: 700 }
      ]
    }
  ]
};

const walkDetail = parseActivityDetail(walkFixture);

assert.equal(walkDetail.distance, 3460);
assert.equal(walkDetail.laps.length, 4);
assert.equal(walkDetail.laps[0]?.distance, 865);
assert.equal(walkDetail.laps[1]?.distance, 863);

// --- Dynamics, HR zones, training effect, weather and adjusted pace ---
//
// Shapes copied from a live /activity/detail/query response. The numbers are
// deliberately chosen so a wrong reading cannot pass: the summary and the graph
// channel disagree on cadence (163 vs 999) so "summary first" is observable,
// and every scaled field is scaled by a factor big enough to see (84 -> 0.84).
const dynamicsFixture = {
  summary: {
    name: "Easy 9 km",
    sportType: 100,
    totalTime: 457125,
    distance: 1041026,
    avgHr: 152,
    maxHr: 160,
    adjustedPace: 439,
    // COROS zeroes these three on a Pace Pro run and only fills the channels.
    avgGroundTime: 0,
    avgVertVibration: 0,
    avgVertRatio: 0,
    avgCadence: 163,
    maxCadence: 170,
    avgStepLen: 84,
    avgPower: 160,
    maxPower: 201,
    aerobicEffect: 3.8,
    anaerobicEffect: 0.2,
    currentVo2Max: 47
  },
  weather: { temperature: 304, bodyFeelTemp: 317, humidity: 610, windSpeed: 200 },
  zoneList: [
    {
      type: 130,
      zoneItemList: [{ leftScope: 471000, rightScope: 400000, second: 158, percent: 3, zoneIndex: 0 }]
    },
    {
      type: 126,
      zoneItemList: [
        { leftScope: 133, rightScope: 154, second: 66, percent: 1, zoneIndex: 0 },
        { leftScope: 133, rightScope: 154, second: 2871, percent: 63, zoneIndex: 1 },
        { leftScope: 155, rightScope: 168, second: 1634, percent: 36, zoneIndex: 2 },
        { leftScope: 169, rightScope: 173, second: 0, percent: 0, zoneIndex: 3 }
      ]
    }
  ],
  graphList: [
    { key: "cadence", type: 109, graphItem: { avg: 999, max: 999 } },
    { key: "groundTime", type: 145, graphItem: { avg: 303, max: 383 } },
    { key: "verticalVibration", type: 147, graphItem: { avg: 85, max: 97 } },
    { key: "verticalStrideRatio", type: 148, graphItem: { avg: 100, max: 156 } },
    { key: "cadenceLength", type: 124, graphItem: { avg: 99, max: 97 } }
  ],
  lapList: [
    {
      type: 10,
      lapItemList: [
        {
          distance: 100000,
          time: 42267,
          avgHr: 139,
          maxHr: 151,
          avgPace: 422.68,
          avgCadence: 163,
          maxCadence: 168,
          avgStrideLength: 87,
          strideHeight: 86,
          strideRatio: 97,
          groundTime: 285,
          avgPower: 167
        },
        {
          distance: 100000,
          time: 42400,
          avgHr: 151,
          maxHr: 155,
          avgPace: 424,
          avgCadence: 164,
          maxCadence: 170,
          avgStrideLength: 86,
          strideHeight: 85,
          strideRatio: 99,
          groundTime: 295,
          avgPower: 165
        }
      ]
    }
  ]
};

const dynamicsDetail = parseActivityDetail(dynamicsFixture);

assert.equal(dynamicsDetail.adjustedPace, 439);

// Summary wins where it is populated, channel fills in where it is zeroed.
assert.equal(dynamicsDetail.dynamics?.avgCadence, 163);
assert.equal(dynamicsDetail.dynamics?.maxCadence, 170);
assert.equal(dynamicsDetail.dynamics?.strideLength, 0.84);
assert.equal(dynamicsDetail.dynamics?.groundTime, 303);
assert.equal(dynamicsDetail.dynamics?.verticalOscillation, 8.5);
assert.equal(dynamicsDetail.dynamics?.verticalRatio, 10);
assert.equal(dynamicsDetail.dynamics?.avgPower, 160);
assert.equal(dynamicsDetail.dynamics?.maxPower, 201);

assert.equal(dynamicsDetail.laps[0]?.avgCadence, 163);
assert.equal(dynamicsDetail.laps[0]?.maxCadence, 168);
assert.equal(dynamicsDetail.laps[0]?.strideLength, 0.87);
assert.equal(dynamicsDetail.laps[0]?.groundTime, 285);
assert.equal(dynamicsDetail.laps[0]?.verticalOscillation, 8.6);
assert.equal(dynamicsDetail.laps[0]?.verticalRatio, 9.7);
assert.equal(dynamicsDetail.laps[0]?.avgPower, 167);

// The HR group is picked out of a zoneList whose first entry is pace.
assert.equal(dynamicsDetail.hrZones.length, 4);
assert.equal(dynamicsDetail.hrZones[0]?.index, 0);
assert.equal(dynamicsDetail.hrZones[0]?.low, undefined, "below-Z1 bucket has no floor");
assert.equal(dynamicsDetail.hrZones[0]?.high, 133);
assert.equal(dynamicsDetail.hrZones[0]?.seconds, 66);
assert.equal(dynamicsDetail.hrZones[1]?.low, 133);
assert.equal(dynamicsDetail.hrZones[1]?.high, 154);
assert.equal(dynamicsDetail.hrZones[1]?.percent, 63);
assert.equal(dynamicsDetail.hrZones[3]?.seconds, undefined, "an unused zone carries no time");

assert.equal(dynamicsDetail.effect?.aerobic, 3.8);
assert.equal(dynamicsDetail.effect?.anaerobic, 0.2);
assert.equal(dynamicsDetail.effect?.vo2max, 47);

assert.equal(dynamicsDetail.weather?.temperatureC, 30.4);
assert.equal(dynamicsDetail.weather?.feelsLikeC, 31.7);
assert.equal(dynamicsDetail.weather?.humidityPct, 61);

// A gym session: COROS sends 0 for every field its watch did not record, and 0
// must not reach the coach as a measurement.
const gymFixture = {
  summary: {
    name: "Strength",
    sportType: 402,
    totalTime: 382800,
    avgHr: 107,
    maxHr: 136,
    adjustedPace: 0,
    avgCadence: 0,
    maxCadence: 0,
    avgStepLen: 0,
    avgGroundTime: 0,
    avgVertVibration: 0,
    avgVertRatio: 0,
    avgPower: 0,
    maxPower: 0,
    aerobicEffect: 1.6,
    anaerobicEffect: 0,
    currentVo2Max: 47
  },
  zoneList: [
    {
      type: 126,
      zoneItemList: [
        { leftScope: 133, rightScope: 154, second: 3815, percent: 100, zoneIndex: 0 }
      ]
    }
  ],
  lapList: [
    { type: 2, lapItemList: [{ time: 4712, avgHr: 104, maxHr: 136, avgCadence: 0, avgStrideLength: 0 }] }
  ]
};

const gymDetail = parseActivityDetail(gymFixture);

// A gym lap is short enough that the old magnitude heuristic left it in
// centiseconds: 4712 stayed 4712 and rendered as 1:18:32 inside an hour-long
// session. Detail durations are always centiseconds, whatever their size.
assert.equal(gymDetail.duration, 3828);
assert.equal(gymDetail.laps[0]?.duration, 47);

assert.equal(gymDetail.dynamics, undefined, "no dynamics from an all-zero summary");
assert.equal(gymDetail.adjustedPace, undefined);
assert.equal(gymDetail.weather, undefined, "no weather object means no weather");
assert.equal(gymDetail.laps[0]?.avgCadence, undefined);
assert.equal(gymDetail.laps[0]?.strideLength, undefined);
assert.equal(gymDetail.effect?.aerobic, 1.6);
assert.equal(gymDetail.effect?.anaerobic, undefined);
assert.equal(gymDetail.hrZones.length, 1);

// Sentinels and empty zone splits.
const sentinelDetail = parseActivityDetail({
  summary: { totalTime: 100000, adjustedPace: 4 },
  weather: { temperature: 65535, humidity: 0 },
  zoneList: [
    {
      type: 126,
      zoneItemList: [{ leftScope: 133, rightScope: 154, second: 0, percent: 0, zoneIndex: 0 }]
    }
  ]
});

assert.equal(sentinelDetail.weather, undefined, "65535 is a sentinel, not 6553.5 C");
assert.equal(
  sentinelDetail.adjustedPace,
  undefined,
  "4 s/km is not a pace a human ran"
);
assert.deepEqual(sentinelDetail.hrZones, [], "a zone split with no time is no split");

// A whole activity can be short too — 90 s must not read as 90 min.
const shortDetail = parseActivityDetail({
  summary: { totalTime: 9000, distance: 30000 },
  lapList: [
    {
      type: 2,
      lapItemList: [
        { time: 4500, avgHr: 120 },
        { startTimestamp: 178765877300, endTimestamp: 178765881800, avgHr: 124 }
      ]
    }
  ]
});

assert.equal(shortDetail.duration, 90);
assert.equal(shortDetail.laps[0]?.duration, 45);
assert.equal(
  shortDetail.laps[1]?.duration,
  45,
  "lap timestamps are centiseconds too"
);

// One `lapItemList` carrying the same session twice: set-and-rest rows
// (mode 14/15) and the per-exercise roll-up of those same rows (mode 16/17).
// Both span the whole activity, so reading them as one list doubles it.
const twoViewFixture = {
  summary: { totalTime: 100000, sportType: 402 },
  lapList: [
    {
      type: 2,
      lapItemList: [
        { lapType: 0, mode: 14, time: 20000, avgHr: 120, reps: 10 },
        { lapType: 0, mode: 15, time: 30000, avgHr: 100 },
        { lapType: 0, mode: 14, time: 25000, avgHr: 124, reps: 8 },
        { lapType: 0, mode: 15, time: 25000, avgHr: 102 },
        { lapType: 0, mode: 16, time: 45000, avgHr: 122 },
        { lapType: 0, mode: 17, time: 55000, avgHr: 101 }
      ]
    }
  ]
};

const twoViewDetail = parseActivityDetail(twoViewFixture);

assert.equal(twoViewDetail.laps.length, 4, "the set-by-set view wins on row count");
assert.equal(
  twoViewDetail.laps.reduce((total, lap) => total + (lap.duration ?? 0), 0),
  twoViewDetail.duration,
  "laps span the activity exactly once"
);
assert.equal(twoViewDetail.laps[0]?.duration, 200);
assert.equal(twoViewDetail.laps[3]?.duration, 250);

// The same two views, but with COROS filing them under different lapTypes —
// which it does on some sessions and not others. The granularity, not the
// lapType, is what makes them two views.
const twoViewSplitLapTypeDetail = parseActivityDetail({
  summary: { totalTime: 100000, sportType: 402 },
  lapList: [
    {
      type: 2,
      lapItemList: [
        { lapType: 0, mode: 14, time: 20000, avgHr: 120, reps: 10 },
        { lapType: 0, mode: 15, time: 30000, avgHr: 100 },
        { lapType: 0, mode: 14, time: 25000, avgHr: 124, reps: 8 },
        { lapType: 0, mode: 15, time: 25000, avgHr: 102 },
        { lapType: 1, mode: 16, time: 45000, avgHr: 122 },
        { lapType: 1, mode: 17, time: 55000, avgHr: 101 }
      ]
    }
  ]
});

assert.equal(twoViewSplitLapTypeDetail.laps.length, 4);

// A structured run puts warm-up, interval, recovery and cool-down laps in one
// group. Those modes are one timeline and must survive intact.
const structuredRunDetail = parseActivityDetail({
  summary: { totalTime: 100000, distance: 400000 },
  lapList: [
    {
      type: 10,
      lapItemList: [
        { lapType: 0, mode: 4, distance: 100000, time: 30000, avgHr: 130 },
        { lapType: 0, mode: 2, distance: 100000, time: 20000, avgHr: 170 },
        { lapType: 0, mode: 3, distance: 100000, time: 25000, avgHr: 140 },
        { lapType: 0, mode: 5, distance: 100000, time: 25000, avgHr: 125 }
      ]
    }
  ]
});

assert.equal(structuredRunDetail.laps.length, 4, "run lap modes are not views");
assert.equal(
  structuredRunDetail.laps.reduce((total, lap) => total + (lap.duration ?? 0), 0),
  structuredRunDetail.duration
);

// A single-granularity payload is untouched by the split.
const singleViewDetail = parseActivityDetail({
  summary: { totalTime: 100000, distance: 200000 },
  lapList: [
    {
      type: 10,
      lapItemList: [
        { lapType: 0, distance: 100000, time: 50000, avgHr: 150 },
        { lapType: 0, distance: 100000, time: 50000, avgHr: 155 }
      ]
    }
  ]
});

assert.equal(singleViewDetail.laps.length, 2);
assert.equal(singleViewDetail.laps[0]?.duration, 500);

console.log("Activity detail parser tests passed.");
