import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildFitnessTrendPreview,
  buildHrZonePreview,
  formatFitnessTrendsForChat,
  withSleepHeartRate,
  trendWindow,
  parseTrendDays,
  formatHrZoneSummaryForChat,
  formatTrainingZonesForChat,
  formatPaceZonesForChat,
  formatPowerZonesForChat,
  accountHrZoneModel,
  formatZoneBpmRange
} = await import(`${distUrl("chatAnalyticsTools.js")}?cacheBust=${Date.now()}`);
const { buildTrendPoints } = await import(
  `${distUrl("trainingTrendUtils.js")}?cacheBust=${Date.now()}`
);
const { sleepNightsByDay, sleepHrBaseline, medianOf } = await import(
  `${distUrl("sleepHeartRate.js")}?cacheBust=${Date.now()}`
);
const { formatCoachSleepHeartRate, formatCoachDashboard } = await import(
  `${distUrl("chatCoachContext.js")}?cacheBust=${Date.now()}`
);

const trendPoints = buildTrendPoints([
  {
    happenDay: "20260701",
    trainingLoad: 120,
    rhr: 48,
    avgSleepHrv: 62,
    sleepHrvBase: 58
  },
  {
    happenDay: "20260702",
    trainingLoad: 80,
    rhr: 49,
    avgSleepHrv: 60,
    sleepHrvBase: 58
  }
]);

const fitnessPreview = buildFitnessTrendPreview(trendPoints, "req-1");
assert.ok(fitnessPreview);
assert.equal(fitnessPreview.trendPoints.length, 2);
assert.equal(fitnessPreview.previewId, "fitness-trends:req-1");
assert.equal(buildFitnessTrendPreview([], "req-2"), null);
assert.equal(
  buildFitnessTrendPreview(buildTrendPoints([{ happenDay: "20260701", trainingLoad: 120 }]), "req-6"),
  null,
  "a window with load and no recovery reading draws no recovery card"
);

const zonePreview = buildHrZonePreview(
  {
    hrTrainingLoad: [
      { index: 1, ratio: 0.2, value: 100 },
      { index: 2, ratio: 0.3, value: 150 },
      { index: 3, ratio: 0.5, value: 250 }
    ],
    hrDistance: [],
    hrTime: []
  },
  [{ index: 1, hr: 130 }, { index: 2, hr: 150 }],
  "trainingLoad",
  "req-3"
);
assert.ok(zonePreview);
assert.equal(zonePreview.zones.length, 3);
assert.equal(zonePreview.metric, "trainingLoad");
// Labels count from one, as the Training screen writes them; the index stays
// COROS's own, which is what the card looks the bpm range up by.
assert.deepEqual(zonePreview.zones.map((zone) => zone.label), ["Zone 1", "Zone 2", "Zone 3"]);
assert.deepEqual(zonePreview.zones.map((zone) => zone.index), [1, 2, 3]);
assert.equal(
  buildHrZonePreview(
    { hrTrainingLoad: [], hrDistance: [], hrTime: [] },
    [],
    "time",
    "req-4"
  ),
  null
);

{
  // The card draws the night's heart rate where it drew COROS's daytime RHR,
  // on the morning the night ended (as HRV), and carries no `rhr` of its own.
  const nights = new Map([["20260702", { heartRate: { avg: 54, min: 47 } }]]);
  const points = withSleepHeartRate(trendPoints, nights);
  assert.equal(points.some((point) => "rhr" in point), false, "no daytime resting HR on the card");
  assert.deepEqual(
    points.map((point) => [point.date, point.sleepAvgHr, point.sleepMinHr]),
    [["20260701", undefined, undefined], ["20260702", 54, 47]]
  );
  const onlySleepHr = withSleepHeartRate(
    buildTrendPoints([{ happenDay: "20260702", trainingLoad: 80, rhr: 49 }]),
    nights
  );
  assert.ok(buildFitnessTrendPreview(onlySleepHr, "req-7"), "sleeping HR alone is a recovery card");
  assert.equal(
    buildFitnessTrendPreview(buildTrendPoints([{ happenDay: "20260702", rhr: 49 }]), "req-8"),
    null,
    "a daytime resting HR alone no longer is"
  );
}

assert.equal(buildFitnessTrendPreview(trendPoints, "req-5", 30).windowDays, 30);
assert.equal("windowDays" in fitnessPreview, false, "a card without a window reads as 7 days");

