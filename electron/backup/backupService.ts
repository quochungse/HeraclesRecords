// Backup and restore: one file, chosen by the person, read back when they want.
//
// Deliberately not sync. Sync is a place two machines meet and keep meeting;
// this is a file someone saves to their disk, their USB stick, their own cloud
// folder — somewhere this app has no opinion about and no further business
// with. So there is no list of backups, no newest one, no lineage, and no
// vault: those all existed to answer "which copy is current?", which is a
// question about a shared destination and has no meaning for a file.
//
// The file is sealed with the same envelope the vault uses, and for the same
// single reason: a backup ends up in a Downloads folder, on a USB stick, in
// someone's own Drive — exactly the places whose contents get indexed,
// previewed and screenshotted by accident. Sealed, it is bytes.
//
// **It is not encrypted.** The key is derived from a constant in
// `syncObfuscation.ts` and ships in every build, so anyone holding the app can
// open any backup it wrote. Read that file's header before describing this
// anywhere in the UI, and never treat it as a reason to put something in a
// backup that policy would otherwise keep out.
//
// The AAD is a constant, not the path — unlike the vault, where the path binds
// a payload to its slot. A backup file is meant to be renamed, copied and moved
// about; binding it to wherever it happened to be written would make renaming
// it lose the data.
//
// Reading goes both ways: a file written before sealing was added is plain JSON
// and still restores. Same asymmetry as `ObfuscatedProvider` — every write is
// sealed, not every read expects one.
//
// The restore question — replace or merge — is asked only when there is
// something to lose. On an empty machine both answers are identical, so it
// runs.

import fsp from "node:fs/promises";
import path from "node:path";

import { currentOwner, isOwnerFingerprint } from "../dataOwner";
import { isSealed, seal, unseal } from "../sync/syncObfuscation";
import { hasSyncableData } from "../sync/syncableStore";
import {
  applyBackup,
  collectBackup,
  isBackupDocument,
  previewRestore
} from "./backupDocument";
import type {
  BackupDocument,
  BackupExportResult,
  BackupImportCandidate,
  BackupOwnership,
  LocalStorageEntries,
  RestoreMode,
  RestoreResult
} from "./backupTypes";

/** A file that is not a backup this build can read. Separate from an ordinary
 *  I/O failure because the fix is different: no permission or retry will make
 *  this file readable. */
export class BackupFormatError extends Error {
  readonly code = "malformed-backup" as const;

  constructor(message: string) {
    super(message);
    this.name = "BackupFormatError";
  }
}

/** Nobody is signed in, so there is no account to attribute the data to — or to
 *  check a file against. Both directions refuse rather than guess. */
export class BackupSignedOutError extends Error {
  readonly code = "signed-out" as const;

  constructor(message: string) {
    super(message);
    this.name = "BackupSignedOutError";
  }
}

/**
 * The file belongs to a different COROS account.
 *
 * Thrown rather than warned: restoring would merge two people's records, and
 * the tables have no owner column to separate them again. Overridable on
 * purpose — see `BackupImportCandidate.ownership` for the case that needs it.
 */
export class BackupOwnerMismatchError extends Error {
  readonly code = "wrong-owner" as const;

  constructor(message: string) {
    super(message);
    this.name = "BackupOwnerMismatchError";
  }
}

/** Where a file's owner stands relative to whoever is signed in. */
function ownershipOf(
  document: BackupDocument,
  owner: string
): BackupOwnership {
  if (!isOwnerFingerprint(document.owner)) return "unknown";
  return document.owner === owner ? "mine" : "other";
}

/**
 * The signed-in account, or a refusal naming what to do about it.
 *
 * Exported so a caller can ask *before* opening a file dialog. Bouncing someone
 * back out of a save dialog they have already navigated is a worse way to say
 * "sign in first" than not opening it.
 */
export function requireBackupAccount(action: string): string {
  const owner = currentOwner();
  if (!owner) {
    throw new BackupSignedOutError(
      `Sign in to COROS before ${action}. A backup belongs to an account, so ` +
        "there is nothing to attribute this one to."
    );
  }
  return owner;
}

/**
 * Binds a sealed backup to being a backup, and nothing narrower.
 *
 * The vault uses the storage path here, so a payload only opens in the slot it
 * was written to. A file has no such slot: it is meant to be renamed and moved,
 * and using its path would mean renaming it made it unreadable.
 */
const BACKUP_AAD = "heracles-records/backup/v1";

/** The extension a sealed backup gets. Not `.json` any more — the bytes are an
 *  envelope, and an extension that promises text a text editor cannot show is
 *  worse than one that promises nothing. */
