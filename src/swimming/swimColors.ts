import type { SwimStyle } from "../../electron/types";
import { mixHex, readStoredSportColors } from "../training/sportColors";
import type { SwimType } from "./swimType";

/**
 * Swim colours as concrete hex, for the charts — `var()` does not resolve in
 * the SVG attributes recharts writes; see `rideTypeColors`.
 *
 * A pool swim is the athlete's own swim colour, which swims wear everywhere
 * else in the app (`sportColorCategory`); open water is mixed off it towards a
 * deep blue, so the two read as one family and follow the athlete
 * when they recolour it in Settings. The mix must match `.swimming-view` in
 * swimming.css.
 */
export function swimTypeColors(): Record<SwimType, string> {
  const sport = readStoredSportColors();
  return {
    pool: sport.swim,
    open: mixHex(sport.swim, "#2f5bd3", 0.4)
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
