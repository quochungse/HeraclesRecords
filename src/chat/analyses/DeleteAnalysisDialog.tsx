import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import { t } from "../../i18n/core";

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
  api: HeraclesRecordsApi | undefined;
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
          <h3 id="delete-analysis-title">{t("chat.an.del.title", { name: analysisName })}</h3>
          <button
            type="button"
            className="icon-button"
            aria-label={t("common.close")}
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
            {t("chat.an.del.lead")}
          </p>

          <p className="chat-settings-copy">{t("chat.an.del.body", { name: analysisName })}</p>
        </div>

        <div className="coach-analysis-confirm-actions">
          <button
            type="button"
            className="chat-local-action"
            disabled={busy}
            onClick={onClose}
          >
            {t("common.cancel")}
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
            {t("chat.an.del.confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}
