import { toWireMessages } from "./chatContextCompaction";
import type { ChatEntryMergeMeta, ChatMessage, ChatRole, PersistedChatEntry } from "./types";

/**
 * The search behind `recall_conversation` (`chatConversationTools.ts`), apart
 * from the store so a suite can reach it without SQLite.
 */

export const DEFAULT_RECALLED = 2;
export const MAX_RECALLED = 5;
/** What one line of an exchange may take in a result, so a recall costs a few thousand tokens at most. */
const LINE_CHARS: Record<ChatRole, number> = { user: 1_500, assistant: 3_500 };

/** A stretch of the conversation as the wire carried it: an athlete's message and what followed. */
interface Exchange {
  /** Its place among the earlier exchanges, from 1. */
  number: number;
  at?: number;
  lines: ChatMessage[];
}

/**
 * When the store first saw an entry, from its `mid` — the rule
 * `entryTimeFromMid` in `src/chat/chatTypes.ts` states for the renderer.
 */
function entryTime(entry: PersistedChatEntry): number | undefined {
  const mid = (entry as ChatEntryMergeMeta).mid;
  if (!mid || mid.includes("~")) return undefined;
  const match = /^1-([0-9a-f]{12})-/.exec(mid);
  return match ? parseInt(match[1]!, 16) : undefined;
}

/** Entries `toWireMessages` folds into the athlete message after them rather than sending as their own. */
const RIDES_ON_NEXT = new Set<PersistedChatEntry["kind"]>(["planRefs", "scheduleRefs", "planEvent"]);
/** Entries that are words on the wire; every other kind (a card) sends nothing. */
const SENDS_WORDS = new Set<PersistedChatEntry["kind"]>(["message", "coachPrompt"]);

/**
 * The entries as exchanges. One opens at each athlete message — except that a
 * question Coach asked on a card opens its own, so the answer the athlete
 * picked stays with the question rather than starting the next exchange.
 */
function exchangesOf(entries: PersistedChatEntry[]): Exchange[] {
  const exchanges: Exchange[] = [];
  let current: Exchange | undefined;
  let held: PersistedChatEntry[] = [];
  const add = (entry: PersistedChatEntry) => {
    // One entry at a time, so each message keeps the time of the entry it came
    // from — with the notes before it, so "asking about" stays on its question.
    const group = [...held, entry];
    held = [];
    toWireMessages(group).forEach((message, index) => {
      const opens = entry.kind === "coachPrompt" ? index === 0 : message.role === "user";
      if (opens || !current) {
        const at = entryTime(entry);
        current = { number: exchanges.length + 1, ...(at !== undefined ? { at } : {}), lines: [] };
        exchanges.push(current);
      }
      const last = current.lines.at(-1);
      if (last?.role === message.role) last.content = `${last.content}\n\n${message.content}`;
      else current.lines.push({ ...message });
    });
  };
  for (const entry of entries) {
    if (SENDS_WORDS.has(entry.kind)) add(entry);
    else if (RIDES_ON_NEXT.has(entry.kind)) held.push(entry);
  }
  const trailing = held.pop();
  if (trailing) add(trailing);
  return exchanges;
}

/** Lowercase, accents off and `đ` to `d`, so "tốc độ" finds "toc do" and the other way round. */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

