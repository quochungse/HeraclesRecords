import { getChatSession, saveChatSession } from "./chatHistoryStore";
import {
  readSessionSummary,
  rollTranscriptSummary,
  writeCondensedThrough,
  writeSessionSummary
} from "./chatContextService";
import { resolveCompressionRuntime, transcriptDigests } from "./chatCompression";
import { providerModelOptions } from "./chatModels";
import { getChatSettings } from "./chatService";
import {
  shiftBoundary,
  turnRanges,
  turnRemoval,
  withoutIndices,
  type TurnRange
} from "./chatTurns";
import { creationOfDraft, deletePlanDraftsOf } from "./chatWorkoutTools";
import { readScheduleChanges } from "./chatScheduleChanges";
import { deleteChatScheduleChanges } from "./database";
import { ScreenError } from "./screenText";
import type {
  ChatTokenUsage,
  DeleteTurnOptions,
  PersistedChatEntry,
  TurnChange,
  TurnCreation,
  TurnDescription,
  TurnRef
} from "./types";

/**
 * Deleting a turn of a conversation (and, later, editing and hiding one).
 *
 * Done here rather than by the window saving a shorter transcript: a save
 * that shortens the row is exactly what `foreignTail` refuses — it reads as
 * "the row grew behind my back" and puts the tail back — and an analysis
 * appending to the same row from this process must not race a delete the
 * window thinks it made. Read, cut and written with nothing awaited between,
 * a turn's removal is atomic against both.
 *
 * The window flushes its own pending save first and names the turn by its
 * question's position and words (`TurnRef`), which this side checks against
 * the row before it touches anything.
 */

/** The turn the window means: at the position it names, or the one turn asked in those words. */
function resolveTurn(entries: readonly PersistedChatEntry[], ref: TurnRef): TurnRange {
  const turns = turnRanges(entries);
  const asked = (range: TurnRange) => {
    const question = entries[range.question];
    return question?.kind === "message" && question.content === ref.content;
  };
  const atIndex = turns.find((range) => range.question === ref.index && asked(range));
  if (atIndex) return atIndex;
  const matching = turns.filter(asked);
  if (matching.length === 1) return matching[0]!;
  throw new ScreenError("main.coach.turnChanged");
}

interface CreationInTurn extends TurnCreation {
  /** The cards of it in the turn, and what deleting it removes. */
  indices: number[];
  draftIds: string[];
  changeSetIds: string[];
}

/**
 * What the turn made that lives on in a table of its own. A plan or workout
 * can be deleted with the turn only when nothing of it is saved and every
 * version's card is in this turn: a version written in a later turn would be
 * left pointing at nothing.
 */
