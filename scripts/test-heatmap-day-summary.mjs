import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "heatmapDaySummary.ts")
);
const {
  buildHeatmapDayEntries,
  formatCardDuration,
  formatHappenDayShort,
  formatStrengthFocus,
  indexStrengthSessions,
  buildSportSharesByDay,
  sportStripeGradient
} = await import(`${modUrl.href}?c=${Date.now()}`);

// --- formatCardDuration -----------------------------------------------------
assert.equal(formatCardDuration(2760), "46'", "under an hour reads as minutes");
assert.equal(formatCardDuration(4883), "1:21", "over an hour reads as h:mm");
assert.equal(formatCardDuration(3600), "1:00", "exactly an hour keeps the zero");
assert.equal(formatCardDuration(20), "1'", "a short session never rounds to 0");
assert.equal(formatCardDuration(0), "", "no duration renders nothing");
assert.equal(formatCardDuration(undefined), "", "missing duration renders nothing");

// --- formatHappenDayShort ---------------------------------------------------
assert.equal(formatHappenDayShort("20260805"), "5/8", "d/M, leading zeros dropped");
assert.equal(formatHappenDayShort("20260903"), "3/9");
assert.equal(formatHappenDayShort("nonsense"), "nonsense", "garbage passes through");

// --- formatStrengthFocus ----------------------------------------------------
const session = (nameKeys) => ({
  activityId: "a1",
  sportType: 402, // COROS Strength
  detail: {
    summary: {},
    exercises: nameKeys.map((nameKey) => ({ nameKey, sets: 1, totalReps: 1, entries: [] }))
  }
});

assert.equal(
  formatStrengthFocus(session(["S4209", "S4211"])),
  "Shoulders, Chest",
  "COROS body-region codes resolve to their English names"
);
assert.equal(
  formatStrengthFocus(session(["S4209", "S4209"])),
  "Shoulders",
  "a region worked twice is listed once"
);
assert.equal(
  formatStrengthFocus(session(["S4209", "S4211", "S4212", "S4213"])),
  "Shoulders, Chest +2",
  "the list is capped at two and suffixed"
);
// Structured sessions and Hevy imports carry real exercise names, which would
// take over the card — and every other card in the band grows with it.
const named = (rawNames) => ({
  activityId: "a1",
  sportType: 402,
  detail: {
    summary: {},
    exercises: rawNames.map((rawName) => ({
      nameKey: rawName,
      rawName,
      sets: 1,
      totalReps: 1,
      entries: []
    }))
  }
});

assert.equal(
  formatStrengthFocus(named(["Seated Lat Pulldowns", "Seated Cable Row", "Bent Over Row"])),
  "3 exercises",
  "names past the budget collapse into a count"
);
assert.equal(
  formatStrengthFocus(named(["Thoracic Spine Rotation"])),
  "Thoracic Spine…",
  "one long name is trimmed at a word boundary rather than counted"
);
assert.equal(
  formatStrengthFocus(named(["Squat", "Bench"])),
  "Squat, Bench",
  "short names are still spelled out"
);
assert.equal(formatStrengthFocus(undefined), "", "an uncached session says nothing");
assert.equal(formatStrengthFocus(session([])), "", "an empty breakdown says nothing");

// --- indexStrengthSessions --------------------------------------------------
const merged = {
  activityId: "merged-1",
  sportType: 402, // COROS Strength
  sourceIds: { coros: "coros-1", hevy: "hevy-1" },
  detail: { summary: {}, exercises: [] }
};
const index = indexStrengthSessions([merged]);
assert.equal(index.get("merged-1"), merged, "indexed by its own id");
assert.equal(index.get("coros-1"), merged, "and by the COROS id it merged");

// --- buildHeatmapDayEntries -------------------------------------------------
// 2026-08-05 local time, so the day key is stable wherever the test runs.
const at = (hours) => Math.floor(new Date(2026, 7, 5, hours, 0, 0).getTime() / 1000);

const activities = [
  {
    activityId: "run-1",
    sportType: 100,
    sportName: "Run",
    startTime: at(18),
    duration: 4883,
    distance: 10022,
    trainingLoad: 226
  },
  {
    activityId: "str-1",
    sportType: 402, // COROS Strength
    sportName: "Strength",
    startTime: at(7),
    duration: 2760,
    distance: 0,
    trainingLoad: 36
  }
];

