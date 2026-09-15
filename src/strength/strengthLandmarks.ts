import { MUSCLES, type MuscleId } from "./muscles";
import { nextWeekStartMs, startOfWeekMs, type StrengthAnalytics } from "./strengthAnalytics";

/**
 * The weekly working-set range most hypertrophy guidance lands on for a
 * muscle. It is counted in direct sets; the sets here are credited, so a
 * helper muscle's partial share counts toward it too — the panel says so.
 */
export const WEEKLY_SET_LANDMARK = { low: 10, high: 20 } as const;

/** Weeks averaged: enough to smooth one heavy or missed week, short enough to be current. */
export const LANDMARK_WEEKS = 4;

export type LandmarkStatus = "below" | "within" | "above";

export interface LandmarkWeek {
  /** Epoch seconds of the Monday. */
  weekStart: number;
  label: string;
}

export interface MuscleWeeklyVolume {
  muscle: MuscleId;
  /** Credited sets per week, aligned with `weeks`, oldest first. */
  weekly: number[];
  /** Mean of `weekly`, rounded to one decimal — the figure shown and judged. */
  average: number;
  status: LandmarkStatus;
}

export interface WeeklyVolumeLandmarks {
  weeks: LandmarkWeek[];
  /** Every muscle, in anatomical order. */
  muscles: MuscleWeeklyVolume[];
  counts: Record<LandmarkStatus, number>;
}

/**
 * Judged on the rounded average, so a muscle shown as "10.0" is never called
 * short of 10 because it was really 9.96.
 */
export function landmarkStatus(average: number): LandmarkStatus {
  if (average < WEEKLY_SET_LANDMARK.low) return "below";
  if (average > WEEKLY_SET_LANDMARK.high) return "above";
  return "within";
}

/**
 * The last few whole weeks the loaded history fully covers. The week in
 * progress is left out — half a week always reads as too little — and so is a
 * week the window only partly reaches, whose missing days would read as rest.
 * A week with no session in it still counts, as zero: resting is what it was.
 */
export function landmarkWeeks(windowDays: number, nowMs: number): LandmarkWeek[] {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  // The same cut the main process loads the history with.
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - windowDays);

  const weeks: LandmarkWeek[] = [];
  const currentWeek = startOfWeekMs(nowMs);
  let start = startOfWeekMs(windowStart.getTime());
  if (start < windowStart.getTime()) {
    start = nextWeekStartMs(start);
  }
  for (; nextWeekStartMs(start) <= currentWeek; start = nextWeekStartMs(start)) {
    weeks.push({
      weekStart: Math.floor(start / 1000),
      label: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    });
  }
  return weeks.slice(-LANDMARK_WEEKS);
}

export function buildWeeklyVolumeLandmarks(
  analytics: StrengthAnalytics,
  windowDays: number,
  nowMs: number
): WeeklyVolumeLandmarks | null {
  const weeks = landmarkWeeks(windowDays, nowMs);
  if (weeks.length === 0) {
    return null;
  }

  const counts: Record<LandmarkStatus, number> = { below: 0, within: 0, above: 0 };
  const muscles = MUSCLES.map((meta) => {
    // `weekly` only has entries for weeks that held a session; the rest are zero.
    const byWeek = new Map(
      analytics.muscleById[meta.id].weekly.map((point) => [point.weekStart, point.sets])
    );
    const weekly = weeks.map((week) => byWeek.get(week.weekStart) ?? 0);
    const average =
      Math.round((weekly.reduce((total, sets) => total + sets, 0) / weeks.length) * 10) / 10;
    const status = landmarkStatus(average);
    counts[status] += 1;
    return { muscle: meta.id, weekly, average, status };
  });

  return { weeks, muscles, counts };
}
