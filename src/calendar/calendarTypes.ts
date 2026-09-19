import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";

/** What the plan asked for, in base units, read from the workout's own steps. */
export interface PlannedTargets {
  distanceMeters?: number;
  durationSeconds?: number;
}

/** A scheduled workout matched (or not) to the completed activity on the same day. */
export interface PlannedActualPair {
  scheduled: TrainingHubScheduledWorkoutEntry;
  activity?: TrainingHubActivity;
  /** actual / planned, in percent (load first, then distance, then duration). */
  completionPct?: number;
  /**
   * Computed once while pairing and carried so a chip can label its volume
   * without walking the workout structure again for every day in a month.
   */
  targets: PlannedTargets;
}

export interface CalendarDay {
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  scheduled: TrainingHubScheduledWorkoutEntry[];
  activities: TrainingHubActivity[];
  metric?: TrainingHubDailyMetric;
  pairs: PlannedActualPair[];
  /** Activities not matched to any scheduled workout. */
  unplannedActivities: TrainingHubActivity[];
}

export interface WeeklyStats {
  actualLoad: number;
  plannedLoad: number;
  activityTimeSeconds: number;
  distanceMeters: number;
  plannedDistanceKm: number;
  elevationGain: number;
  /** staminaLevel — COROS "Base Fitness". */
  baseFitness?: number;
  /** tiredRateNew — COROS "Load Impact". */
  loadImpact?: number;
  /** trainingLoadRatio — acute:chronic style load ratio (~1.0 = steady). */
  loadRatio?: number;
  /** COROS recommended weekly training-load band. */
  recommendedLoadMin?: number;
  recommendedLoadMax?: number;
}

export interface CalendarWeek {
  /** dateKey of the week's Monday. */
  key: string;
  days: CalendarDay[];
  stats: WeeklyStats;
}

export type CalendarMode = "month" | "week";

export type CalendarSelection =
  | { kind: "scheduled"; day: CalendarDay; entry: TrainingHubScheduledWorkoutEntry }
  | { kind: "activity"; day: CalendarDay; activity: TrainingHubActivity };

/** Stable identity for selecting scheduled occurrences across calendar cells. */
export function scheduledWorkoutKey(
  entry: Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan">
): string {
  return JSON.stringify([entry.planId, entry.idInPlan]);
}
