import { mixHex, readStoredSportColors } from "../training/sportColors";
import type { RunSurface } from "./runSurface";

/**
 * Surface colours as concrete hex, for the charts.
 *
 * The stylesheet reads the `--sport-*` custom properties directly, but recharts
 * writes `fill` and `stroke` as SVG *attributes*, where `var()` does not
 * resolve — so the same palette has to be resolved in JavaScript. It comes from
 * the same stored record the root variables are written from, which is what
 * keeps the chart and the chips around it the same colour.
 *
 * Road is the athlete's own run colour; trail, track and treadmill have no
 * token of their own, so they are mixed off it: the family stays recognisable
 * without inventing hues that could collide with a palette the athlete is free
 * to change. The mixes must match `.running-view` in running.css.
 */
export function runSurfaceColors(): Record<RunSurface, string> {
  const sport = readStoredSportColors();
  return {
    road: sport.run,
    trail: mixHex(sport.run, "#8a5a2b", 0.5),
    track: mixHex(sport.run, "#d89b22", 0.55),
    treadmill: mixHex(sport.run, "#8a8a90", 0.35)
  };
}
