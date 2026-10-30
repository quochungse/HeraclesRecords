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
import type { StrengthLoadSource, TrainingHubActivity, UnitSystem } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters,
  formatPaceSecondsPerKm
} from "./formatters";
import { activityLoad, activityLoadNote } from "./loadFigures";
import { isSpeedSport, isSwimSportType } from "./sportTypes";
import { activityReading, formatSwimPace } from "../../electron/activityReading";
import { formatSpeedValue } from "../units/units";
import { t } from "../i18n/core";

export interface ActivityFact {
  key: string;
  value: string;
  /** Spelled out on hover, since the row itself has no column headings. */
  title: string;
}

/**
 * Foot sports where a seconds-per-kilometre pace is the natural reading — a
 * run or a walk; not a ride, a swim, a hike (km/h) or a gym session.
 */
function isPacedSport(sportType: number | undefined): boolean {
  return activityReading(sportType) === "pace";
}

/**
 * The most a row's line will carry.
 *
 * The line sits under a name in a column about 330px wide and is cut rather
 * than wrapped, and three figures are what fit it: a run's time, distance and
 * pace. Everything else is on the pane the row opens. It was five, with a
 * drift figure off the stored detail summary, when the column was a table's
 * width and a line could wrap.
 */
const MAX_FACTS = 3;

/**
 * At most {@link MAX_FACTS}, in the order the sport is usually read.
 */
export function activityRowFacts(
  activity: TrainingHubActivity,
  unitSystem: UnitSystem,
  loadSource: StrengthLoadSource = "coros"
): ActivityFact[] {
  const { sportType, distance, duration, avgHr, elevationGain } = activity;
  const trainingLoad = activityLoad(activity, loadSource);
  const swim = isSwimSportType(sportType);
  const speed = isSpeedSport(sportType);
  const facts: ActivityFact[] = [];

  if (duration && duration > 0) {
    facts.push({
      key: "duration",
      value: formatDurationSpan(duration),
      title: t("activity.pane.timeTitle")
    });
  }

  if (distance && distance > 0) {
    facts.push({
      key: "distance",
      value: formatDistanceMeters(distance, unitSystem, swim),
      title: t("activity.m.distance")
    });

    if (duration && duration > 0) {
      // A swim is read per 100 m (or yd), as the pane reads it: its heart rate,
      // which took this slot, is what a swimmer's watch reads worst.
      if (swim) {
        facts.push({
          key: "pace",
          value: formatSwimPace(duration / (distance / 1000), unitSystem),
          title: t("activity.fact.avgPace")
        });
      } else if (speed) {
        facts.push({
          key: "speed",
          value: formatSpeedValue(distance / 1000 / (duration / 3600), unitSystem),
          title: t("activity.fact.avgSpeed")
        });
      } else if (isPacedSport(sportType)) {
        facts.push({
          key: "pace",
          value: formatPaceSecondsPerKm(duration / (distance / 1000), unitSystem),
          title: t("activity.fact.avgPace")
        });
      }
    }
  }

  if (avgHr && avgHr > 0) {
    facts.push({
      key: "avgHr",
      value: `${Math.round(avgHr)} bpm`,
      title: t("activity.fact.avgHr")
    });
  }

  // Climb earns its place only on a session that actually climbed: every flat
  // road run carries a few metres of GPS noise, and a "4 m" on every row is
  // four characters of nothing.
  if (facts.length < MAX_FACTS && elevationGain && elevationGain >= 50) {
    facts.push({
      key: "climb",
      value: formatElevationMeters(elevationGain, unitSystem),
      title: t("activity.fact.climbTitle")
    });
  }

  if (facts.length < MAX_FACTS && trainingLoad && trainingLoad > 0) {
    facts.push({
      key: "load",
      value: t("units.trainingLoadShort", { value: Math.round(trainingLoad) }),
      title: [t("activity.fact.loadTitle"), activityLoadNote(activity, loadSource)].filter(Boolean).join("\n")
    });
  }

  return facts.slice(0, MAX_FACTS);
}
