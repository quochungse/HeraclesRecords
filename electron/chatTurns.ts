/**
 * A conversation as turns: the athlete's message and everything Coach put
 * after it, up to their next one. Deleting, editing and hiding work on a turn,
 * never on one entry, so a question cannot be left without its answer or an
 * answer without the question it answers.
 *
 * Node-free: the renderer draws the actions and the dialog from the same
 * ranges the main process deletes, so the two cannot disagree about what a
 * turn holds. Both entry shapes work (`ChatEntry` on screen,
 * `PersistedChatEntry` on disk) — only `kind`, `role` and `mid` are read.
 */

export interface TurnEntryLike {
  kind: string;
  role?: string;
  mid?: string;
}

export interface TurnRange {
  /** The first entry: the references the question was asked with, or the question. */
  start: number;
  /** The athlete's message. */
  question: number;
  /** One past the turn's last entry. */
  end: number;
}

/** Anchors that go with the question they stand in front of. */
const QUESTION_ANCHORS = new Set(["planRefs", "scheduleRefs"]);

/**
 * Entries a turn's removal leaves where they are. None of them is the
 * question or the answer: a brief and its outline belong to the plan
 * pipeline, a plan event to the creation it records, an analysis trace to its
 * analysis, and an entry a newer build wrote to that build.
 */
const KEPT_KINDS = new Set([
  "planBrief",
  "planOutline",
  "planEvent",
  "opaque",
  "automationSilent",
  "automationStopped"
]);

/** Cards whose rows outlive the transcript: kept unless the athlete deletes them too. */
const CREATION_KINDS = new Set(["planDraft", "scheduleChange"]);

/**
 * What goes on the wire, and so what hiding a turn masks: the words of it.
 * Cards are not sent anyway, and a plan event speaks for a creation rather
 * than for the turn it landed in.
 */
const SPOKEN_KINDS = new Set(["message", "toolNotice", "coachPrompt", "planRefs", "scheduleRefs"]);

function isQuestionEntry(entry: TurnEntryLike): boolean {
  return entry.kind === "message" && entry.role === "user";
}

/** Every turn in order. Entries before the first question belong to none. */
export function turnRanges(entries: readonly TurnEntryLike[]): TurnRange[] {
  const ranges: TurnRange[] = [];
  entries.forEach((entry, index) => {
    if (!isQuestionEntry(entry)) return;
    let start = index;
    while (start > 0 && QUESTION_ANCHORS.has(entries[start - 1]!.kind)) start -= 1;
    const previous = ranges[ranges.length - 1];
    if (previous) previous.end = start;
    ranges.push({ start, question: index, end: entries.length });
  });
  return ranges;
}

export interface TurnRemovalOptions {
  /** Leave the turn's creation cards where they are. */
  keepCreations: boolean;
  /** Only what came after the question (an edit or a retry): the question stays. */
  answerOnly?: boolean;
}

/** The indices a turn's removal takes out of the transcript, ascending. */
export function turnRemoval(
  entries: readonly TurnEntryLike[],
  range: TurnRange,
  options: TurnRemovalOptions
): number[] {
  const from = options.answerOnly ? range.question + 1 : range.start;
  const removed: number[] = [];
  for (let index = from; index < range.end; index += 1) {
    const kind = entries[index]!.kind;
    if (KEPT_KINDS.has(kind)) continue;
    if (options.keepCreations && CREATION_KINDS.has(kind)) continue;
    removed.push(index);
  }
  return removed;
}

/**
 * Where a position-held boundary — the summary's `through`, the condensed
 * layer's start, a window's count — lands once these entries are gone.
 */
export function shiftBoundary(boundary: number, removed: readonly number[]): number {
  return boundary - removed.filter((index) => index < boundary).length;
}

export function withoutIndices<T>(entries: readonly T[], removed: readonly number[]): T[] {
  const gone = new Set(removed);
  return entries.filter((_entry, index) => !gone.has(index));
}

/**
 * The transcript as Coach reads it: every spoken entry of a hidden turn put
 * out of sight by `placeholder`, which sends nothing. Replaced rather than
 * removed, so a summary's `through` and every other position-held boundary
 * still counts the transcript that is stored.
 *
 * A turn is hidden by its question's `mid`; an entry without one cannot be.
 */
export function maskHiddenTurns<T extends TurnEntryLike>(
  entries: readonly T[],
  hidden: ReadonlySet<string>,
  placeholder: () => T
): T[] {
  if (!hidden.size) return [...entries];
  const masked = [...entries];
  for (const range of turnRanges(entries)) {
    const mid = entries[range.question]!.mid;
    if (!mid || !hidden.has(mid)) continue;
    for (let index = range.start; index < range.end; index += 1) {
      if (SPOKEN_KINDS.has(entries[index]!.kind)) masked[index] = placeholder();
    }
  }
  return masked;
}

/** What a masked entry is stored as on the wire's way: an opaque entry with nothing in it. */
export const HIDDEN_TURN_PLACEHOLDER = { kind: "opaque" as const, raw: { kind: "hiddenTurn" } };
