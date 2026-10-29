import type { TrainingHubActivity, TrainingHubDailyMetric } from "../../electron/types";
import type { MessageKey } from "../i18n/core";
import type { UnitSystem } from "../../electron/types";
import { SPORT_COLOR_LABELS, sportColorCategory } from "./sportColors";
import type { SportColorCategory } from "./sportColors";
import { distanceUnit, metersToDisplayDistance } from "../units/units";
import { formatDecimal, t, weekdayNames } from "../i18n/core";

export type WeeklyActivityMetric = "distance" | "duration" | "trainingLoad";

/** Key and label of the block standing for a day's value no activity claims. */
export const WEEKLY_ACTIVITY_RESIDUAL_KEY = "residual";
const residualLabel = () => t("units.weekly.unattributed");

/**
 * One block of a day's column — an activity, coloured by its sport, so a day
 * holding a run and a ride reads as two blocks rather than one blended bar.
 * Mirrors `TrainingLoadBlock`, which splits the load columns the same way.
 */
export interface WeeklyActivitySegment {
  /** An activityId, or WEEKLY_ACTIVITY_RESIDUAL_KEY for the day's leftover. */
  key: string;
  label: string;
  /** null only on the residual block, which stands for no sport. */
  category: SportColorCategory | null;
  /** Chart space, the same scale as `WeeklyActivityDay.value`. */
  value: number;
  displayValue: string;
}

export interface WeeklyActivityDay {
  happenDay: string;
  weekdayLabel: string;
  value: number;
  displayValue: string;
  isToday: boolean;
  /**
   * Bottom to top — activities in start order, residual last. Empty when no
   * activity carries this metric, which is what keeps a day COROS reported but
   * whose activities have not loaded on the plain unattributed fill.
   */
  segments: WeeklyActivitySegment[];
}

export interface WeeklyActivitySeries {
  days: WeeklyActivityDay[];
  weeklyTotal: string;
  yMax: number;
  hasData: boolean;
  metricLabel: string;
  yAxisUnit: string;
}

const METRIC_LABELS: Record<WeeklyActivityMetric, MessageKey> = {
  distance: "overview.tiles.distance",
  duration: "overview.tiles.duration",
  trainingLoad: "overview.trainingLoad"
};

function dateToHappenDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function happenDayFromTimestamp(timestamp?: number): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return dateToHappenDay(new Date(ms));
}

function aggregateActivityTotalsByDay(
  activities: TrainingHubActivity[]
): Map<string, { distance: number; duration: number }> {
  const totals = new Map<string, { distance: number; duration: number }>();

  for (const activity of activities) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }

    const distance =
      activity.distance !== undefined && Number.isFinite(activity.distance)
        ? activity.distance
        : 0;
    const duration =
      activity.duration !== undefined && Number.isFinite(activity.duration)
        ? activity.duration
        : 0;

    if (distance <= 0 && duration <= 0) {
      continue;
    }

    const current = totals.get(happenDay) ?? { distance: 0, duration: 0 };
    totals.set(happenDay, {
      distance: current.distance + distance,
      duration: current.duration + duration
    });
  }

  return totals;
}

export function enrichDayListWithActivityTotals(
  dayList: TrainingHubDailyMetric[],
  activities: TrainingHubActivity[]
): TrainingHubDailyMetric[] {
  if (activities.length === 0) {
    return dayList;
  }

  const activityTotals = aggregateActivityTotalsByDay(activities);
  if (activityTotals.size === 0) {
    return dayList;
  }

  const dayMap = new Map(dayList.map((day) => [day.happenDay, { ...day }]));

  for (const [happenDay, totals] of activityTotals) {
    const day = dayMap.get(happenDay) ?? { happenDay };
    const hasDistance = day.distance !== undefined && day.distance > 0;
    const hasDuration = day.duration !== undefined && day.duration > 0;

    dayMap.set(happenDay, {
      ...day,
      distance: hasDistance ? day.distance : totals.distance || undefined,
      duration: hasDuration ? day.duration : totals.duration || undefined
    });
  }

  return [...dayMap.values()].sort((left, right) =>
    left.happenDay.localeCompare(right.happenDay)
  );
}

