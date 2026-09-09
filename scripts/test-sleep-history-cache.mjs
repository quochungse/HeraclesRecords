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
  heartRateFails = false
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
    }
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

console.log("sleep history cache: all assertions passed");
