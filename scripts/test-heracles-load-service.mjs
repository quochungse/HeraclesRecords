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
  runs: () => runs,
  bodyWeightKg: () => 75,
  inputsVersion: () => version,
  now: () => NOW,
  strengthActivities: () => [
    { activityId: "b", sportType: 402, startTime: day.startTime, trainingLoad: 5 },
    { activityId: "not-read-yet", sportType: 402, startTime: NOW - 3 * DAY, trainingLoad: 15 }
  ]
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
  // Runs are no input of the scoring: a new one names itself with nothing rescored.
  reads = 0;
  runs = [runs[0], runs[1], runs[3]];
  assert.equal(service.withStrengthSessionLoads([day], deps)[0].heracles.runEquivalent, undefined);
  assert.equal(reads, 0, "the runs moved, the sessions were not read again");
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

// ---- A plan's sessions, as the Training Library sends them ----
{
  const liftStep = {
    kind: "training",
    exercise_name: "T1041",
    target_type: "reps",
    target_reps: 8,
    sets: 3,
    intensity: { type: "weight", mode: "weight", value: 55, unit: "kg" },
    rest_type: 1,
    rest_value: 150
  };
  const fromSteps = service.plannedHeraclesLoad(
    { exercises: [{ key: "T1041", corosExerciseType: 2, sets: 3, reps: 8, weightKg: 55, restSec: 150 }] },
    deps
  );
  const loads = service.planEntryHeraclesLoads(
    [
      { key: "p:lift", workout: { key: "w1", name: "Lift", sport: "strength", steps: [liftStep] } },
      // The same three sets as one set repeated three times, in pounds.
      {
        key: "p:repeat",
        workout: {
          key: "w2",
          name: "Lift",
          sport: "strength",
          steps: [
            {
              repeat: 3,
              steps: [{ ...liftStep, sets: 1, intensity: { type: "weight", mode: "weight", value: 55 / 0.45359237, unit: "lb" } }]
            },
            { kind: "rest", target_type: "time", target_duration_seconds: 600 }
          ]
        }
      },
      { key: "p:length", workout: { key: "w3", name: "Gym", sport: "strength" }, plannedDurationSeconds: 2700 },
      { key: "p:run", workout: { key: "w4", name: "Easy", sport: "run" }, plannedDurationSeconds: 2700 },
      { key: "p:nothing", workout: { key: "w5", name: "Gym", sport: "strength" } }
    ],
    deps
  );
  assert.deepEqual(Object.keys(loads).sort(), ["p:length", "p:lift", "p:repeat"], "strength sessions that state sets or a length");
  assert.equal(loads["p:lift"].value, fromSteps.value, "a step reads as the schedule parse reads it");
  assert.ok(Math.abs(loads["p:repeat"].value - fromSteps.value) < 1e-6, "a repeat counts per round, a rest step is no exercise, pounds are kilograms");
  assert.equal(loads["p:length"].quality, "planned");
}

// ---- What Heracles adds to COROS's daily figures ----
{
  const localDay = (epochSeconds) => {
    const date = new Date(epochSeconds * 1000);
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  };
  const sessionDay = localDay(day.startTime);
  const surplus = service.withHeraclesLoads([{ activityId: "b", sportType: 402, trainingLoad: 5 }], deps)[0].heraclesLoad.value - 5;
  const payload = {
    dayList: [{ happenDay: sessionDay, trainingLoad: 80, ati: 90, cti: 85 }, { happenDay: "20200101", trainingLoad: 10 }],
    weekList: [{ firstDayOfWeek: "20200106", recomendTlMin: 500 }]
  };
  const read = service.withHeraclesDayDeltas(payload, deps);
  assert.ok(Math.abs(read.dayList[0].heracles.load - surplus) < 1e-9, "the day adds its session's Heracles load over COROS's");
  assert.ok(Math.abs(read.dayList[0].heracles.ati - surplus / 7) < 1e-9, "a first session: a seventh of it on Load Impact");
  assert.equal(read.dayList[0].heracles.partial, undefined, "nothing still loading before it");
  assert.equal(read.dayList[1].heracles, undefined, "a day before any strength session adds nothing");
  assert.equal(read.weekList[0].heraclesRange, undefined);
  assert.equal(read.dayList[0].ati, 90, "COROS's figures are never replaced");
  const later = service.withHeraclesDayDeltas({ dayList: [{ happenDay: localDay(NOW) }], weekList: [] }, deps);
  assert.equal(later.dayList[0].heracles.partial, true, "a session still loading flags what follows");
  assert.equal(service.withHeraclesDayDeltas(payload, { ...deps, strengthActivities: () => { throw new Error("no db"); } }), payload);
}

console.log("heracles load service: ok");