function creationsIn(entries: readonly PersistedChatEntry[], range: TurnRange): CreationInTurn[] {
  const turnDrafts = new Map<string, number>();
  for (let index = range.start; index < range.end; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === "planDraft") turnDrafts.set(entry.draft.draftId, index);
  }
  const creations: CreationInTurn[] = [];
  const seen = new Set<string>();
  for (let index = range.start; index < range.end; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === "planDraft") {
      if (entry.draft.removedAt) continue;
      const creation = creationOfDraft(entry.draft.draftId);
      const key = creation?.artifactId ?? entry.draft.draftId;
      if (seen.has(key)) continue;
      seen.add(key);
      const draftIds = creation?.draftIds ?? [entry.draft.draftId];
      const blocked = creation?.saved ? "saved" : draftIds.every((id) => turnDrafts.has(id)) ? undefined : "versions";
      creations.push({
        kind: entry.draft.artifactType === "workout" ? "workout" : "plan",
        name: entry.draft.name,
        deletable: !blocked,
        ...(blocked ? { keptBecause: blocked } : {}),
        indices: draftIds.flatMap((id) => (turnDrafts.has(id) ? [turnDrafts.get(id)!] : [])),
        draftIds,
        changeSetIds: []
      });
    } else if (entry.kind === "scheduleChange") {
      const set = readScheduleChanges([entry.changeSetId])[0];
      creations.push({
        kind: "changes",
        name: set?.summary ?? "",
        deletable: true,
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
 */
function turnCut(
  entries: readonly PersistedChatEntry[],
  range: TurnRange,
  options: { deleteCreations: boolean; answerOnly?: boolean }
): { deleting: CreationInTurn[]; removed: number[] } {
  const creations = creationsIn(entries, range);
  const deleting = options.deleteCreations ? creations.filter((creation) => creation.deletable) : [];
  const keptCards = new Set(
    creations.filter((creation) => !deleting.includes(creation)).flatMap((creation) => creation.indices)
  );
  const removed = turnRemoval(entries, range, {
    keepCreations: false,
    ...(options.answerOnly ? { answerOnly: true } : {})
  }).filter((index) => !keptCards.has(index));
  return { deleting, removed };
}

function deleteCreations(creations: readonly CreationInTurn[]): void {
  deletePlanDraftsOf(creations.flatMap((creation) => creation.draftIds));
  deleteChatScheduleChanges(creations.flatMap((creation) => creation.changeSetIds));
}

/** Whether the stored summary speaks for any of these entries. */
function summarises(sessionId: string, removed: readonly number[]): boolean {
  const stored = readSessionSummary(sessionId);
  return Boolean(stored.summary) && removed.some((index) => index < stored.through);
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
  const removed = turnRemoval(entries, range, { keepCreations: false });
  const summarised = summarises(sessionId, removed);
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
 * A summary left covering nothing is dropped.
 */
function removeEntries(
  sessionId: string,
  entries: readonly PersistedChatEntry[],
  removed: readonly number[]
): { entries: PersistedChatEntry[]; through: number } {
  const stored = readSessionSummary(sessionId);
  const through = shiftBoundary(stored.through, removed);
  if (stored.summary) writeSessionSummary(sessionId, through > 0 ? stored.summary : null, through > 0 ? through : null);
  if (stored.condensedThrough !== undefined) {
    writeCondensedThrough(sessionId, shiftBoundary(stored.condensedThrough, removed));
  }
  const remaining = withoutIndices(entries, removed);
  saveChatSession(sessionId, remaining);
  return { entries: remaining, through };
}

/**
 * The summary written again from the turns it covers, now that one of them
 * is gone. Best-effort: the delete stands whatever this answers, and the old
 * summary stays until a rewrite succeeds.
 */
async function rewriteSummary(
  sessionId: string,
  entries: PersistedChatEntry[],
  through: number,
  deps: TurnServiceDeps
): Promise<Pick<TurnChange, "summary" | "summaryError">> {
  if (through <= 0) return {};
  try {
    const result = await deps.rollSummary(sessionId, entries.slice(0, through));
    if (!result.summary) return { summary: "failed", ...(result.reason ? { summaryError: result.reason } : {}) };
    // Only over the summary it replaces: a turn sent while this ran may have
    // rolled the summary further, and that one covers more.
    if (readSessionSummary(sessionId).through !== through) return { summary: "failed" };
    writeSessionSummary(sessionId, result.summary, through);
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
  const { deleting, removed } = turnCut(entries, range, { deleteCreations: options.deleteCreations });
  const summarised = summarises(sessionId, removed);

  const { through } = removeEntries(sessionId, entries, removed);
  deleteCreations(deleting);

  const rewritten =
    summarised && options.rewriteSummary
      ? await rewriteSummary(sessionId, getChatSession(sessionId), through, deps)
      : {};
  return { entries: getChatSession(sessionId), ...rewritten };
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
  if (!content) throw new Error("A question needs words.");
  const entries = getChatSession(sessionId);
  const range = resolveTurn(entries, ref);
  if (turnRanges(entries).at(-1)?.question !== range.question) throw new ScreenError("main.coach.turnNotLast");
  const { deleting, removed } = turnCut(entries, range, { deleteCreations: true, answerOnly: true });
  const edited = entries.map((entry, index) =>
    index === range.question && entry.kind === "message" ? { ...entry, content } : entry
  );
  removeEntries(sessionId, edited, removed);
  deleteCreations(deleting);
  return { entries: getChatSession(sessionId) };
}
