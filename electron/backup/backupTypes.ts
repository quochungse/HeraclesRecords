// The backup shapes the renderer is allowed to see.
//
// No imports, deliberately — the same rule `electron/types.ts` and
// `sync/syncTypes.ts` follow. The renderer imports these across the process
// boundary, and every other module in this folder reaches SQLite through
// `../database`, which pulls in better-sqlite3: a native addon with no business
// anywhere near the browser bundle. Even a type-only import from those files
// would put them in the renderer's module graph.
//
// A backup is a **file the person owns**. They choose where it goes, they hand
// it about, they open it when they want it back. Nothing here tracks copies,
// ranks them, or knows where the last one went — that was the vault model, and
// it belonged to sync.

/** What a restore does about data already on this machine. */
export type RestoreMode =
  /** The backup decides in full: anything here it does not have is removed, so
   *  the result is the backup's state rather than a mixture of two machines. */
  | "replace"
  /** Additive only: records the backup has and this machine does not are
   *  written, anything already here is left as it is, nothing is removed. */
  | "merge";

/** localStorage lives in the renderer, so it crosses the boundary as data. */
export type LocalStorageEntries = Readonly<Record<string, string>>;

/**
 * A whole-state backup, as written to the file.
 *
 * Still `version: 1`: the shape has not changed since credentials were taken
 * out of it, and a file written by an older build restores correctly. Such a
 * file has three fields this one does not read — `includesSecrets`,
 * `omittedDeviceSecrets`, `portableSecrets` — and ignoring them is the correct
 * handling rather than a compromise: what they hold is exactly what this app no
 * longer restores. Any credential settings it carries in `settings` are refused
 * on the way in like any other `device`-tier key, so an old backup restores its
 * user data and leaves this machine's sign-ins alone.
 */
/** Whose data a file holds, measured against who is signed in here. */
export type BackupOwnership =
  /** Same COROS account. */
  | "mine"
  /** A different one. Restoring merges two people's records, so this is
   *  refused unless the person explicitly overrides it. */
  | "other"
  /** The file records no owner — written before ownership existed. Allowed:
   *  refusing every older backup would be a data-loss decision taken on the
   *  user's behalf. */
  | "unknown";

export interface BackupDocument {
  readonly version: 1;
  /** Minted when the file was written. Nothing depends on it any more — no
   *  lineage is tracked — but it stays: it is what tells two files apart when
   *  someone has three of them in a downloads folder. */
  readonly id: string;
  readonly createdAt: string;
  /** The machine that wrote it, so a restore can say where the file came
   *  from. */
  readonly deviceId: string;
  /**
   * Fingerprint of the COROS account whose data this is — an HMAC, never the
   * id itself; see `electron/dataOwner.ts`.
   *
   * Null only in a file written before ownership existed. This build always
   * writes one, because it refuses to write a backup at all with nobody signed
   * in.
   */
  readonly owner?: string | null;
  /** table name -> rows, each row a full column map. */
  readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly settings: Readonly<Record<string, string>>;
  readonly localStorage: Readonly<Record<string, string>>;
}

export interface TableChange {
  readonly table: string;
  /** Rows the backup carries for this table. */
  readonly incoming: number;
  /** Rows this machine has now. */
  readonly existing: number;
  /** Rows the restore will actually write. Under `replace` that is all of
   *  them; under `merge` only the ones not already here. */
  readonly writing: number;
  /** Rows here that the backup does not have, and that `replace` therefore
   *  drops. Always zero under `merge` — the whole reason the choice exists. */
  readonly removing: number;
}

export interface RestorePreview {
  readonly mode: RestoreMode;
  readonly createdAt: string;
  readonly deviceId: string;
  readonly tables: readonly TableChange[];
  readonly settings: number;
  readonly localStorage: number;
  /** Settings here, in a tier the backup covers, that the backup does not have.
   *  `replace` clears them — that is what makes the result the backup's state
   *  rather than a merge of two machines. Empty under `merge`. Credentials are
   *  never in a tier the backup covers, so a restore cannot clear a sign-in
   *  this machine holds. */
  readonly settingsRemoved: readonly string[];
  /** Total of `TableChange.writing`, so the confirmation can lead with what
   *  will actually happen. */
  readonly rowsWriting: number;
  /** Total of `TableChange.removing`. */
  readonly rowsRemoved: number;
  /** Destinations in the file that this build refuses. A backup written by an
   *  older build carries credentials; those land here rather than being
   *  written. Anything else non-empty means a version mismatch or tampering. */
  readonly refused: readonly string[];
  readonly totalIncomingRows: number;
  readonly totalExistingRows: number;
}

export interface RestoreResult {
  readonly mode: RestoreMode;
  readonly rowsWritten: number;
  readonly settingsWritten: number;
  readonly rowsRemoved: number;
  readonly settingsRemoved: number;
  /**
   * For the renderer to apply; the main process cannot reach localStorage.
   *
   * Under `replace` the renderer also clears the synced keys the backup does
   * not have, because only it can see which ones this machine holds. Under
   * `merge` it writes only the keys it does not already have.
   */
  readonly localStorage: Readonly<Record<string, string>>;
  readonly refused: readonly string[];
}

/** What a finished export wrote, for the line the panel shows afterwards. */
export interface BackupExportResult {
  readonly path: string;
  readonly createdAt: string;
  readonly bytes: number;
  readonly rowCount: number;
  readonly settingCount: number;
  readonly localStorageCount: number;
}

/**
 * A file the person picked, examined before anything is written.
 *
 * Both previews are computed up front. It costs one extra pass over the same
 * rows, once, at the moment someone chooses a file — and it is what lets the
 * dialog say what each choice would actually do instead of naming two options
 * and leaving the consequences to the imagination.
 */
export interface BackupImportCandidate {
  readonly path: string;
  readonly createdAt: string;
  readonly deviceId: string;
  /**
   * Whether this file is this account's.
   *
   * `other` is a refusal, not a warning: `restoreBackupFile` will not write it
   * without being told to override. The reason it is overridable at all is the
   * case the fingerprint cannot tell from a mix-up — the person's own second
   * COROS account, or a backup made before they switched accounts.
   */
  readonly ownership: BackupOwnership;
  /**
   * Whether this machine holds any data a restore would touch.
   *
   * False means there is nothing to lose and nothing to choose between, so the
   * restore runs without asking. This is the only reason the flow ever skips
   * the question.
   */
  readonly machineHasData: boolean;
  readonly replace: RestorePreview;
  readonly merge: RestorePreview;
}
