import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  Download,
  Loader2,
  Upload
} from "lucide-react";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import type {
  BackupImportCandidate,
  RestoreMode
} from "../../electron/backup/backupTypes";
import {
  collectSyncableLocalStorage,
  mergeSyncedLocalStorage,
  replaceSyncedLocalStorage
} from "./syncLocalStorage";
import { BackupRestoreModal } from "./BackupRestoreModal";
import { formatBytes, formatWhen } from "./formatters";
import { getIntlLocale, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

function count(value: number): string {
  return value.toLocaleString(getIntlLocale());
}

interface BackupPanelProps {
  api: HeraclesRecordsApi;
}

/**
 * One file, saved wherever the person likes, opened when they want it back.
 *
 * Nothing is tracked between the two: no list of backups, no "latest", no
 * knowledge of where the last one went. That bookkeeping belonged to the vault,
 * which is sync's, and it existed to answer "which copy is current?" — a
 * question about a shared destination, not about a file someone owns.
 */
export function BackupPanel({ api }: BackupPanelProps) {
  useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<BackupImportCandidate | null>(null);

  // A restore or an export that resolves after the panel is gone must not write
  // its answer into state. The flag was here without the effect that clears it,
  // so every guard below read `true` for ever and the panel it was protecting
  // was already unmounted.
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  const run = useCallback(async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (cause) {
      if (liveRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        // Whatever dialog asked for this is now standing over the panel that is
        // trying to explain why it failed. Close it and let the note through.
        setCandidate(null);
      }
    } finally {
      if (liveRef.current) setBusy(null);
    }
  }, []);

  const exportBackup = () =>
    run("export", async () => {
      const result = await api.exportBackup(collectSyncableLocalStorage());
      // Null means the save dialog was dismissed, which is not worth a line.
      if (!result) return;
      setMessage(
        t("backup.saved", {
          records: count(result.rowCount),
          settings: count(result.settingCount),
          preferences: count(result.localStorageCount),
          path: result.path,
          size: formatBytes(result.bytes),
        })
      );
    });

  const applyRestore = useCallback(
    (path: string, mode: RestoreMode, allowOtherOwner = false) =>
      run("restore", async () => {
        const result = await api.restoreBackup(path, mode, allowOtherOwner);

        // The localStorage half follows the same rule as the rows: replace
        // clears the synced keys the backup does not have, merge only fills in
        // the ones this machine is missing. Only the renderer can see which
        // those are.
        const applied =
          mode === "replace"
            ? replaceSyncedLocalStorage(result.localStorage).applied
            : mergeSyncedLocalStorage(result.localStorage).applied;

        const figures = {
          records: count(result.rowsWritten),
          settings: count(result.settingsWritten),
          preferences: count(applied),
        };
        const restored =
          mode === "replace" &&
          (result.rowsRemoved > 0 || result.settingsRemoved > 0)
            ? t("backup.restoredRemoved", {
                ...figures,
                removedRecords: count(result.rowsRemoved),
                removedSettings: count(result.settingsRemoved),
              })
            : t("backup.restored", figures);

        setMessage(`${restored} ${t("backup.restartHint")}`);
        setCandidate(null);
      }),
    [api, run]
  );

  const chooseBackup = () =>
    run("choose", async () => {
      const chosen = await api.chooseBackupFile();
      if (!chosen) return;
      // A file from another account is always worth stopping for, even on a
      // machine with nothing to lose — what is at stake there is not this
      // machine's data but whose data it ends up holding.
      if (chosen.ownership === "other") {
        setCandidate(chosen);
        return;
      }
      // Nothing here to lose, so there is nothing to choose between: both
      // answers would do the same thing. Asking anyway would be a dialog whose
      // options are indistinguishable.
      if (!chosen.machineHasData) {
        await applyRestore(chosen.path, "replace");
        return;
      }
      setCandidate(chosen);
    });

  const working = busy !== null;

  return (
    <div className="panel settings-compact-panel settings-backup-panel" aria-busy={working}>
      {/* A secondary setting, laid out as one: title, one line of what it does,
          and the two actions beside it. The three stacked paragraphs and the
          pair of full-height rows this replaced said the same thing at four
          times the height, on a card most people open twice a year.
          Two of the caveats are kept because nothing else says them — the file
          is scrambled rather than encrypted, and it belongs to one COROS
          account — and the rest is left to the restore dialog, which is where
          the choice that needs them is actually made. */}
      <div className="settings-compact-head">
        <span className="settings-compact-icon" aria-hidden="true">
          <Archive size={18} strokeWidth={1.9} />
        </span>
        <div className="settings-compact-copy">
          <strong>{t("backup.title")}</strong>
          <span>{t("backup.description")}</span>
        </div>
        <div className="settings-compact-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={exportBackup}
            disabled={working}
          >
            {busy === "export" ? (
              <Loader2 size={14} strokeWidth={2} className="spin" />
            ) : (
              <Download size={14} strokeWidth={2} />
            )}
            {t("backup.save")}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={chooseBackup}
            disabled={working}
          >
            {busy === "choose" || busy === "restore" ? (
              <Loader2 size={14} strokeWidth={2} className="spin" />
            ) : (
              <Upload size={14} strokeWidth={2} />
            )}
            {t("backup.restore")}
          </button>
        </div>
      </div>

      {error ? (
        <p className="sync-panel-note is-error">
          <AlertTriangle size={14} strokeWidth={2} />
          {error}
        </p>
      ) : null}
      {message && !error ? (
        <p className="sync-panel-note">
          <Check size={14} strokeWidth={2} />
          {message}
        </p>
      ) : null}

      <BackupRestoreModal
        candidate={candidate}
        busy={busy === "restore"}
        formatWhen={formatWhen}
        onClose={() => setCandidate(null)}
        onRestore={(mode, allowOtherOwner) => {
          if (candidate) {
            void applyRestore(candidate.path, mode, allowOtherOwner);
          }
        }}
      />
    </div>
  );
}
