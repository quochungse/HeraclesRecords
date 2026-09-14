import { readStoredSportColors } from "../training/sportColors";
import { RUN_SURFACES, type RunSurface } from "./runSurface";

/**
 * Surface colours as concrete hex, for the charts.
 *
 * The stylesheet reads the `--sport-*` custom properties directly, but recharts
 * writes `fill` and `stroke` as SVG *attributes*, where `var()` does not
 * resolve — so the same palette has to be resolved in JavaScript. It comes from
 * the same stored record the root variables are written from, which is what
 * keeps the chart and the chips around it the same colour.
 *
 * Road and trail map onto the athlete's own run and trail colours. Track and
 * treadmill have no token of their own, so they are mixed off the run colour:
 * the family stays recognisable without inventing two more hues that could
 * collide with a palette the athlete is free to change.
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
export function mixHex(from: string, to: string, ratio: number): string {
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

export function runSurfaceColors(): Record<RunSurface, string> {
  const sport = readStoredSportColors();
  return {
    road: sport.run,
    trail: sport.trail,
    track: mixHex(sport.run, "#d89b22", 0.55),
    treadmill: mixHex(sport.run, "#8a8a90", 0.35)
  };
}

/** The colours of the surfaces present, in render order. */
export function orderedSurfaceColors(
  surfaces: readonly RunSurface[]
): { surface: RunSurface; color: string }[] {
  const colors = runSurfaceColors();
  return RUN_SURFACES.filter((surface) => surfaces.includes(surface)).map(
    (surface) => ({ surface, color: colors[surface] })
  );
}
