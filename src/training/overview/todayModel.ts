import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubUpcomingWorkout,
  UnitSystem,
  WorkoutSport
} from "../../../electron/types";
import { buildWeeklyActivitySeries, WEEKLY_ACTIVITY_RESIDUAL_KEY } from "../weeklyActivity";
import { sportColorCategory, type SportColorCategory } from "../sportColors";
import { scheduledSportCategory, scheduledWorkoutSport } from "../workoutSport";
import { activityWorkoutSport } from "../askCoachAbout";
import { pairTodayPlan } from "./comingUpModel";

/*
 * The arithmetic behind Overview's Readiness panel, out of the components so a
 * test can reach it: where a figure sits on its scale, which COROS band it is
 * in, and the week's sessions day by day.
 */

/**
 * A scale of named bands drawn as equal segments, each band's own range
 * stretched over its segment — so a band COROS draws narrow in its numbers
 * (Maintaining is 80–99%) is as wide on screen as the others, and the marker
 * still lands where the figure is inside its band.
 *
 * `edges` are the floors of every band but the first; `min` and `max` close
 * the two ends. Answers 0–1, clamped.
 */
export function bandMarker(
  value: number,
  edges: readonly number[],
  min: number,
  max: number
): number {
  const bounds = [min, ...edges, max];
  const segments = bounds.length - 1;
  if (!Number.isFinite(value) || value <= min) {
    return 0;
  }
  for (let index = 0; index < segments; index += 1) {
    const low = bounds[index];
    const high = bounds[index + 1];
    if (value < high || index === segments - 1) {
      const inside = Math.min(1, Math.max(0, (value - low) / (high - low)));
      return (index + inside) / segments;
    }
  }
  return 1;
}

/**
 * COROS's training status, read off its Intensity Trend: Load Impact over Base
 * Fitness, as a percentage. The five bands and their floors are the COROS
 * app's own (its Training Status screen); "Resuming" and "Performance" share
 * 50–79% there, and nothing it shows says which it picks, so the band is named
 * by the first.
 */
export const TRAINING_STATUS_BANDS = [
  "decreasing",
  "resuming",
  "maintaining",
  "optimized",
  "excessive"
] as const;

export type TrainingStatusBand = (typeof TRAINING_STATUS_BANDS)[number];

/** Floors of every band after Decreasing, in percent. */
export const TRAINING_STATUS_EDGES = [50, 80, 100, 150] as const;

/** Where the scale ends: a figure past it pins the marker to the end. */
const TRAINING_STATUS_MAX = 200;

export function trainingStatusBand(percent: number): TrainingStatusBand {
  let band: TrainingStatusBand = "decreasing";
  TRAINING_STATUS_EDGES.forEach((edge, index) => {
    if (percent >= edge) {
      band = TRAINING_STATUS_BANDS[index + 1];
    }
  });
  return band;
}

export function trainingStatusMarker(percent: number): number {
  return bandMarker(percent, TRAINING_STATUS_EDGES, 0, TRAINING_STATUS_MAX);
}

