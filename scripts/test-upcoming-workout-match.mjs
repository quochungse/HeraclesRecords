/**
 * Overview's upcoming rows open the calendar's workout detail, which needs the
 * scheduled entry — plan ids and `rawProgram` — that the upcoming shape drops.
 * This drives the matcher that finds a clicked row again in a scheduled fetch.
 *
 * Run through Electron (`ELECTRON_RUN_AS_NODE=1 electron
 * --experimental-strip-types`): this machine's Node is built without Amaro, so
 * plain `node --experimental-strip-types` fails with ERR_NO_TYPESCRIPT.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "upcomingWorkoutMatch.ts")
);

const { matchScheduledEntry, scheduledEntryFromUpcoming } = await import(
  `${moduleUrl.href}?cacheBust=${Date.now()}`
);

function scheduled(overrides) {
  return {
    planId: "plan-1",
    idInPlan: "id-1",
    planProgramId: "prog-1",
    happenDay: "20260912",
    name: "Interval 6x800",
    sortNo: 0,
    rawProgram: { exercises: [] },
    ...overrides
  };
}

// 1. A day the fetch answered with one entry is that entry, name or not: the two
//    lists are parsed from the same schedule/query response.
assert.equal(
  matchScheduledEntry([scheduled({})], {
    happenDay: "20260912",
    name: "Interval 6x800",
    sortNo: 0
  })?.idInPlan,
  "id-1"
);
assert.equal(
  matchScheduledEntry([scheduled({ name: "Renamed since" })], {
    happenDay: "20260912",
    name: "Interval 6x800",
    sortNo: 0
  })?.idInPlan,
  "id-1"
);

// 2. Entries on other days never match.
assert.equal(
  matchScheduledEntry([scheduled({ happenDay: "20260913" })], {
    happenDay: "20260912",
    name: "Interval 6x800",
    sortNo: 0
  }),
  undefined
);

// 3. Two workouts on one day separate by sortNo + name.
const twoOnOneDay = [
  scheduled({ idInPlan: "morning", name: "Easy 5k", sortNo: 0 }),
  scheduled({ idInPlan: "evening", name: "Interval 6x800", sortNo: 1 })
];
assert.equal(
  matchScheduledEntry(twoOnOneDay, {
    happenDay: "20260912",
    name: "Interval 6x800",
    sortNo: 1
  })?.idInPlan,
  "evening"
);

// 3b. Same name twice on a day: sortNo is what separates them.
const sameName = [
  scheduled({ idInPlan: "first", name: "Easy 5k", sortNo: 0 }),
  scheduled({ idInPlan: "second", name: "Easy 5k", sortNo: 1 })
];
assert.equal(
  matchScheduledEntry(sameName, {
    happenDay: "20260912",
    name: "Easy 5k",
    sortNo: 1
  })?.idInPlan,
  "second"
);

// 3c. Same sortNo twice (COROS merges a plan with the ad-hoc schedule plan, and
//     the orders restart): the name is what separates them.
const sameSortNo = [
  scheduled({ idInPlan: "plan", name: "Easy 5k", sortNo: 0 }),
  scheduled({ idInPlan: "adhoc", name: "Strength A", sortNo: 0 })
];
assert.equal(
  matchScheduledEntry(sameSortNo, {
    happenDay: "20260912",
    name: "Strength A",
    sortNo: 0
  })?.idInPlan,
  "adhoc"
);

// 4. Nothing confident on a crowded day gives up rather than guessing — the
//    caller falls back to the row's own parsed structure, which is at least the
//    workout the athlete clicked.
assert.equal(
  matchScheduledEntry(sameSortNo, {
    happenDay: "20260912",
    name: "Tempo 8k",
    sortNo: 0
  }),
  undefined
);

// 5. The fallback entry carries the row's own fields and no plan identity, so
//    nothing can mistake it for something a schedule mutation could act on.
const fallback = scheduledEntryFromUpcoming({
  happenDay: "20260912",
  name: "Interval 6x800",
  volume: "12.00km",
  trainingLoad: 88,
  sportType: 100,
  sortNo: 2,
  exercises: [{ name: "Warm up" }]
});
assert.equal(fallback.planId, "");
assert.equal(fallback.idInPlan, "");
assert.equal(fallback.planProgramId, "");
assert.equal(fallback.rawProgram, undefined);
assert.equal(fallback.name, "Interval 6x800");
assert.equal(fallback.volume, "12.00km");
assert.equal(fallback.trainingLoad, 88);
assert.equal(fallback.sportType, 100);
assert.deepEqual(fallback.exercises, [{ name: "Warm up" }]);

console.log("upcoming workout match: all assertions passed");
