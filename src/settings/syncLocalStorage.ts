// Reading and writing the renderer's own localStorage on the sync engine's
// behalf.
//
// The main process cannot reach localStorage, so the renderer gathers it before
// a backup and applies it after a restore. Both directions go through the same
// registry the main process uses — imported, not duplicated, so the two sides
// cannot drift into disagreeing about what may leave the machine.

import { shouldSyncLocalStorage } from "../../electron/sync/syncPolicy";

/** Everything in localStorage that policy allows to be backed up. */
export function collectSyncableLocalStorage(): Record<string, string> {
  const collected: Record<string, string> = {};
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    // Private windows and hardened configurations can make this throw. A backup
    // without view preferences is far better than one that fails outright.
    return collected;
  }

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    if (!shouldSyncLocalStorage(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) collected[key] = value;
  }
  return collected;
}

/** Apply what a restore returned. Re-checks policy: these values came off disk,
 *  possibly written by a different version of the app. */
export function applySyncedLocalStorage(
  entries: Record<string, string>
): number {
  let applied = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!shouldSyncLocalStorage(key)) continue;
    try {
      window.localStorage.setItem(key, value);
      applied += 1;
    } catch {
      // Out of quota, or storage disabled. Skip and keep going.
    }
  }
  return applied;
}

/**
 * Apply a restore's localStorage half as a replacement rather than a merge.
 *
 * The main process decides that for rows and settings, but it cannot see
 * localStorage, so only the renderer can tell which synced keys this machine
 * holds that the backup does not. Anything policy does not sync — window
 * chrome, dismissed prompts, the geo cache — is left alone, exactly as a
 * restore leaves this machine's `device`-tier settings alone.
 */
export function replaceSyncedLocalStorage(
  entries: Record<string, string>
): { applied: number; removed: number } {
  const applied = applySyncedLocalStorage(entries);

  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return { applied, removed: 0 };
  }

  const stale: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key in entries) continue;
    if (!shouldSyncLocalStorage(key)) continue;
    stale.push(key);
  }

  let removed = 0;
  for (const key of stale) {
    try {
      storage.removeItem(key);
      removed += 1;
    } catch {
      // Storage disabled mid-loop. Skip and keep going.
    }
  }
  return { applied, removed };
}

/**
 * Apply a restore's localStorage half additively.
 *
 * The merge counterpart to `replaceSyncedLocalStorage`: a key this machine
 * already has keeps the value it has, and nothing is removed. Same rule as the
 * rows and settings — `INSERT OR IGNORE`, expressed in the one store the main
 * process cannot reach.
 */
export function mergeSyncedLocalStorage(
  entries: Record<string, string>
): { applied: number; kept: number } {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return { applied: 0, kept: 0 };
  }

  let applied = 0;
  let kept = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!shouldSyncLocalStorage(key)) continue;
    try {
      if (storage.getItem(key) !== null) {
        kept += 1;
        continue;
      }
      storage.setItem(key, value);
      applied += 1;
    } catch {
      // Out of quota, or storage disabled. Skip and keep going.
    }
  }
  return { applied, kept };
}

/**
 * Apply the localStorage writes a pull produced.
 *
 * Policy is re-checked here, not trusted: these came off another machine, so
 * the same registry that decided what may leave decides what may land.
 */
export function applySyncedLocalStorageOps(
  ops: ReadonlyArray<{ op: "set" | "delete"; key: string; value?: string }>
): number {
  let applied = 0;
  for (const op of ops) {
    if (!shouldSyncLocalStorage(op.key)) continue;
    try {
      if (op.op === "delete") {
        window.localStorage.removeItem(op.key);
      } else if (op.value !== undefined) {
        window.localStorage.setItem(op.key, op.value);
      }
      applied += 1;
    } catch {
      // Storage disabled or out of quota. Skip and keep going.
    }
  }
  return applied;
}
