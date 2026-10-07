// The Overview's body figure: which body is drawn, and the file it is drawn
// from. Rules a typecheck cannot hold:
//
// - **The physique is height and weight, and nothing else**, read on
//   Trefethen's height-adjusted BMI (1.3 kg / m^2.5): under 20 is Lean, 26 and
//   over Heavy, Medium between, so the same build reads the same at 1.55 m and
//   at 1.90 m. A profile without a usable height or weight has no physique —
//   the panel draws the Medium figure — never a guess.
// - **COROS's `sex` is 0 male, 1 female**; anything else draws the male figure.
// - **The baked file is whole**: six bodies, one topology, every index in
//   range, every body standing on the same ground with its crown at a person's
//   height — a stale or half-written bake fails here, not as a blank stage.
// - **The bodies are in order**: Heavy is wider at the waist than Medium, and
//   Medium than Lean, for both sexes; a woman's figure is not a man's.
// - **The drawing is whole**: front and far-side lines split the edges between
//   them, the skin is the triangles facing the camera, and the fill line runs
//   from the soles to the crown.
// - **The level and the frame agree**: the words stand where the stylesheet
//   puts the fill line.
// - **100% is its own colour**: green for full recovery only, 70–99 yellow.
//
// Mode: renderer TypeScript, extensionless imports in the graph, so the
// resolver hook comes along. Run through Electron because a distro Node built
// without Amaro cannot strip types.
//   cross-env ELECTRON_RUN_AS_NODE=1 electron --experimental-strip-types \
//     --import ./scripts/register-ts-ext.mjs scripts/test-body-figure.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (relative) =>
  import(`${pathToFileURL(path.join(repoRoot, relative)).href}?cacheBust=${Date.now()}`);

const physique = await load("src/training/body/physique.ts");
const math = await load("src/training/body/bodyFigureMath.ts");
const drawing = await load("src/training/body/bodyFigureDrawing.ts");
const file = JSON.parse(readFileSync(path.join(repoRoot, "src/training/body/bodyFigures.json"), "utf8"));

// --- the physique ------------------------------------------------------------

/** The weight at which `cm` reads `index` on the height-adjusted scale. */
const kg = (index, cm) => (index * (cm / 100) ** 2.5) / 1.3;
const at = (cm, weightKg, sex = 0) => physique.readPhysique({ sex, statureCm: cm, weightKg });

assert.equal(at(170, 55).physique, "lean", "170 cm, 55 kg (19.4)");
assert.equal(at(170, 65).physique, "medium", "170 cm, 65 kg (22.4)");
assert.equal(at(170, 75).physique, "medium", "170 cm, 75 kg (25.9)");
assert.equal(at(170, 80).physique, "heavy", "170 cm, 80 kg (27.6)");
assert.equal(at(158, 45, 1).physique, "lean");
assert.equal(at(158, 52, 1).physique, "medium");
assert.equal(at(158, 63, 1).physique, "heavy");

// The lines themselves: the lower bound of a class belongs to it.
assert.equal(at(175, kg(19.99, 175)).physique, "lean");
assert.equal(at(175, kg(20, 175)).physique, "medium");
assert.equal(at(175, kg(25.99, 175)).physique, "medium");
assert.equal(at(175, kg(26, 175)).physique, "heavy");

// The point of the height adjustment: one build reads alike at any height.
// A tall athlete at BMI 26.5 is not Heavy; a short one at BMI 25.5 is.
assert.equal(at(190, 26.5 * 1.9 ** 2).physique, "medium", "190 cm at BMI 26.5");
assert.equal(at(155, 25.5 * 1.55 ** 2).physique, "heavy", "155 cm at BMI 25.5");
// At 1.69 m the two scales agree.
{
  const reading = at(169, 26 * 1.69 ** 2);
  assert.ok(Math.abs(reading.bmi - 26) < 1e-9, `${reading.bmi}`);
}

// No usable height or weight: no physique, and no BMI to show.
for (const profile of [
  null,
  undefined,
  {},
  { statureCm: 170 },
  { weightKg: 65 },
  { statureCm: 0, weightKg: 0 },
  { statureCm: 170, weightKg: 0 },
  { statureCm: Number.NaN, weightKg: 65 },
  { statureCm: 1700, weightKg: 65 }
]) {
  const r = physique.readPhysique(profile);
  assert.equal(r.physique, undefined, `no physique for ${JSON.stringify(profile)}`);
  assert.equal(r.bmi, undefined);
}

