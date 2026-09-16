// The Sleep screen's cache. One COROS sleep fetch is ~20 sequential MCP round
// trips, so what this suite pins is not "does it cache" but *which nights are
// still allowed to cost one*: a night already slept never is, last night is
// until it settles, and a failed fill must never empty the screen.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  getSleepHistory,
  clearSleepHistoryCache,
  UNSETTLED_NIGHT_TTL_MS
} = await import(`${distUrl("sleepHistoryService.js")}?cacheBust=${Date.now()}`);

const NOW = new Date(2026, 8, 9, 8, 30, 0).getTime(); // Wed 2026-09-09, 08:30

function dayKey(offsetDays) {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function night(offsetDays, extra = {}) {
  return {
    happenDay: dayKey(offsetDays),
    kind: "main",
    completeness: "complete",
    score: 78,
    totalMinutes: 430,
    deepMinutes: 90,
    lightMinutes: 250,
    remMinutes: 60,
    awakeMinutes: 30,
    windowMinutes: 460,
    ...extra
  };
}

/** A fake main process: an in-memory table plus a counted COROS. */
function harness({
  now = NOW,
  records = [],
  rows = [],
  fail = false,
  heartRate = [],
  heartRateFails = false,
  mcpUsable = true
} = {}) {
  const state = {
    now,
    table: new Map(rows.map((row) => [`${row.happen_day}:${row.kind}`, row])),
    fetches: 0,
    heartRateFetches: 0,
    writes: 0,
    records
  };

  const deps = {
    now: () => state.now,
    fetchFromCoros: async () => {
      state.fetches += 1;
      if (fail) {
        throw new Error("COROS is unreachable");
      }
      return { records: state.records, mcpConnected: true };
    },
    fetchHeartRate: async () => {
      state.heartRateFetches += 1;
      if (heartRateFails) {
        throw new Error("daily health is down");
      }
      return heartRate;
    },
    readCache: (fromDay) =>
      [...state.table.values()]
        .filter((row) => row.happen_day >= fromDay)
        .sort((left, right) => right.happen_day.localeCompare(left.happen_day)),
    writeCache: (batch) => {
      state.writes += 1;
      for (const row of batch) {
        state.table.set(`${row.happen_day}:${row.kind}`, row);
      }
    },
    pruneCache: (beforeDay) => {
      for (const [key, row] of state.table) {
        if (row.happen_day < beforeDay) {
          state.table.delete(key);
        }
      }
    },
    mcpUsable: () => mcpUsable
  };

  return { state, deps };
}

function rowFor(record, fetchedAt) {
  return {
    happen_day: record.happenDay,
    kind: record.kind ?? "main",
    payload: JSON.stringify(record),
    fetched_at: fetchedAt
  };
}

// --- An empty machine fetches once and keeps the answer ---------------------

clearSleepHistoryCache();
{
  const { state, deps } = harness({ records: [night(0), night(-1), night(-2)] });

  const first = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1, "an empty cache asks COROS");
  assert.equal(first.records.length, 3);
  assert.equal(first.records[0].happenDay, dayKey(0), "newest night first");
  assert.equal(first.latest?.happenDay, dayKey(0), "last night is today's key");
  assert.equal(first.source, "network");
  assert.equal(state.writes, 1, "what came back was written down");

  const second = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1, "the second visit costs no request");
  assert.equal(second.source, "cache");
  assert.equal(second.records.length, 3);
}

// --- Last night settles; a night already slept never asks again -------------

clearSleepHistoryCache();
{
  // Cached an hour ago: past nights are finished, but last night is not.
  const cachedAt = NOW - 60 * 60 * 1000;
  const { state, deps } = harness({
    records: [night(0), night(-1)],
    rows: [rowFor(night(0), cachedAt), rowFor(night(-1), cachedAt)]
  });

  await getSleepHistory({ days: 30 }, deps);
  assert.equal(
    state.fetches,
    1,
    "last night is older than the TTL, so it is asked about again"
  );
}

