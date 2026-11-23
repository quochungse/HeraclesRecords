// The Stress level and Heart rate screens' data: the COROS MCP parsers and the day cache.
// What it pins is which days may still cost a request — a day is settled once
// it was read a whole day after it ended — and that a failed tool or a server
// that went away never empties what is already on file.
//
// Payloads are in COROS's shape (probed 2026-11-23) with made-up figures.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) => pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;
const bust = `?cacheBust=${Date.now()}`;

const parser = await import(`${distUrl("stressHeartParser.js")}${bust}`);
const service = await import(`${distUrl("stressHeartService.js")}${bust}`);

const NOW = new Date(2026, 10, 23, 11, 20, 0).getTime(); // Mon 2026-11-23, 11:20
const MINUTE = 60 * 1000;

function dayKey(offsetDays, from = NOW) {
  const date = new Date(from);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}
const iso = (key) => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;

// --- Parsers ----------------------------------------------------------------

const stressLevelText = JSON.stringify(
  "Stress Level — Last 3 days\n========================\n\n" +
    "2026-11-23:\nAverage Stress: 18\nRelaxed: 6h 10m (95%)\nLow: 15m (4%)\nMedium: 5m (1%)\nHigh: 0m (0%)\n\n" +
    "2026-11-22:\nAverage Stress: 33\nRelaxed: 9h (55%)\nLow: 4h 5m (25%)\nMedium: 2h 10m (13%)\nHigh: 1h 5m (7%)\n\n" +
    "2026-11-21:\nAverage Stress: 0\nRelaxed: 0m (0%)\nLow: 0m (0%)\nMedium: 0m (0%)\nHigh: 0m (0%)"
);
const levels = parser.parseStressLevels(stressLevelText);
assert.deepEqual(levels.get("20261123"), {
  stressAvg: 18,
  levels: { relaxed: 370, low: 15, medium: 5, high: 0 }
});
assert.deepEqual(levels.get("20261122")?.levels, { relaxed: 540, low: 245, medium: 130, high: 65 }, "an hour with no minutes");
assert.equal(levels.has("20261121"), false, "a day with nothing measured is no record");

const heartText =
  "Average Heart Rate — Last 2 days\n========================\n\n" +
  "2026-11-23: 58 bpm (Min: 47, Max: 75)\n2026-11-22: 0 bpm (Min: 0, Max: 0)";
const heart = parser.parseAverageHeartRates(heartText);
assert.deepEqual(heart.get("20261123"), { avgHr: 58, minHr: 47, maxHr: 75 });
assert.equal(heart.has("20261122"), false, "0 bpm is not a heart rate");

const resting = parser.parseRestingHeartRates(
  "Resting Heart Rate — Last 2 days\n========================\n\n2026-11-23: 53 bpm\n2026-11-22: 52 bpm"
);
assert.deepEqual([...resting], [["20261123", 53], ["20261122", 52]]);

// Readings stamped in UTC with COROS's offset (28 quarter-hours = UTC+7): a
// reading at 00:04 local sits in slot 0, one at 23:59 in the last.
const midnightUtc = Date.UTC(2026, 10, 22) - 7 * 3600 * 1000; // 2026-11-22 00:00 at UTC+7
const stamp = (minutes) => Math.round((midnightUtc + minutes * MINUTE) / 1000);
const seriesText =
  "Stress Time Series — 2026-11-22 to 2026-11-23\n========================\n\n" +
  "2026-11-22:\n" +
  `  timestamp=${stamp(4)}, timezone=28, stress=9, score=1, stressHrv=0, stressHr=0\n` +
  `  timestamp=${stamp(9)}, timezone=28, stress=-1, score=1, stressHrv=0, stressHr=0\n` +
  `  timestamp=${stamp(14)}, timezone=28, stress=80, score=4, stressHrv=0, stressHr=0\n` +
  `  timestamp=${stamp(1439)}, timezone=28, stress=21, score=1, stressHrv=0, stressHr=0\n\n` +
  "2026-11-23:\n" +
  `  timestamp=${stamp(1440 + 61)}, timezone=28, stress=40, score=2, stressHrv=0, stressHr=0`;
