import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";

/** What the plan asked for, in base units (`plannedSessionFigures`). */
export interface PlannedTargets {
  /** The whole session's distance: COROS's estimate, else every step's in distance. */
  distanceMeters?: number;
  /** The whole session's time: COROS's estimate, else every step's in time. */
  plannedSeconds?: number;
  /**
   * COROS's estimate alone (`estimatedTime`, which every scheduled entry
   * carries, strength included): the week sums only these, since a total
   * over some of the sessions would read as the whole plan's.
   */
  expectedSeconds?: number;
}

/** A scheduled workout matched (or not) to the completed activity on the same day. */
export interface PlannedActualPair {
  scheduled: TrainingHubScheduledWorkoutEntry;
  activity?: TrainingHubActivity;
  /** How much of the plan was done, in percent, at most 100 (`completion` in `pairing.ts`). */
  completionPct?: number;
  /** What that percentage was read from, for the line that states it. */
  completionBasis?:
    | { kind: "coros" }
    | { kind: "load" | "distance" | "time"; done: number; planned: number };
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
  /** Load done and planned in the load strength is read in (`useLoadSource`). */
  actualLoad: number;
  plannedLoad: number;
  /**
   * The same weeks in COROS's Training Load, for the hover that names COROS's
   * figures. Equal to the above while COROS is chosen.
   */
  actualCorosLoad: number;
  remainingCorosLoad: number;
  activityTimeSeconds: number;
  distanceMeters: number;
  plannedDistanceKm: number;
  /**
   * The sessions on the calendar and how many an activity answered. Counted
   * apart from everything done, so a session nobody planned never reads as
   * part of the plan.
   */
  plannedSessions: number;
  plannedSessionsDone: number;
  /** Load still to come: planned sessions not done, on a day not gone. */
  remainingLoad: number;
  /** COROS's expected time over every planned session; absent when one lacks it. */
  plannedSeconds?: number;
  /** Time recorded by the activities that answered a planned session. */
  plannedDoneSeconds: number;
  elevationGain: number;
  /**
   * cti — COROS "Base Fitness", the chronic load; sent on every day. Not
   * `staminaLevel`, which COROS sends only on a day with a run. In the chosen
   * load, as the two below (`fitnessInLoadSource`).
   */
  baseFitness?: number;
  /** ati — COROS "Load Impact", the acute load. Not `tiredRateNew`, which is `ati − cti`. */
  loadImpact?: number;
  /** trainingLoadRatio — Load Impact over Base Fitness (~1.0 = steady). */
  loadRatio?: number;
  /** The recommended weekly training-load band, in the chosen load. */
  recommendedLoadMin?: number;
  recommendedLoadMax?: number;
  /** COROS's own band, for the hover. */
  recommendedCorosLoadMin?: number;
  recommendedCorosLoadMax?: number;
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
 * What pressing a day's cell opens: the day as a whole, an empty one too —
 * a card opens its own session. It used to open nothing on an empty day and
 * the one thing on a day holding one, so the cell meant three things.
 */
export function daySelection(day: CalendarDay): CalendarSelection {
  return { kind: "day", day };
}

/** Stable identity for selecting scheduled occurrences across calendar cells. */
export function scheduledWorkoutKey(
  entry: Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan">
): string {
  return JSON.stringify([entry.planId, entry.idInPlan]);
}
