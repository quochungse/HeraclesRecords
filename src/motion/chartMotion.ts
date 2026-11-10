/**
 * How a chart's marks move from one drawing to the next, for Recharts'
 * `animationInterpolateFn` (bars and line points alike).
 *
 * Recharts tags every mark `matched` (in both drawings, paired by
 * `animationMatchBy`), `added` or `removed`. A mark that is in both moves from
 * where it was to where it is. On a time axis paired by week, a period change
 * is a zoom: the weeks in both windows move to their new places, and from the
 * pairs comes the straight line that carries an old x onto a new one — so a
 * week that only one window holds comes in from, or leaves for, where it would
 * have stood off the edge, instead of growing out of the floor. The axis's
 * `allowDataOverflow` clips the plot so nothing is drawn over the labels on
 * the way.
 *
 * Node-free and Recharts-free: `npm run test:figure-motion`.
 */

/** The parts of a Recharts mark this file reads; everything else rides along. */
export interface MotionMark {
  x?: number | null;
  y?: number | null;
  width?: number;
  height?: number;
}

export type TaggedMark<T> =
  | { status: "matched"; prev: T; next: T }
  | { status: "added"; next: T }
  | { status: "removed"; prev: T };

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** next.x ≈ scale × prev.x + shift, from the pairs furthest apart; null without a pair. */
export function axisFit<T extends MotionMark>(
  items: readonly TaggedMark<T>[]
): { scale: number; shift: number } | null {
  let first: { prev: number; next: number } | null = null;
  let last: { prev: number; next: number } | null = null;
  for (const item of items) {
    if (item.status !== "matched" || !finite(item.prev.x) || !finite(item.next.x)) continue;
    const pair = { prev: item.prev.x, next: item.next.x };
    if (first === null || pair.prev < first.prev) first = pair;
    if (last === null || pair.prev > last.prev) last = pair;
  }
  if (first === null || last === null) return null;
  const span = last.prev - first.prev;
  const scale = span > 0.5 ? (last.next - first.next) / span : 1;
  if (!Number.isFinite(scale) || scale <= 0) return { scale: 1, shift: first.next - first.prev };
  return { scale, shift: first.next - scale * first.prev };
}

/** The drawing as it ends, with no step between: what a change nobody asked for gets. */
export function settledMarks<T>(items: readonly TaggedMark<T>[] | null): T[] {
  if (items == null) return [];
  return items.flatMap((item) => (item.status === "removed" ? [] : [item.next]));
}

/** Bars: paired ones move and resize; the rest ride the zoom, or grow and shrink in place without one. */
export function movingBars<T extends MotionMark>(items: readonly TaggedMark<T>[] | null, t: number): T[] {
  if (items == null) return [];
  if (t >= 1) return settledMarks(items);
  const fit = axisFit(items);
  return items.flatMap((item): T[] => {
    if (item.status === "matched") {
      const { prev, next } = item;
      return [
        {
          ...next,
          x: lerp(prev.x ?? 0, next.x ?? 0, t),
          y: lerp(prev.y ?? 0, next.y ?? 0, t),
          width: lerp(prev.width ?? 0, next.width ?? 0, t),
          height: lerp(prev.height ?? 0, next.height ?? 0, t)
        }
      ];
    }
    if (item.status === "added") {
      const { next } = item;
      if (fit === null || !finite(next.x)) {
        const height = next.height ?? 0;
        return [{ ...next, y: lerp((next.y ?? 0) + height, next.y ?? 0, t), height: lerp(0, height, t) }];
      }
      return [
        {
          ...next,
          x: lerp((next.x - fit.shift) / fit.scale, next.x, t),
          width: lerp((next.width ?? 0) / fit.scale, next.width ?? 0, t)
        }
      ];
    }
    const { prev } = item;
    if (fit === null || !finite(prev.x)) {
      const height = prev.height ?? 0;
      return [{ ...prev, y: lerp(prev.y ?? 0, (prev.y ?? 0) + height, t), height: lerp(height, 0, t) }];
    }
    return [
      {
        ...prev,
        x: lerp(prev.x, fit.scale * prev.x + fit.shift, t),
        width: lerp(prev.width ?? 0, (prev.width ?? 0) * fit.scale, t)
      }
    ];
  });
}

/** Line points: the same, except a point has no size and a missing value stays missing. */
export function movingPoints<T extends MotionMark>(items: readonly TaggedMark<T>[] | null, t: number): T[] {
  if (items == null) return [];
  if (t >= 1) return settledMarks(items);
  const fit = axisFit(items);
  return items.flatMap((item): T[] => {
    if (item.status === "matched") {
      const { prev, next } = item;
      return [
        {
          ...next,
          x: finite(prev.x) && finite(next.x) ? lerp(prev.x, next.x, t) : next.x,
          y: finite(prev.y) && finite(next.y) ? lerp(prev.y, next.y, t) : next.y
        }
      ];
    }
    if (item.status === "added") {
      const { next } = item;
      if (fit === null || !finite(next.x)) return [next];
      return [{ ...next, x: lerp((next.x - fit.shift) / fit.scale, next.x, t) }];
    }
    const { prev } = item;
    if (fit === null || !finite(prev.x)) return [];
    return [{ ...prev, x: lerp(prev.x, fit.scale * prev.x + fit.shift, t) }];
  });
}
