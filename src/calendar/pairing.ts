import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "../../electron/types";
import { parseUpcomingWorkoutDistanceKm } from "../training/formatters";
import type {
  CalendarDay,
  PlannedActualPair,
  PlannedTargets,
  WeeklyStats
} from "./calendarTypes";
import { buildScheduledWorkoutView } from "./scheduledStructure";
import {
  activitySportFamily,
  scheduledSportFamily,
  sportFamiliesCompatible
} from "../training/workoutSport";

type SportBucket = "run" | "bike" | "swim" | "walk" | "strength" | "other";

/**
 * The name heuristic, kept only for an entry COROS sent no sport code with.
 *
 * A workout name is free text an athlete — or the plan that generated it —
 * types in whatever language they please. "Week 3 · Session 2" buckets as
 * `other`, which is compatible with everything on the day, so this can never be
 * the first question. It is the fallback, and nothing more.
 */
function bucketFromName(name?: string): SportBucket | undefined {
  const normalized = (name ?? "").toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (/(run|jog|track|marathon|5k|10k|tempo|interval)/.test(normalized)) {
    return "run";
  }
  if (/(ride|bike|cycl|spin)/.test(normalized)) {
    return "bike";
  }
  if (/swim/.test(normalized)) {
    return "swim";
  }
  if (/(walk|hike)/.test(normalized)) {
    return "walk";
  }
  if (/(strength|gym|weight|core)/.test(normalized)) {
    return "strength";
  }
  return "other";
}

/**
 * Whether a planned workout and a completed activity could be the same session.
 *
 * Sport families first: a scheduled entry carries a COROS program sport code
 * and an activity carries an activity code, and both resolve into the same
 * family. Only when one side has no code this app has grouped does it fall back
 * to reading the names.
 */
function sportsCompatible(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity
): boolean {
  const plannedFamily = scheduledSportFamily(scheduled.sportType);
  const actualFamily = activitySportFamily(activity.sportType);

  if (plannedFamily && actualFamily) {
    return sportFamiliesCompatible(plannedFamily, actualFamily);
  }

  const plannedBucket = bucketFromName(scheduled.name);
  const actualBucket = bucketFromName(activity.sportName ?? activity.name);
  if (!plannedBucket || !actualBucket) {
    return true;
  }
  if (plannedBucket === "other" || actualBucket === "other") {
    return true;
  }
  // Walks often record what was planned as an easy run/recovery; keep those pairable.
  if (
    (plannedBucket === "run" && actualBucket === "walk") ||
    (plannedBucket === "walk" && actualBucket === "run")
  ) {
    return true;
  }
  return plannedBucket === actualBucket;
}

/**
 * What the plan asked for, in base units.
 *
 * COROS's `volume` string is only ever a distance in km or a set count — a
 * workout prescribed in minutes arrives with no volume at all — so a
 * time-based plan had nothing to measure adherence against and showed no
 * completion badge anywhere. The steps carry both figures, so read the
 * structure first and keep the volume string as the fallback for an entry whose
 * steps did not come through.
 *
 * `unitSystem` reaches `buildScheduledWorkoutView` for its labels only; the
 * magnitudes it totals are metres and seconds either way.
 */
function plannedTargets(
  scheduled: TrainingHubScheduledWorkoutEntry,
  unitSystem: UnitSystem
): PlannedTargets {
  const { totals } = buildScheduledWorkoutView(scheduled, unitSystem);
  const volumeKm = parseUpcomingWorkoutDistanceKm(scheduled.volume);
  return {
    distanceMeters:
      totals.distanceMeters ?? (volumeKm ? volumeKm * 1000 : undefined),
    durationSeconds: totals.durationSeconds
  };
}

/**
 * How much of the plan the session covered, in percent. Load is the honest
 * measure and is asked first; distance and then duration stand in when COROS
 * prescribed one of those instead.
 */
function completionPct(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity,
  targets: PlannedTargets
): number | undefined {
  const plannedLoad = scheduled.trainingLoad;
  if (plannedLoad && plannedLoad > 0 && activity.trainingLoad !== undefined) {
    return Math.round((activity.trainingLoad / plannedLoad) * 100);
  }
  if (targets.distanceMeters && activity.distance !== undefined) {
    return Math.round((activity.distance / targets.distanceMeters) * 100);
  }
  if (targets.durationSeconds && activity.duration !== undefined) {
    return Math.round((activity.duration / targets.durationSeconds) * 100);
  }
  return undefined;
}

