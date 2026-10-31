import type {
  StrengthLoadSource,
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "../../electron/types";
import { parseUpcomingWorkoutDistanceKm } from "../training/formatters";
import { activityLoad, comparableLoads, planIsOnlyALength, plannedLoad as plannedLoadOf } from "../training/loadFigures";
import {
  scheduledWorkoutKey,
  type CalendarDay,
  type PlannedActualPair,
  type PlannedTargets,
  type WeeklyStats
} from "./calendarTypes";
import { buildScheduledWorkoutView, type ScheduledStructureTotals } from "./scheduledStructure";
import {
  activitySportFamily,
  isStrengthStyleWorkout,
  scheduledSportFamily,
  scheduledWorkoutSport,
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
 * What the plan asked for, in base units: `plannedSessionFigures` over the
 * workout's own structure.
 *
 * `unitSystem` reaches `buildScheduledWorkoutView` for its labels only; the
 * magnitudes it totals are metres and seconds either way.
 */
function plannedTargets(
  scheduled: TrainingHubScheduledWorkoutEntry,
  unitSystem: UnitSystem
): PlannedTargets {
  const { totals } = buildScheduledWorkoutView(scheduled, unitSystem);
  return plannedSessionFigures(scheduled, totals);
}

/**
 * How far and how long a planned session goes, said the same way on its
 * Calendar card, in its session panel and in its completion: COROS's own
 * estimates first, else the sum of the steps when every one of them is in
 * that unit. COROS estimates the whole session — its `distance` counts the
 * timed steps too (probed: 14.5 km of distance steps and 20 timed minutes
 * came to 17.08 km) — and a sum over some of the steps read as the whole
 * session's: a 14 km run with a timed float was "3:00", a 17 km run "14.5 km".
 *
 * `known` is what a caller already holds of COROS's estimates for an entry
 * that arrived without its program (Overview's row). The main process's
 * `volume` string stands in only where there are no steps to say anything (a
 * run whose target COROS keeps at the program's level, an entry with no
 * program): beside steps it may be a sum of some of them.
 */
export function plannedSessionFigures(
  scheduled: TrainingHubScheduledWorkoutEntry,
  totals: Pick<
    ScheduledStructureTotals,
    "distanceMeters" | "durationSeconds" | "stepCount" | "timedSteps" | "distanceSteps"
  >,
  known: { meters?: number; seconds?: number } = {}
): PlannedTargets {
  const volumeKm = totals.stepCount === 0 ? parseUpcomingWorkoutDistanceKm(scheduled.volume) : null;
  const meters = expectedMeters(scheduled) ?? known.meters ?? (volumeKm ? volumeKm * 1000 : undefined);
  const seconds = expectedSeconds(scheduled) ?? known.seconds;
  const everyStep = (count: number) => totals.stepCount > 0 && count === totals.stepCount;
  return {
    distanceMeters: meters ?? (everyStep(totals.distanceSteps) ? totals.distanceMeters : undefined),
    plannedSeconds: seconds ?? (everyStep(totals.timedSteps) ? totals.durationSeconds : undefined),
    expectedSeconds: seconds
  };
}

/**
 * COROS's own estimate of the session's length, off the raw program. On a
 * COROS program a `0` is a field nobody filled in, so it is no estimate.
 */
function expectedSeconds(scheduled: TrainingHubScheduledWorkoutEntry): number | undefined {
  const raw = scheduled.rawProgram;
  for (const value of [raw?.estimatedTime, raw?.duration]) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds;
    }
  }
  return undefined;
}

/** COROS's own estimate of the session's distance, in metres (it writes centimetres; `0` is none). */
function expectedMeters(scheduled: TrainingHubScheduledWorkoutEntry): number | undefined {
  const raw = scheduled.rawProgram;
  for (const value of [raw?.distance, raw?.estimatedDistance]) {
    const centimetres = Number(value);
    if (Number.isFinite(centimetres) && centimetres > 0) {
      return centimetres / 100;
    }
  }
  return undefined;
}

/**
 * How much of the plan the session covered, in percent, never past 100: a
 * session that did more did all of it. COROS's own figure first
 * (`corosCompleteRate`), where the activity is the one COROS recorded as the
 * session done. Otherwise it is measured the way the plan is written: a
 * strength session in Heracles Training Load when that is chosen and both
 * sides carry it, any session by its distance where the plan states one, else
 * its time. Load is not the measure for the rest: COROS's planned load ran a
 * steady 1.6× under what the same runs scored (a real schedule: 1 of 28 runs
 * within 90-115% by load, 27 by distance), which reads every run as off plan.
 */
