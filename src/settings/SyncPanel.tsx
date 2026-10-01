import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  CloudUpload,
  Loader2,
  RefreshCw,
  UserRound
} from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { GoogleAccountInfo, SyncStatus } from "../../electron/sync/syncTypes";
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

/** How long a read may be out before the corner chip says so. */
const REFRESH_NOTICE_DELAY_MS = 400;

const SYNC_DESCRIPTION =
  "Keeps your conversations, plans and preferences the same on every computer " +
  "signed in to the same COROS account, through your Google Drive. Sign-ins " +
  "never leave this machine.";

/**
 * Where this machine's data meets the other one's.
 *
 * Two rows when all is well: the Drive account, and how the changes are
 * moving. Google Drive is the only destination — a local folder was offered
 * beside it, behind a Local / Google Drive switch, and was removed because two
 * machines meeting through a file-sync client is where sync went wrong — so
 * there is nothing to choose, only an account to connect.
 *
 * Backups are a separate panel and a separate idea — a file the person saves
 * somewhere of their own — and the two lived here together for as long as a
 * backup was a copy inside this vault. It no longer is.
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
  // Fetched on its own schedule, never inside `refresh`. It is one Drive round
  // trip and the panel does not need it to render, so making the rows wait for
  // it would trade a working panel for a decorated one.
  const [account, setAccount] = useState<GoogleAccountInfo | null>(
    () => cachedAccount
  );

  // A refresh that resolves after the component is gone, or after a newer one
  // already landed, must not write its stale answer into state. Connecting
  // Drive fires exactly that race.
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

  // `quiet` is for the reads nobody asked for — the poll while changes are
  // queued, the re-read after a pull. Each one asks Drive (a second or more),
  // so flagging them put "Checking…" on and off every three seconds for as
  // long as a change waited, which read as sync stuck rather than working.
  const refresh = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const seq = ++refreshSeq.current;
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = quiet
      ? null
      : window.setTimeout(() => {
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
      void refresh({ quiet: true });
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
        // Almost always Drive not answering. Worth showing verbatim: its own
        // reason says far more than "setup failed".
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
    const timer = window.setInterval(() => void refresh({ quiet: true }), 3000);
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

  const retryPrepare = () =>
    run("prepare", async () => {
      await api.prepareSyncVault();
    });

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

  // A build with no Google OAuth client cannot offer Drive, and Drive is the
  // only vault — so there is nothing to set up, and the panel says so once
  // rather than drawing a Connect button that cannot work.
  if (!status.googleClientConfigured) {
    return (
      <div className="panel settings-connections-panel settings-sync-panel">
        {head}
        <div className="settings-connections-list">
          <div className="settings-nav-row is-static">
            <span className="settings-nav-row-icon" aria-hidden="true">
              <CloudOff size={20} strokeWidth={1.9} />
            </span>
            <span className="settings-nav-row-copy">
              <strong>Sync is not available in this build</strong>
              <span>
                This copy of the app was built without a Google sign-in, and
                Google Drive is where sync keeps your data.
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  const seed = status.loop?.seed ?? null;

  // Drive's usage line, when the account call has landed. Decoration: the row
  // names the account without it.
  const googleQuota = account?.quota
    ? account.quota.limit === null
      ? `${formatBytes(account.quota.used)} used`
      : `${formatBytes(account.quota.used)} of ${formatBytes(account.quota.limit)} used`
    : null;
  const googleDetail = status.googleConnected
    ? [account?.email, googleQuota].filter(Boolean).join(" · ") || "Connected"
    : "Not connected. Connecting opens your browser to Google; the app can only see the folder it creates there.";

  // What the loop has actually been doing, rather than a promise about what it
  // will do. The row used to say "changes go out within a minute or so", which
  // is true and unfalsifiable — it reads the same whether sync has been working
  // for a week or has never once succeeded.
  const pending = status.loop?.pendingChanges ?? 0;
  const activityTitle = !status.loop
    ? "Not running yet"
    : pending > 0
      ? `${pending} change${pending === 1 ? "" : "s"} waiting to go out`
      : "All changes sent";
  const activityDetail = !status.loop
    ? "Sync now starts it."
    : status.loop.lastPulledAt
      ? `Last received from another computer ${formatWhen(status.loop.lastPulledAt)}`
      : "Nothing received from another computer yet";

  return (
    <div
      className="panel settings-connections-panel settings-sync-panel"
      aria-busy={busy !== null}
    >
      {head}

      <div className="settings-connections-list">
        {/* Before anything about the destination. Sync merges two machines'
            records into one log, and the tables have no owner column — so
            whose data it is has to be settled first, and connecting Drive
            before that would be work the app then refuses to use. A step
            still to take, not a fault, so it is drawn in the neutral tone: in
            the error tone it greeted every new install as something broken. */}
        {status.state === "signed-out" ? (
          <div className="settings-nav-row is-static">
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

        {/* The one destination: the account, and the button that connects or
            lets it go. Tinted like the COROS row when connected — the tint is
            what says so without spending a line on it. */}
        <div className="settings-nav-row is-static">
          <span
            className={`settings-nav-row-icon${
              status.googleConnected ? " is-connected" : ""
            }`}
            aria-hidden="true"
          >
            <Cloud size={20} strokeWidth={1.9} />
          </span>
          <span className="settings-nav-row-copy">
            <strong>Google Drive</strong>
            <span>{googleDetail}</span>
          </span>
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
        </div>

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

        {status.state === "unreachable" ? (
          <div className="settings-nav-row is-static sync-row-alert">
            <span className="settings-nav-row-icon" aria-hidden="true">
              <AlertTriangle size={20} strokeWidth={1.9} />
            </span>
            <span className="settings-nav-row-copy">
              <strong>Google Drive did not answer</strong>
              <span>
                Check that this computer is online. If it is, disconnecting and
                connecting the account again is the usual fix.
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

        {status.state === "ready" ? (
          <div className="settings-nav-row is-static">
            <span className="settings-nav-row-icon" aria-hidden="true">
              {busy === "syncnow" ? (
                <Loader2 size={20} strokeWidth={1.9} className="spin" />
              ) : (
                <CloudUpload size={20} strokeWidth={1.9} />
              )}
            </span>
            <span className="settings-nav-row-copy">
              <strong>{activityTitle}</strong>
              <span>{activityDetail}</span>
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
