// The sync data shapes the renderer is allowed to see.
//
// This file has no imports, deliberately — the same rule `electron/types.ts`
// follows. The renderer imports these across the process boundary, and every
// other sync module reaches SQLite: `snapshot.ts` and `syncService.ts` both
// pull in `../database`, and through it better-sqlite3, a native addon that has
// no business anywhere near the browser bundle. Even a type-only import from
// those files puts them in the renderer's module graph.
//
// So the contract lives here, on its own, and both sides import it.
//
// Sync only. Backup and restore are a separate feature with a separate story —
// one file the person saves wherever they like, and reads back when they want
// it — and their shapes live in `electron/backupTypes.ts`. The two shared this
// file, and a vault that kept backups inside it, for as long as backup was
// modelled as "sync, but manual". It is not: sync is a place two machines meet,
// a backup is a file someone owns.

/** Where the vault lives. A local folder needs a path; Google needs a
 *  connected account. */
export type SyncBackend = "local" | "google";

/** Nothing is encrypted and nothing is locked, so there is no locked state and
 *  no unlocked one either. What is left is whether anyone is signed in, whether
 *  a destination is chosen, whether it answers, and whose it is. */
export type SyncVaultState =
  /**
   * Nobody is signed in to COROS.
   *
   * Checked before the destination, and reported ahead of it even when no
   * folder has been chosen either: sync mixes two machines' records together,
   * so it needs to know whose they are before it needs to know where they go.
   * Choosing a folder first would be work the app then refuses to use.
   */
  | "signed-out"
  /** No folder chosen, or no Drive account connected. */
  | "not-configured"
  /** A destination is set but did not answer — an unplugged drive, an offline
   *  share, a Drive request that failed. */
  | "unreachable"
  /**
   * The vault belongs to a different COROS account.
   *
   * Nothing is pushed or pulled in this state. Two people's records merged into
   * one log cannot be separated again — there is no owner column to sort them
   * by — so this is the one destination problem that must not be recoverable by
   * carrying on regardless.
   */
  | "wrong-owner"
  /** The destination answered, and it is this account's. */
  | "ready";

/** Whose vault this is, as far as this machine can tell. */
export type SyncVaultOwnership =
  /** No account has claimed it. The first signed-in machine to sync will. */
  | "unclaimed"
  /** This account's. */
  | "mine"
  /** Someone else's — or this person's other COROS account. */
  | "other";

/** The destination half: everything `SyncService` can answer on its own,
 *  without knowing whether a change loop is running over it. */
export interface SyncVaultStatus {
  readonly state: SyncVaultState;
  readonly backend: SyncBackend;
  readonly folder: string | null;
  /** Only meaningful when `backend` is "google". */
  readonly googleConnected: boolean;
  /** True when this build ships OAuth credentials, or the user supplied their
   *  own. False means the Google option cannot be offered at all. */
  readonly googleClientConfigured: boolean;
  readonly deviceId: string;
  /** Whether anyone is signed in to COROS. Sync needs an owner before it needs
   *  anything else — see `SyncVaultState`. */
  readonly signedIn: boolean;
  /** Null when there is no destination to ask, or it could not be read. */
  readonly ownership: SyncVaultOwnership | null;
}

/**
 * How the one-off publish of this machine's existing data is going.
 *
 * It matters far more than its size suggests. The oplog only ever learned about
 * records written while it was running, so a machine that has been in use for
 * months publishes everything once when it first joins a vault. If that fails
 * there is nothing to see: the vault is reachable, the loop is running, and the
 * months of history simply never leave. This is what makes that visible.
 */
export type SyncSeedState =
  /** The loop is up but the publish has not been decided yet. */
  | "pending"
  /** Sending. On a large database this takes a while and several batches. */
  | "publishing"
  /** Everything this machine had is in the vault — or was already. */
  | "done"
  /** It did not finish. The next launch tries again; nothing is marked done. */
  | "failed";

export interface SyncSeedStatus {
  readonly state: SyncSeedState;
  /** Entries published by this run. Zero when the vault was already seeded. */
  readonly entries: number;
  /** Only set when `state` is "failed". */
  readonly error: string | null;
}

/** The change loop, when one is running. */
export interface SyncLoopStatus {
  /** Changes made here that have not been uploaded yet. Normally zero within a
   *  few seconds; a number that stays up means the destination is refusing
   *  writes. */
  readonly pendingChanges: number;
  /** When this machine last read the other machines' changes. */
  readonly lastPulledAt: string | null;
  readonly seed: SyncSeedStatus;
}

export interface SyncStatus extends SyncVaultStatus {
  /** Null when no change loop is running — sync is off, or the destination
   *  could not be reached. */
  readonly loop: SyncLoopStatus | null;
}

/**
 * Who the connected Google account belongs to, and how much room it has left.
 *
 * Read from Drive's `about` endpoint, which `drive.file` already covers — so
 * putting a name on the connection costs no new scope and no re-consent. Every
 * field is nullable because this is decoration: the panel works without it, and
 * a request that fails must not take the row down with it.
 */
export interface GoogleAccountInfo {
  readonly email: string | null;
  readonly name: string | null;
  /** Bytes. `limit` is null on an account with no cap, which is what a Google
   *  Workspace account with unlimited storage reports. */
  readonly quota: { readonly used: number; readonly limit: number | null } | null;
}

// No avatar, deliberately. `about` will hand over a `photoLink`, but rendering
// it would put an outbound request to googleusercontent.com on every view of
// the Settings panel — a third party learning when this app is open, for
// decoration. The email already answers the question the row is there to
// answer.

/**
 * What came of handing the renderer's preferences over.
 *
 * `syncing` is the load-bearing half. The renderer publishes by comparing
 * against what it last sent, so it needs to know the difference between "sent,
 * nothing had changed" and "nobody was listening" — otherwise switching sync on
 * mid-session leaves every preference behind, none of them having changed since
 * the answer that was mistaken for delivery.
 */
export interface LocalStoragePublishResult {
  readonly syncing: boolean;
  readonly published: number;
}

/** Another device announcing what it is doing, so this one can show "in use
 *  over there" instead of letting two people generate into one session. */
export interface SyncPresenceClaim {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly at: number;
  readonly activeSessionId: string | null;
}

/** Pushed to the renderer after inbound changes land. `localStorage` carries
 *  the writes the main process cannot perform itself. */
export interface SyncChangedEvent {
  readonly applied: number;
  readonly deleted: number;
  readonly localStorage: ReadonlyArray<{
    readonly op: "set" | "delete";
    readonly key: string;
    readonly value?: string;
  }>;
}
