import type {
  StrengthLoadSource,
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubUpcomingWorkout,
  UnitSystem,
  WorkoutSport
} from "../../../electron/types";
import { heraclesSurplus, plannedLoad } from "../loadFigures";
import {
  buildWeeklyActivitySeries,
  getCalendarWeekDateKeys,
  WEEKLY_ACTIVITY_RESIDUAL_KEY
} from "../weeklyActivity";
import { sportColorCategory, type SportColorCategory } from "../sportColors";
import { scheduledSportCategory, scheduledWorkoutSport } from "../workoutSport";
import { activityWorkoutSport } from "../askCoachAbout";
import { happenDayFromTimestamp } from "../formatters";
import { pairTodayPlan } from "./comingUpModel";
import { displayDistanceToMeters, metersToDisplayDistance } from "../../units/units";

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
  /** COROS's Load Impact (`ati`). */
  loadImpact?: number;
  /** COROS's Base Fitness (`cti`). */
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
 * Load Impact is `ati` and Base Fitness `cti` (probed on a real account,
 * 2026-10-28: `ati / cti` is the day's ratio on every day, and both come on
 * every day). Neither is `tiredRateNew`, which is `ati − cti`, nor
 * `staminaLevel`, which COROS sends only on a day with a run — read as Base
 * Fitness, it left both figures blank on any day without one.
 */
export function latestTrainingLoad(
  dayList: readonly TrainingHubDailyMetric[]
): TrainingLoadReading {
  for (let index = dayList.length - 1; index >= 0; index -= 1) {
    const day = dayList[index];
    const ratio = positive(day.trainingLoadRatio);
    if (ratio !== undefined) {
      const loadImpact = positive(day.ati);
      const baseFitness = positive(day.cti);
      return {
        percent: Math.round(ratio * 100),
        loadImpact: loadImpact !== undefined ? Math.round(loadImpact) : undefined,
        baseFitness: baseFitness !== undefined ? Math.round(baseFitness) : undefined
      };
    }
  }
  return {};
}

/**
 * What the week's columns measure. Time is every sport's; distance is what a
 * run, ride or swim covered (a strength session has none); COROS's load is a
 * heart-rate figure built for endurance work, and a strength session reads
 * light in it whatever it took out of the legs.
 */
export type WeekMeasure = "time" | "distance" | "load";

export interface WeekLoadReading {
  /**
   * COROS's load from this Monday to today. Always COROS's: it is read
   * against the range COROS recommends, which COROS sets from its own load.
   */
  load?: number;
  /** The same days in Heracles Training Load, while that is the chosen load and a strength session makes it differ. */
  heraclesLoad?: number;
  /** The range COROS recommends for the whole week. */
  recommended?: { min: number; max: number };
}

/**
 * This calendar week's load so far against the range COROS recommends for it.
 * COROS sets that range per calendar week — the same Monday to Sunday, changed
 * on Monday — so it is read against the week's own days, never a rolling seven
 * (COROS's `t7d`, which matches the week only on a Sunday). The load is the
 * week chart's own (`buildWeeklyActivitySeries`: a day's COROS figure, or its
 * sessions' where they add up to more), so the footer and the columns agree.
 * Nothing for a week with no day in the list yet.
 */
export function thisWeekLoad({
  dayList,
  activities,
  now = new Date(),
  unitSystem,
  loadSource = "coros"
}: {
  dayList: readonly TrainingHubDailyMetric[];
  activities: TrainingHubActivity[];
  now?: Date;
  unitSystem: UnitSystem;
  loadSource?: StrengthLoadSource;
}): WeekLoadReading {
  const week = new Set(getCalendarWeekDateKeys(now));
  const today = happenDayFromTimestamp(now.getTime()) ?? "";
  const days = dayList.filter((day) => week.has(day.happenDay) && day.happenDay <= today);
  if (days.length === 0) {
    return {};
  }
  const series = buildWeeklyActivitySeries([...dayList], "trainingLoad", now, unitSystem, activities);
  const load = series.days
    .filter((day) => day.happenDay <= today)
    .reduce((sum, day) => sum + day.value, 0);
  const ranged = [...days]
    .reverse()
    .find((day) => positive(day.recommendedLoadMin) !== undefined && positive(day.recommendedLoadMax) !== undefined);
  const min = positive(ranged?.recommendedLoadMin);
  const max = positive(ranged?.recommendedLoadMax);
  const surplus = activities
    .filter((activity) => {
      const day = happenDayFromTimestamp(activity.startTime);
      return day !== undefined && week.has(day) && day <= today;
    })
    .reduce((sum, activity) => sum + heraclesSurplus(activity, loadSource), 0);
  return {
    load: Math.round(load),
    ...(surplus > 0 ? { heraclesLoad: Math.round(load + surplus) } : {}),
    recommended: min !== undefined && max !== undefined && max >= min ? { min: Math.round(min), max: Math.round(max) } : undefined
  };
}

/** One session in a day's column, done or still on the plan. */
export interface WeekBlock {
  key: string;
  /** Its height: seconds, metres or load, by the chart's measure. */
  value: number;
  /** Every figure, whichever is drawn, for the column's tooltip. */
  load: number;
  seconds: number;
  meters: number;
  /** The session's or the plan's name; empty on the day's leftover load. */
  name: string;
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
  /** The column's two parts in the chart's measure. */
  done: number;
  planned: number;
}

