import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { DiagnosticsSnapshot } from "../../electron/diagnosticsTypes";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";

type DiagnosticsAction = "refresh" | "copy" | "clear";

/**
 * Settings → Error logs: the main process's log of recent failures, redacted
 * before it was written, copied by hand into an issue. Nothing is uploaded.
 * From upstream CorosLink 0.1.34, drawn as one of this screen's subpages.
 */
export function DiagnosticsSettings({ api }: { api: HeraclesRecordsApi }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState<DiagnosticsAction | null>("refresh");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void api.getDiagnostics().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => {
      if (active) setError("Could not load error logs. Try refreshing.");
    }).finally(() => {
      if (active) setBusy(null);
    });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function perform(action: DiagnosticsAction) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const next =
        action === "clear"
          ? await api.clearDiagnostics()
          : action === "copy"
            ? await api.copyDiagnostics()
            : await api.getDiagnostics();
      setSnapshot(next);
      if (action === "copy") {
        setNotice("Copied. Paste the report into your GitHub issue.");
      } else if (action === "clear") {
        setNotice("Error logs cleared.");
      }
    } catch {
      setError(
        action === "copy"
          ? "Could not copy the report. Open the preview below to select and copy it."
          : action === "clear"
            ? "Could not clear error logs. Try again."
            : "Could not refresh error logs. Try again."
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel settings-storage-detail-panel settings-diagnostics-panel">
      <div className="section-heading settings-storage-detail-heading">
        <div>
          <p className="eyebrow">Support</p>
          <h2>Error logs</h2>
          <p className="settings-subpage-description">
            Logs stay on this computer and nothing is uploaded. A report holds
            recent errors and app details, with credentials, email addresses
            and local paths taken out — copy one into an issue when something
            goes wrong.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void perform("copy")}
          disabled={busy !== null || !snapshot}
        >
          {busy === "copy" ? (
            <Loader2 size={15} className="spin" aria-hidden="true" />
          ) : notice.startsWith("Copied") ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}
          Copy error report
        </button>
      </div>

      <div className="settings-diagnostics-toolbar">
        <span>
          {snapshot
            ? `${snapshot.entryCount} ${snapshot.entryCount === 1 ? "error" : "errors"} recorded · last 7 days · up to 200`
            : "Loading error logs…"}
        </span>
        <div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void perform("refresh")}
            disabled={busy !== null}
          >
            <RefreshCw
              size={14}
              className={busy === "refresh" ? "spin" : ""}
              aria-hidden="true"
            />
            Refresh
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void perform("clear")}
            disabled={busy !== null || !snapshot?.entryCount}
          >
            <Trash2 size={14} aria-hidden="true" />
            Clear logs
          </button>
        </div>
      </div>

      {snapshot && !snapshot.persistent ? (
        <p className="settings-diagnostics-error" role="status">
          The log could not be saved to disk. Copy this report before closing
          the app.
        </p>
      ) : null}
      {snapshot ? (
        <details className="settings-diagnostics-preview">
          <summary>Preview report</summary>
          <textarea
            readOnly
            aria-label="Error report"
            value={snapshot.report}
            spellCheck={false}
          />
        </details>
      ) : null}
      {error ? (
        <p className="settings-diagnostics-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="settings-diagnostics-notice" role="status">
        {notice}
      </p>
    </div>
  );
}
