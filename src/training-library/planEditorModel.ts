/**
 * What the plan editor does to a plan, as functions a test can reach.
 *
 * The editor used to do all of this inline, and two of its answers were
 * wrong in ways only arithmetic shows: deleting a week left the blocks after
 * it labelled one week too late, and a session moved into a day took
 * `sortOrder` 0 whatever was already there, so it jumped to the top of the
 * day instead of landing where it was dropped. Pure and outside the component
 * for the reason `planFilters.ts` and `planDraft.ts` are.
 *
 * Every function takes a plan and returns a new one; none stamps `updatedAt`
 * or derives the sport mix — `withDerivedSportMix` does both, once, at the
 * commit, so an edit is one state in the undo stack however many of these it
 * is built from.
 */
import type {
  LibraryPlanSession,
  PlanWorkoutEntryInput,
  TrainingPlanDocument,
  TrainingPlanEntry,
  TrainingPlanWeekStage
} from "../../electron/types";
import { copiedEntry, planEntryFromWorkout, sportMixOf } from "../../electron/trainingPlanDomain";

/** A day inside the plan. */
export interface PlanSlot {
  weekIndex: number;
  dayIndex: number;
}

/**
 * The sport mix is what the library row draws, and it is a fact about the
 * entries — so it is derived at every commit rather than kept in step by hand.
 */
export function withDerivedSportMix(plan: TrainingPlanDocument): TrainingPlanDocument {
  return { ...plan, sportMix: sportMixOf(plan.entries), updatedAt: new Date().toISOString() };
}

function sameSlot(entry: TrainingPlanEntry, slot: PlanSlot): boolean {
  return entry.weekIndex === slot.weekIndex && entry.dayIndex === slot.dayIndex;
}

