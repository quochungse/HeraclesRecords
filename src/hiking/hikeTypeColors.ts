import { readStoredSportColors } from "../training/sportColors";
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

export function hikeTypeColors(): Record<HikeType, string> {
  const sport = readStoredSportColors();
  return {
    hike: sport.hiking,
    mountain: mixHex(sport.hiking, "#8a5cf6", 0.45)
  };
}
