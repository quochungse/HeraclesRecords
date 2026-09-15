/**
 * One strength session, analysed on its own: what the body map may draw for it,
 * which scale the colours are read on, and which lifts were records.
 *
 * Three decisions are pinned here because each fails quietly. A session COROS
 * logged only as Full Body must light the whole figure faintly rather than
 * leave it blank or paint it hot. A session is read on its own scale, so one
 * heavy session cannot repaint every other. And a record must not depend on
 * muscle attribution, or a lift no rule recognises can never be one.
 *
 * Run: npm run test:strength-session-analytics
 * (Electron, because this machine's Node has no Amaro for --experimental-strip-types.)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = Date.now();
const load = async (...segments) => {
  const url = pathToFileURL(path.join(repoRoot, ...segments));
  return import(`${url.href}?cacheBust=${bust}`);
};

const { MUSCLES, resolveExerciseTargets } = await load("src", "strength", "muscles.ts");
const { buildStrengthAnalytics, heatLevel, metricValue } = await load(
  "src",
  "strength",
  "strengthAnalytics.ts"
);
const { buildExerciseRows, buildSessionStats, buildStrengthSessionIndex, sessionHeat } = await load(
  "src",
  "strength",
  "sessionAnalytics.ts"
);

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const METRICS = ["sets", "volume", "time"];

const session = (activityId, startTime, exercises) => ({
  activityId,
  sportType: 402,
  name: "Gym",
  startTime,
  duration: 3600,
  detail: {
    summary: {
      sets: exercises.reduce((n, e) => n + e.entries.length, 0),
      totalReps: 0,
      totalWeightKg: 0,
      exercises: exercises.length,
      calories: 300,
      durationSec: 3600
    },
    exercises
  }
});

const exercise = (nameKey, entries, extra = {}) => ({
  nameKey,
  sets: entries.length,
  totalReps: entries.reduce((n, e) => n + e.reps, 0),
  entries: entries.map((entry) => ({ restSec: 90, calories: 8, workSec: 40, ...entry })),
  ...extra
});

const sets = (count, reps, weightKg) =>
  Array.from({ length: count }, () => ({ reps, weightKg }));

const levels = (heat, metric) =>
  Object.fromEntries(
    MUSCLES.map((muscle) => [
      muscle.id,
      heatLevel(metricValue(heat.muscleById[muscle.id], metric), heat.max)
    ])
  );

// T1041 = Bench Press, T1061 = Squats, S4208 = COROS "Full Body".
const UNMAPPED = "Landmine Wobble";
assert.equal(
  resolveExerciseTargets(UNMAPPED).activations.length,
  0,
  "fixture: the unmapped exercise must match no muscle rule"
);

// ---- 1. An attributed session credits muscles exactly as the window does ----

{
  const bench = session("bench", now - DAY, [
    exercise("T1041", sets(3, 8, 80)),
    exercise("T1061", sets(2, 5, 120))
  ]);
  const index = buildStrengthSessionIndex([bench]);
  const entry = index.byId.get("bench");

  assert.equal(entry.attribution, "attributed");
  assert.deepEqual(entry.coverage, {
    attributed: 5,
    generic: 0,
    unmapped: 0,
    mobility: 0,
    working: 5
  });

  const benchChest = resolveExerciseTargets("Bench Press").activations.find(
    (a) => a.muscle === "chest"
  ).share;
  assert.ok(Math.abs(entry.analytics.muscleById.chest.sets - 3 * benchChest) < 1e-9);
  const credited = MUSCLES.reduce((n, m) => n + entry.analytics.muscleById[m.id].sets, 0);
  assert.ok(Math.abs(credited - 5) < 1e-9, "shares sum to 1, so no set is double-counted");

  // The busiest muscle of the session is always the hottest.
  for (const metric of ["sets", "volume"]) {
    const heat = sessionHeat(entry, metric);
    assert.equal(heat.max, entry.analytics.muscleMax[metric]);
    assert.equal(Math.max(...Object.values(levels(heat, metric))), 5);
  }
}

// ---- 2. Full Body only: every muscle at the faintest level, panel data untouched ----

{
  const fullBody = session("full-body", now - DAY, [
    exercise("S4208", sets(4, 12, 20), { rawName: "Full Body" })
  ]);
  const index = buildStrengthSessionIndex([fullBody]);
  const entry = index.byId.get("full-body");

  assert.equal(entry.attribution, "generic");
  assert.equal(entry.coverage.generic, 4);
  assert.equal(entry.coverage.attributed, 0);

  for (const metric of METRICS) {
    const byMuscle = levels(sessionHeat(entry, metric), metric);
    for (const muscle of MUSCLES) {
      assert.equal(byMuscle[muscle.id], 1, `Full Body draws ${muscle.id} at level 1 (${metric})`);
    }
  }
  // The faint figure is for drawing only; what the panel reads stays true.
  for (const muscle of MUSCLES) {
    assert.equal(entry.analytics.muscleById[muscle.id].sets, 0);
  }
}

// ---- 3. Nothing recognisable, or nothing but warm-ups: the figure stays blank ----

{
  const unmapped = session("unmapped", now - DAY, [exercise(UNMAPPED, sets(3, 10, 40))]);
  const warmup = session("warmup", now - DAY, [exercise("Warm Up", sets(2, 1, 0))]);
  const empty = session("empty", now - DAY, []);
  const index = buildStrengthSessionIndex([unmapped, warmup, empty]);

  assert.equal(index.byId.get("unmapped").attribution, "unmapped");
  assert.equal(index.byId.get("unmapped").coverage.unmapped, 3);
  assert.equal(index.byId.get("warmup").attribution, "empty");
  assert.equal(index.byId.get("warmup").coverage.mobility, 2);
  assert.equal(index.byId.get("warmup").coverage.working, 0);
  assert.equal(index.byId.get("empty").attribution, "empty");

  for (const id of ["unmapped", "warmup", "empty"]) {
    for (const metric of METRICS) {
      const byMuscle = levels(sessionHeat(index.byId.get(id), metric), metric);
      assert.ok(Object.values(byMuscle).every((level) => level === 0), `${id} draws nothing`);
    }
  }
}

// ---- 4. A session is read on its own scale, whatever the rest of the history did ----

{
  const light = session("light", now - 2 * DAY, [exercise("T1041", sets(3, 10, 40))]);
  const heavy = session("heavy", now - 9 * DAY, [exercise("T1041", sets(10, 10, 60))]);
  const alone = buildStrengthSessionIndex([light]);
  const beside = buildStrengthSessionIndex([light, heavy]);

  const onItsOwn = sessionHeat(alone.byId.get("light"), "sets");
  const amongOthers = sessionHeat(beside.byId.get("light"), "sets");
  assert.equal(onItsOwn.max, amongOthers.max, "a heavier session does not rescale a lighter one");
  assert.deepEqual(levels(onItsOwn, "sets"), levels(amongOthers, "sets"));
  assert.equal(levels(amongOthers, "sets").chest, 5);
  assert.equal(levels(sessionHeat(beside.byId.get("heavy"), "sets"), "sets").chest, 5);

  // Both are read against their own busiest muscle, which is not the window's total.
  const windowMax = buildStrengthAnalytics([light, heavy], 90).muscleMax;
  assert.ok(windowMax.sets > amongOthers.max);
}

// ---- 5. Personal records ----

{
  const history = [
    // Bench: first appearance, then a tie, then a heavier set.
    session("b1", now - 30 * DAY, [exercise("T1041", sets(3, 5, 80))]),
    session("b2", now - 20 * DAY, [exercise("T1041", sets(3, 5, 80))]),
    session("b3", now - 10 * DAY, [exercise("T1041", [{ reps: 5, weightKg: 80 }, { reps: 3, weightKg: 85 }])]),
    // Same top weight as b3, more reps: a better estimated max, not a heavier set.
    session("b4", now - 5 * DAY, [exercise("T1041", sets(1, 8, 85))]),

    // A lift no rule recognises can still set a record.
    session("u1", now - 25 * DAY, [exercise(UNMAPPED, sets(3, 8, 40))]),
    session("u2", now - 15 * DAY, [exercise(UNMAPPED, sets(3, 8, 50))]),

    // Full Body lumps unrelated movements under one name: never a record.
    session("f1", now - 25 * DAY, [exercise("S4208", sets(3, 8, 10), { rawName: "Full Body" })]),
    session("f2", now - 15 * DAY, [exercise("S4208", sets(3, 8, 30), { rawName: "Full Body" })]),

    // Two sessions at the same moment are judged against the same earlier best.
    session("s0", now - 40 * DAY, [exercise("T1061", sets(3, 5, 100))]),
    session("s1", now - 12 * DAY, [exercise("T1061", sets(3, 5, 110))]),
    session("s2", now - 12 * DAY, [exercise("T1061", sets(3, 5, 120))]),

    // No start time: cannot be placed in order, so it keeps no records.
    { ...session("undated", undefined, [exercise("T1041", sets(1, 1, 200))]) }
  ];
  const index = buildStrengthSessionIndex(history);
  const records = (id) => index.byId.get(id).records;
  const kinds = (id) => records(id).map((r) => r.kind).sort();

  assert.deepEqual(records("b1"), [], "a first appearance has nothing to beat");
  assert.deepEqual(records("b2"), [], "matching the best is not beating it");
  assert.deepEqual(kinds("b3"), ["e1rm", "weight"]);
  const b3Weight = records("b3").find((r) => r.kind === "weight");
  assert.equal(b3Weight.exercise, "Bench Press");
  assert.equal(b3Weight.valueKg, 85);
  assert.equal(b3Weight.previousKg, 80);
  assert.deepEqual(kinds("b4"), ["e1rm"], "more reps at the same weight is an e1RM record only");

  assert.deepEqual(records("u1"), []);
  assert.deepEqual(
    records("u2").map(({ exercise: name, kind, valueKg, previousKg }) => [name, kind, valueKg, previousKg]),
    [
      [UNMAPPED, "weight", 50, 40],
      [UNMAPPED, "e1rm", 50 * (1 + 8 / 30), 40 * (1 + 8 / 30)]
    ]
  );

  assert.deepEqual(records("f2"), [], "Full Body never sets a record");

  for (const id of ["s1", "s2"]) {
    const weight = records(id).find((r) => r.kind === "weight");
    assert.equal(weight.previousKg, 100, `${id} is measured against s0, not its twin`);
  }

  assert.ok(index.byId.has("undated"), "an undated session is still indexed");
  assert.deepEqual(records("undated"), []);
  // ...and its 200 kg single does not become the best that later sessions must beat.
  assert.deepEqual(kinds("b3"), ["e1rm", "weight"]);
}

// ---- 6. Session stats: warm-ups are not working sets, missing data stays missing ----

{
  const hevy = session("hevy", now - DAY, [
    exercise("T1041", [
      { reps: 10, weightKg: 40, type: "warmup", workSec: 30, restSec: 0 },
      { reps: 5, weightKg: 80, workSec: 30, restSec: 0 },
      { reps: 5, weightKg: 80, workSec: 30, restSec: 0 }
    ])
  ]);
  const stats = buildSessionStats(hevy);
  assert.equal(stats.workingSets, 2);
  assert.equal(stats.warmupSets, 1);
  assert.equal(stats.volumeKg, 10 * 40 + 5 * 80 * 2);
  assert.equal(stats.densityKgPerMin, stats.volumeKg / 60, "an hour-long session");
  assert.equal(stats.restPerWork, undefined, "a log with no rest has no work:rest ratio, not 0");
  assert.equal(stats.avgHr, undefined);

  const coros = session("coros", now - DAY, [exercise("T1041", sets(2, 8, 0))]);
  coros.avgHr = 118;
  const corosStats = buildSessionStats(coros);
  assert.equal(corosStats.restPerWork, 90 / 40, "fixture entries rest 90 s per 40 s of work");
  assert.equal(corosStats.densityKgPerMin, undefined, "bodyweight work has no density");
  assert.equal(corosStats.avgHr, 118);
}

// ---- 7. Exercise rows: top set, per-set e1RM, records on the row that set them ----

{
  const history = [
    session("r0", now - 20 * DAY, [exercise("T1041", sets(3, 5, 80))]),
    session("r1", now - 5 * DAY, [
      // A superset lists bench twice; only the second block beat the old best.
      exercise("T1041", [{ reps: 8, weightKg: 70 }, { reps: 6, weightKg: 75 }]),
      exercise("T1061", sets(3, 5, 100)),
      exercise("T1041", [{ reps: 3, weightKg: 85 }, { reps: 5, weightKg: 85 }, { reps: 20, weightKg: 40 }])
    ])
  ];
  const index = buildStrengthSessionIndex(history);
  const rows = buildExerciseRows(index.byId.get("r1"));

  assert.deepEqual(rows.map((row) => row.name), ["Bench Press", "Squats", "Bench Press"]);
  assert.equal(new Set(rows.map((row) => row.key)).size, 3, "row keys stay unique across a superset");
  assert.deepEqual(rows[2].topSet, { weightKg: 85, reps: 5 }, "a weight tie goes to the set with more reps");
  assert.equal(rows[2].sets[2].e1rmKg, 0, "20 reps is past where an e1RM means anything");
  assert.equal(rows[2].bestE1rmKg, 85 * (1 + 5 / 30));
  assert.equal(rows[0].records.length, 0, "the lighter superset block claims no record");
  assert.deepEqual(rows[2].records.map((record) => record.kind).sort(), ["e1rm", "weight"]);
  assert.equal(rows[1].records.length, 0, "Squats had no earlier session to beat");
}

console.log("strength session analytics OK");
