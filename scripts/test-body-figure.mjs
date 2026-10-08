// The Overview's body figure: which body is drawn, and the file it is drawn
// from. Rules a typecheck cannot hold:
//
// - **The physique is height and weight, and nothing else**, read on
//   Trefethen's height-adjusted BMI (1.3 kg / m^2.5), so the same build reads
//   the same at 1.55 m and at 1.90 m. The shape is that number, continuously:
//   between two baked bodies the figure is blended by how far along it is,
//   held at the slimmest and the heaviest past either end. A profile without a
//   usable height or weight has no shape — the panel draws the medium body —
//   never a guess.
// - **VO2max tones the figure and never softens it**: none below the Cooper
//   Institute's Good for the athlete's age and sex, all the way to the toned
//   twin at Superior, evenly between; the figure is read off the median of the
//   four weeks up to the latest reading, and a latest reading over 90 days old
//   reads as none.
// - **COROS's `sex` is 0 male, 1 female**; anything else draws the male figure.
// - **The baked file is whole**: four bodies a sex and a toned twin of each,
//   one topology, every index in range, every body standing on the same ground
//   with its crown at a person's height — a stale or half-written bake fails
//   here, not as a blank stage.
// - **The bodies are in order**: each holds more volume than the one
//   before it, and so does every blend a heavier shape draws, for both sexes; a
//   toned twin is the same size of person; a woman's figure is not a man's.
// - **The drawing is whole**: front and far-side lines, less what the face
//   hides from the front (a depth buffer, as WebGL tested a line); the skin
//   is the triangles facing the camera; the fill line runs from the soles to
//   the crown.
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

// The anchors are the four baked bodies, in order and evenly apart.
assert.deepEqual(
  physique.BODY_ANCHORS.map(([body]) => body),
  ["slim", "medium", "heavy", "veryHeavy"]
);
assert.equal(physique.DEFAULT_SHAPE, 22.5);
const blendAt = (shape) => physique.shapeBlend(shape);
assert.deepEqual(blendAt(15), { from: "slim", to: "slim", t: 0 }, "held at the slimmest below it");
assert.deepEqual(blendAt(18), { from: "slim", to: "slim", t: 0 });
assert.deepEqual(blendAt(22.5), { from: "slim", to: "medium", t: 1 });
assert.deepEqual(blendAt(24.75), { from: "medium", to: "heavy", t: 0.5 });
assert.deepEqual(blendAt(31.5), { from: "heavy", to: "veryHeavy", t: 1 });
assert.deepEqual(blendAt(40), { from: "veryHeavy", to: "veryHeavy", t: 0 }, "held at the heaviest above it");
assert.deepEqual(blendAt(Number.NaN), { from: "slim", to: "slim", t: 0 });

// The shape is the height-adjusted BMI, as read.
assert.ok(Math.abs(at(170, 65).shape - (1.3 * 65) / 1.7 ** 2.5) < 1e-9);

// The point of the height adjustment: one build reads alike at any height.
// At BMI 26.5 a tall athlete draws slimmer than a short one at BMI 25.5.
assert.ok(at(190, 26.5 * 1.9 ** 2).shape < at(155, 25.5 * 1.55 ** 2).shape, "190 cm at BMI 26.5 against 155 cm at 25.5");
// At 1.69 m the two scales agree.
{
  const reading = at(169, 26 * 1.69 ** 2);
  assert.ok(Math.abs(reading.shape - 26) < 1e-9, `${reading.shape}`);
}

// No usable height or weight: no shape.
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
  assert.equal(r.shape, undefined, `no shape for ${JSON.stringify(profile)}`);
}

assert.equal(physique.figureSex(0), "male");
assert.equal(physique.figureSex(1), "female");
assert.equal(physique.figureSex(undefined), "male");
assert.equal(physique.figureSex(2), "male");
assert.equal(physique.readPhysique({ sex: 1 }).sex, "female", "the sex is read without a height or weight");

// --- firmness, from VO2max ---------------------------------------------------

