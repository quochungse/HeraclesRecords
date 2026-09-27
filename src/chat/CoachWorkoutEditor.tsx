import { useState } from "react";
import type {
  PlanDraftPreview,
  PlanVersionConflict,
  PlanVersionWritten,
  PlanWorkoutEntryInput,
  TrainingPlanEntry
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { WorkoutBuilderModal } from "../calendar/WorkoutBuilderModal";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
import { NewerVersionDialog } from "./NewerVersionDialog";
import { useUnitSystem } from "../units/UnitSystemProvider";
import "../training-library/trainingLibrary.css";

/**
 * A coach's one-off workout, opened in the builder every other workout is
 * written in, and saved as the workout's next version
 * (docs/coach-plan-canvas.md, P0.4, P1.5). Loaded only when it is used, with the
 * library's stylesheet the builder's dialog is drawn by.
 */
export default function CoachWorkoutEditor({
  api,
  draft,
  workout,
  onSaved,
  onClose,
  onError
}: {
  api: CorosLinkApi;
  draft: PlanDraftPreview;
  /** The workout as the coach wrote it, steps and all. */
  workout: PlanWorkoutEntryInput;
  onSaved: (written: PlanVersionWritten) => void;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const [conflict, setConflict] = useState<{
    workout: PlanWorkoutEntryInput;
    newest: PlanVersionConflict["newest"];
  } | null>(null);
  const save = (edited: PlanWorkoutEntryInput, replaceNewer = false) => {
    onError(null);
    void api
      .editWorkoutDraft(draft.draftId, edited, unitSystem, replaceNewer)
      .then((result) => {
        if (result.kind === "conflict") {
          setConflict({ workout: edited, newest: result.newest });
          return;
        }
        setConflict(null);
        onSaved(result);
      })
      .catch((caught: unknown) =>
        onError(caught instanceof Error ? caught.message : "Could not save the workout.")
      );
  };
  const entry: TrainingPlanEntry = {
    id: `entry:${draft.draftId}:${workout.key}`,
    weekIndex: 0,
    dayIndex: 0,
    sortOrder: 0,
    title: workout.name,
    workout
  };

  return (
    <>
    <WorkoutBuilderModal
      api={api}
      source={{ kind: "plan", entry }}
      heading={{ eyebrow: "Coach's workout", title: `Edit ${workout.name || "workout"}` }}
      confirmDiscard={({ keep, discard }) => (
        <ConfirmDialog
          title="Discard unsaved changes?"
          description="This workout has edits that have not been saved to the card. Closing it throws them away."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          danger
          onConfirm={discard}
          onCancel={keep}
        />
      )}
      onClose={onClose}
      onSavedToPlan={(edited) => save(edited)}
      onError={onError}
    />
    {conflict ? (
      <NewerVersionDialog
        what="workout"
        newest={conflict.newest}
        onReplace={() => save(conflict.workout, true)}
        onKeepNewer={onClose}
        onKeepEditing={() => setConflict(null)}
      />
    ) : null}
    </>
  );
}
