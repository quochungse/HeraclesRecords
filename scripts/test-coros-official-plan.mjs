// A plan saved from COROS's official catalogue, converted as the library does.
//
// Measured on 2026-09-23 against "P10035" — COROS's Beginner Sprint Distance
// Triathlon Plan, 12 weeks, 87 sessions — every claim below was false:
//
// 1. **The words are keys.** The plan, each session and each description
//    arrive as localization keys (`P10035`, `P10281`, `P11058`), resolved in
//    the browser against the table the Training Hub web app loads from
//    static.coros.com. The reader showed "P10035" made of sessions "P10281".
// 2. **The steps were dropped.** Every program arrives with its `exercises`,
//    and `nativePlanToDocument` kept the name and four totals. So no session
//    of any COROS plan had anything to open, and a copy of one — Duplicate,
//    or Edit, which forks — was a copy of the names.
// 3. **Distance is centimetres.** A 3.5 km run read as 356 km, and the plan
//    as 13,896 km.
// 4. **`totalSets` counts steps** on anything but strength, so a 30-minute
//    ride "planned 3 sets".
// 5. **Every week is a stage**, unnamed (`stage: 0`), and each became a
//    one-week phase called "Phase N".
//
// The exercise shapes are the live payload's, trimmed of ids.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const adapter = await import(distUrl("corosTrainingPlanAdapter.js"));
const databaseModule = await import(distUrl("database.js"));
const locale = await import(distUrl("corosLocale.js"));
const library = await import(distUrl("trainingLibraryService.js"));

databaseModule.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "coros-official-")));

