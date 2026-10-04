import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, Loader2, Replace, UserRound, X } from "lucide-react";
import type {
  BackupImportCandidate,
  RestoreMode
} from "../../electron/backup/backupTypes";
import { getIntlLocale, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

function count(value: number): string {
  return value.toLocaleString(getIntlLocale());
}

export interface BackupRestoreModalProps {
  /** The file that was chosen, or null when no question is being asked. */
  candidate: BackupImportCandidate | null;
  busy: boolean;
  formatWhen: (iso: string) => string;
  onClose: () => void;
  onRestore: (mode: RestoreMode, allowOtherOwner: boolean) => void;
}

/**
 * What should happen to the data already on this machine.
 *
 * Asked only when there is data to lose — an empty machine restores without
 * being interrupted, because both answers would do exactly the same thing.
 *
 * Each option leads with what it does to what is already here, not with what
 * it does with the file. That is the part the person cannot undo, and the two
 * options are indistinguishable without it: "override" and "merge" are the
 * same sentence until you say what happens to the 214 conversations on this
 * laptop.
 *
 * Rendered through a portal, which is load-bearing rather than tidy. This lives
 * inside `BackupPanel`, and `.panel` carries a `backdrop-filter` — which makes
 * it the containing block for `position: fixed` descendants and starts a
 * stacking context of its own. Left in place the backdrop covers only the panel
 * and its `z-index` is compared against the panel's siblings rather than the
 * page, so the dialog opens *underneath* the layout. Every other dialog in the
 * app is either portalled or rendered above the panels for the same reason.
 */
export function BackupRestoreModal({
  candidate,
  busy,
  formatWhen,
  onClose,
  onRestore
}: BackupRestoreModalProps) {
  // A file belonging to another account is refused first, and only then does
  // the ordinary question get asked. Two steps rather than one screen with a
  // warning on it: "this is someone else's data" and "what should happen to
  // yours" are different decisions, and answering the second by reflex is
  // exactly what the first is there to prevent.
  useI18n();
  const [acknowledgedOwner, setAcknowledgedOwner] = useState(false);
  useEffect(() => {
    setAcknowledgedOwner(false);
  }, [candidate?.path]);

  useEffect(() => {
    if (!candidate) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [candidate, busy, onClose]);

  if (!candidate) return null;

  const { replace, merge } = candidate;
  const foreign = candidate.ownership === "other" && !acknowledgedOwner;

  if (foreign) {
    return createPortal(
      <div
        className="app-modal-backdrop"
        role="presentation"
        onClick={() => {
          if (!busy) onClose();
        }}
      >
        <div
          className="panel app-modal backup-restore-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t("backup.foreign.label")}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="app-modal-header">
            <div className="app-modal-title">
              <p className="eyebrow">
                {t("backup.from", { when: formatWhen(candidate.createdAt) })}
              </p>
              <h2>{t("backup.foreign.title")}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t("common.close")}
              onClick={onClose}
              disabled={busy}
            >
              <X size={18} strokeWidth={2} />
            </button>
          </header>

          <div className="app-modal-body">
            <p className="app-modal-copy backup-restore-lede">
              {t("backup.foreign.lede")}
            </p>
            <p className="app-modal-copy backup-restore-note">
              {t("backup.foreign.note")}
            </p>
          </div>

          <footer className="app-modal-footer">
            {busy ? (
              <span className="backup-restore-busy">
                <Loader2 size={15} strokeWidth={2} className="spin" />
                {t("backup.restoring")}
              </span>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="secondary-button danger-button"
              disabled={busy}
              onClick={() => {
                // With nothing here to lose there is no second question to
                // ask, so this is the whole confirmation and it restores.
                if (candidate.machineHasData) setAcknowledgedOwner(true);
                else onRestore("replace", true);
              }}
            >
              <UserRound size={15} strokeWidth={2} />
              {candidate.machineHasData
                ? t("backup.foreign.continue")
                : t("backup.foreign.restore")}
            </button>
          </footer>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      className="app-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="panel app-modal backup-restore-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("backup.choose.label")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="app-modal-header">
          <div className="app-modal-title">
            <p className="eyebrow">
              {t("backup.from", { when: formatWhen(candidate.createdAt) })}
            </p>
            <h2>{t("backup.choose.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="app-modal-body">
          <p className="app-modal-copy backup-restore-lede">
            {t("backup.choose.lede", { count: count(replace.totalExistingRows) })}
          </p>

          <div className="backup-restore-options">
            <button
              type="button"
              className="backup-restore-option is-destructive"
              onClick={() => onRestore("replace", acknowledgedOwner)}
              disabled={busy}
            >
              <span className="backup-restore-option-icon" aria-hidden="true">
                <Replace size={20} strokeWidth={1.9} />
              </span>
              <span className="backup-restore-option-copy">
                <strong>{t("backup.override.title")}</strong>
                <span>
                  {replace.settingsRemoved.length > 0
                    ? t("backup.override.detailDeletesSettings", {
                        count: count(replace.rowsWriting),
                        removed: count(replace.rowsRemoved),
                        settings: count(replace.settingsRemoved.length),
                      })
                    : replace.rowsRemoved > 0
                      ? t("backup.override.detailDeletes", {
                          count: count(replace.rowsWriting),
                          removed: count(replace.rowsRemoved),
                        })
                      : t("backup.override.detail", {
                          count: count(replace.rowsWriting),
                        })}
                </span>
              </span>
            </button>

            <button
              type="button"
              className="backup-restore-option"
              onClick={() => onRestore("merge", acknowledgedOwner)}
              disabled={busy}
            >
              <span className="backup-restore-option-icon" aria-hidden="true">
                <Layers size={20} strokeWidth={1.9} />
              </span>
              <span className="backup-restore-option-copy">
                <strong>{t("backup.merge.title")}</strong>
                <span>
                  {t("backup.merge.detail", { count: count(merge.rowsWriting) })}
                </span>
              </span>
            </button>
          </div>

          {/* Only ever non-empty for a backup written by a build that still
              carried credentials. Worth stating plainly rather than letting a
              restore look partial for no visible reason. */}
          {replace.refused.length > 0 ? (
            <p className="app-modal-copy backup-restore-note">
              {t("backup.refused", { count: count(replace.refused.length) })}
            </p>
          ) : null}
        </div>

        <footer className="app-modal-footer">
          {busy ? (
            <span className="backup-restore-busy">
              <Loader2 size={15} strokeWidth={2} className="spin" />
              {t("backup.restoring")}
            </span>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={busy}
          >
            {t("common.cancel")}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
