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
  | { kind: "activity"; day: CalendarDay; activity: TrainingHubActivity }
  /** A day with more than one thing on it, read as a whole (UAT). */
  | { kind: "day"; day: CalendarDay };

export type CalendarItemSelection = Exclude<CalendarSelection, { kind: "day" }>;

/**
 * What a day holds, in the order its cell draws it: each planned session —
 * as the activity that did it, when one did — then the activities no plan
 * asked for. The same items the chips open.
 */
export function dayItems(day: CalendarDay): CalendarItemSelection[] {
  return [
    ...day.pairs.map((pair): CalendarItemSelection =>
      pair.activity
        ? { kind: "activity", day, activity: pair.activity }
        : { kind: "scheduled", day, entry: pair.scheduled }
    ),
    ...day.unplannedActivities.map((activity): CalendarItemSelection => ({ kind: "activity", day, activity }))
  ];
}

/**
 * What pressing a day's cell opens (UAT): nothing on an empty day, the one
 * thing on it when there is one — as pressing its chip would — and the day
 * as a whole otherwise.
 */
export function daySelection(day: CalendarDay): CalendarSelection | null {
  const items = dayItems(day);
  if (!items.length) return null;
  return items.length === 1 ? items[0] : { kind: "day", day };
}

/** Stable identity for selecting scheduled occurrences across calendar cells. */
export function scheduledWorkoutKey(
  entry: Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan">
): string {
  return JSON.stringify([entry.planId, entry.idInPlan]);
}
