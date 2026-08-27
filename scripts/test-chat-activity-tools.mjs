import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  formatActivityDetailForChat,
  buildActivityVisualPreview,
  buildActivityHrTrendPreview
} = await import(`${distUrl("chatActivityTools.js")}?cacheBust=${Date.now()}`);
const {
  parseActivityDetail,
  downsampleActivitySeries,
  formatActivitySeriesForChat,
  parseScheduledExercises,
  formatScheduledExercisesForChat
} = await import(`${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`);

const trailDetailFixture = {
  labelId: "act-trail-1",
  summary: {
    name: "Track Intervals",
    sportType: 101,
    totalTime: 3600000,
    distance: 10000000,
    avgHr: 160,
    maxHr: 182
  },
  lapList: [
    {
      distance: 400000,
      totalTime: 90000,
      avgHr: 170,
      maxHr: 182,
      avgPace: 225000
    },
    {
      distance: 400000,
      totalTime: 92000,
      avgHr: 168,
      maxHr: 180,
      avgPace: 230000
    }
  ],
  graphList: [
    {
      heartRateList: [120, 130, 140, 150, 160],
      distanceList: [0, 1000, 2000, 3000, 4000],
      avgPaceList: [240000, 235000, 230000, 228000, 225000]
    }
  ]
};

const detail = parseActivityDetail(trailDetailFixture);
assert.equal(detail.laps.length, 2);
assert.ok(detail.series && detail.series.length > 0);

const formatted = formatActivityDetailForChat(detail, false);
assert.match(formatted, /Laps:/);
assert.match(formatted, /4\.00 km/);
assert.match(formatted, /170/);

const withSeries = formatActivityDetailForChat(detail, true);
assert.match(withSeries, /Time series/);

const imperialFormatted = formatActivityDetailForChat(detail, true, "imperial");
assert.match(imperialFormatted, /62\.1 mi/);
assert.match(imperialFormatted, /Avg pace: 9:39\/mi/);
assert.match(imperialFormatted, /2\.49 mi/);

const bikeDetail = {
  activityId: "bike-1",
  name: "Ten mile ride",
  sportType: 200,
  sportName: "Bike",
  distance: 16_093.44,
  duration: 3_600,
  laps: [{ index: 1, distance: 16_093.44, duration: 3_600, pace: 223.694 }],
  series: [
    { distance: 8_046.72, pace: 223.694 },
    { distance: 16_093.44, pace: 223.694 }
  ],
  raw: {}
};
const imperialBike = formatActivityDetailForChat(bikeDetail, true, "imperial");
assert.match(imperialBike, /Avg speed: 10\.0 mph/);
assert.match(imperialBike, /Max HR \| Speed/);
assert.match(imperialBike, /Distance \| HR \| Speed \| Power/);
assert.match(imperialBike, /10\.0 mph/);
assert.match(
  formatActivitySeriesForChat(bikeDetail.series, "metric", false, true),
  /16\.1 km\/h/
);

const imperialSwim = formatActivityDetailForChat({
  activityId: "swim-1",
  name: "Pool",
  sportType: 300,
  distance: 100,
  duration: 120,
  laps: [{ index: 1, distance: 100, duration: 120 }],
  raw: {}
}, false, "imperial");
assert.match(imperialSwim, /Distance: 109 yd/);
assert.match(imperialSwim, /1 \| 109 yd/);

const downsampled = downsampleActivitySeries(detail.series ?? [], 3);
assert.ok(downsampled.length <= 3);

const exercises = parseScheduledExercises({
  exercises: [
    {
      name: "Back Squat",
      sets: 4,
      reps: 8,
      targetType: 6,
      targetValue: 80000
    }
  ]
});
assert.equal(exercises.length, 1);
assert.match(formatScheduledExercisesForChat(exercises), /Back Squat/);

const visualPreview = buildActivityVisualPreview(detail, "req-1");
assert.ok(visualPreview);
assert.ok(visualPreview.sections.hr);
assert.equal(visualPreview.sections.hr?.chartKind, "series");
assert.ok(visualPreview.sections.laps && visualPreview.sections.laps.length > 0);
assert.equal(visualPreview.previewId, `${detail.activityId}:req-1`);
assert.equal(visualPreview.sportType, 101);

const bikePreview = buildActivityVisualPreview(bikeDetail, "req-bike");
assert.equal(bikePreview?.sportType, 200);
assert.ok(bikePreview?.sections.pace);

const legacyPreview = buildActivityHrTrendPreview(detail, "req-legacy");
assert.ok(legacyPreview);
assert.equal(legacyPreview.chartKind, "series");

const lapsOnlyFixture = {
  labelId: "act-laps-1",
  summary: {
    name: "Easy Run",
    sportType: 102,
    totalTime: 1800000,
    distance: 5000000,
    avgHr: 145,
    maxHr: 158
  },
  lapList: [
    { distance: 1000000, totalTime: 360000, avgHr: 140, maxHr: 150 },
    { distance: 1000000, totalTime: 350000, avgHr: 146, maxHr: 155 },
    { distance: 1000000, totalTime: 345000, avgHr: 150, maxHr: 158 }
  ]
};
const lapsDetail = parseActivityDetail(lapsOnlyFixture);
const lapsPreview = buildActivityVisualPreview(lapsDetail, "req-2");
assert.ok(lapsPreview);
assert.equal(lapsPreview.sections.hr?.chartKind, "laps");
assert.equal(lapsPreview.sections.laps?.length, 3);

