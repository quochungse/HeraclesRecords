/**
 * A route's points joined by a curve rather than straight chords, which read
 * as a line of kinks at every bend.
 *
 * A uniform cubic B-spline, which approximates the points rather than passing
 * through them. An interpolating curve (Catmull–Rom was used first) has to bend
 * at every recorded point, a GPS wobble included, so the line still read as
 * kinked at the joins; this one is smooth in its curvature too. It starts and
 * ends exactly on the first and last point, where the start and finish
 * markers sit.
 *
 * **It is bounded.** A B-spline pulls each point towards its neighbours by a
 * sixth of the chords either side, so on its own it cut a corner by a sixth of
 * however far apart the points were — a few metres where they sat 25 m apart,
 * tens of metres where a simplified route runs a long chord into a junction.
 * So before the curve is laid, a control is added `CORNER_METERS` in from each
 * end of every longer chord: a corner then bends only between its nearest two
 * controls, and the curve stays within a third of `CORNER_METERS` of the
 * recorded line however long the chords around it. The controls in the middle
 * of a chord are in line with it, so the curve is straight there.
 *
 * Samples follow the bend: a stretch of the curve is cut into as few chords
 * as keep them within `FACET_METERS` of the true curve — a fifth of a pixel at
 * the closest zoom — so a straight one is its two ends and a corner is round
 * at any zoom, without paying for samples nobody can see.
 */

/** How far from a corner the curve begins to round it; it strays a third of this at most. */
export const CORNER_METERS = 6;
/** How far a chord between two samples may sag from the true curve. */
const FACET_METERS = 0.05;
/** The most samples one stretch of the curve takes. */
const MAX_STEPS = 16;

export interface SmoothPath {
  points: [number, number][];
  /**
   * Where each of `points` falls along the input, as a position — 12.5 is half
   * way along its thirteenth stretch — rising strictly from 0 to the last
   * point's index. A whole number is exactly that input point's sample.
   */
  along: number[];
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

function lerp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The curve along `points`, `[lat, lon]` pairs. Coordinates are treated as
 * planar, which over the span of one activity is well inside what can be seen;
 * lengths and turns are read in metres so a corner is judged the same way at
 * any latitude.
 */
export function smoothPath(points: readonly [number, number][]): SmoothPath {
  if (points.length < 2) {
    return { points: [...points], along: points.map((_, index) => index) };
  }
  const last = points.length - 1;
  const lat0 = points[0]![0] * (Math.PI / 180);
  const toMeters = (a: [number, number], b: [number, number]): [number, number] => [
    (b[1] - a[1]) * 111_320 * Math.cos(lat0),
    (b[0] - a[0]) * 110_540
  ];

  // The controls: the points, plus the ones that keep a corner to its chords'
  // last few metres, each with where it falls along the input.
  const controls: [number, number][] = [];
  const positions: number[] = [];
  for (let index = 0; index < last; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    controls.push(a);
    positions.push(index);
    const length = Math.hypot(...toMeters(a, b));
    if (length > 2 * CORNER_METERS) {
      const inset = CORNER_METERS / length;
      controls.push(lerp(a, b, inset), lerp(a, b, 1 - inset));
      positions.push(index + inset, index + 1 - inset);
    } else if (length > CORNER_METERS) {
      controls.push(lerp(a, b, 0.5));
      positions.push(index + 0.5);
    }
  }
  controls.push(points[last]!);
  positions.push(last);

  // Past each end the missing neighbour is the end control mirrored, which is
  // what pins the curve to the end point and heads it along the route.
  const end = controls.length - 1;
  const at = (index: number): [number, number] => {
    if (index < 0) {
      return lerp(controls[1]!, controls[0]!, 2);
    }
    if (index > end) {
      return lerp(controls[end - 1]!, controls[end]!, 2);
    }
    return controls[index]!;
  };

  const out: [number, number][] = [];
  const along: number[] = [];
  for (let index = 0; index < end; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    // The curve heads along p0→p2 where this stretch begins and p1→p3 where
    // it ends. An arc of length L turning θ, cut into n chords, sags about
    // Lθ / 8n² from each — four times that where even steps in t bunch up at
    // the recorded corner, the curve's tightest — so n = √(Lθ / 2·FACET).
    const [ax, ay] = toMeters(p0, p2);
    const [bx, by] = toMeters(p1, p3);
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    const length = Math.hypot(...toMeters(p1, p2));
    const steps = Math.min(
      MAX_STEPS,
      Math.max(1, Math.ceil(Math.sqrt((length * turn) / (2 * FACET_METERS))))
    );
    const from = positions[index]!;
    const span = positions[index + 1]! - from;
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      out.push(bSpline(p0, p1, p2, p3, t));
      along.push(from + span * t);
    }
  }
  out.push(controls[end]!);
  along.push(last);
  return { points: out, along: alongByLength(out, along, toMeters) };
}

/**
 * `along` as the share of the curve's own length between two input points'
 * samples, rather than of the spline's parameter. Even steps in the parameter
 * are not even in length — near a corner the curve covers three times the
 * ground the chord does — so a replay read off the parameter sped its head up
 * through every bend. The input points' own samples keep their whole numbers.
 */
function alongByLength(
  points: readonly [number, number][],
  along: readonly number[],
  toMeters: (a: [number, number], b: [number, number]) => [number, number]
): number[] {
  const result = [...along];
  let start = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (!Number.isInteger(along[index]!)) {
      continue;
    }
    // Samples `start` to `index` lie between two input points.
    const lengths = [0];
    for (let k = start + 1; k <= index; k += 1) {
      lengths.push(lengths[k - start - 1]! + Math.hypot(...toMeters(points[k - 1]!, points[k]!)));
    }
    const total = lengths[lengths.length - 1]!;
    if (total > 0) {
      for (let k = start + 1; k < index; k += 1) {
        result[k] = along[start]! + lengths[k - start]! / total;
      }
    }
    start = index;
  }
  return result;
}

/** The sample at or before `position`, and how far it is towards the next. */
function locate(path: SmoothPath, position: number): { index: number; fraction: number } {
  const { along } = path;
  const last = along.length - 1;
  if (position >= along[last]!) {
    return { index: last, fraction: 0 };
  }
  if (position <= 0) {
    return { index: 0, fraction: 0 };
  }
  let low = 0;
  let high = last;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (along[mid]! <= position) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { index: low, fraction: (position - along[low]!) / (along[low + 1]! - along[low]!) };
}

/** The spot on the curve at `position` (see `SmoothPath.along`). */
export function curveHead(path: SmoothPath, position: number): [number, number] {
  const { index, fraction } = locate(path, position);
  return fraction > 0 ? lerp(path.points[index]!, path.points[index + 1]!, fraction) : path.points[index]!;
}

/**
 * The curve from input point `from` (a whole number) to `position`, ending at
 * the exact spot there, so two runs that meet at a point share its sample.
 */
export function curveBetween(path: SmoothPath, from: number, position: number): [number, number][] {
  const start = locate(path, from).index;
  const { index, fraction } = locate(path, position);
  const points = path.points.slice(start, index + 1);
  if (fraction > 0) {
    points.push(lerp(path.points[index]!, path.points[index + 1]!, fraction));
  }
  return points;
}
