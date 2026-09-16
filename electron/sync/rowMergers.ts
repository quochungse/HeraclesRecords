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

import crypto from "node:crypto";

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

export interface RowMergeContext {
  /**
   * Whether this entry won last-writer-wins for its record.
   *
   * A merged table folds *every* entry, not only the winner — that is the whole
   * point, and it is what stops one machine's turn being dropped because
   * another's was a second later. But only the columns this table merges may
   * come from a loser: a title renamed on the winning machine must not be
   * undone by an older entry that happened to be folded after it. A loser
   * therefore returns its primary key and its merged columns and nothing else,
   * which `upsertRow` writes without touching the rest.
   */
  readonly winner: boolean;
}

export type RowMerger = (
  local: SyncRow | undefined,
  incoming: SyncRow,
  context: RowMergeContext
) => RowMerge;

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
  return legacyEntryId(entry, index);
}

/**
 * Position *and* content, and both halves earn their place.
 *
 * Position is what two copies of one history agree on, so the shared prefix
 * lines up and merges to itself. Content is what keeps two machines that each
 * appended a turn while both were on the old build from claiming the same slot:
 * without it they collide at `0-000042`, the tie is broken somehow, and one
 * athlete's turn is gone — the very loss this file exists to stop, arriving by
 * the back door. With it they are two entries that happen to sit side by side,
 * and both are kept.
 *
 * An entry *edited* in place on one side reads as divergence too and is kept
 * twice. Nothing written before `mrev` can tell an edit from a different turn,
 * and a duplicate is the better half of that trade.
 */
function legacyEntryId(entry: PersistedChatEntry, index: number): string {
  return `0-${String(index).padStart(6, "0")}-${contentDigest(entry)}`;
}

function contentDigest(entry: PersistedChatEntry): string {
  return crypto
    .createHash("sha1")
    .update(contentKey(entry))
    .digest("hex")
    .slice(0, 8);
}

function revisionOf(entry: PersistedChatEntry): string {
  const rev = (entry as { mrev?: unknown }).mrev;
  return typeof rev === "string" ? rev : "";
}

/**
 * An entry's content, with the merge bookkeeping taken back off.
 *
 * Exported because `chatHistoryStore` has to ask exactly the same question —
 * `foreignTail` decides what the caller is already sending, `stampEntries`
 * decides which stored entry an unidentified one *is*, and this decides what
 * two machines are holding the same copy of. Two definitions of "the same
 * entry" that drifted apart would put those three quietly out of step.
 *
 * Memoised per object. A transcript entry can be a chart card carrying a full
 * sample series — measured at 32 kB on a real conversation — and the callers
 * above each ask more than once per merge.
 */
const contentKeys = new WeakMap<object, string>();

export function contentKey(entry: PersistedChatEntry): string {
  const cached = contentKeys.get(entry as object);
  if (cached !== undefined) return cached;
  const { mid: _mid, mrev: _mrev, ...rest } = entry as PersistedChatEntry & {
    mid?: string;
    mrev?: string;
  };
  const key = JSON.stringify(rest);
  contentKeys.set(entry as object, key);
  return key;
}

/**
 * Identities to lend to entries that arrive without one.
 *
 * A build that predates `mid` rebuilds every entry field by field on its way
 * out of storage, so it drops both fields — and then saves, and publishes a
 * copy of the conversation with every identity stripped off. Without this the
 * union reads those as entries it has never met and adds them beside the ones
 * they already are: the transcript doubles, which is worse than the loss it
 * replaced.
 *
 * Built from both sides together and consumed per side, so the recovery works
 * whichever copy happens to be the stripped one. That symmetry is the point —
 * an upgraded machine that has not yet saved a conversation holds an
 * unidentified copy of it too, and would otherwise double it the moment the
 * other upgraded machine published.
 */
function lendableIds(
  ...sides: PersistedChatEntry[][]
): Map<string, string[]> {
  const byContent = new Map<string, string[]>();
  for (const side of sides) {
    for (const entry of side) {
      if (!entry.mid) continue;
      const key = contentKey(entry);
      const held = byContent.get(key);
      if (held) {
        if (!held.includes(entry.mid)) held.push(entry.mid);
      } else {
        byContent.set(key, [entry.mid]);
      }
    }
  }
  return byContent;
}

/**
 * The id each entry of one side answers to.
 *
 * Three rules, in order: its own, one borrowed from a content-identical entry
 * that has one, and — for an entry that is genuinely new and genuinely
 * unidentified, which is an old build appending a turn — a place immediately
 * after whatever it followed. `~` sorts above every hex digit and above `-`,
 * so `1-a` < `1-a~0000` < `1-b` and the turn lands where it was written rather
 * than at the top of the conversation.
 */
