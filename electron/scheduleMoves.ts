/**
 * Moving and replacing a session on the calendar, the way COROS keeps it a
 * session of its plan (P3.0 of docs/coach-plan-canvas.md, measured on the
 * live account on 2026-09-26).
 *
 * COROS has no "move". The app's own `rescheduleScheduledWorkout` adds the
 * session to the athlete's own schedule and deletes the original — right for
 * a session of the athlete's own, and wrong for one of a running plan: the
 * copy drops it and the new one belongs to no plan, so the plan's compliance
 * loses it for good (P3.0 D). A plan session is moved, and its workout
 * replaced, through `plan/update` on the **running copy** instead, which keeps
 * its `idInPlan` and leaves the plan it came from alone (P3.0 B, C).
 *
 * The Calendar screen's drag and Coach's change sets both come through here.
 */
import {
  listNativeCorosPlans,
  nativePlanWriteInputFromRaw,
  readNativeCorosPlanRaw,
  updateNativeCorosPlan
} from "./corosTrainingPlanAdapter";
import { formatScheduleDay } from "./corosWorkoutBuilder";
import { getCorosPlanCache } from "./database";
import {
  buildCalculatedPlanProgram,
  createAndScheduleWorkout,
  removeScheduledWorkout,
  rescheduleScheduledWorkout
} from "./trainingHubService";
import { mondayOf, parsePlanDay } from "./trainingPlanDomain";
import type { PlanWorkoutEntryInput, UnitSystem } from "./types";

/** What these need of a calendar session: which one, and the day it is on. */
export interface CalendarSessionRef {
  planId: string;
  idInPlan: string;
  planProgramId?: string;
  happenDay: string;
  /** For a removal: the program's `pbVersion`, as `removeScheduledWorkout` sends it. */
  pbVersion?: number;
}

export interface ScheduleMoveDeps {
  listNativeCorosPlans: typeof listNativeCorosPlans;
  readNativeCorosPlanRaw: typeof readNativeCorosPlanRaw;
  updateNativeCorosPlan: typeof updateNativeCorosPlan;
  rescheduleScheduledWorkout: typeof rescheduleScheduledWorkout;
  createAndScheduleWorkout: typeof createAndScheduleWorkout;
  removeScheduledWorkout: typeof removeScheduledWorkout;
  buildCalculatedPlanProgram: typeof buildCalculatedPlanProgram;
}

export const defaultScheduleMoveDeps: ScheduleMoveDeps = {
  listNativeCorosPlans,
  readNativeCorosPlanRaw,
  updateNativeCorosPlan,
  rescheduleScheduledWorkout,
  createAndScheduleWorkout,
  removeScheduledWorkout,
  buildCalculatedPlanProgram
};

/**
 * Whether a calendar `planId` is a plan running on the calendar, rather than
 * the athlete's own schedule. The Library's cache answers for a plan it has
 * seen; anything else is asked of COROS, because a plan put on the calendar
 * from the other machine or the COROS app is not in the cache yet, and
 * guessing "own schedule" there is exactly what would detach its session.
 */
export async function isRunningCopy(planId: string, deps: ScheduleMoveDeps = defaultScheduleMoveDeps): Promise<boolean> {
  const cached = getCorosPlanCache(planId);
  if (cached) return cached.calendar === "running";
  if (notRunning.has(planId)) return false;
  const listed = await deps.listNativeCorosPlans();
  const running = listed.some((plan) => plan.remoteId === planId && plan.executeStatus === 1);
  if (!running) notRunning.add(planId);
  return running;
}

/**
 * Calendar `planId`s COROS has said are not a running plan — in practice the
 * athlete's own schedule, whose id never changes. `plan/query` is the heaviest
 * thing COROS serves, and without this every drag of one of the athlete's own
 * sessions paid for it. An id is never reused for a plan, so the answer holds
 * for the life of the process.
 */
const notRunning = new Set<string>();

