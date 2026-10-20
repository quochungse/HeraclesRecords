import type { TrainingHubActivitySeriesPoint, UnitSystem } from "../../electron/types";
import { formatDecimal } from "../i18n/core";
import { displayDistanceToMeters, distanceUnit, metersToDisplayDistance } from "../units/units";
import { formatDurationSeconds } from "./formatters";

/*
 * The time-or-distance axis an activity's charts are read along. On a run's
 * page the efficiency chart stands over the Performance chart, and a stretch is
 * read down from one to the other: so both take their extent, their marks and
 * their labels from here, and a minute sits at the same x in each.
 */

export type ActivitySeriesAxis = "elapsed" | "distance";

/** Steps a time axis is marked in, seconds: whole minutes, as a runner reads a clock. */
const TIME_STEPS = [60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 10800];
/** Steps a distance axis is marked in, in the display unit. */
const DISTANCE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
/** At most this many marks; a chart drops more where their labels would touch. */
const MAX_TICKS = 8;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatXTick(axis: ActivitySeriesAxis, value: number, unitSystem: UnitSystem): string {
  if (axis === "elapsed") {
    return formatDurationSeconds(value);
  }
  return formatDecimal(metersToDisplayDistance(value, unitSystem), 1);
}

/** A tooltip's heading: the same position as a tick, with its unit. */
export function formatXLabel(axis: ActivitySeriesAxis, value: number, unitSystem: UnitSystem): string {
  if (axis === "elapsed") {
    return formatDurationSeconds(value);
  }
  return `${formatDecimal(metersToDisplayDistance(value, unitSystem), 2)} ${distanceUnit(unitSystem)}`;
}

/** The first and last position the series reaches on the axis, or none when it has no reading there. */
export function seriesAxisExtent(
  series: readonly TrainingHubActivitySeriesPoint[],
  axis: ActivitySeriesAxis
): [number, number] | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const point of series) {
    const value = point[axis];
    if (finite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return min <= max ? [min, max] : undefined;
}

/**
 * Round marks across `from`–`to`: every whole number of minutes, or of the
 * display unit's kilometres or miles — never the 16:40 a decimal step lands on.
 */
export function activityAxisTicks(
  from: number,
  to: number,
  axis: ActivitySeriesAxis,
  unitSystem: UnitSystem
): number[] {
  const span = to - from;
  if (!(span > 0)) {
    return [from];
  }
  const unit = axis === "elapsed" ? 1 : displayDistanceToMeters(1, unitSystem);
  const steps = axis === "elapsed" ? TIME_STEPS : DISTANCE_STEPS;
  const step =
    (steps.find((candidate) => span / (candidate * unit) <= MAX_TICKS - 1) ?? steps[steps.length - 1]!) *
    unit;
  const first = Math.ceil(from / step - 1e-9);
  const ticks: number[] = [];
  for (let index = first; index * step <= to + 1e-9; index += 1) {
    // `|| 0`: the ceiling of a hair under zero is −0, which prints as "-0.0".
    ticks.push(Math.round(index * step * 1000) / 1000 || 0);
  }
  return ticks;
}

/**
 * Where a moment of activity time sits on the axis: the moment itself, or the
 * distance covered by then, read between the samples either side of it. For a
 * chart whose readings are stamped in time drawn along the other's distance.
 */
export function axisPositionOf(
  series: readonly TrainingHubActivitySeriesPoint[],
  axis: ActivitySeriesAxis
): (seconds: number) => number | undefined {
  if (axis === "elapsed") {
    return (seconds) => seconds;
  }
  const times: number[] = [];
  const distances: number[] = [];
  for (const point of series) {
    const later = times.length === 0 || (finite(point.elapsed) && point.elapsed > times.at(-1)!);
    if (finite(point.elapsed) && finite(point.distance) && later) {
      times.push(point.elapsed);
      distances.push(point.distance);
    }
  }
  if (times.length === 0) {
    return () => undefined;
  }
  const last = times.length - 1;
  return (seconds) => {
    if (seconds <= times[0]!) return distances[0];
    if (seconds >= times[last]!) return distances[last];
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (times[middle]! <= seconds) low = middle;
      else high = middle;
    }
    const share = (seconds - times[low]!) / (times[high]! - times[low]!);
    return distances[low]! + (distances[high]! - distances[low]!) * share;
  };
}
