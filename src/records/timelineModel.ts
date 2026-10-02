// How the Hall of Records' timeline is laid out: newest first, by year and
// month, the recent months open and the older ones folded into a line that
// says what is inside. Out of the view so a test can hold the folding — a
// month left open by accident is a wall of rows, and one folded by accident
// hides the beginning the whole timeline runs down to.

import type { Milestone, MilestoneCategory } from "./milestones";

export type TimelineFilter =
  | "all"
  | "firsts"
  | "records"
  | "totals"
  | "streaks"
  | "fitness"
  | "places"
  | "plans";

const FILTER_CATEGORIES: Readonly<Record<Exclude<TimelineFilter, "all">, readonly MilestoneCategory[]>> = {
  firsts: ["first"],
  records: ["record"],
  totals: ["lifetime", "anniversary"],
  streaks: ["streak"],
  fitness: ["fitness", "sleep"],
  places: ["place"],
  plans: ["plan"]
};

export const FILTER_LABELS: Readonly<Record<TimelineFilter, string>> = {
  all: "All",
  firsts: "Firsts",
  records: "Records",
  totals: "Totals",
  streaks: "Streaks",
  fitness: "Fitness",
  places: "Places",
  plans: "Plans"
};

export const TIMELINE_FILTERS: readonly TimelineFilter[] = [
  "all",
  "firsts",
  "records",
  "totals",
  "streaks",
  "fitness",
  "places",
  "plans"
];

export function matchesFilter(milestone: Milestone, filter: TimelineFilter): boolean {
  return filter === "all" || FILTER_CATEGORIES[filter].includes(milestone.category);
}

/** The filters with something behind them; All always. */
export function filtersInUse(milestones: readonly Milestone[]): TimelineFilter[] {
  return TIMELINE_FILTERS.filter(
    (filter) => filter === "all" || milestones.some((milestone) => matchesFilter(milestone, filter))
  );
}

export interface TimelineMonth {
  /** `YYYYMM` */
  key: string;
  label: string;
  /** Newest first. */
  milestones: Milestone[];
}

export interface TimelineYear {
  year: string;
  count: number;
  /** Newest first. */
  months: TimelineMonth[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function monthLabel(key: string): string {
  return MONTH_NAMES[Number(key.slice(4, 6)) - 1] ?? key;
}

/** Newest first, by year and month. `milestones` arrives oldest first. */
export function groupTimeline(milestones: readonly Milestone[]): TimelineYear[] {
  const years = new Map<string, Map<string, Milestone[]>>();
  for (const milestone of milestones) {
    const year = milestone.day.slice(0, 4);
    const month = milestone.day.slice(0, 6);
    const months = years.get(year) ?? new Map<string, Milestone[]>();
    years.set(year, months);
    const list = months.get(month) ?? [];
    months.set(month, list);
    list.push(milestone);
  }
  return [...years.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([year, months]) => {
      const ordered = [...months.entries()]
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([key, list]) => ({
          key,
          label: monthLabel(key),
          // The beginning is what the timeline runs down to, so it is the
          // last thing drawn, whatever else that day held.
          milestones: list
            .slice()
            .sort(
              (left, right) =>
                Number(left.id === "start") - Number(right.id === "start") ||
                right.day.localeCompare(left.day) ||
                right.at - left.at
            )
        }));
      return {
        year,
        count: ordered.reduce((total, month) => total + month.milestones.length, 0),
        months: ordered
      };
    });
}

export type TimelineBlock =
  | { kind: "month"; month: TimelineMonth }
  | {
      kind: "gap";
      id: string;
      /** "June – January", newest first as the timeline reads. */
      label: string;
      count: number;
      /** What is inside, in a few words: its biggest moments. */
      note: string;
      months: TimelineMonth[];
    };

/** How many months, newest first, are drawn open before the rest fold. */
export const OPEN_MONTHS = 4;

/**
 * Each year's months as blocks: the newest `OPEN_MONTHS` months across the
 * whole timeline open, the month the beginning sits in open (it is what the
 * timeline runs down to), a gap the athlete has opened open, and every other
 * run of months inside a year folded into one gap.
 */
export function foldTimeline(
  years: readonly TimelineYear[],
  openGaps: ReadonlySet<string>,
  forceOpen: ReadonlySet<string> = new Set()
): Array<{ year: TimelineYear; blocks: TimelineBlock[] }> {
  let opened = 0;
  return years.map((year) => {
    const blocks: TimelineBlock[] = [];
    let closed: TimelineMonth[] = [];
    const flush = () => {
      if (closed.length === 0) return;
      const id = `${year.year}:${closed[0].key}`;
      if (openGaps.has(id)) {
        for (const month of closed) blocks.push({ kind: "month", month });
      } else {
        const majors = closed.flatMap((month) => month.milestones).filter((milestone) => milestone.major);
        const label =
          closed.length === 1
            ? closed[0].label
            : `${closed[0].label} – ${closed[closed.length - 1].label}`;
        blocks.push({
          kind: "gap",
          id,
          label,
          count: closed.reduce((total, month) => total + month.milestones.length, 0),
          note: majors
            .slice(0, 3)
            .map((milestone) => milestone.title.replace(/ — .*$/, ""))
            .join(" · "),
          months: closed
        });
      }
      closed = [];
    };
    for (const month of year.months) {
      const holdsStart = month.milestones.some((milestone) => milestone.id === "start");
      if (opened < OPEN_MONTHS || holdsStart || forceOpen.has(month.key)) {
        flush();
        blocks.push({ kind: "month", month });
        opened += 1;
      } else {
        closed.push(month);
      }
    }
    flush();
    return { year, blocks };
  });
}

/** Minor rows a month shows before the rest wait behind "+ N more". */
export const MINOR_ROWS = 4;

export type MonthEntry =
  | { kind: "milestone"; milestone: Milestone }
  | { kind: "more"; hidden: Milestone[] };

/**
 * A month's milestones as drawn: every card, and the newest minor rows up to
 * `MINOR_ROWS`, in time order. What is left waits behind one "+ N more" line,
 * drawn where the first of it would have been — so it never lands after the
 * beginning, which is the last thing on the timeline.
 */
export function visibleInMonth(month: TimelineMonth, expanded: boolean): MonthEntry[] {
  if (expanded) {
    return month.milestones.map((milestone) => ({ kind: "milestone", milestone }));
  }
  const entries: MonthEntry[] = [];
  let more: { kind: "more"; hidden: Milestone[] } | undefined;
  let minors = 0;
  for (const milestone of month.milestones) {
    if (milestone.major || milestone.id === "start") {
      entries.push({ kind: "milestone", milestone });
    } else if (minors < MINOR_ROWS) {
      entries.push({ kind: "milestone", milestone });
      minors += 1;
    } else {
      if (!more) {
        more = { kind: "more", hidden: [] };
        entries.push(more);
      }
      more.hidden.push(milestone);
    }
  }
  return entries;
}