export function getCalendarWeekDateKeys(referenceDate = new Date()): string[] {
  const mondayOffset = (referenceDate.getDay() + 6) % 7;
  const monday = new Date(referenceDate);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(referenceDate.getDate() - mondayOffset);

  return Array.from({ length: 7 }, (_value, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return dateToHappenDay(date);
  });
}

function readMetricRaw(day: TrainingHubDailyMetric | undefined, metric: WeeklyActivityMetric) {
  if (!day) {
    return undefined;
  }

  switch (metric) {
    case "distance":
      return day.distance;
    case "duration":
      return day.duration;
    case "trainingLoad":
      return day.trainingLoad;
  }
}

function toChartValue(
  raw: number,
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): number {
  switch (metric) {
    case "distance":
      return metersToDisplayDistance(raw, unitSystem);
    case "duration":
      return raw / 3600;
    case "trainingLoad":
      return raw;
  }
}

function formatDayDisplayValue(
  raw: number,
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): string {
  switch (metric) {
    case "distance":
      return `${formatDecimal(metersToDisplayDistance(raw, unitSystem), 2)} ${distanceUnit(unitSystem)}`;
    case "duration":
      return formatDurationTotal(raw);
    case "trainingLoad":
      return `${Math.round(raw)}`;
  }
}

export function formatDurationTotal(seconds: number): string {
  // Round to whole minutes once, up front. Rounding the remainder on its own
  // loses the carry: 21,576s is 5h 59.6m, and `Math.round` turned that into
  // "5h 60m" — a reachable reading for a week's duration total.
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0
      ? t("units.duration.hm", { h: hours, m: minutes })
      : t("units.duration.h", { h: hours });
  }

  return t("units.duration.m", { m: minutes });
}

function formatWeeklyTotal(
  totalRaw: number,
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): string {
  switch (metric) {
    case "distance":
      return `${formatDecimal(metersToDisplayDistance(totalRaw, unitSystem), 2)} ${distanceUnit(unitSystem)}`;
    case "duration":
      return formatDurationTotal(totalRaw);
    case "trainingLoad":
      return `${Math.round(totalRaw)}`;
  }
}

/**
 * An empty week still draws its axis — a Monday morning is seven empty
 * columns, not a missing chart — at one whole unit a division, where 4 split
 * six ways repeated itself as rounded load ticks (0, 1, 1, 2, 3, 3, 4).
 */
const EMPTY_AXIS_MAX = 6;

function roundAxisMax(max: number): number {
  if (max <= 0) {
    return EMPTY_AXIS_MAX;
  }

  const padded = max * 1.25;
  const step = padded <= 10 ? 2 : padded <= 20 ? 4 : padded <= 50 ? 10 : 20;
  return Math.ceil(padded / step) * step;
}

function yAxisUnitForMetric(
  metric: WeeklyActivityMetric,
  maxValue: number,
  unitSystem: UnitSystem
): string {
  if (metric === "distance") {
    return distanceUnit(unitSystem);
  }

  if (metric === "trainingLoad") {
    return "";
  }

  return maxValue >= 1 ? "h" : "m";
}

/**
 * Below this a block rounds to nothing on screen, so it is treated as absent
 * rather than drawn as a sliver claiming a session that carried no distance.
 * Raw units, per metric: metres, seconds, load.
 */
const SEGMENT_EPSILON: Record<WeeklyActivityMetric, number> = {
  distance: 10,
  duration: 30,
  trainingLoad: 0.5
};

function readActivityMetricRaw(
  activity: TrainingHubActivity,
  metric: WeeklyActivityMetric
): number | undefined {
  switch (metric) {
    case "distance":
      return activity.distance;
    case "duration":
      return activity.duration;
    case "trainingLoad":
      return activity.trainingLoad;
  }
}

/**
 * The week's activities, bucketed by day and in start order. `activities` is the
 * whole history — thousands of rows for a long-standing account — and the chart
 * draws seven days of it, so days outside the week are dropped before anything
 * is allocated or sorted for them.
 */
