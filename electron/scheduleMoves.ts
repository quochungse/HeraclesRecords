/**
 * Moving and replacing a session on the calendar, the way COROS's own web app
 * does both: in place, one `schedule/update` each.
 *
 * A move sends the session's own entity on its new day with `status 2`
 * (`rescheduleScheduledWorkout`); a replacement sends its entity with the new
 * program, `status 2` again (`replaceScheduledWorkout`). Both keep the
 * session's `idInPlan`, and COROS carries either into the running copy of a
 * plan on the calendar, so a plan's session stays that plan's — verified on
 * the live account on 2026-10-20 (the copy's `dayNo` moved, its version rose,
 * and a replaced program read back in the copy).
 *
 * This replaced a split measured on 2026-09-26 (P3.0 of
 * docs/coach-plan-canvas.md): a plan's session was rewritten through
 * `plan/update` on its running copy, and one of the athlete's own was added
 * again and the original deleted. The add-then-delete is what took a plan's
 * session out of its plan; it rested on a probe of `status 2` that sent a
 * stripped entity and was refused.
 *
 * The Calendar screen's drag and Coach's change sets both come through here.
 */
import { formatScheduleDay } from "./corosWorkoutBuilder";
import {
  buildCalculatedPlanProgram,
  createAndScheduleWorkout,
  replaceScheduledWorkout,
  rescheduleScheduledWorkout
} from "./trainingHubService";
import type { PlanWorkoutEntryInput, UnitSystem } from "./types";
import { ScreenError } from "./screenText";

/** What these need of a calendar session: which one, and the day it is on. */
export interface CalendarSessionRef {
  planId: string;
  idInPlan: string;
  planProgramId?: string;
  happenDay: string;
}

export interface ScheduleMoveDeps {
  rescheduleScheduledWorkout: typeof rescheduleScheduledWorkout;
  replaceScheduledWorkout: typeof replaceScheduledWorkout;
  buildCalculatedPlanProgram: typeof buildCalculatedPlanProgram;
  /** A new session of the athlete's own — Coach's "add" line. */
  createAndScheduleWorkout: typeof createAndScheduleWorkout;
}

export const defaultScheduleMoveDeps: ScheduleMoveDeps = {
  rescheduleScheduledWorkout,
  replaceScheduledWorkout,
  buildCalculatedPlanProgram,
  createAndScheduleWorkout
};

/** Moves a session to another day, in place, whoever's session it is. */
export async function moveCalendarSession(
  ref: CalendarSessionRef,
  toDay: string,
  deps: ScheduleMoveDeps = defaultScheduleMoveDeps
): Promise<void> {
  if (!/^\d{8}$/.test(toDay)) throw new Error("The new day must be YYYYMMDD.");
  if (toDay === ref.happenDay) return;
  if (toDay < formatScheduleDay(new Date())) {
    throw new ScreenError("main.coros.beforeToday");
  }
  await deps.rescheduleScheduledWorkout(
    { planId: ref.planId, idInPlan: ref.idInPlan, planProgramId: ref.planProgramId, happenDay: ref.happenDay },
    toDay
  );
}

/** Puts another workout in a session's place on its day, in one request. */
export async function replaceCalendarSession(
  ref: CalendarSessionRef,
  workout: PlanWorkoutEntryInput,
  unitSystem: UnitSystem,
  deps: ScheduleMoveDeps = defaultScheduleMoveDeps
): Promise<void> {
  const program = await deps.buildCalculatedPlanProgram({ ...workout, save_to_library: false }, unitSystem);
  await deps.replaceScheduledWorkout(
    { planId: ref.planId, idInPlan: ref.idInPlan, happenDay: ref.happenDay },
    program
  );
}
