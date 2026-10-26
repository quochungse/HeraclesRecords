import { Component, Suspense, lazy, useEffect, type MouseEvent, type ReactNode } from "react";
import { BrainCircuit, X } from "lucide-react";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { CoachModelsSkeleton } from "../chat/CoachModelsSkeleton";
import { t } from "../i18n/core";

export interface CoachModelsModalProps {
  api: HeraclesRecordsApi | undefined;
  open: boolean;
  onClose: () => void;
  onChange?: () => void | Promise<void>;
}

const LazyProviderPanel = lazy(() => import("../chat/CoachModelsPanel").then(({ CoachModelsPanel }) => ({
  default: CoachModelsPanel
})));

class ProviderPanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="chat-settings-panel coach-models-panel">
        <p className="mcp-servers-error" role="alert">{t("chat.models.err.load")}</p>
      </div>
    );
  }
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
      className="app-modal-backdrop coach-models-backdrop"
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
            <h2 id="coach-models-title">{t("app.coachModels.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("app.coachModels.close")}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="app-modal-body">
          <p className="app-modal-copy">
            {t("app.coachModels.intro")}
          </p>
          <ProviderPanelBoundary>
            <Suspense fallback={<CoachModelsSkeleton />}>
              <LazyProviderPanel api={api} onChange={onChange} />
            </Suspense>
          </ProviderPanelBoundary>
        </div>
      </section>
    </div>
  );
}
