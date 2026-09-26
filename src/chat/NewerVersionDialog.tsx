import { createPortal } from "react-dom";
import type { PlanVersionConflict } from "../../electron/types";
import { ConfirmDialog } from "../training-library/ConfirmDialog";

const MADE_BY: Record<PlanVersionConflict["newest"]["author"], string> = {
  coach: "Coach revised it",
  athlete: "it was edited on another device",
  coros: "it changed in the Library"
};

/**
 * An edit saved on a version something has since replaced
 * (docs/coach-plan-canvas.md, P1.5). Nothing is written until the athlete
 * says which one stands. Portalled to `<body>`, as the Library's save
 * conflict is, so the editor's stacking context cannot hold it underneath.
 */
export function NewerVersionDialog({
  what,
  newest,
  onReplace,
  onKeepNewer,
  onKeepEditing
}: {
  what: "plan" | "workout";
  newest: PlanVersionConflict["newest"];
  onReplace: () => void;
  onKeepNewer: () => void;
  onKeepEditing: () => void;
}) {
  return createPortal(
    <ConfirmDialog
      title={`This ${what} changed while you were editing`}
      description={`Version ${newest.version} was written after you opened it — ${MADE_BY[newest.author]}. Saving now replaces it with your edit; it stays in the versions list either way.`}
      cancelLabel="Keep editing"
      alternative={{ label: "Keep the newer version", onSelect: onKeepNewer }}
      confirmLabel="Replace with my edit"
      onConfirm={onReplace}
      onCancel={onKeepEditing}
    />,
    document.body
  );
}