function groupActivitiesByDay(
  activities: TrainingHubActivity[],
  days: ReadonlySet<string>
): Map<string, TrainingHubActivity[]> {
  const byDay = new Map<string, TrainingHubActivity[]>();

  for (const activity of activities) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay || !days.has(happenDay)) {
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

export function buildWeeklyActivitySeries(
  dayList: TrainingHubDailyMetric[],
  metric: WeeklyActivityMetric,
  referenceDate = new Date(),
  unitSystem: UnitSystem,
  activities: TrainingHubActivity[] = []
): WeeklyActivitySeries {
  const dayMap = new Map(dayList.map((day) => [day.happenDay, day]));
  const epsilon = SEGMENT_EPSILON[metric];
  const weekKeys = getCalendarWeekDateKeys(referenceDate);
  const activitiesByDay = groupActivitiesByDay(activities, new Set(weekKeys));
  const todayKey = dateToHappenDay(referenceDate);
  let totalRaw = 0;
  let hasData = false;
  let maxChartValue = 0;

  const days = weekKeys.map((happenDay, index) => {
    const raw = readMetricRaw(dayMap.get(happenDay), metric);
    const dailyRaw =
      raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 0;

    // The column height is COROS's daily figure, the same rule the training
    // load columns follow — except when the activities add up to more, in
    // which case clipping a session that happened would be the worse lie.
    const blocks: { activity: TrainingHubActivity; raw: number }[] = [];
    let attributedRaw = 0;
    for (const activity of activitiesByDay.get(happenDay) ?? []) {
      const activityRaw = readActivityMetricRaw(activity, metric);
      if (
        activityRaw === undefined ||
        !Number.isFinite(activityRaw) ||
        activityRaw < epsilon
      ) {
        continue;
      }
      blocks.push({ activity, raw: activityRaw });
      attributedRaw += activityRaw;
    }

    const dayRaw = Math.max(dailyRaw, attributedRaw);
    const hasValue = dayRaw > 0;
    const chartValue = hasValue ? toChartValue(dayRaw, metric, unitSystem) : 0;

    const segments: WeeklyActivitySegment[] = blocks.map(
      ({ activity, raw: blockRaw }) => {
        const category = sportColorCategory(activity.sportType);
        return {
          key: activity.activityId,
          // The sport, not the activity's own name: names are free text an
          // athlete edits, and the label has to match the legend beside it.
          label: SPORT_COLOR_LABELS[category],
          category,
          value: toChartValue(blockRaw, metric, unitSystem),
          displayValue: formatDayDisplayValue(blockRaw, metric, unitSystem)
        };
      }
    );

    // Load COROS counted outside a session, or a session synced without this
    // metric, becomes one neutral block rather than quietly disappearing. It
    // only appears beside attributed blocks: on its own it would repaint every
    // ordinary day grey while the activity list is still loading.
    if (segments.length > 0 && dayRaw - attributedRaw >= epsilon) {
      const residualRaw = dayRaw - attributedRaw;
      segments.push({
        key: WEEKLY_ACTIVITY_RESIDUAL_KEY,
        label: residualLabel(),
        category: null,
        value: toChartValue(residualRaw, metric, unitSystem),
        displayValue: formatDayDisplayValue(residualRaw, metric, unitSystem)
      });
    }

    if (hasValue) {
      totalRaw += dayRaw;
      hasData = true;
      maxChartValue = Math.max(maxChartValue, chartValue);
    }

    return {
      happenDay,
      weekdayLabel: weekdayNames("short")[index],
      value: chartValue,
      displayValue: hasValue
        ? formatDayDisplayValue(dayRaw, metric, unitSystem)
        : "—",
      isToday: happenDay === todayKey,
      segments
    };
  });

  const useMinutes = metric === "duration" && maxChartValue < 1 && hasData;
  const yMax =
    metric === "duration" && useMinutes
      ? roundAxisMax(maxChartValue * 60) / 60
      : roundAxisMax(maxChartValue);

  return {
    days,
    weeklyTotal: hasData ? formatWeeklyTotal(totalRaw, metric, unitSystem) : "—",
    yMax: yMax > 0 ? yMax : EMPTY_AXIS_MAX,
    hasData,
    metricLabel: getWeeklyActivityMetricLabel(metric, unitSystem),
    yAxisUnit: yAxisUnitForMetric(metric, maxChartValue, unitSystem)
  };
}

function getWeeklyActivityMetricLabel(
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): string {
  return metric === "distance"
    ? t("units.weekly.distanceUnit", { unit: distanceUnit(unitSystem) })
    : t(METRIC_LABELS[metric]);
}
