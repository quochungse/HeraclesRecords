import {
  createChatSession,
  getChatSession,
  getChatSessionProvider,
  getChatSessionTitle,
  saveChatSession,
  setChatSessionTitle
} from "./chatHistoryStore";
import {
  readSessionSummary,
  rollTranscriptSummary,
  writeCondensedThrough,
  writeSessionSummary
} from "./chatContextService";
import { resolveCompressionRuntime, transcriptDigests } from "./chatCompression";
import { providerModelOptions } from "./chatModels";
import { getChatSettings, getConversationSettings, setConversationSettings } from "./chatService";
import { coachTranscript } from "./chatHiddenTurns";
import {
  shiftBoundary,
  turnRanges,
  turnRemoval,
  withoutIndices,
  type TurnRange
} from "./chatTurns";
import { creationOfDraft, deletePlanDraftsOf } from "./chatWorkoutTools";
import { readScheduleChanges } from "./chatScheduleChanges";
import {
  announceChatSessionRow,
  deleteChatScheduleChanges,
  listChatHiddenTurns,
  setChatHiddenTurn
} from "./database";
import { ScreenError } from "./screenText";
import type {
  ChatSessionSummary,
  ChatTokenUsage,
  DeleteTurnOptions,
  HideTurnOptions,
  PersistedChatEntry,
  TurnChange,
  TurnCreation,
  TurnDescription,
  TurnRef
} from "./types";

/**
 * Deleting, editing and hiding a turn of a conversation, and branching a new
 * conversation from one.
 *
 * Done here rather than by the window saving a shorter transcript: a save
 * that shortens the row is exactly what `foreignTail` refuses — it reads as
 * "the row grew behind my back" and puts the tail back — and an analysis
 * appending to the same row from this process must not race a delete the
 * window thinks it made. Read, cut and written with nothing awaited between,
 * a turn's removal is atomic against both.
 *
 * The window flushes its own pending save first and names the turn by its
 * question's identity, position and words (`TurnRef`), which this side checks
 * against the row before it touches anything.
 */

/**
 * The turn the window means. By its question's `mid` where the window has one
 * and the row is stamped: a turn deleted on another machine leaves its
 * position and, often, its words to another turn ("ok" asked twice), and a
 * window not yet re-read would otherwise delete that one. Without a `mid`, at
 * the position it names, or the one turn asked in those words.
 */
function resolveTurn(entries: readonly PersistedChatEntry[], ref: TurnRef): TurnRange {
  const turns = turnRanges(entries);
  const asked = (range: TurnRange) => {
    const question = entries[range.question];
    return question?.kind === "message" && question.content === ref.content;
  };
  if (ref.mid) {
    const byMid = turns.find((range) => entries[range.question]?.mid === ref.mid);
    if (byMid) return byMid;
    // A row no save has stamped yet cannot be asked by identity.
    const stamped = entries.some((entry) => entry.mid);
    const atIndex = stamped ? undefined : turns.find((range) => range.question === ref.index && asked(range));
    if (atIndex) return atIndex;
    throw new ScreenError("main.coach.turnChanged");
  }
  const atIndex = turns.find((range) => range.question === ref.index && asked(range));
  if (atIndex) return atIndex;
  const matching = turns.filter(asked);
  if (matching.length === 1) return matching[0]!;
  throw new ScreenError("main.coach.turnChanged");
}

interface CreationInTurn extends TurnCreation {
  /** The cards of it in the turn, and what deleting it removes. */
  indices: number[];
  /** A plan's or workout's: its first version's draft id, as events and refs name it. */
  artifactId?: string;
  draftIds: string[];
  changeSetIds: string[];
}

/**
 * What the turn made that lives on in a table of its own. A plan or workout
 * can be deleted with the turn only when nothing of it is saved and every
 * version's card is in this turn: a version written in a later turn would be
 * left pointing at nothing. A proposal can be deleted until a line of it has
 * been applied: that line is on COROS, and the proposal is how Coach knows.
 */