/** Lower is a closer fit; used only to choose between candidates on one day. */
function matchScore(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity,
  targets: PlannedTargets
): number {
  const plannedLoad = scheduled.trainingLoad;
  if (plannedLoad && plannedLoad > 0 && activity.trainingLoad !== undefined) {
    return Math.abs(activity.trainingLoad - plannedLoad) / plannedLoad;
  }
  if (targets.distanceMeters && activity.distance !== undefined) {
    return (
      Math.abs(activity.distance - targets.distanceMeters) /
      targets.distanceMeters
    );
  }
  if (targets.durationSeconds && activity.duration !== undefined) {
    return (
      Math.abs(activity.duration - targets.durationSeconds) /
      targets.durationSeconds
    );
  }
  return 1;
}

/**
 * Greedy per-day matching of scheduled workouts to completed activities.
 * Each activity is consumed by at most one scheduled workout.
 */
export function pairPlannedWithActual(
  scheduled: TrainingHubScheduledWorkoutEntry[],
  activities: TrainingHubActivity[],
  unitSystem: UnitSystem
): { pairs: PlannedActualPair[]; unplanned: TrainingHubActivity[] } {
  const remaining = [...activities];
  const pairs: PlannedActualPair[] = [];

  for (const entry of scheduled) {
    const targets = plannedTargets(entry, unitSystem);
    let best: TrainingHubActivity | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const activity of remaining) {
      if (!sportsCompatible(entry, activity)) {
        continue;
      }
      const score = matchScore(entry, activity, targets);
      if (score < bestScore) {
        best = activity;
        bestScore = score;
      }
    }

    if (best) {
      remaining.splice(remaining.indexOf(best), 1);
      pairs.push({
        scheduled: entry,
        activity: best,
        completionPct: completionPct(entry, best, targets),
        targets
      });
    } else {
      pairs.push({ scheduled: entry, targets });
    }
  }

  return { pairs, unplanned: remaining };
}

function lastDefined<T>(
  metrics: (TrainingHubDailyMetric | undefined)[],
  pick: (metric: TrainingHubDailyMetric) => T | undefined
): T | undefined {
  for (let i = metrics.length - 1; i >= 0; i -= 1) {
    const metric = metrics[i];
    if (!metric) {
      continue;
    }
    const value = pick(metric);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/**
 * The week's totals, from the day views the calendar already built.
 *
 * It used to take the raw scheduled entries and call `plannedTargets` again,
 * which walks and sorts the whole COROS program — so every workout in the
 * visible range was parsed twice on each recompute, once for its chip and once
 * for its week. `PlannedActualPair` carries what that produced, so the second
 * pass bought nothing, and reading it here is what makes the comment below
 * true rather than merely intended.
 */
export function computeWeeklyStats(days: CalendarDay[]): WeeklyStats {
  let actualLoad = 0;
  let plannedLoad = 0;
  let activityTimeSeconds = 0;
  let distanceMeters = 0;
  let plannedDistanceKm = 0;
  let elevationGain = 0;

  for (const day of days) {
    for (const activity of day.activities) {
      actualLoad += activity.trainingLoad ?? 0;
      activityTimeSeconds += activity.duration ?? 0;
      distanceMeters += activity.distance ?? 0;
      elevationGain += activity.elevationGain ?? 0;
    }
    for (const pair of day.pairs) {
      plannedLoad += pair.scheduled.trainingLoad ?? 0;
      // The same figures the completion badge reads, so a week's planned column
      // and the chips inside it cannot disagree about what was prescribed.
      plannedDistanceKm += (pair.targets.distanceMeters ?? 0) / 1000;
    }
  }

  const metrics = days.map((day) => day.metric);
  return {
    actualLoad: Math.round(actualLoad),
    plannedLoad: Math.round(plannedLoad),
    activityTimeSeconds,
    distanceMeters,
    plannedDistanceKm,
    elevationGain: Math.round(elevationGain),
    baseFitness: lastDefined(metrics, (metric) => metric.staminaLevel),
    loadImpact: lastDefined(metrics, (metric) => metric.tiredRateNew),
    loadRatio: lastDefined(metrics, (metric) => metric.trainingLoadRatio)
  };
}
