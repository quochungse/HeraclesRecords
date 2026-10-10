import { createPortal } from "react-dom";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
import { t } from "../i18n/core";
import "../training-library/trainingLibrary.css";

/**
 * An update of a Coach plan refused because the plan changed on COROS since
 * this version was made (docs/coach-plan-canvas.md, P1.6) — on another
 * device, in the COROS app or in the Library. The Library's own save conflict
 * asks the same three things in the same words. Loaded when first needed, with
 * the library's stylesheet the dialog is drawn by.
 */
export default function CorosConflictDialog({
  name,
  onOverwrite,
  onSaveAsNew,
  onCancel
}: {
  name: string;
  onOverwrite: () => void;
  onSaveAsNew: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <ConfirmDialog
      title={t("library.dlg.conflict.title")}
      description={t("chat.conflict.body", { name })}
      cancelLabel={t("library.dlg.keepEditing")}
      alternative={{ label: t("library.dlg.conflict.asNew"), onSelect: onSaveAsNew }}
      confirmLabel={t("library.dlg.conflict.replace")}
      danger
      onConfirm={onOverwrite}
      onCancel={onCancel}
    />,
    document.body
  );
}