function creationsIn(entries: readonly PersistedChatEntry[], range: TurnRange): CreationInTurn[] {
  const turnDrafts = new Map<string, number>();
  for (let index = range.start; index < range.end; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === "planDraft") turnDrafts.set(entry.draft.draftId, index);
  }
  const creations: CreationInTurn[] = [];
  // Every version of a creation already read, so its other cards ask nothing.
  const seen = new Set<string>();
  for (let index = range.start; index < range.end; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === "planDraft") {
      if (entry.draft.removedAt || seen.has(entry.draft.draftId)) continue;
      const creation = creationOfDraft(entry.draft.draftId);
      const draftIds = creation?.draftIds ?? [entry.draft.draftId];
      for (const id of draftIds) seen.add(id);
      const blocked = creation?.saved ? "saved" : draftIds.every((id) => turnDrafts.has(id)) ? undefined : "versions";
      creations.push({
        kind: entry.draft.artifactType === "workout" ? "workout" : "plan",
        name: entry.draft.name,
        deletable: !blocked,
        ...(blocked ? { keptBecause: blocked } : {}),
        indices: draftIds.flatMap((id) => (turnDrafts.has(id) ? [turnDrafts.get(id)!] : [])),
        artifactId: creation?.artifactId ?? entry.draft.draftId,
        draftIds,
        changeSetIds: []
      });
    } else if (entry.kind === "scheduleChange") {
      const set = readScheduleChanges([entry.changeSetId])[0];
      const applied = set?.lines.some((line) => line.status === "applied") ?? false;
      creations.push({
        kind: "changes",
        name: set?.summary ?? "",
        deletable: !applied,
        ...(applied ? { keptBecause: "saved" as const } : {}),
        indices: [index],
        draftIds: [],
        changeSetIds: [entry.changeSetId]
      });
    }
  }
  return creations;
}

/**
 * What a turn's removal takes: its entries, less the cards of creations that
 * stay — every one unless the athlete deletes them too, and then the ones
 * that cannot be deleted.
 *
 * A card the athlete removed from the conversation stays while its drafts do
 * (a saved creation keeps them): it is not drawn, but it is the record that
 * deleting the conversation reads to delete them. And a creation deleted with
 * the turn takes the entries elsewhere that name it — the events of its
 * versions, the references a later question was asked with — or Coach is
 * told to read a draft that is gone.
 */
function turnCut(
  entries: readonly PersistedChatEntry[],
  range: TurnRange,
  options: { deleteCreations: boolean; answerOnly?: boolean }
): { deleting: CreationInTurn[]; removed: number[]; entries: PersistedChatEntry[] } {
  const creations = creationsIn(entries, range);
  const deleting = options.deleteCreations ? creations.filter((creation) => creation.deletable) : [];
  const keptCards = new Set(
    creations.filter((creation) => !deleting.includes(creation)).flatMap((creation) => creation.indices)
  );
  const deletedDrafts = new Set(deleting.flatMap((creation) => creation.draftIds));
  for (let index = range.start; index < range.end; index += 1) {
    const entry = entries[index]!;
    if (
      entry.kind === "planDraft" &&
      entry.draft.removedAt &&
      !deletedDrafts.has(entry.draft.draftId) &&
      creationOfDraft(entry.draft.draftId)
    ) {
      keptCards.add(index);
    }
  }
  const removed = new Set(
    turnRemoval(entries, range, options.answerOnly ? { answerOnly: true } : {}).filter(
      (index) => !keptCards.has(index)
    )
  );

  const gone = new Set(deleting.flatMap((creation) => (creation.artifactId ? [creation.artifactId] : [])));
  let edited: PersistedChatEntry[] = entries as PersistedChatEntry[];
  if (gone.size > 0) {
    edited = entries.map((entry, index) => {
      if (entry.kind === "planEvent" && gone.has(entry.event.artifactId)) {
        removed.add(index);
      } else if (entry.kind === "planRefs" && entry.refs.some((ref) => gone.has(ref.artifactId))) {
        const refs = entry.refs.filter((ref) => !gone.has(ref.artifactId));
        if (refs.length === 0) removed.add(index);
        else return { ...entry, refs };
      }
      return entry;
    });
  }
  return { deleting, removed: [...removed].sort((a, b) => a - b), entries: edited };
}