assert.equal(physique.figureSex(0), "male");
assert.equal(physique.figureSex(1), "female");
assert.equal(physique.figureSex(undefined), "male");
assert.equal(physique.figureSex(2), "male");
assert.equal(physique.readPhysique({ sex: 1 }).sex, "female", "the sex is read without a height or weight");

// --- the baked file ----------------------------------------------------------

const SEXES = ["male", "female"];
const PHYSIQUES = ["lean", "medium", "heavy"];
assert.deepEqual(Object.keys(file.bodies).sort(), [...SEXES].sort());
for (const sex of SEXES) assert.deepEqual(Object.keys(file.bodies[sex]).sort(), [...PHYSIQUES].sort());
assert.match(file.source, /MakeHuman/);
assert.deepEqual(file.pose, { armDeg: 22, elbowDeg: 20 });

const figures = {};
for (const sex of SEXES) {
  for (const p of PHYSIQUES) {
    const g = math.decodeFigure(file, sex, p);
    assert.equal(g.positions.length, file.vertexCount * 3, `${sex} ${p}: one position per vertex`);
    assert.ok(g.triangles.length > 0 && g.triangles.length % 3 === 0);
    for (const i of g.triangles) assert.ok(i < file.vertexCount, `${sex} ${p}: index ${i} in range`);
    assert.ok(g.edges.length > g.triangles.length / 2, "edges come from the triangles");
    for (const v of g.positions) assert.ok(Number.isFinite(v));
    (figures[sex] ??= {})[p] = g;
  }
}

// Every vertex is used: the decimator keeps only vertices with faces.
{
  const used = new Set(figures.male.medium.triangles);
  assert.equal(used.size, file.vertexCount, "no vertex left out of every triangle");
}

// Edges are each drawn once, either way round.
{
  const { edges } = figures.male.medium;
  const keys = new Set();
  for (let e = 0; e < edges.length; e += 2) {
    const a = Math.min(edges[e], edges[e + 1]);
    const b = Math.max(edges[e], edges[e + 1]);
    assert.notEqual(a, b);
    keys.add(a * 65536 + b);
  }
  assert.equal(keys.size, edges.length / 2);
}

const box = (positions) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  return { min, max, height: max[1] - min[1] };
};

/** The figure's width across a band at `from`–`to` of its height, arms left out. */
const torsoWidth = (positions, from, to) => {
  const b = box(positions);
  const xs = [];
  for (let i = 0; i < positions.length; i += 3) {
    const h = (positions[i + 1] - b.min[1]) / b.height;
    // The arms hang beside the waist; the torso is the middle of the band.
    if (h >= from && h <= to && Math.abs(positions[i]) < b.height * 0.13) xs.push(positions[i]);
  }
  return Math.max(...xs) - Math.min(...xs);
};

for (const sex of SEXES) {
  const heights = PHYSIQUES.map((p) => box(figures[sex][p].positions).height);
  // MakeHuman's units are decimetres: a person is 15–19 of them.
  for (const h of heights) assert.ok(h > 15 && h < 19.5, `${sex}: ${h} dm tall`);
  // One height parameter for every body: the figure says size, not stature.
  assert.ok(Math.max(...heights) - Math.min(...heights) < 0.6, `${sex}: bodies stand at one height`);

  const waist = PHYSIQUES.map((p) => torsoWidth(figures[sex][p].positions, 0.6, 0.64));
  assert.ok(waist[0] < waist[1] && waist[1] < waist[2], `${sex}: waist Lean < Medium < Heavy (${waist.map((w) => w.toFixed(2))})`);
}

{
  // A woman's figure is its own: narrower shoulders against wider hips.
  const ratio = (g) => torsoWidth(g.positions, 0.8, 0.83) / torsoWidth(g.positions, 0.5, 0.53);
  assert.ok(ratio(figures.female.medium) < ratio(figures.male.medium), "shoulder-to-hip is a woman's, not a man's");
}

// --- the drawing --------------------------------------------------------------

