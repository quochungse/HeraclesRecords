import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  formatActivityDetailForChat,
  buildActivityVisualPreview,
  buildActivityHrTrendPreview,
  formatActivityListForChat,
  formatActivityListLine,
  formatActivitySpan,
  parseActivityListWindow,
  parseActivityDetailSections,
  activitySportFamily,
  DEFAULT_ACTIVITY_DETAIL_SECTIONS
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
assert.match(dynamicsText, /power 160 W \(max 201\)/);
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
    lapList: [{ type: 2, lapItemList: [{ time: 4712, avgHr: 104, maxHr: 136 }] }]
  }),
  false,
  "metric"
);

assert.doesNotMatch(gymText, /dynamics:/);
assert.doesNotMatch(gymText, /Conditions:/);
assert.doesNotMatch(gymText, /HR zones/);
assert.match(gymText, /Training effect: aerobic 1\.6\/5/);
assert.match(gymText, /Lap \| Distance \| Duration \| Avg HR \| Max HR \| Pace\n/);
assert.match(gymText, /1 \| — \| 0:47 \| 104 \| 136 \| —/, "a 47 s gym lap is not 1:18:32");

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

// --- Local start time, with the hour and the weekday ---
//
// 2026-03-01T23:30Z is 2026-03-02 in UTC+7 and 2026-03-01 in UTC-5, so the
// expected date is built from the same local getters the formatter uses rather
// than hard-coded. What is asserted is that an hour is printed at all and that
// the date is the local one, which `toISOString().slice(0, 10)` got wrong.
const startEpoch = Date.UTC(2026, 2, 1, 23, 30) / 1000;
const startLocal = new Date(startEpoch * 1000);
const pad = (value) => String(value).padStart(2, "0");
const expectedStart =
  `${startLocal.getFullYear()}-${pad(startLocal.getMonth() + 1)}-` +
  `${pad(startLocal.getDate())} ${pad(startLocal.getHours())}:` +
  `${pad(startLocal.getMinutes())}`;

const startText = formatActivityDetailForChat(
  {
    activityId: "start-1",
    name: "Night run",
    sportType: 100,
    startTime: startEpoch,
    distance: 5000,
    duration: 1800,
    laps: [],
    hrZones: [],
    raw: {}
  },
  false,
  "metric"
);
assert.match(startText, new RegExp(`Start: ${expectedStart} \\((Mon|Sun)\\)`));

// --- Lap phase column, climb column and vertical oscillation column ---
const structuredText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-structured-1",
    summary: {
      name: "8x400",
      sportType: 100,
      totalTime: 300000,
      distance: 900000,
      ascent: 4500,
      descent: 4100
    },
    lapList: [
      {
        type: 10,
        lapItemList: [
          { mode: 4, distance: 100000, time: 50000, avgHr: 130, avgPace: 330, ascent: 1200, strideHeight: 84 },
          { mode: 2, distance: 100000, time: 20000, avgHr: 172, avgPace: 210, ascent: 300, strideHeight: 85 },
          { mode: 3, distance: 100000, time: 50000, avgHr: 142, avgPace: 330, ascent: 300, strideHeight: 86 },
          { mode: 5, distance: 100000, time: 50000, avgHr: 128, avgPace: 330, ascent: 300, strideHeight: 87 }
        ]
      }
    ]
  }),
  false,
  "metric"
);

assert.match(structuredText, /Elevation: \+45 m \/ -41 m/);
assert.match(structuredText, /Lap \| Phase \| Distance/);
assert.match(structuredText, /Climb \| VO \(cm\)/);
assert.match(structuredText, /1 \| warm-up \|/);
assert.match(structuredText, /2 \| work \|/);
assert.match(structuredText, /3 \| recovery \|/);
assert.match(structuredText, /4 \| cool-down \|/);
assert.match(structuredText, /Phase is the structured-workout role COROS recorded/);

// An unstructured run carries no modes, so neither column nor legend appears.
assert.doesNotMatch(dynamicsText, /\| Phase \|/);
assert.doesNotMatch(dynamicsText, /Phase is the structured-workout role/);

