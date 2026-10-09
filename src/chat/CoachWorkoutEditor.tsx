import { useState } from "react";
import type {
  PlanDraftPreview,
  PlanVersionConflict,
  PlanVersionWritten,
  PlanWorkoutEntryInput,
  TrainingPlanEntry
} from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { WorkoutBuilderModal } from "../calendar/WorkoutBuilderModal";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
import { NewerVersionDialog } from "./NewerVersionDialog";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { t } from "../i18n/core";
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
  api: HeraclesRecordsApi;
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
        onError(caught instanceof Error ? caught.message : t("chat.editor.workoutFailed"))
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
      heading={{ eyebrow: t("chat.editor.workoutEyebrow"), title: workout.name ? t("library.ed.editName", { name: workout.name }) : t("chat.editor.editWorkout") }}
      confirmDiscard={({ keep, discard }) => (
        <ConfirmDialog
          title={t("chat.set.discardTitle")}
          description={t("chat.editor.discardBody")}
          confirmLabel={t("chat.set.discardConfirm")}
          cancelLabel={t("chat.set.keepEditing")}
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