function identify(
  entries: PersistedChatEntry[],
  lendable: Map<string, string[]>
): string[] {
  if (entries.every((entry) => entry.mid)) {
    return entries.map((entry) => entry.mid as string);
  }
  // A queue per side, not per merge: both sides borrow from the same pool, and
  // the side that already has an identity does not consume one.
  const queues = new Map<string, string[]>();
  for (const [key, ids] of lendable) queues.set(key, [...ids]);

  return entries.map((entry, index) => {
    if (entry.mid) return entry.mid;
    const borrowed = queues.get(contentKey(entry))?.shift();
    if (borrowed) return borrowed;
    // Whatever is left is an entry no machine has ever identified — an old
    // build appending a turn. Its id is a function of the entry and where it
    // sits and *nothing else*, which is the property that matters more than any
    // other here.
    //
    // An earlier version anchored it to the entry before it, to keep it where
    // it was written. That reads better and is wrong: the id then depends on
    // what the rest of the array happened to hold, so the same turn was
    // identified one way in the entry that first carried it and another way in
    // the union republished afterwards — both of which sit in the log — and a
    // machine folding both added the turn twice. Measured.
    //
    // The cost is ordering, not data: a `0-` id sorts before every minted `1-`
    // one, so a turn appended on an old build to a conversation the new build
    // had already identified lands at the top of it rather than the end. That
    // lasts until every machine is upgraded, and it is the better half of the
    // trade against a transcript that doubles.
    return legacyEntryId(entry, index);
  });
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
const NOTHING_TO_LEND: Map<string, string[]> = new Map();

export function mergeTranscripts(
  local: PersistedChatEntry[],
  incoming: PersistedChatEntry[]
): PersistedChatEntry[] {
  // Lending only matters when something arrived unidentified, which stops being
  // true once every machine has saved each conversation once. Building the map
  // means taking the content key of every entry on both sides, and those carry
  // chart payloads tens of kilobytes each — the steady state should not pay for
  // the mixed-version case.
  const unidentified =
    local.some((entry) => !entry.mid) || incoming.some((entry) => !entry.mid);
  const lendable = unidentified
    ? lendableIds(local, incoming)
    : NOTHING_TO_LEND;
  const byId = new Map<string, { id: string; entry: PersistedChatEntry }>();
  const take = (entries: PersistedChatEntry[]): void => {
    const ids = identify(entries, lendable);
    entries.forEach((entry, index) => {
      const id = ids[index];
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
    // The id an entry was identified *by* becomes the id it carries. Working it
    // out again on the next merge would give the same answer only while the
    // entry it was anchored to is still there — and a turn an old build
    // appended, anchored at `<id>~0000`, would otherwise be minted a fresh
    // identity by the next save and jump to the end of the conversation.
    //
    // After the sort, so the tie-break above still compares the entries as they
    // arrived rather than as this is about to rewrite them.
    .map(({ id, entry }) => (entry.mid ? entry : { ...entry, mid: id }));
}

/**
 * The transcript column is merged; every other column is last-writer-wins, and
 * the caller has already decided that this entry is the winner.
 */
const mergeChatSession: RowMerger = (local, incoming, { winner }) => {
  // What a loser is allowed to carry: the key that names the row, and the one
  // column this table merges.
  const onlyMerged = (messagesJson: unknown): SyncRow => ({
    id: incoming.id,
    messages_json: messagesJson
  });
  const localEntries = parseTranscript(local?.messages_json);
  const incomingEntries = parseTranscript(incoming.messages_json);

  if (!incomingEntries) {
    // Nothing readable arrived. When this machine holds a transcript it can
    // read, the column is left out of the row entirely rather than overwritten:
    // `upsertRow` names the columns it writes, so leaving one out means
    // *unchanged*. Everything else the entry carries still applies — unless it
    // lost, in which case there is nothing left for it to say.
    if (localEntries) {
      const { messages_json: _unreadable, ...rest } = incoming;
      return { row: winner ? rest : { id: incoming.id }, republish: false };
    }
    return { row: incoming, republish: false };
  }
  // A row this machine has never seen. There is no second half to union, and
  // taking the entry whole is what every other table does.
  if (!localEntries) {
    return {
      row: winner ? incoming : onlyMerged(incoming.messages_json),
      republish: false
    };
  }

  const merged = mergeTranscripts(localEntries, incomingEntries);
  const mergedJson = JSON.stringify(merged);
  if (mergedJson === incoming.messages_json) {
    // The incoming row already holds everything this machine does.
    return {
      row: winner ? incoming : onlyMerged(incoming.messages_json),
      republish: false
    };
  }
  return {
    row: winner
      ? { ...incoming, messages_json: mergedJson }
      : onlyMerged(mergedJson),
    // Only what the vault does not hold. A loser's merge always differs from
    // the entry it came from — the winner's half is in it — so saying
    // "republish" on that alone would put a batch in the air on every pull.
    republish: mergedJson !== JSON.stringify(localEntries)
  };
};

const MERGERS: Readonly<Record<string, RowMerger>> = {
  chat_sessions: mergeChatSession
};

export function rowMergerFor(table: string): RowMerger | undefined {
  return MERGERS[table];
}

/**
 * Whether this table's rows accumulate.
 *
 * Asked by the merge itself, which folds every entry for such a record instead
 * of only the one that won last-writer-wins. Two machines appending to one
 * conversation publish two entries, and LWW keeps one: the other's turn then
 * reaches no third machine at all, and compaction drops the entry carrying it.
 */
export function isMergedTable(table: string): boolean {
  return table in MERGERS;
}
