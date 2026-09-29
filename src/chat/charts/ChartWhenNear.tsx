import { useEffect, useRef, useState, type ReactNode } from "react";

/** How far outside the transcript's visible part a chart is drawn ahead of time. */
const LOOKAHEAD = "800px 0px";

/**
 * A chart drawn once its box comes near the part of the transcript on screen,
 * and kept from then on.
 *
 * A long conversation holds dozens of charts, and recharts is the heaviest
 * thing on the screen: measured on a 110-entry transcript, mounting every one
 * of them was half of the ~2.3 s it took to open Coach, and every one of them
 * redrew on each width change — a collapse of the conversation list, a window
 * resize — for charts nobody could see. The box the chart sits in keeps its
 * size (every chart here is in a fixed-height shell), so nothing moves when
 * the chart arrives.
 *
 * Observed against the transcript rather than the window: the margin only
 * reaches past the root's own edge, and the transcript clips everything
 * outside it.
 */
export function ChartWhenNear({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = ref.current;
    if (near || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root: node.closest(".chat-transcript"), rootMargin: LOOKAHEAD }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  return (
    <div ref={ref} className="chat-chart-when-near">
      {near ? children : null}
    </div>
  );
}
