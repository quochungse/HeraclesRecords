// The body figure as SVG paths: the mesh projected once through a fixed
// camera, with the hidden lines left out by which way each triangle faces.
// Node-free, so a suite can reach it.
//
// Lines are grouped by brightness into a few paths rather than drawn one
// element each: a path's strokes do not add light where they cross, which the
// brightness already allows for (dense parts are dimmed), and the rim is flat
// per triangle. The colours, the fill line and the glow are BodyFigure.tsx's
// and the stylesheet's.

import { WIDE_FRAME, LEVEL_EDGE, lineBrightness, type FigureGeometry } from "./bodyFigureMath";

/** The figure's height in the drawing's own units; coordinates are whole. */
const DRAWING_HEIGHT = 2000;
const CAMERA_FOV = 16;
const BRIGHTNESS_STEPS = 6;
const RIM_STEPS = 8;
/** A rim this faint is not drawn at all. */
const RIM_FLOOR = 0.04;

export interface FigureLayer {
  d: string;
  /** 0–1: the share of the layer's full strength this path is drawn at. */
  strength: number;
}

export interface FigureDrawing {
  width: number;
  height: number;
  /** The lines that face the camera, by brightness. */
  front: FigureLayer[];
  /** The lines on the far side, by brightness, for a skin that shows them. */
  back: FigureLayer[];
  /** The body's outline, filled: every triangle that faces the camera. */
  skin: string;
  /** Light at the silhouette, by strength. */
  rim: FigureLayer[];
  /** The drawing's y for a fill level (0 soles – 1 crown), and the soft band's half-height. */
  levelY: (level: number) => number;
  levelEdge: number;
}

function bucket(value: number, min: number, max: number, steps: number): number {
  const t = max > min ? (value - min) / (max - min) : 1;
  return Math.min(steps - 1, Math.max(0, Math.round(t * (steps - 1))));
}

function layers(paths: string[][], min: number, max: number, steps: number): FigureLayer[] {
  return paths
    .map((parts, i) => ({ d: parts.join(""), strength: min + ((max - min) * i) / Math.max(1, steps - 1) }))
    .filter((layer) => layer.d.length > 0);
}

export function drawFigure({ positions, triangles, edges }: FigureGeometry): FigureDrawing {
  const n = positions.length / 3;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, positions[i * 3]);
    maxX = Math.max(maxX, positions[i * 3]);
    minY = Math.min(minY, positions[i * 3 + 1]);
    maxY = Math.max(maxY, positions[i * 3 + 1]);
    minZ = Math.min(minZ, positions[i * 3 + 2]);
    maxZ = Math.max(maxZ, positions[i * 3 + 2]);
  }
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const span = maxY - minY;

  // A camera framing the figure as a wide stage does: its height fills `span`
  // of the frame, its soles at `feet`. The stylesheet places the drawing.
  const visible = span / WIDE_FRAME.span;
  const cameraY = (0.5 - WIDE_FRAME.feet) * visible;
  const cameraZ = visible / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));

  // Projected, y up, in camera units; scaled to the drawing below.
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] - midX;
    const y = positions[i * 3 + 1] - minY;
    const z = positions[i * 3 + 2] - midZ;
    const depth = cameraZ - z;
    px[i] = x / depth;
    py[i] = (y - cameraY) / depth;
  }
  let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
  for (let i = 0; i < n; i++) {
    left = Math.min(left, px[i]);
    right = Math.max(right, px[i]);
    top = Math.max(top, py[i]);
    bottom = Math.min(bottom, py[i]);
  }
  const scale = DRAWING_HEIGHT / (top - bottom);
  const sx = (i: number) => Math.round((px[i] - left) * scale);
  const sy = (i: number) => Math.round((top - py[i]) * scale);

  // A triangle faces the camera when it still winds counter-clockwise once
  // projected (y up); the mesh is closed and wound outward.
  const triangleCount = triangles.length / 3;
  const facing = new Uint8Array(triangleCount);
  // Vertex normals, area-weighted, for the rim.
  const normals = new Float64Array(n * 3);
  for (let t = 0; t < triangleCount; t++) {
    const a = triangles[t * 3], b = triangles[t * 3 + 1], c = triangles[t * 3 + 2];
    const area = (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
    facing[t] = area > 0 ? 1 : 0;
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }

  // How far each vertex's surface has turned from the camera: the skin's
  // `pow(1 - |n·v|, 2.4)`, taken per vertex and averaged per triangle.
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const vx = -(positions[i * 3] - midX), vy = cameraY - (positions[i * 3 + 1] - minY), vz = cameraZ - (positions[i * 3 + 2] - midZ);
    const dot = Math.abs(nx * vx + ny * vy + nz * vz) / (Math.hypot(nx, ny, nz) * Math.hypot(vx, vy, vz) || 1);
    turn[i] = Math.pow(1 - dot, 2.4);
  }

  const skin: string[] = [];
  const rimPaths: string[][] = Array.from({ length: RIM_STEPS }, () => []);
  const corner = (i: number) => `${sx(i)} ${sy(i)}`;
  for (let t = 0; t < triangleCount; t++) {
    if (!facing[t]) continue;
    const a = triangles[t * 3], b = triangles[t * 3 + 1], c = triangles[t * 3 + 2];
    const shape = `M${corner(a)}L${corner(b)}L${corner(c)}Z`;
    skin.push(shape);
    const rim = (turn[a] + turn[b] + turn[c]) / 3;
    if (rim >= RIM_FLOOR) rimPaths[bucket(rim, 0, 1, RIM_STEPS)].push(shape);
  }

  // An edge is in front when either triangle beside it faces the camera.
  const front = new Set<number>();
  for (let t = 0; t < triangleCount; t++) {
    if (!facing[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = triangles[t * 3 + k], b = triangles[t * 3 + ((k + 1) % 3)];
      front.add(a < b ? a * 65536 + b : b * 65536 + a);
    }
  }
  const brightness = lineBrightness(positions, edges);
  const frontPaths: string[][] = Array.from({ length: BRIGHTNESS_STEPS }, () => []);
  const backPaths: string[][] = Array.from({ length: BRIGHTNESS_STEPS }, () => []);
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e], b = edges[e + 1];
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    const step = bucket((brightness[a] + brightness[b]) / 2, 0.3, 1, BRIGHTNESS_STEPS);
    (front.has(key) ? frontPaths : backPaths)[step].push(`M${corner(a)}L${corner(b)}`);
  }

  // The fill line is measured up the body; its height on the drawing is where
  // that height projects at the body's middle depth.
  const levelY = (level: number) => {
    const y = Math.min(1, Math.max(0, level)) * span;
    return Math.round((top - (y - cameraY) / cameraZ) * scale);
  };

  return {
    width: Math.round((right - left) * scale),
    height: DRAWING_HEIGHT,
    front: layers(frontPaths, 0.3, 1, BRIGHTNESS_STEPS),
    back: layers(backPaths, 0.3, 1, BRIGHTNESS_STEPS),
    skin: skin.join(""),
    rim: layers(rimPaths, 0, 1, RIM_STEPS),
    levelY,
    levelEdge: Math.round((LEVEL_EDGE * span * scale) / cameraZ)
  };
}
