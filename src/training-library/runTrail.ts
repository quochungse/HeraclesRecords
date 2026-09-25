/**
 * What a run has done so far, in the athlete's words: each read Coach makes,
 * each point its thinking turns to, and each time the check hands a draft
 * back. A long run with nothing but a spinner reads as stuck; a line per thing
 * the model actually did reads as work.
 *
 * Built only from what the stream says — the tool names on `chat:streamInfo`,
 * the thinking summary the Claude providers send and the text the model
 * writes. Nothing here is invented to fill a pause: a provider that sends no
 * thinking shows its reads and its checks and nothing more.
 */

export interface TrailItem {
  /** A read or a step of the work, a point the thinking turns to, a draft sent back, or the check passed. */
  kind: "read" | "thought" | "check" | "passed";
  /** While it is the latest thing the run is doing. */
  doing: string;
  /** Once something else has followed it. */
  done: string;
  /** The same read made again in a row: three sessions looked at is one line. */
  count: number;
}

export interface RunNotes {
  trail: TrailItem[];
  /** The thinking and the text so far, as the stream sent them. */
  notes: string;
  /** Where in `notes` the next heading is looked for. */
  scanned: number;
  /** Which stream `notes` last grew from: a switch starts a new paragraph. */
  source?: "thinking" | "text";
}

export const EMPTY_NOTES: RunNotes = { trail: [], notes: "", scanned: 0 };

/** The longest `notes` kept: the tail is what is shown, and headings are taken as they arrive. */
const NOTES_LIMIT = 20_000;

const READS: Record<string, [doing: string, done: string]> = {
  list_recent_activities: ["Reading your recent activities", "Read your recent activities"],
  get_activity_detail: ["Looking at a session in detail", "Looked at a session in detail"],
  get_fitness_trends: ["Reading your fitness trends", "Read your fitness trends"],
  get_training_zones: ["Reading your training zones", "Read your training zones"],
  get_sleep_summary: ["Reading your sleep and recovery", "Read your sleep and recovery"],
  list_scheduled_workouts: ["Checking your calendar", "Checked your calendar"],
  search_coros_exercises: ["Finding exercises in the COROS library", "Found exercises in the COROS library"]
};

/** A read, as a line. An unknown COROS MCP tool is still a read of COROS. */
export function readLine(tool: string | undefined): [doing: string, done: string] {
  const name = tool?.split("__").at(-1) ?? "";
  return READS[name] ?? (tool?.startsWith("coros__") ? ["Reading COROS", "Read COROS"] : ["Reading your training", "Read your training"]);
}

function push(trail: TrailItem[], item: Omit<TrailItem, "count">): TrailItem[] {
  const last = trail.at(-1);
  if (last && last.kind === item.kind && last.done === item.done) {
    return [...trail.slice(0, -1), { ...last, count: last.count + 1 }];
  }
  return [...trail, { ...item, count: 1 }];
}

/** The training snapshot the turn starts from, when one was sent. */
export function noteSnapshot(notes: RunNotes): RunNotes {
  return { ...notes, trail: push(notes.trail, { kind: "read", doing: "Reading your training snapshot", done: "Read your training snapshot" }) };
}

export function noteRead(notes: RunNotes, tool: string | undefined): RunNotes {
  const [doing, done] = readLine(tool);
  return { ...notes, trail: push(notes.trail, { kind: "read", doing, done }) };
}

/**
 * The outline or the plan handed to the check. A second hand-over means the
 * first came back, which is said as its own line before it.
 */
export function noteHandOver(notes: RunNotes, what: "outline" | "plan", attempt: number): RunNotes {
  let trail = notes.trail;
  if (attempt > 1) {
    trail = push(trail, { kind: "check", doing: "The check sent it back", done: "The check sent it back" });
  }
  const noun = what === "outline" ? "the outline" : "the sessions";
  trail = push(trail, attempt > 1
    ? { kind: "read", doing: `Fixing ${noun}`, done: `Fixed ${noun}` }
    : { kind: "read", doing: `Handing ${noun} to the check`, done: `Handed ${noun} to the check` });
  return { ...notes, trail };
}

export function notePassed(notes: RunNotes): RunNotes {
  return { ...notes, trail: push(notes.trail, { kind: "passed", doing: "Every week passed the check", done: "Every week passed the check" }) };
}

/**
 * Thinking or text, appended. Claude's thinking summary names each thing it
 * turns to in bold on a line of its own (`**Weighing the long run**`); each
 * one becomes a line of the trail as it arrives. A bold phrase inside a
 * sentence is emphasis, not a heading, and is left alone.
 */
export function noteText(notes: RunNotes, delta: string, source: "thinking" | "text" = "thinking"): RunNotes {
  const turn = notes.source && notes.source !== source ? "\n\n" : "";
  let text = notes.notes + turn + delta;
  let scanned = notes.scanned;
  let trail = notes.trail;
  const heading = /(?:^|\n)[ \t]*\*\*([^*\n]{3,80})\*\*[ \t]*(?=\n)/g;
  heading.lastIndex = scanned;
  for (let match = heading.exec(text); match; match = heading.exec(text)) {
    const title = match[1].trim().replace(/[.:]$/, "");
    trail = push(trail, { kind: "thought", doing: title, done: title });
    scanned = heading.lastIndex;
  }
  if (text.length > NOTES_LIMIT) {
    const cut = text.length - NOTES_LIMIT;
    text = text.slice(cut);
    scanned = Math.max(0, scanned - cut);
  }
  return { trail, notes: text, scanned, source };
}

/**
 * The words the run is on now: what follows the last heading, as plain text,
 * its last `limit` characters. Empty until there are some.
 */
export function thoughtTail(notes: string, limit = 220): string {
  const lines = notes.split("\n");
  let start = lines.length;
  while (start > 0 && !/^\s*\*\*[^*\n]{3,80}\*\*\s*$/.test(lines[start - 1])) start -= 1;
  const plain = lines
    .slice(start)
    .join(" ")
    .replace(/\*\*|__|`|^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(plain.length - limit);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}
