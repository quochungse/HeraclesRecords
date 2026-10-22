// The Strength figure's baked body (public/assets/anatomy/hero), decoded as heroBody.ts decodes it: every block inside
// its file and decodable by the meshopt decoder the page ships, seventeen groups that cover the muscle triangles, indices
// inside their vertex buffers, a head for each figure, and a bust for her alone. The abductors (gluteus medius and tensor
// fasciae latae) were baked inside the glutes and are split off by their range, which must not cut through a muscle.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

await MeshoptDecoder.ready;
const dir = new URL("../public/assets/anatomy/hero/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("hero.json", dir), "utf8"));
const read = async (name) => gunzipSync(await readFile(new URL(`${name}.bin.gz`, dir)));
const GROUPS = ["neck", "traps", "shoulders", "chest", "lats", "biceps", "triceps", "forearms", "abs", "obliques",
  "lowerBack", "glutes", "abductors", "quads", "hamstrings", "adductors", "calves"];
assert.equal(manifest.version, 2, "meshopt-coded blocks");
assert.deepEqual(manifest.groups, GROUPS, "group order");
assert.equal(manifest.ranges.length, GROUPS.length);

const slice = (file, name, [offset, length]) => {
  assert(offset >= 0 && offset + length <= file.byteLength, `${name} lies inside its file`);
  return file.subarray(offset, offset + length);
};
/** Vertex count, after checking the block decodes to it. */
const vertices = (file, name, block) => {
  const target = new Uint8Array(block[2] * 8);
  MeshoptDecoder.decodeVertexBuffer(target, block[2], 8, slice(file, name, block));
  return block[2];
};
const indices = (file, name, block) => {
  const target = new Uint32Array(block[2]);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(target.buffer), block[2], 4, slice(file, name, block));
  assert.equal(target.length % 3, 0, `${name} is whole triangles`);
  return target;
};
const maxOf = (array) => array.reduce((m, v) => (v > m ? v : m), 0);

const shared = await read("shared");
const mIdx = indices(shared, "mIdx", manifest.shared.mIdx);
const sIdx = indices(shared, "sIdx", manifest.shared.sIdx);
const cIdx = indices(shared, "cIdx", manifest.shared.cIdx);
let covered = 0;
manifest.ranges.forEach(([start, end], index) => {
  assert(end > start, `${GROUPS[index]} has triangles`);
  assert.equal(start, covered, "ranges are contiguous");
  covered = end;
});
assert.equal(covered * 3, mIdx.length, "the groups cover every muscle triangle");
assert(maxOf(mIdx) < manifest.half, "muscle indices stay in the half");
const groupVertices = (group) => {
  const [start, end] = manifest.ranges[GROUPS.indexOf(group)];
  return new Set(mIdx.subarray(3 * start, 3 * end));
};
const glutes = groupVertices("glutes");
assert(![...groupVertices("abductors")].some((vertex) => glutes.has(vertex)),
  "the glutes and the abductors share no vertex: the split falls between two muscles");

for (const sex of ["male", "female"]) {
  const blocks = manifest[sex];
  const own = await read(sex);
  assert.equal(vertices(own, "mPos", blocks.mPos), manifest.half, `${sex}: one position per half vertex`);
  assert(maxOf(sIdx) < vertices(own, "sPos", blocks.sPos), `${sex}: skeleton indices`);
  assert(maxOf(cIdx) < vertices(own, "cPos", blocks.cPos), `${sex}: connective indices`);
  const head = vertices(own, "hPos", blocks.hPos);
  assert(head > 1000, `${sex}: a head`);
  assert(maxOf(indices(own, "hIdx", blocks.hIdx)) < head, `${sex}: head indices`);
  if (sex === "female") {
    assert(maxOf(indices(own, "bIdx", blocks.bIdx)) < vertices(own, "bPos", blocks.bPos), "her bust's indices");
  } else {
    assert(!blocks.bPos && !blocks.bIdx, "his figure carries no bust");
  }
}
console.log("Strength figure assets: 17 groups, both figures and their heads, her bust alone.");
