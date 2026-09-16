import { useLayoutEffect, useRef, useState } from "react";

interface SleepMetricValueProps {
  /** The one line that fits the tile. */
  value: string;
  /**
   * What the tile cannot fit, one fact per line. Given, it replaces the
   * browser's own tooltip — two tooltips over one word is worse than either.
   */
  hover?: string;
  /** For the screen-reader name, which is the label the tile sits under. */
  label: string;
}

/**
 * A metric tile's value, with the detail it could not fit shown on hover.
 *
 * Two things about how it is put together, both load-bearing:
 *
 * **The note is a sibling of the value, not a child.** Every one of these tiles
 * clips its value and ends it in an ellipsis — that is what keeps the tile one
 * line tall — so a note inside it is clipped by the same rule and is never
 * seen. It is absolutely positioned against the tile, which takes it out of the
 * grid the tile is, so it costs the row no height either.
 *
 * **It opens toward the middle of its row.** The tiles sit in a grid whose
 * column count follows the width (`auto-fit`), so which tile is at an edge is
 * not something a stylesheet can know — and a note centred on the last tile of
 * a row hangs off the side of the panel, the trap the Activities mix bar's
 * tooltip was written around. Measuring the tile against its own row answers it
 * for any number of columns.
 *
 * Reachable without a pointer: the value takes focus when it has a note, and
 * the note shows for `:focus-within` as well as `:hover`.
 */
export function SleepMetricValue({ value, hover, label }: SleepMetricValueProps) {
  const cell = useRef<HTMLElement | null>(null);
  const [side, setSide] = useState<"start" | "end">("start");

  useLayoutEffect(() => {
    const node = cell.current;
    if (!hover || !node) {
      return;
    }

    const row = node.closest("dl");
    const measure = () => {
      const tile = node.getBoundingClientRect();
      const bounds = row?.getBoundingClientRect();
      if (!bounds || bounds.width === 0) {
        return;
      }

      setSide(
        tile.left + tile.width / 2 > bounds.left + bounds.width / 2 ? "end" : "start"
      );
    };

    measure();

    // The grid is `auto-fit`, so the answer is a function of the row's width
    // and nothing else this component renders — a resized window reflows which
    // tile is at an edge without changing a prop, and a note measured once
    // then opens off the side of the panel, which is the one thing this is for.
    if (!row || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [hover, value]);

  if (!hover) {
    return (
      <dd ref={cell as React.RefObject<HTMLElement>} title={value}>
        {value}
      </dd>
    );
  }

  return (
    <>
      <dd
        ref={cell as React.RefObject<HTMLElement>}
        className="has-note"
        tabIndex={0}
        // The note is the second half of the accessible name, so what a pointer
        // reveals and what a screen reader says are the same answer.
        aria-label={`${label}: ${value}. ${hover.replace(/\n/g, ". ")}`}
      >
        {value}
      </dd>
      <span className="sleep-metric-note" data-note-side={side} aria-hidden="true">
        {hover}
      </span>
    </>
  );
}
