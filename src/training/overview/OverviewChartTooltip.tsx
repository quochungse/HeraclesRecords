import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ChartAnchor {
  x: number;
  y: number;
}

/** Fixed to the viewport so the chart's card and scrollport never clip it. */
export function OverviewChartTooltip({
  id,
  anchor,
  children,
  onDismiss,
}: {
  id: string;
  anchor: ChartAnchor;
  children: ReactNode;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 220, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // A fixed anchor belongs to the chart's old position after either event.
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [onDismiss]);
  const left = Math.max(
    8,
    Math.min(anchor.x - size.width / 2, window.innerWidth - size.width - 8),
  );
  const above = anchor.y - size.height - 12;
  const top = Math.max(8,
    Math.min(above >= 8 ? above : anchor.y + 12, window.innerHeight - size.height - 8),
  );
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className="overview-chart-tooltip"
      style={{ left, top, visibility: size.height ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
