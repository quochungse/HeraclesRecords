// The arithmetic a sleep record implies. What this pins is the one decision
// the file exists for: `totalMinutes` is the *main sleep*, which the stage
// percentages and the efficiency are a share of, and the day's whole sleep is
// that plus its naps. Reading the first as the second drifts every percentage
// hanging off it; reading the second as the first loses an afternoon.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  isNapOnlyRecord,
  isSleepDayRecord,
  napMinutes,
  napWindowsOf,
  sleepWindowDurationMinutes,
  totalSleepMinutes,
  windowDurationMinutes
} = await import(`${distUrl("sleepMetrics.js")}?cacheBust=${Date.now()}`);

// --- The total is both halves ----------------------------------------------

const night = { happenDay: "20260916", kind: "main", totalMinutes: 414, napMinutes: 0 };
assert.equal(totalSleepMinutes(night), 414, "a night with no naps totals the night");
assert.equal(napMinutes(night), 0, "a reported zero is an answer, not an absence");

const nightWithNap = { ...night, napMinutes: 91 };
assert.equal(
  totalSleepMinutes(nightWithNap),
  505,
  "the nap is part of the day's sleep, not a footnote to it"
);
assert.equal(
  nightWithNap.totalMinutes,
  414,
  "and the main sleep is untouched, because the stages are its share"
);

const napOnly = {
  happenDay: "20260915",
  kind: "nap-only",
  napMinutes: 278,
  napWindows: [
    { start: "00:19", end: "02:20" },
    { start: "05:05", end: "07:42" }
  ]
};
assert.equal(
  totalSleepMinutes(napOnly),
  278,
  "a day of nothing but naps totals its naps"
);
assert.equal(napOnly.totalMinutes, undefined);

// A day COROS reported nothing for has no total to state. Zero would read as
// "slept nothing", which is a claim, and it would drag every average down.
assert.equal(totalSleepMinutes({ happenDay: "20260904", kind: "main" }), undefined);

// Non-finite values are absences, not numbers to add.
assert.equal(
  totalSleepMinutes({ happenDay: "20260904", totalMinutes: Number.NaN }),
  undefined
);
assert.equal(
  totalSleepMinutes({ happenDay: "20260904", totalMinutes: 400, napMinutes: Number.NaN }),
  400
);

// --- Which records are days -------------------------------------------------

assert.equal(isSleepDayRecord(night), true);
assert.equal(isSleepDayRecord(napOnly), true, "a nap-only day is a day");
assert.equal(
  isSleepDayRecord({ happenDay: "20260812", kind: "nap" }),
  false,
  "a single nap is a piece of a day, folded into it and never listed beside it"
);
assert.equal(
  isSleepDayRecord({ happenDay: "20260812" }),
  true,
  "an unmarked record is a main sleep, as every stored night is"
);
assert.equal(isNapOnlyRecord(napOnly), true);
assert.equal(isNapOnlyRecord(night), false);

// --- Windows ---------------------------------------------------------------

assert.deepEqual(
  napWindowsOf(napOnly).map((window) => `${window.start}-${window.end}`),
  ["00:19-02:20", "05:05-07:42"],
  "COROS writes one window per nap and all of them are the answer"
);
assert.deepEqual(
  napWindowsOf({ happenDay: "20260812", napStart: "13:00", napEnd: "13:40" }),
  [{ start: "13:00", end: "13:40" }],
  "a record stored before napWindows existed still answers with the pair it has"
);
assert.deepEqual(napWindowsOf(night), []);

// --- How long a window ran --------------------------------------------------
//
// The dates are the whole point. Without them the only reading available is
// "an end at or before its start crossed midnight", which is right for a night
// and wrong for a nap — and COROS dates both ends of every window it sends.

assert.equal(
  windowDurationMinutes({
    start: "00:19",
    end: "02:20",
    startDay: "20260915",
    endDay: "20260915"
  }),
  121,
  "a nap inside one day"
);
assert.equal(
  windowDurationMinutes({
    start: "23:47",
    end: "07:50",
    startDay: "20260915",
    endDay: "20260916"
  }),
  483,
  "a night across midnight, by arithmetic on the dates"
);
assert.equal(
  windowDurationMinutes({ start: "23:47", end: "07:50" }),
  483,
  "and the same without them, by the one inference there is"
);
// Undated, an evening nap reads as a nap rather than as almost a whole day.
assert.equal(windowDurationMinutes({ start: "16:50", end: "17:47" }), 57);
assert.equal(windowDurationMinutes({ start: "16:50" }), undefined);

assert.equal(
  sleepWindowDurationMinutes({
    sleepStart: "23:47",
    sleepEnd: "07:50",
    sleepStartDay: "20260915",
    sleepEndDay: "20260916"
  }),
  483
);

// The naps COROS sent for 2026-09-15 sum to the total it reported for the day,
// which is what makes showing a length per nap arithmetic rather than a claim.
assert.equal(
  napOnly.napWindows.reduce(
    (total, window) => total + windowDurationMinutes(window),
    0
  ),
  napMinutes(napOnly),
  "each nap's window and the day's reported nap total agree"
);

// --- The renderer imports this file directly -------------------------------

const source = fs.readFileSync(path.join(repoRoot, "electron/sleepMetrics.ts"), "utf8");
assert.ok(
  !/from "node:/.test(source),
  "sleepMetrics is imported by the renderer and must stay free of node built-ins"
);

console.log("sleep metrics: all assertions passed");
