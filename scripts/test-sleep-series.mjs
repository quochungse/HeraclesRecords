// The overnight curve. Every fixture below is a live COROS answer captured on
// 2026-09-09, because the two things that can go wrong here — which day a block
// is filed under, and which timezone a timestamp is in — are invisible in a
// made-up payload and wrong by default.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  parseSleepHrvSeries,
  parseSleepHrvAssessment,
  parseStressSeries,
  sleepWindowBounds,
  sleepWindowDays,
  clipToSleepWindow
} = await import(`${distUrl("sleepSeriesParser.js")}?cacheBust=${Date.now()}`);

/** Reads a point's clock the way the chart does: local frame, as UTC. */
function clockOf(localAt) {
  const date = new Date(localAt);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}`;
}

// --- querySleepHrv ----------------------------------------------------------

const hrvResponse = [
  "Sleep HRV — 2026-09-07 to 2026-09-08",
  "========================",
  "Note: dates are wake-up days (each value comes from the night that ended that morning).",
  "",
  "HRV Assessment — Last 2 days",
  "========================",
  "",
  "2026-09-08:",
  "  HRV Avg: 75 ms — Above normal",
  "  Normal Range: 55 - 67 ms",
  "  Baseline: 61 ms",
  "2026-09-07:",
  "  HRV Avg: 70 ms — Above normal",
  "  Normal Range: 56 - 66 ms",
  "  Baseline: 61 ms",
  "",
  "Sleep HRV Time Series — Last 2 days",
  "========================",
  "",
  "2026-09-08:",
  // 1788803040 is 2026-09-08 00:44 at UTC+7, which timezone=28 encodes.
  "  timestamp=1788803040, timezone=28, hrv=43 ms, status=4, confidence=96551",
  "  timestamp=1788804840, timezone=28, hrv=61 ms, status=4, confidence=100000",
  "  timestamp=1788822840, timezone=28, hrv=0 ms, status=0, confidence=0",
  "  timestamp=1788824640, timezone=28, hrv=58 ms, status=4, confidence=100000"
].join("\n");

const hrv = parseSleepHrvSeries(hrvResponse);
assert.equal(hrv.length, 3, "a zero reading is COROS failing to measure, not an HRV of nought");
assert.equal(hrv[0].value, 43);
assert.equal(
  hrv[0].clock,
  "00:44",
  "timezone=28 is quarter-hours: UTC+7, not 28 of anything else"
);
assert.equal(
  clockOf(hrv[0].localAt),
  hrv[0].clock,
  "localAt and clock are the same instant said twice"
);
assert.ok(hrv[0].at < hrv[0].localAt, "the local frame runs ahead of UTC here");
assert.deepEqual(
  hrv.map((point) => point.clock),
  ["00:44", "01:14", "06:44"],
  "points come back in time order"
);

// The assessment is COROS's own verdict; the tool says not to recompute it.
const assessment = parseSleepHrvAssessment(hrvResponse, "20260908");
assert.deepEqual(assessment, {
  happenDay: "20260908",
  avg: 75,
  evaluation: "Above normal",
  normalLow: 55,
  normalHigh: 67,
  baseline: 61
});
assert.equal(
  parseSleepHrvAssessment(hrvResponse, "20260907")?.avg,
  70,
  "the right day's block is read, not the first one"
);
assert.equal(
  parseSleepHrvAssessment(hrvResponse, "20260101"),
  undefined,
  "a day with no block has no assessment"
);
assert.equal(parseSleepHrvAssessment("no sections here", "20260908"), undefined);

// --- queryStressTimeSeries --------------------------------------------------

const stressResponse = JSON.stringify(
  [
    "Stress Time Series — 2026-09-08",
    "========================",
    "",
    "2026-09-08:",
    "  timestamp=1788802740, timezone=28, stress=15, score=1, stressHrv=0, stressHr=0",
    "  timestamp=1788803040, timezone=28, stress=-1, score=0, stressHrv=0, stressHr=0",
    "  timestamp=1788804840, timezone=28, stress=9, score=1, stressHrv=0, stressHr=0"
  ].join("\n")
);

const stress = parseStressSeries(stressResponse);
assert.equal(stress.length, 2, "a JSON-quoted response is unwrapped; -1 means no reading");
assert.equal(stress[0].clock, "00:39");
assert.equal(stress[0].value, 15);

// --- The window, and clipping to it ----------------------------------------

const datedNight = {
  happenDay: "20260908",
  sleepStart: "00:40",
  sleepEnd: "06:00",
  sleepStartDay: "20260908",
  sleepEndDay: "20260908"
};
const datedBounds = sleepWindowBounds(datedNight);
assert.equal(clockOf(datedBounds.startLocal), "00:40");
assert.equal(clockOf(datedBounds.endLocal), "06:00");

// A night that began before midnight, which is what the dates are for.
const overnight = {
  happenDay: "20260907",
  sleepStart: "23:45",
  sleepEnd: "07:14",
  sleepStartDay: "20260906",
  sleepEndDay: "20260907"
};
const overnightBounds = sleepWindowBounds(overnight);
assert.equal(
  overnightBounds.endLocal - overnightBounds.startLocal,
  (7 * 60 + 29) * 60 * 1000,
  "23:45 to 07:14 across midnight is 7h29m"
);

// An older cached record carries no window dates; the start day is inferred.
const undated = {
  happenDay: "20260907",
  sleepStart: "23:45",
  sleepEnd: "07:14"
};
assert.deepEqual(
  sleepWindowBounds(undated),
  overnightBounds,
  "a start clock after the end clock means the night began the day before"
);
assert.equal(
  sleepWindowBounds({ happenDay: "20260908", sleepStart: "00:40" }),
  undefined,
  "half a window is no window"
);

// The two calendar days a night touches, which the stress query needs and the
// clipping bounds are built from — one function, so they cannot disagree.
assert.deepEqual(sleepWindowDays(datedNight), {
  startDay: "20260908",
  endDay: "20260908"
});
assert.deepEqual(sleepWindowDays(overnight), {
  startDay: "20260906",
  endDay: "20260907"
});
assert.deepEqual(
  sleepWindowDays(undated),
  { startDay: "20260906", endDay: "20260907" },
  "without the dates, a start clock past the end clock means the day before"
);
assert.deepEqual(
  sleepWindowDays({ happenDay: "20260908", sleepStart: "00:40", sleepEnd: "06:00" }),
  { startDay: "20260908", endDay: "20260908" },
  "a night entirely after midnight stays on one day"
);
assert.equal(
  sleepWindowDays({ happenDay: "not-a-day" }),
  undefined,
  "a record with no usable day has no window days"
);

// Clipping keeps the night and drops the day around it. The live HRV block for
// 2026-09-07 ran to 20:39 in the evening — that is the point of this.
const dayLong = parseSleepHrvSeries(
  [
    "Sleep HRV Time Series",
    "2026-09-08:",
    "  timestamp=1788802560, timezone=28, hrv=50 ms",   // 00:36, four minutes early
    "  timestamp=1788803040, timezone=28, hrv=43 ms",   // 00:44, inside
    "  timestamp=1788822240, timezone=28, hrv=61 ms",   // 06:04, just past the end
    "  timestamp=1788854040, timezone=28, hrv=70 ms"    // 14:54, the afternoon
  ].join("\n")
);
const clipped = clipToSleepWindow(dayLong, datedBounds);
assert.deepEqual(
  clipped.map((point) => point.clock),
  ["00:36", "00:44", "06:04"],
  "the five-minute slack keeps the readings either side of the pillow"
);

const strict = clipToSleepWindow(dayLong, datedBounds, 0);
assert.deepEqual(
  strict.map((point) => point.clock),
  ["00:44"],
  "and no slack means strictly inside the window"
);

console.log("sleep series: all assertions passed");