function deleteCreations(creations: readonly CreationInTurn[]): void {
  deletePlanDraftsOf(creations.flatMap((creation) => creation.draftIds));
  deleteChatScheduleChanges(creations.flatMap((creation) => creation.changeSetIds));
}

/**
 * Whether the stored summary speaks for this turn: it covers the turn's first
 * entry, which a removal or a hiding always takes.
 */
function summarises(sessionId: string, range: TurnRange): boolean {
  const stored = readSessionSummary(sessionId);
  return Boolean(stored.summary) && range.start < stored.through;
}

/**
 * Whether anything Coach may read is left before `through`: a summary of
 * entries that say nothing — every turn it covered deleted or hidden, the
 * brief at the head of an AI Plan conversation all that remains — speaks only
 * for what is gone.
 */
function speaksBefore(sessionId: string, entries: readonly PersistedChatEntry[], through: number): boolean {
  return coachTranscript(sessionId, entries.slice(0, through)).some(
    (entry) => entry.kind === "message" || entry.kind === "coachPrompt"
  );
}

/** The model a rewritten summary runs on, as the athlete's lists name it. */
function summaryModelLabel(sessionId: string): string | undefined {
  const { runtime } = resolveCompressionRuntime(sessionId);
  if (!runtime.provider || !runtime.model) return runtime.model;
  return (
    providerModelOptions(runtime.provider, getChatSettings()).find((option) => option.value === runtime.model)
      ?.label ?? runtime.model
  );
}

export function describeTurn(sessionId: string, ref: TurnRef): TurnDescription {
  const entries = getChatSession(sessionId);
  const range = resolveTurn(entries, ref);
  const summarised = summarises(sessionId, range);
  return {
    creations: creationsIn(entries, range).map(({ kind, name, deletable, keptBecause }) => ({
      kind,
      name,
      deletable,
      ...(keptBecause ? { keptBecause } : {})
    })),
    summarised,
    ...(summarised ? { summaryModel: summaryModelLabel(sessionId) } : {})
  };
}

/** What the summary is rewritten with; a seam so a suite need not reach a provider. */
export interface TurnServiceDeps {
  rollSummary(
    sessionId: string,
    entries: PersistedChatEntry[]
  ): Promise<{ summary: string | null; usage?: ChatTokenUsage; reason?: string }>;
}

export function createDefaultTurnDeps(): TurnServiceDeps {
  return {
    rollSummary: (sessionId, entries) => {
      let digestOf: ReturnType<typeof transcriptDigests> | undefined;
      try {
        digestOf = transcriptDigests(entries);
      } catch {
        digestOf = undefined;
      }
      return rollTranscriptSummary(undefined, entries, { sessionId, ...(digestOf ? { digestOf } : {}) });
    }
  };
}

/**
 * Takes entries out of a conversation and moves every position-held boundary
 * with them, the summary's and the condensed layer's — written before the
 * transcript, so the row the save announces to sync already carries them.
 * A summary left covering nothing Coach may read is dropped.
 */
function removeEntries(
  sessionId: string,
  entries: readonly PersistedChatEntry[],
  removed: readonly number[]
): { entries: PersistedChatEntry[]; through: number } {
  const stored = readSessionSummary(sessionId);
  const remaining = withoutIndices(entries, removed);
  const through = shiftBoundary(stored.through, removed);
  if (stored.summary) {
    const kept = through > 0 && speaksBefore(sessionId, remaining, through);
    writeSessionSummary(sessionId, kept ? stored.summary : null, kept ? through : null);
  }
  if (stored.condensedThrough !== undefined) {
    writeCondensedThrough(sessionId, shiftBoundary(stored.condensedThrough, removed));
  }
  saveChatSession(sessionId, remaining);
  return { entries: remaining, through };
}

/**
 * The summary written again from the turns it covers, now that one of them
 * is gone or hidden. Best-effort: the delete stands whatever this answers, and
 * the old summary stays until a rewrite succeeds. Announced to sync on its
 * own, since no save follows it.
 */
