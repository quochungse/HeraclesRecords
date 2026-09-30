import type { CSSProperties } from "react";
import {
  defineSelectionPreference,
  readSelectionPreference,
  selectionIsOneOf
} from "../preferences/selectionPreferences";
import { getLocalHappenDayKey } from "../training/formatters";
import type { CalendarMode } from "./calendarTypes";
import {
  WEEKDAY_LABELS,
  dayNumber,
  isKeyInMonth,
  monthGridWeeks,
  monthLabel,
  weekRangeLabel,
  weekRow
} from "./dateUtils";

/*
 * The Calendar's stand-ins, in the main bundle rather than the screen's chunk.
 *
 * The screen is lazy, so opening it used to show the app's generic spinner
 * while the chunk loaded and only then the grid's own shimmer — two loading
 * states, one after the other, for one wait. `CalendarSkeleton` is the
 * Suspense fallback now and draws what the screen draws before its range is
 * read, from the same pieces the grid uses, so the chunk landing changes
 * nothing on screen but the header's controls.
 */

export const CALENDAR_MODE_PREFERENCE = defineSelectionPreference<CalendarMode>({
  key: "calendar.mode",
  defaultValue: "month",
  validate: selectionIsOneOf(["month", "week"])
});

/* The sweep starts at the top-left day and runs down the diagonal, so the
   staggered cells read as one wave across the month, as the library's rows do. */
export function skeletonDelay(weekIndex: number, column: number): number {
  return (weekIndex + column) * 70;
}

function delayStyle(delayMs: number): CSSProperties {
  return { "--calendar-skeleton-delay": `${delayMs}ms` } as CSSProperties;
}

/* How many stand-ins a month's day draws, varied by date so the grid reads as
   a calendar waiting for its sessions rather than a table of equal bars. */
const CHIP_PATTERN = [1, 2, 1, 0, 1, 1, 2];

export function DaySkeletonChips({
  dateKey,
  mode,
  delayMs
}: {
  dateKey: string;
  mode: CalendarMode;
  delayMs: number;
}) {
  const count =
    mode === "week" ? 2 : (CHIP_PATTERN[dayNumber(dateKey) % CHIP_PATTERN.length] ?? 1);
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="calendar-skeleton calendar-skeleton-chip"
          aria-hidden="true"
          style={delayStyle(delayMs + index * 70)}
        />
      ))}
    </>
  );
}

/* The label and value widths of the stand-in rows, one per statistic the cell
   usually shows, so the column keeps the shape it is about to take. */
const STAT_ROWS: Array<[string, string]> = [
  ["58%", "22%"],
  ["44%", "30%"],
  ["52%", "26%"],
  ["40%", "34%"]
];

export function WeekStatsSkeleton({ delayMs }: { delayMs: number }) {
  return (
    <>
      {STAT_ROWS.map(([label, value], index) => {
        const style = delayStyle(delayMs + index * 70);
        return (
          <div key={index} className="calendar-weekstats-row">
            <span
              className="calendar-skeleton calendar-skeleton-stat"
              style={{ ...style, width: label }}
            />
            <span
              className="calendar-skeleton calendar-skeleton-stat"
              style={{ ...style, width: value }}
            />
          </div>
        );
      })}
    </>
  );
}

/* Today, the arrows · Select, Workout Library, Refresh, Month/Week — each as
   wide as the control it stands for, measured, so the headline does not move
   when the controls arrive. */
const NAV_PILLS = [68, 76];
const ACTION_PILLS = [88, 149, 34, 128];

export function CalendarSkeleton() {
  const mode = readSelectionPreference(CALENDAR_MODE_PREFERENCE).value;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = getLocalHappenDayKey();
  const weeks = mode === "month" ? monthGridWeeks(year, month) : [weekRow(now)];
  const headline =
    mode === "month" ? monthLabel(year, month) : weekRangeLabel(weeks[0] ?? []);

  return (
    <section className="calendar-view" aria-busy="true" aria-label="Loading the calendar">
      <header className="calendar-header">
        <div className="calendar-header-nav">
          {NAV_PILLS.map((width, index) => (
            <span
              key={index}
              className="calendar-skeleton calendar-skeleton-pill"
              style={{ ...delayStyle(index * 70), width }}
            />
          ))}
          <h2 className="calendar-headline">{headline}</h2>
        </div>
        <div className="calendar-header-actions">
          {ACTION_PILLS.map((width, index) => (
            <span
              key={index}
              className="calendar-skeleton calendar-skeleton-pill"
              style={{ ...delayStyle(index * 70), width }}
            />
          ))}
        </div>
      </header>

      <div
        className={`calendar-grid ${mode === "week" ? "calendar-grid-week" : ""}`}
        aria-hidden="true"
      >
        <div className="calendar-grid-header">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="calendar-grid-header-cell">
              {label}
            </div>
          ))}
          <div className="calendar-grid-header-cell calendar-grid-header-stats">
            Weekly Statistics
          </div>
        </div>
        <div className="calendar-grid-body">
          {weeks.map((row, weekIndex) => (
            <div key={row[0]} className="calendar-grid-row">
              {row.map((dateKey, dayIndex) => {
                const isToday = dateKey === todayKey;
                return (
                  <div
                    key={dateKey}
                    className={[
                      "calendar-day",
                      mode === "week" && "calendar-day-week",
                      mode === "month" && !isKeyInMonth(dateKey, year, month) && "is-outside",
                      isToday && "is-today",
                      dateKey < todayKey && "is-past"
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="calendar-day-head">
                      <span className="calendar-day-number">
                        {isToday
                          ? `Today ${String(dayNumber(dateKey)).padStart(2, "0")}`
                          : dayNumber(dateKey)}
                      </span>
                    </div>
                    <div className="calendar-day-items">
                      <DaySkeletonChips
                        dateKey={dateKey}
                        mode={mode}
                        delayMs={skeletonDelay(weekIndex, dayIndex)}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="calendar-weekstats">
                <WeekStatsSkeleton delayMs={skeletonDelay(weekIndex, 7)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
