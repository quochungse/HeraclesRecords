// Where the rest of the app tells the sync loop that something changed.
//
// Two choke points cover almost everything worth syncing:
//
//   * `database.setSetting` / `deleteSettings` — every settings key in the app
//     goes through these, so one hook covers the whole `preference` tier plus
//     the handful of `personal` keys, with no store having to remember.
//   * `chatHistoryStore.saveChatSession` — already the turn boundary, because
//     the renderer batches a conversation before persisting it. Hooking here
//     rather than at the stream means a reply becomes one entry, not one per
//     token.
//
// Everything is a no-op until a loop is attached, so the app runs exactly as
// before when sync is off. That matters more than it
// looks: these hooks sit on the hot path of ordinary settings writes, and must
// never be able to fail an operation that has nothing to do with sync.
//
// Inbound changes do **not** echo back out. SqliteSyncTarget and applySnapshot
// write through `requireDatabase().prepare(...)` directly rather than through
// `setSetting`, so merged entries never reach these hooks and cannot bounce
// between two devices forever.

import { ChangeBuilder } from "./syncEngine";
import type { OpEntry } from "./oplog";

export interface ChangeSink {
  readonly enqueue: (entries: readonly OpEntry[]) => void;
  readonly nextHlc: () => string;
}

let sink: ChangeSink | null = null;

/** Attach the running loop. Called once sync is configured. */
export function attachSyncSink(next: ChangeSink | null): void {
  sink = next;
}

export function isSyncAttached(): boolean {
  return sink !== null;
}

function build(fill: (builder: ChangeBuilder) => void): void {
  if (!sink) return;
  try {
    const builder = new ChangeBuilder({ nextHlc: sink.nextHlc });
    fill(builder);
    // ChangeBuilder drops anything policy refuses, so a `device`-tier key
    // reaching here — every credential in the app included — simply produces
    // nothing.
    if (builder.entries.length > 0) sink.enqueue(builder.entries);
  } catch (error) {
    // A sync problem must never break the write that triggered it. The loop
    // will pick the change up on its next full pass either way.
    console.warn("[sync] could not queue a change", error);
  }
}

export function notifySettingChanged(key: string, value: string): void {
  build((builder) => builder.setting(key, value));
}

export function notifySettingsDeleted(keys: readonly string[]): void {
  build((builder) => {
    for (const key of keys) builder.deleteSetting(key);
  });
}

export function notifyRowChanged(
  table: string,
  recordId: string,
  row: Record<string, unknown>
): void {
  build((builder) => builder.row(table, recordId, row));
}

export function notifyRowDeleted(table: string, recordId: string): void {
  build((builder) => builder.deleteRow(table, recordId));
}
