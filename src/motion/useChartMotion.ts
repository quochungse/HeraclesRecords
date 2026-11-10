import { useMemo } from "react";
import { matchByDataKey } from "recharts";
import type { AnimationInterpolateFn, BarRectangleItem, LinePointItem } from "recharts";
import { movingBars, movingPoints, settledMarks, type TaggedMark } from "./chartMotion";
import { FIGURE_MOTION_EASING, FIGURE_MOTION_MS } from "./figureMotion";
import { useFigureMotionFor } from "./useFigureMotionFor";

/**
 * Recharts' animation props for a chart whose marks move when the athlete
 * changes what it shows (`figureMotion.ts`), and only then. Spread `bar` onto
 * every `<Bar>` and `line` onto every `<Line>`.
 *
 * The animation stays switched on: Recharts keeps the last drawn frame only
 * while an animation runs, and a change it drew with animation off leaves the
 * next one starting from a stale drawing. What a change nobody asked for gets
 * instead is no step between — `settledMarks` at every frame, over a
 * millisecond. A line never draws itself in (`animateNewValues`).
 *
 * `matchKey` names a field of the chart's rows that is the same week in every
 * window (`weekStartMs`), which is what turns a period change into a zoom; the
 * chart's x-axis takes `allowDataOverflow` so the zoom is clipped to the plot.
 */
export function useChartMotion(data: unknown, matchKey?: string) {
  const kind = useFigureMotionFor(data)?.kind ?? null;
  return useMemo(() => {
    const matchBy = matchKey ? { animationMatchBy: matchByDataKey(matchKey) } : {};
    const timing = {
      isAnimationActive: true,
      animationDuration: kind ? FIGURE_MOTION_MS[kind] : 1,
      animationEasing: FIGURE_MOTION_EASING
    };
    return {
      bar: { ...timing, ...matchBy, animationInterpolateFn: kind ? movingBarsFn : settledBarsFn },
      line: { ...timing, ...matchBy, animateNewValues: false, animationInterpolateFn: kind ? movingPointsFn : settledPointsFn }
    };
  }, [kind, matchKey]);
}

type Layout = "horizontal" | "vertical";
const tagged = <T,>(items: ReadonlyArray<unknown> | null) => items as readonly TaggedMark<T>[] | null;

const movingBarsFn: AnimationInterpolateFn<BarRectangleItem, Layout> = (items, t) =>
  movingBars(tagged<BarRectangleItem>(items), t);
const settledBarsFn: AnimationInterpolateFn<BarRectangleItem, Layout> = (items) =>
  settledMarks(tagged<BarRectangleItem>(items));
const movingPointsFn: AnimationInterpolateFn<LinePointItem, Layout> = (items, t) =>
  movingPoints(tagged<LinePointItem>(items), t);
const settledPointsFn: AnimationInterpolateFn<LinePointItem, Layout> = (items) =>
  settledMarks(tagged<LinePointItem>(items));
