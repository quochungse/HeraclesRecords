import { useEffect, type MouseEvent } from "react";
import { BrainCircuit, X } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import { CoachModelsPanel } from "../chat/CoachModelsPanel";

export interface CoachModelsModalProps {
  api: CorosLinkApi | undefined;
  open: boolean;
  onClose: () => void;
  onChange?: () => void | Promise<void>;
}

/**
 * Provider connections for the AI coach, lifted out of Coach settings so they
 * sit with the other connections. What is left in Coach is what belongs to a
 * conversation — display, custom instructions, context compaction — while the
 * accounts and keys behind them are configured once, here.
 */
export function CoachModelsModal({
  api,
  open,
  onClose,
  onChange
}: CoachModelsModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  // Opened from inside Coach settings as well as from Settings, and that
  // caller's own backdrop is an ancestor with its own dismiss handler —
  // without stopping here, dismissing this dialog would dismiss that one too.
  const dismiss = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      className="app-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-models-title"
      onClick={dismiss}
    >
      <section
        className="panel app-modal is-wide is-tall"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="app-modal-header">
          <div className="app-modal-title">
            <BrainCircuit size={16} aria-hidden="true" />
            <h2 id="coach-models-title">Coach models</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close coach models"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="app-modal-body">
          <p className="app-modal-copy">
            Connect the accounts and keys the coach can run on. The provider it
            actually uses is picked in Coach, from whatever is connected here.
          </p>
          <CoachModelsPanel api={api} onChange={onChange} />
        </div>
      </section>
    </div>
  );
}
