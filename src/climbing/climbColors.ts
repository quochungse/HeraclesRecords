import { mixHex, readStoredSportColors } from "../training/sportColors";
import type { ClimbKind } from "./climbType";

/**
 * Climbing colours as concrete hex, for the charts — `var()` does not resolve
 * in the SVG attributes recharts writes; see `rideTypeColors`.
 *
 * An indoor route is the athlete's own climbing colour, which climbs wear
 * everywhere else in the app (`sportColorCategory`); a boulder is mixed off it
 * towards white. Outdoors is rock and sky, a slate of its own: a darker tint
 * of the climbing colour read as a redpoint beside it. The mixes must match
 * `.climbing-view` in climbing.css.
 */
export function climbKindColors(): Record<ClimbKind, string> {
  const sport = readStoredSportColors();
  return {
    indoor: sport.climb,
    boulder: mixHex(sport.climb, "#ffffff", 0.5),
    outdoor: "#9aa7bd",
    multiPitch: "#6f7d99"
  };
}

/** How a climb went, as a pyramid's segments and a session's blocks are drawn. */
export type ClimbStyleGroup = "firstGo" | "worked" | "attempt" | "unrecorded";
