/**
 * Where a Coach plan on COROS stands on the calendar, in the words its card
 * says it in (docs/coach-plan-canvas.md, P1.6): which week of the running copy
 * today falls in, and what was done against it so far. Read off the plan
 * cache and the stored matches, so a card never asks COROS anything to say it.
 *
 * Pure and outside the component for the reason `activityFilters.ts` is. The
 * figures are the Library's own (`planCompliance`), so the card and the plan's
 * reader cannot disagree — and, as there, a plan with nothing settled yet
 * says how many sessions are ahead rather than 0%.
 */
import type { PlanCalendarState } from "../../electron/types";
import { describeCompliance, planCompliance } from "../training-library/planCompliance";

export interface CreationCalendar {
  running: boolean;
  /** "Week 2 of 8 · 3 done · 1 ahead", or "Starts Mon 5 Oct". */
  line?: string;
}

/** Today, `YYYY-MM-DD`, in the athlete's own time zone — not UTC's. */
export function localDayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dayNumber(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** `today` is `YYYY-MM-DD` in the athlete's own time zone. */
export function creationCalendar(
  state: PlanCalendarState | undefined,
  today: string
): CreationCalendar {
  const running = state?.running;
  if (!running) return { running: false };
  const parts: string[] = [];
  if (running.startDate && /^\d{4}-\d{2}-\d{2}$/.test(running.startDate)) {
    const offset = dayNumber(today) - dayNumber(running.startDate);
    if (offset < 0) {
      const [year, month, day] = running.startDate.split("-").map(Number);
      parts.push(
        `Starts ${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(
          new Date(year, month - 1, day)
        )}`
      );
    } else {
      const week = Math.min(running.weekCount, Math.floor(offset / 7) + 1);
      parts.push(`Week ${week} of ${running.weekCount}`);
    }
  }
  const progress = describeCompliance(planCompliance(running, state.matches));
  if (progress) parts.push(progress);
  return { running: true, ...(parts.length ? { line: parts.join(" · ") } : {}) };
}
