/**
 * A route's points joined by a curve rather than straight chords. The track is
 * decimated to a few hundred points — one every 25 m or so on a 10 km run — and
 * straight chords between them read as a line of kinks at every bend.
 *
 * Centripetal Catmull–Rom: the curve passes through every recorded point, so
 * nothing is moved off where the watch put it, and unlike the uniform kind it
 * never loops or overshoots at a hairpin or where two points nearly coincide.
 */

/** Samples of the curve per original stretch. */
export const SMOOTH_STEPS = 4;

export interface SmoothPath {
  /** The curve, `SMOOTH_STEPS` points per stretch plus the last point. */
  points: [number, number][];
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function catmullRom(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  // Barry–Goldman with knot spacing |Δ|^0.5 (centripetal). A zero spacing —
  // two points at one spot — falls back to a straight chord.
  const d01 = Math.sqrt(distance(p0, p1));
  const d12 = Math.sqrt(distance(p1, p2));
  const d23 = Math.sqrt(distance(p2, p3));
  if (d12 === 0) {
    return p1;
  }
  const t0 = 0;
  const t1 = t0 + (d01 || d12);
  const t2 = t1 + d12;
  const t3 = t2 + (d23 || d12);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
    const w = tb === ta ? 0 : (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * The curve through `points`. Point `i` of the input is point
 * `i * SMOOTH_STEPS` of the result, so a stretch or a position along the route
 * maps onto the curve by multiplication. Coordinates are treated as planar,
 * which over the few kilometres a route spans is well inside what can be seen.
 */
export function smoothPath(points: readonly [number, number][]): SmoothPath {
  if (points.length < 2) {
    return { points: [...points] };
  }
  const out: [number, number][] = [];
  const last = points.length - 1;
  for (let index = 0; index < last; index += 1) {
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    // At the ends the missing neighbour is the end point mirrored, so the
    // curve leaves the start and meets the finish heading along the route.
    const p0 = points[index - 1] ?? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    const p3 = points[index + 2] ?? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    out.push(p1);
    for (let step = 1; step < SMOOTH_STEPS; step += 1) {
      out.push(catmullRom(p0, p1, p2, p3, step / SMOOTH_STEPS));
    }
  }
  out.push(points[last]!);
  return { points: out };
}

/**
 * The curve up to `position` — an index into the original points with a
 * fraction, 12.5 being half way along the thirteenth stretch — ending at the
 * exact spot on the curve.
 */
export function smoothPathTo(
  path: SmoothPath,
  position: number
): { points: [number, number][]; head: [number, number] } {
  const scaled = Math.max(0, position * SMOOTH_STEPS);
  const lastIndex = path.points.length - 1;
  if (scaled >= lastIndex) {
    return { points: path.points, head: path.points[lastIndex]! };
  }
  const whole = Math.floor(scaled);
  const fraction = scaled - whole;
  const a = path.points[whole]!;
  const b = path.points[whole + 1]!;
  const head: [number, number] = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
  return { points: [...path.points.slice(0, whole + 1), head], head };
}
