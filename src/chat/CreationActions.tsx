import { useState } from "react";
import {
  BookOpen,
  Bookmark,
  CalendarDays,
  Loader2,
  MoreHorizontal,
  PencilLine,
  RotateCcw,
  TriangleAlert
} from "lucide-react";
import type {
  PlanDraftPreview,
  PlanDraftSaveOptions,
  TrainingPlanDestination
} from "../../electron/types";
import { artifactActions, type CreationAction } from "./creationChoices";

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function ActionIcon({ action, busy }: { action: CreationAction; busy: boolean }) {
  if (busy) return <Loader2 className="chat-spinner" size={14} aria-hidden="true" />;
  if (action.id === "addToCalendar") return <CalendarDays size={14} aria-hidden="true" />;
  if (action.destination === "nativePlan") return <BookOpen size={14} aria-hidden="true" />;
  if (action.destination === "calendar") return <CalendarDays size={14} aria-hidden="true" />;
  return <Bookmark size={14} aria-hidden="true" />;
}

/**
 * The buttons under a coach's plan or workout, wherever it is drawn: one that
 * leads, the ones beside it, and the rest behind ⋯. Which is which is
 * `artifactActions`, so the card in the conversation and the canvas it opens
 * always offer the same presses (docs/coach-plan-canvas.md, P0.5, P1.4).
 */
