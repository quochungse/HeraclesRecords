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
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  UnitSystem
} from "../../electron/types";
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
 * The most a row's line will carry.
 *
 * Not everything available: the line sits under a title in a pane about 600px
 * wide, and the sixth figure is the one that wraps it. A full run row —
 * time, distance, pace, heart rate, drift — is exactly five.
 */
const MAX_FACTS = 5;

/**
 * At most {@link MAX_FACTS}, in the order the sport is usually read.
 */
export function activityRowFacts(
  activity: TrainingHubActivity,
  unitSystem: UnitSystem,
  /**
   * The stored detail summary, where one has been computed. It fills in behind
   * the list rather than holding it back, so a row shows what it has.
   */
  summary?: ActivityDetailSummary
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

  // Decoupling before climb and load: it says something about the session that
  // none of the session's own figures do, and it is the reason the stored
  // summaries exist at all.
  if (facts.length < MAX_FACTS && summary?.decouplingPercent !== undefined) {
    const drift = summary.decouplingPercent;
    facts.push({
      key: "drift",
      value: `${drift > 0 ? "+" : ""}${drift.toFixed(1)}% drift`,
      title:
        "Aerobic decoupling — how far pace and heart rate moved apart after " +
        "the first ten minutes. Under 5% is a session held together."
    });
  }

  // Climb earns its place only on a session that actually climbed: every flat
  // road run carries a few metres of GPS noise, and a "4 m" on every row is
  // four characters of nothing.
  if (facts.length < MAX_FACTS && elevationGain && elevationGain >= 50) {
    facts.push({
      key: "climb",
      value: formatElevationMeters(elevationGain, unitSystem),
      title: "Elevation gained"
    });
  }

  if (facts.length < MAX_FACTS && trainingLoad && trainingLoad > 0) {
    facts.push({
      key: "load",
      value: `${Math.round(trainingLoad)} TL`,
      title: "Training load, as COROS scores it"
    });
  }

  return facts.slice(0, MAX_FACTS);
}