clearSleepHistoryCache();
{
  const cachedAt = NOW - Math.floor(UNSETTLED_NIGHT_TTL_MS / 2);
  const { state, deps } = harness({
    records: [night(0)],
    rows: [rowFor(night(0), cachedAt), rowFor(night(-1), cachedAt)]
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 0, "inside the TTL nothing is asked");
  assert.equal(snapshot.records.length, 2, "and the cache still answers in full");
  assert.equal(snapshot.source, "cache");
}

clearSleepHistoryCache();
{
  // Only old nights on file and none for last night: that gap is worth a fetch
  // however fresh the rest is, or a morning would never fill in.
  const { state, deps } = harness({
    records: [night(0)],
    rows: [rowFor(night(-1), NOW), rowFor(night(-2), NOW)]
  });

  await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1, "a missing last night is always worth asking");
}

// --- An empty answer for last night is not a reason to keep asking ----------
//
// COROS has nothing for last night until the watch syncs, which is most of a
// morning. Treating the gap as "always worth a fetch" turned every caller —
// the Overview panel, the Sleep screen, the night-series lookup — into a
// poller that re-spent the whole fetch on each call.

clearSleepHistoryCache();
{
  const { state, deps } = harness({ records: [night(-1), night(-2)] });

  await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1, "the first ask goes out");

  await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1, "the second does not, though last night is still missing");

  state.now = NOW + UNSETTLED_NIGHT_TTL_MS + 1;
  await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 2, "past the TTL it is worth asking again");
}

// --- A partial night keeps asking until it fills in -------------------------

clearSleepHistoryCache();
{
  const stale = NOW - UNSETTLED_NIGHT_TTL_MS - 1;
  const partial = night(-3, { completeness: "partial", partialReason: "syncing" });
  const { state, deps } = harness({
    records: [night(-3)],
    rows: [rowFor(night(0), NOW), rowFor(partial, stale)]
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1, "a stale partial night is asked about again");
  assert.equal(
    snapshot.records.find((record) => record.happenDay === dayKey(-3))?.completeness,
    "complete",
    "and the complete answer replaces it"
  );
}

// --- Refresh overrides every freshness check --------------------------------

clearSleepHistoryCache();
{
  const { state, deps } = harness({
    records: [night(0)],
    rows: [rowFor(night(0), NOW)]
  });

  await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 0, "nothing to do");

  await getSleepHistory({ days: 30, refresh: true }, deps);
  assert.equal(state.fetches, 1, "the Refresh button always asks");
}

// --- A failed fill leaves the cache standing --------------------------------

clearSleepHistoryCache();
{
  const { state, deps } = harness({
    rows: [rowFor(night(-1), NOW), rowFor(night(-2), NOW)],
    fail: true
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1);
  assert.equal(snapshot.records.length, 2, "the screen still has its nights");
  assert.match(snapshot.error ?? "", /unreachable/i, "and says why nothing new came");
  assert.equal(snapshot.latest, undefined, "with no last night to show");
}

// --- The window is a window -------------------------------------------------

clearSleepHistoryCache();
{
  const { state, deps } = harness({
    records: [],
    rows: [
      rowFor(night(0), NOW),
      rowFor(night(-6), NOW),
      rowFor(night(-40), NOW)
    ]
  });

  const week = await getSleepHistory({ days: 7 }, deps);
  assert.deepEqual(
    week.records.map((record) => record.happenDay),
    [dayKey(0), dayKey(-6)],
    "only nights inside the asked-for window come back"
  );
  assert.equal(state.fetches, 0, "and a covered window costs nothing");
}

// --- Naps are folded away, not listed as nights -----------------------------

clearSleepHistoryCache();
{
  const nap = { happenDay: dayKey(0), kind: "nap", totalMinutes: 40 };
  const { state, deps } = harness({ records: [night(0), nap] });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1);
  assert.deepEqual(
    snapshot.records.map((record) => record.kind ?? "main"),
    ["main"],
    "a nap is not a night in the list"
  );
  assert.equal(
    snapshot.records[0].napMinutes,
    40,
    "it is folded onto the day it belongs to instead"
  );
}

