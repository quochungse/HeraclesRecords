import { useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { AppUpdateSnapshot } from "../../electron/types";
import { t } from "../i18n/core";
import { UpdateGlyph } from "./UpdateGlyph";

const DISMISSED_UPDATE_VERSION_KEY =
  "heraclesrecords.updatePrompt.dismissedVersion";

interface UpdateAvailablePromptProps {
  snapshot: AppUpdateSnapshot;
  onAccept: (version: string) => void;
  onDecline?: (version: string) => void;
  /** Forces a fresh, non-persistent preview whenever this value changes. */
  previewKey?: number;
}

function readDismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY);
  } catch {
    return null;
  }
}

function rememberDismissedVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version);
  } catch {
    // The in-memory guard still prevents the prompt from repeating this run.
  }
}

function canPromptForUpdate(snapshot: AppUpdateSnapshot): boolean {
  return (
    snapshot.supported &&
    Boolean(snapshot.availableVersion) &&
    (snapshot.status === "available" ||
      snapshot.status === "downloading" ||
      snapshot.status === "downloaded")
  );
}

export function UpdateAvailablePrompt({
  snapshot,
  onAccept,
  onDecline,
  previewKey,
}: UpdateAvailablePromptProps) {
  const [visibleVersion, setVisibleVersion] = useState<string | null>(null);
  const promptedVersions = useRef(new Set<string>());
  const handledPreviewKey = useRef<number | undefined>(undefined);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (visibleVersion) {
      dialogRef.current?.focus();
    }
  }, [visibleVersion]);

  useEffect(() => {
    if (!canPromptForUpdate(snapshot) || !snapshot.availableVersion) {
      return;
    }

    const version = snapshot.availableVersion;
    if (
      previewKey !== undefined &&
      handledPreviewKey.current !== previewKey
    ) {
      handledPreviewKey.current = previewKey;
      promptedVersions.current.add(version);
      setVisibleVersion(version);
      return;
    }

    if (promptedVersions.current.has(version)) {
      return;
    }

    promptedVersions.current.add(version);
    if (readDismissedVersion() !== version) {
      setVisibleVersion(version);
    }
  }, [
    previewKey,
    snapshot.availableVersion,
    snapshot.status,
    snapshot.supported,
  ]);

  useEffect(() => {
    if (!visibleVersion) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (previewKey === undefined) {
          rememberDismissedVersion(visibleVersion);
        }
        setVisibleVersion(null);
        onDecline?.(visibleVersion);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDecline, previewKey, visibleVersion]);

  if (!visibleVersion) {
    return null;
  }

  const releaseNotes = snapshot.releaseNotes?.trim();
  const isDownloaded = snapshot.status === "downloaded";
  const isManualInstall =
    isDownloaded && snapshot.installMethod === "manual";
  const actionLabel = isManualInstall
    ? t("app.update.openDownload")
    : isDownloaded
      ? t("app.update.restartAndUpdate")
      : t("app.update.now");
  const progress = Math.round(snapshot.downloadPercent ?? 0);
  const statusText =
    snapshot.status === "downloading"
      ? t("app.update.downloadingRestart", { percent: progress })
      : isManualInstall
        ? t("app.update.installerInBrowser")
        : isDownloaded
          ? t("app.update.downloaded")
          : t("app.update.willDownload");

  const decline = () => {
    if (previewKey === undefined) {
      rememberDismissedVersion(visibleVersion);
    }
    setVisibleVersion(null);
    onDecline?.(visibleVersion);
  };

  const accept = () => {
    const version = visibleVersion;
    setVisibleVersion(null);
    onAccept(version);
  };

  return (
    <div className="update-prompt-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="update-prompt"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="update-prompt-title"
        aria-describedby="update-prompt-description"
      >
        <header className="update-prompt-header">
          <span className="update-prompt-icon" aria-hidden="true">
            <Sparkles size={22} />
          </span>
          <div>
            <p className="update-prompt-eyebrow">{t("app.update.available")}</p>
            <h2 id="update-prompt-title">Heracles Records {visibleVersion}</h2>
            <p id="update-prompt-description">
              {t("app.update.sinceVersion", { version: snapshot.currentVersion })}
            </p>
          </div>
        </header>

        <div className="update-prompt-changelog" tabIndex={0}>
          {releaseNotes ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeSanitize]}
              components={{
                a: ({ children, ...props }) => (
                  <a {...props} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {releaseNotes}
            </ReactMarkdown>
          ) : (
            <p>
              {t("app.update.genericNotes")}
            </p>
          )}
        </div>

        <footer className="update-prompt-footer">
          <p>{statusText}</p>
          <div className="update-prompt-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={decline}
            >
              {t("app.update.notNow")}
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={accept}
            >
              {isDownloaded ? (
                <Sparkles size={16} aria-hidden="true" />
              ) : (
                <Download size={16} aria-hidden="true" />
              )}
              {actionLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

interface UpdateRestartPromptProps {
  snapshot: AppUpdateSnapshot;
  /** `process.platform` from the bridge, for the one sentence that differs. */
  platform: string | undefined;
  onRestart: () => void;
  onLater: () => void;
}

/**
 * Asked once an accepted update is on disk. The app used to quit the moment
 * the download finished — mid-sentence, with an unsaved edit on screen — and on
 * Windows the NSIS wizard then opened over a closed app. Now the download runs
 * in the background and this asks; Restart is the only thing that closes the
 * app. On Linux it also stays up through the install, which runs in the
 * running app and ends in the relaunch.
 */
export function UpdateRestartPrompt({
  snapshot,
  platform,
  onRestart,
  onLater,
}: UpdateRestartPromptProps) {
  const installing = snapshot.status === "installing";
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    if (installing) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onLater();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [installing, onLater]);

  const version = snapshot.availableVersion ?? "";
  const manual = snapshot.installMethod === "manual";
  const failed = snapshot.installFailure === "failed";
  const body = installing
    ? t("app.update.installingBody", { version })
    : manual
      ? t("app.update.installerInBrowser")
      : t("app.update.readyBody", { version });
  const note =
    installing || manual || failed
      ? null
      : snapshot.installNeedsPassword
        ? t("app.update.passwordNote")
        : platform === "win32"
          ? t("app.update.windowsNote")
          : null;
  const failure =
    !installing && snapshot.installFailure === "cancelled"
      ? t("app.update.installCancelled")
      : !installing && failed
        ? t("app.update.installFailed")
        : null;

  return (
    <div className="update-prompt-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="update-prompt update-prompt--compact"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="update-restart-title"
        aria-describedby="update-restart-description"
        aria-busy={installing}
      >
        <header className="update-prompt-header">
          <span className="update-prompt-icon" aria-hidden="true">
            <UpdateGlyph size={22} active={installing} />
          </span>
          <div>
            <p className="update-prompt-eyebrow">
              {installing ? t("app.update.installingTitle") : t("app.update.readyTitle")}
            </p>
            <h2 id="update-restart-title">Heracles Records {version}</h2>
          </div>
        </header>

        <div className="update-prompt-body" id="update-restart-description">
          <p>{body}</p>
          {note ? <p className="update-prompt-note">{note}</p> : null}
          {failure ? (
            <p className="update-prompt-failure" role="alert">
              {failure}
            </p>
          ) : null}
        </div>

        <footer className="update-prompt-footer">
          <div className="update-prompt-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={installing}
              onClick={onLater}
            >
              {t("app.update.notNow")}
            </button>
            {failed && snapshot.manualInstallUrl ? (
              <a
                className="primary-button"
                href={snapshot.manualInstallUrl}
                target="_blank"
                rel="noreferrer"
                onClick={onLater}
              >
                <Download size={16} aria-hidden="true" />
                {t("app.update.openDownload")}
              </a>
            ) : (
              <button
                className="primary-button"
                type="button"
                disabled={installing}
                onClick={onRestart}
              >
                {installing ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : manual ? (
                  <Download size={16} aria-hidden="true" />
                ) : (
                  <RotateCw size={16} aria-hidden="true" />
                )}
                {manual ? t("app.update.openDownload") : t("app.update.restartNow")}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