{
  const r = (day, value) => ({ day, value });
  assert.equal(physique.recentVo2max([], "20261008"), undefined, "no reading, no VO2max");
  assert.equal(physique.recentVo2max([r("20261001", 50)], "20261008"), 50);
  // The median of the four weeks up to the latest reading, not the latest alone.
  assert.equal(
    physique.recentVo2max([r("20261001", 50), r("20260920", 47), r("20261005", 58)], "20261008"),
    50
  );
  assert.equal(physique.recentVo2max([r("20261001", 50), r("20260920", 46)], "20261008"), 48);
  // A reading from before those four weeks is not in it.
  assert.equal(physique.recentVo2max([r("20261001", 50), r("20260801", 30)], "20261008"), 50);
  // A latest reading over 90 days old is no reading; at 90 it still counts.
  assert.equal(physique.recentVo2max([r("20260701", 50)], "20261008"), undefined);
  assert.equal(physique.recentVo2max([r("20260710", 50)], "20261008"), 50);
  assert.equal(physique.recentVo2max([r("bad", 50), r("20261001", Number.NaN), r("20261002", 0)], "20261008"), undefined);

  // Good (60th) to Superior (95th) for the age and sex: a man of 35, 44.0–54.0;
  // a woman of 55, 33.0–41.1.
  assert.equal(physique.vo2Firmness(40, 35, 0), 0, "below Good: as size draws it");
  assert.equal(physique.vo2Firmness(44.0, 35, 0), 0);
  assert.ok(Math.abs(physique.vo2Firmness(49, 35, 0) - 0.5) < 1e-9, "halfway to Superior, halfway toned");
  assert.equal(physique.vo2Firmness(54.0, 35, 0), 1);
  assert.equal(physique.vo2Firmness(70, 35, 0), 1, "held at the toned twin past Superior");
  assert.equal(physique.vo2Firmness(41.1, 55, 1), 1, "graded for her age and sex");
  assert.equal(physique.vo2Firmness(33.0, 55, 1), 0);

  // Through a profile: the age on the day, and none without a recent reading.
  const runner = { sex: 0, birthday: 19900301 };
  assert.ok(Math.abs(physique.readFirmness(runner, [r("20261005", 49)], "20261008") - 0.5) < 1e-9);
  assert.equal(physique.readFirmness(runner, [], "20261008"), 0);
  assert.equal(physique.readFirmness(null, [r("20261005", 60)], "20261008"), 1, "no profile reads as a man of 30");
}

// --- the baked file ----------------------------------------------------------

const SEXES = ["male", "female"];
const BODIES = physique.BODY_ANCHORS.map(([body]) => body);
const BAKED = [...BODIES, ...BODIES.map((body) => `${body}Fit`)];
assert.deepEqual(Object.keys(file.bodies).sort(), [...SEXES].sort());
for (const sex of SEXES) assert.deepEqual(Object.keys(file.bodies[sex]), BAKED);
assert.match(file.source, /MakeHuman/);
assert.deepEqual(file.pose, { armDeg: 22, elbowDeg: 20 });

const figures = {};
for (const sex of SEXES) {
  for (const p of BAKED) {
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

/** The mesh's volume in dm³: it is closed and wound outward, so the signed sum is positive. */
const volume = ({ positions: v, triangles: t }) => {
  let sum = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3];
    sum +=
      v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) -
      v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) +
      v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return sum / 6;
};