const series = parser.parseStressDaySeries(seriesText);
assert.deepEqual(series.map((day) => day.day), ["20261122", "20261123"]);
assert.equal(series[0].slots.length, parser.STRESS_SLOTS_PER_DAY);
assert.equal(series[0].slots[0], 9);
assert.equal(series[0].slots[1], null, "a negative reading is no reading");
assert.equal(series[0].slots[2], 80);
assert.equal(series[0].slots[287], 21);
assert.equal(series[1].slots[12], 40, "01:01 is the 01:00 slot of its own day");

assert.equal(parser.stressLevelOf(25), "relaxed");
assert.equal(parser.stressLevelOf(26), "low");
assert.equal(parser.stressLevelOf(75), "medium");
assert.equal(parser.stressLevelOf(76), "high");

// --- A fake main process ----------------------------------------------------

function dayResponses(days, { from = NOW } = {}) {
  const keys = Array.from({ length: days }, (_, index) => dayKey(-index, from));
  return {
    queryStressLevel:
      "Stress Level\n========================\n\n" +
      keys.map((key) => `${iso(key)}:\nAverage Stress: 30\nRelaxed: 8h (70%)\nLow: 2h (18%)\nMedium: 1h (9%)\nHigh: 20m (3%)`).join("\n\n"),
    queryAvgHeartRate:
      "Average Heart Rate\n========================\n\n" +
      keys.map((key) => `${iso(key)}: 70 bpm (Min: 48, Max: 140)`).join("\n"),
    queryRestingHeartRate:
      "Resting Heart Rate\n========================\n\n" + keys.map((key) => `${iso(key)}: 54 bpm`).join("\n")
  };
}

function harness({ historyDays = 20, connected = true, failing = [], tools } = {}) {
  service.clearStressHeartCache();
  const state = {
    now: NOW,
    calls: [],
    dayRows: new Map(),
    seriesRows: new Map(),
    historyDays
  };
  const deps = {
    now: () => state.now,
    ensureConnected: async () => connected,
    listTools: async () => {},
    toolNames: () => tools ?? ["queryStressLevel", "queryAvgHeartRate", "queryRestingHeartRate", "queryStressTimeSeries"],
    callTool: async (name, args) => {
      state.calls.push({ name, args });
      if (failing.includes(name)) throw new Error(`${name} failed`);
      if (name === "queryStressTimeSeries") {
        const days = [];
        for (let key = args.startDate; key <= args.endDate; key = dayKey(1, new Date(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8)).getTime())) {
          days.push(key);
        }
        return (
          "Stress Time Series\n========================\n\n" +
          days
            .filter((key) => key !== "20261120") // a day the watch was off
            .map((key) => {
              const midnight = new Date(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8)).getTime();
              const offset = -new Date(midnight).getTimezoneOffset() / 15;
              return `${iso(key)}:\n  timestamp=${Math.round((midnight + 60 * MINUTE) / 1000)}, timezone=${offset}, stress=30, score=2, stressHrv=0, stressHr=0`;
            })
            .join("\n\n")
        );
      }
      // The account has `historyDays` days; asking for more answers those.
      const answered = Math.min(args.days, state.historyDays);
      return dayResponses(answered, { from: state.now })[name];
    },
    readDays: () => [...state.dayRows.values()],
    writeDays: (rows) => rows.forEach((row) => state.dayRows.set(row.day, row)),
    readSeries: () => [...state.seriesRows.values()],
    writeSeries: (rows) => rows.forEach((row) => state.seriesRows.set(row.day, row)),
    pruneSeries: () => {},
    mcpState: () => (connected ? "ready" : "disconnected"),
    failureState: () => "unreachable"
  };
  return { state, deps };
}

