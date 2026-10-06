// What a turn's tokens add up to, for every place that states one: the footer
// under an answer, an analysis's run-log row, the month's spend and the budget
// it is held to. The renderer imports this directly (like `activityMetrics.ts`),
// so it must stay free of `node:` imports.
//
// **A token read from the prompt cache is counted as a tenth of one.** Every
// tool round re-sends the whole prefix — the tools, the system prompt, the
// conversation so far — and a provider that caches answers most of it from
// there. Measured on 2026-10-06 with Claude Code: a three-round turn reported
// 92.5k input tokens of which 85k were cache reads, and cost less than a
// one-round turn of 27.5k whose prefix had to be written first. Counting every
// cache read as a whole token made that turn read as three times the dearer
// one, and an analysis budget drain about four times as fast as what was
// actually spent.
//
// A tenth is what Anthropic charges for a cache read against fresh input, and
// what OpenAI charges for cached input on its GPT-5 models. A cache *write* is
// counted whole: it is input the provider processed this turn (Anthropic
// charges it at 1.25× or 2×, depending on how long it is kept), and this is a
// count of tokens, not a bill.

import type { ChatTokenUsage } from "./types";

export const CACHE_READ_WEIGHT = 0.1;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * A usage report that can be counted, or nothing.
 *
 * "Nobody reported" and "it was free" are different facts (13), and a number
 * that is negative, NaN or infinite is neither — it is a third thing, and the
 * only honest reading of it is the first. Guarded here rather than only where
 * the run row is read, because this is where the number *enters*: a `local`
 * provider is whatever OpenAI-compatible server the athlete pointed the app at,
 * and a negative round would quietly reduce a total the month's budget trusts.
 *
 * The cache counts are parts of `inputTokens`, so one that is unusable or
 * larger than the input it is part of is dropped rather than trusted: absent
 * reads as "nothing came from the cache", which counts the turn in full.
 */
export function countableUsage(value: ChatTokenUsage | undefined): ChatTokenUsage | undefined {
  if (!value) return undefined;
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = value;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined;
  const usage: ChatTokenUsage = { inputTokens, outputTokens };
  const read = isCount(cacheReadTokens) && cacheReadTokens <= inputTokens ? cacheReadTokens : 0;
  const write =
    isCount(cacheWriteTokens) && read + cacheWriteTokens <= inputTokens ? cacheWriteTokens : 0;
  if (read > 0) usage.cacheReadTokens = read;
  if (write > 0) usage.cacheWriteTokens = write;
  return usage;
}

/**
 * Builds a usage report from what a provider said, with the cache counts as
 * parts of the input. Zero cache counts are left off, so a provider without a
 * cache and one that reported an empty cache produce the same object.
 */
export function tokenUsage(counts: {
  uncachedInput: number;
  cacheRead?: number;
  cacheWrite?: number;
  output: number;
}): ChatTokenUsage {
  const read = counts.cacheRead ?? 0;
  const write = counts.cacheWrite ?? 0;
  const usage: ChatTokenUsage = {
    inputTokens: counts.uncachedInput + read + write,
    outputTokens: counts.output
  };
  if (read > 0) usage.cacheReadTokens = read;
  if (write > 0) usage.cacheWriteTokens = write;
  return usage;
}

/**
 * Two reports summed — the rounds of one turn, or a roll and the run it ran
 * for. Undefined stays undefined: "nobody reported" is a different fact from
 * "it was free", and adding a reported number to an unreported one must not
 * invent the missing half as zero. One known and one unknown is the known part.
 */
export function addTokenUsage(
  left: ChatTokenUsage | undefined,
  right: ChatTokenUsage | undefined
): ChatTokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  const read = (left.cacheReadTokens ?? 0) + (right.cacheReadTokens ?? 0);
  const write = (left.cacheWriteTokens ?? 0) + (right.cacheWriteTokens ?? 0);
  const usage: ChatTokenUsage = {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens
  };
  if (read > 0) usage.cacheReadTokens = read;
  if (write > 0) usage.cacheWriteTokens = write;
  return usage;
}

/** The tokens a turn counts for: everything, with a cache read as a tenth. */
export function countedTokens(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}): number {
  const read = Math.min(usage.cacheReadTokens ?? 0, usage.inputTokens);
  return Math.round(usage.inputTokens - read + read * CACHE_READ_WEIGHT + usage.outputTokens);
}