function wordsOf(text: string): string[] {
  return foldForSearch(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function termsOf(query: string): string[] {
  return [...new Set(wordsOf(query).filter((term) => term.length >= 2 || /\d/.test(term)))];
}

/**
 * How often a term occurs among words — whole words, since a Vietnamese word
 * is a syllable and "do" (độ) must not be found inside "doan" (đoạn); a term of
 * four letters or more also finds the words it begins ("interval" → "intervals").
 */
function occurrences(words: readonly string[], term: string): number {
  return words.filter((word) => word === term || (term.length >= 4 && word.startsWith(term))).length;
}

/**
 * A long line cut to what the query is about: the opening paragraph, which
 * usually states the answer, then the paragraphs that match.
 */
function excerpt(text: string, terms: string[], limit: number): string {
  if (text.length <= limit) return text;
  const paragraphs = text.split(/\n{2,}/);
  const picked = new Set<number>([0]);
  paragraphs.forEach((paragraph, index) => {
    const words = wordsOf(paragraph);
    if (terms.some((term) => occurrences(words, term))) picked.add(index);
  });
  let out = "";
  let last = -1;
  for (const index of [...picked].sort((a, b) => a - b)) {
    const paragraph = paragraphs[index]!;
    if (!out) {
      out = paragraph.length > limit ? `${paragraph.slice(0, limit)} […]` : paragraph;
    } else {
      const piece = `${index > last + 1 ? "[…]\n\n" : ""}${paragraph}`;
      if (out.length + piece.length > limit) return `${out}\n\n[…]`;
      out += `\n\n${piece}`;
    }
    last = index;
  }
  return last < paragraphs.length - 1 ? `${out}\n\n[…]` : out;
}

function formatDay(at: number | undefined): string {
  return at === undefined ? "" : ` · ${new Date(at).toISOString().slice(0, 10)}`;
}

/** How many neighbouring pairs of the query's terms stand side by side somewhere in `words`. */
function pairsHeld(words: readonly string[], terms: readonly string[]): number {
  let held = 0;
  for (let index = 0; index + 1 < terms.length; index += 1) {
    const [first, second] = [terms[index], terms[index + 1]];
    if (words.some((word, at) => word === first && words[at + 1] === second)) held += 1;
  }
  return held;
}

/**
 * The best-matching exchanges among `entries`, in the order they happened.
 *
 * An exchange scores one for every term of the query it holds anywhere, half
 * again for two of them side by side as the query has them — Vietnamese words
 * are syllables, so "bắp chân" is two terms and "chân" alone is in half the
 * conversation — and a little for how often. An exchange holding fewer terms
 * than the best one is not returned beside it: a recall is paid for in tokens,
 * and a near miss costs as much as the answer. Ties go to the later exchange,
 * the one the athlete more likely means.
 */
export function recallEarlierTurns(
  entries: PersistedChatEntry[],
  query: string,
  limit = DEFAULT_RECALLED
): string {
  const exchanges = exchangesOf(entries);
  if (!exchanges.length) {
    return "Nothing in this conversation lies outside what you can already read.";
  }
  const terms = termsOf(query);
  if (!terms.length) {
    return "Give the words the exchange would contain.";
  }
  const scored = exchanges
    .map((exchange) => {
      const words = exchange.lines.flatMap((line) => wordsOf(line.content));
      let held = 0;
      let hits = 0;
      for (const term of terms) {
        const count = occurrences(words, term);
        if (count) held += 1;
        hits += count;
      }
      return { exchange, held, score: held + pairsHeld(words, terms) / 2 + Math.min(hits, 20) / 100 };
    })
    .filter((candidate) => candidate.held > 0);
  const best = Math.max(0, ...scored.map((candidate) => candidate.held));
  const recalled = scored
    .filter((candidate) => candidate.held === best)
    .sort((a, b) => b.score - a.score || b.exchange.number - a.exchange.number)
    .slice(0, Math.min(Math.max(1, Math.round(limit)), MAX_RECALLED))
    .map((candidate) => candidate.exchange)
    .sort((a, b) => a.number - b.number);
  if (!recalled.length) {
    return (
      `No earlier exchange mentions "${query}" (${exchanges.length} searched). ` +
      "If the summary does not say either, tell the athlete it was not discussed rather than guessing."
    );
  }
  return [
    `${recalled.length} of the ${exchanges.length} earlier exchanges match "${query}", oldest first:`,
    ...recalled.map((exchange) =>
      [
        `--- Exchange ${exchange.number}${formatDay(exchange.at)} ---`,
        ...exchange.lines.map(
          (line) =>
            `${line.role === "user" ? "Athlete" : "Coach"}: ${excerpt(line.content, terms, LINE_CHARS[line.role])}`
        )
      ].join("\n")
    )
  ].join("\n\n");
}
