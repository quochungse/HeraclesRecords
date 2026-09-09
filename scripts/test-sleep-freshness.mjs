// The Sleep panel is the one card whose number nobody can sanity-check against
// anything else, so a night COROS returned days ago must never appear under it.
// These assertions fail against the pre-fix code, where the panel read
// `sleep.latest` straight out of the summary.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(
  path.join(repoRoot, "src", "sleep", "sleepFreshness.ts")
);

const { isLastNightHappenDay, pickLastNightSleep } = await import(
  `${moduleUrl.href}?cacheBust=${Date.now()}`
);

const NOW = new Date(2026, 8, 9, 8, 30, 0); // Wed 2026-09-09, 08:30 local

function dayKey(offsetDays = 0) {
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
    score: 80,
    totalMinutes: 430,
    ...extra
  };
}

// --- isLastNightHappenDay ---------------------------------------------------

// COROS stamps a night with the morning it ended, so last night is today's key
// and nothing else. Yesterday's key is the night before last — the very reading
// the athlete reported as stale.
assert.equal(isLastNightHappenDay(dayKey(0), NOW), true, "today counts");
assert.equal(isLastNightHappenDay(dayKey(-1), NOW), false, "yesterday is the night before last");
assert.equal(isLastNightHappenDay(dayKey(-2), NOW), false, "two nights ago does not");
assert.equal(isLastNightHappenDay(dayKey(-6), NOW), false, "last week does not");
assert.equal(isLastNightHappenDay(dayKey(1), NOW), false, "tomorrow does not");
assert.equal(isLastNightHappenDay("", NOW), false, "empty key does not");
assert.equal(isLastNightHappenDay("2026-09-09", NOW), false, "ISO shape is not a day key");

// The key is the local date, so month and year boundaries fall where the
// calendar puts them rather than where arithmetic on the day number would.
assert.equal(
  isLastNightHappenDay("20260901", new Date(2026, 8, 1, 7, 0, 0)),
  true,
  "the first of a month counts on that day"
);
assert.equal(
  isLastNightHappenDay("20260831", new Date(2026, 8, 1, 7, 0, 0)),
  false,
  "the last of the previous month does not"
);
assert.equal(
  isLastNightHappenDay("20260101", new Date(2026, 0, 1, 7, 0, 0)),
  true,
  "new year's day counts on that day"
);
assert.equal(
  isLastNightHappenDay("20251231", new Date(2026, 0, 1, 7, 0, 0)),
  false,
  "new year's eve does not"
);

// --- pickLastNightSleep -----------------------------------------------------

assert.equal(pickLastNightSleep(null, { now: NOW }), undefined, "no summary, no night");
assert.equal(
  pickLastNightSleep({ records: [], mcpConnected: true }, { now: NOW }),
  undefined,
  "no records, no night"
);

// This is the bug: a watch last synced on Sunday still answers, and the panel
// hung Sunday's score under a heading the athlete reads as this morning's.
const stale = {
  mcpConnected: true,
  latest: night(-4),
  records: [night(-4), night(-5)]
};
assert.equal(
  pickLastNightSleep(stale, { now: NOW }),
  undefined,
  "a four-day-old night is not last night"
);

// A watch that last synced yesterday morning holds the night before last, and
// that is the reading the athlete saw on the panel dated "Tue, Sep 8".
const yesterdayOnly = {
  mcpConnected: true,
  latest: night(-1),
  records: [night(-1), night(-2)]
};
assert.equal(
  pickLastNightSleep(yesterdayOnly, { now: NOW }),
  undefined,
  "the night before last is not last night"
);

const fresh = {
  mcpConnected: true,
  latest: night(0),
  records: [night(0), night(-1), night(-4)]
};
assert.equal(
  pickLastNightSleep(fresh, { now: NOW })?.happenDay,
  dayKey(0),
  "today's night is taken from latest"
);

// `latest` is the main process's pick for the newest day; when it does not
// qualify — an implausible main sleep can lose the sort — the records are
// scanned for one that does.
const staleLatest = {
  mcpConnected: true,
  latest: night(-3),
  records: [night(-3), night(0), night(-2)]
};
assert.equal(
  pickLastNightSleep(staleLatest, { now: NOW })?.happenDay,
  dayKey(0),
  "falls back to the qualifying record in the list"
);

// Naps are never last night's sleep.
const napOnly = {
  mcpConnected: true,
  latest: undefined,
  records: [{ ...night(0), kind: "nap" }]
};
assert.equal(
  pickLastNightSleep(napOnly, { now: NOW }),
  undefined,
  "a nap is not the night"
);

// The panel shows partial nights (it has copy for them); the greeting states
// totals as fact and must not.
const partial = {
  mcpConnected: true,
  latest: night(0, { completeness: "partial", partialReason: "still syncing" }),
  records: []
};
assert.equal(
  pickLastNightSleep(partial, { now: NOW })?.completeness,
  "partial",
  "the panel keeps a partial night"
);
assert.equal(
  pickLastNightSleep(partial, { now: NOW, excludePartial: true }),
  undefined,
  "the greeting drops a partial night"
);

console.log("sleep freshness: all assertions passed");