// --- Trend across the activity ---
//
// Ten laps of an easy run whose cadence falls and ground contact climbs. The
// laps are equal length, so the first and last thirds are directly comparable.
const driftFixture = {
  labelId: "act-drift-1",
  summary: {
    name: "Long run",
    sportType: 100,
    totalTime: 3600000,
    distance: 1800000
  },
  lapList: [
    {
      type: 10,
      lapItemList: Array.from({ length: 9 }, (_, index) => ({
        distance: 100000,
        time: 36000,
        avgHr: 140 + index * 2,
        avgPace: 360 + index * 3,
        avgCadence: 172 - index,
        avgStrideLength: 112 - index,
        groundTime: 240 + index * 3,
        strideHeight: 84 + index,
        strideRatio: 90 + index
      }))
    }
  ]
};
const driftText = formatActivityDetailForChat(
  parseActivityDetail(driftFixture),
  false,
  "metric"
);

assert.match(driftText, /Trend across the activity \(first third → last third, 9 laps\):/);
assert.match(driftText, /- HR: 142 → 154 bpm \(\+12\)/);
assert.match(driftText, /- cadence: 171 → 165 spm \(-6\)/);
assert.match(driftText, /- ground contact: 243 → 261 ms \(\+18\)/);
assert.match(driftText, /- vertical ratio: 9\.1 → 9\.7% \(\+0\.6\)/);
assert.match(driftText, /- pace: 6:03\/km → 6:21\/km \(\+18 s\/km\)/);

// A structured session compares its work reps to each other. Comparing the
// first third to the last third of every lap would put the warm-up against the
// cool-down and report every interval workout as a collapse.
const intervalTrendText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-interval-1",
    summary: { name: "Reps", sportType: 100, totalTime: 300000, distance: 900000 },
    lapList: [
      {
        type: 10,
        lapItemList: [
          { mode: 4, distance: 200000, time: 90000, avgHr: 120, avgPace: 450, avgCadence: 160 },
          ...Array.from({ length: 6 }, (_, index) => ({
            mode: 2,
            distance: 40000,
            time: 9000,
            avgHr: 170 + index,
            avgPace: 225,
            avgCadence: 184 - index
          })),
          { mode: 5, distance: 200000, time: 90000, avgHr: 118, avgPace: 450, avgCadence: 158 }
        ]
      }
    ]
  }),
  false,
  "metric"
);
assert.match(intervalTrendText, /first third → last third, 6 work laps/);
assert.match(intervalTrendText, /- cadence: 184 → 180 spm \(-4\)/);

// --- Elevation profile ---
const profileText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-hill-1",
    summary: { name: "Hills", sportType: 100, totalTime: 300000, distance: 800000 },
    frequencyList: Array.from({ length: 16 }, (_, index) => ({
      distance: index * 50000,
      altitude: 12000 + index * 800
    }))
  }),
  false,
  "metric"
);
assert.match(profileText, /Elevation profile \(range 120 m–240 m\):/);
assert.match(profileText, /- 0 km–0\.50 km: 120 → 128 m \(\+8\)/);
assert.match(profileText, /- 6\.50 km–7\.50 km: 232 → 240 m \(\+8\)/);

// A flat course says so in one line instead of eight rows of noise.
const flatText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-flat-1",
    summary: { name: "Track", sportType: 100, totalTime: 180000, distance: 500000 },
    frequencyList: Array.from({ length: 16 }, (_, index) => ({
      distance: index * 30000,
      altitude: 1200 + (index % 3)
    }))
  }),
  false,
  "metric"
);
assert.match(flatText, /Elevation profile: flat — the recorded altitude varies by less than 10 m/);

