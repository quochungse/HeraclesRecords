import { useState } from "react";
import {
  BookOpen,
  Bookmark,
  CalendarDays,
  Loader2,
  MoreHorizontal,
  PencilLine,
  TriangleAlert
} from "lucide-react";
import type { PlanDraftPreview, TrainingPlanDestination } from "../../electron/types";
import { planSaveChoices, type CreationAction } from "./creationChoices";

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function ActionIcon({ action, busy }: { action: CreationAction; busy: boolean }) {
  if (busy) return <Loader2 className="chat-spinner" size={14} aria-hidden="true" />;
  if (action.destination === "nativePlan") return <BookOpen size={14} aria-hidden="true" />;
  if (action.destination === "calendar") return <CalendarDays size={14} aria-hidden="true" />;
  return <Bookmark size={14} aria-hidden="true" />;
}

/**
 * The buttons under a coach's plan or workout, wherever it is drawn: one that
 * leads, the ones beside it, and the rest behind ⋯. Which is which is
 * `planSaveChoices`, so the card in the conversation and the popup it opens
 * always offer the same presses (docs/coach-plan-canvas.md, P0.5).
 */
export function CreationActions({
  draft,
  uploading,
  onUpload,
  onEdit
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  onUpload: (destination: TrainingPlanDestination, scheduleDate?: string) => void;
  onEdit?: () => void;
}) {
  const today = todayKey();
  const choices = planSaveChoices(draft, today);
  const [showMore, setShowMore] = useState(false);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [pending, setPending] = useState<CreationAction["id"] | null>(null);

  const run = (action: CreationAction) => {
    if (action.id === "pickWorkoutDate") {
      setPickedDate(today);
      return;
    }
    setPending(action.id);
    onUpload(action.destination, action.date);
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

  const calendarOffered = [choices.primary, ...choices.secondary].some(
    (action) => action.id === "putOnCalendar"
  );

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
                onUpload("calendar", pickedDate);
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
