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
    tiredRateNew: 30,
    trainingLoadRatio: 1.15,
    staminaLevel: 40,
    ...(offset === 2 ? { vo2max: 47 } : {}),
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
assert.match(weekText, /- Training load: last 7 days 350\n/);
assert.match(weekText, /- Resting HR: 55 bpm on 09-11 Fri; 7-day average 52\n/);
assert.match(
  weekText,
  /- Overnight HRV: 60 vs baseline 62 on 09-11 Fri; below baseline on 7 of the last 7 readings/
);
// Parsed off the same response all along, and never shown before.
assert.match(
  weekText,
  /- Latest COROS status: Load Impact 30 \(09-11 Fri\) · load ratio 1\.15 \(09-11 Fri\) · Base Fitness 40 \(09-11 Fri\)/
);
assert.match(weekText, /- VO2max: 47 on 09-09 Wed\n/);
assert.match(
  weekText,
  /Day \| Load \| RHR \| HRV \(baseline\) \| Load Impact \| Load ratio \| Base Fitness \| VO2max\n/
);
assert.doesNotMatch(weekText, /RPE load/, "a column nobody fills is dropped");
assert.match(weekText, /09-09 Wed \| 50 \| 55 \| 60 \(62\) \| 30 \| 1\.15 \| 40 \| 47/);
assert.match(weekText, /09-11 Fri \| 50 \| 55 \| 60 \(62\) \| 30 \| 1\.15 \| 40 \| —/);

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
  /Week of \| Load \| RHR avg \| HRV avg \(baseline\) \| Load Impact \| Load ratio \| Base Fitness \| VO2max\n/
);
// Weeks the window cuts into say so, so four days of load is not read against seven.
assert.match(monthText, /08-10 Mon \(partial\) \| 200 \| 50 \|/);
assert.match(monthText, /08-17 Mon \| 350 \| 50 \|/);
assert.match(monthText, /09-07 Mon \(partial\) \| 250 \| 53 \|/);
assert.match(monthText, /Daily, last 7 days:\nDay \|/);

assert.equal(
  formatFitnessTrendsForChat([], 7, today),
  "No fitness trend data for the last 7 days."
);
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