async function rewriteSummary(
  sessionId: string,
  entries: PersistedChatEntry[],
  through: number,
  deps: TurnServiceDeps
): Promise<Pick<TurnChange, "summary" | "summaryError">> {
  if (through <= 0 || !readSessionSummary(sessionId).summary) return {};
  if (!speaksBefore(sessionId, entries, through)) {
    // Nothing left to summarise: a summariser handed only placeholders would
    // write something about nothing.
    writeSessionSummary(sessionId, null, null);
    announceChatSessionRow(sessionId);
    return { summary: "rewritten" };
  }
  try {
    const result = await deps.rollSummary(sessionId, coachTranscript(sessionId, entries).slice(0, through));
    if (!result.summary) return { summary: "failed", ...(result.reason ? { summaryError: result.reason } : {}) };
    // Only over the summary it replaces: a turn sent while this ran may have
    // rolled the summary further, and that one covers more.
    if (readSessionSummary(sessionId).through !== through) return { summary: "failed" };
    writeSessionSummary(sessionId, result.summary, through);
    announceChatSessionRow(sessionId);
    return { summary: "rewritten" };
  } catch (caught) {
    return { summary: "failed", summaryError: caught instanceof Error ? caught.message : String(caught) };
  }
}

export async function deleteTurn(
  sessionId: string,
  ref: TurnRef,
  options: DeleteTurnOptions,
  deps: TurnServiceDeps = createDefaultTurnDeps()
): Promise<TurnChange> {
  const entries = getChatSession(sessionId);
  const range = resolveTurn(entries, ref);
  const cut = turnCut(entries, range, { deleteCreations: options.deleteCreations });
  const summarised = summarises(sessionId, range);

  const remaining = removeEntries(sessionId, cut.entries, cut.removed);
  deleteCreations(cut.deleting);
  forgetHidden(sessionId, entries[range.question]);

  const rewritten =
    summarised && options.rewriteSummary
      ? await rewriteSummary(sessionId, remaining.entries, remaining.through, deps)
      : {};
  return { entries: getChatSession(sessionId), hidden: listChatHiddenTurns(sessionId), ...rewritten };
}

/**
 * The last turn asked again: its question in `text` (unchanged for a retry),
 * everything Coach answered taken out — what it made deleted with it where it
 * can be, as the athlete decided an edit should. The window then sends the
 * question as a new turn.
 *
 * Only the last turn: a question edited further up would leave every turn
 * after it answering something that was never asked.
 */
export function editTurn(sessionId: string, ref: TurnRef, text: string): TurnChange {
  const content = text.trim();
  if (!content) throw new ScreenError("main.coach.questionEmpty");
  const entries = getChatSession(sessionId);
  const range = resolveTurn(entries, ref);
  if (turnRanges(entries).at(-1)?.question !== range.question) throw new ScreenError("main.coach.turnNotLast");
  const cut = turnCut(entries, range, { deleteCreations: true, answerOnly: true });
  const edited = cut.entries.map((entry, index) =>
    index === range.question && entry.kind === "message" ? { ...entry, content } : entry
  );
  // A question asked again is one Coach is meant to read — and is read so by
  // the summary check below.
  forgetHidden(sessionId, entries[range.question]);
  removeEntries(sessionId, edited, cut.removed);
  deleteCreations(cut.deleting);
  return { entries: getChatSession(sessionId), hidden: listChatHiddenTurns(sessionId) };
}

function forgetHidden(sessionId: string, question: PersistedChatEntry | undefined): void {
  if (question?.mid) setChatHiddenTurn(sessionId, question.mid, false);
}

/**
 * Every entry with its `mid`. A conversation not saved since identities were
 * minted has none, and a turn is hidden by its question's; saving it once
 * stamps them, as any save would.
 */
function identified(sessionId: string): PersistedChatEntry[] {
  const entries = getChatSession(sessionId);
  if (entries.every((entry) => entry.mid)) return entries;
  saveChatSession(sessionId, entries);
  return getChatSession(sessionId);
}

export function hiddenTurns(sessionId: string): string[] {
  return listChatHiddenTurns(sessionId);
}

/**
 * A turn kept on screen but out of what Coach reads, or put back. The summary
 * is a summary of what Coach could read, so a turn it covers asks the same
 * question deleting one does: leave it, or write it again now.
 */
