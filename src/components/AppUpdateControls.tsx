import { useEffect, useRef, useState } from "react";
import {
  Download,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { AppUpdateSnapshot } from "../../electron/types";

interface AppUpdateControlProps {
  snapshot: AppUpdateSnapshot;
  busy: boolean;
  downloading: boolean;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onPreferencesChange: (prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }) => void;
}

/**
 * The trigger has two looks. With nothing to install it is the plain grey
 * "Updates" button the top bar used to carry; once an update is in flight it
 * turns green and names the version, so the state is readable at a glance.
 */
function triggerContent(snapshot: AppUpdateSnapshot, busy: boolean) {
  if (snapshot.status === "downloading") {
    return {
      ready: true,
      icon: <Loader2 className="spin" size={15} aria-hidden="true" />,
      label: `Downloading ${Math.round(snapshot.downloadPercent ?? 0)}%`,
    };
  }

  if (
    (snapshot.status === "downloaded" || snapshot.status === "available") &&
    snapshot.availableVersion
  ) {
    return {
      ready: true,
      icon: <Sparkles size={15} aria-hidden="true" />,
      label: `Update ${snapshot.availableVersion}`,
    };
  }

  return {
    ready: false,
    icon:
      busy || snapshot.status === "checking" ? (
        <Loader2 className="spin" size={15} aria-hidden="true" />
      ) : (
        <Settings2 size={15} aria-hidden="true" />
      ),
    label: "Updates",
  };
}

/**
 * The app's single update surface, in Settings → App Info. The button reports
 * status and opens everything else: the pending action, the auto-update
 * preferences, and a manual check at the bottom. It is never disabled — an
 * unpackaged build still opens the popover, which explains why it can't update.
 */
export function AppUpdateControl({
  snapshot,
  busy,
  downloading,
  onCheck,
  onDownload,
  onInstall,
  onPreferencesChange,
}: AppUpdateControlProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const { ready, icon, label } = triggerContent(snapshot, busy);
  const pendingAction = snapshot.supported
    ? snapshot.status === "downloaded" && snapshot.availableVersion
      ? "install"
      : snapshot.status === "available" && !snapshot.autoDownload
        ? "download"
        : null
    : null;

  return (
    <div className="settings-update-menu" ref={containerRef}>
      <button
        className={
          ready
            ? "update-chip ready"
            : "update-settings-trigger update-settings-trigger--labeled"
        }
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          snapshot.status === "error"
            ? snapshot.error
            : `Heracles Records ${snapshot.currentVersion}`
        }
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span className="update-settings-trigger-label">{label}</span>
      </button>

      {open ? (
        <div className="update-settings-popover" role="menu">
          <p className="update-settings-heading">Updates</p>

          {snapshot.supported ? null : (
            <p className="update-settings-note">
              Auto-updates run in installed builds. Preferences below apply
              when you install Heracles Records.
            </p>
          )}

          {pendingAction ? (
            <div className="update-settings-actions">
              {pendingAction === "install" ? (
                <button
                  className="update-settings-action"
                  type="button"
                  onClick={() => {
                    onInstall();
                    setOpen(false);
                  }}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {snapshot.installMethod === "manual"
                    ? `Download ${snapshot.availableVersion}`
                    : "Restart to update"}
                </button>
              ) : (
                <button
                  className="update-settings-action"
                  type="button"
                  disabled={downloading}
                  onClick={() => {
                    onDownload();
                    setOpen(false);
                  }}
                >
                  {downloading ? (
                    <Loader2 className="spin" size={14} aria-hidden="true" />
                  ) : (
                    <Download size={14} aria-hidden="true" />
                  )}
                  {downloading
                    ? "Starting…"
                    : `Download ${snapshot.availableVersion}`}
                </button>
              )}
            </div>
          ) : null}

          <label className="update-settings-option">
            <input
              type="checkbox"
              checked={snapshot.autoCheck}
              onChange={(event) =>
                onPreferencesChange({ autoCheck: event.target.checked })
              }
            />
            <span>
              <span className="update-settings-option-label">
                Check automatically
              </span>
              <span className="update-settings-option-hint">
                Look for updates on startup.
              </span>
            </span>
          </label>
          <label className="update-settings-option">
            <input
              type="checkbox"
              checked={snapshot.autoDownload}
              onChange={(event) =>
                onPreferencesChange({ autoDownload: event.target.checked })
              }
            />
            <span>
              <span className="update-settings-option-label">
                Download automatically
              </span>
              <span className="update-settings-option-hint">
                Otherwise, download only when you ask.
              </span>
            </span>
          </label>

          <div className="update-settings-actions">
            <button
              className="update-settings-action"
              type="button"
              disabled={busy || snapshot.status === "checking"}
              onClick={() => {
                onCheck();
                setOpen(false);
              }}
            >
              {busy || snapshot.status === "checking" ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Check for updates
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
