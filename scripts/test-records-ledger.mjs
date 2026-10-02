// The Hall of Records' memory — `athlete_milestones` and recordsLedger.ts.
//
// Almost every milestone is worked out again on each launch from the activity
// list. This table holds the rest: milestones whose source forgets them
// (VO2max past COROS's year, nights past what a machine kept, plan runs gone
// from the cache). Three things are held down here, and none fails loudly:
//
//  1. **The earliest day wins.** A fact reached in March and seen again in May
//     was reached in March; a later sighting must not move it, and a sighting
//     that moves nothing must not go out to sync as a change.
//  2. **The renderer writes only its own kinds.** VO2max and sleep come from
//     the window; a plan run is worked out here, from the cache and the
//     matches, and a window cannot claim one.
//  3. **A plan run earns a milestone only when finished, long and kept.**
//     COROS's `finished` (never `stopped`, a run taken off early), four weeks
//     or more, 80% of what settled — dated at its last session. Its reading
//     moves on as the matches settle, and never back.
//  4. **The other machine's copy is merged by the same rule**, not by who wrote
//     last, so a machine with a shorter memory cannot move a day forward.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-records-ledger-"));
const database = await import(distUrl("database.js"));
const ledger = await import(distUrl("recordsLedger.js"));
const mergers = await import(distUrl("sync/rowMergers.js"));
const policy = await import(distUrl("sync/syncPolicy.js"));
const bridge = await import(distUrl("sync/syncBridge.js"));

