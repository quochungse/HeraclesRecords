/**
 * Which ways of saving a coach's creation are offered, and which one leads.
 *
 * Every card that shows a creation — inline under the answer, and the popup it
 * opens — draws its buttons from this one function, so the two can never
 * disagree about what a press does (docs/coach-plan-canvas.md, P0.5, D3/D9).
 *
 * Two of the answers look alike and are not: **Put sessions on calendar**
 * writes each session as a workout of its own (`uploadTrainingPlan`), and
 * **Save to COROS** makes one COROS plan. Neither label is ever used for the
 * other. A plan is "one-shot" — sessions to use this week rather than a
 * programme — when every session has a date, the first is not past, and first
 * to last spans at most fourteen days; then putting the sessions on the
 * calendar is what the athlete came for, and a plan is the second choice.
 *
 * Pure and outside the component for the reason `activityFilters.ts` is.
 */
import type { PlanDraftPreview, TrainingPlanDestination } from "../../electron/types";

export type CreationActionId =
  | "addToCalendar"
  | "updatePlan"
  | "saveAsNewPlan"
  | "scheduleWorkout"
  | "pickWorkoutDate"
  | "saveToLibrary"
  | "putOnCalendar"
  | "saveAsPlan";

export interface CreationAction {
  id: CreationActionId;
  label: string;
  destination: Extract<TrainingPlanDestination, "calendar" | "workoutLibrary" | "nativePlan">;
  /** `YYYY-MM-DD`, for a workout scheduled on the day the coach suggested. */
  date?: string;
  /** A new COROS plan, though the creation is already one (P1.6). */
  asNew?: boolean;
}

export interface CreationChoices {
  primary: CreationAction;
  secondary: CreationAction[];
  /** Behind the ⋯: reachable, not advertised. */
  more: CreationAction[];
}

/** Sessions spanning at most this many days, first to last inclusive, are one-shot. */
export const ONE_SHOT_DAYS = 14;

const LIBRARY: CreationAction = {
  id: "saveToLibrary",
  label: "Save to Workout Library",
  destination: "workoutLibrary"
};
const PICK_DATE: CreationAction = {
  id: "pickWorkoutDate",
  label: "Schedule…",
  destination: "calendar"
};
const PUT_ON_CALENDAR: CreationAction = {
  id: "putOnCalendar",
  label: "Put sessions on calendar",
  destination: "calendar"
};

function entryDate(entry: PlanDraftPreview["entries"][number]): string | undefined {
  if (entry.scheduleDate && /^\d{4}-\d{2}-\d{2}$/.test(entry.scheduleDate)) {
    return entry.scheduleDate;
  }
  const source = entry.source?.schedule_date;
  return source && /^\d{8}$/.test(source)
    ? `${source.slice(0, 4)}-${source.slice(4, 6)}-${source.slice(6, 8)}`
    : undefined;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(year, month - 1, day));
}

/** Whether every session has a date, from `today` on, within `ONE_SHOT_DAYS`. */
export function isOneShotPlan(preview: PlanDraftPreview, today: string): boolean {
  const dates = preview.entries.map(entryDate);
  if (!dates.length || !dates.every((date): date is string => Boolean(date))) return false;
  const sorted = [...dates].sort();
  return (
    sorted[0] >= today &&
    dayNumber(sorted[sorted.length - 1]) - dayNumber(sorted[0]) < ONE_SHOT_DAYS
  );
}

/**
 * Where a creation stands, in words: what it became on COROS once saved, and
 * whether the athlete has changed it before then. The creations list used to
 * say "Workout Library" of every workout, including one put on the calendar.
 */
export function creationStatus(
  draft: PlanDraftPreview,
  /** Another version of it is a COROS plan, so this one is a change to that plan. */
  onCoros = false
): { label: string; saved: boolean } {
  if (draft.uploadResult || draft.uploadedAt) {
    const destination = draft.uploadResult?.destination;
    if (destination === "nativePlan") return { label: "On COROS", saved: true };
    if (destination === "workoutLibrary") return { label: "In library", saved: true };
    if (destination === "calendar") {
      const date =
        draft.artifactType === "workout" && draft.entries[0] ? entryDate(draft.entries[0]) : undefined;
      return { label: date ? `On calendar ${formatDay(date)}` : "On calendar", saved: true };
    }
    return { label: "Saved", saved: true };
  }
  if (onCoros) return { label: "Changes not on COROS", saved: false };
  return { label: draft.editedAt ? "Edited by you" : "Proposal", saved: false };
}

