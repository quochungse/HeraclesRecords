import { createPortal } from "react-dom";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
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
      title="This plan changed on COROS"
      description={`"${name}" was changed on COROS after this version was made — on another computer, in the COROS app or in the Training Library. Saving now replaces those changes with this version.`}
      cancelLabel="Keep editing"
      alternative={{ label: "Save as a new plan", onSelect: onSaveAsNew }}
      confirmLabel="Replace with my edit"
      danger
      onConfirm={onOverwrite}
      onCancel={onCancel}
    />,
    document.body
  );
}