database.initializeDatabase(tempRoot);
process.on("exit", () => {
  try {
    database.closeDatabase();
  } catch {
    // Already closed.
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

assert.equal(
  policy.TABLE_POLICY.athlete_milestones,
  "personal",
  "the memory follows the athlete to the other machine"
);

// --- 1. The earliest day wins -------------------------------------------------

// A sink that records what reaches sync, so "moves nothing" can be checked
// against what actually went out rather than against a count.
const announced = [];
let clock = 0;
bridge.attachSyncSink({
  enqueue: (entries) => {
    for (const entry of entries) announced.push(JSON.stringify(entry));
  },
  nextHlc: () => `hlc-${String((clock += 1)).padStart(6, "0")}`
});
const outgoing = () => announced.filter((entry) => entry.includes("athlete_milestones")).length;

const written = ledger.rememberMilestones([
  { id: "vo2max:high:48", kind: "vo2max", day: "20260512", data: { value: 48.2 } },
  { id: "sleep:streak:7", kind: "sleep", day: "20260801", data: { nights: 7 } }
]);
assert.equal(written, 2);

assert.equal(
  ledger.rememberMilestones([
    { id: "vo2max:high:48", kind: "vo2max", day: "20260601", data: { value: 48.9 } }
  ]),
  0,
  "seen again later, a milestone keeps the day it was first reached"
);
const sentBefore = outgoing();
assert.equal(
  ledger.rememberMilestones([
    { id: "vo2max:high:48", kind: "vo2max", day: "20260512", data: { value: 48.2 } }
  ]),
  0,
  "and the same sighting again moves nothing"
);
assert.equal(outgoing(), sentBefore, "so nothing goes out to sync for it");
assert.equal(
  ledger.rememberMilestones([
    { id: "vo2max:high:48", kind: "vo2max", day: "20260301", data: { value: 48.0 } }
  ]),
  1,
  "an earlier sighting — another machine's longer memory — moves it back"
);

const vo2 = ledger.listRememberedMilestones().find((row) => row.id === "vo2max:high:48");
assert.equal(vo2.day, "20260301");
assert.deepEqual(vo2.data, { value: 48 });
assert.equal(vo2.kind, "vo2max");

// --- 2. The renderer writes only its own kinds ---------------------------------

assert.equal(
  ledger.rememberMilestones([
    { id: "plan:forged", kind: "plan", day: "20260101", data: {} },
    { id: "sleep:streak:30", kind: "vo2max", day: "20260101", data: {} },
    { id: "sleep:first", kind: "sleep", day: "2026-01-01", data: {} },
    { id: "sleep:x", kind: "sleep", day: "20260101", data: { blob: "x".repeat(4000) } },
    "not even an object",
    null
  ]),
  0,
  "a plan run, a mislabelled kind, a bad day and an oversized payload are all dropped"
);
assert.equal(ledger.rememberMilestones("nope"), 0);
assert.equal(
  ledger.rememberMilestones([
    { id: "sleep:first", kind: "sleep", day: "20250710", data: { minutes: 412 } },
    { id: "plan:forged", kind: "plan", day: "20260101", data: {} }
  ]),
  1,
  "one bad row costs that row, not the rest"
);

// --- 3. Plan runs ----------------------------------------------------------------

let nextPlan = 0;
function planRun({ weeks, calendar = "finished", sessions = weeks * 2 }) {
  nextPlan += 1;
  return {
    id: `coros:run-${nextPlan}`,
    remoteId: `run-${nextPlan}`,
    name: `Block ${nextPlan}`,
    description: "",
    sportMix: ["run"],
    weekCount: weeks,
    weekStages: [],
    entries: Array.from({ length: sessions }, (_, index) => ({
      id: `e${index}`,
      weekIndex: Math.floor(index / 2),
      dayIndex: index % 2 === 0 ? 1 : 5,
      sortOrder: 0,
      title: `Session ${index}`,
      workout: { key: `e${index}`, name: `Session ${index}`, sport: "run" },
      idInPlan: String(index + 1)
    })),
    calendar,
    startDate: "2026-06-01",
    tags: [],
    favorite: false,
    archived: false,
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}
function matchesFor(plan, done) {
  return plan.entries.map((entry, index) => ({
    id: `${plan.remoteId}-${index}`,
    schedulePlanId: plan.remoteId,
    scheduleIdInPlan: entry.idInPlan,
    happenDay: "20260601",
    status: index < done ? "completed" : "missed",
    manual: false,
    updatedAt: "2026-06-01T00:00:00.000Z"
  }));
}

const kept = planRun({ weeks: 6 }); // 12 sessions
const stopped = planRun({ weeks: 6, calendar: "stopped" });
const short = planRun({ weeks: 3 });
const slack = planRun({ weeks: 8 }); // 16 sessions
const running = planRun({ weeks: 8, calendar: "running" });
const matches = [
  ...matchesFor(kept, 11),
  ...matchesFor(stopped, 12),
  ...matchesFor(short, 6),
  ...matchesFor(slack, 12),
  ...matchesFor(running, 16)
];

const earned = ledger.finishedPlanMilestones([kept, stopped, short, slack, running], matches);
assert.deepEqual(
  earned.map((row) => row.id),
  [`plan:${kept.remoteId}`],
  "only a finished run of four weeks or more kept at 80% earns one"
);
assert.equal(
  earned[0].happenDay,
  "20260711",
  "dated at its last session: week 6's Saturday, from a Monday 1 June start"
);
assert.deepEqual(earned[0].payload, {
  name: kept.name,
  weeks: 6,
  ratio: 0.917,
  done: 11,
  settled: 12
});

// Through the cache and the stored matches, which is where the IPC reads them.
database.saveCorosPlanCache(kept);
for (const match of matchesFor(kept, 11)) {
  database.saveTrainingActivityMatch(match);
}
const remembered = ledger.listRememberedMilestones();
assert.ok(
  remembered.some((row) => row.id === `plan:${kept.remoteId}` && row.kind === "plan"),
  "a finished run in the cache is remembered when the list is read"
);
database.deleteCorosPlanCache(kept.remoteId);
assert.ok(
  ledger.listRememberedMilestones().some((row) => row.id === `plan:${kept.remoteId}`),
  "and stays once the cache lets it go"
);

// A run is first seen while the matcher is still catching up on its last week;
// the reading that settles more sessions replaces it, and an older one never
// comes back.
const reading = (settled, ratio) => ({
  id: "plan:catching-up",
  kind: "plan",
  happenDay: "20260830",
  payload: { name: "Base", weeks: 12, ratio, done: Math.round(settled * ratio), settled }
});
assert.equal(database.rememberAthleteMilestones([reading(20, 0.86)]), 1);
assert.equal(database.rememberAthleteMilestones([reading(24, 0.93)]), 1, "the settled reading replaces the early one");
assert.equal(database.rememberAthleteMilestones([reading(20, 0.86)]), 0, "and the early one does not come back");
assert.equal(
  ledger.listRememberedMilestones().find((row) => row.id === "plan:catching-up").data.ratio,
  0.93
);

assert.ok(outgoing() >= 4, "every row that moved went out to sync");
bridge.attachSyncSink(null);

// --- 4. The other machine's copy -------------------------------------------------

const merge = mergers.rowMergerFor("athlete_milestones");
assert.ok(merge, "the table is merged, not last-writer-wins");
assert.equal(mergers.isMergedTable("athlete_milestones"), true);
const row = (happenDay, payload, recordedAt = 1) => ({
  id: "sleep:streak:7",
  kind: "sleep",
  happen_day: happenDay,
  payload: JSON.stringify(payload),
  recorded_at: recordedAt
});
const november = row("20251104", { nights: 7 });
const september = row("20260901", { nights: 7 }, 99);

const kept1 = merge(november, september, { winner: true });
assert.equal(kept1.row.happen_day, "20251104", "a later copy from a shorter memory does not move the day");
assert.equal(kept1.republish, true, "and this machine's copy goes back out");
assert.equal(kept1.changed, false);
const taken = merge(september, november, { winner: false });
assert.equal(taken.row.happen_day, "20251104", "an earlier copy is taken, winner of the log or not");
assert.equal(taken.republish, false);
assert.equal(taken.changed, true);
assert.deepEqual(
  merge(november, november, { winner: true }),
  { row: november, republish: false, changed: false },
  "the same copy is no change"
);
assert.deepEqual(merge(undefined, september, { winner: true }).row, september, "a row never seen is taken whole");
// Either order, the same row: what makes the merge safe on both machines.
assert.equal(
  merge(november, september, { winner: true }).row.happen_day,
  merge(september, november, { winner: true }).row.happen_day
);

console.log("records ledger: OK");