for (const sex of SEXES) {
  const heights = BAKED.map((p) => box(figures[sex][p].positions).height);
  // MakeHuman's units are decimetres: a person is 15–19 of them.
  for (const h of heights) assert.ok(h > 15 && h < 19.5, `${sex}: ${h} dm tall`);
  // One height parameter for every body: the figure says size, not stature.
  assert.ok(Math.max(...heights) - Math.min(...heights) < 0.6, `${sex}: bodies stand at one height`);

  // Each body holds more than the one before, and so does every blend of a
  // heavier shape. Measured as the mesh's volume, not a width across one
  // band: a band either misses the heavier bodies' sides or takes in their
  // arms, and both broke the order.
  const volumes = BODIES.map((p) => volume(figures[sex][p]));
  assert.ok(
    volumes.every((v, i) => v > 0 && (i === 0 || volumes[i - 1] < v)),
    `${sex}: volume grows from slim to very heavy (${volumes.map((v) => v.toFixed(1))} dm³)`
  );
  let before = 0;
  for (let shape = 18.5; shape <= 31.5; shape += 0.5) {
    const v = volume(math.blendFigure(file, sex, shape));
    assert.ok(v > before, `${sex}: shape ${shape} holds more than the one before (${v.toFixed(1)} dm³)`);
    before = v;
  }
  // Continuous: at each anchor the blend is that body, so a shape crossing it
  // moves the figure by a step as small as the shape's, and never jumps.
  for (const [body, anchor] of physique.BODY_ANCHORS) {
    const blended = math.blendFigure(file, sex, anchor).positions;
    const baked = figures[sex][body].positions;
    assert.ok(blended.every((v, i) => Math.abs(v - baked[i]) < 1e-5), `${sex}: shape ${anchor} is the ${body} body`);
  }
  // Each end is its own baked body, unblended.
  assert.deepEqual(math.blendFigure(file, sex, 15).positions, figures[sex].slim.positions);
  assert.deepEqual(math.blendFigure(file, sex, 40).positions, figures[sex].veryHeavy.positions);

  // Firmness: none is the shape as it was, all of it is the toned twin, and a
  // toned twin is the same size of person — within the few percent muscle's
  // density and MakeHuman's weight range at the two ends allow — but a
  // different body (a woman's goes half as far, so by as little as ~2 mm a
  // vertex on the slimmest; 1 mm still catches a twin baked as its body).
  for (const [body, anchor] of physique.BODY_ANCHORS) {
    assert.deepEqual(math.blendFigure(file, sex, anchor, 0).positions, math.blendFigure(file, sex, anchor).positions);
    const toned = math.blendFigure(file, sex, anchor, 1).positions;
    const twin = figures[sex][`${body}Fit`].positions;
    assert.ok(toned.every((v, i) => Math.abs(v - twin[i]) < 1e-5), `${sex}: firmness 1 at ${anchor} is ${body}Fit`);
    const share = volume(figures[sex][`${body}Fit`]) / volume(figures[sex][body]);
    assert.ok(share > 0.85 && share < 1.1, `${sex} ${body}Fit: ${(share * 100).toFixed(0)}% of ${body}`);
    const plain = figures[sex][body].positions;
    let moved = 0;
    for (let i = 0; i < plain.length; i += 3) {
      moved += Math.hypot(plain[i] - twin[i], plain[i + 1] - twin[i + 1], plain[i + 2] - twin[i + 2]);
    }
    assert.ok(moved / (plain.length / 3) > 0.01, `${sex} ${body}Fit: a different body (${((moved / (plain.length / 3)) * 100).toFixed(1)} mm)`);
  }
  // Between anchors, halfway toned is halfway between the plain and toned blends.
  {
    const plain = math.blendFigure(file, sex, 24, 0).positions;
    const toned = math.blendFigure(file, sex, 24, 1).positions;
    const half = math.blendFigure(file, sex, 24, 0.5).positions;
    assert.ok(half.every((v, i) => Math.abs(v - (plain[i] + toned[i]) / 2) < 1e-5), `${sex}: firmness blends linearly`);
  }
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
  // About half the mesh faces the camera. Of that, what the lips, lids and
  // ears hide is not drawn: a few hundred lines, never a share of the body.
  const total = geometry.edges.length / 2;
  const hidden = total - count(d.front) - count(d.back);
  const shown = count(d.front) / total;
  assert.ok(shown > 0.4 && shown < 0.6, `about half the lines in front (${shown.toFixed(2)})`);
  assert.ok(hidden > 100 && hidden < total * 0.12, `the hidden lines left out (${hidden} of ${total})`);
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
  `body figure OK — ${file.vertexCount} vertices, ${figures.male.medium.triangles.length / 3} triangles, four bodies a sex and their toned twins, blended across adjusted BMI ${physique.BODY_ANCHORS.map(([, at]) => at).join(" · ")}`
);