// --- Strength sets reach the coach ---
const strengthText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-gym-3",
    summary: {
      name: "Lower body",
      sportType: 402,
      totalTime: 382800,
      avgHr: 112,
      sets: 4,
      totalReps: 42,
      totalWeight: 4200000,
      exercises: 2
    },
    lapList: [
      {
        type: 2,
        // Per exercise: one row per work set, plus the roll-up row COROS
        // marks with `sets`, whose `reps` is the exercise total.
        lapItemList: [
          { mode: 14, exerciseIndex: 0, exerciseNameKey: "T1041", time: 4000, reps: 10, weight: 60000 },
          { mode: 14, exerciseIndex: 0, exerciseNameKey: "T1041", time: 4000, reps: 8, weight: 70000 },
          { mode: 16, exerciseIndex: 0, exerciseNameKey: "T1041", time: 8000, sets: 2, reps: 18 },
          { mode: 14, exerciseIndex: 1, exerciseNameKey: "S9999", name: "Bulgarian Split Squat", time: 4000, reps: 12, weight: 20000 },
          { mode: 14, exerciseIndex: 1, exerciseNameKey: "S9999", name: "Bulgarian Split Squat", time: 4000, reps: 12, weight: 20000 },
          { mode: 16, exerciseIndex: 1, exerciseNameKey: "S9999", name: "Bulgarian Split Squat", time: 8000, sets: 2, reps: 24 }
        ]
      }
    ]
  }),
  false,
  "metric"
);
assert.match(strengthText, /Strength: 2 exercises · 4 sets · 42 reps · 4,?200 kg total volume/);
assert.match(strengthText, /- T1041 — 2 sets — 18 reps: 60 kg x10, 70 kg x8/);
assert.match(
  strengthText,
  /- Bulgarian Split Squat — 2 sets — 24 reps: 20 kg x12, 20 kg x12/,
  "a custom exercise is named, a library code is printed as the code"
);

// A run has no strength breakdown and gains no empty section.
assert.doesNotMatch(driftText, /Strength:/);

// --- Series table gains a column only when a sample carries it ---
const seriesDetailForChat = parseActivityDetail({
  labelId: "act-series-1",
  summary: { totalTime: 300000, distance: 1000000 },
  frequencyList: Array.from({ length: 8 }, (_, index) => ({
    time: index * 42857,
    distance: index * 125000,
    heartRate: 140 + index,
    pace: 300,
    altitude: 12000 + index * 200,
    cadence: 175 - index,
    groundTime: 240 + index
  }))
});
const seriesTable = formatActivitySeriesForChat(
  seriesDetailForChat.series,
  "metric",
  false,
  false
);
assert.match(seriesTable, /Time \| Distance \| HR \| Pace \| Power \| Alt \(m\) \| Cad \| GCT \(ms\)/);
assert.doesNotMatch(seriesTable, /Stride \(m\)/, "an unrecorded channel gets no column");
assert.doesNotMatch(seriesTable, /Vert ratio/);

// Imperial: the bracketed change follows the unit printed either side of the
// arrow. Computing it in metres and printing it beside feet, or in seconds per
// kilometre beside a per-mile pace, is the bug this pins down.
const imperialProfileText = formatActivityDetailForChat(
  parseActivityDetail({
    labelId: "act-hill-2",
    summary: { name: "Hills", sportType: 100, totalTime: 300000, distance: 800000 },
    frequencyList: Array.from({ length: 16 }, (_, index) => ({
      distance: index * 50000,
      altitude: 12000 + index * 800
    }))
  }),
  false,
  "imperial"
);
assert.match(imperialProfileText, /- 0 mi–0\.31 mi: 394 → 420 ft \(\+26\)/);

const imperialDriftText = formatActivityDetailForChat(
  parseActivityDetail(driftFixture),
  false,
  "imperial"
);
assert.match(imperialDriftText, /- pace: 9:44\/mi → 10:13\/mi \(\+29 s\/mi\)/);

// --- Cadence reaches the chart card ---
//
// From the sample stream when the watch recorded one.
const cadenceSeriesPreview = buildActivityVisualPreview(
  parseActivityDetail({
    labelId: "act-cad-1",
    summary: { name: "Easy", sportType: 100, totalTime: 300000, distance: 1000000 },
    frequencyList: Array.from({ length: 10 }, (_, index) => ({
      distance: index * 100000,
      heartRate: 140 + index,
      cadence: 175 - index
    }))
  }),
  "req-cadence"
);
assert.equal(cadenceSeriesPreview?.sections.cadence?.chartKind, "series");
assert.ok(
  cadenceSeriesPreview?.sections.cadence?.series?.some(
    (point) => point.cadence !== undefined
  )
);