{
  const geometry = figures.male.medium;
  const d = drawing.drawFigure(geometry);
  assert.equal(d.height, 2000);
  assert.ok(d.width > d.height * 0.3 && d.width < d.height * 0.6, `a person's width (${d.width})`);
  const count = (layers) => layers.reduce((n, layer) => n + (layer.d.match(/M/g) ?? []).length, 0);
  assert.equal(count(d.front) + count(d.back), geometry.edges.length / 2, "every edge is drawn once, in front or behind");
  assert.ok(count(d.front) > count(d.back), "more of the mesh faces the camera than not, from the front");
  const skin = (d.skin.match(/M/g) ?? []).length;
  const triangles = geometry.triangles.length / 3;
  assert.ok(skin > triangles * 0.4 && skin < triangles * 0.6, `about half the triangles face the camera (${skin} of ${triangles})`);
  assert.ok(count(d.rim) < skin, "the rim is drawn only where the surface turns away");
  for (const layer of [...d.front, ...d.back, ...d.rim]) assert.ok(layer.strength >= 0 && layer.strength <= 1);
  // Whole numbers inside the drawing's box.
  for (const value of d.skin.match(/-?\d+(\.\d+)?/g)) {
    assert.ok(Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= Math.max(d.width, d.height));
  }
  // The fill line climbs from the soles to the crown.
  assert.ok(Math.abs(d.levelY(0) - d.height) < d.height * 0.03, `level 0 at the soles (${d.levelY(0)})`);
  assert.ok(d.levelY(1) < d.height * 0.03, `level 1 at the crown (${d.levelY(1)})`);
  assert.ok(d.levelY(0.25) > d.levelY(0.5) && d.levelY(0.5) > d.levelY(0.75));
  assert.ok(d.levelEdge > 0);
}

// --- brightness, the fill line, the frame -----------------------------------

{
  const { positions, edges } = figures.male.medium;
  const k = math.lineBrightness(positions, edges);
  assert.equal(k.length, file.vertexCount);
  for (const v of k) assert.ok(v >= 0.3 && v <= 1, "every vertex lit between the floor and full");
  assert.ok(k.some((v) => v === 1) && k.some((v) => v < 0.6), "dense parts are dimmed, open parts are not");
}

// Full recovery has its own colour: 100 green, 99 already yellow.
assert.equal(math.figureToneFor(100), "full");
assert.equal(math.figureToneFor(99.6), "full", "COROS's figure is drawn rounded");
assert.equal(math.figureToneFor(99), "high");
assert.equal(math.figureToneFor(70), "high");
assert.equal(math.figureToneFor(69), "mid");
assert.equal(math.figureToneFor(40), "mid");
assert.equal(math.figureToneFor(39), "low");
assert.equal(math.figureToneFor(undefined), "neutral");
assert.equal(math.figureToneFor(0), "neutral", "a 0 from COROS is no reading");

const { WIDE_FRAME, NARROW_FRAME } = math;
assert.equal(math.levelInFrame(0), WIDE_FRAME.feet, "an empty figure's line is at the soles");
assert.equal(math.levelInFrame(1), WIDE_FRAME.feet + WIDE_FRAME.span, "a full one's at the crown");
assert.equal(math.levelInFrame(2), math.levelInFrame(1));
for (const frame of [WIDE_FRAME, NARROW_FRAME]) {
  assert.ok(frame.feet + frame.span < 1, "the crown stays inside the frame");
}
assert.ok(NARROW_FRAME.feet > WIDE_FRAME.feet + 0.05, "a narrow stage leaves room under the feet for the words");
{
  // The stylesheet places the figure in both frames and switches at one width.
  const css = readFileSync(path.join(repoRoot, "src/styles.css"), "utf8");
  const pct = (fraction) => `${Math.round(fraction * 100)}%`;
  const placed = (frame) => new RegExp(`bottom: ${pct(frame.feet)};[^}]*height: ${pct(frame.span)};`);
  const base = css.match(/\n\.body-figure \{[^}]*\}/)?.[0] ?? "";
  assert.match(base, placed(NARROW_FRAME), "the narrow frame is the figure's own");
  const wide = css.match(new RegExp(`@container recovery-figure \\(min-width: ${math.WIDE_STAGE_MIN_PX}px\\) \\{\\s*\\.body-figure \\{[^}]*\\}`))?.[0] ?? "";
  assert.match(wide, placed(WIDE_FRAME), "the wide frame from the switch width");
}

console.log(
  `body figure OK — ${file.vertexCount} vertices, ${figures.male.medium.triangles.length / 3} triangles, six bodies, adjusted BMI lines at ${physique.LEAN_BELOW_BMI} and ${physique.HEAVY_FROM_BMI}`
);
