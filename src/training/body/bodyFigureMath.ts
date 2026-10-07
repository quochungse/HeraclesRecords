// The arithmetic under the Overview's body figure, out of the component so a
// suite can reach it and so the panel can place its words without loading the
// figure. Node-free.

import type { FigureSex, Physique } from "./physique";

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
 * The figure's colour for a recovery %. Full recovery has a colour of its own:
 * 99% and 100% are one step apart on COROS's scale and a different thing to an
 * athlete deciding whether to go hard, so green is kept for 100 and 70–99 is
 * yellow, apart from the orange of 40–69. The words (Ready, Moderate, Recover)
 * still follow COROS's three bands.
 */
export type FigureTone = "full" | "high" | "mid" | "low" | "neutral";

export function figureToneFor(recoveryPct: number | undefined): FigureTone {
  if (recoveryPct === undefined || !(recoveryPct > 0)) return "neutral";
  const pct = Math.round(recoveryPct);
  if (pct >= 100) return "full";
  if (pct >= 70) return "high";
  if (pct >= 40) return "mid";
  return "low";
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
  bodies: Record<FigureSex, Record<Physique, string>>;
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

export function decodeFigure(file: BodyFigureFile, sex: FigureSex, physique: Physique): FigureGeometry {
  const quantised = decodeUint16(file.bodies[sex][physique]);
  const { min, max } = file.bounds;
  const positions = new Float32Array(quantised.length);
  for (let i = 0; i < quantised.length; i++) {
    const axis = i % 3;
    positions[i] = min[axis] + (quantised[i] / 65535) * (max[axis] - min[axis]);
  }
  const triangles = decodeUint16(file.triangles);
  return { positions, triangles, edges: edgesOf(triangles) };
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