// From the lap averages otherwise, which is what most COROS payloads carry.
const cadenceLapPreview = buildActivityVisualPreview(
  parseActivityDetail({
    labelId: "act-cad-2",
    summary: { name: "Easy", sportType: 100, totalTime: 300000, distance: 500000 },
    lapList: [
      {
        type: 10,
        lapItemList: Array.from({ length: 5 }, (_, index) => ({
          distance: 100000,
          time: 60000,
          avgHr: 140 + index,
          avgCadence: 172 - index
        }))
      }
    ]
  }),
  "req-cadence-laps"
);
assert.equal(cadenceLapPreview?.sections.cadence?.chartKind, "laps");
assert.deepEqual(
  cadenceLapPreview?.sections.cadence?.laps?.map((lap) => lap.avgCadence),
  [172, 171, 170, 169, 168]
);
// The lap table on the card carries it too, so the chart and the rows agree.
assert.equal(cadenceLapPreview?.sections.laps?.[0]?.avgCadence, 172);

// An activity with no cadence anywhere gains no empty section.
assert.equal(visualPreview.sections.cadence, undefined);

// --- Sections: the coach asks for what the question needs ---
//
// The summary is always there; everything else is on request, so comparing
// five activities can cost five summaries rather than five lap tables.
const lapsOnlyText = formatActivityDetailForChat(
  parseActivityDetail(driftFixture),
  false,
  "metric",
  new Set(["laps"])
);
assert.match(lapsOnlyText, /^Activity detail\nName: Long run/);
assert.match(lapsOnlyText, /Laps:/);
assert.doesNotMatch(lapsOnlyText, /Trend across the activity/);
// An omitted section that has data is named, so its absence is not read as
// "COROS did not record it". Zones, elevation and strength have none here.
assert.match(lapsOnlyText, /Not included this time \(request via sections\): trend\./);
assert.doesNotMatch(driftText, /Not included this time/, "the default omits nothing but series");

const trendOnlyText = formatActivityDetailForChat(
  parseActivityDetail(driftFixture),
  false,
  "metric",
  new Set(["trend"])
);
assert.match(trendOnlyText, /Trend across the activity/);
assert.doesNotMatch(trendOnlyText, /Laps:/);
assert.doesNotMatch(trendOnlyText, /Laps: none recorded/, "an unasked lap table is not reported as empty");

assert.match(
  formatActivityDetailForChat(detail, false, "metric", new Set(["series"])),
  /Time series/,
  "series can be asked for through sections"
);

assert.deepEqual([...parseActivityDetailSections({ sections: "laps, zones" })], ["laps", "zones"]);
assert.deepEqual(
  [...parseActivityDetailSections({})].sort(),
  [...DEFAULT_ACTIVITY_DETAIL_SECTIONS].sort()
);
assert.equal(parseActivityDetailSections({}).has("series"), false);
assert.equal(
  parseActivityDetailSections({ sections: ["bogus"] }).size,
  DEFAULT_ACTIVITY_DETAIL_SECTIONS.size,
  "nothing valid asked for means the default, not an empty detail"
);
assert.ok(
  parseActivityDetailSections({ include_series: true }).has("series"),
  "the pre-sections flag still works for stored transcripts"
);

