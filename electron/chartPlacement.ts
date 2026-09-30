/**
 * Where an answer puts the charts its turn drew.
 *
 * A chart is drawn by a read tool, not written by the model, so the tool's
 * result names it — `c1` for the turn's first chart, `c2` for the second —
 * and the answer may place it with `[[chart:c1]]` on a line of its own. A
 * chart the answer does not place keeps its default place, above the answer
 * (`orderTurn` in `src/chat/chatTypes.ts`), so a model that never uses a
 * placeholder, or uses one wrongly, reads exactly as before.
 *
 * Nothing is stored beside the entry: a handle is the chart's place among the
 * turn's charts, and those are the chart entries just above the answer. No new
 * field goes onto an existing entry kind, which is the rule an older build's
 * merge makes necessary; an older build shows the placeholder as text and the
 * chart above the answer.
 *
 * No `node:` imports: the renderer reads this too.
 */

const PLACEHOLDER = /\[\[chart:(c\d+)\]\]/g;
const PLACEHOLDER_LINE = /^\s*\[\[chart:(c\d+)\]\]\s*$/;
const FENCE = /^\s*(```|~~~)/;
/** A next step the answer offers (`splitNextSteps`). */
const NEXT_STEP = /\[\[next:([^\]\n]*)\]\]/g;
const NEXT_STEP_LINE = /^\s*\[\[next:[^\]\n]*\]\]\s*$/;

/** The handle of a turn's chart, by its place among the turn's charts (0 = first). */
export function chartHandle(ordinal: number): string {
  return `c${ordinal + 1}`;
}

/** What a tool result adds when the call drew charts: how the answer names them. */
export function chartHandleNote(handles: readonly string[]): string {
  const named = [...new Set(handles)];
  return named.length === 1
    ? `[Drawn for the athlete as chart ${named[0]}.]`
    : `[Drawn for the athlete as charts ${named.join(", ")}.]`;
}

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "chart"; handle: string };

/**
 * An answer cut where it places its charts.
 *
 * A placeholder on its own line is placed there. One inside a sentence, a list
 * or a table is taken out of the line and placed after that block — at the
 * next blank line — because cutting a paragraph there would split a list or a
 * table in two. A handle `known` does not answer for is dropped, a chart is
 * placed once however often it is named, and nothing inside a code fence is
 * read as a placeholder.
 */
export function placeCharts(
  content: string,
  known: (handle: string) => boolean
): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const placed = new Set<string>();
  let lines: string[] = [];
  let waiting: string[] = [];
  let fenced = false;

  const flushText = () => {
    const text = lines.join("\n");
    lines = [];
    if (text.trim()) segments.push({ kind: "text", text });
  };
  const place = (handle: string) => {
    if (placed.has(handle) || !known(handle)) return;
    placed.add(handle);
    flushText();
    segments.push({ kind: "chart", handle });
  };
  const placeWaiting = () => {
    const handles = waiting;
    waiting = [];
    for (const handle of handles) place(handle);
  };

  for (const line of content.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      lines.push(line);
      continue;
    }
    if (fenced) {
      lines.push(line);
      continue;
    }
    const alone = PLACEHOLDER_LINE.exec(line);
    if (alone) {
      placeWaiting();
      place(alone[1]);
      continue;
    }
    if (!line.trim()) {
      placeWaiting();
      lines.push(line);
      continue;
    }
    const named = [...line.matchAll(PLACEHOLDER)].map((match) => match[1]);
    if (named.length > 0) {
      waiting.push(...named);
      lines.push(line.replace(PLACEHOLDER, "").replace(/[ \t]{2,}/g, " ").trimEnd());
      continue;
    }
    lines.push(line);
  }
  placeWaiting();
  flushText();
  return segments;
}

/**
 * An answer as text, placeholders and next steps taken out: a summary, a
 * preview, the model's own history. A next step is for the athlete to press;
 * on a later turn it would only be words Coach has to read again.
 */
export function stripChartPlaceholders(text: string): string {
  if (!text.includes("[[chart:") && !text.includes("[[next:")) return text;
  return text
    .split("\n")
    .filter((line) => !PLACEHOLDER_LINE.test(line) && !NEXT_STEP_LINE.test(line))
    .map((line) =>
      line.replace(PLACEHOLDER, "").replace(NEXT_STEP, "").replace(/[ \t]{2,}/g, " ").trimEnd()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/*
 * Next steps. An answer may end with up to three `[[next:…]]` lines, each a
 * concrete change Coach found and chose not to make itself. They are drawn as
 * chips under the conversation's last answer, and a press sends the chip's
 * words as the athlete's question. They live in the answer's text, so nothing
 * is stored beside the entry, for the reason charts are not.
 */
export const MAX_NEXT_STEPS = 3;

/** An answer's words, and the next steps it offers (at most three, each once). */
export function splitNextSteps(text: string): { text: string; steps: string[] } {
  if (!text.includes("[[next:")) return { text, steps: [] };
  const steps = [
    ...new Set([...text.matchAll(NEXT_STEP)].map((match) => match[1].trim()).filter(Boolean))
  ].slice(0, MAX_NEXT_STEPS);
  const words = text
    .split("\n")
    .filter((line) => !NEXT_STEP_LINE.test(line))
    .map((line) => line.replace(NEXT_STEP, "").replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { text: words, steps };
}

/**
 * Streamed text with the start of a placeholder held back.
 *
 * Tokens arrive in pieces, so `[[cha` is on screen before `rt:c1]]` is. What
 * could still become a placeholder is left off the end until it either
 * completes or turns out to be something else.
 */
export function holdBackPartialPlaceholder(text: string): string {
  const starts = [text.lastIndexOf("[["), text.endsWith("[") ? text.length - 1 : -1];
  for (const start of starts) {
    if (start < 0) continue;
    const tail = text.slice(start);
    if (
      "[[chart:c".startsWith(tail) ||
      /^\[\[chart:c\d*\]?$/.test(tail) ||
      "[[next:".startsWith(tail) ||
      /^\[\[next:[^\]\n]*\]?$/.test(tail)
    ) {
      return text.slice(0, start);
    }
  }
  return text;
}
