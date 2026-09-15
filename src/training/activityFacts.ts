/**
 * The handful of figures a list row shows for one activity.
 *
 * Every one of them is already on the list payload — `avgHr`, `trainingLoad`
 * and `elevationGain` included, which the old four-column table carried across
 * the wire and never drew. Nothing here costs a request.
 *
 * The set is chosen per sport rather than fixed, because a fixed set is what
 * put a column of "0 km" beside every strength session.
 */
import type { TrainingHubActivity, UnitSystem } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters,
  formatPaceSecondsPerKm
} from "./formatters";
import { isCyclingSportType, isSwimSportType } from "./sportTypes";
import { formatSpeedValue } from "../units/units";

export interface ActivityFact {
  key: string;
  value: string;
  /** Spelled out on hover, since the row itself has no column headings. */
  title: string;
}

/** Foot sports where a seconds-per-kilometre pace is the natural reading. */
function isPacedSport(sportType: number | undefined): boolean {
  return !isCyclingSportType(sportType) && !isSwimSportType(sportType);
}

/**
 * At most four, in the order the sport is usually read.
 *
 * Four rather than everything available: the row is one line under a title,
 * and a fifth figure is the one that makes the line wrap on a narrow pane.
 */
export function activityRowFacts(
  activity: TrainingHubActivity,
  unitSystem: UnitSystem
): ActivityFact[] {
  const { sportType, distance, duration, avgHr, trainingLoad, elevationGain } =
    activity;
  const swim = isSwimSportType(sportType);
  const cycling = isCyclingSportType(sportType);
  const facts: ActivityFact[] = [];

  if (duration && duration > 0) {
    facts.push({
      key: "duration",
      value: formatDurationSpan(duration),
      title: "Activity time, pauses taken out"
    });
  }

  if (distance && distance > 0) {
    facts.push({
      key: "distance",
      value: formatDistanceMeters(distance, unitSystem, swim),
      title: "Distance"
    });

    if (duration && duration > 0) {
      if (cycling) {
        facts.push({
          key: "speed",
          value: formatSpeedValue(distance / 1000 / (duration / 3600), unitSystem),
          title: "Average speed"
        });
      } else if (isPacedSport(sportType)) {
        facts.push({
          key: "pace",
          value: formatPaceSecondsPerKm(duration / (distance / 1000), unitSystem),
          title: "Average pace"
        });
      }
    }
  }

  if (avgHr && avgHr > 0) {
    facts.push({
      key: "avgHr",
      value: `${Math.round(avgHr)} bpm`,
      title: "Average heart rate"
    });
  }

  // Climb earns its place only on a session that actually climbed: every flat
  // road run carries a few metres of GPS noise, and a "4 m" on every row is
  // four characters of nothing.
  if (facts.length < 4 && elevationGain && elevationGain >= 50) {
    facts.push({
      key: "climb",
      value: formatElevationMeters(elevationGain, unitSystem),
      title: "Elevation gained"
    });
  }

  if (facts.length < 4 && trainingLoad && trainingLoad > 0) {
    facts.push({
      key: "load",
      value: `${Math.round(trainingLoad)} TL`,
      title: "Training load, as COROS scores it"
    });
  }

  return facts.slice(0, 4);
}
