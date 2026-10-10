import { describeChatModel } from "../../electron/chatModels";
import { CACHE_READ_WEIGHT, countedTokens } from "../../electron/tokenUsage";
import type { ChatTokenUsage } from "../../electron/types";
import { formatCount, formatDecimal, t } from "../i18n/core";

/**
 * The footer under an answer: what it cost and what wrote it.
 *
 * Input and output are summed into one number on purpose. The split matters to
 * a bill and is in the `title` the footer carries, but the question this line
 * answers is "was that turn expensive?", and two numbers make that a subtraction
 * the reader has to do. The whole point of the footer is that the athlete can
 * see a 40k answer without opening anything.
 *
 * A token read from the prompt cache counts as a tenth (`tokenUsage.ts`), as it
 * does for the analysis budget, so the footer, the run log and the month's
 * spend state one number. Counted whole, a turn of three tool rounds read as
 * 92k when 85k of it was the same prefix answered from the cache.
 */
export function totalTokens(usage: ChatTokenUsage): number {
  return countedTokens(usage);
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
    return formatCount(count);
  }
  const thousands = count / 1_000;
  // The unit is chosen after rounding, not before. A turn of 999,990 tokens is
  // 1000.0k to one decimal, which is not a number anyone writes — it is 1M. A
  // 1M-context model makes that reachable in one turn, so it is not theoretical.
  return thousands >= 999.95
    ? `${trimTrailingZero(formatDecimal(count / 1_000_000, 1))}M`
    : `${trimTrailingZero(formatDecimal(thousands, 1))}k`;
}

function trimTrailingZero(value: string): string {
  return value.replace(/[.,]0$/, "");
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
  const tokens = t("chat.cost.tokens", { count: formatTokenCount(totalTokens(usage)) });
  const name = model ? describeChatModel(model) : "";
  return name ? `${name} - ${tokens}` : tokens;
}

/**
 * The breakdown, for the footer's tooltip. With a cache, the input is split
 * into what was new, what was written to the cache and what was read from it,
 * and the read says what it counted for — the one part of the line the footer's
 * number does not take at face value.
 */
export function formatTurnCostDetail(usage: ChatTokenUsage): string {
  const round = (value: number) => formatCount(Math.max(0, Math.round(value)));
  const read = usage.cacheReadTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  if (!read && !write) {
    return [
      t("chat.cost.input", { count: round(usage.inputTokens) }),
      t("chat.cost.output", { count: round(usage.outputTokens) })
    ].join(" · ");
  }
  return [
    t("chat.cost.input", { count: round(usage.inputTokens - read - write) }),
    ...(write ? [t("chat.cost.cacheWrite", { count: round(write) })] : []),
    ...(read ? [t("chat.cost.cacheRead", { count: round(read), counted: round(read * CACHE_READ_WEIGHT) })] : []),
    t("chat.cost.output", { count: round(usage.outputTokens) })
  ].join(" · ");
}
