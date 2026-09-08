import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, Loader2, Replace, UserRound, X } from "lucide-react";
import type {
  BackupImportCandidate,
  RestoreMode
} from "../../electron/backup/backupTypes";

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
          aria-label="This backup belongs to another account"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="app-modal-header">
            <div className="app-modal-title">
              <p className="eyebrow">
                Backup from {formatWhen(candidate.createdAt)}
              </p>
              <h2>This backup is another account's</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={onClose}
              disabled={busy}
            >
              <X size={18} strokeWidth={2} />
            </button>
          </header>

          <div className="app-modal-body">
            <p className="app-modal-copy backup-restore-lede">
              It was saved from a different COROS account than the one signed in
              here. Restoring it would put two people's records in one place,
              and nothing can separate them again — records carry no owner of
              their own.
            </p>
            <p className="app-modal-copy backup-restore-note">
              Continue only if this is your own other account, or a backup you
              made before switching accounts.
            </p>
          </div>

          <footer className="app-modal-footer">
            {busy ? (
              <span className="backup-restore-busy">
                <Loader2 size={15} strokeWidth={2} className="spin" />
                Restoring…
              </span>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
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
              {candidate.machineHasData ? "Continue anyway" : "Restore anyway"}
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
        aria-label="Restore this backup"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="app-modal-header">
          <div className="app-modal-title">
            <p className="eyebrow">Backup from {formatWhen(candidate.createdAt)}</p>
            <h2>This computer already has data</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="app-modal-body">
          <p className="app-modal-copy backup-restore-lede">
            Choose what happens to the {replace.totalExistingRows.toLocaleString()}{" "}
            records already on this computer.
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
                <strong>Override</strong>
                <span>
                  This computer ends up exactly as the backup describes it.
                  Writes {replace.rowsWriting.toLocaleString()} records
                  {replace.rowsRemoved > 0 || replace.settingsRemoved.length > 0
                    ? ` and permanently deletes ${replace.rowsRemoved.toLocaleString()} records${
                        replace.settingsRemoved.length > 0
                          ? ` and ${replace.settingsRemoved.length} settings`
                          : ""
                      } the backup does not have`
                    : ", and deletes nothing — the backup covers everything here"}
                  .
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
                <strong>Merge</strong>
                <span>
                  Keeps everything on this computer and adds what is missing.
                  Writes {merge.rowsWriting.toLocaleString()} new records;
                  anything already here keeps the copy it has, and nothing is
                  deleted.
                </span>
              </span>
            </button>
          </div>

          {/* Only ever non-empty for a backup written by a build that still
              carried credentials. Worth stating plainly rather than letting a
              restore look partial for no visible reason. */}
          {replace.refused.length > 0 ? (
            <p className="app-modal-copy backup-restore-note">
              {replace.refused.length} entries in this file are not restored —
              sign-ins stay on the machine that made them, either way.
            </p>
          ) : null}
        </div>

        <footer className="app-modal-footer">
          {busy ? (
            <span className="backup-restore-busy">
              <Loader2 size={15} strokeWidth={2} className="spin" />
              Restoring…
            </span>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
