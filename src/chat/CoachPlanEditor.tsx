import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type {
  PlanVersionConflict,
  PlanVersionWritten,
  TrainingLibraryWorkout,
  TrainingPlanDocument
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { PlanEditor } from "../training-library/PlanEditor";
import { NewerVersionDialog } from "./NewerVersionDialog";
import { startDraft, type PlanDraft } from "../training-library/planDraft";
import { useUnitSystem } from "../units/UnitSystemProvider";
import "../training-library/trainingLibrary.css";

interface CoachPlanEditorProps {
  api: CorosLinkApi;
  draftId: string;
  /** The version the edit became. */
  onSaved: (written: PlanVersionWritten) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * "Edit plan first", opened over the conversation rather than in the Training
 * Library.
 *
 * The plan is still the coach's until it is saved: it lives in the coach's
 * draft, behind the card, and is not one of the library's plan drafts. So a
 * save here is the creation's next version (docs/coach-plan-canvas.md, P1.5)
 * and nothing here writes to COROS. Keeping a library draft is not offered
 * for the same reason. A save begun on a version Coach has since replaced
 * asks before writing over it.
 *
 * Lazy-loaded by the chat, with the library's stylesheet, so a conversation
 * that never edits a plan never pays for either. The backdrop is the one the
 * library portals its editor into, which is where the `--tl-*` tokens the
 * editor reads are declared.
 */
export default function CoachPlanEditor({ api, draftId, onSaved, onClose, onError }: CoachPlanEditorProps) {
  const { unitSystem } = useUnitSystem();
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [workouts, setWorkouts] = useState<TrainingLibraryWorkout[]>([]);
  const [conflict, setConflict] = useState<{
    plan: TrainingPlanDocument;
    newest: PlanVersionConflict["newest"];
  } | null>(null);

  const save = async (plan: TrainingPlanDocument, replaceNewer = false) => {
    try {
      const result = await api.editPlanDraft(draftId, plan, unitSystem, replaceNewer);
      if (result.kind === "conflict") {
        setConflict({ plan, newest: result.newest });
        return;
      }
      setConflict(null);
      onSaved(result);
    } catch (cause) {
      onError(messageOf(cause));
    }
  };

  useEffect(() => {
    let live = true;
    api
      .getPlanDraftDocument(draftId)
      .then((plan) => {
        if (live) setDraft(startDraft(plan));
      })
      .catch((cause) => {
        if (!live) return;
        onError(messageOf(cause));
        onClose();
      });
    /* Only "From workout library" reads this; without it the picker is empty
       and the rest of the editor works. */
    api
      .listTrainingLibraryWorkouts()
      .then((library) => {
        if (live) setWorkouts(library);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Read once per opening: `onError` and `onClose` are the caller's inline
    // callbacks, and following them would read the draft on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, draftId]);

  if (!draft) return null;

  return createPortal(
    <div className="tl-plan-modal-backdrop" role="presentation">
      <div className="tl-plan-modal" role="dialog" aria-modal="true" aria-label="Edit the coach's plan">
        <PlanEditor
          api={api}
          draft={draft}
          onDraftChange={setDraft}
          workouts={workouts}
          isNew={false}
          saveLabel="Save changes"
          onSave={(plan) => save(plan)}
          onClose={onClose}
        />
      </div>
      {conflict ? (
        <NewerVersionDialog
          what="plan"
          newest={conflict.newest}
          onReplace={() => void save(conflict.plan, true)}
          onKeepNewer={onClose}
          onKeepEditing={() => setConflict(null)}
        />
      ) : null}
    </div>,
    document.body
  );
}