function completion(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity,
  targets: PlannedTargets,
  loadSource: StrengthLoadSource
): Pick<PlannedActualPair, "completionPct" | "completionBasis"> {
  const pct = (done: number, planned: number) => Math.min(100, Math.round((done / planned) * 100));
  if (scheduled.corosCompleteRate !== undefined && activity.activityId === scheduled.completedActivityId) {
    return { completionPct: Math.min(100, Math.round(scheduled.corosCompleteRate * 100)), completionBasis: { kind: "coros" } };
  }
  // A plan that is only a length has nothing to read the session against.
  if (planIsOnlyALength(scheduled)) return {};
  if (isStrengthStyleWorkout(scheduledWorkoutSport(scheduled.sportType))) {
    const { planned, done } = comparableLoads(scheduled, activity, loadSource);
    if (loadSource === "heracles" && planned && planned > 0 && done !== undefined) {
      return { completionPct: pct(done, planned), completionBasis: { kind: "load", done, planned } };
    }
  }
  if (targets.distanceMeters && activity.distance !== undefined) {
    return {
      completionPct: pct(activity.distance, targets.distanceMeters),
      completionBasis: { kind: "distance", done: activity.distance, planned: targets.distanceMeters }
    };
  }
  if (targets.plannedSeconds && activity.duration !== undefined) {
    return {
      completionPct: pct(activity.duration, targets.plannedSeconds),
      completionBasis: { kind: "time", done: activity.duration, planned: targets.plannedSeconds }
    };
  }
  return {};
}

/** Lower is a closer fit; used only to choose between candidates on one day. */
function matchScore(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity,
  targets: PlannedTargets,
  loadSource: StrengthLoadSource
): number {
  const { planned: plannedLoad, done } = comparableLoads(scheduled, activity, loadSource);
  if (plannedLoad && plannedLoad > 0 && done !== undefined) {
    return Math.abs(done - plannedLoad) / plannedLoad;
  }
  if (targets.distanceMeters && activity.distance !== undefined) {
    return (
      Math.abs(activity.distance - targets.distanceMeters) /
      targets.distanceMeters
    );
  }
  if (targets.plannedSeconds && activity.duration !== undefined) {
    return (
      Math.abs(activity.duration - targets.plannedSeconds) /
      targets.plannedSeconds
    );
  }
  return 1;
}

/**
 * What the athlete said, for a scheduled entry this greedy pass would
 * otherwise guess about. Keyed by `scheduledWorkoutKey`.
 *
 * `skipped` is not the absence of an activity — it is the statement that the
 * session was deliberately not done, so no activity may be paired to it and
 * whatever *was* done that day stays unplanned rather than being claimed.
 * `none` pairs the same way and says less: none of the day's activities was
 * this session.
 */
export type PairingOverride =
  | { kind: "activity"; activityId: string }
  | { kind: "skipped" }
  | { kind: "none" };

/**
 * Greedy per-day matching of scheduled workouts to completed activities.
 * Each activity is consumed by at most one scheduled workout.
 *
 * Overrides are applied *before* the greedy pass, not after, and in their own
 * loop: a hand-linked activity has to be taken out of the pool before any
 * scoring happens, or the entry standing next to it can be given the activity
 * the athlete already assigned and the override quietly loses. COROS's link
 * (`completedActivityId`) is taken next, the same way.
 */