export interface WeekChart {
  measure: WeekMeasure;
  columns: WeekColumn[];
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

/** Round kilometres or miles: 2, 5, 10, 20, then tens. */
function distanceStep(maxMeters: number, unitSystem: UnitSystem): number {
  const max = metersToDisplayDistance(maxMeters, unitSystem);
  const step = max <= 6 ? 2 : max <= 15 ? 5 : max <= 30 ? 10 : max <= 60 ? 20 : Math.ceil(max / 3 / 10) * 10;
  return displayDistanceToMeters(step, unitSystem);
}

/** Three gridlines or more over the tallest column, at a step a reader can add. */
function axisFor(
  max: number,
  measure: WeekMeasure,
  unitSystem: UnitSystem
): { axisMax: number; ticks: number[] } {
  const step = measure === "distance"
    ? distanceStep(max, unitSystem)
    : measure === "time"
      ? // Half an hour, then whole hours.
        max <= 5_400
        ? 1_800
        : max <= 10_800
          ? 3_600
          : max <= 21_600
            ? 7_200
            : Math.ceil(max / 3 / 3_600) * 3_600
      : max <= 90
        ? 30
        : max <= 300
          ? 100
          : max <= 600
            ? 200
            : Math.ceil(max / 3 / 100) * 100;
  // Counted in steps, so a mile step's fraction of a metre never drops a tick.
  const steps = Math.max(3, Math.ceil(max / step));
  const ticks = Array.from({ length: steps + 1 }, (_, index) => index * step);
  return { axisMax: steps * step, ticks };
}

/** A figure the column can stand on: positive and finite, else 0. */
function amount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Monday to Sunday of this week, every session a block: what was done and,
 * from today on, what the calendar still holds. In load, a done session is
 * COROS's daily load split by the sessions that carry it
 * (`buildWeeklyActivitySeries`, the figure the Calendar draws), with what no
 * session claims as a block of its own; in time, it is the session's own
 * activity time, and a planned one COROS's estimate of it; in distance, what
 * the session covered, and a planned one the distance its steps state.
 */
export function buildWeekChart({
  dayList,
  activities,
  upcoming,
  now = new Date(),
  unitSystem,
  measure = "load",
  loadSource = "coros"
}: {
  dayList: TrainingHubDailyMetric[];
  activities: TrainingHubActivity[];
  upcoming: readonly TrainingHubUpcomingWorkout[];
  now?: Date;
  unitSystem: UnitSystem;
  measure?: WeekMeasure;
  /** With Heracles chosen, a strength session's block stands at its Heracles load. */
  loadSource?: StrengthLoadSource;
}): WeekChart {
  const series = buildWeeklyActivitySeries(dayList, "trainingLoad", now, unitSystem, activities);
  const weekDays = new Set(series.days.map((day) => day.happenDay));
  const byDay = new Map<string, TrainingHubActivity[]>();
  for (const activity of activities) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (happenDay && weekDays.has(happenDay)) {
      byDay.set(happenDay, [...(byDay.get(happenDay) ?? []), activity]);
    }
  }
  const todayKey = happenDayFromTimestamp(now.getTime()) ?? "";
  const pick = (load: number, time: number, meters: number) =>
    measure === "time" ? time : measure === "distance" ? meters : load;

  const columns = series.days.map((day): WeekColumn => {
    const dayActivities = (byDay.get(day.happenDay) ?? []).sort(
      (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
    );
    const loads = new Map(day.segments.map((segment) => [segment.key, segment.value]));
    // Every session of the day, the ones COROS gave no load included: they
    // still happened, and the icon under the column says so.
    const blocks: WeekBlock[] = dayActivities.map((activity) => {
      // COROS's daily load split by its sessions, and for a strength session
      // read in Heracles, what Heracles adds on top.
      const corosLoad = loads.get(activity.activityId) ?? 0;
      const surplus = heraclesSurplus(activity, loadSource);
      const load = corosLoad + surplus;
      const time = amount(activity.duration);
      const meters = amount(activity.distance);
      return {
        key: activity.activityId,
        value: pick(load, time, meters),
        load,
        seconds: time,
        meters,
        name: activity.name?.trim() ?? "",
        category: sportColorCategory(activity.sportType),
        sport: activitySport(activity.sportType),
        planned: false
      };
    });
    // Load COROS counted outside a session (or for sessions not loaded yet).
    // It has no time or distance of its own, so there it stands at zero: not
    // drawn, but still in the tooltip, and the day still not a rest day.
    const residual =
      loads.get(WEEKLY_ACTIVITY_RESIDUAL_KEY) ?? (day.segments.length === 0 ? day.value : 0);
    if (residual > 0) {
      blocks.push({
        key: WEEKLY_ACTIVITY_RESIDUAL_KEY,
        value: pick(residual, 0, 0),
        load: residual,
        seconds: 0,
        meters: 0,
        name: "",
        category: null,
        planned: false
      });
    }
    const done = blocks.reduce((sum, block) => sum + block.value, 0);

    let planned = 0;
    if (day.happenDay >= todayKey) {
      const onDay = upcoming.filter((workout) => workout.happenDay === day.happenDay);
      const open =
        day.happenDay === todayKey
          ? pairTodayPlan(
              onDay,
              activities.filter((activity) => happenDayFromTimestamp(activity.startTime) === todayKey),
              loadSource
            ).open
          : onDay;
      open.forEach((workout) => {
        const load = positive(plannedLoad(workout, loadSource)) ?? 0;
        const time = amount(workout.durationSeconds);
        const meters = amount(workout.distanceMeters);
        const value = pick(load, time, meters);
        planned += value;
        blocks.push({
          // Its place in the day's plan, not among what is still open: the key
          // must not change when the session before it is done.
          key: `planned:${workout.happenDay}:${onDay.indexOf(workout)}`,
          value,
          load,
          seconds: time,
          meters,
          name: workout.name,
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
      done,
      planned
    };
  });

  const tallest = Math.max(0, ...columns.map((column) => column.done + column.planned));
  return { measure, columns, ...axisFor(tallest, measure, unitSystem) };
}
