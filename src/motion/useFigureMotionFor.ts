import { useRef } from "react";
import {
  FIGURE_MOTION_MS,
  INTENT_WINDOW_MS,
  freshFigureMotion,
  prefersReducedMotion,
  type FigureMotionIntent
} from "./figureMotion";

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
  if (intent === null) return null;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return now - intent.at <= INTENT_WINDOW_MS + FIGURE_MOTION_MS.roll ? intent : null;
}
