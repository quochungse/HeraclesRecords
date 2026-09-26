import { useEffect, useRef, useState } from "react";
import type { TrainingPlanDocument } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { TrainingPlanCalendarDialog } from "../training-library/TrainingPlanCalendarDialog";
import "../training-library/trainingLibrary.css";
import { datedForReading } from "./CoachCreationCard";

/**
 * "Add to calendar…" for a Coach plan (docs/coach-plan-canvas.md, P1.6):
 * the Library's own dialog, which reads what COROS will do before anything is
 * written. A plan not on COROS yet is shown to it as `chat:<draftId>`, which
 * the preview reads through the chat, and is saved first once the day is
 * picked — once: asked again after the add failed, it answers the plan it
 * saved rather than saving a second. A plan the coach dated opens on the
 * Monday its first session falls in.
 *
 * Loaded when first opened, with the library's stylesheet the dialog is drawn by.
 */
export default function CoachCalendarDialog({
  api,
  draftId,
  saved,
  onSave,
  onClose,
  onAdded,
  onError
}: {
  api: CorosLinkApi;
  draftId: string;
  /** This version is on COROS already. */
  saved: boolean;
  /** Saves this version to COROS; answers whether it went. */
  onSave: () => Promise<boolean>;
  onClose: () => void;
  onAdded: () => void;
  onError: (message: string) => void;
}) {
  const [plan, setPlan] = useState<TrainingPlanDocument | null>(null);
  const savedPlan = useRef<TrainingPlanDocument | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getPlanDraftDocument(draftId)
      .then((document) => {
        if (live) setPlan(document);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        onError(cause instanceof Error ? cause.message : "Could not read the plan.");
        onClose();
      });
    return () => {
      live = false;
    };
    // Read once per opening; the callbacks are the caller's inline ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, draftId]);

  if (!plan) return null;
  const start = datedForReading(plan).startDate?.replace(/-/g, "");

  return (
    <TrainingPlanCalendarDialog
      api={api}
      plan={saved ? plan : { ...plan, id: `chat:${draftId}` }}
      saveFirst={
        saved
          ? undefined
          : async () => {
              if (savedPlan.current) return savedPlan.current;
              if (!(await onSave())) throw new Error("The plan was not saved to COROS, so it was not added.");
              savedPlan.current = await api.getPlanDraftDocument(draftId);
              return savedPlan.current;
            }
      }
      {...(start ? { defaultStartDay: start } : {})}
      onClose={onClose}
      onAdded={() => onAdded()}
    />
  );
}
