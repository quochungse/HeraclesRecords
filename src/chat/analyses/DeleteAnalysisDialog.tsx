import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";

/**
 * Deleting an analysis. The conversation survives — it is the athlete's chat
 * history, not the analysis's — and so does everything the analysis already
 * wrote in it.
 *
 * There used to be a list of places to lose here, because a definition could
 * be attached to several. An analysis lives in one conversation now, so the
 * only thing worth saying is what is *not* lost.
 */
export function DeleteAnalysisDialog({
  api,
  analysisId,
  analysisName,
  onClose,
  onDeleted
}: {
  api: CorosLinkApi | undefined;
  analysisId: string;
  analysisName: string;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  const remove = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteCoachAnalysis(analysisId);
      await onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <div
      className="coach-analysis-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-analysis-title"
      onClick={busy ? undefined : onClose}
    >
      <section
        className="panel coach-analysis-dialog coach-analysis-confirm"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="coach-analysis-dialog-header">
          <h3 id="delete-analysis-title">Delete “{analysisName}”?</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {error ? <p className="coach-analysis-error">{error}</p> : null}

        <div className="coach-analysis-dialog-body">
          <p className="coach-analysis-confirm-lead">
            <AlertTriangle size={15} aria-hidden="true" />
            This cannot be undone.
          </p>

          <p className="chat-settings-copy">
            The conversation is kept, along with everything {analysisName} has
            already written in it. Only the analysis and its schedule go.
          </p>
        </div>

        <div className="coach-analysis-confirm-actions">
          <button
            type="button"
            className="chat-local-action"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="chat-local-action is-danger"
            disabled={busy || !api}
            onClick={() => void remove()}
          >
            {busy ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : null}
            Delete analysis
          </button>
        </div>
      </section>
    </div>
  );
}
