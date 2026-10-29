// Heracles Training Load's service (electron/heraclesLoadService.ts) over fake
// stores: what each kind of strength activity carries, the sets kept only when
// they line up, and one run kept until an input moves.
// Run with `npm run build:electron` first (the npm script does).
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const service = await import(
  `${pathToFileURL(path.join(repoRoot, "dist-electron", "heraclesLoadService.js")).href}?cacheBust=${Date.now()}`
);

const DAY = 86_400;
const NOW = Math.floor(Date.UTC(2026, 9, 29, 12) / 1000);
const set = (reps, weightKg, workSec, restSec) => ({ reps, weightKg, workSec, restSec, calories: 0 });
const strength = (activityId, daysAgo, entries, extra = {}) => ({
  activityId,
  sportType: 402,
  startTime: NOW - daysAgo * DAY,
  duration: entries.reduce((sum, s) => sum + s.workSec + Math.min(s.restSec, 180), 0),
  trainingLoad: 5,
  detail: {
    summary: { sets: entries.length, totalReps: 0, totalWeightKg: 0, exercises: 1, calories: 0, durationSec: 0 },
    exercises: [{ nameKey: "T1041", sets: entries.length, totalReps: 0, entries }]
  },
  ...extra
});

const top = strength("a", 14, [set(8, 60, 48, 120)]);
const day = strength("b", 7, [set(8, 55, 32, 150), set(8, 55, 32, 150)]);
// The same workout logged by both: the merged session reads Hevy's sets.
const combined = strength("combined:h1:c1", 2, [set(8, 55, 32, 150), set(8, 55, 32, 150), set(8, 55, 32, 150)], {
  source: "combined",
  sourceIds: { coros: "c1", hevy: "h1" }
});

let version = "1";
let reads = 0;
let runs = [];
const deps = {
  strengthSessions: () => {
    reads += 1;
    return [top, day, combined];
  },
  withoutBreakdown: () => ["gym-cardio"],
  ratedRuns: () => Array.from({ length: 8 }, () => ({ sportType: 100, feelType: 3, duration: 3600, trainingLoad: 170, startTime: NOW - 5 * DAY })),
  runs: () => runs,
  bodyWeightKg: () => 75,
  inputsVersion: () => version,
  now: () => NOW
};

// ---- The activity list ----
{
  const runOnly = [{ activityId: "r", sportType: 100, trainingLoad: 200 }];
  assert.equal(service.withHeraclesLoads(runOnly, deps), runOnly, "a list with no strength session is handed back as it came");

  const list = service.withHeraclesLoads([
    { activityId: "r", sportType: 100, trainingLoad: 200 },
    { activityId: "b", sportType: 402, trainingLoad: 5 },
    { activityId: "c1", sportType: 402, trainingLoad: 5 },
    { activityId: "gym-cardio", sportType: 400, trainingLoad: 30 },
    { activityId: "not-read-yet", sportType: 402, trainingLoad: 15 }
  ], deps);
  const byId = new Map(list.map((activity) => [activity.activityId, activity]));
  assert.equal(byId.get("r").heraclesLoad, undefined, "a run reads in COROS's load as it is");
  assert.equal(byId.get("b").heraclesLoad.quality, "sets");
  assert.ok(byId.get("b").heraclesLoad.value > 5);
  assert.equal(byId.get("b").heraclesLoad.cardio, 5);
  assert.equal("sets" in byId.get("b").heraclesLoad, false, "the list carries no sets");
  assert.equal(byId.get("c1").heraclesLoad.quality, "sets", "found by its COROS id through the merged session");
  assert.deepEqual(byId.get("gym-cardio").heraclesLoad, { value: 30, cardio: 30, muscular: 0, quality: "conditioning" });
  assert.deepEqual(byId.get("not-read-yet").heraclesLoad, { value: 15, cardio: 15, muscular: 0, quality: "pending" });
  assert.equal(byId.get("b").trainingLoad, 5, "COROS's figure is never replaced");
}

// ---- Strength sessions as a source selection returns them ----
{
  const corosOnly = { ...strength("c1", 2, [set(8, 55, 32, 150)]), source: "coros", sourceIds: { coros: "c1" } };
  const [scored, shaped] = service.withStrengthSessionLoads([corosOnly, combined], deps);
  assert.equal(scored.heracles.quality, "sets", "COROS's copy reads the merged session's load");
  assert.equal(scored.heracles.sets, undefined, "but its one set does not line up with Hevy's three");
  assert.equal(shaped.heracles.sets[0].length, 3, "the merged session keeps its sets");
}

// ---- The run a session is set beside ----
{
  const value = service.withStrengthSessionLoads([day], deps)[0].heracles.value;
  version = "with-runs";
  runs = [
    { activityId: "far", startTime: day.startTime - 70 * DAY, trainingLoad: value, distance: 9000, duration: 3000 },
    { activityId: "off", startTime: day.startTime - 3 * DAY, trainingLoad: value * 1.3, distance: 12000, duration: 4000 },
    { activityId: "near", startTime: day.startTime - 5 * DAY, trainingLoad: value * 1.05, distance: 6000, duration: 2400 },
    { activityId: "later", startTime: day.startTime + DAY, trainingLoad: value, distance: 6000, duration: 2400 }
  ];
  const [withRun] = service.withStrengthSessionLoads([day], deps);
  assert.equal(withRun.heracles.runEquivalent.activityId, "near", "within eight weeks before it and 15% of its load");
  runs = [runs[0], runs[1], runs[3]];
  version = "without-a-match";
  assert.equal(service.withStrengthSessionLoads([day], deps)[0].heracles.runEquivalent, undefined);
  runs = [];
}

// ---- One run until an input moves ----
{
  version = "cache-check";
  reads = 0;
  service.withHeraclesLoads([{ activityId: "b", sportType: 402, trainingLoad: 5 }], deps);
  service.withHeraclesLoads([{ activityId: "b", sportType: 402, trainingLoad: 5 }], deps);
  service.plannedHeraclesLoad({ exercises: [], estimatedSeconds: 3600 }, deps);
  assert.equal(reads, 1, "read once while nothing changed");
  version = "cache-check-2";
  service.withHeraclesLoads([{ activityId: "b", sportType: 402, trainingLoad: 5 }], deps);
  assert.equal(reads, 2, "read again when the inputs moved");
}

// ---- A planned session ----
{
  const planned = service.plannedHeraclesLoad({ exercises: [{ key: "T1041", sets: 3, reps: 8, weightKg: 55, restSec: 150 }] }, deps);
  assert.equal(planned.quality, "planned");
  assert.ok(planned.value > 0);
  assert.equal(service.plannedHeraclesLoad({ exercises: [] }, deps), undefined);
}

console.log("heracles load service: ok");
