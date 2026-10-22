// The Exercises Library's arithmetic and the body figure's zoom.
//
// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types; the module graph has extensionless imports, so the
// resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (...parts) =>
  import(`${pathToFileURL(path.join(repoRoot, ...parts)).href}?cacheBust=${Date.now()}`);

const figure = await load("src", "calendar", "bodyFigure.ts");
const shapes = await load("src", "calendar", "bodyShapes.ts");
const model = await load("src", "training-library", "exerciseLibraryModel.ts");

// --- the body figure ----------------------------------------------------------

// Every path of the artwork parses, arcs with their run-together flags included.
for (const view of ["front", "back"]) {
  for (const [slug, paths] of Object.entries(shapes.BODY_SHAPES[view])) {
    for (const d of paths) {
      const box = figure.pathBounds(d);
      assert.ok(box.every(Number.isFinite), `${view} ${slug} has a finite box`);
      assert.ok(box[0] < box[2] && box[1] < box[3], `${view} ${slug} has an area`);
    }
  }
}

// Boxes read off the artwork by hand: the chest on the front, the glutes on the back.
const near = (actual, expected, label) =>
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 2, `${label}: ${actual} vs ${expected}`));
near(figure.muscleBounds("front", "chest"), [251, 316, 476, 438], "chest");
near(figure.muscleBounds("back", "glutes"), [974, 614, 1194, 780], "glutes");
assert.equal(figure.muscleBounds("front", "lats"), null, "the lats have no shape on the front");

// A zoom keeps the aspect it is drawn at, and holds what it frames.
const legs = ["quads", "hamstrings", "glutes", "adductors", "calves"];
const legsBox = figure.zoomViewBox("front", legs, 160, 320).split(" ").map(Number);
assert.ok(Math.abs(legsBox[2] / legsBox[3] - 0.5) < 0.01, "the legs are framed at 1:2");
const quads = figure.muscleBounds("front", "quads");
assert.ok(legsBox[0] <= quads[0] && legsBox[0] + legsBox[2] >= quads[2], "the frame holds the quads across");
assert.ok(legsBox[3] < 1448 * 0.6, "and is a zoom, not the whole figure");
assert.equal(figure.zoomViewBox("front", ["lats"], 160, 320), null, "nothing to frame draws the whole figure");

// The arms are read on one side, or the frame spans the wingspan.
const bothArms = figure.zoomViewBox("front", ["biceps", "forearms"], 160, 320).split(" ").map(Number);
const oneArm = figure.zoomViewBox("front", ["biceps", "forearms"], 160, 320, true).split(" ").map(Number);
assert.ok(oneArm[2] < bothArms[2] * 0.7, "one arm is framed tighter than two");

assert.equal(figure.SLUG_MUSCLE.gluteal, "glutes");
assert.deepEqual(figure.viewsOf(legs), ["front", "back"]);
assert.deepEqual(figure.viewsOf(["chest", "abs"]), ["front"]);

// --- the model ----------------------------------------------------------------

// COROS's muscle codes: 1 shoulders, 2 chest, 4 triceps, 6 abs, 7 quads,
// 8 hamstrings, 9 adductors, 12 lats, 14 glutes. Equipment 2 dumbbells, 3 barbells.
const option = (id, name, primary, involved, equipmentCodes = [], extra = {}) => ({
  id, name, primaryMuscles: primary, involvedMuscles: involved, equipmentCodes, targetType: 3, ...extra
});
const options = [
  option("squat", "Dumbbell Goblet Squat", [7, 14], [9, 6], [2]),
  option("bench", "Barbell Bench Press", [2], [4, 1], [3]),
  option("rdl", "Barbell Romanian Deadlift", [8, 14], [], [3]),
  option("plank", "Plank", [6], [], [], { targetType: 2 }),
  option("pullup", "Pull Up", [12], [], [6]),
  option("crunch", "Crunch", [6], []),
  option("squat", "Dumbbell Goblet Squat", [7, 14], [9, 6], [2]),
  option("blank", "", [7], [])
];
const rows = model.libraryExercises(options, (entry) => entry.name, "en");