// --- A day of nothing but naps is still a day -------------------------------
//
// COROS reports such a day with its naps and no main sleep at all. Dropping
// every record that was not a main sleep dropped the day with it: it was
// missing from the list, from the trend and from every average over the window,
// with nothing anywhere saying a day had gone.

clearSleepHistoryCache();
{
  const napOnly = {
    happenDay: dayKey(-1),
    kind: "nap-only",
    completeness: "complete",
    napMinutes: 278,
    napWindows: [
      { start: "00:19", end: "02:20" },
      { start: "05:05", end: "07:42" }
    ]
  };
  const { deps } = harness({ records: [night(0), napOnly, night(-2)] });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  assert.deepEqual(
    snapshot.records.map((record) => record.happenDay),
    [dayKey(0), dayKey(-1), dayKey(-2)],
    "the nap-only day sits in the run of days, in its own place"
  );
  assert.equal(snapshot.records[1].napMinutes, 278);
  assert.equal(snapshot.records[1].totalMinutes, undefined);
}

// --- One day is one record, however many rows the table holds for it --------
//
// `sleep_nights` is keyed `<day>:<kind>`, so a day first seen while only its
// naps had synced keeps that row for good once the main sleep lands under
// another. Two rows for one date would draw the day twice in the list and put
// two bars under one label in the trend.

