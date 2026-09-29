import type { TrainingHubTrackPoint } from "./types";

/**
 * The route map's own copy of a track: every located sample the line needs and
 * none it does not, rather than a fixed count.
 *
 * `track.points` is decimated to 400 by sample index, which is plenty for an
 * elevation profile and wrong for a line on a street map: a 100 km ride kept a
 * point every 250 m, so its chords cut through every bend, and nothing on a
 * straight stretch said so. Here the count follows the route instead:
 *
 * - **Shape** — Douglas–Peucker at `TOLERANCE_METERS`, so the kept line is
 *   never further from the recorded one than a watch's own GPS error. What it
 *   drops is the jitter of a 1 Hz track standing still or running straight.
 * - **Spacing** — never a longer gap between two kept points than the old 400
 *   left on the same route, bounded to 10–100 m. A stretch is what the map
 *   colours by pace or heart rate and counts passes over, so a straight road
 *   kept as one 2 km chord would be one colour and one count.
 *
 * Both limits loosen together, by half again, until the route fits the point
 * budget. Only located points are kept: the map draws nothing else.
 */

/** How far the kept line may stray from the recorded one. */
export const TOLERANCE_METERS = 3;
/** The budget: each point crosses the context bridge with every detail read. */
export const MAX_ROUTE_POINTS = 2000;
/** The longest gap the side panel's 400 points left, as a share of the route. */
const SPACING_SHARE = 1 / 400;
const MIN_SPACING_METERS = 10;
const MAX_SPACING_METERS = 100;
/** How much both limits loosen when a route does not fit the budget. */
const LOOSEN = 1.5;

type Xy = readonly [number, number];

function distanceToSegment(point: Xy, from: Xy, to: Xy): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.min(1, Math.max(0, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length));
  return Math.hypot(point[0] - (from[0] + dx * t), point[1] - (from[1] + dy * t));
}

/** The interior points between `from` and `to` that the shape needs, in order. */
function peucker(xy: readonly Xy[], from: number, to: number, tolerance: number): number[] {
  const kept: number[] = [];
  const stack: [number, number][] = [[from, to]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const gap = distanceToSegment(xy[index]!, xy[start]!, xy[end]!);
      if (gap > distance) {
        distance = gap;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      kept.push(farthest);
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return kept.sort((a, b) => a - b);
}

function keptIndexes(
  xy: readonly Xy[],
  along: readonly number[],
  tolerance: number,
  spacing: number
): number[] {
  const last = xy.length - 1;
  // Spacing first: the anchors are kept whatever the shape, and the shape is
  // then read between each pair, which also keeps Douglas–Peucker's worst case
  // to the samples of one gap rather than the whole route.
  const anchors = [0];
  for (let index = 1; index < last; index += 1) {
    if (along[index]! - along[anchors[anchors.length - 1]!]! >= spacing) {
      anchors.push(index);
    }
  }
  anchors.push(last);

  const kept: number[] = [];
  for (let k = 0; k < anchors.length - 1; k += 1) {
    kept.push(anchors[k]!, ...peucker(xy, anchors[k]!, anchors[k + 1]!, tolerance));
  }
  kept.push(last);
  return kept;
}

/** The route map's points for a track, or undefined when fewer than two are located. */
export function simplifyRoute(
  points: readonly TrainingHubTrackPoint[]
): TrainingHubTrackPoint[] | undefined {
  const located = points.filter(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  if (located.length < 2) {
    return undefined;
  }

  // Metres on a plane through the first point: over the span of one activity
  // the error is far below the tolerance.
  const lat0 = located[0]!.lat! * (Math.PI / 180);
  const xy = located.map((point): Xy => [
    point.lon! * 111_320 * Math.cos(lat0),
    point.lat! * 110_540
  ]);
  const along = [0];
  for (let index = 1; index < xy.length; index += 1) {
    const [x0, y0] = xy[index - 1]!;
    const [x1, y1] = xy[index]!;
    along.push(along[index - 1]! + Math.hypot(x1 - x0, y1 - y0));
  }

  let tolerance = TOLERANCE_METERS;
  let spacing = Math.min(
    MAX_SPACING_METERS,
    Math.max(MIN_SPACING_METERS, along[along.length - 1]! * SPACING_SHARE)
  );
  for (;;) {
    const kept = keptIndexes(xy, along, tolerance, spacing);
    if (kept.length <= MAX_ROUTE_POINTS) {
      return kept.map((index) => located[index]!);
    }
    tolerance *= LOOSEN;
    spacing *= LOOSEN;
  }
}