export async function setTurnHidden(
  sessionId: string,
  ref: TurnRef,
  options: HideTurnOptions,
  deps: TurnServiceDeps = createDefaultTurnDeps()
): Promise<TurnChange> {
  const entries = identified(sessionId);
  const range = resolveTurn(entries, ref);
  const mid = entries[range.question]!.mid;
  if (!mid) throw new ScreenError("main.coach.turnChanged");
  setChatHiddenTurn(sessionId, mid, options.hidden);
  const rewritten =
    options.rewriteSummary && summarises(sessionId, range)
      ? await rewriteSummary(sessionId, entries, readSessionSummary(sessionId).through, deps)
      : {};
  return { entries, hidden: listChatHiddenTurns(sessionId), ...rewritten };
}

/**
 * What a branch leaves behind: anchors and cards naming rows of the original
 * conversation. Two conversations naming one draft or one proposal would
 * have deleting either take the other's with it (`deleteChatSessionById`
 * deletes what its transcript names), so what Coach made stays where it was
 * made, and the branch's head says where that is. A branch of a branch
 * leaves its parent's head too: the new one names where it came from.
 */
const LEFT_BEHIND = new Set([
  "branchedFrom",
  "planDraft",
  "planBrief",
  "planOutline",
  "planEvent",
  "planRefs",
  "scheduleChange",
  "workoutDelete"
]);

/** Marks the title of a branch in every language: a sign, not a word. */
const BRANCH_MARK = "↳ ";
const BRANCH_MARKS = new RegExp(`^(${BRANCH_MARK})+`);

/**
 * A new conversation holding this one up to and including the turn at
 * `ref`: same AI, same sources, same summary when it covers no more than
 * what was carried over, and the same turns hidden. Its entries are minted
 * afresh — a branch is a conversation of its own, not a copy that merges.
 */
export function branchConversation(sessionId: string, ref: TurnRef): ChatSessionSummary {
  const entries = identified(sessionId);
  const range = resolveTurn(entries, ref);
  const carried = entries.slice(0, range.end);
  const dropped = carried.flatMap((entry, index) => (LEFT_BEHIND.has(entry.kind) ? [index] : []));
  const kept = withoutIndices(carried, dropped);

  const provider = getChatSessionProvider(sessionId) ?? getChatSettings().provider;
  const title = getChatSessionTitle(sessionId) ?? "";
  const branch = createChatSession(provider);
  const head: PersistedChatEntry = { kind: "branchedFrom", sessionId, title };

  // The boundaries first, so the row the save announces to sync carries them.
  // Each is kept only when it reaches no further than the branch point — the
  // condensed layer only beside the summary it starts after, or with none —
  // and lands one place later for the head at the top.
  const stored = readSessionSummary(sessionId);
  const summaryCarried = Boolean(stored.summary) && stored.through > 0 && stored.through <= range.end;
  if (summaryCarried) {
    writeSessionSummary(branch.id, stored.summary!, shiftBoundary(stored.through, dropped) + 1);
  }
  if (
    stored.condensedThrough !== undefined &&
    stored.condensedThrough <= range.end &&
    (summaryCarried || !stored.summary)
  ) {
    writeCondensedThrough(branch.id, shiftBoundary(stored.condensedThrough, dropped) + 1);
  }
  // Without their identities, so the store mints the branch's own.
  saveChatSession(branch.id, [head, ...kept.map(({ mid: _mid, mrev: _mrev, ...entry }) => entry as PersistedChatEntry)]);

  // Turn for turn rather than entry for entry: the save may drop an entry it
  // cannot keep, and the questions are what a hidden turn is named by.
  const hidden = new Set(listChatHiddenTurns(sessionId));
  const minted = getChatSession(branch.id);
  const mintedTurns = turnRanges(minted);
  turnRanges(kept).forEach((turn, index) => {
    const original = kept[turn.question]!.mid;
    const copy = mintedTurns[index] ? minted[mintedTurns[index]!.question]!.mid : undefined;
    if (original && copy && hidden.has(original)) setChatHiddenTurn(branch.id, copy, true);
  });
  const settings = getConversationSettings(sessionId);
  setConversationSettings({ ...settings, sessionId: branch.id });

  return setChatSessionTitle(branch.id, `${BRANCH_MARK}${title.replace(BRANCH_MARKS, "")}`) ?? branch;
}
