import { useEffect, useState } from "react";
import { Bug, Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import type { DiagnosticsSnapshot } from "../../electron/diagnosticsTypes";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";

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
      if (active) setError("Could not read the error log.");
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
      setError("Could not copy the error log. Try again.");
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
      ? "No errors recorded in the last 7 days."
      : `${snapshot.entryCount} ${snapshot.entryCount === 1 ? "error" : "errors"} recorded in the last 7 days.`
    : error
      ? ""
      : "Reading the error log…";

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
            <h2 id="report-issue-title">Report an issue</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="app-modal-body">
          <p className="app-modal-copy">
            Issues are filed on GitHub. If something failed, copy the error log
            first and paste it into the issue. It holds recent errors and app
            details, with credentials, email addresses and local paths taken
            out, and it stays on this computer until you paste it.
          </p>
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
              {copied ? "Copied" : "Copy error log"}
            </button>
          </div>
          {snapshot && !snapshot.persistent ? (
            <p className="report-issue-error" role="status">
              The log could not be saved to disk, so it holds this session only.
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
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={openIssue}>
            Open issue on GitHub
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>
  );
}