export function CreationActions({
  draft,
  uploading,
  onUpload,
  onEdit,
  latest = true,
  editing = false,
  saved,
  onCoros = false,
  onRestore,
  onCalendar,
  onCalendarNow = false
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  onUpload: (
    destination: TrainingPlanDestination,
    scheduleDate?: string,
    keepInLibrary?: boolean,
    options?: PlanDraftSaveOptions
  ) => void;
  onEdit?: () => void;
  /** Another version of it is a COROS plan, which saving this one updates. */
  onCoros?: boolean;
  /** False for a version something has replaced: it is read, not saved. */
  latest?: boolean;
  /** Its editor is open, so the way on is back into it. */
  editing?: boolean;
  /** Whether any version of the creation is saved, when the caller knows. */
  saved?: boolean;
  /** Makes this older version the newest again. */
  onRestore?: () => void;
  /** Opens the calendar dialog; without it, adding to the calendar is not offered. */
  onCalendar?: () => void;
  /** COROS is running a copy of the plan on the calendar already. */
  onCalendarNow?: boolean;
}) {
  const today = todayKey();
  const offered = artifactActions(draft, { latest, editing, saved, onCoros, onCalendar: onCalendarNow }, today);
  const withoutCalendar = (list: CreationAction[]) =>
    onCalendar ? list : list.filter((action) => action.id !== "addToCalendar");
  const actions =
    offered.kind === "save"
      ? {
          ...offered,
          choices: {
            ...offered.choices,
            secondary: withoutCalendar(offered.choices.secondary),
            more: withoutCalendar(offered.choices.more)
          }
        }
      : offered;
  const [showMore, setShowMore] = useState(false);
  /* A workout put on the calendar is otherwise not kept in the library. */
  const [keepInLibrary, setKeepInLibrary] = useState(false);
  const isWorkout = draft.artifactType === "workout";
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [pending, setPending] = useState<CreationAction["id"] | null>(null);

  const run = (action: CreationAction) => {
    if (action.id === "addToCalendar") {
      onCalendar?.();
      return;
    }
    if (action.id === "pickWorkoutDate") {
      setPickedDate(today);
      return;
    }
    setPending(action.id);
    onUpload(
      action.destination,
      action.date,
      isWorkout && action.destination === "calendar" ? keepInLibrary : undefined,
      action.asNew ? { asNew: true } : undefined
    );
  };

  const button = (action: CreationAction, lead: boolean) => (
    <button
      key={action.id}
      type="button"
      className={lead ? "chat-plan-upload" : "chat-plan-review"}
      data-action={action.id}
      onClick={() => run(action)}
      disabled={uploading}
    >
      <ActionIcon action={action} busy={uploading && pending === action.id} />
      {action.label}
    </button>
  );

  if (actions.kind === "older") {
    return (
      <div className="chat-creation-actions">
        <div className="chat-plan-actions">
          {actions.restore && onRestore ? (
            <button
              type="button"
              className="chat-plan-upload"
              data-action="restore"
              onClick={onRestore}
              disabled={uploading}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Restore this version
            </button>
          ) : (
            <p className="chat-plan-destination-summary">
              {actions.restore
                ? "An earlier version, to read."
                : "An earlier version, to read. The newest one is saved to COROS."}
            </p>
          )}
        </div>
      </div>
    );
  }
  if (actions.kind === "saved") {
    // Saved: what it became is said above; a plan on COROS changes through a
    // new version, which is what Edit makes, and goes on the calendar as its
    // running copy.
    const calendar = actions.addToCalendar && onCalendar;
    const edit = onEdit && onCoros;
    return calendar || edit ? (
      <div className="chat-creation-actions">
        <div className="chat-plan-actions">
          {calendar ? (
            <button
              type="button"
              className="chat-plan-upload"
              data-action="addToCalendar"
              onClick={onCalendar}
              disabled={uploading}
            >
              <CalendarDays size={14} aria-hidden="true" />
              Add to calendar…
            </button>
          ) : null}
          {edit ? (
          <button
            type="button"
            className="chat-plan-review"
            data-action="edit"
            onClick={onEdit}
            disabled={uploading}
          >
            <PencilLine size={14} aria-hidden="true" />
            Edit
          </button>
          ) : null}
        </div>
      </div>
    ) : null;
  }
  if (actions.kind === "editing") {
    return (
      <div className="chat-creation-actions">
        <div className="chat-plan-actions">
          <button
            type="button"
            className="chat-plan-upload"
            data-action="continueEditing"
            onClick={onEdit}
            disabled={!onEdit}
          >
            <PencilLine size={14} aria-hidden="true" />
            Continue editing
          </button>
        </div>
      </div>
    );
  }
  const choices = actions.choices;
  const calendarOffered = [choices.primary, ...choices.secondary].some(
    (action) => action.id === "putOnCalendar"
  );
  const schedulesWorkout =
    isWorkout &&
    (pickedDate !== null || choices.primary.id === "scheduleWorkout");

  return (
    <div className="chat-creation-actions">
      {calendarOffered && draft.conflicts.length > 0 ? (
        <p className="chat-plan-destination-summary" data-tone="alert">
          <TriangleAlert size={13} aria-hidden="true" />
          <span>
            {draft.conflicts.length === 1
              ? "One of these days already holds a workout."
              : `${draft.conflicts.length} of these days already hold a workout.`}{" "}
            Putting the sessions on the calendar adds them beside it.
          </span>
        </p>
      ) : null}
      {pickedDate !== null ? (
        <label className="chat-workout-calendar-date">
          <span>Calendar date</span>
          <input
            type="date"
            value={pickedDate}
            min={today}
            onChange={(event) => setPickedDate(event.target.value)}
          />
        </label>
      ) : null}
      {schedulesWorkout ? (
        <label className="chat-creation-keep">
          <input
            type="checkbox"
            checked={keepInLibrary}
            onChange={(event) => setKeepInLibrary(event.target.checked)}
            disabled={uploading}
          />
          Also keep in library
        </label>
      ) : null}
      <div className="chat-plan-actions">
        {pickedDate !== null ? (
          <>
            <button
              type="button"
              className="chat-plan-upload"
              data-action="scheduleOnPickedDate"
              disabled={uploading || !pickedDate || pickedDate < today}
              onClick={() => {
                setPending("pickWorkoutDate");
                onUpload("calendar", pickedDate, keepInLibrary);
              }}
            >
              <ActionIcon
                action={{ id: "pickWorkoutDate", label: "", destination: "calendar" }}
                busy={uploading && pending === "pickWorkoutDate"}
              />
              Schedule
            </button>
            <button
              type="button"
              className="chat-plan-review"
              onClick={() => setPickedDate(null)}
              disabled={uploading}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {button(choices.primary, true)}
            {choices.secondary.map((action) => button(action, false))}
            {onEdit ? (
              <button
                type="button"
                className="chat-plan-review"
                data-action="edit"
                onClick={onEdit}
                disabled={uploading}
              >
                <PencilLine size={14} aria-hidden="true" />
                Edit
              </button>
            ) : null}
            {showMore ? choices.more.map((action) => button(action, false)) : null}
            {choices.more.length > 0 && !showMore ? (
              <button
                type="button"
                className="chat-plan-review"
                data-action="more"
                aria-label="More ways to save"
                title="More ways to save"
                onClick={() => setShowMore(true)}
                disabled={uploading}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
