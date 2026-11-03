import type { CoachInputPrompt } from "../../electron/types";
import type { ChatEntry } from "./chatTypes";

/**
 * Coach's questions asked in one call (up to three, `request_coach_input`) sit
 * side by side in the transcript, each its own `coachPrompt` entry. While they
 * wait they are one card, picked one by one and sent together; the answers go
 * back in one turn (`toWireMessages` numbers them). A question left without a
 * pick is closed as skipped: answered at the same moment, with no words.
 *
 * Nothing here is a new stored field — an answer is the entry's own `answer`,
 * `selectedChoiceId` and `answeredAt` — so a build that knows only single
 * questions reads every one of them.
 */

/** What the athlete has picked on a waiting question: a choice, or words of their own. */
export interface QuestionPick {
  choiceId?: string;
  text?: string;
}

export function isPicked(pick: QuestionPick | undefined): boolean {
  return Boolean(pick?.choiceId || pick?.text?.trim());
}

function isWaiting(entry: ChatEntry | undefined): entry is Extract<ChatEntry, { kind: "coachPrompt" }> {
  return entry?.kind === "coachPrompt" && entry.prompt.answeredAt === undefined;
}

/** The indices of the waiting questions asked with the one at `index`, in order; none if it is not waiting. */
export function waitingQuestionsAround(entries: readonly ChatEntry[], index: number): number[] {
  if (!isWaiting(entries[index])) return [];
  let start = index;
  while (isWaiting(entries[start - 1])) start -= 1;
  const indices: number[] = [];
  for (let at = start; isWaiting(entries[at]); at += 1) indices.push(at);
  return indices;
}

/** The last waiting question's group — what words typed in the composer now answer, or close. */
export function lastWaitingQuestions(entries: readonly ChatEntry[]): number[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isWaiting(entries[index])) return waitingQuestionsAround(entries, index);
  }
  return [];
}

/** A question with its pick written in: the choice's response or the athlete's words, or skipped. */
export function answerQuestion(prompt: CoachInputPrompt, pick: QuestionPick | undefined, at: number): CoachInputPrompt {
  const { selectedChoiceId: _previous, ...rest } = prompt;
  const choice = pick?.choiceId ? prompt.choices.find((option) => option.id === pick.choiceId) : undefined;
  return {
    ...rest,
    answer: choice ? choice.response : pick?.text?.trim() ?? "",
    answeredAt: at,
    ...(choice ? { selectedChoiceId: choice.id } : {})
  };
}

/** The entries with these questions answered from their picks, all at one moment. */
export function answerQuestions(
  entries: readonly ChatEntry[],
  indices: readonly number[],
  picks: Readonly<Record<string, QuestionPick>>,
  at: number
): ChatEntry[] {
  const chosen = new Set(indices);
  return entries.map((entry, index): ChatEntry =>
    chosen.has(index) && entry.kind === "coachPrompt"
      ? { ...entry, prompt: answerQuestion(entry.prompt, picks[entry.prompt.promptId], at) }
      : entry
  );
}

/** A question closed with nothing picked. */
export function isSkipped(prompt: CoachInputPrompt): boolean {
  return prompt.answeredAt !== undefined && !prompt.answer && !prompt.selectedChoiceId;
}
