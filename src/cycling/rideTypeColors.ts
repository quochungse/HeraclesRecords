import { readStoredSportColors } from "../training/sportColors";
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