export interface TrainingLoadReading {
  /** Intensity Trend, Load Impact over Base Fitness, in percent. */
  percent?: number;
  /** COROS's Load Impact, read back from the trend and Base Fitness. */
  loadImpact?: number;
  /** COROS's Base Fitness (`staminaLevel`). */
  baseFitness?: number;
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The newest day COROS stated a load ratio for, with the two figures it is the
 * ratio of. Read off one day, so the three always agree with each other; a day
 * that carries no ratio is skipped, since the ratio is what the panel leads
 * with.
 *
 * Load Impact is the ratio times Base Fitness rather than the day's
 * `tiredRateNew`. That field has been read as Load Impact (the Calendar's week
 * tooltip) and as a fatigue difference (the screenshot demo, where it runs
 * −30 to 40), and nothing here settles which; the product is the figure COROS
 * divides by Base Fitness to state its Intensity Trend, whichever it is.
 */
export function latestTrainingLoad(
  dayList: readonly TrainingHubDailyMetric[]
): TrainingLoadReading {
  for (let index = dayList.length - 1; index >= 0; index -= 1) {
    const day = dayList[index];
    const ratio = positive(day.trainingLoadRatio);
    if (ratio !== undefined) {
      const baseFitness = positive(day.staminaLevel);
      return {
        percent: Math.round(ratio * 100),
        loadImpact: baseFitness !== undefined ? Math.round(ratio * baseFitness) : undefined,
        baseFitness
      };
    }
  }
  return {};
}

/** One session in a day's column, done or still on the plan. */
export interface WeekBlock {
  key: string;
  load: number;
  /** null on the day's leftover load, which no session claims. */
  category: SportColorCategory | null;
  /** The sport it is drawn with; undefined for the leftover and an unknown code. */
  sport?: WorkoutSport | "hiking";
  planned: boolean;
}

export interface WeekColumn {
  happenDay: string;
  isToday: boolean;
  /** Before today: a day with nothing on it was a rest day. */
  isPast: boolean;
  /** Bottom to top: what was done, in start order, then what is planned. */
  blocks: WeekBlock[];
  doneLoad: number;
  plannedLoad: number;
}

export interface WeekChart {
  columns: WeekColumn[];
  doneLoad: number;
  plannedLoad: number;
  doneSessions: number;
  plannedSessions: number;
  /** The top of the axis, a round number above the tallest column. */
  axisMax: number;
  /** Gridlines, bottom to top, 0 first. */
  ticks: number[];
}

/** A hike has no workout sport; it is drawn as its colour group is. */
function activitySport(sportType: number | undefined): WorkoutSport | "hiking" | undefined {
  const sport = activityWorkoutSport(sportType);
  if (sport) {
    return sport;
  }
  return sportColorCategory(sportType) === "hiking" ? "hiking" : undefined;
}

function happenDayOf(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Today's planned sessions that no session recorded today stands for — the
 * pairing Coming up shows (`pairTodayPlan`), so the two sections cannot read
 * one day two ways.
 */
export function plannedStillOpen(
  planned: readonly TrainingHubUpcomingWorkout[],
  doneToday: readonly TrainingHubActivity[]
): TrainingHubUpcomingWorkout[] {
  return pairTodayPlan(planned, doneToday).open;
}

/** 0–100 a gridline at a time, rounded up to a step a reader can add. */
function axisFor(max: number): { axisMax: number; ticks: number[] } {
  const step = max <= 90 ? 30 : max <= 300 ? 100 : max <= 600 ? 200 : Math.ceil(max / 3 / 100) * 100;
  const axisMax = Math.max(step * 3, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= axisMax; value += step) {
    ticks.push(value);
  }
  return { axisMax, ticks };
}

/**
 * Monday to Sunday of this week, every session a block: what was done (COROS's
 * daily load, split by the sessions that carry it — `buildWeeklyActivitySeries`,
 * so the figure is the one the Calendar and the old Weekly Activity chart drew)
 * and, from today on, what the calendar still holds.
 */
export function buildWeekChart({
  dayList,
  activities,
  upcoming,
  now = new Date(),
  unitSystem
}: {
  dayList: TrainingHubDailyMetric[];
  activities: TrainingHubActivity[];
  upcoming: readonly TrainingHubUpcomingWorkout[];
  now?: Date;
  unitSystem: UnitSystem;
}): WeekChart {
  const series = buildWeeklyActivitySeries(dayList, "trainingLoad", now, unitSystem, activities);
  const weekDays = new Set(series.days.map((day) => day.happenDay));
  const byDay = new Map<string, TrainingHubActivity[]>();
  for (const activity of activities) {
    const happenDay = happenDayOf(activity.startTime);
    if (happenDay && weekDays.has(happenDay)) {
      byDay.set(happenDay, [...(byDay.get(happenDay) ?? []), activity]);
    }
  }
  const todayKey = happenDayOf(now.getTime()) ?? "";
  let doneSessions = 0;
  let plannedSessions = 0;

  const columns = series.days.map((day): WeekColumn => {
    const dayActivities = (byDay.get(day.happenDay) ?? []).sort(
      (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
    );
    const loads = new Map(day.segments.map((segment) => [segment.key, segment.value]));
    // Every session of the day, the ones COROS gave no load included: they
    // still happened, and the icon under the column says so.
    const blocks: WeekBlock[] = dayActivities.map((activity) => ({
      key: activity.activityId,
      load: loads.get(activity.activityId) ?? 0,
      category: sportColorCategory(activity.sportType),
      sport: activitySport(activity.sportType),
      planned: false
    }));
    // Load COROS counted outside a session (or for sessions not loaded yet).
    const residual =
      loads.get(WEEKLY_ACTIVITY_RESIDUAL_KEY) ?? (day.segments.length === 0 ? day.value : 0);
    if (residual > 0) {
      blocks.push({ key: WEEKLY_ACTIVITY_RESIDUAL_KEY, load: residual, category: null, planned: false });
    }
    doneSessions += dayActivities.length;
    const doneLoad = blocks.reduce((sum, block) => sum + block.load, 0);

    let plannedLoad = 0;
    if (day.happenDay >= todayKey) {
      const planned = upcoming.filter((workout) => workout.happenDay === day.happenDay);
      const open =
        day.happenDay === todayKey
          ? plannedStillOpen(
              planned,
              activities.filter((activity) => happenDayOf(activity.startTime) === todayKey)
            )
          : planned;
      open.forEach((workout) => {
        const load = positive(workout.trainingLoad) ?? 0;
        plannedLoad += load;
        plannedSessions += 1;
        blocks.push({
          // Its place in the day's plan, not among what is still open: the key
          // must not change when the session before it is done.
          key: `planned:${workout.happenDay}:${workout.sortNo ?? planned.indexOf(workout)}:${workout.name}`,
          load,
          category: scheduledSportCategory(workout.sportType) ?? "other",
          sport: scheduledWorkoutSport(workout.sportType),
          planned: true
        });
      });
    }

    return {
      happenDay: day.happenDay,
      isToday: day.happenDay === todayKey,
      isPast: day.happenDay < todayKey,
      blocks,
      doneLoad,
      plannedLoad
    };
  });

  const tallest = Math.max(0, ...columns.map((column) => column.doneLoad + column.plannedLoad));
  return {
    columns,
    doneLoad: columns.reduce((sum, column) => sum + column.doneLoad, 0),
    plannedLoad: columns.reduce((sum, column) => sum + column.plannedLoad, 0),
    doneSessions,
    plannedSessions,
    ...axisFor(tallest)
  };
}

/** A day's icons: all of them up to three, past that the two biggest and a count. */
export function columnIcons(blocks: readonly WeekBlock[]): {
  shown: WeekBlock[];
  more: number;
} {
  const sessions = blocks.filter((block) => block.key !== WEEKLY_ACTIVITY_RESIDUAL_KEY);
  if (sessions.length <= 3) {
    return { shown: sessions, more: 0 };
  }
  const biggest = [...sessions].sort((left, right) => right.load - left.load).slice(0, 2);
  return {
    shown: sessions.filter((block) => biggest.includes(block)),
    more: sessions.length - 2
  };
}