// --- The activity list: periods, sport families, totals ---
const at = (month, day, hour) => new Date(2026, month - 1, day, hour, 0).getTime() / 1000;
const listFixture = [
  {
    activityId: "a1",
    sportType: 100,
    sportName: "Run",
    name: "Easy",
    startTime: at(9, 7, 6),
    distance: 10_000,
    duration: 3_000,
    avgHr: 145,
    maxHr: 160,
    trainingLoad: 80,
    elevationGain: 40
  },
  {
    activityId: "a2",
    sportType: 102,
    sportName: "Trail Run",
    name: "Hills",
    startTime: at(9, 5, 7),
    distance: 15_000,
    duration: 6_000,
    trainingLoad: 150,
    elevationGain: 600
  },
  {
    activityId: "a3",
    sportType: 402,
    sportName: "Strength",
    startTime: at(9, 3, 18),
    duration: 2_700,
    trainingLoad: 40
  },
  {
    activityId: "a4",
    sportType: 300,
    sportName: "Pool Swim",
    startTime: at(9, 1, 19),
    distance: 2_000,
    duration: 2_400,
    trainingLoad: 50
  }
];

const weekText = formatActivityListForChat(listFixture, "metric", {
  window: { startDay: "20260901", endDay: "20260907" },
  limit: 50
});
assert.match(weekText, /^Activities \(2026-09-01 → 2026-09-07\): 4\n/);
// Totals per family, largest first, so "how much did I run" is read off rather
// than summed by the model. Distance stays inside a family: metres of pool
// added to kilometres of trail is a number that means nothing.
assert.match(weekText, /Totals:\n- Run: 2 · 2:30:00 · 25[.0]* km · load 230 · \+640 m\n/);
assert.match(weekText, /- Strength: 1 · 45:00 · load 40\n/);
assert.match(weekText, /- Swim: 1 · 40:00 · 2,?000 m · load 50\n/);
assert.match(weekText, /- All: 4 · 3:55:00 · load 320 · \+640 m\n/);
assert.doesNotMatch(weekText, /- All: .* km/);

const runsText = formatActivityListForChat(listFixture, "metric", { sport: "run", limit: 10 });
assert.match(runsText, /^Activities \(most recent, Run only\): 2\n/, "trail counts as a run");
assert.doesNotMatch(runsText, /Strength|Swim|- All:/);

assert.match(
  formatActivityListForChat(listFixture, "metric", { limit: 2 }),
  /^Activities \(most recent\): 2 of 4 shown\n/
);
assert.match(
  formatActivityListForChat([], "metric", {
    window: { startDay: "20260901", endDay: "20260907" },
    limit: 50
  }),
  /^No activities found \(2026-09-01 → 2026-09-07\)\.$/
);
assert.match(
  formatActivityListForChat(listFixture, "metric", {
    window: { startDay: "20260901", endDay: "20260907" },
    limit: 50,
    truncatedAtSource: true
  }),
  /older activities in it may be missing/
);

// The snapshot and the list tool share this row, climb included.
assert.match(formatActivityListLine(listFixture[0], "metric"), /· load 80 · \+40 m$/);
assert.match(formatActivityListLine(listFixture[0], "metric"), /2026-09-07 06:00 \(Mon\)/);
assert.equal(formatActivitySpan(listFixture), "2026-09-01 → 2026-09-07, 7 days");
assert.equal(formatActivitySpan([]), undefined);

const listToday = new Date(2026, 8, 11);
assert.deepEqual(parseActivityListWindow({ start_date: "2026-09-01" }, listToday), {
  startDay: "20260901",
  endDay: "20260911"
});
assert.equal(parseActivityListWindow({}, listToday), undefined);
assert.throws(() => parseActivityListWindow({ end_date: "20260901" }, listToday), /needs a start_date/);
assert.throws(() => parseActivityListWindow({ start_date: "Sept 1" }, listToday), /YYYYMMDD/);
assert.throws(
  () => parseActivityListWindow({ start_date: "20260910", end_date: "20260901" }, listToday),
  /before start_date/
);

assert.equal(activitySportFamily(101), "run");
assert.equal(activitySportFamily(103), "run");
assert.equal(activitySportFamily(98, "Custom Run"), "run");
assert.equal(activitySportFamily(204), "bike");
assert.equal(activitySportFamily(301), "swim");
assert.equal(activitySportFamily(402), "strength");
assert.equal(activitySportFamily(900), "walk_hike");
assert.equal(activitySportFamily(701, "Indoor Rowing"), "other");

console.log("test-chat-activity-tools: ok");
