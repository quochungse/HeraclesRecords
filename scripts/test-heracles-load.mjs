// Heracles Training Load's engine (electron/heraclesLoad.ts): the set RPE
// scale, reps to failure (Nuzzo et al. 2024), load per minute on COROS's TRIMP
// curve, a session worked by hand, and every way a session can fall back.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "heraclesLoad.ts"));
const {
  rpeFromRir,
  repsAtIntensity,
  intensityAtReps,
  heartRateReserveAtRpe,
  loadPerMinute,
  runHeraclesLoads,
  estimatePlannedLoad
} = await import(
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
const context = (weight = 75) => ({ bodyWeightKg: () => weight });

// ---- The RIR scale (Zourdos 2016) ----
assert.equal(rpeFromRir(0), 10);
assert.equal(rpeFromRir(1), 9);
assert.equal(rpeFromRir(3), 7);
close(rpeFromRir(6), 5, "6 in reserve");
close(rpeFromRir(12), 2 + 3 * Math.exp(-1), "12 in reserve");
assert.ok(rpeFromRir(4) < rpeFromRir(3) && rpeFromRir(7) < rpeFromRir(6), "the scale falls with every rep in reserve");

// ---- Reps to failure at a share of 1RM (Nuzzo et al. 2024) ----
assert.equal(repsAtIntensity(1), 1, "one rep at the one-rep max");
close(repsAtIntensity(0.7), 14.8, "the meta-regression's 70%");
close(repsAtIntensity(0.725), (12.37 + 14.8) / 2, "linear between rows");
close(intensityAtReps(14.8), 0.7, "read back");
close(intensityAtReps(repsAtIntensity(0.63)), 0.63, "a round trip");
assert.equal(intensityAtReps(1), 1);

// ---- Load per minute: COROS's TRIMP at the heart-rate reserve of the effort ----
for (const rating of [1.5, 5, 7, 9]) {
  const reserve = heartRateReserveAtRpe(rating);
  close(loadPerMinute(rating), reserve * 0.2445 * Math.exp(3.411 * reserve), `RPE ${rating}`);
}
assert.ok(loadPerMinute(9) > loadPerMinute(7) && loadPerMinute(7) > loadPerMinute(5), "harder weighs more");
assert.ok(loadPerMinute(9) / loadPerMinute(5) > 9 / 5, "and more than in proportion, as on COROS's curve");

// ---- A session worked by hand ----
// Day 0: bench 8 × 60 kg, taken to stop two reps short → capacity 60 / %1RM(10 reps).
// Day 7: 4 × 8 × 55 kg, 32 s each and 150 s rest: intensity 55 / capacity, the
//   reps the table holds there less 8 in reserve, RPE off Zourdos's scale, and
//   182 s a set at that effort's load per minute.
const benchTop = session("a", 0, [exercise("T1041", [set(8, 60, 48, 120)])]);
const bench = session("b", 7, [exercise("T1041", Array.from({ length: 4 }, () => set(8, 55, 32, 150)))]);
const capacity = 60 / intensityAtReps(10);
const rpe = rpeFromRir(repsAtIntensity(55 / capacity) - 8);
const perSet = (loadPerMinute(rpe) * 182) / 60;
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
  close(result.value, 4 * perSet + loadPerMinute(1.5) * 30, "30 idle minutes add 30 minutes at RPE 1.5");
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
  close(result.sets[0][0].intensity, intensityAtReps(10), "the old best no longer counts");
}

// ---- Reps lost at a weight already lifted are fatigue, not reserve ----
{
  const curls = session("f", 0, [exercise("T1041", [set(17, 25, 50, 90), set(13, 25, 40, 90), set(11, 25, 35, 90), set(10, 25, 30, 90)])]);
  const [first, ...later] = runHeraclesLoads([curls], context()).sessions.get("f").sets[0];
  close(first.rir, 2, "the best set stopped two reps short");
  assert.equal(first.fatigued, undefined);
  for (const [index, held] of later.entries()) {
    close(held.rir, 2, `set ${index + 2} is held to the first set's reserve`);
    close(held.rpe, 8, `set ${index + 2} reads as hard as the first`);
    assert.equal(held.fatigued, true);
  }
}

// A heavier set doing fewer reps, or a lighter one after it, is read on its own.
{
  const pyramid = session("p", 0, [exercise("T1041", [set(12, 50, 40, 90), set(10, 60, 35, 90), set(8, 70, 30, 90), set(12, 50, 40, 90)])]);
  const sets = runHeraclesLoads([pyramid], context()).sessions.get("p").sets[0];
  assert.ok(sets.every((entry) => !entry.fatigued), "no set of a pyramid is held");
  assert.ok(sets[0].rir > sets[1].rir && sets[1].rir > sets[2].rir, "lighter sets keep more in reserve");
  close(sets[3].rir, sets[0].rir, "the same set again reads the same");
}

