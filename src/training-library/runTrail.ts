import { t, type MessageKey } from "../i18n/core";
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

function lineOf(key: MessageKey): { doing: string; done: string } {
  const [doing, done] = trailLine(key);
  return { doing, done };
}

/** The longest `notes` kept: the tail is what is shown, and headings are taken as they arrive. */
const NOTES_LIMIT = 20_000;

/** Each tool's two lines, as message keys: what it is doing, and what it did. */
const READS: Record<string, MessageKey> = {
  list_recent_activities: "library.trail.list_recent_activities",
  get_activity_detail: "library.trail.get_activity_detail",
  get_fitness_trends: "library.trail.get_fitness_trends",
  get_training_zones: "library.trail.get_training_zones",
  get_sleep_summary: "library.trail.get_sleep_summary",
  list_scheduled_workouts: "library.trail.list_scheduled_workouts",
  search_coros_exercises: "library.trail.search_coros_exercises",
  get_hr_zone_summary: "library.trail.get_hr_zone_summary",
  list_training_plans: "library.trail.list_training_plans",
  get_training_plan: "library.trail.get_training_plan",
  get_workout_library: "library.trail.get_workout_library",
  get_plan_draft: "library.trail.get_plan_draft",
  draft_workout: "library.trail.draft_workout",
  draft_training_plan: "library.trail.draft_training_plan",
  revise_training_plan: "library.trail.revise_training_plan",
  propose_schedule_changes: "library.trail.propose_schedule_changes",
  delete_workout: "library.trail.delete_workout",
  request_plan_brief: "library.trail.request_plan_brief",
  request_coach_input: "library.trail.request_coach_input",
  recall_conversation: "library.trail.recall_conversation",
  // The provider's own web tools, under the names every provider reports them by.
  web_search: "library.trail.web_search",
  web_fetch: "library.trail.web_fetch"
};

function trailLine(key: MessageKey): [doing: string, done: string] {
  return [t(key), t(`${key}.done` as MessageKey)];
}

/** A read, as a line. An unknown COROS MCP tool is still a read of COROS. */
export function readLine(tool: string | undefined): [doing: string, done: string] {
  const name = tool?.split("__").at(-1) ?? "";
  const key = READS[name] ?? (tool?.startsWith("coros__") ? "library.trail.coros" : "library.trail.training");
  return trailLine(key);
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
  return { ...notes, trail: push(notes.trail, { kind: "read", ...lineOf("library.trail.snapshot") }) };
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
    const sentBack = t("library.trail.sentBack");
    trail = push(trail, { kind: "check", doing: sentBack, done: sentBack });
  }
  trail = push(trail, {
    kind: "read",
    ...lineOf(attempt > 1
      ? what === "outline" ? "library.trail.fixOutline" : "library.trail.fixSessions"
      : what === "outline" ? "library.trail.handOutline" : "library.trail.handSessions")
  });
  return { ...notes, trail };
}

export function notePassed(notes: RunNotes): RunNotes {
  return { ...notes, trail: push(notes.trail, { kind: "passed", doing: t("library.trail.passed"), done: t("library.trail.passed") }) };
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