/** `today` is `YYYY-MM-DD` in the athlete's own time zone. */
export function planSaveChoices(preview: PlanDraftPreview, today: string): CreationChoices {
  if (preview.artifactType === "workout") {
    const date = preview.entries[0] ? entryDate(preview.entries[0]) : undefined;
    if (date && date >= today) {
      return {
        primary: {
          id: "scheduleWorkout",
          label: `Schedule for ${formatDay(date)}`,
          destination: "calendar",
          date
        },
        secondary: [LIBRARY, PICK_DATE],
        more: []
      };
    }
    return { primary: LIBRARY, secondary: [PICK_DATE], more: [] };
  }

  const allDated = preview.entries.length > 0 && preview.entries.every((entry) => entryDate(entry));
  if (isOneShotPlan(preview, today)) {
    return {
      primary: PUT_ON_CALENDAR,
      secondary: [{ id: "saveAsPlan", label: "Save to COROS as a plan", destination: "nativePlan" }],
      more: [LIBRARY]
    };
  }
  const anyPast = preview.entries.some((entry) => {
    const date = entryDate(entry);
    return date !== undefined && date < today;
  });
  return {
    primary: { id: "saveAsPlan", label: "Save to COROS", destination: "nativePlan" },
    secondary: [],
    more: [...(allDated && !anyPast ? [PUT_ON_CALENDAR] : []), LIBRARY]
  };
}

/**
 * What a creation offers where it is drawn, from one place for the card and
 * the canvas alike (docs/coach-plan-canvas.md, P1.4, D9/D10):
 *
 * - `older`: a version something has replaced. It is read, not saved; the one
 *   thing to do with it is make it the newest again (`restore`), which a
 *   saved creation cannot do from here until P1.6.
 * - `editing`: its editor is open. The editor is the one place a creation
 *   is changed, so every other place leads back into it, and nothing is saved
 *   to COROS from a version with changes still unsaved.
 * - `save`: the newest version, with the ways to save it.
 */
export type ArtifactActions =
  | { kind: "older"; restore: boolean }
  | { kind: "editing" }
  | { kind: "saved"; addToCalendar: boolean }
  | { kind: "save"; choices: CreationChoices };

/**
 * The plan onto the COROS calendar as its running copy (P1.6), through the
 * Library's dialog — which saves a plan not on COROS yet first. Not a way of
 * saving: a plan is on the calendar only as a COROS plan.
 */
const ADD_TO_CALENDAR: CreationAction = {
  id: "addToCalendar",
  label: "Add to calendar…",
  destination: "nativePlan"
};

/**
 * `saved` is whether any version is saved; `onCoros`, whether one is a COROS
 * plan (P1.6). A plan on COROS is changed by a new version that updates it,
 * so its older versions can be restored and its newest one, once saved, can
 * still be edited; a workout saved to the library or the calendar has nothing
 * to update, so neither.
 */
export function artifactActions(
  draft: PlanDraftPreview,
  state: {
    latest: boolean;
    editing?: boolean;
    saved?: boolean;
    onCoros?: boolean;
    /** COROS is running a copy of the plan on the calendar already. */
    onCalendar?: boolean;
  },
  today: string
): ArtifactActions {
  const saved = state.saved ?? Boolean(draft.uploadedAt || draft.uploadResult);
  const isPlan = draft.artifactType !== "workout";
  if (!state.latest) return { kind: "older", restore: !saved || (isPlan && Boolean(state.onCoros)) };
  if (state.editing) return { kind: "editing" };
  if (draft.uploadedAt || draft.uploadResult) {
    const asPlan = isPlan && (draft.uploadResult?.destination === "nativePlan" || Boolean(state.onCoros));
    return { kind: "saved", addToCalendar: asPlan && !state.onCalendar };
  }
  if (isPlan && state.onCoros) {
    return {
      kind: "save",
      choices: {
        primary: { id: "updatePlan", label: "Update COROS plan", destination: "nativePlan" },
        secondary: [],
        more: [{ id: "saveAsNewPlan", label: "Save as a new COROS plan", destination: "nativePlan", asNew: true }]
      }
    };
  }
  const choices = planSaveChoices(draft, today);
  // A programme can go on the calendar as a plan, saved first; a one-shot plan
  // already leads with putting its sessions there, and a second calendar
  // button beside that one would ask the same question two ways.
  if (isPlan && choices.primary.id === "saveAsPlan") {
    return { kind: "save", choices: { ...choices, secondary: [...choices.secondary, ADD_TO_CALENDAR] } };
  }
  return { kind: "save", choices };
}
