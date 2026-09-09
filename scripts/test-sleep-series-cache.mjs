// The night-curve cache. Two COROS tools per night, both capped at a 7-day
// query window, so what this suite pins is which nights are still allowed to
// cost a request — and, above all, that a night with nothing to give is
// remembered as such once it is over.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  getSleepNightSeries,
  clearSleepSeriesCache,
  UNSETTLED_SERIES_TTL_MS,
  SERIES_RETENTION_DAYS
} = await import(`${distUrl("sleepSeriesService.js")}?cacheBust=${Date.now()}`);

const NOW = new Date(2026, 8, 9, 8, 30, 0).getTime(); // Wed 2026-09-09, 08:30

function dayKey(offsetDays) {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

/** UTC+7, the offset COROS encodes as timezone=28. */
function epochAt(happenDay, hours, minutes) {
  const year = Number(happenDay.slice(0, 4));
  const month = Number(happenDay.slice(4, 6));
  const day = Number(happenDay.slice(6, 8));
  return Math.floor(Date.UTC(year, month - 1, day, hours - 7, minutes) / 1000);
}

function hrvResponse(happenDay, samples) {
  return [
    "Sleep HRV — one day",
    "HRV Assessment — Last 1 days",
    "",
    `${happenDay.slice(0, 4)}-${happenDay.slice(4, 6)}-${happenDay.slice(6, 8)}:`,
    "  HRV Avg: 70 ms — Above normal",
    "  Normal Range: 56 - 66 ms",
    "  Baseline: 61 ms",
    "",
    "Sleep HRV Time Series — Last 1 days",
    "",
    ...samples.map(
      ([day, h, m, value]) =>
        `  timestamp=${epochAt(day, h, m)}, timezone=28, hrv=${value} ms, status=4`
    )
  ].join("\n");
}

function stressResponse(samples) {
  return [
    "Stress Time Series",
    "",
    ...samples.map(
      ([day, h, m, value]) =>
        `  timestamp=${epochAt(day, h, m)}, timezone=28, stress=${value}, score=1, stressHrv=0, stressHr=0`
    )
  ].join("\n");
}

function night(offsetDays, overrides = {}) {
  const happenDay = dayKey(offsetDays);
  return {
    happenDay,
    kind: "main",
    totalMinutes: 320,
    sleepStart: "00:40",
    sleepEnd: "06:00",
    sleepStartDay: happenDay,
    sleepEndDay: happenDay,
    ...overrides
  };
}

/** A fake main process: counted tool calls and an in-memory series table. */
function harness({
  now = NOW,
  nights = [],
  hrv = [],
  stress = [],
  connected = true,
  tools = ["querySleepHrv", "queryStressTimeSeries"],
  failTool = null
} = {}) {
  const state = {
    now,
    calls: [],
    table: new Map(),
    pruned: [],
    order: [],
    writes: 0
  };

  const deps = {
    now: () => state.now,
    ensureConnected: async () => connected,
    listTools: async () => {},
    toolNames: () => tools,
    callTool: async (name, args) => {
      state.calls.push({ name, args });
      if (failTool === name) {
        throw new Error(`${name} is down`);
      }
      return name === "querySleepHrv"
        ? hrvResponse(args.startDate, hrv)
        : stressResponse(stress);
    },
    findNight: async (happenDay) =>
      nights.find((record) => record.happenDay === happenDay),
    readCache: () => {
      state.order.push("read");
      return [...state.table.values()];
    },
    writeCache: (row) => {
      state.writes += 1;
      state.table.set(row.happen_day, row);
    },
    pruneCache: (beforeDay) => {
      state.order.push("prune");
      state.pruned.push(beforeDay);
      for (const [key] of state.table) {
        if (key < beforeDay) {
          state.table.delete(key);
        }
      }
    }
  };

  return { state, deps };
}

// --- A night with samples: fetched once, then free --------------------------

clearSleepSeriesCache();
{
  const day = dayKey(-1);
  const { state, deps } = harness({
    nights: [night(-1)],
    hrv: [
      [day, 0, 30, 55], // 00:30 — ten minutes before the window, dropped
      [day, 0, 44, 43],
      [day, 5, 54, 61],
      [day, 14, 0, 70] // the afternoon, dropped
    ],
    stress: [
      [day, 0, 39, 15],
      [day, 3, 0, 9],
      [day, 19, 0, 40] // the evening, dropped
    ]
  });

  const series = await getSleepNightSeries({ happenDay: day }, deps);
  assert.equal(state.calls.length, 2, "one call per tool, no more");
  assert.deepEqual(
    state.calls.map((call) => call.name),
    ["querySleepHrv", "queryStressTimeSeries"]
  );
  assert.deepEqual(
    state.calls[0].args,
    { startDate: day, endDate: day, days: 1 },
    "HRV is asked for by wake-up day, in yyyyMMdd"
  );

  assert.deepEqual(
    series.hrv.map((point) => point.clock),
    ["00:44", "05:54"],
    "samples outside the sleep window are clipped away"
  );
  assert.deepEqual(series.stress.map((point) => point.clock), ["00:39", "03:00"]);
  assert.equal(series.assessment?.avg, 70, "COROS's own verdict rides along");
  assert.equal(series.source, "network");
  assert.equal(series.error, undefined);
  assert.equal(state.writes, 1);
  assert.ok(
    state.pruned.length > 0 &&
      state.pruned.every((day) => day === dayKey(-SERIES_RETENTION_DAYS)),
    "every prune uses the retention boundary"
  );
  assert.equal(
    state.order[0],
    "prune",
    "the table is trimmed before it is read, so hydration is bounded even on a table an older install left behind"
  );

  state.calls.length = 0;
  const again = await getSleepNightSeries({ happenDay: day }, deps);
  assert.equal(state.calls.length, 0, "a night already slept is never re-asked");
  assert.equal(again.source, "cache");
  assert.equal(again.hrv.length, 2);
}

// --- A settled night with nothing to give is remembered as empty ------------
//
// COROS keeps these samples for about a week, so most nights in the list have
// none. Not caching that emptiness meant every click on an old night spent two
// calls to be told nothing again.

clearSleepSeriesCache();
{
  const { state, deps } = harness({ nights: [night(-30)], hrv: [], stress: [] });

  const first = await getSleepNightSeries({ happenDay: dayKey(-30) }, deps);
  assert.equal(state.calls.length, 2);
  assert.equal(first.hrv.length, 0);
  assert.equal(first.stress.length, 0);
  assert.equal(state.writes, 1, "the empty answer is written down");

  state.calls.length = 0;
  const second = await getSleepNightSeries({ happenDay: dayKey(-30) }, deps);
  assert.equal(state.calls.length, 0, "and never asked about again");
  assert.equal(second.source, "cache");
}

// --- Last night is the exception: empty there means "not synced yet" --------

clearSleepSeriesCache();
{
  const { state, deps } = harness({ nights: [night(0)], hrv: [], stress: [] });

  await getSleepNightSeries({ happenDay: dayKey(0) }, deps);
  assert.equal(state.writes, 0, "an empty answer for tonight is not final");

  state.calls.length = 0;
  await getSleepNightSeries({ happenDay: dayKey(0) }, deps);
  assert.equal(state.calls.length, 2, "so it is asked about again");
}

// --- Last night with samples still settles under the TTL --------------------

clearSleepSeriesCache();
{
  const day = dayKey(0);
  const { state, deps } = harness({
    nights: [night(0)],
    hrv: [[day, 1, 0, 50]],
    stress: [[day, 1, 0, 12]]
  });

  await getSleepNightSeries({ happenDay: day }, deps);
  assert.equal(state.writes, 1);

  state.calls.length = 0;
  await getSleepNightSeries({ happenDay: day }, deps);
  assert.equal(state.calls.length, 0, "inside the TTL the cache answers");

  state.now = NOW + UNSETTLED_SERIES_TTL_MS + 1;
  await getSleepNightSeries({ happenDay: day }, deps);
  assert.equal(state.calls.length, 2, "past it, tonight may have filled in");
}

// --- Refresh overrides every check -----------------------------------------

clearSleepSeriesCache();
{
  const day = dayKey(-2);
  const { state, deps } = harness({
    nights: [night(-2)],
    hrv: [[day, 1, 0, 50]],
    stress: [[day, 1, 0, 12]]
  });

  await getSleepNightSeries({ happenDay: day }, deps);
  state.calls.length = 0;

  await getSleepNightSeries({ happenDay: day }, deps);
  assert.equal(state.calls.length, 0);

  await getSleepNightSeries({ happenDay: day, refresh: true }, deps);
  assert.equal(state.calls.length, 2, "the Refresh button asks a settled night again");
}

// --- A night crossing midnight asks for both stress days -------------------
//
// Stress is filed by calendar day while sleep is filed by wake-up day, so the
// night of the 6th into the 7th lives in two blocks.

clearSleepSeriesCache();
{
  const wake = dayKey(-2);
  const bed = dayKey(-3);
  const { state, deps } = harness({
    nights: [
      night(-2, {
        sleepStart: "23:45",
        sleepEnd: "07:14",
        sleepStartDay: bed,
        sleepEndDay: wake
      })
    ],
    hrv: [[wake, 1, 0, 50]],
    stress: [
      [bed, 23, 50, 14],
      [wake, 6, 0, 11]
    ]
  });

  const series = await getSleepNightSeries({ happenDay: wake }, deps);
  const stressCall = state.calls.find((call) => call.name === "queryStressTimeSeries");
  assert.deepEqual(
    stressCall.args,
    { startDate: bed, endDate: wake, days: 2 },
    "both calendar days are asked for in one call"
  );
  assert.deepEqual(
    series.stress.map((point) => point.clock),
    ["23:50", "06:00"],
    "and the two blocks stitch into one night"
  );
}

// --- A record cached before the window dates existed still asks both days ---
//
// The inference and the stress query used to disagree: bounds worked out that
// the night began the evening before, while the query read the raw field, found
// nothing, and asked for one day — losing every pre-midnight sample.

clearSleepSeriesCache();
{
  const wake = dayKey(-2);
  const bed = dayKey(-3);
  const { state, deps } = harness({
    nights: [
      night(-2, {
        sleepStart: "23:45",
        sleepEnd: "07:14",
        sleepStartDay: undefined,
        sleepEndDay: undefined
      })
    ],
    hrv: [[wake, 1, 0, 50]],
    stress: [
      [bed, 23, 50, 14],
      [wake, 6, 0, 11]
    ]
  });

  const series = await getSleepNightSeries({ happenDay: wake }, deps);
  const stressCall = state.calls.find((call) => call.name === "queryStressTimeSeries");
  assert.deepEqual(
    stressCall.args,
    { startDate: bed, endDate: wake, days: 2 },
    "the day before is inferred for the query too, not just for the clipping"
  );
  assert.deepEqual(series.stress.map((point) => point.clock), ["23:50", "06:00"]);
}

// --- Degraded paths --------------------------------------------------------

clearSleepSeriesCache();
{
  const { state, deps } = harness({ nights: [], hrv: [], stress: [] });
  const series = await getSleepNightSeries({ happenDay: dayKey(-1) }, deps);
  assert.equal(state.calls.length, 0, "no night, nothing to ask about");
  assert.match(series.error ?? "", /no sleep record/i);
}

clearSleepSeriesCache();
{
  // No window means nothing can be placed on a clock, so nothing is drawn.
  const { state, deps } = harness({
    nights: [night(-1, { sleepStart: undefined, sleepEnd: undefined })],
    hrv: [[dayKey(-1), 1, 0, 50]],
    stress: [[dayKey(-1), 1, 0, 12]]
  });

  const series = await getSleepNightSeries({ happenDay: dayKey(-1) }, deps);
  assert.equal(series.hrv.length, 0);
  assert.equal(series.stress.length, 0);
  assert.match(series.error ?? "", /no sleep window/i);
  assert.equal(state.writes, 1, "a settled night with no window is still final");
}

clearSleepSeriesCache();
{
  // One tool down must not take the other's samples with it.
  const day = dayKey(-1);
  const { state, deps } = harness({
    nights: [night(-1)],
    stress: [[day, 1, 0, 12]],
    failTool: "querySleepHrv"
  });

  const series = await getSleepNightSeries({ happenDay: day }, deps);
  assert.equal(series.hrv.length, 0);
  assert.equal(series.stress.length, 1, "stress survives an HRV failure");
  assert.match(series.error ?? "", /sleep HRV/i);
  assert.equal(state.writes, 1);
}

clearSleepSeriesCache();
{
  const { state, deps } = harness({ nights: [night(-1)], connected: false });
  const series = await getSleepNightSeries({ happenDay: dayKey(-1) }, deps);
  assert.equal(state.calls.length, 0);
  assert.equal(series.mcpConnected, false);
  assert.equal(series.source, "cache", "an offline answer is not a network one");
}

clearSleepSeriesCache();
{
  // A server without the tools answers with nothing rather than throwing.
  const { state, deps } = harness({ nights: [night(-1)], tools: [] });
  const series = await getSleepNightSeries({ happenDay: dayKey(-1) }, deps);
  assert.equal(state.calls.length, 0);
  assert.equal(series.hrv.length, 0);
  assert.equal(series.stress.length, 0);
}

console.log("sleep series cache: all assertions passed");
