import { useRef, useState, type KeyboardEvent } from "react";

/**
 * A chart's columns as one stop in the tab order, not one stop each: the
 * chart is tabbed into at one column — the last one moved to, or `start` —
 * and the arrow keys move between its columns, Home and End to its ends. A
 * column focused this way shows its tooltip, as a pointer over it does.
 */
export function useColumnFocus(count: number, start: number) {
  const [active, setActive] = useState<number | null>(null);
  const columns = useRef<Array<HTMLElement | null>>([]);
  const current = Math.min(Math.max(active ?? start, 0), Math.max(0, count - 1));
  return (index: number) => ({
    ref: (element: HTMLElement | null) => {
      columns.current[index] = element;
    },
    tabIndex: index === current ? 0 : -1,
    onFocus: () => setActive(index),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const next =
        event.key === "ArrowRight"
          ? index + 1
          : event.key === "ArrowLeft"
            ? index - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? count - 1
                : undefined;
      if (next === undefined || next < 0 || next >= count || next === index) {
        return;
      }
      event.preventDefault();
      setActive(next);
      columns.current[next]?.focus();
    }
  });
}