// ---------------------------------------------------------------------------
// Fitness trends as the coach reads them
// ---------------------------------------------------------------------------

// Friday 11 September 2026, local; keys are built with local getters.
const today = new Date(2026, 8, 11);
const key = (offset) => {
  const date = new Date(today);
  date.setDate(date.getDate() - offset);
  return (
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}` +
    `${String(date.getDate()).padStart(2, "0")}`
  );
};

const dayList = [
  ...Array.from({ length: 30 }, (_, offset) => ({
    happenDay: key(offset),
    trainingLoad: 50,
    rhr: offset < 3 ? 55 : 50,
    ...(offset < 7 ? { avgSleepHrv: 60, sleepHrvBase: 62 } : {}),
    // Load Impact and Base Fitness are `ati` and `cti`, whose ratio is the
    // day's; `tiredRateNew` is their difference and `staminaLevel` comes only
    // on a day with a run, and neither is read as either (probed 2026-10-28).
    ati: 46,
    cti: 40,
    tiredRateNew: 6,
    trainingLoadRatio: 1.15,
    ...(offset === 2 ? { vo2max: 47, staminaLevel: 71.8 } : {}),
    ...(offset === 20 ? { vo2max: 46 } : {})
  })),
  // What getDailyMetrics appends: an RPE-only day from far outside the window.
  // Taking "the last seven rows" would have let rows like it in.
  { happenDay: key(200), rpeLoad: 90 }
];

const week = trendWindow(dayList, 7, today);
assert.equal(week.length, 7);
assert.equal(week[0].happenDay, key(6), "oldest first");

const weekText = formatFitnessTrendsForChat(week, 7, today);
assert.match(
  weekText,
  /^Fitness trends, last 7 days \(09-05 Sat → 09-11 Fri; days without any reading are omitted\):/
);
{
  const wellness = new Map([
    [key(0), { happenDay: key(0), steps: 12000, exerciseMinutes: 60, stressAvg: 40 }],
    [key(1), { happenDay: key(1), steps: 8000, exerciseMinutes: 30, stressAvg: 30 }]
  ]);
  const withWellness = formatFitnessTrendsForChat(week, 7, today, wellness);
  assert.match(withWellness, /- 7 days to 09-11 Fri: steps 10000\/day; exercise 90 min; average stress 35 \(0–100\)/);
  assert.match(withWellness, /\| Steps \| Exercise min \| Stress avg\n/, "the wellness columns close the daily table");
  assert.match(withWellness, /09-11 Fri \|.*\| 12000 \| 60 \| 40$/m);
  assert.doesNotMatch(weekText, /Steps|Stress avg/, "without the feed the table is what it was");
}
{
  // The feed runs to yesterday; its seven days end there, and say so.
  const lagging = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((offset) => [key(offset), { happenDay: key(offset), exerciseMinutes: 10 }]));
  assert.match(formatFitnessTrendsForChat(week, 7, today, lagging), /- 7 days to 09-10 Thu: exercise 70 min/);
}
assert.match(weekText, /- Training load: last 7 days 350\n/);
assert.doesNotMatch(weekText, /Resting HR|RHR/, "COROS's daytime resting HR is not read");
assert.match(
  weekText,
  /- Overnight HRV: 60 vs baseline 62 for the night ending 09-11 Fri; below baseline on 7 of the last 7 readings/
);
// Parsed off the same response all along, and never shown before.
assert.match(
  weekText,
  /- Latest COROS status: Load Impact 46 \(09-11 Fri\) · load ratio 1\.15 \(09-11 Fri\) · Base Fitness 40 \(09-11 Fri\)/
);
assert.doesNotMatch(weekText, /\b71\.8\b|\b72\b/, "`staminaLevel` is not Base Fitness");
assert.match(weekText, /- VO2max: 47 on 09-09 Wed\n/);
assert.match(
  weekText,
  /Daily \("that night" = the sleep after that day \(COROS files it under the next morning\); sleep includes naps; sleep HR is the main sleep's average \(lowest\)\):\nDay \| Load \| HRV that night \(baseline\) \| Load Impact \| Load ratio \| Base Fitness \| VO2max\n/
);
assert.doesNotMatch(weekText, /RPE load|Sleep that night|Sleep HR/, "a column nobody fills is dropped");
assert.match(weekText, /09-09 Wed \| 50 \| 60 \(62\) \| 46 \| 1\.15 \| 40 \| 47/);
assert.match(weekText, /09-11 Fri \| 50 \| — \| 46 \| 1\.15 \| 40 \| —/, "today's night has not been slept");
{
  // The night after each day: its length and the heart rate it was slept at,
  // and a summary that sets last night against the four weeks before the
  // last seven. 35 nights at 50, then the last seven: 52 50 58 50 61 50 54.
  const recentAvg = [52, 50, 58, 50, 61, 50, 54];
  const records = Array.from({ length: 35 }, (_, offset) => ({
    happenDay: key(offset),
    kind: "main",
    totalMinutes: 400 + offset,
    napMinutes: offset === 0 ? 30 : 0,
    completeness: "complete",
    avgHr: offset < 7 ? recentAvg[6 - offset] : 50,
    minHr: offset < 7 ? recentAvg[6 - offset] - 6 : 44
  }));
  const nights = sleepNightsByDay(records);
  const text = formatFitnessTrendsForChat(week, 7, today, new Map(), nights);
  assert.match(text, /\nDay \| Load \| Sleep that night \| HRV that night \(baseline\) \| Sleep HR that night \| Load Impact/);
  // 09-09 Wed is followed by the night ending 09-10 Thu (offset 1: 401 min, 50 bpm).
  assert.match(text, /\n09-09 Wed \| 50 \| 6h41 \| 60 \(62\) \| 50 \(44\) \| 46/);
  assert.match(text, /\n09-11 Fri \| 50 \| — \| — \| — \| 46/, "the night after today has not been slept");
  assert.match(text, /- Sleep: 7h10 the night ending 09-11 Fri; 7-night average 6h47\n/);
  assert.match(
    text,
    /- Sleep HR: 54 \(48\) for the night ending 09-11 Fri; baseline 50 \(median of the 28 nights before the last 7\); 5\+ bpm above it on 2 of the last 7 nights\n/
  );
  // The summary leads with load, then the night, then HRV.
  assert.ok(text.indexOf("- Sleep HR:") < text.indexOf("- Overnight HRV:"));

  const monthWithNights = formatFitnessTrendsForChat(trendWindow(dayList, 30, today), 30, today, new Map(), nights);
  assert.match(monthWithNights, /Week of \| Load \| Sleep avg \| HRV avg \(baseline\) \| Sleep HR avg \| Load Impact/);
  // Week of 09-07: the nights after Mon–Fri end Tue–Fri (Sat has none yet):
  // 403 402 401 430 min, 50 61 50 54 bpm.
  assert.match(monthWithNights, /09-07 Mon \(partial\) \| 250 \| 6h49 \| 60 \(62\) \| 54 \|/);
}
{
  // Under seven nights of history there is no baseline to state.
  const short = sleepNightsByDay([
    { happenDay: key(0), kind: "main", totalMinutes: 420, completeness: "complete", avgHr: 55, minHr: 49 }
  ]);
  const text = formatFitnessTrendsForChat(week, 7, today, new Map(), short);
  assert.match(text, /- Sleep HR: 55 \(49\) for the night ending 09-11 Fri\n/);
}
{
  // COROS files a night under the morning it ended, so the night after a run
  // is the next day's reading. The 09-26 run was followed by 59, not by the
  // 48 of the night before it, which is what its own row carries.
  const runWeek = [
    { happenDay: "20260925", trainingLoad: 0, avgSleepHrv: 64, sleepHrvBase: 61 },
    { happenDay: "20260926", trainingLoad: 288, avgSleepHrv: 48, sleepHrvBase: 61 },
    { happenDay: "20260927", trainingLoad: 61, avgSleepHrv: 59, sleepHrvBase: 61 }
  ];
  const text = formatFitnessTrendsForChat(runWeek, 3, new Date(2026, 8, 27, 12));
  assert.match(text, /\n09-25 Fri \| 0 \| 48 \(61\)\n/);
  assert.match(text, /\n09-26 Sat \| 288 \| 59 \(61\)\n/);
  assert.match(text, /\n09-27 Sun \| 61 \| —$/);
  assert.match(text, /- Overnight HRV: 59 vs baseline 61 for the night ending 09-27 Sun;/);
}

// A month rolls up by week and keeps the last seven days daily.
const month = trendWindow(dayList, 30, today);
assert.equal(month.length, 30, "the RPE-only day 200 days back stays out");
const monthText = formatFitnessTrendsForChat(month, 30, today);
assert.match(
  monthText,
  /- Training load: last 7 days 350; previous 7 days 350; 28-day weekly average 350\n/
);
assert.match(monthText, /- VO2max: 47 on 09-09 Wed \(was 46 on 08-22 Sat\)/);
assert.match(
  monthText,
  /Week of \| Load \| HRV avg \(baseline\) \| Load Impact \| Load ratio \| Base Fitness \| VO2max\n/
);
// Weeks the window cuts into say so, so four days of load is not read against seven.
assert.match(monthText, /08-10 Mon \(partial\) \| 200 \| — \|/);
assert.match(monthText, /08-17 Mon \| 350 \| — \|/);
assert.match(monthText, /09-07 Mon \(partial\) \| 250 \| 60 \(62\) \|/);
assert.match(monthText, /Daily, last 7 days \("that night" = the sleep after that day [^\n]+\):\nDay \|/);

{
  // COROS's cycling VO2max is its own field. Parsed, a day without one has
  // none (COROS sends 0), so the column and the line stay out until a ride
  // gives one.
  assert.doesNotMatch(weekText, /Cycling VO2max/);
  const rideWeek = week.map((day, index) => (index >= 4 ? { ...day, cycleVo2max: index === 6 ? 52 : 51 } : day));
  const text = formatFitnessTrendsForChat(rideWeek, 7, today);
  assert.match(text, /- VO2max: 47 on 09-09 Wed\n- Cycling VO2max: 52 on 09-11 Fri \(was 51 on 09-09 Wed\)\n/);
  assert.match(text, /\| Base Fitness \| VO2max \| Cycling VO2max\n/);
  assert.match(text, /09-11 Fri \| 50 \| — \| 46 \| 1\.15 \| 40 \| — \| 52/);
  assert.match(text, /09-07 Mon \| 50 \| 60 \(62\) \| 46 \| 1\.15 \| 40 \| — \| —/);
}

assert.equal(
  formatFitnessTrendsForChat([], 7, today),
  "No fitness trend data for the last 7 days."
);
// ---------------------------------------------------------------------------
// The night's heart rate, as every reader takes it
// ---------------------------------------------------------------------------
{
  const nights = sleepNightsByDay([
    { happenDay: "20261016", kind: "main", totalMinutes: 459, completeness: "complete", avgHr: 78, minHr: 63 },
    // A day of naps only: the daily-health line is one nap's, never a night's.
    { happenDay: "20261017", kind: "nap-only", napMinutes: 40, completeness: "complete", avgHr: 70, minHr: 66 },
    // Still arriving: neither its length nor its heart rate is the night's yet.
    { happenDay: "20261018", kind: "main", totalMinutes: 120, completeness: "partial", avgHr: 60 },
    // A nap folded into its day is no record of its own.
    { happenDay: "20261019", kind: "nap", napMinutes: 20, avgHr: 65 },
    { happenDay: "20261020", kind: "main", totalMinutes: 0, completeness: "complete", avgHr: 0 }
  ]);
  assert.deepEqual(nights.get("20261016"), { heartRate: { avg: 78, min: 63 }, minutes: 459 });
  assert.deepEqual(nights.get("20261017"), { minutes: 40 }, "a nap-only day keeps its sleep, not its heart rate");
  assert.equal(nights.has("20261018"), false);
  assert.equal(nights.has("20261019"), false);
  assert.deepEqual(nights.get("20261020"), { minutes: 0 }, "a zero is no heart rate");

  assert.equal(medianOf([]), undefined);
  assert.equal(medianOf([55, 50, 78]), 55, "one feverish night does not move a median");
  assert.equal(medianOf([50, 52, 54, 56]), 53);

  const byDay = new Map(
    Array.from({ length: 10 }, (_, index) => [`202610${String(index + 1).padStart(2, "0")}`, { heartRate: { avg: 50 + (index === 4 ? 30 : 0) } }])
  );
  assert.equal(sleepHrBaseline(byDay, "20261011"), 50, "the ten nights before, a median");
  assert.equal(sleepHrBaseline(byDay, "20261007"), undefined, "six nights are too few");
}
{
  // The snapshot: COROS's daytime resting HR is gone, and last night's sleeping
  // HR stands against the 28 nights before it.
  const dashboard = formatCoachDashboard({ racePredictor: {}, rhr: 60, recoveryPct: 88 });
  assert.doesNotMatch(dashboard, /Resting HR/);
  assert.match(dashboard, /^- Recovery: 88%$/m);

  const records = Array.from({ length: 30 }, (_, offset) => ({
    happenDay: key(offset),
    kind: "main",
    totalMinutes: 420,
    completeness: "complete",
    avgHr: offset === 0 ? 61 : 52,
    minHr: offset === 0 ? 50 : 46
  }));
  assert.equal(
    formatCoachSleepHeartRate(records, today),
    "- Sleep HR, night ending 09-11 Fri: 61 avg, 50 lowest; 28-night median 52"
  );
  assert.equal(
    formatCoachSleepHeartRate(records.slice(1), today),
    "- Sleep HR, night ending 09-10 Thu: 52 avg, 46 lowest; 28-night median 52",
    "before this morning's night has synced, yesterday's is last night"
  );
  assert.equal(formatCoachSleepHeartRate(records.slice(2), today), undefined, "an older night would read as last night");
}

assert.equal(parseTrendDays(undefined), 7);
assert.equal(parseTrendDays("28"), 28);
assert.equal(parseTrendDays(500), 90);
assert.equal(parseTrendDays(-3), 7);

// ---------------------------------------------------------------------------
// Heart-rate zones: the account's own model, all three measures at once
// ---------------------------------------------------------------------------

const profile = {
  userId: "u1",
  hrZoneType: 2,
  thresholds: {
    maxHr: 190,
    restingHr: 52,
    zones: {
      maxHr: [],
      restingHr: [
        { index: 0, bpm: 133, ratio: 59 },
        { index: 1, bpm: 147, ratio: 69 },
        { index: 2, bpm: 160, ratio: 78 },
        { index: 3, bpm: 172, ratio: 87 },
        { index: 4, bpm: 183, ratio: 95 },
        // COROS's sentinel ceiling for the top zone.
        { index: 5, bpm: 404, ratio: 255 }
      ],
      lthr: [{ index: 0, bpm: 140 }],
      thresholdPace: [],
      cyclePower: []
    },
    ranges: {}
  }
};

// The reserve model the account is on, not the dashboard's LTHR zones.
const model = accountHrZoneModel(profile, { lthrZones: [{ index: 0, hr: 999 }] });
assert.equal(model.label, "Heart rate reserve");
assert.equal(model.anchor, "max HR 190 bpm, resting 52 bpm");
assert.equal(formatZoneBpmRange(model.zones, 0), "≤ 133 bpm");
assert.equal(formatZoneBpmRange(model.zones, 1), "134–147 bpm");
assert.equal(formatZoneBpmRange(model.zones, 5), "≥ 184 bpm", "the sentinel reads open-ended");

const fallback = accountHrZoneModel(null, {
  lthrZones: [
    { index: 1, hr: 150 },
    { index: 0, hr: 130 }
  ]
});
assert.match(fallback.label, /could not be read/);
assert.deepEqual(fallback.zones.map((zone) => zone.index), [0, 1]);
assert.equal(accountHrZoneModel(null, null), undefined);

const distributions = {
  hrTime: [3600, 7200, 3600, 0, 0, 0].map((value, index) => ({ index, value })),
  hrTrainingLoad: [20, 60, 80, 40, 0, 0].map((value, index) => ({ index, value })),
  hrDistance: []
};
const zoneText = formatHrZoneSummaryForChat(distributions, model, "metric");
assert.match(
  zoneText,
  /^HR zones and the last 4 weeks in them — Heart rate reserve \(max HR 190 bpm, resting 52 bpm\):\n/
);
assert.match(zoneText, /\nZone \| HR range \| Time \| Load\n/, "an empty measure gets no column");
assert.match(zoneText, /\nZ1 \| ≤ 133 bpm \| 1:00:00 \(25%\) \| 20 \(10%\)\n/);
assert.match(zoneText, /\nZ2 \| 134–147 bpm \| 2:00:00 \(50%\) \| 60 \(30%\)\n/);
assert.match(zoneText, /\nZ6 \| ≥ 184 bpm \| 0:00 \(0%\) \| 0 \(0%\)$/);

const noModelText = formatHrZoneSummaryForChat(distributions, undefined, "metric");
assert.match(noModelText, /\nZone \| Time \| Load\n/);
assert.match(noModelText, /Zone bpm ranges are unavailable/);
assert.equal(
  formatHrZoneSummaryForChat({ hrTime: [], hrTrainingLoad: [], hrDistance: [] }, model, "metric"),
  "No heart-rate zone distribution data for the last 4 weeks."
);

// ---------------------------------------------------------------------------
// Pace and power zones
// ---------------------------------------------------------------------------
//
// The exact tables this account carries, read from /account/query on
// 2026-09-11. `ratio` is a percentage of threshold *speed* and `pace` is the
// zone's fast edge: 328 s/km at 100%, 473 at 69.3% (328 / 0.693). The last
// entry is a sentinel, the way `hr: 404` is on the reserve table.
const paceZones = [
  { index: 0, paceSecondsPerKm: 473, ratio: 69.3 },
  { index: 1, paceSecondsPerKm: 401, ratio: 81.7 },
  { index: 2, paceSecondsPerKm: 358, ratio: 91.6 },
  { index: 3, paceSecondsPerKm: 328, ratio: 100 },
  { index: 4, paceSecondsPerKm: 322, ratio: 101.8 },
  { index: 5, paceSecondsPerKm: 289, ratio: 113.4 },
  { index: 6, paceSecondsPerKm: 164, ratio: 200 }
];

const paceText = formatPaceZonesForChat(paceZones, "metric");
assert.match(paceText, /^Pace zones \(% of threshold speed\):\nZone \| Pace \| % of threshold\n/);
assert.match(paceText, /\nZ1 \| slower than 7:53\/km \| below 69%\n/);
assert.match(paceText, /\nZ2 \| 6:41–7:53\/km \| 69%–82%\n/);
assert.match(paceText, /\nZ4 \| 5:28–5:58\/km \| 92%–100%\n/);
// The 200% sentinel is never printed as a pace anyone runs.
assert.match(paceText, /\nZ7 \| faster than 4:49\/km \| above 113%$/);
assert.doesNotMatch(paceText, /2:44/);
assert.equal(formatPaceZonesForChat([], "metric"), undefined);

// Imperial follows the athlete's units on both sides of the band.
assert.match(formatPaceZonesForChat(paceZones, "imperial"), /\nZ1 \| slower than 12:41\/mi \|/);

const powerZones = [101, 135, 162, 189, 216, 270, 900].map((watts, index) => ({
  index,
  watts,
  ratio: [56, 75, 90, 105, 120, 150, 500][index]
}));
const powerText = formatPowerZonesForChat(powerZones);
assert.match(powerText, /^Power zones:\nZone \| Power\nZ1 \| ≤ 101 W\n/);
assert.match(powerText, /\nZ2 \| 102–135 W\n/);
assert.match(powerText, /\nZ7 \| ≥ 271 W$/, "the 900 W sentinel reads open-ended");
assert.equal(formatPowerZonesForChat([]), undefined);

// The three tables in one answer, led by the thresholds they hang off.
const profileWithZones = {
  ...profile,
  thresholds: {
    ...profile.thresholds,
    lthr: 168,
    thresholdPaceSecondsPerKm: 328,
    ftp: 180,
    zones: { ...profile.thresholds.zones, thresholdPace: paceZones, cyclePower: powerZones }
  }
};
const allZones = formatTrainingZonesForChat(distributions, model, profileWithZones, "metric");
assert.match(
  allZones,
  /^Training zones — Heart rate reserve model \(max HR 190 bpm · resting HR 52 bpm · LTHR 168 bpm · threshold pace 5:28\/km · FTP 180 W\):\n/
);
assert.match(allZones, /\nHR zones and the last 4 weeks in them/);
assert.match(allZones, /\nPace zones \(% of threshold speed\):/);
assert.match(allZones, /\nPower zones:/);

// A profile that never arrived costs the zone tables, not the answer.
const distributionOnly = formatTrainingZonesForChat(distributions, model, null, "metric");
assert.match(distributionOnly, /^Training zones — Heart rate reserve model:\n/);
assert.doesNotMatch(distributionOnly, /Pace zones/);

console.log("test-chat-analytics-tools: ok");