// ---- Bodyweight: the same 8 dips are harder for a heavier body ----
{
  const dips = session("dips", 0, [exercise("T1051", [set(8, 0, 30, 120)])]);
  const light = runHeraclesLoads([dips], context(50)).sessions.get("dips").sets[0][0];
  const heavy = runHeraclesLoads([dips], context(100)).sessions.get("dips").sets[0][0];
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
  close(result.value, 4 * perSet + loadPerMinute(1.5) * 5, "stretching counts as time between sets");

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
  // The upper middle of two: the 8 × 60 kg best (RPE 8) over the 55 kg day.
  const knownRpe = Math.max(ready.sessions.get("a").sessionRpe, ready.sessions.get("b").sessionRpe);
  close(ready.sessions.get("a").sessionRpe, 8, "a best set is two reps short");
  const regions = session("r", 10, [exercise("S4211", [set(10, 40, 40, 90), set(10, 40, 40, 90)])], { duration: 3600 });
  const merged = session("m", 11, [exercise("T1041", [set(72, 50, 857, 90)])], { duration: 3600 });
  const result = runHeraclesLoads([benchTop, bench, regions, merged], context()).sessions;
  for (const id of ["r", "m"]) {
    assert.equal(result.get(id).quality, "estimate", id);
    close(result.get(id).value, loadPerMinute(knownRpe) * 60, `${id}: the usual session RPE × minutes`);
  }
  // With no readable session to go by, the default RPE.
  const alone = runHeraclesLoads([regions], context()).sessions.get("r");
  close(alone.value, loadPerMinute(6.5) * 60, "default session RPE");
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
  // The warm-up set's 100 kg did not count as capacity: 8 reps at failure.
  close(result.sets[0][1].intensity, intensityAtReps(8), "capacity from the failure set alone");
  // No clock and no session length: 3 s a rep and 90 s rest.
  assert.equal(result.sets[0][1].seconds, 8 * 3 + 90);
}

// Hevy clocks no rest: the time its sets leave of the session is shared out
// between them, so a session reads as COROS's laps of it would.
{
  const hevySets = () => Array.from({ length: 3 }, () => set(10, 60, 0, 0));
  const lapSets = () => Array.from({ length: 3 }, () => set(10, 60, 30, 170));
  const hevy = (duration) =>
    session("hs", 0, [
      exercise("bench", hevySets(), { externalId: "b", exerciseType: "weight_reps" }),
      exercise("row", hevySets(), { externalId: "r", exerciseType: "weight_reps" })
    ], { duration, trainingLoad: null });
  const coros = session("cs", 0, [exercise("T1041", lapSets()), exercise("T1043", lapSets())], { trainingLoad: null });
  const fromHevy = runHeraclesLoads([hevy(1200)], context()).sessions.get("hs");
  const fromCoros = runHeraclesLoads([coros], context()).sessions.get("cs");
  // 1,200 s less 6 × 30 s of reps, over 6 sets: 170 s of rest each.
  assert.equal(fromHevy.sets[0][0].seconds, 30 + 170);
  close(fromHevy.value, fromCoros.value, "the same session from either app");
  // Rest past three minutes a set is time between sets, as on COROS.
  const long = runHeraclesLoads([hevy(3600)], context()).sessions.get("hs");
  assert.equal(long.sets[0][0].seconds, 30 + 180);
  const sets = long.sets.flat().reduce((sum, entry) => sum + entry.load, 0);
  close(long.value, sets + (loadPerMinute(1.5) * (3600 - 6 * 210)) / 60, "the rest at RPE 1.5");
}

