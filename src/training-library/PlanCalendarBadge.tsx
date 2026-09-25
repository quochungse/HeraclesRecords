import { CalendarCheck } from "lucide-react";
import type { TrainingPlanDocument } from "../../electron/types";

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * How many of a running plan's sessions are still ahead on the calendar.
 * Only an instance has dates: its sessions carry the day COROS put them on.
 */
export function upcomingCalendarSessions(plan: TrainingPlanDocument, today = todayKey()): number {
  if (plan.calendar !== "running") return 0;
  return plan.entries.filter((entry) => entry.happenDay && entry.happenDay >= today).length;
}

/** Whether a plan is on the COROS calendar: it is a running instance, or one is running from it. */
export function isOnCalendar(plan: TrainingPlanDocument): boolean {
  return plan.calendar === "running" || Boolean(plan.runningInstanceId);
}

/**
 * Whether a plan is on the COROS calendar, said where the plan is seen — a
 * calendar mark before its name on the tile, the hero and the reader.
 *
 * A plan goes on the calendar as a copy COROS makes and keeps in step with the
 * calendar itself, so this is read off COROS: the copy is running, or the
 * template has one running from it. There is no partial state to draw — the
 * app no longer writes sessions one at a time and so has none to lose track of.
 *
 * Sized in `em`, so one component sits right before an 18px tile name, a 22px
 * hero name and a 28px reader title.
 */
export function PlanCalendarBadge({ plan }: { plan: TrainingPlanDocument }) {
  if (!isOnCalendar(plan)) return null;
  const upcoming = upcomingCalendarSessions(plan);
  const title =
    plan.calendar === "running"
      ? `${upcoming} upcoming workout${upcoming === 1 ? "" : "s"} on the COROS calendar`
      : "On the COROS calendar";
  return (
    <span
      className="plan-calendar-mark"
      role="img"
      aria-label="On calendar"
      title={title}
    >
      <CalendarCheck size="0.8em" aria-hidden="true" />
    </span>
  );
}
