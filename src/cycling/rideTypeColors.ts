import { mixHex, readStoredSportColors } from "../training/sportColors";
import type { RideType } from "./rideType";

/**
 * Ride-kind colours as concrete hex, for the charts.
 *
 * recharts writes `fill` and `stroke` as SVG attributes, where `var()` does not
 * resolve, so the palette the stylesheet reads from `--ride-*` is resolved here
 * from the same stored record — see `runSurfaceColors`, which does the same for
 * a run's surfaces. Road is the athlete's own cycling colour; the other four
 * have no token of their own and are mixed off it, so they read as one family
 * and follow the athlete when they recolour cycling in Settings.
 *
 * The mixes must match `.cycling-view` in cycling.css.
 */
export function rideTypeColors(): Record<RideType, string> {
  const sport = readStoredSportColors();
  return {
    road: sport.bike,
    gravel: mixHex(sport.bike, "#b0643c", 0.5),
    mountain: mixHex(sport.bike, "#3f9b5c", 0.45),
    indoor: mixHex(sport.bike, "#8a8a90", 0.35),
    ebike: mixHex(sport.bike, "#4c8dff", 0.3)
  };
}
