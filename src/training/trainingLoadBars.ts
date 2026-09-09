import type { TrainingHubActivity } from "../../electron/types";
import { getLocalHappenDayKey, happenDayFromTimestamp } from "./formatters";
import { SPORT_COLOR_LABELS, sportColorCategory } from "./sportColors";
import type { SportColorCategory } from "./sportColors";
import type { TrainingTrendPoint } from "./types";

/** Load smaller than this rounds to nothing on screen — treat it as absent. */
const LOAD_EPSILON = 0.5;

/** Key and label of the block standing for load no single activity claims. */
export const TRAINING_LOAD_RESIDUAL_KEY = "residual";
const TRAINING_LOAD_RESIDUAL_LABEL = "Unattributed";

export interface TrainingLoadBlock {
  /** An activityId, or TRAINING_LOAD_RESIDUAL_KEY for the day's leftover load. */
  key: string;
  label: string;
  /** null only on the residual block, which deliberately stands for no sport. */
  category: SportColorCategory | null;
  value: number;
}

export interface TrainingLoadBar {
  /** YYYYMMDD. */
  date: string;
  /** MM/DD, the axis tick. */
  label: string;
  /** Column height: COROS's daily figure, or the activity sum when larger. */
  total: number;
  /** Bottom to top — activities in start order, residual last. */
  blocks: TrainingLoadBlock[];
}

/**
 * MM/DD, matching the axis ticks the other trend charts get from the snapshot.
 * Deliberately not formatters' formatHappenDayLabel, whose "Mon, Sep 8" is far
 * too wide to fit thirty ticks on one axis.
 */
function axisTickLabel(happenDay: string): string {
  return `${happenDay.slice(4, 6)}/${happenDay.slice(6, 8)}`;
}

function activityBlockLabel(activity: TrainingHubActivity): string {
  const name = activity.name?.trim();
  if (name) {
    return name;
  }
  const sportName = activity.sportName?.trim();
  if (sportName) {
    return sportName;
  }
  return SPORT_COLOR_LABELS[sportColorCategory(activity.sportType)];
}

/**
 * Oldest-to-newest YYYYMMDD keys for the last `days` calendar days.
 *
 * The window has to be built from the calendar rather than from the day list
 * COROS returns: that list skips days it has nothing to say about, and a bar
 * chart drawn straight off it would space rest days as if they never happened.
 */
export function trainingLoadCalendarWindow(
  days: number,
  today = new Date()
): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    keys.push(getLocalHappenDayKey(date));
  }
  return keys;
}

function groupActivitiesByDay(
  activities: TrainingHubActivity[]
): Map<string, TrainingHubActivity[]> {
  const byDay = new Map<string, TrainingHubActivity[]>();
  for (const activity of activities) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }
    const existing = byDay.get(happenDay);
    if (existing) {
      existing.push(activity);
    } else {
      byDay.set(happenDay, [activity]);
    }
  }
  for (const list of byDay.values()) {
    list.sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));
  }
  return byDay;
}

export interface BuildTrainingLoadBarsOptions {
  points: TrainingTrendPoint[];
  activities?: TrainingHubActivity[];
  days: number;
  /** Injectable so a suite can pin the window; production reads the clock. */
  today?: Date;
}

/**
 * One column per calendar day, split into one block per activity that carries a
 * training load.
 *
 * The column height is COROS's own daily figure — the number the Overview tile
 * reports — so the chart and the tile never disagree. That figure can exceed
 * the activities that carry a load (one synced without it, or load COROS
 * counted outside a session), and the difference becomes a single neutral
 * block rather than quietly disappearing. It can also fall short of them, in
 * which case the activities win: clipping a session that happened would be the
 * worse lie.
 */
export function buildTrainingLoadBars({
  points,
  activities = [],
  days,
  today
}: BuildTrainingLoadBarsOptions): TrainingLoadBar[] {
  const activitiesByDay = groupActivitiesByDay(activities);
  const dailyLoadByDay = new Map(
    points
      .filter(
        (point) =>
          point.trainingLoad !== undefined && Number.isFinite(point.trainingLoad)
      )
      .map((point) => [point.date, Math.max(0, point.trainingLoad!)])
  );

  return trainingLoadCalendarWindow(days, today).map((date) => {
    const blocks: TrainingLoadBlock[] = [];
    let attributed = 0;

    for (const activity of activitiesByDay.get(date) ?? []) {
      const load = activity.trainingLoad;
      if (load === undefined || !Number.isFinite(load) || load < LOAD_EPSILON) {
        continue;
      }
      attributed += load;
      blocks.push({
        key: activity.activityId,
        label: activityBlockLabel(activity),
        category: sportColorCategory(activity.sportType),
        value: load
      });
    }

    const total = Math.max(dailyLoadByDay.get(date) ?? 0, attributed);
    const residual = total - attributed;
    if (residual >= LOAD_EPSILON) {
      blocks.push({
        key: TRAINING_LOAD_RESIDUAL_KEY,
        label: TRAINING_LOAD_RESIDUAL_LABEL,
        category: null,
        value: residual
      });
    }

    return {
      date,
      label: axisTickLabel(date),
      total,
      blocks
    };
  });
}

/** True when at least one column in the set has something to draw. */
export function trainingLoadBarsHaveLoad(bars: TrainingLoadBar[]): boolean {
  return bars.some((bar) => bar.total >= LOAD_EPSILON);
}

export interface TrainingLoadLegendEntry {
  key: string;
  label: string;
  category: SportColorCategory | null;
}

/**
 * Legend for a set of columns: the sports actually present, in the canonical
 * order the color settings list them, plus the residual entry when one is drawn.
 */
export function trainingLoadBarLegend(
  bars: TrainingLoadBar[],
  order: readonly SportColorCategory[]
): TrainingLoadLegendEntry[] {
  const present = new Set<SportColorCategory>();
  let hasResidual = false;

  for (const bar of bars) {
    for (const block of bar.blocks) {
      if (block.category) {
        present.add(block.category);
      } else {
        hasResidual = true;
      }
    }
  }

  const entries: TrainingLoadLegendEntry[] = order
    .filter((category) => present.has(category))
    .map((category) => ({
      key: category,
      label: SPORT_COLOR_LABELS[category],
      category
    }));

  if (hasResidual) {
    entries.push({
      key: TRAINING_LOAD_RESIDUAL_KEY,
      label: TRAINING_LOAD_RESIDUAL_LABEL,
      category: null
    });
  }

  return entries;
}
