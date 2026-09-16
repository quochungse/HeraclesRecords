/**
 * What the Activities screen narrows its history by, and what it totals.
 *
 * Kept apart from the view because it is the only part of that screen a test
 * can reach: the renderer holds every activity COROS has, and the question
 * "which of these does the athlete mean" is arithmetic, not layout.
 */
import type { TrainingHubActivity } from "../../electron/types";
import { activityStartTimeMs, startOfWeekMs, weekWindowStartMs } from "./activityWindow";
import { type SportColorCategory, sportColorCategory } from "./sportColors";

export interface ActivityPeriodOption {
  /** null means the whole history. */
  days: number | null;
  label: string;
}

/**
 * The whole history is offered but is not the default: the renderer holds
 * every activity COROS has, and tallying years of them on every keystroke is
 * work nobody asked for while looking at this block.
 */
export const ACTIVITY_PERIOD_OPTIONS: readonly ActivityPeriodOption[] = [
  { days: 28, label: "4 weeks" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
  { days: null, label: "All" }
];

export const DEFAULT_ACTIVITY_PERIOD_DAYS = 90;

export interface ActivityFilters {
  periodDays: number | null;
  /** Empty means every sport — not "no sports", which nothing would match. */
  sports: readonly SportColorCategory[];
  query: string;
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  periodDays: DEFAULT_ACTIVITY_PERIOD_DAYS,
  sports: [],
  query: ""
};

/** Calendar weeks a period covers, this week included. */
export function weeksForPeriod(days: number): number {
  return Math.max(1, Math.ceil(days / 7));
}

/**
 * Where a period starts, in epoch milliseconds, or null for the whole history.
 *
 * Cut at a Monday rather than at "now minus N days" so the list, the totals
 * and anything drawn per week all agree about which sessions are in: "4 weeks"
 * is four calendar weeks.
 */
export function activityPeriodStartMs(
  days: number | null,
  nowMs: number
): number | null {
  return days === null ? null : weekWindowStartMs(weeksForPeriod(days), nowMs);
}

/**
 * Whether an activity's name or sport contains every whitespace-separated term.
 *
 * Every term rather than the whole string, so "long run" finds "Long slow run"
 * and the order the athlete types them in does not matter.
 */
function matchesQuery(
  activity: TrainingHubActivity,
  sportName: string | undefined,
  terms: readonly string[]
): boolean {
  if (terms.length === 0) {
    return true;
  }

  const haystack = `${activity.name ?? ""} ${sportName ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export interface ActivityFilterInput {
  activities: readonly TrainingHubActivity[];
  filters: ActivityFilters;
  nowMs: number;
  /** Resolves a row's sport name, so the query can match it. */
  sportName?: (activity: TrainingHubActivity) => string | undefined;
}

/**
 * The activities a filter admits, newest first.
 *
 * An activity with no start time is kept whatever the period: dropping it
 * would silently shrink the sample, and a missing timestamp says nothing about
 * when the session happened.
 */
export function filterActivities({
  activities,
  filters,
  nowMs,
  sportName
}: ActivityFilterInput): TrainingHubActivity[] {
  const startMs = activityPeriodStartMs(filters.periodDays, nowMs);
  const sports = new Set(filters.sports);
  const terms = filters.query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  const matched = activities.filter((activity) => {
    if (startMs !== null) {
      const at = activityStartTimeMs(activity);
      if (at !== undefined && at < startMs) {
        return false;
      }
    }

    if (sports.size > 0 && !sports.has(sportColorCategory(activity.sportType))) {
      return false;
    }

    return matchesQuery(activity, sportName?.(activity), terms);
  });

  return matched.sort(
    (a, b) => (activityStartTimeMs(b) ?? 0) - (activityStartTimeMs(a) ?? 0)
  );
}

export interface ActivitySportTotal {
  category: SportColorCategory;
  count: number;
  /** Seconds. */
  duration: number;
  trainingLoad: number;
}

export interface ActivityTotals {
  count: number;
  /** Seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  /** Metres. */
  elevationGain: number;
  trainingLoad: number;
  /** Distinct calendar days with at least one activity. */
  activeDays: number;
  /** Calendar weeks between the oldest and newest activity, both included. */
  weeks: number;
  /** Busiest sport first; ties broken by count, then by name, so it is stable. */
  sports: ActivitySportTotal[];
}

/**
 * A fresh zero total, rather than one shared constant handed back to every
 * caller: `sports` is an array the caller owns, and a module-level one would be
 * the same array in every empty result in the process.
 */
function emptyActivityTotals(): ActivityTotals {
  return {
    count: 0,
    duration: 0,
    distance: 0,
    elevationGain: 0,
    trainingLoad: 0,
    activeDays: 0,
    weeks: 0,
    sports: []
  };
}

/**
 * What a filtered stretch of training adds up to.
 *
 * `weeks` spans the activities themselves rather than the period: an athlete
 * three weeks into using the app would otherwise have every per-week figure
 * divided by 52 on the "1 year" filter.
 */
export function summariseActivities(
  activities: readonly TrainingHubActivity[]
): ActivityTotals {
  if (activities.length === 0) {
    return emptyActivityTotals();
  }

  const bySport = new Map<SportColorCategory, ActivitySportTotal>();
  const days = new Set<string>();
  let duration = 0;
  let distance = 0;
  let elevationGain = 0;
  let trainingLoad = 0;
  let earliestWeek: number | undefined;
  let latestWeek: number | undefined;

  for (const activity of activities) {
    duration += activity.duration ?? 0;
    distance += activity.distance ?? 0;
    elevationGain += activity.elevationGain ?? 0;
    trainingLoad += activity.trainingLoad ?? 0;

    const category = sportColorCategory(activity.sportType);
    const total = bySport.get(category) ?? {
      category,
      count: 0,
      duration: 0,
      trainingLoad: 0
    };
    total.count += 1;
    total.duration += activity.duration ?? 0;
    total.trainingLoad += activity.trainingLoad ?? 0;
    bySport.set(category, total);

    const at = activityStartTimeMs(activity);
    if (at === undefined) {
      continue;
    }

    const day = new Date(at);
    days.add(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);

    const week = startOfWeekMs(at);
    earliestWeek = earliestWeek === undefined ? week : Math.min(earliestWeek, week);
    latestWeek = latestWeek === undefined ? week : Math.max(latestWeek, week);
  }

  const weeks =
    earliestWeek === undefined || latestWeek === undefined
      ? 0
      : Math.round((latestWeek - earliestWeek) / (7 * 24 * 60 * 60 * 1000)) + 1;

  return {
    count: activities.length,
    duration,
    distance,
    elevationGain,
    trainingLoad,
    activeDays: days.size,
    weeks,
    sports: [...bySport.values()].sort(
      (a, b) =>
        b.duration - a.duration ||
        b.count - a.count ||
        a.category.localeCompare(b.category)
    )
  };
}

/**
 * The sport categories a history actually contains, in the palette's own order.
 *
 * A filter offering "Trail" to someone who has never left the road is a row of
 * buttons that do nothing, so the chips are built from the loaded list rather
 * than from the list of categories that exist.
 */
export function sportsPresent(
  activities: readonly TrainingHubActivity[]
): SportColorCategory[] {
  const present = new Set(
    activities.map((activity) => sportColorCategory(activity.sportType))
  );
  return (["run", "trail", "bike", "strength", "other"] as const).filter(
    (category) => present.has(category)
  );
}

export interface ActivityWeekGroup {
  /** Epoch ms of the Monday, or undefined for activities with no start time. */
  weekStartMs?: number;
  activities: TrainingHubActivity[];
  /** Sessions and time in this week, for the heading. */
  count: number;
  /** Seconds. */
  duration: number;
}

/**
 * Newest week first, newest activity first within it; undated activities last.
 *
 * The input is expected already filtered and sorted — `filterActivities` does
 * both — so this only cuts it, and an unsorted list would produce a group per
 * run rather than per week.
 */
export function groupActivitiesByWeek(
  activities: readonly TrainingHubActivity[]
): ActivityWeekGroup[] {
  const groups: ActivityWeekGroup[] = [];
  const undated: TrainingHubActivity[] = [];

  for (const activity of activities) {
    const at = activityStartTimeMs(activity);
    if (at === undefined) {
      undated.push(activity);
      continue;
    }

    const weekStartMs = startOfWeekMs(at);
    const last = groups[groups.length - 1];
    if (last?.weekStartMs === weekStartMs) {
      last.activities.push(activity);
    } else {
      groups.push({ weekStartMs, activities: [activity], count: 0, duration: 0 });
    }
  }

  if (undated.length > 0) {
    groups.push({ activities: undated, count: 0, duration: 0 });
  }

  for (const group of groups) {
    const totals = summariseActivities(group.activities);
    group.count = totals.count;
    group.duration = totals.duration;
  }

  return groups;
}

/**
 * "This week", "Last week", "Week of 25 Aug" — and "Undated" for the group
 * holding activities COROS sent without a start time.
 */
export function activityWeekHeading(
  weekStartMs: number | undefined,
  nowMs: number
): string {
  if (weekStartMs === undefined) {
    return "Undated";
  }

  const thisWeek = startOfWeekMs(nowMs);
  if (weekStartMs === thisWeek) {
    return "This week";
  }

  // Stepped through the calendar rather than by subtracting seven days, so a
  // DST change inside the week cannot make last week miss by an hour.
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);
  if (weekStartMs === lastWeek.getTime()) {
    return "Last week";
  }

  const date = new Date(weekStartMs);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return `Week of ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  })}`;
}
