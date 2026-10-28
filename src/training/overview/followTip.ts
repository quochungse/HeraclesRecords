import type { PointerEvent } from "react";

/*
 * A chart column's tooltip (`.overview-tip`) follows the pointer while the
 * column is pointed at: beside the cursor, flipped to its other side where the
 * panel ends, and held inside the panel, which clips what leaves it. Written
 * straight onto the tooltip's style, so following costs no render. Focused
 * from the keyboard, with no pointer, the tooltip keeps its place in the
 * stylesheet beside the column.
 */

/** From the cursor to the tooltip's near edge. */
const CURSOR_GAP = 14;
/** Kept clear of the panel's edges. */
const PANEL_MARGIN = 8;

function tipOf(column: HTMLElement): HTMLElement | null {
  return column.querySelector<HTMLElement>(":scope > .overview-tip");
}

export function followTip(event: PointerEvent<HTMLElement>): void {
  const column = event.currentTarget;
  const tip = tipOf(column);
  if (!tip) {
    return;
  }
  const bounds = (column.closest(".panel") ?? document.documentElement).getBoundingClientRect();
  const own = column.getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let left = event.clientX + CURSOR_GAP;
  if (left + width > bounds.right - PANEL_MARGIN) {
    left = event.clientX - CURSOR_GAP - width;
  }
  left = Math.max(bounds.left + PANEL_MARGIN, left);
  const top = Math.min(
    Math.max(bounds.top + PANEL_MARGIN, event.clientY - height / 2),
    bounds.bottom - PANEL_MARGIN - height
  );
  tip.style.left = `${left - own.left}px`;
  tip.style.right = "auto";
  tip.style.top = `${top - own.top}px`;
}

/**
 * The pointer has gone: the stylesheet's place again, for a later focus — once
 * the tooltip has faded, or it would jump back beside the column mid-fade. A
 * tooltip a focus keeps open stays where it is.
 */
export function releaseTip(event: PointerEvent<HTMLElement>): void {
  const tip = tipOf(event.currentTarget);
  if (!tip) {
    return;
  }
  // Visibility ends its transition last of all, at the end of the fade.
  const clear = (transition: TransitionEvent) => {
    if (transition.propertyName !== "visibility") {
      return;
    }
    tip.removeEventListener("transitionend", clear);
    if (getComputedStyle(tip).visibility === "hidden") {
      tip.style.left = "";
      tip.style.right = "";
      tip.style.top = "";
    }
  };
  tip.addEventListener("transitionend", clear);
}
