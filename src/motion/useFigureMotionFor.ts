import { useEffect, useReducer, useRef } from "react";
import {
  FIGURE_MOTION_MS,
  INTENT_WINDOW_MS,
  freshFigureMotion,
  prefersReducedMotion,
  type FigureMotionIntent
} from "./figureMotion";

const clock = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The press this drawing answers, or null: decided once each time `data`
 * changes by reference, and kept only while the motion it started can still
 * be running — a redraw long after it (a window resized) is not its answer.
 * Under reduced motion nothing a drawing does is an answer.
 */
export function useFigureMotionFor(data: unknown): FigureMotionIntent | null {
  const memo = useRef<{ data: unknown; intent: FigureMotionIntent | null } | null>(null);
  if (memo.current === null) {
    memo.current = { data, intent: null };
  } else if (memo.current.data !== data) {
    memo.current = { data, intent: prefersReducedMotion() ? null : freshFigureMotion() };
  }
  const { intent } = memo.current;
  // Nothing renders the caller again once its motion is over, so the answer
  // would stand for good and the chart's next redraw of its own (a window
  // resized) would move as if pressed for. A timer draws it once more, settled.
  const [, settle] = useReducer((count: number) => count + 1, 0);
  const until = intent === null ? null : intent.at + INTENT_WINDOW_MS + FIGURE_MOTION_MS.roll;
  useEffect(() => {
    if (until === null) return;
    const left = until - clock();
    if (left < 0) return;
    const timer = setTimeout(settle, left + 1);
    return () => clearTimeout(timer);
  }, [until]);
  return intent !== null && until !== null && clock() <= until ? intent : null;
}
