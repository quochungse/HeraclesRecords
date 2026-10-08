// Writes src/training/body/bodyFigures.json: the low-poly human figures the
// Overview's recovery panel draws, four per sex and a toned twin of each, which
// the app blends between by the athlete's height and weight (`BODY_ANCHORS` in
// physique.ts) and their VO2max (`vo2Firmness`).
//
//   npm run body-figures:bake
//
// Like the fonts and the region outlines, the output is committed and a build
// never runs this. Everything comes from MakeHuman (CC0, pinned below): its base
// mesh, its macro and measurement targets for the body shapes, and its default
// skeleton and skin weights to bring the arms in from the base A-pose. The
// figures were tuned by eye on rendered samples with the athlete; the presets
// below are those, not a model of anyone's body.
//
// Every body is read through one low-poly topology — the decimator keeps a
// subset of the base mesh's own vertices — so the file holds one triangle list
// and, per body, only positions.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { decimate } from "./body-figures/decimate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(root, "src/training/body/bodyFigures.json");

const MAKEHUMAN_COMMIT = "a8bc2d54ff0ac92e78ff71431b1023eda42bf482";
const MAKEHUMAN_DATA = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${MAKEHUMAN_COMMIT}/makehuman/data`;
const CACHE = path.join(root, "node_modules/.cache/makehuman", MAKEHUMAN_COMMIT);

/** Vertices the low-poly figure keeps, out of the body's ~13,400. */
const LOW_POLY_VERTICES = 2800;
/** Arms this far out from the body's side, elbows this far from straight. */
const ARM_DEG = 22;
const ELBOW_DEG = 20;
const RACE = { african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 };

const LR = (name, k) => [[`l-${name}`, k], [`r-${name}`, k]];

// `gender` is MakeHuman's macro: 0 female, 1 male. MakeHuman's weight and
// muscle range is narrow (its heaviest waist is ~5 cm wider than its average),
// so `gain` scales the muscle/weight targets up to read at the size the figure
// is drawn; `extras` are its measurement targets at face value.
const PRESETS = {
  male: {
    // The smallest figure: a slim build, not an underweight one.
    slim: {
      gender: 1, muscle: 0.55, weight: 0, proportions: 0.8, gain: 1.6,
      extras: [["measure-thigh-circ-incr", 0.15], ["measure-calf-circ-decr", 0.2]]
    },
    medium: { gender: 1, muscle: 0.5, weight: 0.5, proportions: 0.8, gain: 1.6, extras: [] },
    // Heavier, not a warning: a fuller waist and limbs, a belly that is there
    // without being the subject.
    heavy: {
      gender: 1, muscle: 0.4, weight: 0.82, proportions: 0.8, gain: 1.5,
      extras: [
        ["stomach-pregnant-incr", 0.12], ["measure-waist-circ-incr", 0.25], ["measure-hips-circ-incr", 0.1],
        ...LR("upperarm-fat-incr", 0.2), ...LR("upperleg-fat-incr", 0.2),
        ...LR("lowerarm-fat-incr", 0.1), ...LR("lowerleg-fat-incr", 0.1)
      ]
    },
    // Heavy carried further, in the same places and still without a caricature.
    veryHeavy: {
      gender: 1, muscle: 0.35, weight: 1, proportions: 0.8, gain: 1.6,
      extras: [
        ["stomach-pregnant-incr", 0.22], ["measure-waist-circ-incr", 0.4], ["measure-hips-circ-incr", 0.18],
        ...LR("upperarm-fat-incr", 0.32), ...LR("upperleg-fat-incr", 0.32),
        ...LR("lowerarm-fat-incr", 0.18), ...LR("lowerleg-fat-incr", 0.18)
      ]
    }
  },
  // A woman's figure is its own preset, not a man's made smaller: waist to hip,
  // a bust, narrower shoulders, a slimmer neck and upper arm.
  female: {
    slim: {
      gender: 0, muscle: 0.45, weight: 0, proportions: 1, gain: 1.6,
      extras: [
        ["measure-waist-circ-decr", 0.3], ["measure-bust-circ-incr", 0.1], ["measure-shoulder-dist-decr", 0.2],
        ["measure-neck-circ-decr", 0.35], ["measure-upperarm-circ-decr", 0.4], ["measure-thigh-circ-incr", 0.06],
        ["measure-calf-circ-decr", 0.08], ["measure-hips-circ-incr", 0.12], ["buttocks-volume-incr", 0.25],
        ...LR("upperleg-fat-decr", 0.1), ...LR("upperarm-fat-decr", 0.4)
      ]
    },
    medium: {
      gender: 0, muscle: 0.4, weight: 0.36, proportions: 1, gain: 1.4,
      extras: [
        ["measure-waist-circ-incr", 0.04], ["measure-hips-circ-incr", 0.18], ["measure-bust-circ-incr", 0.3],
        ["measure-shoulder-dist-decr", 0.25], ["measure-neck-circ-decr", 0.25], ["stomach-tone-decr", 0.3],
        ["buttocks-volume-incr", 0.08], ["measure-thigh-circ-incr", 0.05],
        ...LR("upperarm-fat-incr", 0.04), ...LR("upperleg-fat-incr", 0.05)
      ]
    },
    heavy: {
      gender: 0, muscle: 0.4, weight: 0.78, proportions: 1, gain: 1.4,
      extras: [
        ["measure-waist-circ-incr", 0.2], ["measure-hips-circ-incr", 0.15], ["stomach-pregnant-incr", 0.08],
        ...LR("upperarm-fat-incr", 0.2), ...LR("upperleg-fat-incr", 0.25),
        ["measure-bust-circ-incr", 0.2], ["measure-shoulder-dist-decr", 0.2], ["measure-neck-circ-decr", 0.2]
      ]
    },
    // A step past Heavy, kept gentle: fuller hips, thighs and arms before the belly.
    veryHeavy: {
      gender: 0, muscle: 0.35, weight: 0.95, proportions: 1, gain: 1.45,
      extras: [
        ["measure-waist-circ-incr", 0.4], ["measure-hips-circ-incr", 0.22], ["stomach-pregnant-incr", 0.14],
        ...LR("upperarm-fat-incr", 0.3), ...LR("upperleg-fat-incr", 0.35),
        ["measure-bust-circ-incr", 0.28], ["measure-shoulder-dist-decr", 0.2], ["measure-neck-circ-decr", 0.15]
      ]
    }
  }
};

// Each body has a toned twin, which the app moves towards as the athlete's
// VO2max rises from the Cooper Institute's Good to Superior for their age and
// sex (`vo2Firmness` in physique.ts). The same size of person, carrying more of
// it as muscle: more of MakeHuman's muscle macro, a flat stomach and a smaller
// waist, the body fat the heavier presets add taken mostly back out, and the
// muscle a fit build shows. A man's goes to the shoulders, chest and back as
// well as the legs; a woman's to the legs and hips, with only a little in the
// arms — a V-shaped back read as coarse on her.
const isAddedFat = (name) => /fat-incr|pregnant-incr|waist-circ-incr/.test(name);
const TONE = {
  male: [
    ["stomach-tone-incr", 0.6], ["measure-waist-circ-decr", 0.2], ["torso-vshape-incr", 0.35],
    ["torso-muscle-pectoral-incr", 0.3], ...LR("upperarm-muscle-incr", 0.4), ...LR("upperarm-shoulder-muscle-incr", 0.35),
    ...LR("upperleg-muscle-incr", 0.3), ...LR("lowerleg-muscle-incr", 0.3)
  ],
  female: [
    ["stomach-tone-incr", 0.6], ["measure-waist-circ-decr", 0.25], ["buttocks-volume-incr", 0.2],
    ...LR("upperleg-muscle-incr", 0.25), ...LR("lowerleg-muscle-incr", 0.25),
    ...LR("upperarm-shoulder-muscle-incr", 0.15), ...LR("upperarm-muscle-incr", 0.12)
  ]
};
/**
 * A toned twin weighs what its body weighs, and muscle is denser than fat, so
 * it holds a little less: the bake searches its weight macro for this share of
 * the body's volume. At the two ends MakeHuman's weight macro runs out before
 * the share is reached, so the slimmest woman's twin is a few percent larger and
 * the heaviest twins a few smaller.
 */
const TONED_VOLUME = 0.95;
/**
 * How much of that toning a twin carries. A woman's twin is drawn halfway from
 * her body to the toned preset: shown the whole of it, the athlete judged it
 * too much for a woman at Superior, and halfway was the step she picked.
 */
const TONE_REACH = { male: 1, female: 0.5 };
for (const [sex, presets] of Object.entries(PRESETS)) {
  for (const [name, preset] of Object.entries({ ...presets })) {
    presets[`${name}Fit`] = {
      ...preset,
      muscle: Math.min(1, preset.muscle + 0.35),
      extras: [...preset.extras.map(([target, k]) => [target, isAddedFat(target) ? k * 0.3 : k]), ...TONE[sex]],
      toneOf: name
    };
  }
}

// ---------- MakeHuman files ----------

async function makehumanFile(relative) {
  const file = path.join(CACHE, relative);
  if (existsSync(file)) return readFile(file, "utf8");
  const response = await fetch(`${MAKEHUMAN_DATA}/${relative}`);
  if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
  const text = await response.text();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}

function targetPath(name) {
  if (/^(african|asian|caucasian)-/.test(name) || name.startsWith("universal-")) return `targets/macrodetails/${name}.target`;
  if (/-(min|max)height$/.test(name)) return `targets/macrodetails/height/${name}.target`;
  if (name.endsWith("-idealproportions")) return `targets/macrodetails/proportions/${name}.target`;
  if (/^[lr]-/.test(name)) return `targets/armslegs/${name}.target`;
  const folder = name.split("-")[0];
  return `targets/${folder}/${name}.target`;
}

const targets = new Map();
async function loadTarget(name) {
  if (!targets.has(name)) {
    const text = await makehumanFile(targetPath(name));
    const idx = [];
    const off = [];
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const p = line.trim().split(/\s+/);
      if (p.length < 4) continue;
      idx.push(Number(p[0]));
      off.push(Number(p[1]), Number(p[2]), Number(p[3]));
    }
    // The average-muscle, average-weight targets are empty upstream: they are
    // the base mesh itself. Anything else empty is a bad download.
    if (!idx.length && !name.endsWith("averagemuscle-averageweight")) throw new Error(`${name}: no offsets`);
    targets.set(name, { idx, off });
  }
  return targets.get(name);
}

async function loadBase() {
  const text = await makehumanFile("3dobjs/base.obj");
  const verts = [];
  const bodyFaces = [];
  let group = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.trim().split(/\s+/);
      verts.push(Number(x), Number(y), Number(z));
    } else if (line.startsWith("g ")) {
      group = line.slice(2).trim();
    } else if (line.startsWith("f ") && group === "body") {
      bodyFaces.push(line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1));
    }
  }
  return { base: new Float32Array(verts), bodyFaces };
}

// ---------- shape ----------

// MakeHuman's macro interpolation: 0 = min, 0.5 = average, 1 = max.
function tri(v) {
  if (v < 0.5) return { min: 1 - v * 2, average: v * 2, max: 0 };
  return { min: 0, average: 1 - (v - 0.5) * 2, max: (v - 0.5) * 2 };
}

function macroTargets({ gender, muscle, weight }) {
  const genders = { female: 1 - gender, male: gender };
  const out = [];
  for (const [g, gv] of Object.entries(genders)) {
    if (gv <= 0) continue;
    for (const [race, rv] of Object.entries(RACE)) out.push([`${race}-${g}-young`, rv * gv, false]);
    for (const [m, mv] of Object.entries(tri(muscle))) {
      for (const [w, wv] of Object.entries(tri(weight))) {
        const k = gv * mv * wv;
        if (k > 0) out.push([`universal-${g}-young-${m}muscle-${w}weight`, k, true]);
      }
    }
  }
  return out;
}

async function shape(mesh, preset) {
  const pos = Float32Array.from(mesh.base);
  const add = async (name, k) => {
    const t = await loadTarget(name);
    for (let i = 0; i < t.idx.length; i++) {
      const v = t.idx[i] * 3;
      pos[v] += t.off[i * 3] * k;
      pos[v + 1] += t.off[i * 3 + 1] * k;
      pos[v + 2] += t.off[i * 3 + 2] * k;
    }
  };
  for (const [name, k, scaled] of macroTargets(preset)) await add(name, scaled ? k * preset.gain : k);
  const proportions = Math.max(0, (preset.proportions - 0.5) * 2);
  if (proportions > 0) {
    const genders = { female: 1 - preset.gender, male: preset.gender };
    for (const [g, gv] of Object.entries(genders)) {
      for (const [m, mv] of Object.entries(tri(preset.muscle))) {
        for (const [w, wv] of Object.entries(tri(preset.weight))) {
          const k = gv * mv * wv * proportions;
          if (k > 0) await add(`${g}-young-${m}muscle-${w}weight-idealproportions`, k);
        }
      }
    }
  }
  for (const [name, k] of preset.extras) await add(name, k);
  return pos;
}

// ---------- pose ----------

async function loadRig(count) {
  const skeleton = JSON.parse(await makehumanFile("rigs/default.mhskel"));
  const weights = JSON.parse(await makehumanFile("rigs/default_weights.mhw")).weights;
  const children = {};
  for (const [name, bone] of Object.entries(skeleton.bones)) (children[bone.parent] ??= []).push(name);
  const descendants = (name) => [name, ...(children[name] ?? []).flatMap(descendants)];
  const total = new Float32Array(count);
  for (const list of Object.values(weights)) for (const [v, w] of list) total[v] += w;
  const sides = {};
  for (const side of ["L", "R"]) {
    const shoulder = new Float32Array(count);
    const arm = new Float32Array(count);
    const fore = new Float32Array(count);
    for (const [v, w] of weights[`shoulder01.${side}`] ?? []) shoulder[v] += w;
    for (const bone of descendants(`upperarm01.${side}`)) for (const [v, w] of weights[bone] ?? []) arm[v] += w;
    for (const bone of descendants(`lowerarm01.${side}`)) for (const [v, w] of weights[bone] ?? []) fore[v] += w;
    sides[side] = { shoulder, arm, fore };
  }
  return { joints: skeleton.joints, total, sides };
}

function jointAt(rig, positions, name) {
  const ids = rig.joints[name];
  const p = new THREE.Vector3();
  for (const i of ids) p.add(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
  return p.divideScalar(ids.length);
}

/**
 * Brings both arms in to `armDeg` from the body's side and the forearm to
 * `elbowDeg` from straight, blended with the skeleton's own skin weights. The
 * shoulder carries a fifth of the swing, as a real shoulder girdle would.
 */
function poseArms(rig, positions, armDeg, elbowDeg) {
  const out = Float32Array.from(positions);
  const rotateAbout = (pivot, rotation) =>
    new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(rotation)
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  for (const side of ["L", "R"]) {
    const shoulderJoint = jointAt(rig, positions, `upperarm01.${side}____head`);
    const wrist = jointAt(rig, positions, `wrist.${side}____head`);
    const elbow = jointAt(rig, positions, `lowerarm01.${side}____head`);
    const girdle = jointAt(rig, positions, `shoulder01.${side}____head`);
    const current = Math.atan2(Math.abs(wrist.x - shoulderJoint.x), shoulderJoint.y - wrist.y);
    const theta = current - (armDeg * Math.PI) / 180;
    const alpha = theta * 0.22;
    const sign = side === "L" ? -1 : 1;
    const S = rotateAbout(girdle, new THREE.Matrix4().makeRotationZ(sign * alpha));
    const U = S.clone().multiply(rotateAbout(shoulderJoint, new THREE.Matrix4().makeRotationZ(sign * (theta - alpha))));
    const upper = elbow.clone().sub(shoulderJoint);
    const forearm = wrist.clone().sub(elbow);
    const axis = new THREE.Vector3().crossVectors(upper, forearm).normalize();
    const delta = upper.angleTo(forearm) - (elbowDeg * Math.PI) / 180;
    const F = U.clone().multiply(rotateAbout(elbow, new THREE.Matrix4().makeRotationAxis(axis, -delta)));

    const { shoulder, arm, fore } = rig.sides[side];
    const v = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < positions.length / 3; i++) {
      const tw = rig.total[i];
      if (!tw || (!shoulder[i] && !arm[i])) continue;
      const ws = shoulder[i] / tw;
      const wf = fore[i] / tw;
      const wu = arm[i] / tw - wf;
      const keep = 1 - ws - wu - wf;
      v.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      a.copy(v).applyMatrix4(S);
      b.copy(v).applyMatrix4(U);
      c.copy(v).applyMatrix4(F);
      out[i * 3] = v.x * keep + a.x * ws + b.x * wu + c.x * wf;
      out[i * 3 + 1] = v.y * keep + a.y * ws + b.y * wu + c.y * wf;
      out[i * 3 + 2] = v.z * keep + a.z * ws + b.z * wu + c.z * wf;
    }
  }
  return out;
}

// ---------- low poly ----------

function lowPolyPlan(mesh) {
  const used = [...new Set(mesh.bodyFaces.flat())];
  const compact = new Map(used.map((original, i) => [original, i]));
  const pos = new Float32Array(used.length * 3);
  used.forEach((original, i) => pos.set(mesh.base.subarray(original * 3, original * 3 + 3), i * 3));
  const index = [];
  for (const f of mesh.bodyFaces) {
    for (let i = 1; i + 1 < f.length; i++) index.push(compact.get(f[0]), compact.get(f[i]), compact.get(f[i + 1]));
  }
  const { keep, tris } = decimate(pos, index, LOW_POLY_VERTICES);
  return { original: keep.map((c) => used[c]), tris };
}

// ---------- write ----------

const base64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");

async function main() {
  const mesh = await loadBase();
  const rig = await loadRig(mesh.base.length / 3);
  const plan = lowPolyPlan(mesh);
  if (plan.original.length > 65535) throw new Error("too many vertices for 16-bit indices");

  const lowOf = async (preset) => {
    const posed = poseArms(rig, await shape(mesh, preset), ARM_DEG, ELBOW_DEG);
    const low = new Float32Array(plan.original.length * 3);
    plan.original.forEach((o, j) => low.set(posed.subarray(o * 3, o * 3 + 3), j * 3));
    return low;
  };
  const volumeOf = (v) => {
    const t = plan.tris;
    let sum = 0;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3];
      sum +=
        v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) -
        v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) +
        v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    return Math.abs(sum / 6);
  };

  const bodies = {};
  for (const [sex, presets] of Object.entries(PRESETS)) {
    for (const [name, preset] of Object.entries(presets)) {
      if (!preset.toneOf) {
        (bodies[sex] ??= {})[name] = await lowOf(preset);
        continue;
      }
      // Bisect the weight macro for the toned twin's share of its body's volume.
      const plain = bodies[sex][preset.toneOf];
      const plainVolume = volumeOf(plain);
      let lo = 0;
      let hi = 1;
      let weight;
      let low;
      for (let i = 0; i < 14; i++) {
        weight = (lo + hi) / 2;
        low = await lowOf({ ...preset, weight });
        if (volumeOf(low) < plainVolume * TONED_VOLUME) lo = weight;
        else hi = weight;
      }
      const reach = TONE_REACH[sex];
      if (reach < 1) low = low.map((v, i) => plain[i] + (v - plain[i]) * reach);
      bodies[sex][name] = low;
      const share = volumeOf(low) / plainVolume;
      console.log(`${sex} ${name}: weight ${weight.toFixed(2)}, ${(share * 100).toFixed(0)}% of ${preset.toneOf}`);
    }
  }

  // One box over every body, so 16-bit positions lose the same ~0.1 mm on each.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const presets of Object.values(bodies)) {
    for (const low of Object.values(presets)) {
      for (let i = 0; i < low.length; i++) {
        min[i % 3] = Math.min(min[i % 3], low[i]);
        max[i % 3] = Math.max(max[i % 3], low[i]);
      }
    }
  }
  const quantize = (low) => {
    const q = new Uint16Array(low.length);
    for (let i = 0; i < low.length; i++) {
      q[i] = Math.round(((low[i] - min[i % 3]) / (max[i % 3] - min[i % 3])) * 65535);
    }
    return base64(q);
  };

  const out = {
    source: `MakeHuman base mesh, targets and default rig (CC0), makehumancommunity/makehuman@${MAKEHUMAN_COMMIT.slice(0, 7)}`,
    pose: { armDeg: ARM_DEG, elbowDeg: ELBOW_DEG },
    vertexCount: plan.original.length,
    bounds: { min, max },
    triangles: base64(Uint16Array.from(plan.tris)),
    bodies: Object.fromEntries(
      Object.entries(bodies).map(([sex, presets]) => [
        sex,
        Object.fromEntries(Object.entries(presets).map(([physique, low]) => [physique, quantize(low)]))
      ])
    )
  };
  await writeFile(OUTPUT, `${JSON.stringify(out, null, 2)}\n`);
  const size = Buffer.byteLength(JSON.stringify(out));
  console.log(`wrote ${path.relative(root, OUTPUT)}: ${plan.original.length} vertices, ${plan.tris.length / 3} triangles, ${Math.round(size / 1024)} KB`);
}

await main();