assert.deepEqual(
  rows.map((row) => row.id),
  ["bench", "rdl", "crunch", "squat", "plank", "pullup"],
  "one row per id, none without a name, in name order"
);

const squat = rows.find((row) => row.id === "squat");
assert.deepEqual(squat.primary, ["quads", "glutes"], "COROS's primary movers lead");
assert.deepEqual([...squat.involved].sort(), ["abs", "adductors"]);
assert.equal(squat.mainPart, "legs");
assert.deepEqual(squat.otherParts, ["core"]);
const shares = model.muscleShares(squat);
assert.ok(Math.abs(shares.reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-9, "the shares sum to 1");
assert.ok(shares[0].primary && !shares.at(-1).primary, "largest first, primary before involved");

assert.equal(model.effortStep(rows.find((row) => row.id === "bench")), 0, "a loaded lift is decided by its weight");
assert.equal(model.effortStep(rows.find((row) => row.id === "plank")), 1, "a hold with no load is minimal");

const base = { ...model.NO_EXERCISE_FILTER, favorites: new Set(["plank", "rdl"]) };

// A part narrows to what works it, hardest first.
const legRows = model.narrowExercises(rows, { ...base, part: "legs" });
assert.deepEqual(new Set(legRows.map((row) => row.id)), new Set(["squat", "rdl"]));
// A muscle narrows within it, and puts the movement that is most about it first.
const glutes = model.narrowExercises(rows, { ...base, part: "legs", muscle: "hamstrings" });
assert.deepEqual(glutes.map((row) => row.id), ["rdl"]);
const abs = model.narrowExercises(rows, { ...base, part: "core", muscle: "abs" });
assert.equal(abs[0].id, "crunch", "a crunch is all abs; the squat only involves them");
assert.equal(abs.at(-1).id, "plank", "and a hold with no load is ranked as the picker ranks it, last");
assert.deepEqual(new Set(abs.map((row) => row.id)), new Set(["crunch", "plank", "squat"]));

// Favourites, equipment and the search all narrow too.
assert.deepEqual(model.narrowExercises(rows, { ...base, favoritesOnly: true }).map((row) => row.id), ["rdl", "plank"]);
assert.deepEqual(model.narrowExercises(rows, { ...base, query: "  BENCH " }).map((row) => row.id), ["bench"]);
const barbell = model.narrowExercises(rows, { ...base, equipment: "barbell" }).map((row) => row.id);
assert.ok(barbell.includes("bench") && barbell.includes("rdl") && !barbell.includes("plank"));

// The body's counts are taken under everything else, so a count is reachable.
const counts = model.bodyCounts(rows, { ...base, favoritesOnly: true });
assert.equal(counts.total, 2);
assert.equal(counts.parts.get("legs"), 1, "only the deadlift is a favourite leg movement");
assert.equal(counts.muscles.get("abs"), 1, "the plank");
assert.equal(counts.parts.get("chest"), 0);
// …and the equipment's under everything but the equipment, offering only what is used.
const equipment = model.equipmentCounts(rows, { ...base, equipment: "barbell", part: "legs" });
assert.ok(equipment.every((entry) => entry.count >= 0));
assert.ok(!equipment.some((entry) => entry.equipment === "sled"), "equipment no movement uses is not offered");
const barbellEntry = equipment.find((entry) => entry.equipment === "barbell");
assert.equal(barbellEntry?.count, 1, "of the leg movements, one is on a barbell");

// A COROS movement is described by its row and its entry in
// exerciseReview.ts, by its key — never by its name. COROS has no code for the
// obliques: a side plank leads with them, a bicycle crunch shares them with the
// abs, a plank holds with them, a crunch does not use them.
const facets = await load("src", "calendar", "exerciseFacets.ts");
const coros = (key, name, primary, involved, codes = []) =>
  facets.optionFacets(option(key, name, primary, involved, codes, { corosKey: key }), name);
const sidePlank = coros("T1185", "Side Plank", [6], [], [1]);
assert.ok(sidePlank.loads.obliques > sidePlank.loads.abs, "a side plank works the obliques first");
const bicycle = coros("T1076", "Bicycle Crunches", [6], [], [1]);
assert.equal(bicycle.loads.obliques, bicycle.loads.abs, "a bicycle crunch works both alike, which its name does not say");
const plank = coros("T1010", "Planks", [6], [13], [1]);
assert.ok(plank.loads.obliques > 0 && plank.loads.obliques < plank.loads.abs, "a plank involves them");
assert.equal(coros("T1006", "Sit Ups", [6], [], [1]).loads.obliques, undefined, "a sit-up does not");
assert.equal(coros("T9999", "Russian Twist", [6], [], [1]).loads.obliques, undefined,
  "a movement nobody reviewed is as COROS sends it, whatever its name says");
// The neck, which COROS files under the traps.
const neck = coros("T1074", "Seated Head Harness Neck Resistance", [11], [], [16]);
assert.ok(neck.loads.neck > neck.loads.traps && neck.bodyParts.includes("neck"));
// What COROS files wrongly is corrected per movement: a squat is not hamstring
// work, and an L-sit's glutes are taken out rather than kept.
const corosSquat = coros("T1061", "Squats", [8], [7, 14], [1]);
assert.ok(corosSquat.loads.quads > corosSquat.loads.hamstrings && corosSquat.loads.glutes > corosSquat.loads.hamstrings);
const lsit = coros("T1161", "The L Sit", [14], [6, 7], [1]);
assert.equal(lsit.loads.glutes, undefined);
assert.ok(lsit.loads.abs > lsit.loads.quads);
// Only a movement that is not COROS's is read off its name.
const own = facets.optionFacets(option("own", "Russian Twist", [], []), "Russian Twist");
assert.ok(own.loads.obliques > 0, "an athlete's own movement has only its name to go on");

// Equipment is COROS's codes, its "Ropes" (5) being the cable stack, unless
// the review states otherwise; the name adds nothing.
assert.deepEqual(coros("T1017", "Lateral Dumbbell Raise", [1], [], [2]).equipment, ["dumbbell"]);
assert.deepEqual(coros("T1352", "Face Pull", [1], [], [5]).equipment, ["cable"]);
assert.deepEqual(coros("T1207", "Indoor Rower", [7], [], [13]).equipment, ["rower"]);
assert.deepEqual(coros("T1081", "Trx Suspended Crunches", [6], [], [5]).equipment, ["suspension"],
  "a TRX is a suspension trainer, not the cable stack COROS files it under");
assert.deepEqual(coros("T1080", "Battle Ropes", [3], [], [16]).equipment, ["rope"]);
assert.deepEqual(coros("T1002", "Pull Ups", [12], [], [6]).equipment, ["bodyweight", "machine"]);
assert.deepEqual(coros("T1036", "Machine Crunches", [6], [], [6]).equipment, ["machine"],
  "COROS's code stands, and the name's \"crunch\" adds no bodyweight");
// "Others" is what is left when nothing else is named.
assert.deepEqual(coros("T9998", "Thing", [6], [], [16, 1]).equipment, ["bodyweight"]);
assert.deepEqual(coros("T1370", "Wrist Roller", [5], [], [16]).equipment, ["other"]);
// COROS's 10 is the abductors, a muscle of the legs drawn on the glutes' shape.
const walk = facets.optionFacets(option("walk", "Lateral Band Walks", [10], [14], [9]), "Lateral Band Walks");
assert.ok(walk.loads.abductors > walk.loads.glutes);
assert.ok(walk.bodyParts.includes("legs"));
assert.equal(figure.MUSCLE_SLUG.abductors, "gluteal");
assert.equal(figure.SLUG_MUSCLE.gluteal, "glutes", "the shape is still the glutes' first");
assert.deepEqual(figure.SLUG_MUSCLES.gluteal, ["glutes", "abductors"]);

// Picking a muscle carries its part; picking it again steps back to the part.
assert.deepEqual(model.pickMuscle({ part: null, muscle: null }, "glutes"), { part: "legs", muscle: "glutes" });
assert.deepEqual(model.pickMuscle({ part: "legs", muscle: "glutes" }, "glutes"), { part: "legs", muscle: null });

console.log("exercise library tests passed");
