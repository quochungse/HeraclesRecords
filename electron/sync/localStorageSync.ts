// The renderer's half of the state, on its way out.
//
// localStorage holds the settings people notice first — theme, units, sport
// colours, which view opens at startup — and it lives in the renderer, where
// the main process cannot read it. The inbound half was always complete:
// entries merge through `SqliteSyncTarget`, queue up, and the renderer writes
// them. Nothing ever sent any.
//
// Hooking every write was the obvious fix and the wrong one: there are a dozen
// call sites across ten files plus a `defineSelectionPreference` helper, and
// the thirteenth would be forgotten. So the renderer hands over the whole of
// what policy allows and this module works out what changed since the last
// time — one place, and a preference added later is covered by declaring it in
// `syncPolicy` and nothing else.
//
// **The published snapshot is persisted, not merely remembered.** Republishing
// everything on each launch would restamp every preference with a fresh
// timestamp, so whichever machine started last would win — and a theme changed
// on the desktop would be undone by opening the laptop. Comparing against what
// was actually last published means an unchanged preference produces no entry
// at all.
//
// Inbound changes update that snapshot too, which is what stops an echo: a
// theme merged from the other machine must not read as a local edit and be
// published straight back.

import type { OpEntry } from "./oplog";
import { ChangeBuilder } from "./syncEngine";

/** Where the last published snapshot is kept. `device` tier — it describes
 *  what this machine has sent, which is nobody else's business and would be
 *  actively wrong on another computer. */
export const PUBLISHED_LOCAL_STORAGE_SETTING = "sync.publishedLocalStorage";

export interface LocalStorageSyncDeps {
  readonly getSetting: (key: string) => string | undefined;
  readonly setSetting: (key: string, value: string) => void;
  readonly nextHlc: () => string;
}

/** A localStorage write the renderer has already performed, arriving from a
 *  pull. Mirrors `PendingLocalStorageOp`. */
export interface AppliedLocalStorageOp {
  readonly op: "set" | "delete";
  readonly key: string;
  readonly value?: string;
}

function readPublished(
  deps: LocalStorageSyncDeps
): Record<string, string> {
  const stored = deps.getSetting(PUBLISHED_LOCAL_STORAGE_SETTING);
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") entries[key] = value;
    }
    return entries;
  } catch {
    // Written by a different version, or truncated. Treating it as empty
    // republishes everything once, which is correct if wasteful; treating it
    // as authoritative would silently stop publishing.
    return {};
  }
}

function writePublished(
  deps: LocalStorageSyncDeps,
  entries: Record<string, string>
): void {
  deps.setSetting(PUBLISHED_LOCAL_STORAGE_SETTING, JSON.stringify(entries));
}

export interface LocalStorageChanges {
  readonly entries: readonly OpEntry[];
  /** Keys whose value differs from what was last published. */
  readonly changed: readonly string[];
  /** Keys that were published once and are now gone from the renderer. */
  readonly removed: readonly string[];
}

/**
 * Work out what the renderer's current state changes, as oplog entries.
 *
 * `current` is everything `collectSyncableLocalStorage()` gathered — already
 * filtered by policy on that side, and filtered again here by `ChangeBuilder`,
 * because it arrives over IPC and a renderer is not a thing to take at its
 * word.
 *
 * Pure with respect to storage: nothing is recorded as published until
 * `commit` is called, so a caller whose upload fails can simply not commit and
 * try again on the next pass.
 */
export function diffLocalStorage(
  current: Readonly<Record<string, string>>,
  deps: LocalStorageSyncDeps
): LocalStorageChanges {
  const published = readPublished(deps);
  const builder = new ChangeBuilder({ nextHlc: deps.nextHlc });
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [key, value] of Object.entries(current)) {
    if (published[key] === value) continue;
    builder.localStorage(key, value);
    changed.push(key);
  }

  for (const key of Object.keys(published)) {
    if (key in current) continue;
    builder.deleteLocalStorage(key);
    removed.push(key);
  }

  return { entries: builder.entries, changed, removed };
}

/** Record what the renderer now holds as published. Call once the entries from
 *  `diffLocalStorage` are safely queued. */
export function commitPublishedLocalStorage(
  current: Readonly<Record<string, string>>,
  deps: LocalStorageSyncDeps
): void {
  writePublished(deps, { ...current });
}

/**
 * Fold changes that arrived from another machine into the published snapshot.
 *
 * Without this the next pass would see the merged value differ from what this
 * machine last sent, call it a local edit, and publish it back — the same
 * bounce `syncBridge` avoids by writing merged rows through the raw database.
 * Here the write happens in the renderer, so the snapshot has to be corrected
 * explicitly instead.
 */
export function noteAppliedLocalStorage(
  ops: readonly AppliedLocalStorageOp[],
  deps: LocalStorageSyncDeps
): void {
  if (ops.length === 0) return;
  const published = readPublished(deps);
  for (const op of ops) {
    if (op.op === "delete") delete published[op.key];
    else if (op.value !== undefined) published[op.key] = op.value;
  }
  writePublished(deps, published);
}