// ---------------------------------------------------------------------------
// The string table, as the web app's script ships it
// ---------------------------------------------------------------------------
const script = `window.en_US={
  "P10035": "Beginner Sprint Distance Triathlon Plan",
  "P10103": "A 12-week plan designed to help users complete a sprint triathlon.",
  "P10281": "30 min z2 ride",
  "P11058": "The goal today is to get in base miles. Time on the saddle!",
  "P10300": "3x10 {'@'} tempo",
  "T1120": "Warm Up",
  "T4000": "Training",
  "T1122": "Cool Down"
}`;
{
  const table = locale.parseCorosLocaleScript(script);
  assert.equal(table.P10035, "Beginner Sprint Distance Triathlon Plan");
  assert.equal(
    table.P10300,
    "3x10 @ tempo",
    "vue-i18n's literal syntax is taken out — the app shows text, it does not compile messages"
  );
  assert.throws(() => locale.parseCorosLocaleScript("window.en_US=;"), /no table/);
  locale.useCorosLocaleTable(table);

  assert.equal(locale.corosText("P10035"), "Beginner Sprint Distance Triathlon Plan");
  assert.equal(locale.corosText("P1 tempo"), "P1 tempo", "only a whole value that is a key");
  assert.equal(locale.corosText("P99999"), "P99999", "a key the table lacks is left as it came");
  assert.equal(locale.corosText(undefined), undefined);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------
const exercises = [
  { exerciseType: 1, intensityType: 0, intensityValue: 0, intensityValueExtend: 0, hrType: 0, intensityDisplayUnit: 0, isIntensityPercent: false, name: "T1120", overview: "sid_bike_warm_up_dist", sets: 1, sortNo: 16777216, sportType: 2, targetType: 2, targetValue: 300, restType: 3, restValue: 0, isGroup: false, groupId: "0", originId: "425895843250487297", id: "ex-1" },
  { exerciseType: 2, intensityType: 2, intensityValue: 133, intensityValueExtend: 154, hrType: 2, intensityDisplayUnit: 0, isIntensityPercent: false, intensityPercent: 59000, intensityPercentExtend: 74000, name: "T4000", overview: "sid_bike_dist_speed", sets: 1, sortNo: 33554432, sportType: 2, targetType: 2, targetValue: 1800, restType: 3, restValue: 0, isGroup: false, groupId: "0", originId: "425895474420170753", id: "ex-2" },
  { exerciseType: 3, intensityType: 0, intensityValue: 0, intensityValueExtend: 0, hrType: 0, intensityDisplayUnit: 0, isIntensityPercent: false, name: "T1122", overview: "sid_bike_cool_down_dist", sets: 1, sortNo: 50331648, sportType: 2, targetType: 2, targetValue: 300, restType: 3, restValue: 0, isGroup: false, groupId: "0", originId: "425895892642611200", id: "ex-3" }
];

const raw = {
  id: "official-1",
  name: "P10035",
  overview: "P10103",
  totalDay: 14,
  entities: [
    { id: "ent-1", idInPlan: "1", planProgramId: "1", dayNo: 0, sortNo: 1 },
    { id: "ent-2", idInPlan: "2", planProgramId: "2", dayNo: 8, sortNo: 2 },
    { id: "ent-3", idInPlan: "3", planProgramId: "3", dayNo: 10, sortNo: 3 }
  ],
  programs: [
    { id: "prog-1", idInPlan: "1", name: "P10281", overview: "P11058", sportType: 2, duration: 2400, distance: 0, trainingLoad: 50, totalSets: 3, exercises },
    /* A run, 3.5 km in COROS's centimetres, no steps — the totals are all it has. */
    { id: "prog-2", idInPlan: "2", name: "P10300", overview: "", sportType: 1, duration: 1500, distance: 356830, trainingLoad: 42, totalSets: 3, exercises: [] },
    /* Strength keeps its sets: there they are sets. */
    { id: "prog-3", idInPlan: "3", name: "Core", overview: "", sportType: 4, duration: 1200, distance: 0, trainingLoad: 20, totalSets: 9, exercises: [] }
  ],
  weekStages: [
    { weekNo: 1, stage: 0 },
    { weekNo: 2, stage: 0 }
  ]
};

const native = adapter.parseNativeCorosPlan(raw, "2026-09-23T00:00:00.000Z");
const plan = library.nativePlanToDocument(native);

// 1. The words
assert.equal(plan.name, "Beginner Sprint Distance Triathlon Plan");
assert.match(plan.description, /^A 12-week plan/);
const [ride, run, core] = plan.entries;
assert.equal(ride.title, "30 min z2 ride");
assert.equal(ride.workout.name, "30 min z2 ride");
assert.equal(ride.workout.description, "The goal today is to get in base miles. Time on the saddle!");
assert.equal(run.title, "3x10 @ tempo");

// 2. The steps
assert.equal(ride.workout.steps?.length, 3, "the program's three exercises become three steps");
assert.deepEqual(
  ride.workout.steps.map((step) => [step.kind, step.name, step.target_type, step.target_duration_seconds]),
  [
    ["warmup", "Warm Up", "time", 300],
    ["training", "Training", "time", 1800],
    ["cooldown", "Cool Down", "time", 300]
  ],
  "kinds, names off the string table, and time targets"
);
assert.deepEqual(
  ride.workout.steps[1].intensity,
  { type: "heartRate", lowBpm: 133, highBpm: 154 },
  "the heart-rate band survives the conversion"
);
assert.equal(
  ride.workout.steps[0].exercise_name,
  "T1120",
  "the exercise keeps its key, which is what the strength catalogue looks up"
);
assert.equal(run.workout.steps, undefined, "a program with no exercises has no steps to invent");

// 3. Centimetres
assert.equal(run.plannedDistanceMeters, 3568.3, "356,830 cm is 3.57 km, not 357 km");
assert.equal(native.distanceMeters, 3568.3, "and the summary's total converts the same way");

// 4. Sets only where they are sets
assert.equal(ride.plannedStrengthSets, undefined, "a ride's `totalSets` counts its steps");
assert.equal(run.plannedStrengthSets, undefined);
assert.equal(core.plannedStrengthSets, 9);

// 5. No stage where COROS set none
assert.deepEqual(plan.weekStages, [], "stage 0 is Not Set — twelve of them say nothing a week number does not");

// 6. What a save writes back is the program as COROS sent it
assert.equal(ride.corosProgram.name, "P10281", "the raw program keeps its key, so an unedited save writes back exactly what came");
assert.equal(ride.idInPlan, "1");

// With no table at all, the keys are what shows — the state before this.
locale.useCorosLocaleTable(null);
assert.equal(library.nativePlanToDocument(native).name, "P10035");

console.log(
  "coros official plan OK — keys resolved off COROS's string table, steps kept, " +
    "distance in metres, sets only on strength, no unset stages, raw programs kept"
);
