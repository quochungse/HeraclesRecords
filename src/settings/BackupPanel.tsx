import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  Download,
  Loader2,
  Upload
} from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
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

interface BackupPanelProps {
  api: CorosLinkApi;
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
        `Saved ${result.rowCount.toLocaleString()} records, ` +
          `${result.settingCount} settings and ${result.localStorageCount} view ` +
          `preferences to ${result.path} (${formatBytes(result.bytes)}).`
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

        const wrote =
          `Restored ${result.rowsWritten.toLocaleString()} records, ` +
          `${result.settingsWritten} settings and ${applied} view preferences`;
        const cleared =
          mode === "replace" &&
          (result.rowsRemoved > 0 || result.settingsRemoved > 0)
            ? `; removed ${result.rowsRemoved.toLocaleString()} records and ` +
              `${result.settingsRemoved} settings this backup does not have`
            : "";

        setMessage(`${wrote}${cleared}. Restart to see everything.`);
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
    <div
      className="panel settings-connections-panel settings-backup-panel"
      aria-busy={working}
    >
      <div className="settings-connections-heading">
        <span className="settings-connections-icon" aria-hidden="true">
          <Archive size={22} strokeWidth={1.9} />
        </span>
        <div>
          <p className="eyebrow">A file you keep</p>
          <h2>Backup &amp; Restore</h2>
          <p>
            Save everything you have written — conversations, plans, routes,
            preferences — to a single file you choose the home of, and read it
            back whenever you need it. A backup belongs to the COROS account
            that made it and will not restore into another one. Sign-ins are
            never in it, so restoring never costs you an account.
          </p>
        </div>
      </div>

      <div className="settings-connections-list">
        <div className="settings-nav-row is-static">
          <span className="settings-nav-row-icon" aria-hidden="true">
            {busy === "export" ? (
              <Loader2 size={22} strokeWidth={1.9} className="spin" />
            ) : (
              <Download size={22} strokeWidth={1.9} />
            )}
          </span>
          <span className="settings-nav-row-copy">
            <strong>Save a backup</strong>
            <span>
              Writes one file. Its contents are scrambled, so a preview, a
              search index or a glance at the folder shows nothing — but the key
              ships inside the app, so this is not encryption: anyone with
              Heracles Records can open it. Keep it where you would keep a
              diary.
            </span>
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={exportBackup}
            disabled={working}
          >
            {busy === "export" ? (
              <Loader2 size={15} strokeWidth={2} className="spin" />
            ) : null}
            Save backup…
          </button>
        </div>

        <div className="settings-nav-row is-static">
          <span className="settings-nav-row-icon" aria-hidden="true">
            {busy === "choose" || busy === "restore" ? (
              <Loader2 size={22} strokeWidth={1.9} className="spin" />
            ) : (
              <Upload size={22} strokeWidth={1.9} />
            )}
          </span>
          <span className="settings-nav-row-copy">
            <strong>Restore from a backup</strong>
            <span>
              Pick a file you saved earlier — including one from an older
              version. If this computer already has data, you will be asked
              whether to override it or merge.
            </span>
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={chooseBackup}
            disabled={working}
          >
            {busy === "choose" ? (
              <Loader2 size={15} strokeWidth={2} className="spin" />
            ) : null}
            Choose file…
          </button>
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
      </div>

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
