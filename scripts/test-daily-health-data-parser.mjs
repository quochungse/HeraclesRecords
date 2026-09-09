import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseDailyHealthDataResponse, pickLatestDailyHealthRecord } = await import(
  `${distUrl("dailyHealthDataService.js")}?cacheBust=${Date.now()}`
);

const structuredPayload = JSON.stringify({
  dailyHealthDataList: [
    {
      happenDay: "20260707",
      steps: 9284,
      calories: 2387
    }
  ]
});
const structuredRecords = parseDailyHealthDataResponse(
  structuredPayload,
  "20260707"
);
assert.equal(structuredRecords.length, 1);
assert.equal(structuredRecords[0].happenDay, "20260707");
assert.equal(structuredRecords[0].steps, 9284);
assert.equal(structuredRecords[0].calories, 2387);

const nestedPayload = JSON.stringify({
  data: {
    date: "2026-07-07",
    summary: {
      stepCount: "9,284",
      totalCalories: "2,387 kcal"
    }
  }
});
const nestedRecords = parseDailyHealthDataResponse(nestedPayload, "20260707");
assert.equal(nestedRecords.length, 1);
assert.equal(nestedRecords[0].steps, 9284);
assert.equal(nestedRecords[0].calories, 2387);

const wrappedPayload = JSON.stringify({
  text: JSON.stringify(
    [
      "Daily Health Data",
      "========================",
      "",
      "2026-07-07",
      "Steps: 9,284",
      "Calories: 2,387 kcal"
    ].join("\n")
  )
});
const wrappedRecords = parseDailyHealthDataResponse(wrappedPayload, "20260707");
assert.equal(wrappedRecords.length, 1);
assert.equal(wrappedRecords[0].happenDay, "20260707");
assert.equal(wrappedRecords[0].steps, 9284);
assert.equal(wrappedRecords[0].calories, 2387);

const latest = pickLatestDailyHealthRecord([
  { happenDay: "20260706", steps: 10000, calories: 2400 },
  { happenDay: "20260707", steps: 9284 }
]);
assert.equal(latest?.happenDay, "20260707");
assert.equal(latest?.steps, 9284);
assert.equal(latest?.calories, undefined);

assert.deepEqual(parseDailyHealthDataResponse("", "20260707"), []);

// --- The night's heart rate, which lives only in this feed -----------------
//
// Captured live on 2026-09-09. querySleepData carries no heart rate at all, so
// this block is the only place a night's bpm comes from.
const sleepHrPayload = [
  "Daily Health Data — Last 2 days | Resting HR: 46 bpm | HRV Baseline: 42 ms",
  "Note: sleep entries are dated by their wake-up day.",
  "",
  "--- 20260907 ---",
  "Steps: 3,694 | Calories: 138 kcal | Exercise: 2 min",
  "Stress: Avg 22",
  "Sleep Summary:",
  "  Total: 7h 29min | Deep: 46 min | Light: 4h 35min | REM: 1h 29min | Awake: 39 min",
  "  Sleep HR: Avg 52 bpm | Min 45 bpm | Max 73 bpm",
  "",
  "--- 20260908 ---",
  "Steps: 10,331 | Calories: 690 kcal | Exercise: 52 min",
  "Stress: Avg 23",
  "Sleep Summary:",
  "  Total: 5h 20min | Deep: 24 min | Light: 3h 22min | REM: 1h 8min | Awake: 26 min",
  "  Sleep HR: Avg 50 bpm | Min 44 bpm | Max 71 bpm"
].join("\n");

const sleepHrRecords = parseDailyHealthDataResponse(sleepHrPayload);
assert.equal(sleepHrRecords.length, 2);

const sep8 = sleepHrRecords.find((record) => record.happenDay === "20260908");
assert.equal(sep8?.sleepAvgHr, 50);
assert.equal(sep8?.sleepMinHr, 44);
assert.equal(sep8?.sleepMaxHr, 71);
assert.equal(sep8?.steps, 10331, "the steps this feed already carried still parse");
assert.equal(sep8?.calories, 690);

const sep7 = sleepHrRecords.find((record) => record.happenDay === "20260907");
assert.equal(sep7?.sleepAvgHr, 52, "each day keeps its own night, not the first one's");
assert.equal(sep7?.sleepMaxHr, 73);

// The resting HR in the header belongs to no single day and must not be read
// as one — it would otherwise land on whichever block parsed first.
assert.ok(
  sleepHrRecords.every((record) => record.sleepAvgHr !== 46),
  "the header's resting HR is not a night's sleep HR"
);

// A day whose only news is the night's heart rate still counts as a day.
const hrOnly = parseDailyHealthDataResponse(
  ["--- 20260906 ---", "Sleep Summary:", "  Sleep HR: Avg 48 bpm | Min 42 bpm | Max 66 bpm"].join("\n")
);
assert.equal(hrOnly.length, 1);
assert.equal(hrOnly[0].sleepAvgHr, 48);
assert.equal(hrOnly[0].steps, undefined);

console.log("daily health data parser tests passed");