// The first fill asks every tool once, for a year, and keeps only history.
{
  const { state, deps } = harness();
  const snapshot = await service.getStressHeartDays({}, deps);
  assert.deepEqual(state.calls.map((call) => call.name).sort(), ["queryAvgHeartRate", "queryRestingHeartRate", "queryStressLevel"]);
  assert.ok(state.calls.every((call) => call.args.days === service.FIRST_FILL_DAYS));
  assert.equal(snapshot.days.length, 20, "no empty days before the account's first");
  assert.equal(snapshot.days[0].day, dayKey(-19));
  assert.equal(snapshot.days.at(-1).day, dayKey(0));
  assert.deepEqual(snapshot.days.at(-1), {
    day: dayKey(0),
    stressAvg: 30,
    levels: { relaxed: 480, low: 120, medium: 60, high: 20 },
    avgHr: 70,
    minHr: 48,
    maxHr: 140,
    restingHr: 54
  });
  assert.equal(snapshot.source, "network");
  assert.equal(state.dayRows.size, 20);

  // Within the TTL: no request.
  state.now = NOW + 5 * MINUTE;
  state.calls = [];
  assert.equal((await service.getStressHeartDays({}, deps)).source, "cache");
  assert.equal(state.calls.length, 0);

  // Past it: only the days that may still change — yesterday and today were
  // read today, so both are asked again; nothing older.
  state.now = NOW + service.UNSETTLED_TTL_MS + MINUTE;
  await service.getStressHeartDays({}, deps);
  assert.ok(state.calls.length === 3 && state.calls.every((call) => call.args.days === 2));

  // Two days on, the fill starts at the oldest day not yet read a whole day
  // after it ended — Sunday, last read on Monday — and runs to today.
  state.now = NOW + 2 * 24 * 60 * MINUTE;
  state.calls = [];
  await service.getStressHeartDays({}, deps);
  assert.ok(state.calls.length === 3 && state.calls.every((call) => call.args.days === 4), `asked ${JSON.stringify(state.calls.map((c) => c.args))}`);

  // A fresh process reads the table and asks nothing within the TTL.
  service.clearStressHeartCache();
  state.calls = [];
  const reread = await service.getStressHeartDays({}, deps);
  assert.equal(state.calls.length, 0);
  assert.equal(reread.days.length, 22);
}

// A tool that fails keeps what was known; the others still land.
{
  const { state, deps } = harness();
  await service.getStressHeartDays({}, deps);
  state.now = NOW + service.UNSETTLED_TTL_MS + MINUTE;
  const fail = harness({ failing: ["queryRestingHeartRate"] });
  // Same table, failing resting HR.
  fail.state.dayRows = state.dayRows;
  fail.state.now = state.now;
  service.clearStressHeartCache();
  const snapshot = await service.getStressHeartDays({}, fail.deps);
  assert.equal(snapshot.days.at(-1).restingHr, 54, "resting HR kept from the cache");
  assert.match(snapshot.error ?? "", /queryRestingHeartRate failed/);
  assert.equal(snapshot.mcpState, "ready");
}

// A server that is not there: the cache stands, the state says why.
{
  const { state, deps } = harness();
  await service.getStressHeartDays({}, deps);
  const offline = harness({ connected: false });
  offline.state.dayRows = state.dayRows;
  offline.state.now = NOW + service.UNSETTLED_TTL_MS + MINUTE;
  service.clearStressHeartCache();
  const snapshot = await service.getStressHeartDays({}, offline.deps);
  assert.equal(snapshot.days.length, 20);
  assert.equal(snapshot.mcpState, "unreachable");
  assert.equal(offline.state.calls.length, 0);
}

// The series: one request per 7 days, a day with no block kept as empty, a
// settled day never asked again, today asked again past the TTL.
{
  const { state, deps } = harness();
  const answer = await service.getStressSeries({ fromDay: "20261110", toDay: "20261123" }, deps);
  assert.deepEqual(
    state.calls.map((call) => [call.args.startDate, call.args.endDate]),
    [["20261110", "20261116"], ["20261117", "20261123"]]
  );
  assert.equal(answer.days.length, 14);
  const off = answer.days.find((day) => day.day === "20261120");
  assert.ok(off && off.slots.every((slot) => slot === null), "an empty day is kept as empty");
  assert.equal(answer.days.find((day) => day.day === "20261115").slots[12], 30);

  state.calls = [];
  await service.getStressSeries({ fromDay: "20261110", toDay: "20261123" }, deps);
  assert.equal(state.calls.length, 0, "within the TTL nothing is asked");

  state.now = NOW + service.UNSETTLED_TTL_MS + MINUTE;
  await service.getStressSeries({ fromDay: "20261110", toDay: "20261123" }, deps);
  assert.deepEqual(
    state.calls.map((call) => [call.args.startDate, call.args.endDate]),
    [["20261122", "20261123"]],
    "only yesterday and today, read today, are asked again"
  );

  // A span past the cap is cut to its latest weeks; a future day is today.
  state.calls = [];
  const capped = await service.getStressSeries({ fromDay: "20260101", toDay: "20261230" }, deps);
  assert.equal(capped.days[0].day, dayKey(-(service.MAX_SERIES_SPAN_DAYS - 1), state.now));
  assert.equal(capped.days.at(-1).day, "20261123");
}

console.log("stress & heart tests passed");
