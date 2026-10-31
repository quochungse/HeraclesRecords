import type { SwimStyle } from "../../electron/types";
import { readStoredSportColors } from "../training/sportColors";
import type { SwimType } from "./swimType";

/**
 * Swim colours as concrete hex, for the charts — `var()` does not resolve in
 * the SVG attributes recharts writes; see `rideTypeColors`.
 *
 * A pool swim wears the colour swims already wear everywhere else in the app
 * (`sportColorCategory` files them under "other"); open water is mixed off it
 * towards a deep blue, so the two read as one family and follow the athlete
 * when they recolour it in Settings. The mix must match `.swimming-view` in
 * swimming.css.
 */

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(channels: [number, number, number]): string {
  return `#${channels
    .map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** `ratio` is how much of `from` survives; the rest comes from `to`. */
function mixHex(from: string, to: string, ratio: number): string {
  const left = parseHex(from);
  const right = parseHex(to);
  if (!left || !right) {
    return from;
  }
  return toHex([
    left[0] * ratio + right[0] * (1 - ratio),
    left[1] * ratio + right[1] * (1 - ratio),
    left[2] * ratio + right[2] * (1 - ratio)
  ]);
}

export function swimTypeColors(): Record<SwimType, string> {
  const sport = readStoredSportColors();
  return {
    pool: sport.other,
    open: mixHex(sport.other, "#2f5bd3", 0.4)
  };
}

/**
 * One hue a stroke, the same in both themes: freestyle the sky, backstroke
 * violet, breaststroke green, butterfly orange, the medley gold, a mixed
 * interval pink, drills and the undetected in greys — the two the eye should
 * pass over. Mirrored as `--swim-style-*` in swimming.css; change both.
 */
export const SWIM_STYLE_COLORS: Readonly<Record<SwimStyle, string>> = {
  free: "#4cb8e8",
  back: "#9b8cff",
  breast: "#4fc483",
  fly: "#f08a4b",
  medley: "#e2b33c",
  mixed: "#e27aa6",
  drill: "#8d96a3",
  unknown: "#5c6167"
};
