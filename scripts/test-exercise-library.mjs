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

// COROS files the whole abdominal wall under 6 and has no code for the
// obliques; the name says which part of the wall a movement works.
const facets = await load("src", "calendar", "exerciseFacets.ts");
const twist = facets.optionFacets(option("twist", "Russian Twist", [6], []), "Russian Twist");
assert.ok(twist.loads.obliques > twist.loads.abs, "a twist works the obliques first");
const plank = facets.optionFacets(option("plank2", "Plank", [6], []), "Plank");
assert.ok(plank.loads.obliques > 0 && plank.loads.obliques < plank.loads.abs, "a plank involves them");
const crunch = facets.optionFacets(option("crunch2", "Crunch", [6], []), "Crunch");
assert.equal(crunch.loads.obliques, undefined, "a crunch does not");
const curl = facets.optionFacets(option("curl", "Side Bend Curl", [3], []), "Side Bend Curl");
assert.equal(curl.loads.obliques, undefined, "nor does a movement COROS does not file under the abdominal wall");

// Equipment is COROS's codes, with what the name adds: "Front Arm Raise"
// names no equipment, and COROS files it under dumbbells (2); its "Ropes" (5)
// is the cable stack, and the kinds only a code names are kept.
const raise = facets.optionFacets(option("raise", "Front Arm Raise", [1], [], [2]), "Front Arm Raise");
assert.deepEqual(raise.equipment, ["dumbbell"]);
assert.deepEqual(facets.optionFacets(option("pull", "Face Pull", [1], [], [5]), "Face Pull").equipment, ["cable"]);
assert.deepEqual(facets.optionFacets(option("rower", "Indoor Rower", [12], [], [13]), "Indoor Rower").equipment, ["rower"]);
const trx = facets.optionFacets(option("trx", "TRX Row", [12], [], [5]), "TRX Row");
assert.ok(trx.equipment.includes("cable") && trx.equipment.includes("suspension"), "a name keeps the kinds no code has");
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