const noHrFixture = {
  labelId: "act-nohr-1",
  summary: { name: "Walk", sportType: 102, totalTime: 900000, distance: 1000000 },
  lapList: [{ distance: 500000, totalTime: 450000 }]
};
const noHrDetail = parseActivityDetail(noHrFixture);
const noHrPreview = buildActivityVisualPreview(noHrDetail, "req-3");
assert.ok(noHrPreview);
assert.equal(noHrPreview.sections.hr, undefined);
assert.equal(noHrPreview.sections.laps?.length, 1);

assert.equal(
  buildActivityVisualPreview(
    parseActivityDetail({
      labelId: "act-empty-1",
      summary: { name: "Empty", sportType: 102 }
    }),
    "req-4"
  ),
  null
);

// --- Dynamics, zones, effect and weather in the chat rendering ---
const dynamicsChatFixture = {
  labelId: "act-dyn-1",
  summary: {
    name: "Easy 9 km",
    sportType: 100,
    totalTime: 457125,
    distance: 1041026,
    avgHr: 152,
    maxHr: 160,
    adjustedPace: 430,
    avgCadence: 163,
    maxCadence: 170,
    avgStepLen: 84,
    avgGroundTime: 0,
    avgVertVibration: 0,
    avgVertRatio: 0,
    avgPower: 160,
    maxPower: 201,
    aerobicEffect: 3.8,
    anaerobicEffect: 0.2,
    currentVo2Max: 47
  },
  weather: { temperature: 304, bodyFeelTemp: 317, humidity: 610 },
  zoneList: [
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
    { key: "groundTime", graphItem: { avg: 303 } },
    { key: "verticalVibration", graphItem: { avg: 85 } },
    { key: "verticalStrideRatio", graphItem: { avg: 100 } }
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
          avgStrideLength: 87,
          strideRatio: 97,
          groundTime: 285,
          avgPower: 167
        }
      ]
    }
  ]
};

const dynamicsText = formatActivityDetailForChat(
  parseActivityDetail(dynamicsChatFixture),
  false,
  "metric"
);

assert.match(dynamicsText, /Adjusted pace \(grade-adjusted\): 7:10\/km/);
assert.match(dynamicsText, /Running dynamics: cadence 163 spm \(max 170\)/);
assert.match(dynamicsText, /stride length 0\.84 m/);
assert.match(dynamicsText, /ground contact 303 ms/);
assert.match(dynamicsText, /vertical oscillation 8\.5 cm/);
assert.match(dynamicsText, /vertical ratio 10\.0%/);
assert.match(dynamicsText, /power 160 W \(max 201 W\)/);
assert.match(dynamicsText, /Training effect: aerobic 3\.8\/5 · anaerobic 0\.2\/5 · VO2max 47/);
assert.match(dynamicsText, /Conditions: 30\.4 °C · feels like 31\.7 °C · humidity 61%/);
assert.match(dynamicsText, /HR zones \(this activity\):/);
assert.match(dynamicsText, /- Below Z1 \(<133 bpm\): 1:06 \(1%\)/);
assert.match(dynamicsText, /- Z1 133–154 bpm: 47:51 \(63%\)/);
assert.match(dynamicsText, /- Z2 155–168 bpm: 27:14 \(36%\)/);
assert.doesNotMatch(dynamicsText, /- Z3/, "a zone with no time is not printed");
assert.match(
  dynamicsText,
  /Lap \| Distance \| Duration \| Avg HR \| Max HR \| Pace \| Cad \| Stride \(m\) \| GCT \(ms\) \| Vert ratio \(%\) \| Power \(W\)/
);
assert.match(dynamicsText, /1 \| 1\.00 km \| 7:03 \| 139 \| 151 \| 7:03\/km \| 163 \| 0\.87 \| 285 \| 9\.7 \| 167/);

// A gym session keeps the narrow table and gains no empty sections.
const gymText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-gym-1",
    summary: {
      name: "Strength",
      sportType: 402,
      totalTime: 382800,
      avgHr: 107,
      maxHr: 136,
      avgCadence: 0,
      avgPower: 0,
      aerobicEffect: 1.6
    },
    lapList: [{ type: 2, lapItemList: [{ time: 471200, avgHr: 104, maxHr: 136 }] }]
  }),
  false,
  "metric"
);

assert.doesNotMatch(gymText, /dynamics:/);
assert.doesNotMatch(gymText, /Conditions:/);
assert.doesNotMatch(gymText, /HR zones/);
assert.match(gymText, /Training effect: aerobic 1\.6\/5/);
assert.match(gymText, /Lap \| Distance \| Duration \| Avg HR \| Max HR \| Pace\n/);

// Cycling labels cadence as rpm.
const bikeText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-bike-1",
    summary: {
      name: "Ride",
      sportType: 200,
      totalTime: 360000,
      distance: 3000000,
      avgCadence: 85,
      avgPower: 190
    }
  }),
  false,
  "metric"
);

assert.match(bikeText, /Cycling dynamics: cadence 85 rpm/);

console.log("test-chat-activity-tools: ok");