export function pairPlannedWithActual(
  scheduled: TrainingHubScheduledWorkoutEntry[],
  activities: TrainingHubActivity[],
  unitSystem: UnitSystem,
  overrides?: ReadonlyMap<string, PairingOverride>,
  loadSource: StrengthLoadSource = "coros"
): { pairs: PlannedActualPair[]; unplanned: TrainingHubActivity[] } {
  const remaining = [...activities];
  const pairs: PlannedActualPair[] = [];
  const decided = new Map<string, TrainingHubActivity | null>();

  if (overrides?.size) {
    for (const entry of scheduled) {
      const override = overrides.get(scheduledWorkoutKey(entry));
      if (!override) continue;
      if (override.kind !== "activity") {
        decided.set(scheduledWorkoutKey(entry), null);
        continue;
      }
      const index = remaining.findIndex(
        (activity) => activity.activityId === override.activityId
      );
      // An override naming an activity outside this range is not an error and
      // not a skip: it simply cannot be shown here, so the entry falls through
      // to the greedy pass rather than being drawn as deliberately undone.
      if (index < 0) continue;
      decided.set(scheduledWorkoutKey(entry), remaining[index]!);
      remaining.splice(index, 1);
    }
  }

  // Then COROS's own record of which activity did a session: it is the
  // answer wherever the athlete has not given one, and the greedy pass only
  // guesses for what COROS has not linked.
  for (const entry of scheduled) {
    const key = scheduledWorkoutKey(entry);
    if (decided.has(key) || !entry.completedActivityId) continue;
    const index = remaining.findIndex(
      (activity) => activity.activityId === entry.completedActivityId
    );
    if (index < 0) continue;
    decided.set(key, remaining[index]!);
    remaining.splice(index, 1);
  }

  for (const entry of scheduled) {
    const targets = plannedTargets(entry, unitSystem);
    const key = scheduledWorkoutKey(entry);

    if (decided.has(key)) {
      const chosen = decided.get(key) ?? undefined;
      pairs.push({
        scheduled: entry,
        activity: chosen,
        ...(chosen ? completion(entry, chosen, targets, loadSource) : {}),
        targets
      });
      continue;
    }

    let best: TrainingHubActivity | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const activity of remaining) {
      if (!sportsCompatible(entry, activity)) {
        continue;
      }
      const score = matchScore(entry, activity, targets, loadSource);
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
        ...completion(entry, best, targets, loadSource),
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
 *
 * Loads are summed twice, in the load strength is read in and in COROS's: the
 * week's figure and its band are the first; the second is COROS's own, for the
 * hover that names what the COROS app shows.
 */
export function computeWeeklyStats(days: CalendarDay[], loadSource: StrengthLoadSource = "coros"): WeeklyStats {
  let actualLoad = 0;
  let actualCorosLoad = 0;
  let plannedLoad = 0;
  let activityTimeSeconds = 0;
  let distanceMeters = 0;
  let plannedDistanceKm = 0;
  let plannedSessions = 0;
  let plannedSessionsDone = 0;
  let remainingLoad = 0;
  let remainingCorosLoad = 0;
  let plannedSeconds: number | undefined = 0;
  let plannedDoneSeconds = 0;
  let elevationGain = 0;

  for (const day of days) {
    for (const activity of day.activities) {
      actualLoad += activityLoad(activity, loadSource) ?? 0;
      actualCorosLoad += activity.trainingLoad ?? 0;
      activityTimeSeconds += activity.duration ?? 0;
      distanceMeters += activity.distance ?? 0;
      elevationGain += activity.elevationGain ?? 0;
    }
    for (const pair of day.pairs) {
      plannedLoad += plannedLoadOf(pair.scheduled, loadSource) ?? 0;
      // The same figures the completion badge reads, so a week's planned column
      // and the chips inside it cannot disagree about what was prescribed.
      plannedDistanceKm += (pair.targets.distanceMeters ?? 0) / 1000;
      plannedSessions += 1;
      if (pair.activity) {
        plannedSessionsDone += 1;
        plannedDoneSeconds += pair.activity.duration ?? 0;
      } else if (!day.isPast) {
        remainingLoad += plannedLoadOf(pair.scheduled, loadSource) ?? 0;
        remainingCorosLoad += pair.scheduled.trainingLoad ?? 0;
      }
      // A total over some of the sessions would read as the whole plan's.
      plannedSeconds =
        plannedSeconds !== undefined && pair.targets.expectedSeconds
          ? plannedSeconds + pair.targets.expectedSeconds
          : undefined;
    }
  }

  const metrics = days.map((day) => day.metric);
  return {
    actualLoad: Math.round(actualLoad),
    plannedLoad: Math.round(plannedLoad),
    actualCorosLoad: Math.round(actualCorosLoad),
    remainingCorosLoad: Math.round(remainingCorosLoad),
    activityTimeSeconds,
    distanceMeters,
    plannedDistanceKm,
    plannedSessions,
    plannedSessionsDone,
    remainingLoad: Math.round(remainingLoad),
    plannedSeconds: plannedSessions ? plannedSeconds : undefined,
    plannedDoneSeconds,
    elevationGain: Math.round(elevationGain),
    baseFitness: lastDefined(metrics, (metric) => metric.cti),
    loadImpact: lastDefined(metrics, (metric) => metric.ati),
    loadRatio: lastDefined(metrics, (metric) => metric.trainingLoadRatio)
  };
}
