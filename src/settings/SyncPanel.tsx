import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudUpload,
  HardDrive,
  Loader2,
  RefreshCw,
  UserRound
} from "lucide-react";
import { OptionGroup } from "../components/OptionGroup";
import type { CorosLinkApi } from "../coroslink-api";
import type {
  GoogleAccountInfo,
  SyncBackend,
  SyncStatus
} from "../../electron/sync/syncTypes";
import { formatBytes, formatWhen } from "./formatters";

interface SyncPanelProps {
  api: CorosLinkApi;
}

/**
 * The last answer this window got, kept outside the component.
 *
 * Settings is unmounted every time the athlete leaves it, so the panel used to
 * come back with `status === null` and render a "Loading sync status…" line in
 * place of the whole card — the rows below it jumped, the card resized, and the
 * same numbers reappeared a round trip later. The status is the same on remount
 * as it was on unmount in every case that matters, so it is painted straight
 * away and the refresh that follows only corrects it. A stale destination shown
 * for one round trip is a far smaller lie than a card that empties itself.
 *
 * Module scope, not a ref: a ref dies with the component, which is exactly the
 * moment being covered here.
 */
let cachedStatus: SyncStatus | null = null;
let cachedAccount: GoogleAccountInfo | null = null;

const BACKENDS: ReadonlyArray<{
  readonly value: SyncBackend;
  readonly label: string;
  readonly Icon: typeof HardDrive;
}> = [
  { value: "local", label: "Local", Icon: HardDrive },
  { value: "google", label: "Google Drive", Icon: Cloud }
];

/** How long a read may be out before the corner chip says so. */
const REFRESH_NOTICE_DELAY_MS = 400;

const SYNC_DESCRIPTION =
  "Keeps your conversations, plans and preferences the same on every computer " +
  "signed in to the same COROS account. Sign-ins never leave this machine.";

/**
 * Where this machine's data meets the other one's.
 *
 * Only the destination and the state of the connection. Backups are a separate
 * panel and a separate idea — a file the person saves somewhere of their own —
 * and the two lived here together for as long as a backup was a copy inside
 * this vault. It no longer is.
 */
