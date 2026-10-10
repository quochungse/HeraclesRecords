import { useEffect, useState } from "react";
import { Bug, Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import type { DiagnosticsSnapshot } from "../../electron/diagnosticsTypes";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

const NEW_ISSUE_URL = "https://github.com/quochungse/HeraclesRecords/issues/new";

/**
 * Settings → About → Report an issue: the main process's log of recent
 * failures, redacted before it was written, copied by hand into the issue the
 * second button opens. Nothing is uploaded. It replaced the Error logs
 * subpage, which was a row of its own for something only ever wanted while
 * reporting.
 */
export function ReportIssueDialog({
  api,
  open,
  onClose
}: {
  api: HeraclesRecordsApi;
  open: boolean;
  onClose: () => void;
}) {
  useI18n();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCopied(false);
    setError("");
    void api.getDiagnostics().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => {
      if (active) setError(t("report.readFailed"));
    });
    return () => {
      active = false;
    };
  }, [api, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function copyLog() {
    setCopying(true);
    setError("");
    try {
      setSnapshot(await api.copyDiagnostics());
      setCopied(true);
    } catch {
      setCopied(false);
      setError(t("report.copyFailed"));
    } finally {
      setCopying(false);
    }
  }

  function openIssue() {
    // Goes out through the window's open handler, which checks the address.
    window.open(NEW_ISSUE_URL, "_blank", "noreferrer");
    onClose();
  }

  const logLine = snapshot
    ? snapshot.entryCount === 0
      ? t("report.none")
      : plural("report.count", snapshot.entryCount)
    : error
      ? ""
      : t("report.reading");

  return (
    <div
      className="app-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-issue-title"
      onClick={onClose}
    >
      <section
        className="panel app-modal report-issue-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="app-modal-header">
          <div className="app-modal-title">
            <Bug size={16} aria-hidden="true" />
            <h2 id="report-issue-title">{t("report.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="app-modal-body">
          <p className="app-modal-copy">{t("report.body")}</p>
          <div className="report-issue-log">
            <span>{logLine}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyLog()}
              disabled={copying || !snapshot}
            >
              {copying ? (
                <Loader2 size={15} className="spin" aria-hidden="true" />
              ) : copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
              {copied ? t("report.copied") : t("report.copy")}
            </button>
          </div>
          {snapshot && !snapshot.persistent ? (
            <p className="report-issue-error" role="status">
              {t("report.notPersistent")}
            </p>
          ) : null}
          {error ? (
            <p className="report-issue-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="app-modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="primary-button" type="button" onClick={openIssue}>
            {t("report.open")}
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>
  );
}