/** One past the last item in a day, so what arrives lands at the bottom. */
export function nextSortOrder(
  plan: TrainingPlanDocument,
  slot: PlanSlot,
  excludingId?: string
): number {
  const orders = plan.entries
    .filter((entry) => entry.id !== excludingId && sameSlot(entry, slot))
    .map((entry) => entry.sortOrder);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function clampSlot(plan: TrainingPlanDocument, slot: PlanSlot): PlanSlot {
  return {
    weekIndex: Math.max(0, Math.min(slot.weekIndex, plan.weekCount - 1)),
    dayIndex: Math.max(0, Math.min(slot.dayIndex, 6))
  };
}

/** Places a new item at the bottom of its day. */
export function addEntry(
  plan: TrainingPlanDocument,
  entry: TrainingPlanEntry,
  slot: PlanSlot
): TrainingPlanDocument {
  const target = clampSlot(plan, slot);
  return {
    ...plan,
    entries: [
      ...plan.entries,
      { ...entry, ...target, sortOrder: nextSortOrder(plan, target) }
    ]
  };
}

/**
 * A library workout, as a session in this plan.
 *
 * A COROS plan holds a copy of each program rather than a link to the
 * library, so the workout arrives read in full (`libraryWorkoutAsPlanSession`)
 * and the session carries its steps and its program — and the figures COROS
 * stored for it, which a library list row does not have.
 */
export function libraryEntry(session: LibraryPlanSession): TrainingPlanEntry {
  return { ...planEntryFromWorkout(session.workout, 0, 0), ...session };
}

/** A session written in this plan, not taken from the library. */
export function writtenEntry(workout: PlanWorkoutEntryInput): TrainingPlanEntry {
  return planEntryFromWorkout(workout, 0, 0);
}

/** Moves an item to the bottom of another day (or the same one). */
export function moveEntry(
  plan: TrainingPlanDocument,
  entryId: string,
  slot: PlanSlot
): TrainingPlanDocument {
  const target = clampSlot(plan, slot);
  const current = plan.entries.find((entry) => entry.id === entryId);
  if (!current || sameSlot(current, target)) return plan;
  const sortOrder = nextSortOrder(plan, target, entryId);
  return {
    ...plan,
    entries: plan.entries.map((entry) =>
      entry.id === entryId ? { ...entry, ...target, sortOrder } : entry
    )
  };
}

/** A second copy of a session, at the bottom of a day — a new session to COROS. */
export function copyEntry(
  plan: TrainingPlanDocument,
  entryId: string,
  slot: PlanSlot
): TrainingPlanDocument {
  const source = plan.entries.find((entry) => entry.id === entryId);
  return source ? addEntry(plan, copiedEntry(source), slot) : plan;
}

export function removeEntry(plan: TrainingPlanDocument, entryId: string): TrainingPlanDocument {
  return { ...plan, entries: plan.entries.filter((entry) => entry.id !== entryId) };
}

export type StepDirection = "previous-day" | "next-day" | "previous-week" | "next-week";

/**
 * Where a keyboard move takes an item, or `undefined` at the plan's edge.
 *
 * A day step runs off the end of a week into the next one, which is what
 * "the day after Sunday" means.
 */
export function stepSlot(
  slot: PlanSlot,
  direction: StepDirection,
  weekCount: number
): PlanSlot | undefined {
  const { weekIndex, dayIndex } = slot;
  if (direction === "previous-week" || direction === "next-week") {
    const week = weekIndex + (direction === "next-week" ? 1 : -1);
    return week < 0 || week >= weekCount ? undefined : { weekIndex: week, dayIndex };
  }
  const absolute = weekIndex * 7 + dayIndex + (direction === "next-day" ? 1 : -1);
  if (absolute < 0 || absolute >= weekCount * 7) return undefined;
  return { weekIndex: Math.floor(absolute / 7), dayIndex: absolute % 7 };
}

export function appendWeek(plan: TrainingPlanDocument): TrainingPlanDocument {
  return { ...plan, weekCount: plan.weekCount + 1 };
}

export function clearWeek(plan: TrainingPlanDocument, weekIndex: number): TrainingPlanDocument {
  return { ...plan, entries: plan.entries.filter((entry) => entry.weekIndex !== weekIndex) };
}

/**
 * Takes a week out and closes the gap. The stages close it too: a stage is
 * set on a week, and a Build on week 6 belongs on the week that is now 5.
 */
export function removeWeek(plan: TrainingPlanDocument, weekIndex: number): TrainingPlanDocument {
  if (plan.weekCount <= 1) return plan;
  const shift = <T extends { weekIndex: number }>(item: T): T =>
    item.weekIndex > weekIndex ? { ...item, weekIndex: item.weekIndex - 1 } : item;
  return {
    ...plan,
    weekCount: plan.weekCount - 1,
    entries: plan.entries.filter((entry) => entry.weekIndex !== weekIndex).map(shift),
    weekStages: plan.weekStages.filter((item) => item.weekIndex !== weekIndex).map(shift)
  };
}

/** Sets a week's COROS stage; Not Set clears it. */
export function setWeekStage(
  plan: TrainingPlanDocument,
  weekIndex: number,
  stage: TrainingPlanWeekStage
): TrainingPlanDocument {
  const others = plan.weekStages.filter((item) => item.weekIndex !== weekIndex);
  return {
    ...plan,
    weekStages: stage
      ? [...others, { weekIndex, stage }].sort((left, right) => left.weekIndex - right.weekIndex)
      : others
  };
}

/**
 * The name a new plan opens with: "New plan", numbered past the ones already
 * in the library. It opened unnamed once, so the first thing on the screen
 * was "Add a plan name." — an error for a plan nobody had touched yet. The
 * editor selects it on open, so typing replaces it and leaving it costs
 * nothing.
 */
export function defaultPlanName(existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
  if (!taken.has("new plan")) return "New plan";
  let number = 2;
  while (taken.has(`new plan ${number}`)) number += 1;
  return `New plan ${number}`;
}