export function SyncPanel({ api }: SyncPanelProps) {
  const [status, setStatus] = useState<SyncStatus | null>(() => cachedStatus);
  const [busy, setBusy] = useState<string | null>(null);
  // True only once a read has been out long enough to be worth mentioning. A
  // local status answers in a few milliseconds, and while a seed is publishing
  // this panel re-reads every three seconds — flagged immediately, the corner
  // chip would blink on every one of those and say nothing.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Set the instant the switch is clicked and cleared when the refresh that
  // follows lands. Everything that renders the destination reads this first, so
  // the chip moves under the cursor instead of after the round trip.
  const [pendingBackend, setPendingBackend] = useState<SyncBackend | null>(null);
  // Fetched on its own schedule, never inside `refresh`. It is one Drive round
  // trip and the panel does not need it to render, so making the rows wait for
  // it would trade a working panel for a decorated one.
  const [account, setAccount] = useState<GoogleAccountInfo | null>(
    () => cachedAccount
  );

  // A refresh that resolves after the component is gone, or after a newer one
  // already landed, must not write its stale answer into state. Switching
  // backends fires exactly that race.
  const liveRef = useRef(true);
  const refreshSeq = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      if (liveRef.current && seq === refreshSeq.current) setRefreshing(true);
    }, REFRESH_NOTICE_DELAY_MS);
    try {
      const next = await api.getSyncStatus();
      // Written outside the liveness guard on purpose: a reply that lands after
      // the panel is gone is still the freshest answer, and the next mount is
      // the one that wants it.
      cachedStatus = next;
      if (!liveRef.current || seq !== refreshSeq.current) return;
      setStatus(next);
    } catch (cause) {
      if (!liveRef.current || seq !== refreshSeq.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (seq === refreshSeq.current && refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      if (liveRef.current && seq === refreshSeq.current) setRefreshing(false);
    }
  }, [api]);

  // Inbound changes arrive on their own schedule, not in reply to anything the
  // user did here. Only the notice belongs to this panel: applying the
  // localStorage half is App's, because the main process drains that queue as
  // it sends and this panel is on screen for almost none of the time a pull
  // can land.
  useEffect(() => {
    return api.onSyncChanged((change) => {
      // No longer "restart to see everything": a pull now names the tables it
      // wrote, and a screen that subscribes re-reads its own as the change
      // lands. Not every screen does yet, so the second half stays honest
      // rather than promising more than the app does.
      setMessage(
        `Synced from another device: ${change.applied} records updated` +
          (change.deleted > 0 ? `, ${change.deleted} removed` : "") +
          ". Some screens catch up on their own; restart if one looks stale."
      );
      void refresh();
    });
  }, [api, refresh]);

  useEffect(() => {
    // Read before preparing, but only when there is nothing on screen yet.
    // `prepareSyncVault` probes the destination, which is the slow half, and
    // nothing it can answer changes what the status already says — so on a cold
    // mount the early read is what fills the panel, and on a warm one the cache
    // has already filled it and the read would just be a second round trip.
    const cold = cachedStatus === null;
    void (async () => {
      if (cold) await refresh();
      // The main process does this at launch too. This covers a destination
      // chosen after that, and costs one probe of the destination otherwise.
      try {
        await api.prepareSyncVault();
      } catch (cause) {
        // Almost always a folder that cannot be reached. Worth showing
        // verbatim: "EACCES" says far more than "setup failed".
        if (liveRef.current) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      await refresh();
    })();
  }, [api, refresh]);

  // The loop moves on its own schedule, so the panel has to look. Only while
  // something is actually in flight — a seed sending, or changes queued that
  // have not gone yet — because the rest of the time this row does not change
  // between one refresh and the next.
  const loop = status?.loop ?? null;
  const inFlight =
    loop !== null &&
    (loop.seed.state === "publishing" || loop.pendingChanges > 0);
  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [inFlight, refresh]);

  // Keyed on the connection, so reconnecting as someone else re-reads it. The
  // main process caches the answer, so a re-render costs nothing.
  const googleConnected = status?.googleConnected ?? false;
  useEffect(() => {
    if (!googleConnected) {
      cachedAccount = null;
      setAccount(null);
      return;
    }
    let current = true;
    void api
      .googleDriveAccount()
      .then((info) => {
        cachedAccount = info;
        if (current) setAccount(info);
      })
      .catch(() => {
        // Decoration. The row says "Connected" without it, and a cached address
        // from a moment ago beats blanking the line.
        if (current) setAccount(cachedAccount);
      });
    return () => {
      current = false;
    };
  }, [api, googleConnected]);

  const run = useCallback(
    async (label: string, work: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      setMessage(null);
      try {
        await work();
      } catch (cause) {
        if (liveRef.current) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        await refresh();
        if (liveRef.current) setBusy(null);
      }
    },
    [refresh]
  );

  const chooseFolder = () =>
    run("folder", async () => {
      const folder = await api.chooseSyncFolder();
      if (folder) setMessage(`Vault folder set to ${folder}`);
    });

  const retryPrepare = () =>
    run("prepare", async () => {
      await api.prepareSyncVault();
    });

  const switchBackend = (backend: SyncBackend) => {
    setPendingBackend(backend);
    // Cleared only once `run` has finished, which includes its refresh — so the
    // optimistic value is dropped after the real status has caught up rather
    // than before it, and the chip never flickers back through the old value.
    // On failure the refresh leaves the old backend in place and the chip
    // returns to it, which is the correct answer too.
    void run("backend", () => api.setSyncBackend(backend)).finally(() => {
      if (liveRef.current) setPendingBackend(null);
    });
  };

  const claimVault = () =>
    run("claim", async () => {
      await api.claimSyncVault();
      setMessage(
        "This vault now belongs to your account. Everything on this computer " +
          "is being published into it."
      );
    });

  // The same head either way, so the placeholder and the panel cannot drift
  // apart — and so the card keeps its shape while the first read is out.
  const head = (
    <div className="settings-section-head">
      <span className="settings-section-icon" aria-hidden="true">
        <RefreshCw size={18} strokeWidth={1.9} />
      </span>
      <div>
        <h2>Sync</h2>
        <p>{SYNC_DESCRIPTION}</p>
      </div>
      {/* The corner tell. A refresh that has something to correct leaves what
          is on screen exactly where it is and says so here instead — the panel
          emptying itself is what used to make this card jump on every visit to
          Settings. */}
      {refreshing ? (
        <span className="sync-heading-refreshing" title="Checking sync status…">
          <Loader2 size={14} strokeWidth={2} className="spin" />
          Checking…
        </span>
      ) : null}
    </div>
  );

  if (!status) {
    // Only reachable on the very first read of a launch — after that the cached
    // status carries the panel through every remount. `error` is rendered here
    // too: when getSyncStatus fails there is no status to build the panel from,
    // and returning only a spinner would leave the panel saying "loading"
    // forever with the reason invisible.
    return (
      <div className="panel settings-connections-panel settings-sync-panel">
        {head}
        <p className="sync-panel-loading">
          {error ?? (
            <>
              <Loader2 size={15} strokeWidth={2} className="spin" />
              Loading sync status…
            </>
          )}
        </p>
      </div>
    );
  }

  // What the panel draws. During a switch this leads the server by one round
  // trip on purpose; `switching` is what keeps the rows below honest about it.
  const backend = pendingBackend ?? status.backend;
  const switching = pendingBackend !== null;

  const seed = status.loop?.seed ?? null;

  // What the loop has actually been doing, rather than a promise about what it
  // will do. The row used to say "changes go out within a minute or so", which
  // is true and unfalsifiable — it reads the same whether sync has been working
  // for a week or has never once succeeded.
  const activity = !status.loop
    ? "The change loop is not running."
    : [
        status.loop.lastPulledAt
          ? `Last received ${formatWhen(status.loop.lastPulledAt)}`
          : "Nothing received from another computer yet",
        status.loop.pendingChanges > 0
          ? `${status.loop.pendingChanges} change${
              status.loop.pendingChanges === 1 ? "" : "s"
            } waiting to go out`
          : null
      ]
        .filter(Boolean)
        .join(" · ");

  // Drive's usage line, when the account call has landed. Decoration: the row
  // below names the account without it.
  const googleQuota = account?.quota
    ? account.quota.limit === null
      ? `${formatBytes(account.quota.used)} used`
      : `${formatBytes(account.quota.used)} of ${formatBytes(account.quota.limit)} used`
    : null;

  // The line under the switch: the concrete place, and the button that changes
  // it. Mid-switch it says what is happening instead of naming a destination —
  // the old one is no longer the answer and the new one is not confirmed yet.
  const destinationDetail = switching
    ? "Checking that the destination answers…"
    : backend === "google"
      ? status.googleConnected
        ? [account?.email, account?.name, googleQuota]
            .filter(Boolean)
            .join(" · ") || "Connected."
        : "No Google account connected yet."
      : (status.folder ?? "No folder chosen yet.");

  // What kind of place this backend is — and only while the question is still
  // open. Once a destination is set, the row's second line is the destination
  // itself, which is the answer; a paragraph explaining what kind of place it
  // is sat above that answer for the life of the install, saying the same thing
  // every time. Mid-switch it stays, because nothing is settled yet.
  const destinationSettled =
    !switching &&
    (backend === "google" ? status.googleConnected : Boolean(status.folder));
  const destinationHint = destinationSettled
    ? null
    : backend === "google"
      ? status.googleConnected || switching
        ? "Your Google Drive, in a folder this app creates and can only see its own files in."
        : "Connecting opens your browser to Google — consent happens there, never inside the app."
      : "A folder on this computer. One kept in sync by Dropbox or Drive Desktop works too, though two machines may then run the same scheduled analysis — connecting Google Drive directly avoids that.";

  return (
    <div
      className="panel settings-connections-panel settings-sync-panel"
      aria-busy={busy !== null}
    >
      {head}

      <div className="settings-connections-list">
        {/* One row answers one question. The switch picks the kind of place,
            the line under it names the actual one and carries the button that
            changes it. */}
        <div
          className={`settings-nav-row is-static sync-row-stacked${
            switching ? " sync-row-pending" : ""
          }`}
        >
          <span className="settings-nav-row-icon" aria-hidden="true">
            {switching ? (
              <Loader2 size={20} strokeWidth={1.9} className="spin" />
            ) : backend === "google" ? (
              <Cloud size={20} strokeWidth={1.9} />
            ) : (
              <HardDrive size={20} strokeWidth={1.9} />
            )}
          </span>
          <span className="settings-nav-row-copy">
            <strong>Where this machine syncs</strong>
            {destinationHint ? <span>{destinationHint}</span> : null}
          </span>
          {/* Only the switch is held during a switch, and the already-selected
              side stays clickable-looking rather than greyed: a disabled
              control is how this row used to read as broken. A build with no
              OAuth client is the one real block — it cannot offer Drive at
              all. */}
          <OptionGroup
            label="Where this machine syncs"
            className="sync-backend-switch"
            value={backend}
            options={BACKENDS.map(({ value, label, Icon }) => ({
              value,
              label,
              disabled:
                busy === "backend" ||
                (value === "google" && !status.googleClientConfigured),
              ...(value === "google" && !status.googleClientConfigured
                ? {
                    title:
                      "This build ships no Google OAuth client, so Drive cannot be offered."
                  }
                : {}),
              icon:
                backend === value && busy === "backend" ? (
                  <Loader2 size={14} strokeWidth={2} className="spin" />
                ) : (
                  <Icon size={14} strokeWidth={2} />
                )
            }))}
            onChange={(next) => {
              if (next !== backend) switchBackend(next);
            }}
          />

          <span className="sync-row-footer">
            <span className="sync-destination-detail">{destinationDetail}</span>
            {/* Withheld mid-switch on purpose: it would act on the destination
                being left, not the one being moved to. */}
            {switching ? null : backend === "google" ? (
              <button
                type="button"
                className={
                  status.googleConnected
                    ? "secondary-button danger-button"
                    : "primary-button"
                }
                disabled={busy === "google"}
                onClick={() =>
                  void run("google", () =>
                    status.googleConnected
                      ? api.disconnectGoogleDrive()
                      : api.connectGoogleDrive()
                  )
                }
              >
                {busy === "google" ? (
                  <Loader2 size={15} strokeWidth={2} className="spin" />
                ) : null}
                {status.googleConnected ? "Disconnect" : "Connect"}
              </button>
            ) : (
              <button
                type="button"
                className={status.folder ? "secondary-button" : "primary-button"}
                onClick={chooseFolder}
                disabled={busy === "folder"}
              >
                {busy === "folder" ? (
                  <Loader2 size={15} strokeWidth={2} className="spin" />
                ) : null}
                {status.folder ? "Change" : "Choose"}
              </button>
            )}
          </span>
        </div>

        {/* Before anything about the destination. Sync merges two machines'
            records into one log, and the tables have no owner column — so
            whose data it is has to be settled first, and choosing a folder
            before that would be work the app then refuses to use. */}
        {status.state === "signed-out" ? (
          <div className="settings-nav-row is-static sync-row-alert">
            <span className="settings-nav-row-icon" aria-hidden="true">
              <UserRound size={20} strokeWidth={1.9} />
            </span>
            <span className="settings-nav-row-copy">
              <strong>Sign in to COROS to sync</strong>
              <span>
                Syncing needs to know whose records it is merging. Sign in under
                Connections — sync starts on its own.
              </span>
            </span>
          </div>
        ) : null}

        {status.state === "wrong-owner" ? (
          <div className="settings-nav-row is-static sync-row-alert sync-row-stacked">
            <span className="settings-nav-row-icon" aria-hidden="true">
              <UserRound size={20} strokeWidth={1.9} />
            </span>
            <span className="settings-nav-row-copy">
              <strong>This vault holds another account's data</strong>
              <span>
                Nothing is being sent or received. Two accounts' records merged
                into one log cannot be separated again — there is no owner on
                each record to sort them by — so this is left alone until you
                say what it is.
              </span>
            </span>
            <span className="sync-row-footer">
              <span className="sync-destination-detail">
                If this is your own second COROS account, or a vault you made
                before switching accounts, you can take it over. Everything on
                this computer is then published into it.
              </span>
              <button
                type="button"
                className="secondary-button danger-button"
                onClick={claimVault}
                disabled={busy === "claim"}
              >
                {busy === "claim" ? (
                  <Loader2 size={15} strokeWidth={2} className="spin" />
                ) : null}
                Use this vault
              </button>
            </span>
          </div>
        ) : null}

        {status.state === "unreachable" && !switching ? (
          <div className="settings-nav-row is-static sync-row-alert">
            <span className="settings-nav-row-icon" aria-hidden="true">
              <AlertTriangle size={20} strokeWidth={1.9} />
            </span>
            <span className="settings-nav-row-copy">
              <strong>That destination did not answer</strong>
              <span>
                {status.backend === "google"
                  ? "Your Drive could not be read. Disconnecting and connecting the account again is the usual fix."
                  : `${status.folder} could not be read. Check that the folder still exists and that you can reach it — a drive that was unplugged or a share that went offline is the usual reason.`}
              </span>
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={retryPrepare}
              disabled={busy === "prepare"}
            >
              {busy === "prepare" ? (
                <Loader2 size={15} strokeWidth={2} className="spin" />
              ) : null}
              Try again
            </button>
          </div>
        ) : null}

        {/* The one-off publish of everything this machine already had. Only
            worth a row of its own while it is happening or when it failed:
            done is the normal state and says nothing useful. A failure here is
            the quiet one — the vault is reachable, the loop is running, and
            months of history simply never left. */}
        {seed && seed.state !== "done" ? (
          <div
            className={`settings-nav-row is-static${
              seed.state === "failed" ? " sync-row-alert" : ""
            }`}
          >
            <span className="settings-nav-row-icon" aria-hidden="true">
              {seed.state === "failed" ? (
                <AlertTriangle size={20} strokeWidth={1.9} />
              ) : (
                <Loader2 size={20} strokeWidth={1.9} className="spin" />
              )}
            </span>
            <span className="settings-nav-row-copy">
              <strong>
                {seed.state === "failed"
                  ? "This computer's existing data has not been sent"
                  : "Sending this computer's existing data…"}
              </strong>
              <span>
                {seed.state === "failed"
                  ? `${seed.error ?? "The publish did not finish."} Until it succeeds, anything created before sync was switched on stays on this computer. "Sync now" tries again.`
                  : "Everything from before sync was switched on is going up once. New changes go out as you make them."}
              </span>
            </span>
          </div>
        ) : null}

        {status.state === "ready" && !switching ? (
          <div className="settings-nav-row is-static">
            <span className="settings-nav-row-icon" aria-hidden="true">
              {busy === "syncnow" ? (
                <Loader2 size={20} strokeWidth={1.9} className="spin" />
              ) : (
                <CloudUpload size={20} strokeWidth={1.9} />
              )}
            </span>
            <span className="settings-nav-row-copy">
              <strong>Sync now</strong>
              <span>{activity}</span>
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void run("syncnow", async () => {
                  const result = await api.syncNow();
                  setMessage(
                    `Pushed ${result.pushed} changes, received ${result.applied}.`
                  );
                })
              }
              disabled={busy === "syncnow"}
            >
              {busy === "syncnow" ? (
                <Loader2 size={15} strokeWidth={2} className="spin" />
              ) : null}
              Sync now
            </button>
          </div>
        ) : null}

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
    </div>
  );
}