export const BACKUP_EXTENSION = "hrbackup";

/** What an open dialog should accept: what this build writes, and the plain
 *  JSON earlier builds wrote. */
export const BACKUP_OPEN_EXTENSIONS: readonly string[] = [
  BACKUP_EXTENSION,
  "json"
];

/** What the save dialog offers, so a folder of them sorts by date and a person
 *  can tell one from another without opening it. */
export function defaultBackupFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `heracles-records-backup-${stamp}.${BACKUP_EXTENSION}`;
}

export interface WriteBackupOptions {
  readonly deviceId: string;
  readonly localStorage: LocalStorageEntries;
  readonly now?: () => Date;
}

/**
 * Write a backup to `filePath`.
 *
 * Written through a temporary file in the same directory and then renamed, so
 * an interrupted export cannot leave a half-written file sitting where a
 * complete one used to be — which is exactly the moment someone would reach
 * for it.
 */
export async function writeBackupFile(
  filePath: string,
  options: WriteBackupOptions
): Promise<BackupExportResult> {
  const { document, rowCount } = collectBackup({
    deviceId: options.deviceId,
    owner: requireBackupAccount("saving a backup"),
    localStorage: options.localStorage,
    now: options.now
  });

  // Not indented any more: nobody reads the sealed bytes, and the whitespace
  // would only make the envelope bigger.
  const body = seal(Buffer.from(JSON.stringify(document), "utf8"), BACKUP_AAD);
  const temporary = `${filePath}.partial-${document.id}`;

  await fsp.writeFile(temporary, body);
  try {
    await fsp.rename(temporary, filePath);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }

  return {
    path: filePath,
    createdAt: document.createdAt,
    bytes: body.byteLength,
    rowCount,
    settingCount: Object.keys(document.settings).length,
    localStorageCount: Object.keys(document.localStorage).length
  };
}

/** Read and validate a backup file. */
export async function readBackupFile(
  filePath: string
): Promise<BackupDocument> {
  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(filePath);
  } catch (error) {
    throw new Error(
      `${path.basename(filePath)} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Sealed by this build, or plain JSON from one before sealing was added.
  let raw: string;
  if (isSealed(bytes)) {
    try {
      raw = unseal(bytes, BACKUP_AAD).toString("utf8");
    } catch {
      // The envelope is there but will not open: truncated, edited, or written
      // by a build whose key has moved on. None of those is retryable.
      throw new BackupFormatError(
        `${path.basename(filePath)} is damaged and cannot be opened.`
      );
    }
  } else {
    raw = bytes.toString("utf8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupFormatError(
      `${path.basename(filePath)} is not a backup file.`
    );
  }

  if (!isBackupDocument(parsed)) {
    throw new BackupFormatError(
      `${path.basename(filePath)} is not a backup this version can read.`
    );
  }
  return parsed;
}

/**
 * Examine a chosen file without writing anything.
 *
 * Both previews are computed here, once, so the dialog can say what each choice
 * would do rather than naming two options and leaving the consequences to the
 * imagination.
 */
export async function inspectBackupFile(
  filePath: string
): Promise<BackupImportCandidate> {
  const owner = requireBackupAccount("restoring a backup");
  const document = await readBackupFile(filePath);
  return {
    path: filePath,
    createdAt: document.createdAt,
    deviceId: document.deviceId,
    ownership: ownershipOf(document, owner),
    machineHasData: hasSyncableData(),
    replace: previewRestore(document, "replace"),
    merge: previewRestore(document, "merge")
  };
}

export interface RestoreOptions {
  /**
   * Restore a file belonging to another account anyway.
   *
   * Only ever set from an explicit second confirmation. The guard exists
   * because merging two people's records cannot be undone; the override exists
   * because a fingerprint cannot tell that apart from this person's own other
   * account.
   */
  readonly allowOtherOwner?: boolean;
}

/** Apply a backup file in the mode the person picked. */
export async function restoreBackupFile(
  filePath: string,
  mode: RestoreMode,
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  const owner = requireBackupAccount("restoring a backup");
  const document = await readBackupFile(filePath);

  // Checked here rather than only in the UI. This is the last point before the
  // write, and it is reachable from IPC — a renderer that skipped the dialog
  // must still be refused.
  if (ownershipOf(document, owner) === "other" && !options.allowOtherOwner) {
    throw new BackupOwnerMismatchError(
      "This backup belongs to a different COROS account. Restoring it would " +
        "mix two people's data together, which cannot be undone."
    );
  }

  return applyBackup(document, mode);
}
