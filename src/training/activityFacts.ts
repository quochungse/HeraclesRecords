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
import { isSpeedSport, isSwimSportType } from "./sportTypes";
import { classifyRunSurface, isRunSportType } from "../running/runSurface";
import { formatSpeedValue } from "../units/units";

import { formatDecimal, t } from "../i18n/core";
export interface ActivityFact {
  key: string;
  value: string;
  /** Spelled out on hover, since the row itself has no column headings. */
  title: string;
}

/**
 * Foot sports where a seconds-per-kilometre pace is the natural reading — not
 * a ride, not a swim, and not a hike, which is read in km/h (`isSpeedSport`).
 */
function isPacedSport(sportType: number | undefined): boolean {
  return !isSpeedSport(sportType) && !isSwimSportType(sportType);
}

/**
 * Whether aerobic decoupling says anything about this sport: a run off the
 * trail — road, track or treadmill — which is where Running reads it. Drift is
 * pace against heart rate, and on a ride the road and the wind move the speed,
 * on a hike and a trail run the gradient does; Cycling, Hiking and a trail
 * run's page all leave it out, so a row for one of those leaves it out too.
 */
function readsDecoupling(sportType: number | undefined): boolean {
  return isRunSportType(sportType) && classifyRunSurface(sportType) !== "trail";
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
      if (speed) {
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

  // Decoupling before climb and load: it says something about the session that
  // none of the session's own figures do, and it is the reason the stored
  // summaries exist at all — on a run, where it measures the runner.
  if (
    facts.length < MAX_FACTS &&
    readsDecoupling(sportType) &&
    summary?.decouplingPercent !== undefined
  ) {
    const drift = summary.decouplingPercent;
    facts.push({
      key: "drift",
      value: t("activity.fact.drift", { value: `${drift > 0 ? "+" : ""}${formatDecimal(drift, 1)}` }),
      title: t("activity.fact.driftTitle")
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
      title: t("activity.fact.loadTitle")
    });
  }

  return facts.slice(0, MAX_FACTS);
}
