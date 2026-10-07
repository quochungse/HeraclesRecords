// Shortest-edge-first half-edge collapse, for the Overview's low-poly figure.
//
// Every surviving vertex is an original one (a collapse moves u onto v and
// drops u), so a body morphed from the same base mesh can be read through the
// same topology by index — which is what lets one triangle list serve every
// body `bake-body-figures.mjs` writes. Curvature raises an edge's cost so the
// face and hands keep some detail; flips, slivers and non-manifold collapses
// are refused. three's SimplifyModifier was tried first and merged the flat
// chest into a few large triangles.

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * @param {Float32Array} pos vertex positions, xyz
 * @param {number[]} tris triangle indices into `pos`
 * @param {number} target vertices to keep
 * @returns {{ keep: number[], tris: number[] }} the kept vertices (indices into
 *   `pos`) and the triangles, re-indexed into `keep`
 */
export function decimate(pos, tris, target, curvatureWeight = 1.5) {
  const n = pos.length / 3;
  const faceCount = tris.length / 3;
  const face = Int32Array.from(tris);
  const faceAlive = new Uint8Array(faceCount).fill(1);
  const vFaces = Array.from({ length: n }, () => new Set());
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) vFaces[face[f * 3 + k]].add(f);
  }

  const normalOf = (a, b, c) => {
    const ux = pos[b * 3] - pos[a * 3];
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3];
    const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
    const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };

  // Vertex normals of the original surface: the curvature term's reference.
  const vn = new Float32Array(n * 3);
  for (let f = 0; f < faceCount; f++) {
    const nn = normalOf(face[f * 3], face[f * 3 + 1], face[f * 3 + 2]);
    for (let k = 0; k < 3; k++) {
      const v = face[f * 3 + k];
      vn[v * 3] += nn[0];
      vn[v * 3 + 1] += nn[1];
      vn[v * 3 + 2] += nn[2];
    }
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]) || 1;
    vn[v * 3] /= l;
    vn[v * 3 + 1] /= l;
    vn[v * 3 + 2] /= l;
  }

  const alive = new Uint8Array(n).fill(1);
  // Bumped whenever a vertex's neighbourhood changes, so a heap entry built
  // before that is recognised as stale when it is popped.
  const version = new Uint32Array(n);
  const neighbors = (v) => {
    const out = new Set();
    for (const f of vFaces[v]) {
      for (let k = 0; k < 3; k++) {
        const w = face[f * 3 + k];
        if (w !== v) out.add(w);
      }
    }
    return out;
  };
  const cost = (u, v) => {
    const len = Math.hypot(
      pos[u * 3] - pos[v * 3],
      pos[u * 3 + 1] - pos[v * 3 + 1],
      pos[u * 3 + 2] - pos[v * 3 + 2]
    );
    const curv = 1 - (vn[u * 3] * vn[v * 3] + vn[u * 3 + 1] * vn[v * 3 + 1] + vn[u * 3 + 2] * vn[v * 3 + 2]);
    return len * (1 + curvatureWeight * curv * 4);
  };
  const heap = new MinHeap();
  const pushEdges = (v) => {
    for (const w of neighbors(v)) heap.push([cost(v, w), v, w, version[v], version[w]]);
  };
  for (let v = 0; v < n; v++) if (vFaces[v].size) pushEdges(v);

  const tryCollapse = (u, v) => {
    // Link condition: an interior edge shares exactly two neighbours.
    const nu = neighbors(u);
    const nv = neighbors(v);
    let common = 0;
    for (const w of nu) if (nv.has(w)) common++;
    if (common > 2) return false;
    // Refuse a flip or a sliver.
    for (const f of vFaces[u]) {
      const a = face[f * 3];
      const b = face[f * 3 + 1];
      const c = face[f * 3 + 2];
      if (a === v || b === v || c === v) continue;
      const before = normalOf(a, b, c);
      const after = normalOf(a === u ? v : a, b === u ? v : b, c === u ? v : c);
      const lb = Math.hypot(...before);
      const la = Math.hypot(...after);
      if (la < 1e-12) return false;
      const cos = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (lb * la);
      if (cos < 0.35) return false;
    }
    for (const f of [...vFaces[u]]) {
      const shared = face[f * 3] === v || face[f * 3 + 1] === v || face[f * 3 + 2] === v;
      if (shared) {
        faceAlive[f] = 0;
        for (let k = 0; k < 3; k++) vFaces[face[f * 3 + k]].delete(f);
      } else {
        for (let k = 0; k < 3; k++) if (face[f * 3 + k] === u) face[f * 3 + k] = v;
        vFaces[v].add(f);
      }
    }
    vFaces[u].clear();
    alive[u] = 0;
    version[v]++;
    for (const w of neighbors(v)) version[w]++;
    pushEdges(v);
    for (const w of neighbors(v)) pushEdges(w);
    return true;
  };

  let count = 0;
  for (let v = 0; v < n; v++) if (vFaces[v].size) count++;
  while (count > target && heap.size) {
    const [, u, v, vu, vv] = heap.pop();
    if (!alive[u] || !alive[v] || version[u] !== vu || version[v] !== vv) continue;
    if (tryCollapse(u, v) || tryCollapse(v, u)) count--;
  }

  const keep = [];
  const remap = new Int32Array(n).fill(-1);
  for (let v = 0; v < n; v++) {
    if (alive[v] && vFaces[v].size) {
      remap[v] = keep.length;
      keep.push(v);
    }
  }
  const outTris = [];
  for (let f = 0; f < faceCount; f++) {
    if (faceAlive[f]) outTris.push(remap[face[f * 3]], remap[face[f * 3 + 1]], remap[face[f * 3 + 2]]);
  }
  return { keep, tris: outTris };
}
