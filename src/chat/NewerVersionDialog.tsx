import { createPortal } from "react-dom";
import type { PlanVersionConflict } from "../../electron/types";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
import { messageRecord, t } from "../i18n/core";

const MADE_BY = messageRecord<PlanVersionConflict["newest"]["author"]>({
  coach: "chat.newer.coach",
  athlete: "chat.newer.athlete",
  coros: "chat.newer.coros"
});

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
      title={what === "plan" ? t("chat.newer.titlePlan") : t("chat.newer.titleWorkout")}
      description={t("chat.newer.body", { version: newest.version, who: MADE_BY[newest.author] })}
      cancelLabel={t("library.dlg.keepEditing")}
      alternative={{ label: t("chat.newer.keepNewer"), onSelect: onKeepNewer }}
      confirmLabel={t("library.dlg.conflict.replace")}
      onConfirm={onReplace}
      onCancel={onKeepEditing}
    />,
    document.body
  );
}