// A Hevy movement is known by its name: a pull-up moves 0.95 of the body,
// as COROS's does, and a barbell squat moves the body under the bar too.
{
  const pullUps = (id, title, exerciseType) =>
    session(id, 0, [exercise(title, [set(5, 0, 0, 0), set(5, 0, 0, 0)], { rawName: title, externalId: id, exerciseType })], { trainingLoad: null });
  const hevy = runHeraclesLoads([pullUps("hp", "Pull Up", "bodyweight_reps")], context(80)).sessions.get("hp");
  const coros = runHeraclesLoads([session("cp", 0, [exercise("T1002", [set(5, 0, 0, 0), set(5, 0, 0, 0)])])], context(80))
    .sessions.get("cp");
  close(hevy.sets[0][0].rpe, coros.sets[0][0].rpe, "Hevy's pull-up reads as COROS's");
  close(hevy.sets[0][0].intensity, coros.sets[0][0].intensity, "same share of the body");
  const unnamed = runHeraclesLoads([pullUps("hx", "Something Else", "bodyweight_reps")], context(80)).sessions.get("hx");
  assert.notEqual(unnamed.sets[0][0].intensity, hevy.sets[0][0].intensity, "a name it does not know keeps the default share");

  // A squat at 100 kg is 100 + 0.88 × 80 = 170.4 kg moved; its own set is the
  // history, so intensity is that over its capacity whichever share is used —
  // but a lighter squat the next day reads against the body-inclusive best.
  const squat = (id, day, kg) =>
    session(id, day, [exercise("Squat (Barbell)", [set(5, kg, 0, 0), set(5, kg, 0, 0)], { rawName: "Squat (Barbell)", externalId: "sq", exerciseType: "weight_reps" })], { trainingLoad: null });
  const light = runHeraclesLoads([squat("s1", 0, 100), squat("s2", 1, 60)], context(80)).sessions.get("s2");
  close(light.sets[0][0].intensity, ((60 + 0.88 * 80) / (100 + 0.88 * 80)) * intensityAtReps(7), "body under the bar");
}

// Hevy's assisted movement: the assistance comes off the body, so more help
// is an easier set.
{
  const assisted = (assistKg) =>
    session(`a${assistKg}`, 0, [
      exercise("Pull Up (Assisted)", [set(8, 0, 0, 0, { assistKg }), set(8, 0, 0, 0, { assistKg })], {
        rawName: "Pull Up (Assisted)",
        externalId: "pa",
        exerciseType: "bodyweight_assisted_reps"
      })
    ], { trainingLoad: null });
  // With a history set heavier than both, the sets read against one capacity.
  const history = session("ph", -1, [exercise("Pull Up", [set(5, 0, 0, 0), set(5, 0, 0, 0)], { rawName: "Pull Up", externalId: "pa", exerciseType: "bodyweight_reps" })], { trainingLoad: null });
  const little = runHeraclesLoads([history, assisted(10)], context(80)).sessions.get("a10").sets[0][0];
  const much = runHeraclesLoads([history, assisted(30)], context(80)).sessions.get("a30").sets[0][0];
  close(little.intensity, ((0.95 * 80 - 10) / (0.95 * 80)) * intensityAtReps(7), "the body less 10 kg of help");
  assert.ok(much.rpe < little.rpe, `30 kg of help (${much.rpe}) easier than 10 kg (${little.rpe})`);
}

// An RPE logged in Hevy is taken over the prediction, and says how close to
// failure the set was for the lift's capacity.
{
  const logged = session("lg", 0, [exercise("bench", [
    set(8, 60, 0, 0, { rpe: 7 }),
    set(8, 60, 0, 0)
  ], { externalId: "tmpl-2", exerciseType: "weight_reps" })], { trainingLoad: null });
  const result = runHeraclesLoads([logged], context()).sessions.get("lg");
  assert.equal(result.sets[0][0].rpe, 7);
  assert.equal(result.sets[0][0].logged, true);
  // RPE 7 is three reps left: capacity at 11 reps, above the two-reps-short guess.
  close(result.sets[0][1].intensity, intensityAtReps(11), "capacity from the logged RPE");
  assert.equal(result.sets[0][1].logged, undefined, "an unlogged set is still predicted");
}

// ---- Planned sessions ----
{
  const { state } = runHeraclesLoads([benchTop, bench], context());
  const now = T0 + 10 * DAY;
  const planned = estimatePlannedLoad({ exercises: [{ key: "T1041", sets: 4, reps: 8, weightKg: 55, restSec: 150 }] }, state, now);
  assert.equal(planned.quality, "planned");
  close(planned.value, (4 * loadPerMinute(rpe) * (8 * 3 + 150)) / 60, "the plan's sets read like done ones");
  const padded = estimatePlannedLoad({ exercises: [{ key: "T1041", sets: 4, reps: 8, weightKg: 55, restSec: 150 }], estimatedSeconds: 4 * 174 + 600 }, state, now);
  close(padded.value - planned.value, loadPerMinute(1.5) * 10, "the rest of the plan's length is time between sets");
  const lengthOnly = estimatePlannedLoad({ exercises: [], estimatedSeconds: 3600 }, state, now);
  const usual = [...state.sessionRpes.map((entry) => entry.rpe)].sort((a, b) => a - b)[1];
  close(lengthOnly.value, loadPerMinute(usual) * 60, "length × the usual session RPE");
  assert.equal(estimatePlannedLoad({ exercises: [] }, state, now), undefined);
  const withCoros = estimatePlannedLoad({ exercises: [], estimatedSeconds: 60, corosLoad: 400 }, state, now);
  assert.equal(withCoros.value, 400, "never below COROS's planned figure");
}

console.log("heracles load: ok");
