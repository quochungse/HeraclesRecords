import type { TrainingHubActivity, UnitSystem } from "../../electron/types";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation
} from "../units/units";
import { runWindowStartMs } from "./runMetrics";

import { formatDecimal } from "../i18n/core";
/**
 * What the sport screens' weekly volume charts share — Running's, Cycling's
 * and Hiking's: the three measures a week can be read in, the trailing
 * average under the bars, and the same span a year back.
 *
 * Each chart still decides what it opens on, what its bars are stacked by and
 * what its dashed line is called. What a measure *is* was written three times,
 * one copy per screen, and is written here.
 */

/**
 * Ground covered, time on the move, or height gained. Running and Cycling
 * call the last "Climb" and Hiking "Ascent"; the label is the screen's.
 */
export type VolumeMeasure = "distance" | "time" | "climb";

/** What a measure is read from: a week, one kind's share of it, or its biggest session. */
export interface Volume {
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  /** Metres climbed. */
  elevationGain: number;
}

/** Weeks the trailing average is taken over. */
export const MOVING_AVERAGE_WEEKS = 4;
/** "A year ago" in whole weeks, so the comparison starts on a Monday too. */
const WEEKS_PER_YEAR = 52;
const SECONDS_PER_HOUR = 3600;

/** A volume in the chosen measure, in the unit the chart draws. */
export function measured(volume: Volume, measure: VolumeMeasure, unitSystem: UnitSystem): number {
  if (measure === "time") return volume.duration / SECONDS_PER_HOUR;
  if (measure === "climb") return metersToElevation(volume.elevationGain, unitSystem);
  return metersToDisplayDistance(volume.distance, unitSystem);
}

export function measureUnit(measure: VolumeMeasure, unitSystem: UnitSystem): string {
  if (measure === "time") return "h";
  if (measure === "climb") return elevationUnit(unitSystem);
  return distanceUnit(unitSystem);
}

/** One decimal where the numbers are small enough for it to matter. */
export function formatMeasure(value: number, measure: VolumeMeasure, unitSystem: UnitSystem): string {
  const digits = measure === "climb" ? 0 : 1;
  return `${formatDecimal(value, digits)} ${measureUnit(measure, unitSystem)}`;
}

/**
 * The trailing average ending at `end` of `buckets`, which must start
 * `MOVING_AVERAGE_WEEKS - 1` weeks before the chart does. Taken over a window
 * that reaches before the chart rather than one clipped to it: clipped, the
 * first three points of every chart were one-, two- and three-week averages
 * drawn under a legend calling all of them four-week.
 */
export function trailingAverage(
  buckets: readonly Volume[],
  end: number,
  measure: VolumeMeasure,
  unitSystem: UnitSystem
): number {
  const window = buckets.slice(Math.max(0, end - MOVING_AVERAGE_WEEKS + 1), end + 1);
  return (
    window.reduce((sum, bucket) => sum + measured(bucket, measure, unitSystem), 0) /
    Math.max(1, window.length)
  );
}

function shiftWeeks(timestampMs: number, weeks: number): number {
  const date = new Date(timestampMs);
  date.setDate(date.getDate() - weeks * 7);
  return date.getTime();
}

/**
 * The chart's own window, a year back, summed by the screen's own totals — or
 * nothing, when the window is longer than a year and "a year ago" would
 * overlap the bars above it. Under "All" the chart spans two years, and half
 * of the old figure was the same training the chart was drawing.
 *
 * Asked of the whole history rather than the filtered period, because the
 * period is what the athlete is looking at now and the comparison is
 * explicitly about a window they are not looking at.
 */
export function oneYearEarlier<T>(
  activities: readonly TrainingHubActivity[],
  { weeks, nowMs }: { weeks: number; nowMs: number },
  summarise: (inWindow: TrainingHubActivity[]) => T
): T | undefined {
  // "1 year" is 53 calendar weeks; stepping back 53 keeps it clear of itself.
  const back = Math.max(WEEKS_PER_YEAR, weeks);
  if (back > WEEKS_PER_YEAR + 1) {
    return undefined;
  }

  const start = shiftWeeks(runWindowStartMs(weeks, nowMs), back) / 1000;
  const end = shiftWeeks(nowMs, back) / 1000;
  const inWindow = activities.filter(
    (activity) =>
      activity.startTime !== undefined && activity.startTime >= start && activity.startTime <= end
  );
  return inWindow.length > 0 ? summarise(inWindow) : undefined;
}