/** The day a running copy counts `dayNo` from: the Monday of its start day's week. */
function copyAnchor(raw: Record<string, unknown>): Date {
  const start = parsePlanDay(String(raw.startDay ?? ""));
  if (!start) throw new Error("The calendar copy of this plan has no start day.");
  return mondayOf(start);
}

function dayNoOn(anchor: Date, day: string): number {
  const date = parsePlanDay(day);
  if (!date) throw new Error(`${day} is not a day.`);
  return Math.round((date.valueOf() - anchor.valueOf()) / 86_400_000);
}

/**
 * Rewrites one session of a running copy through `plan/update`, the rest
 * written back exactly as the copy holds them. The copy is read first, so a
 * session gone from it since is said, not recreated.
 */
async function rewriteCopySession(
  ref: CalendarSessionRef,
  change: { toDay?: string; program?: Record<string, unknown> },
  deps: ScheduleMoveDeps
): Promise<void> {
  const raw = await deps.readNativeCorosPlanRaw(ref.planId);
  const input = nativePlanWriteInputFromRaw(raw);
  const session = input.sessions.find((candidate) => candidate.idInPlan === ref.idInPlan);
  if (!session) throw new Error("That session is no longer in the plan on the calendar.");
  if (change.toDay) {
    const dayNo = dayNoOn(copyAnchor(raw), change.toDay);
    if (dayNo < 0) throw new Error("A plan's session cannot move to before the week the plan starts in.");
    session.dayNo = dayNo;
  }
  if (change.program) {
    session.program = { ...change.program, idInPlan: session.idInPlan };
  }
  await deps.updateNativeCorosPlan(ref.planId, input, { current: raw });
}

/**
 * Moves a session to another day: through its running copy when it belongs
 * to a plan on the calendar, so it stays that plan's session; otherwise the
 * app's add-then-delete.
 */
export async function moveCalendarSession(
  ref: CalendarSessionRef,
  toDay: string,
  deps: ScheduleMoveDeps = defaultScheduleMoveDeps
): Promise<void> {
  if (!/^\d{8}$/.test(toDay)) throw new Error("The new day must be YYYYMMDD.");
  if (toDay === ref.happenDay) return;
  if (toDay < formatScheduleDay(new Date())) {
    throw new Error("COROS does not allow scheduling workouts before today.");
  }
  if (await isRunningCopy(ref.planId, deps)) {
    await rewriteCopySession(ref, { toDay }, deps);
    return;
  }
  await deps.rescheduleScheduledWorkout(
    { planId: ref.planId, idInPlan: ref.idInPlan, planProgramId: ref.planProgramId, happenDay: ref.happenDay },
    toDay
  );
}

/**
 * Puts another workout in a session's place on its day. A plan's session is
 * rewritten in its running copy, keeping its `idInPlan` and so its place in
 * the plan. One of the athlete's own is added first and removed after, so a
 * failure leaves two sessions on the day rather than none.
 */
export async function replaceCalendarSession(
  ref: CalendarSessionRef,
  workout: PlanWorkoutEntryInput,
  unitSystem: UnitSystem,
  deps: ScheduleMoveDeps = defaultScheduleMoveDeps
): Promise<void> {
  if (await isRunningCopy(ref.planId, deps)) {
    const program = await deps.buildCalculatedPlanProgram(workout, unitSystem);
    await rewriteCopySession(ref, { program }, deps);
    return;
  }
  await deps.createAndScheduleWorkout({ ...workout, save_to_library: false }, ref.happenDay, unitSystem, false);
  try {
    await deps.removeScheduledWorkout({
      planId: ref.planId,
      idInPlan: ref.idInPlan,
      planProgramId: ref.planProgramId,
      ...(ref.pbVersion ? { pbVersion: ref.pbVersion } : {})
    });
  } catch (error) {
    throw new PartialReplaceError(
      `The new workout was added, but the old one could not be removed (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}

/** A replacement that added its workout and could not take the old one off: trying again would add it twice. */
export class PartialReplaceError extends Error {}
