import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import { useLayoutEffect, useRef } from "react";
import {
  scheduledWorkoutKey,
  type CalendarDay,
  type CalendarMode,
  type CalendarWeek
} from "./calendarTypes";
import type { CalendarDragPayload } from "./calendarDrag";
import { DayCell } from "./DayCell";
import { WEEKDAY_LABELS } from "./dateUtils";
import { WeekStatsCell } from "./WeekStatsCell";

interface CalendarGridProps {
  weeks: CalendarWeek[];
  mode: CalendarMode;
  loading: boolean;
  busy: boolean;
  selectionMode: boolean;
  selectedWorkoutKeys: ReadonlySet<string>;
  onSelectScheduled: (day: CalendarDay, entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (day: CalendarDay, activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onAdd: (dateKey: string) => void;
  onDropEntry: (payload: CalendarDragPayload, targetDay: string) => void;
  onAskCoachWeek: (week: CalendarWeek) => void;
}

export function CalendarGrid({
  weeks,
  mode,
  loading,
  busy,
  selectionMode,
  selectedWorkoutKeys,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled,
  onAdd,
  onDropEntry,
  onAskCoachWeek
}: CalendarGridProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLDivElement>(null);
  const todayWeekKey = weeks.find((week) =>
    week.days.some((day) => day.isToday)
  )?.key;

  /* The visible range, so paging to a month that does not contain today still
     re-runs this. It used to depend on `todayWeekKey` alone, which is undefined
     for every other month — so the effect returned early and October opened at
     whatever offset September's today-row had scrolled to, with its first week
     above the fold. */
  const rangeKey = weeks.length > 0 ? `${weeks[0]?.key}-${weeks[weeks.length - 1]?.key}` : "";

  useLayoutEffect(() => {
    if (loading) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      if (!body) {
        return;
      }

      const todayRow = todayRowRef.current;
      if (!todayWeekKey || !todayRow) {
        // No today to centre on: start the range at its first week.
        body.scrollTo({ top: 0, behavior: "auto" });
        return;
      }

      const bodyRect = body.getBoundingClientRect();
      const rowRect = todayRow.getBoundingClientRect();
      const rowTop = body.scrollTop + rowRect.top - bodyRect.top;
      const centeredTop = rowTop - (body.clientHeight - rowRect.height) / 2;
      const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);

      body.scrollTo({
        top: Math.min(maxScrollTop, Math.max(0, centeredTop)),
        behavior: "auto"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [loading, mode, rangeKey, todayWeekKey]);

  return (
    <div
      className={`calendar-grid ${mode === "week" ? "calendar-grid-week" : ""}`}
      aria-busy={busy}
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

      <div ref={bodyRef} className="calendar-grid-body">
        {weeks.map((week) => {
          const containsToday = week.key === todayWeekKey;
          return (
            <div
              key={week.key}
              ref={containsToday ? todayRowRef : undefined}
              className="calendar-grid-row"
            >
              {week.days.map((day) => (
                <DayCell
                  key={day.dateKey}
                  day={day}
                  mode={mode}
                  busy={busy}
                  selectionMode={selectionMode}
                  isScheduledSelected={(entry) =>
                    selectedWorkoutKeys.has(scheduledWorkoutKey(entry))
                  }
                  onSelectScheduled={(entry) => onSelectScheduled(day, entry)}
                  onSelectActivity={(activity) => onSelectActivity(day, activity)}
                  onToggleScheduled={onToggleScheduled}
                  onAdd={onAdd}
                  onDropEntry={onDropEntry}
                />
              ))}
              <WeekStatsCell
                stats={week.stats}
                onAskCoach={() => onAskCoachWeek(week)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
