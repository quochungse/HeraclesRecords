import { mixHex, readStoredSportColors } from "../training/sportColors";
import type { HikeType } from "./hikeType";

/**
 * Hike-kind colours as concrete hex, for the charts — `var()` does not resolve
 * in the SVG attributes recharts writes; see `rideTypeColors`.
 *
 * A hike is the athlete's own hiking colour, which COROS's hike and mountain
 * codes already wear everywhere else in the app (`sportColorCategory`); a
 * mountain climb is mixed off it towards violet, so the two read as one family
 * and follow the athlete when they recolour hiking in Settings.
 *
 * The mix must match `.hiking-view` in hiking.css.
 */
export function hikeTypeColors(): Record<HikeType, string> {
  const sport = readStoredSportColors();
  return {
    hike: sport.hiking,
    mountain: mixHex(sport.hiking, "#8a5cf6", 0.45)
  };
}