clearSleepHistoryCache();
{
  const day = dayKey(-3);
  const { deps } = harness({
    rows: [
      {
        happen_day: day,
        kind: "nap-only",
        payload: JSON.stringify({
          happenDay: day,
          kind: "nap-only",
          completeness: "complete",
          napMinutes: 95,
          napWindows: [{ start: "13:00", end: "14:35" }]
        }),
        fetched_at: NOW - 60 * 60 * 1000
      },
      {
        happen_day: day,
        kind: "main",
        payload: JSON.stringify(night(-3, { napMinutes: 95 })),
        fetched_at: NOW - 30 * 60 * 1000
      }
    ],
    records: [night(0)]
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  const forDay = snapshot.records.filter((record) => record.happenDay === day);
  assert.equal(forDay.length, 1, "one record for the day, not one per row");
  assert.equal(forDay[0].kind, "main", "the main sleep is the one that stands");
  assert.equal(forDay[0].totalMinutes, 430);
  assert.equal(forDay[0].napMinutes, 95, "and the day keeps its naps");
}

// A main sleep that says the day had no naps has answered. COROS puts the
// day's `Naps Total` on the main block too, so a nap-only row left over from
// before the night synced is the older answer — and picking up its clocks
// while keeping the zero would have the day contradict itself.

clearSleepHistoryCache();
{
  const day = dayKey(-4);
  const { deps } = harness({
    rows: [
      {
        happen_day: day,
        kind: "nap-only",
        payload: JSON.stringify({
          happenDay: day,
          kind: "nap-only",
          completeness: "complete",
          napMinutes: 140,
          napWindows: [{ start: "05:05", end: "07:25" }]
        }),
        fetched_at: NOW - 60 * 60 * 1000
      },
      {
        happen_day: day,
        kind: "main",
        payload: JSON.stringify(night(-4, { napMinutes: 0 })),
        fetched_at: NOW - 30 * 60 * 1000
      }
    ],
    records: [night(0)]
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  const folded = snapshot.records.find((record) => record.happenDay === day);
  assert.equal(folded.napMinutes, 0, "the main sleep's own answer stands");
  assert.equal(folded.napWindows, undefined, "and no clocks arrive without it");
}

// --- A day whose night arrived late costs one fetch, not one per call -------
//
// `sleep_nights` is keyed `<day>:<kind>`, so the `nap-only` row a day was first
// seen as is never written again once the main sleep lands under another key.
// Asking that row whether it is stale answers yes forever — and every answer
// spent a full COROS fetch, on every Overview load, for the rest of the day.

clearSleepHistoryCache();
{
  const day = dayKey(-1);
  const { state, deps } = harness({
    rows: [
      {
        happen_day: day,
        kind: "nap-only",
        payload: JSON.stringify({
          happenDay: day,
          kind: "nap-only",
          completeness: "complete",
          napMinutes: 278
        }),
        // Old enough that the nap-only grace would call it stale on its own.
        fetched_at: NOW - 3 * UNSETTLED_NIGHT_TTL_MS
      },
      {
        happen_day: day,
        kind: "main",
        payload: JSON.stringify(night(-1)),
        fetched_at: NOW
      },
      {
        happen_day: dayKey(0),
        kind: "main",
        payload: JSON.stringify(night(0)),
        fetched_at: NOW
      }
    ],
    records: [night(0)]
  });

  for (let call = 0; call < 4; call += 1) {
    await getSleepHistory({ days: 30 }, deps);
  }

  assert.equal(
    state.fetches,
    0,
    "freshness is asked of the day, whose newest row is the one that answered"
  );
}

// --- The row a day was first seen as does not lend its naps to the night ----
//
// A `nap-only` row beside a `main` one is not a component of the day — it is
// what COROS said before the night synced. Lending from it put those minutes
// on top of the main sleep, and a 7h10 night that had first arrived as 4h38 of
// naps totalled 11h48 on the list, the trend, the greeting and the coach's
// table. A main block COROS writes no `Naps` line on is the shape that reaches
// it, because then `napMinutes` is absent rather than zero.

clearSleepHistoryCache();
{
  const day = dayKey(-1);
  const { deps } = harness({
    rows: [
      {
        happen_day: day,
        kind: "nap-only",
        payload: JSON.stringify({
          happenDay: day,
          kind: "nap-only",
          completeness: "complete",
          napMinutes: 278,
          napWindows: [{ start: "00:19", end: "02:20" }]
        }),
        fetched_at: NOW - 3 * 60 * 60 * 1000
      },
      {
        happen_day: day,
        kind: "main",
        payload: JSON.stringify(night(-1, { napMinutes: undefined })),
        fetched_at: NOW - 60 * 60 * 1000
      }
    ],
    records: [night(0)]
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  const folded = snapshot.records.find((record) => record.happenDay === day);
  assert.equal(folded.kind, "main");
  assert.equal(folded.totalMinutes, 430);
  assert.equal(folded.napMinutes, undefined, "the superseded row lends nothing");
  assert.equal(folded.napWindows, undefined);
}

// A real nap component row still lends, which is the case the rule is for.

clearSleepHistoryCache();
{
  const day = dayKey(-2);
  const { deps } = harness({
    rows: [
      {
        happen_day: day,
        kind: "main",
        payload: JSON.stringify(night(-2, { napMinutes: undefined })),
        fetched_at: NOW
      },
      {
        happen_day: day,
        kind: "nap",
        payload: JSON.stringify({
          happenDay: day,
          kind: "nap",
          totalMinutes: 45,
          sleepStart: "13:00",
          sleepEnd: "13:45"
        }),
        fetched_at: NOW
      }
    ],
    records: [night(0)]
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  const folded = snapshot.records.find((record) => record.happenDay === day);
  assert.equal(folded.napMinutes, 45, "a nap of the day is part of the day");
  assert.deepEqual(folded.napWindows, [
    { start: "13:00", end: "13:45", startDay: undefined, endDay: undefined }
  ]);
}

// --- A nap-only day is asked about again while a night could still land -----

clearSleepHistoryCache();
{
  const { state, deps } = harness({
    rows: [
      {
        happen_day: dayKey(-1),
        kind: "nap-only",
        payload: JSON.stringify({
          happenDay: dayKey(-1),
          kind: "nap-only",
          completeness: "complete",
          napMinutes: 60
        }),
        fetched_at: NOW - 2 * UNSETTLED_NIGHT_TTL_MS
      },
      {
        happen_day: dayKey(0),
        kind: "main",
        payload: JSON.stringify(night(0)),
        fetched_at: NOW
      }
    ],
    records: [night(0)]
  });

  await getSleepHistory({ days: 30 }, deps);
  assert.equal(
    state.fetches,
    1,
    "yesterday having only naps on it is worth one more ask"
  );
}

clearSleepHistoryCache();
{
  const { state, deps } = harness({
    rows: [
      {
        happen_day: dayKey(-9),
        kind: "nap-only",
        payload: JSON.stringify({
          happenDay: dayKey(-9),
          kind: "nap-only",
          completeness: "complete",
          napMinutes: 60
        }),
        fetched_at: NOW - 2 * UNSETTLED_NIGHT_TTL_MS
      },
      {
        happen_day: dayKey(0),
        kind: "main",
        payload: JSON.stringify(night(0)),
        fetched_at: NOW
      }
    ],
    records: [night(0)]
  });

  await getSleepHistory({ days: 30 }, deps);
  assert.equal(
    state.fetches,
    0,
    "a nap-only day a week back is what it says it is, and costs nothing"
  );
}

// --- The night's heart rate rides in from the daily-health feed -------------
//
// querySleepData sends no heart rate at all. COROS puts the night's average and
// range in queryDailyHealthData instead, dated by the same wake-up day, which
// is what makes folding it onto the night safe.

clearSleepHistoryCache();
{
  const { state, deps } = harness({
    records: [night(0), night(-1)],
    heartRate: [
      { happenDay: dayKey(0), sleepAvgHr: 50, sleepMinHr: 44, sleepMaxHr: 71 },
      { happenDay: dayKey(-5), sleepAvgHr: 61 }
    ]
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.heartRateFetches, 1, "asked once, alongside the nights");

  const lastNight = snapshot.records.find((record) => record.happenDay === dayKey(0));
  assert.equal(lastNight?.avgHr, 50);
  assert.equal(lastNight?.minHr, 44);
  assert.equal(lastNight?.maxHr, 71);

  const older = snapshot.records.find((record) => record.happenDay === dayKey(-1));
  assert.equal(older?.avgHr, undefined, "a night with no heart rate keeps none");

  // Cached with the night, so the second visit still has it.
  clearSleepHistoryCache();
  const reread = await getSleepHistory({ days: 30 }, deps);
  assert.equal(
    reread.records.find((record) => record.happenDay === dayKey(0))?.avgHr,
    50,
    "the heart rate was written down with the night, not held in memory only"
  );
}

clearSleepHistoryCache();
{
  // Heart rate is one line on a card; the nights are the card.
  const { state, deps } = harness({
    records: [night(0)],
    heartRateFails: true
  });

  const snapshot = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.heartRateFetches, 1);
  assert.equal(snapshot.records.length, 1, "a failed heart-rate call costs no nights");
  assert.equal(snapshot.records[0].avgHr, undefined);
  assert.equal(snapshot.error, undefined, "and is not reported as a failure of the screen");
}

clearSleepHistoryCache();
{
  // A cache hit asks COROS nothing, and used to report a flat `true` for it.
  const { state, deps } = harness({ records: [night(0)] });

  const filled = await getSleepHistory({ days: 30 }, deps);
  assert.equal(state.fetches, 1);
  assert.equal(filled.mcpConnected, true, "a live fetch reports what it found");

  // Same process, same cache: the nights are in memory, so this read is free.
  const gone = harness({ rows: [], mcpUsable: false });
  const cached = await getSleepHistory({ days: 30 }, gone.deps);
  assert.equal(gone.state.fetches, 0, "the window was fresh, so nothing was fetched");
  assert.equal(
    cached.mcpConnected,
    false,
    "a cache hit reports the server as it is now, not as it was when fetched"
  );
  assert.ok(cached.records.length > 0, "and still serves the nights it holds");
}

console.log("sleep history cache: all assertions passed");
