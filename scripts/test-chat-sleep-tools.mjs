import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  formatSleepSummaryForChat,
  formatSleepNightForChat,
  parseSleepNights,
  parseSleepNightArgument
} = await import(`${distUrl("chatSleepTools.js")}?cacheBust=${Date.now()}`);

// Friday 11 September 2026, local. Every key below is built from it with the
// same local getters the formatter uses, so the suite holds in any timezone.
const today = new Date(2026, 8, 11);
const key = (offset) => {
  const date = new Date(today);
  date.setDate(date.getDate() - offset);
  return (
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}` +
    `${String(date.getDate()).padStart(2, "0")}`
  );
};
const night = (offset, minutes, extra = {}) => ({
  happenDay: key(offset),
  kind: "main",
  completeness: "complete",
  totalMinutes: minutes,
  score: 80,
  deepPercent: 20,
  lightPercent: 55,
  remPercent: 20,
  awakePercent: 5,
  awakeCountOverFiveMinutes: 1,
  sleepStart: "23:10",
  sleepEnd: "06:30",
  avgHr: 50,
  minHr: 44,
  ...extra
});

// --- A week with last night still syncing ---
// `getSleepHistory` hands records newest first; the table reads oldest first.
const week = formatSleepSummaryForChat(
  {
    records: [
      night(0, 400, { completeness: "partial" }),
      night(1, 420),
      night(2, 480),
      night(3, 450)
    ],
    mcpConnected: true,
    source: "cache"
  },
  7,
  today
);

assert.match(week, /Sleep, last 7 nights \(dated by wake-up day; 4 of 7 recorded\):/);
// Averages and the deficit are taken over settled nights only: a night still
// syncing reads as a short one and would put debt on the athlete that is not
// there. 420 + 480 + 450 over three nights, against 3 × 8 h.
assert.match(
  week,
  /- Average per settled night: 7h30 · score 80 · deep 20% · REM 20% · overnight HR 50 bpm/
);
assert.match(week, /- Net against 8 h a night over 3 settled nights: 1h30 short/);
assert.match(week, /Nights marked partial were still syncing/);
assert.doesNotMatch(week, /Last night is not in yet/);
assert.match(
  week,
  /Night \| Total \| Score \| Deep\/Light\/REM\/Awake % \| Wake-ups >5 min \| Window \| HR avg \(min\)\n/
);
assert.doesNotMatch(week, /\| Nap/, "no night had a nap, so no column of dashes");
assert.match(week, /09-11 Fri \| 6h40 \(partial\) \| 80 \| 20\/55\/20\/5 \| 1 \| 23:10–06:30 \| 50 \(44\)/);
assert.ok(week.indexOf("09-08 Tue") < week.indexOf("09-11 Fri"), "oldest night first");

// A surplus nets out as a surplus, not as a negative deficit.
assert.match(
  formatSleepSummaryForChat(
    { records: [night(0, 540), night(1, 540)], mcpConnected: true, source: "cache" },
    7,
    today
  ),
  /over 2 settled nights: 2h00 over/
);

// Stage shares fall back to minutes when COROS sent no percentages.
assert.match(
  formatSleepSummaryForChat(
    {
      records: [
        night(0, 480, {
          deepPercent: undefined,
          lightPercent: undefined,
          remPercent: undefined,
          awakePercent: undefined,
          deepMinutes: 96
        })
      ],
      mcpConnected: true,
      source: "cache"
    },
    7,
    today
  ),
  /\| 20\/—\/—\/— \|/
);

// --- The states that are not a week of sleep ---
assert.match(
  formatSleepSummaryForChat({ records: [], mcpConnected: false, source: "cache" }, 7, today),
  /COROS MCP is not connected/
);
assert.match(
  formatSleepSummaryForChat(
    { records: [], mcpConnected: true, source: "cache", error: "boom" },
    7,
    today
  ),
  /No sleep recorded in the last 7 nights\. The latest COROS fetch failed \(boom\)/
);
assert.match(
  formatSleepSummaryForChat(
    { records: [night(1, 450)], mcpConnected: true, source: "cache" },
    7,
    today
  ),
  /Last night is not in yet/
);

// --- A long window is rolled up by week, last seven nights kept ---
const month = formatSleepSummaryForChat(
  {
    records: Array.from({ length: 20 }, (_, offset) => night(offset, 450)),
    mcpConnected: true,
    source: "cache"
  },
  30,
  today
);
assert.match(month, /Weekly \(Mon–Sun, averages over settled nights\):/);
assert.match(month, /Week of \| Nights \| Avg total \| Avg score \| Deep % \| REM % \| HR avg/);
assert.match(month, /09-07 Mon \| 5 \| 7h30 \| 80 \| 20 \| 20 \| 50/);
assert.match(month, /Last 7 nights:\nNight \|/);
assert.equal(
  month.split("\n").filter((line) => /^\d\d-\d\d \w{3} \| 7h30 \|/.test(line)).length,
  7,
  "the nightly tail holds exactly seven nights"
);

// --- One night in depth ---
//
// The samples are summarised, not listed: a night carries around a hundred HRV
// points, and a coach reads the shape. COROS's own verdict is passed through
// rather than recomputed, so the app never invents a second opinion.
const point = (value, index) => ({
  at: index,
  localAt: index,
  clock: "01:00",
  value
});
const nightDetail = formatSleepNightForChat(key(1), night(1, 420), {
  happenDay: key(1),
  hrv: [50, 52, 55, 58, 60, 62, 64, 66, 68].map(point),
  stress: [20, 22, 25, 30].map(point),
  assessment: {
    happenDay: key(1),
    avg: 62,
    normalLow: 55,
    normalHigh: 70,
    baseline: 64,
    evaluation: "Balanced"
  },
  source: "cache",
  mcpConnected: true
});
assert.match(nightDetail, /^Sleep detail for 09-10 Thu \(wake-up day\):/);
// A single night reads once, so it is written the way it would be said rather
// than as a row of table cells.
assert.match(
  nightDetail,
  /- Night: 7h00 · score 80 · deep\/light\/REM\/awake 20\/55\/20\/5% · 1 wake-up >5 min · window 23:10–06:30 · HR 50 avg \(44 min\)/
);
assert.match(
  nightDetail,
  /- HRV through the night: average 59 · low 50 · high 68 · first third 52 → last third 66 \(9 samples\)/
);
assert.match(
  nightDetail,
  /- COROS HRV assessment: average 62 · normal range 55–70 · baseline 64 · Balanced/
);
assert.match(nightDetail, /- Stress while asleep: average 24 · peak 30 \(4 samples\)/);

// COROS keeps these samples about a week, so an older night legitimately has
// none — and saying so beats an empty answer that reads like a failure.
assert.match(
  formatSleepNightForChat(key(30), night(30, 450), {
    happenDay: key(30),
    hrv: [],
    stress: [],
    source: "cache",
    mcpConnected: true
  }),
  /COROS keeps them about a week/
);
assert.match(
  formatSleepNightForChat(key(1), undefined, {
    happenDay: key(1),
    hrv: [],
    stress: [],
    source: "cache",
    mcpConnected: false
  }),
  /- No sleep record for this night\.[\s\S]*COROS MCP is not connected/
);

// The window answer points at the detail, or nothing would ever ask for it.
assert.match(week, /night=YYYYMMDD/);

assert.equal(parseSleepNightArgument("2026-09-10"), "20260910");
assert.equal(parseSleepNightArgument(""), undefined);
assert.equal(parseSleepNightArgument(undefined), undefined);
assert.throws(() => parseSleepNightArgument("last tuesday"), /YYYYMMDD/);

assert.equal(parseSleepNights(undefined), 7);
assert.equal(parseSleepNights("14"), 14);
assert.equal(parseSleepNights(500), 90);
assert.equal(parseSleepNights(0), 7);

console.log("test-chat-sleep-tools: ok");
