// Heracles Training Load's engine (electron/heraclesLoad.ts): the set RPE
// scale, the bridge to COROS's scale, a session worked by hand, and every way
// a session can fall back.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "heraclesLoad.ts"));
const { rpeFromRir, bridgeFactor, runHeraclesLoads, estimatePlannedLoad, HERACLES_DEFAULT_K } = await import(
  `${modUrl.href}?c=${Date.now()}`
);

const DAY = 86_400;
const T0 = Math.floor(Date.UTC(2026, 9, 1, 8) / 1000);
const close = (actual, expected, label, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≠ ${expected}`);

const set = (reps, weightKg, workSec, restSec, extra = {}) => ({ reps, weightKg, workSec, restSec, calories: 0, ...extra });
const exercise = (nameKey, entries, extra = {}) => ({ nameKey, sets: entries.length, totalReps: 0, entries, ...extra });
const session = (id, day, exercises, { duration, trainingLoad = 10 } = {}) => {
  const worked = exercises.flatMap((entry) => entry.entries).reduce((sum, s) => sum + s.workSec + Math.min(s.restSec, 180), 0);
  return {
    activityId: id,
    sportType: 402,
    startTime: T0 + day * DAY,
    duration: duration ?? worked,
    trainingLoad,
    detail: { summary: { sets: 0, totalReps: 0, totalWeightKg: 0, exercises: exercises.length, calories: 0, durationSec: duration ?? worked }, exercises }
  };
};
const context = (k = 0.5, weight = 75) => ({ k, bodyWeightKg: () => weight });

// ---- The RIR scale (Zourdos 2016) ----
assert.equal(rpeFromRir(0), 10);
assert.equal(rpeFromRir(1), 9);
assert.equal(rpeFromRir(3), 7);
close(rpeFromRir(6), 5, "6 in reserve");
close(rpeFromRir(12), 2 + 3 * Math.exp(-1), "12 in reserve");
assert.ok(rpeFromRir(4) < rpeFromRir(3) && rpeFromRir(7) < rpeFromRir(6), "the scale falls with every rep in reserve");

// ---- The bridge: COROS load per RPE-minute on rated runs ----
const run = (feelType, minutes, trainingLoad, daysAgo = 10, sportType = 100) => ({
  sportType, feelType, duration: minutes * 60, trainingLoad, startTime: T0 - daysAgo * DAY
});
const fewRuns = Array.from({ length: 7 }, () => run(3, 60, 170));
assert.deepEqual(bridgeFactor(fewRuns, T0), { k: HERACLES_DEFAULT_K, runs: 7, measured: false });
const runs = [
  ...Array.from({ length: 8 }, () => run(3, 60, 170)),
  run(1, 50, 120), // rated easy: off the line strength sessions sit on
  run(2, 80, 200),
  run(4, 60, 170, 10, 402), // not a run
  run(3, 60, 170, 200) // outside the window
];
const bridge = bridgeFactor(runs, T0);
assert.equal(bridge.runs, 8);
assert.equal(bridge.measured, true);
close(bridge.k, 170 / (6 * 60), "k from runs rated 3");

// ---- A session worked by hand ----
// Day 0: bench 8 × 60 kg, taken to stop one rep short → capacity 60 × (1 + 9/30) = 78 kg.
// Day 7: 4 × 8 × 55 kg, 32 s each and 150 s rest.
//   intensity 55/78; reps to failure 30 × (78/55 − 1) = 12.545; 4.545 in reserve;
//   RPE 7 − 1.545 × 2/3 = 5.969; 182 s a set → k × 5.969 × 182/60 a set.
const benchTop = session("a", 0, [exercise("T1041", [set(8, 60, 48, 120)])]);
const bench = session("b", 7, [exercise("T1041", Array.from({ length: 4 }, () => set(8, 55, 32, 150)))]);
const capacity = 60 * (1 + 9 / 30);
const reps = 30 * (capacity / 55 - 1);
const rpe = 7 - ((reps - 8 - 3) * 2) / 3;
const perSet = (0.5 * rpe * 182) / 60;
{
  const result = runHeraclesLoads([bench, benchTop], context()).sessions.get("b");
  assert.equal(result.quality, "sets");
  close(result.value, 4 * perSet, "session load");
  assert.equal(result.cardio, 10);
  close(result.muscular, 4 * perSet - 10, "muscular part");
  close(result.sets[0][0].rpe, rpe, "set RPE");
  close(result.sets[0][0].intensity, 55 / capacity, "intensity");
  close(result.sets[0][0].load, perSet, "set load");
  close(result.sessionRpe, rpe, "session RPE with no time between sets");
}

// Time no set accounts for (warming up, changing lifts, a watch left running) counts as very easy.
{
  const longer = { ...bench, duration: bench.duration + 1800 };
  const result = runHeraclesLoads([benchTop, longer], context()).sessions.get("b");
  close(result.value, 4 * perSet + (0.5 * 1.5 * 1800) / 60, "30 idle minutes add k × 1.5 × 30");
}

// COROS's figure is the floor.
{
  const heavyHeart = { ...bench, trainingLoad: 500 };
  const result = runHeraclesLoads([benchTop, heavyHeart], context()).sessions.get("b");
  assert.equal(result.value, 500);
  assert.equal(result.muscular, 0);
}

// A later best never rewrites an earlier session.
{
  const later = session("c", 14, [exercise("T1041", [set(8, 80, 48, 120), set(8, 80, 48, 120)])]);
  const before = runHeraclesLoads([benchTop, bench], context()).sessions.get("b").value;
  const after = runHeraclesLoads([benchTop, bench, later], context()).sessions.get("b").value;
  assert.equal(after, before);
}

// One set far past the capacity is a misread rep count until a second set backs it.
{
  const glitch = session("c", 14, [exercise("T1041", [set(8, 90, 48, 120)])]);
  const again = session("d", 21, [exercise("T1041", Array.from({ length: 4 }, () => set(8, 55, 32, 150)))]);
  const result = runHeraclesLoads([benchTop, glitch, again], context()).sessions.get("d");
  close(result.sets[0][0].rpe, rpe, "the lone 90 kg set left the capacity alone");
  const backed = session("c", 14, [exercise("T1041", [set(8, 90, 48, 120), set(8, 90, 48, 120)])]);
  const raised = runHeraclesLoads([benchTop, backed, again], context()).sessions.get("d");
  assert.ok(raised.sets[0][0].rpe < rpe, "two 90 kg sets raise it");
}

// Capacity is read over 120 days.
{
  const muchLater = session("z", 200, [exercise("T1041", Array.from({ length: 4 }, () => set(8, 55, 32, 150)))]);
  const result = runHeraclesLoads([benchTop, muchLater], context()).sessions.get("z");
  close(result.sets[0][0].intensity, 55 / (55 * (1 + 9 / 30)), "the old best no longer counts");
}

// ---- Bodyweight: the same 8 dips are harder for a heavier body ----
{
  const dips = session("dips", 0, [exercise("T1051", [set(8, 0, 30, 120)])]);
  const light = runHeraclesLoads([dips], context(0.5, 50)).sessions.get("dips").sets[0][0];
  const heavy = runHeraclesLoads([dips], context(0.5, 100)).sessions.get("dips").sets[0][0];
  // Its own set is the history: 0.95 × body × (1 + 9/30); the population prior
  // (10 reps at 70 kg, scaled by body^0.67) is higher for the lighter athlete.
  assert.ok(heavy.rpe > light.rpe, `100 kg (${heavy.rpe}) above 50 kg (${light.rpe})`);
  assert.ok(heavy.intensity > light.intensity);
}

// A movement the table does not know is bodyweight until a set of it carries a weight.
{
  const unknown = session("u", 0, [exercise("T9999", [set(20, 0, 60, 60)])]);
  const result = runHeraclesLoads([unknown], context()).sessions.get("u");
  assert.equal(result.quality, "sets");
  assert.ok(result.sets[0][0].filled !== true);
}

// ---- Holds ----
{
  // A 60 s plank against a 120 s norm (its own 60 s × 1.15 is shorter): 2 + 8 × 0.5.
  const plank = session("p", 0, [exercise("T1010", [set(0, 0, 60, 60, { timed: true })])]);
  const result = runHeraclesLoads([plank], context()).sessions.get("p");
  close(result.sets[0][0].rpe, 6, "plank RPE");
  // A timed lap inside a lift is a set with no reps counted, not a hold.
  const fragment = session("f", 7, [
    exercise("T1041", [set(8, 55, 32, 150), set(0, 55, 4, 45, { timed: true })])
  ]);
  const scored = runHeraclesLoads([benchTop, fragment], context()).sessions.get("f");
  assert.equal(scored.sets[0][1].filled, true);
  close(scored.sets[0][1].rpe, scored.sets[0][0].rpe, "it takes the session's median");
}

// ---- Rest, stretching and drills ----
{
  const withStretch = session("s", 7, [
    exercise("T1041", Array.from({ length: 4 }, () => set(8, 55, 32, 150))),
    exercise("T1215", [set(0, 0, 300, 0, { timed: true })])
  ], { duration: 728 + 300 });
  const result = runHeraclesLoads([benchTop, withStretch], context()).sessions.get("s");
  assert.equal(result.sets[1][0], null);
  close(result.value, 4 * perSet + (0.5 * 1.5 * 300) / 60, "stretching counts as time between sets");

  const drills = session("d", 7, [
    exercise("T1013", [set(70, 0, 60, 30), set(70, 0, 60, 30)]),
    exercise("T1041", [set(8, 55, 32, 30)])
  ], { trainingLoad: 51 });
  const conditioning = runHeraclesLoads([benchTop, drills], context()).sessions.get("d");
  assert.equal(conditioning.quality, "conditioning");
  assert.equal(conditioning.value, 51);
}

// ---- Sessions whose sets cannot be read ----
{
  const ready = runHeraclesLoads([benchTop, bench], context());
  // The upper middle of two: the 8 × 60 kg best (RPE 9) over the 55 kg day.
  const knownRpe = Math.max(ready.sessions.get("a").sessionRpe, ready.sessions.get("b").sessionRpe);
  close(ready.sessions.get("a").sessionRpe, 9, "a best set is one rep short");
  const regions = session("r", 10, [exercise("S4211", [set(10, 40, 40, 90), set(10, 40, 40, 90)])], { duration: 3600 });
  const merged = session("m", 11, [exercise("T1041", [set(72, 50, 857, 90)])], { duration: 3600 });
  const result = runHeraclesLoads([benchTop, bench, regions, merged], context()).sessions;
  for (const id of ["r", "m"]) {
    assert.equal(result.get(id).quality, "estimate", id);
    close(result.get(id).value, 0.5 * knownRpe * 60, `${id}: k × the usual session RPE × minutes`);
  }
  // With no readable session to go by, the default RPE.
  const alone = runHeraclesLoads([regions], context()).sessions.get("r");
  close(alone.value, 0.5 * 6.5 * 60, "default session RPE");
}

// A weighted lift logged with no weight takes the session's median RPE.
{
  const earlier = session("e", 0, [exercise("T1025", [set(15, 20, 40, 60)])]);
  const noWeight = session("n", 7, [
    exercise("T1041", [set(8, 55, 32, 150)]),
    exercise("T1025", [set(15, 0, 40, 60)])
  ]);
  const result = runHeraclesLoads([benchTop, earlier, noWeight], context()).sessions.get("n");
  assert.equal(result.sets[1][0].filled, true);
  close(result.sets[1][0].rpe, result.sets[0][0].rpe, "median of the session");
}

// ---- Hevy's set types ----
{
  const hevy = session("h", 0, [exercise("bench", [
    set(10, 100, 0, 0, { type: "warmup" }),
    set(8, 60, 0, 0, { type: "failure" })
  ], { externalId: "tmpl-1", exerciseType: "weight_reps" })], { trainingLoad: null });
  const result = runHeraclesLoads([hevy], context()).sessions.get("h");
  assert.equal(result.cardio, undefined, "Hevy alone: no COROS figure");
  assert.equal(result.sets[0][1].rir, 0);
  assert.equal(result.sets[0][1].rpe, 10, "failure is no rep in reserve");
  // The warm-up set's 100 kg did not count as capacity: 60 × (1 + 8/30).
  close(result.sets[0][1].intensity, 60 / (60 * (1 + 8 / 30)), "capacity from the failure set alone");
  // No clock: 3 s a rep and 90 s rest.
  assert.equal(result.sets[0][1].seconds, 8 * 3 + 90);
}

// ---- Planned sessions ----
{
  const { state } = runHeraclesLoads([benchTop, bench], context());
  const now = T0 + 10 * DAY;
  const planned = estimatePlannedLoad({ exercises: [{ key: "T1041", sets: 4, reps: 8, weightKg: 55, restSec: 150 }] }, state, now);
  assert.equal(planned.quality, "planned");
  close(planned.value, (4 * 0.5 * rpe * (8 * 3 + 150)) / 60, "the plan's sets read like done ones");
  const padded = estimatePlannedLoad({ exercises: [{ key: "T1041", sets: 4, reps: 8, weightKg: 55, restSec: 150 }], estimatedSeconds: 4 * 174 + 600 }, state, now);
  close(padded.value - planned.value, (0.5 * 1.5 * 600) / 60, "the rest of the plan's length is time between sets");
  const lengthOnly = estimatePlannedLoad({ exercises: [], estimatedSeconds: 3600 }, state, now);
  const usual = [...state.sessionRpes.map((entry) => entry.rpe)].sort((a, b) => a - b)[1];
  close(lengthOnly.value, 0.5 * usual * 60, "length × the usual session RPE");
  assert.equal(estimatePlannedLoad({ exercises: [] }, state, now), undefined);
  const withCoros = estimatePlannedLoad({ exercises: [], estimatedSeconds: 60, corosLoad: 400 }, state, now);
  assert.equal(withCoros.value, 400, "never below COROS's planned figure");
}

console.log("heracles load: ok");
