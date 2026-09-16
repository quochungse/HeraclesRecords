// Tables whose rows are not replaced wholesale.
//
// Last-writer-wins is right for a record that describes one thing: a workout, a
// plan, a title. It is wrong for a record that *accumulates*, and the coach
// transcript is the only one of those in the schema. `chat_sessions.messages_json`
// is an append-only list carried as one opaque column, so two machines adding to
// the same conversation resolved to whichever wrote last and the other's turn
// was gone — measured, with no error and nothing in a log:
//
//     desktop appends the coach's answer at T
//     laptop appends the athlete's question at T+1s
//     merged: [shared history, LAPTOP: my question]      ← the answer is gone
//
// The analysis runs headless on whichever machine holds the lease, so "the
// answer arrives on one machine while the athlete types on the other" is the
// ordinary case rather than a corner.
//
// The fix is to merge the list as a list. Every entry carries a `mid` minted
// once, when it is first written, and a `mrev` bumped when its content changes
// (see `chatHistoryStore`). Merging is then:
//
//   * union by `mid` — an entry only one side has is kept, whichever side;
//   * last writer wins *per entry*, by `mrev`, for an entry both sides hold;
//   * ordered by `mid`, which is minted from a monotonic clock and so sorts in
//     creation order on every machine that reads it.
//
// All three are commutative and idempotent, which is what makes this safe to
// apply on both machines in either order: the result depends only on the set of
// entries, never on who merged first or on how many times. That is the property
// plain last-writer-wins has too, and the reason this is a different merge
// rather than a special case bolted onto the old one.
//
// A merge that produces something neither side had must be published — see
// `SyncTarget.takeRepublish`. Otherwise the vault's newest entry for the row is
// still the incoming one, which does not hold the local half, and compaction
// eventually folds the local half away.

import type { PersistedChatEntry } from "../types";

/** What a merger is handed and what it returns: whole rows, column by column. */
export type SyncRow = Record<string, unknown>;

export interface RowMerge {
  readonly row: SyncRow;
  /**
   * Whether the result differs from what arrived, which is precisely when this
   * machine holds something the vault does not.
   */
  readonly republish: boolean;
}

export type RowMerger = (local: SyncRow | undefined, incoming: SyncRow) => RowMerge;

/**
 * Identity of a transcript entry, for the union.
 *
 * Entries written before `mid` existed have none, and they are backfilled by
 * position rather than by content — `0-000007` is the eighth entry of this
 * conversation, on every machine that holds it. Two machines that already
 * disagreed about what the eighth entry is will collide here and one wins, but
 * that divergence predates any of this and there is nothing in the data to
 * resolve it with. Anything written from now on carries a real id.
 */
export function transcriptEntryId(
  entry: PersistedChatEntry,
  index: number
): string {
  const mid = (entry as { mid?: unknown }).mid;
  if (typeof mid === "string" && mid) return mid;
  return `0-${String(index).padStart(6, "0")}`;
}

function revisionOf(entry: PersistedChatEntry): string {
  const rev = (entry as { mrev?: unknown }).mrev;
  return typeof rev === "string" ? rev : "";
}

function parseTranscript(value: unknown): PersistedChatEntry[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as PersistedChatEntry[]) : null;
  } catch {
    return null;
  }
}

/**
 * Union two transcripts.
 *
 * Exported for the suite, which is where the convergence properties are
 * asserted directly rather than through a whole sync round.
 */
export function mergeTranscripts(
  local: PersistedChatEntry[],
  incoming: PersistedChatEntry[]
): PersistedChatEntry[] {
  const byId = new Map<string, { id: string; entry: PersistedChatEntry }>();
  const take = (entries: PersistedChatEntry[]): void => {
    entries.forEach((entry, index) => {
      const id = transcriptEntryId(entry, index);
      const held = byId.get(id);
      if (!held) {
        byId.set(id, { id, entry });
        return;
      }
      const mine = revisionOf(entry);
      const theirs = revisionOf(held.entry);
      if (mine > theirs) {
        byId.set(id, { id, entry });
        return;
      }
      if (mine < theirs) return;
      // Same identity, same revision, different content. `mrev` moves whenever
      // content does, so between two entries that both carry one this cannot
      // happen; what reaches here is two copies that diverged *before*
      // identities existed and are now both answering to the same backfilled
      // `0-<index>`. Nothing in the data says which is right.
      //
      // So the tie is broken by content, and it has to be by something both
      // machines compute the same way. Preferring "whichever side was passed
      // second" reads as a reasonable default and is a livelock: each machine
      // takes the other's copy, republishes it, and they swap back and forth
      // for as long as both keep polling.
      if (JSON.stringify(entry) > JSON.stringify(held.entry)) {
        byId.set(id, { id, entry });
      }
    });
  };
  take(local);
  take(incoming);

  return [...byId.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((held) => held.entry);
}

/**
 * The transcript column is merged; every other column is last-writer-wins, and
 * the caller has already decided that this entry is the winner.
 */
const mergeChatSession: RowMerger = (local, incoming) => {
  const localEntries = parseTranscript(local?.messages_json);
  const incomingEntries = parseTranscript(incoming.messages_json);
  // Nothing to union: a row this machine has never seen, or a column one side
  // could not parse. Taking the incoming row whole is what the merge did before
  // this file existed, and it is the right answer when there is no second half.
  if (!localEntries || !incomingEntries) {
    return { row: incoming, republish: false };
  }

  const merged = mergeTranscripts(localEntries, incomingEntries);
  const mergedJson = JSON.stringify(merged);
  if (mergedJson === incoming.messages_json) {
    // The incoming row already holds everything this machine does.
    return { row: incoming, republish: false };
  }
  return {
    row: { ...incoming, messages_json: mergedJson },
    republish: true
  };
};

const MERGERS: Readonly<Record<string, RowMerger>> = {
  chat_sessions: mergeChatSession
};

export function rowMergerFor(table: string): RowMerger | undefined {
  return MERGERS[table];
}
