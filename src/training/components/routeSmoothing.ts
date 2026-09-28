/**
 * A route's points joined by a curve rather than straight chords. The track is
 * decimated to a few hundred points — one every 25 m or so on a 10 km run — and
 * straight chords between them read as a line of kinks at every bend.
 *
 * A uniform cubic B-spline, which approximates the points rather than passing
 * through them. An interpolating curve (Catmull–Rom was used first) has to bend
 * at every recorded point, a GPS wobble included, so the line still read as
 * kinked at the joins; this one is smooth in its curvature too, and moves a
 * point by a sixth of the bend at it — a few metres at a street corner, well
 * inside what a watch's GPS already wanders by. It starts and ends exactly on
 * the first and last point, where the start and finish markers sit.
 */

/** Samples of the curve per original stretch. */
export const SMOOTH_STEPS = 8;

export interface SmoothPath {
  /** The curve, `SMOOTH_STEPS` points per stretch plus the last point. */
  points: [number, number][];
}

function bSpline(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = (1 - t) ** 3 / 6;
  const w1 = (3 * t3 - 6 * t2 + 4) / 6;
  const w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  const w3 = t3 / 6;
  return [
    w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1]
  ];
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
  // Past each end the missing neighbour is the end point mirrored, which is
  // what pins the curve to the end point and heads it along the route.
  const at = (index: number): [number, number] => {
    if (index < 0) {
      const [a, b] = [points[0]!, points[1]!];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    if (index > last) {
      const [a, b] = [points[last]!, points[last - 1]!];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    return points[index]!;
  };
  for (let index = 0; index < last; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    for (let step = 0; step < SMOOTH_STEPS; step += 1) {
      out.push(bSpline(p0, p1, p2, p3, step / SMOOTH_STEPS));
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