const entries = buildHeatmapDayEntries(
  activities,
  indexStrengthSessions([{ ...session(["S4209", "S4211"]), activityId: "str-1" }]),
  "metric"
);
const day = entries.get("20260805");
assert.ok(day, "both activities land on their local day");
assert.equal(day.length, 2);

// Morning strength first: the card reads in the order the day was trained.
assert.equal(day[0].title, "Strength: Shoulders, Chest");
assert.deepEqual(
  day[0].meta,
  ["46'"],
  "a session with no distance shows only its duration"
);
assert.equal(day[0].sport, "strength");
assert.equal(day[1].title, "Run", "a non-strength sport keeps its COROS name");
assert.deepEqual(
  day[1].meta,
  ["10.0 km", "1:21"],
  "distance and duration stay separate so a narrow card can wrap between them"
);
assert.equal(day[1].sport, "run");

const imperial = buildHeatmapDayEntries(activities, new Map(), "imperial");
assert.deepEqual(
  imperial.get("20260805")[1].meta,
  ["6.23 mi", "1:21"],
  "distance follows the unit system"
);
assert.equal(
  imperial.get("20260805")[0].title,
  "Strength",
  "without a cached breakdown the card falls back to the sport name"
);

const undated = buildHeatmapDayEntries(
  [{ activityId: "x", sportType: 100, startTime: undefined, duration: 60 }],
  new Map(),
  "metric"
);
assert.equal(undated.size, 0, "an activity with no start time belongs to no day");

// --- buildSportSharesByDay / sportStripeGradient ----------------------------
const shares = buildSportSharesByDay(activities).get("20260805");
assert.equal(shares.length, 2, "one share per sport trained that day");
assert.deepEqual(
  shares.map((entry) => entry.sport),
  ["strength", "run"],
  "segments run in the order the day was trained, matching the printed lines"
);
// Strength ran 2760s of the day's 7643s → 0.1 + 0.8 * (2760/7643).
assert.ok(
  Math.abs(shares[0].share - (0.1 + 0.8 * (2760 / 7643))) < 1e-9,
  "the floor is handed out first and time splits only the remainder"
);
assert.ok(
  Math.abs(shares[0].share + shares[1].share - 1) < 1e-9,
  "shares always add up to the full stripe"
);

const lopsided = buildSportSharesByDay([
  { ...activities[0], duration: 20000 },
  { ...activities[1], duration: 30 }
]).get("20260805");
assert.ok(
  lopsided.every((entry) => entry.share >= 0.1 - 1e-9),
  "a 30-second session still gets its 10%"
);

// Load only steps in when the watch recorded no time at all.
const untimed = buildSportSharesByDay([
  { ...activities[0], duration: 0, trainingLoad: 300 },
  { ...activities[1], duration: 0, trainingLoad: 100 }
]).get("20260805");
assert.ok(
  Math.abs(untimed[1].share - (0.1 + 0.8 * 0.75)) < 1e-9,
  "with no duration anywhere the split falls back to load"
);

const unscored = buildSportSharesByDay([
  { ...activities[0], duration: 0, trainingLoad: 0 },
  { ...activities[1], duration: 0, trainingLoad: 0 }
]).get("20260805");
assert.ok(
  unscored.every((entry) => Math.abs(entry.share - 0.5) < 1e-9),
  "with neither metric the day splits evenly"
);

const single = buildSportSharesByDay([activities[0]]).get("20260805");
assert.deepEqual(single, [{ sport: "run", share: 1 }], "one sport fills the stripe");
assert.equal(
  sportStripeGradient(single),
  "linear-gradient(to bottom, color-mix(in srgb, var(--sport-run) 75%, transparent) 0.00% 100.00%)",
  "a single sport still paints its own stripe — a day scored at load 0 has no --cell-color to fall back on"
);
assert.equal(sportStripeGradient([]), undefined, "a day with nothing gets no stripe");
assert.equal(sportStripeGradient(undefined), undefined);

const gradient = sportStripeGradient([
  { sport: "run", share: 0.25 },
  { sport: "strength", share: 0.75 }
]);
assert.equal(
  gradient,
  "linear-gradient(to bottom, color-mix(in srgb, var(--sport-run) 75%, transparent) 0.00% 25.00%, " +
    "color-mix(in srgb, var(--sport-strength) 75%, transparent) 25.00% 100.00%)",
  "segments are hard-stopped and the last one is pinned to 100%"
);

console.log("heatmap-day-summary tests passed");
