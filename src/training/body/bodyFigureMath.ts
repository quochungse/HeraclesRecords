// The arithmetic under the Overview's body figure, out of the component so a
// suite can reach it and so the panel can place its words without loading the
// figure. Node-free.

import { shapeBlend, type BakedBody, type FigureSex } from "./physique";

/**
 * Where the figure stands in its frame, as fractions of the frame's height
 * from the bottom: the soles at `feet`, the top of the head at `feet + span`.
 * The stylesheet places the drawing so (`.body-figure`), and the panel draws
 * the recovery level against it, so the two agree by construction. A stage
 * narrower than `WIDE_STAGE_MIN_PX` has no room beside the figure for the
 * words, so the figure stands higher and the words go under its feet; a wide
 * one keeps the words on the fill line. The width and both frames are the
 * stylesheet's container query on `.recovery-figure` too — change both.
 */
export const WIDE_STAGE_MIN_PX = 560;
export const WIDE_FRAME = { feet: 0.05, span: 0.88 };
export const NARROW_FRAME = { feet: 0.14, span: 0.8 };

/**
 * The figure's colour for a recovery %, continuous rather than in bands: the
 * four colours the panel declares (`--figure-low` … `--figure-full`) stand at
 * 20, 60, 70 and 100, and a figure between two is mixed between them in
 * OKLCH, whose lightness runs evenly — straight from red to green in RGB goes
 * through brown. 20 and under is the red. The words (Ready, Moderate, Recover)
 * still follow COROS's three bands. Undefined for no reading (a 0 from COROS
 * is none), which the stage draws in its idle colour.
 */
export const FIGURE_COLOUR_STOPS: ReadonlyArray<readonly [number, string]> = [
  [20, "--figure-low"],
  [60, "--figure-mid"],
  [70, "--figure-high"],
  [100, "--figure-full"]
];

export function figureColourFor(recoveryPct: number | undefined): string | undefined {
  if (recoveryPct === undefined || !(recoveryPct > 0)) return undefined;
  const pct = Math.min(100, Math.round(recoveryPct));
  // The last stop is 100, so every percent finds one.
  const at = FIGURE_COLOUR_STOPS.findIndex(([stop]) => pct <= stop);
  const [high, to] = FIGURE_COLOUR_STOPS[at];
  if (at === 0 || pct === high) return `var(${to})`;
  const [low, from] = FIGURE_COLOUR_STOPS[at - 1];
  const share = Math.round(((pct - low) / (high - low)) * 1000) / 10;
  return `color-mix(in oklch, var(${from}), var(${to}) ${share}%)`;
}

/** Half the width of the soft line where the lit part meets the dim part. */
export const LEVEL_EDGE = 0.012;

/** `bodyFigures.json`, as `npm run body-figures:bake` writes it. */
export interface BodyFigureFile {
  source: string;
  pose: { armDeg: number; elbowDeg: number };
  vertexCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Base64 of a little-endian Uint16Array, three per triangle. */
  triangles: string;
  /** Base64 of a little-endian Uint16Array per body, xyz quantised over `bounds`. */
  bodies: Record<FigureSex, Record<BakedBody, string>>;
}

export interface FigureGeometry {
  positions: Float32Array;
  triangles: Uint16Array;
  edges: Uint16Array;
}

function decodeUint16(base64: string): Uint16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Uint16Array(bytes.buffer, 0, bytes.length >> 1);
}

/** Every triangle edge once: the low-poly look is the triangles' own edges. */
export function edgesOf(triangles: Uint16Array): Uint16Array {
  const seen = new Set<number>();
  const edges: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [triangles[t], triangles[t + 1], triangles[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 3];
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }
  return Uint16Array.from(edges);
}

function decodePositions(file: BodyFigureFile, sex: FigureSex, body: BakedBody): Float32Array {
  const quantised = decodeUint16(file.bodies[sex][body]);
  const { min, max } = file.bounds;
  const positions = new Float32Array(quantised.length);
  for (let i = 0; i < quantised.length; i++) {
    const axis = i % 3;
    positions[i] = min[axis] + (quantised[i] / 65535) * (max[axis] - min[axis]);
  }
  return positions;
}

/** The triangles and their edges, which every body shares. */
function decodeTopology(file: BodyFigureFile): Omit<FigureGeometry, "positions"> {
  const triangles = decodeUint16(file.triangles);
  return { triangles, edges: edgesOf(triangles) };
}

export function decodeFigure(file: BodyFigureFile, sex: FigureSex, body: BakedBody): FigureGeometry {
  return { positions: decodePositions(file, sex, body), ...decodeTopology(file) };
}

/** Moves `a` that far of the way to `b`, vertex by vertex, in place. */
function blendInto(a: Float32Array, b: Float32Array, t: number): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * t;
  return a;
}

/**
 * The figure at a shape (the height-adjusted BMI) and a firmness (0–1, from
 * VO2max): the two baked bodies either side of the shape blended vertex by
 * vertex, and the same blend of their toned twins, then that far from the one
 * to the other. Every body shares one topology, and a blend of positions lands
 * within a few millimetres of baking the blend's own presets (measured: 8.6 mm
 * at worst on a 1.7 m body, about 2 px on screen). Each body is decoded once,
 * and only the ones the blend reaches.
 */
export function blendFigure(file: BodyFigureFile, sex: FigureSex, shape: number, firmness = 0): FigureGeometry {
  const { from, to, t } = shapeBlend(shape);
  const sized = (suffix: "" | "Fit"): Float32Array => {
    if (t === 0) return decodePositions(file, sex, `${from}${suffix}`);
    const toward = decodePositions(file, sex, `${to}${suffix}`);
    return t === 1 ? toward : blendInto(decodePositions(file, sex, `${from}${suffix}`), toward, t);
  };
  const f = Math.min(1, Math.max(0, firmness));
  const positions = f === 0 ? sized("") : f === 1 ? sized("Fit") : blendInto(sized(""), sized("Fit"), f);
  return { positions, ...decodeTopology(file) };
}

/**
 * How bright each vertex's lines are drawn, 0–1. A mesh is finest in the face
 * and hands, so at one brightness those bloom into blobs; dimming a vertex by
 * how short its edges are evens the figure out. The reference length is a
 * torso-sized cell — the 80th percentile, not the median, because most
 * vertices sit in the hands and the face.
 */
export function lineBrightness(positions: Float32Array, edges: Uint16Array, power = 0.8, floor = 0.3): Float32Array {
  const n = positions.length / 3;
  const sum = new Float32Array(n);
  const count = new Uint16Array(n);
  const lengths: number[] = [];
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e];
    const b = edges[e + 1];
    const d = Math.hypot(
      positions[a * 3] - positions[b * 3],
      positions[a * 3 + 1] - positions[b * 3 + 1],
      positions[a * 3 + 2] - positions[b * 3 + 2]
    );
    sum[a] += d;
    sum[b] += d;
    count[a]++;
    count[b]++;
    lengths.push(d);
  }
  lengths.sort((x, y) => x - y);
  const reference = lengths[Math.floor(lengths.length * 0.8)] || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = count[i] ? Math.min(1, Math.max(floor, Math.pow(sum[i] / count[i] / reference, power))) : 0;
  }
  return out;
}

/**
 * Where the line for `level` (0–1) sits on a wide stage, as a fraction of the
 * frame from the bottom — the only layout that draws the words on it.
 */
export function levelInFrame(level: number): number {
  return WIDE_FRAME.feet + WIDE_FRAME.span * Math.min(1, Math.max(0, level));
}
