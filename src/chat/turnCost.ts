import { describeChatModel } from "../../electron/chatModels";
import type { ChatTokenUsage } from "../../electron/types";

/**
 * The footer under an answer: what it cost and what wrote it.
 *
 * Input and output are summed into one number on purpose. The split matters to
 * a bill and is in the `title` the footer carries, but the question this line
 * answers is "was that turn expensive?", and two numbers make that a subtraction
 * the reader has to do. The whole point of the footer is that the athlete can
 * see a 40k answer without opening anything.
 */
export function totalTokens(usage: ChatTokenUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

/**
 * Counts as a person reads them: `847`, `23.2k`, `1.4M`.
 *
 * Thousands keep one decimal because that is the range a chat turn lives in and
 * where the difference between 12.4k and 12.9k is the difference worth seeing;
 * rounding to `12k` there would make most turns look identical. Below 1,000 the
 * exact number is short enough to print, and it is grouped so `847` and `8,470`
 * cannot be mistaken for each other at a glance.
 */
export function formatTokenCount(tokens: number): string {
  const count = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  if (count < 1_000) {
    return count.toLocaleString("en-US");
  }
  const thousands = count / 1_000;
  // The unit is chosen after rounding, not before. A turn of 999,990 tokens is
  // 1000.0k to one decimal, which is not a number anyone writes — it is 1M. A
  // 1M-context model makes that reachable in one turn, so it is not theoretical.
  return thousands >= 999.95
    ? `${trimTrailingZero((count / 1_000_000).toFixed(1))}M`
    : `${trimTrailingZero(thousands.toFixed(1))}k`;
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}

/**
 * `Opus 5 - 23.2k Tokens`, or just the count when no provider named the model.
 *
 * A missing model drops the name rather than printing a placeholder: the cost
 * is the fact worth showing, and "Unknown - 23.2k Tokens" adds a word that
 * tells the reader nothing. A missing *count* is what leaves the whole footer
 * unrendered, which the caller decides — see `TurnCostFooter`.
 */
export function formatTurnCost(usage: ChatTokenUsage, model?: string): string {
  const tokens = `${formatTokenCount(totalTokens(usage))} Tokens`;
  const name = model ? describeChatModel(model) : "";
  return name ? `${name} - ${tokens}` : tokens;
}

/** The breakdown, for the footer's tooltip. */
export function formatTurnCostDetail(usage: ChatTokenUsage): string {
  const round = (value: number) => Math.max(0, Math.round(value));
  return [
    `Input ${round(usage.inputTokens).toLocaleString("en-US")}`,
    `Output ${round(usage.outputTokens).toLocaleString("en-US")}`
  ].join(" · ");
}
