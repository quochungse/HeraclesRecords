import type {
  ChatMessage,
  ChatProvider,
  ChatTokenUsage,
  CompactContextSettings,
  CompactModelChoice,
  ContextDetail,
  PersistedChatEntry,
  PlanArtifactVersion,
  PlanBrief,
  PlanDraftPreview,
  PlanEvent,
  PlanRef,
  ScheduleChangeSet,
  ScheduleRef
} from "./types";
import { briefLine, outlineLine } from "./planBrief";
import { stripChartPlaceholders } from "./chartPlacement";

/**
 * Context compaction — the rolling summary that stands in for the head of a
 * long transcript, shared by the interactive chat and by analysis runs.
 *
 * It started as section 5.7 of the coach-automations design, where only
 * headless runs used it. Nothing about it was ever analysis-specific: an
 * athlete who chats daily in one conversation pays the same growing bill as a
 * daily briefing thread does, and the summary is stored on the *conversation*
 * (`chat_sessions.coach_summary`), so a conversation with both a coach and an
 * athlete talking in it has one summary that either can roll and both benefit
 * from.
 *
 * Everything here is pure. The roll itself is a model call and the storage is
 * SQLite; both arrive as callbacks, which is what lets the analysis runner
 * keep its injected test seams while sharing this code.
 */

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/**
 * How far a transcript may run past what the summary already covers before it
 * is rolled forward.
 *
 * The count is measured from the summary, not from the start of the
 * conversation, and that is the difference between this and a fixed window. A
 * fixed "always send the last 20" would need the summary re-rolled on **every**
 * turn, because every turn adds two entries to the head. Rolling once every
 * `limit - keep` turns instead is cheaper — a turn is a model call and so is a
 * roll — and, more importantly, less lossy: a summary re-summarised forty times
 * a year is forty rounds of compression, and what survives is whatever
 * happened to be in the last one.
 */
export const DEFAULT_CONTEXT_LIMIT = 60;

/** How many recent entries survive a roll and go to the model verbatim. */
export const DEFAULT_CONTEXT_KEEP = 20;

/**
 * A tail of one is a conversation with no context at all, and a `keep` of zero
 * would send the summary alone — the athlete's own last question included in
 * the compression. Two is the smallest tail that still carries a question and
 * its answer.
 */
export const MIN_CONTEXT_KEEP = 2;

/**
 * Nothing enforces a provider's context length here, so the ceiling is a
 * sanity bound rather than a promise: past this a "compacted" conversation is
 * not compact by any reading, and the setting has stopped meaning anything.
 */
export const MAX_CONTEXT_LIMIT = 400;

/**
 * The limit has to sit far enough above `keep` that a roll buys something. At
 * a gap of one, every single turn after the first roll trips the next one —
 * which is the per-turn re-summarisation this design exists to avoid.
 */
export const MIN_CONTEXT_GAP = 4;

/** What a transcript is trimmed to, and when. */
export interface ContextWindow {
  limit: number;
  keep: number;
}

export const DEFAULT_CONTEXT_WINDOW: ContextWindow = {
  limit: DEFAULT_CONTEXT_LIMIT,
  keep: DEFAULT_CONTEXT_KEEP
};

/**
 * What the settings look like before the athlete has touched them, for the
 * renderer's optimistic default while the real ones load.
 */
export const DEFAULT_COMPACT_CONTEXT: CompactContextSettings = {
  enabled: true,
  ...DEFAULT_CONTEXT_WINDOW
};

export type { ContextDetail };

/**
 * How much of a conversation reaches the model as it was written.
 *
 * The entry window above cannot see what an entry weighs, and an entry is a
 * line or four thousand words: measured on a real account (2026-09-29), a
 * 16-entry conversation sent ~16k tokens of history on every turn and was never
 * compacted, while a 110-entry one sent ~12k — nine tenths of it the coach's
 * own answers. So a conversation goes out in three layers, each held to a
 * budget measured on the wire (the cards are dropped there, and they are most
 * of a row's bytes):
 *
 *   * the newest turns, word for word (`keep`);
 *   * the ones before them **condensed** — the athlete's words as written, and
 *     each coach answer as a digest of its figures and decisions
 *     (`answerDigest.ts`), since the answers are what grows and what the coach
 *     can say again (`middle`);
 *   * everything older, as the running summary.
 *
 * Turns move from the first layer to the second in a batch, once the verbatim
 * part runs past `rollAt`, and from the second to the summary once it runs
 * past `middle` — in batches so the prefix a provider caches changes a few
 * times a conversation rather than every turn. A digest is made in the
 * background, so moving a turn costs no wait; only the summary's roll is a
 * model call the athlete waits on. Nothing is lost on the way: every earlier
 * turn stays readable through `recall_conversation`.
 *
 * Replayed turn by turn over that account's 32 conversations (2026-09-30,
 * digests stood in for by a 400-character cut), against a summary and tail
 * alone at 12k / 4k: `balanced` sent 3.0k a turn where that sent 3.7k — 6.4k
 * against 8.1k on the 110-entry one — and rolled 3 times where it rolled 4,
 * with 45 digests made in the background; `lean` sent 2.4k with 4 rolls;
 * `full` sent 4.2k, the price of keeping more. A `lean` whose condensed layer
 * held only 4k rolled 11 times, which is 11 waits: the layer's own budget is
 * what keeps the summariser rare.
 */
export interface ContextBudget {
  /** Estimated tokens of verbatim turns past which the older ones are condensed. */
  rollAt: number;
  /** Estimated tokens the verbatim tail is held to. */
  keep: number;
  /** Estimated tokens the condensed layer may hold before its oldest part is summarised. */
  middle: number;
}

export const CONTEXT_BUDGETS: Readonly<Record<ContextDetail, ContextBudget>> = {
  lean: { rollAt: 4_000, keep: 2_000, middle: 6_000 },
  balanced: { rollAt: 6_000, keep: 3_000, middle: 6_000 },
  full: { rollAt: 12_000, keep: 6_000, middle: 10_000 }
};

export const DEFAULT_CONTEXT_DETAIL: ContextDetail = "balanced";
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = CONTEXT_BUDGETS[DEFAULT_CONTEXT_DETAIL];

export function normalizeContextDetail(value: unknown): ContextDetail {
  return value === "lean" || value === "balanced" || value === "full" ? value : DEFAULT_CONTEXT_DETAIL;
}

const COMPACT_PROVIDERS: readonly string[] = ["claude-code", "claude-api", "chatgpt", "openrouter", "local"];

/**
 * Reads a stored or handed model choice. A `fixed` choice with no provider or
 * no model reads as `auto`: compressing with a half-named model would fail on
 * every turn, and failing quietly back to the default is what a compaction
 * that is only an optimisation should do.
 */
export function normalizeCompactModelChoice(value: unknown): CompactModelChoice {
  let raw: unknown = value;
  if (typeof raw === "string") {
    if (raw === "auto" || raw === "conversation") return { kind: raw };
    try {
      raw = JSON.parse(raw);
    } catch {
      return { kind: "auto" };
    }
  }
  if (!raw || typeof raw !== "object") return { kind: "auto" };
  const choice = raw as { kind?: unknown; provider?: unknown; model?: unknown };
  if (choice.kind === "conversation") return { kind: "conversation" };
  if (
    choice.kind === "fixed" &&
    typeof choice.provider === "string" &&
    COMPACT_PROVIDERS.includes(choice.provider) &&
    typeof choice.model === "string" &&
    choice.model.trim()
  ) {
    return { kind: "fixed", provider: choice.provider as ChatProvider, model: choice.model.trim() };
  }
  return { kind: "auto" };
}

/** How a choice is written to its setting. */
export function serializeCompactModelChoice(choice: CompactModelChoice): string {
  return choice.kind === "fixed" ? JSON.stringify(choice) : choice.kind;
}

/**
 * A rough token count: English runs about four characters a token and
 * Vietnamese, which most of these conversations are written in, nearer two
 * and a half. Three is between them, and a budget needs no more than that.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * The digest of a coach answer, when one has been made (`chatDigestService`).
 * A lookup rather than a map so this module stays free of the hashing the
 * store keys digests by — the renderer imports it.
 */
export type AnswerDigestLookup = (answer: string) => string | undefined;

/** A coach answer the condensed layer holds and no digest has been made of yet. */
export interface DigestRequest {
  answer: string;
  /** The athlete's message it answered, for the digest's context. */
  question?: string;
}

/** What one entry costs on the wire. A card costs nothing: it is not sent. */
function entryTokens(entry: PersistedChatEntry, digestOf?: AnswerDigestLookup): number {
  return toWireMessages([entry], digestOf).reduce(
    (total, message) => total + estimateTokens(message.content),
    0
  );
}

function tokensOf(entries: readonly PersistedChatEntry[], digestOf?: AnswerDigestLookup): number {
  return entries.reduce((total, entry) => total + entryTokens(entry, digestOf), 0);
}

/**
 * How many of the newest entries the verbatim tail holds: at most `keep`
 * entries and `budget` tokens, but never fewer than `MIN_CONTEXT_KEEP` entries
 * that say something — the athlete's question and what came before it go in
 * whole, however long the answer was.
 */
function tailLengthWithin(entries: PersistedChatEntry[], keep: number, budget: number): number {
  let spent = 0;
  let spoken = 0;
  let taken = 0;
  for (let index = entries.length - 1; index >= 0 && taken < keep; index -= 1) {
    const cost = entryTokens(entries[index]!);
    if (spoken >= MIN_CONTEXT_KEEP && spent + cost > budget) break;
    spent += cost;
    taken += 1;
    if (cost > 0) spoken += 1;
  }
  return taken;
}

/** The condensed layer's coach answers with no digest yet, each with the question it answered. */
function undigested(entries: readonly PersistedChatEntry[], digestOf: AnswerDigestLookup): DigestRequest[] {
  const pending: DigestRequest[] = [];
  let question: string | undefined;
  for (const entry of entries) {
    for (const message of toWireMessages([entry])) {
      if (message.role === "user") {
        question = message.content;
      } else if (entry.kind === "message" && !digestOf(message.content)) {
        pending.push({ answer: message.content, ...(question ? { question } : {}) });
      }
    }
  }
  return pending;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Reads a stored or hand-typed pair as a usable window. Both halves are
 * settings the athlete can type, so neither can be trusted to be a number, to
 * be whole, or to be in the right order relative to the other.
 *
 * `keep` is resolved first and `limit` is then floored against it, so a pair
 * that disagrees loses the *limit* rather than the tail: sending fewer recent
 * turns verbatim than the athlete asked for is the change they would notice,
 * and rolling more often than they asked for is the one they would not.
 */
export function normalizeContextWindow(
  raw?: Partial<ContextWindow> | null
): ContextWindow {
  const keepRaw = Number(raw?.keep);
  const limitRaw = Number(raw?.limit);
  const keep = Number.isFinite(keepRaw)
    ? clamp(Math.round(keepRaw), MIN_CONTEXT_KEEP, MAX_CONTEXT_LIMIT - MIN_CONTEXT_GAP)
    : DEFAULT_CONTEXT_KEEP;
  const limit = Number.isFinite(limitRaw)
    ? clamp(Math.round(limitRaw), keep + MIN_CONTEXT_GAP, MAX_CONTEXT_LIMIT)
    : Math.max(DEFAULT_CONTEXT_LIMIT, keep + MIN_CONTEXT_GAP);
  return { limit, keep };
}

// ---------------------------------------------------------------------------
// Transcript → wire
// ---------------------------------------------------------------------------

/**
 * The transcript as the model sees it.
 *
 * Only entries that carry words survive. The visual cards — plan drafts,
 * activity charts, zone summaries — are renderings of tool output the model
 * already produced and already narrated in its own answer; replaying them as
 * text would be the same facts twice, in a worse form.
 *
 * A `coachPrompt` is the exception and is expanded rather than dropped: the
 * question and the athlete's answer to it are a turn of the conversation, and
 * a coach that cannot see what it asked (or what it was told) re-asks. So is a
 * `planEvent`: it is the one thing about a creation the coach did not write.
 */
/**
 * How a condensed answer reads to the model: marked, so the coach knows it is
 * reading its own answer in brief and where the whole of it is.
 */
export const CONDENSED_ANSWER_MARK = "[condensed]";

export function toWireMessages(
  entries: readonly PersistedChatEntry[],
  /** Answers with a digest are sent as the digest (the condensed layer). */
  digestOf?: AnswerDigestLookup
): ChatMessage[] {
  const wire: ChatMessage[] = [];
  // What the athlete or COROS did to a creation, where it happened: the card
  // itself is dropped like every card, and this is the part of it the coach
  // did not write. It rides on the athlete's next message rather than being
  // one of its own, so the roles still alternate; with nothing after it, on
  // the athlete's last one.
  let events: string[] = [];
  const flushEvents = () => {
    if (!events.length) return;
    const note = events.join("\n\n");
    events = [];
    const last = wire[wire.length - 1];
    if (last?.role === "user") {
      wire[wire.length - 1] = { ...last, content: `${last.content}\n\n${note}` };
    } else {
      wire.push({ role: "user", content: note });
    }
  };
  const push = (message: ChatMessage) => {
    if (events.length && message.role === "user") {
      message = { ...message, content: `${events.join("\n\n")}\n\n${message.content}` };
      events = [];
    } else {
      flushEvents();
    }
    wire.push(message);
  };
  for (const entry of entries) {
    if (entry.kind === "message") {
      // A placeholder names a chart of the turn it was written in; on a later
      // turn it would name nothing, or the wrong chart.
      const content = entry.role === "assistant" ? stripChartPlaceholders(entry.content) : entry.content;
      const digest = entry.role === "assistant" && content.trim() ? digestOf?.(content) : undefined;
      if (digest) push({ role: entry.role, content: `${CONDENSED_ANSWER_MARK} ${digest}` });
      else if (content.trim()) push({ role: entry.role, content });
    } else if (entry.kind === "planEvent") {
      events.push(planEventNote(entry.event));
    } else if (entry.kind === "planRefs") {
      // Rides on the question it was attached to, which follows it.
      events.push(planRefsNote(entry.refs));
    } else if (entry.kind === "scheduleRefs") {
      events.push(scheduleRefsNote(entry.refs));
    } else if (entry.kind === "coachPrompt") {
      const choices = entry.prompt.choices
        .map((choice) => `- ${choice.label}`)
        .join("\n");
      push({
        role: "assistant",
        content: `I need the athlete's answer before continuing:\n${entry.prompt.question}\n${choices}`
      });
      if (entry.prompt.answer) push({ role: "user", content: entry.prompt.answer });
    }
  }
  flushEvents();
  return wire;
}

/** What the athlete pointed at, as a line in front of their question. */
export function planRefsNote(refs: readonly PlanRef[]): string {
  const lines = refs.map((ref) => {
    const what = ref.artifactType === "workout" ? "workout" : "plan";
    const version = ref.version ? ` v${ref.version}` : "";
    const where = ref.scope === "plan" ? "the whole of it" : ref.label;
    return `the ${what} "${ref.name}"${version} (draft_id ${ref.draftId}) — ${where}`;
  });
  return `[The athlete is asking about ${lines.join("; and ")}. Read it with get_plan_draft if you need more than this.]`;
}

/**
 * What on the calendar or in a COROS plan the athlete pointed at (P3.5), as a
 * line in front of their question — with the ids the read tools take, so the
 * coach reads what it is about instead of guessing from the words.
 */
export function scheduleRefsNote(refs: readonly ScheduleRef[]): string {
  const lines = refs.map((ref) => {
    if (ref.scope === "week") return `the week ${ref.label}${ref.day ? ` (from ${ref.day}; read it with list_scheduled_workouts)` : ""}`;
    if (ref.scope === "day") return `the day ${ref.label}${ref.day ? ` (${ref.day})` : ""}`;
    if (ref.activityId) return `the activity ${ref.label} (activity_id ${ref.activityId})`;
    const ids = [
      ref.planId ? `plan_id ${ref.planId}` : undefined,
      ref.idInPlan ? `id_in_plan ${ref.idInPlan}` : undefined,
      ref.day ? `on ${ref.day}` : undefined
    ].filter(Boolean);
    return `the session ${ref.label}${ids.length ? ` (${ids.join(", ")})` : ""}`;
  });
  return (
    `[The athlete is asking about ${lines.join("; and ")}. ` +
    "Read what you need with list_scheduled_workouts, get_training_plan or get_activity_detail.]"
  );
}

/** A `planEvent` as a line in front of the coach, where it happened. */
export function planEventNote(event: PlanEvent): string {
  const what = event.artifactType === "workout" ? "workout" : "plan";
  const versions =
    event.fromVersion && event.toVersion ? ` (v${event.fromVersion} → v${event.toVersion})` : "";
  const lead =
    event.action === "edited"
      ? `[The athlete edited the ${what} "${event.name}"${versions} in the editor.`
      : event.action === "restored"
        ? `[The athlete restored an earlier version of the ${what} "${event.name}"${versions}.`
        : event.action === "imported"
          ? `[The ${what} "${event.name}" was changed in the Training Library or on COROS${versions}.`
          : `[The ${what} "${event.name}" was deleted on COROS; its card is a proposal again.`;
  const changes = event.changes?.length ? ` Changes: ${event.changes.join("; ")}.` : "";
  return (
    `${lead}${changes} Its newest version is draft_id ${event.draftId}; ` +
    "read it with get_plan_draft before building on it.]"
  );
}

/** How the index states where a creation went. */
function creationState(draft: PlanDraftPreview): string {
  const destination = draft.uploadResult?.destination;
  if (!draft.uploadedAt && !destination) return "not saved";
  if (destination === "calendar") return "on the calendar";
  if (destination === "workoutLibrary") return "in the Workout Library";
  if (destination === "nativePlan" || destination === "nativePlanAndCalendar") {
    return draft.uploadResult?.planId ? `saved to COROS as plan ${draft.uploadResult.planId}` : "saved to COROS";
  }
  return "saved";
}

const VERSION_AUTHORS: Record<PlanArtifactVersion["author"], string> = {
  coach: "you",
  athlete: "the athlete",
  coros: "a change in the Library"
};

/**
 * Every creation still in the conversation, a line each, as it stands now
 * (docs/coach-plan-canvas.md, P1.3). The cards are dropped from the wire like
 * every other card, so without this the coach cannot name the plan it wrote
 * three turns ago — not its draft id, not whether it was saved, not whether
 * the athlete has since changed it. It costs about thirty tokens a creation;
 * the detail is one `get_plan_draft` away.
 *
 * `versions` groups the cards: every version is a card of its own, and only
 * the newest is listed. A card the list does not know is its own creation.
 */
export function creationIndex(
  entries: PersistedChatEntry[],
  versions: readonly PlanArtifactVersion[],
  briefs: readonly PlanBrief[] = [],
  changeSets: readonly ScheduleChangeSet[] = []
): string | null {
  const known = new Map(versions.map((version) => [version.draftId, version]));
  const creations = new Map<string, { draft: PlanDraftPreview; version?: PlanArtifactVersion }>();
  for (const entry of entries) {
    if (entry.kind !== "planDraft" || entry.draft.removedAt) continue;
    const version = known.get(entry.draft.draftId);
    const artifactId = version?.artifactId ?? entry.draft.draftId;
    const current = creations.get(artifactId);
    const newer =
      !current ||
      (version && current.version
        ? version.version > current.version.version ||
          (version.version === current.version.version && version.createdAt > current.version.createdAt)
        : true);
    if (newer) creations.set(artifactId, { draft: entry.draft, version });
  }
  // A brief is listed until it has a version: from then on the plan is the creation (P2.1).
  const briefById = new Map(briefs.map((brief) => [brief.artifactId, brief]));
  const briefLines = [
    ...new Set(entries.flatMap((entry) => (entry.kind === "planBrief" ? [entry.artifactId] : [])))
  ].flatMap((artifactId) => {
    const brief = briefById.get(artifactId);
    if (!brief || creations.has(artifactId)) return [];
    const shape = brief.outline ? outlineLine(brief.outline) : "no outline yet";
    return [`- Brief · brief_id ${artifactId} · ${briefLine(brief.request)} · ${shape}`];
  });
  // What became of each calendar proposal (P3.3): the card is where the athlete
  // applied it, and the coach would otherwise think it still pending — or done.
  const setById = new Map(changeSets.map((set) => [set.changeSetId, set]));
  const changeLines = [
    ...new Set(entries.flatMap((entry) => (entry.kind === "scheduleChange" ? [entry.changeSetId] : [])))
  ].flatMap((changeSetId) => {
    const set = setById.get(changeSetId);
    return set ? [`- Calendar proposal "${set.summary}" · ${changeSetState(set)}`] : [];
  });
  if (creations.size === 0 && briefLines.length === 0 && changeLines.length === 0) return null;
  const lines = [...creations.values()].map(({ draft, version }) => {
    const kind = draft.artifactType === "workout" ? "Workout" : "Plan";
    const made = version
      ? `v${version.version} by ${VERSION_AUTHORS[version.author]}`
      : "v1 by you";
    const edited = draft.editedAt ? " · edited by the athlete" : "";
    const shape = draft.summary ? ` · ${draft.summary}` : "";
    return `- ${kind} "${draft.name}" · draft_id ${draft.draftId} · ${made}${edited}${shape} · ${creationState(draft)}`;
  });
  return [
    "[What you have made in this conversation, newest version of each. Read one with get_plan_draft; change one with revise_training_plan and its draft_id." +
      (briefLines.length ? " Fill in a brief with request_plan_brief and its brief_id; the athlete edits it on its card." : "") +
      (changeLines.length ? " A calendar proposal is applied by the athlete, line by line, from its card." : "") +
      "]",
    ...lines,
    ...briefLines,
    ...changeLines
  ].join("\n");
}

/** How a proposal's lines stand: `2 applied · 1 out of date ("…") · 1 not decided`. */
function changeSetState(set: ScheduleChangeSet): string {
  const parts: string[] = [];
  const of = (status: ScheduleChangeSet["lines"][number]["status"]) => set.lines.filter((line) => line.status === status);
  if (of("applied").length) parts.push(`${of("applied").length} applied`);
  for (const [status, word] of [["failed", "failed"], ["stale", "out of date"]] as const) {
    const lines = of(status);
    if (lines.length) {
      parts.push(`${lines.length} ${word} (${lines.map((line) => `${line.label}: ${line.reason ?? "no reason given"}`).join("; ")})`);
    }
  }
  if (of("dismissed").length) parts.push(`${of("dismissed").length} dismissed`);
  if (of("proposed").length) parts.push(`${of("proposed").length} not decided yet`);
  return parts.join(" · ");
}

/** The wire with `creationIndex` put in front of the latest user message. */
export function withCreationIndex(
  messages: ChatMessage[],
  entries: PersistedChatEntry[],
  versions: readonly PlanArtifactVersion[],
  briefs: readonly PlanBrief[] = [],
  changeSets: readonly ScheduleChangeSet[] = []
): ChatMessage[] {
  const note = creationIndex(entries, versions, briefs, changeSets);
  if (!note) return messages;
  let last = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") last = index;
  });
  if (last < 0) return [...messages, { role: "user", content: note }];
  return messages.map((message, index) =>
    index === last ? { ...message, content: `${note}\n\n${message.content}` } : message
  );
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** What is stored about a conversation's summary, if anything. */
export interface StoredTranscriptSummary {
  summary?: string;
  /** Entries at the head of the transcript the summary accounts for. */
  through: number;
  /**
   * Where the verbatim turns begin: the entries between `through` and this are
   * the condensed layer. Absent, or anything outside `[through, length]`, reads
   * as no condensed layer at all.
   */
  condensedThrough?: number;
}

export interface TranscriptContextPlan {
  /** Sent ahead of the rest, standing in for everything before it. */
  summary?: string;
  /** Sent condensed: the athlete's words as written, each coach answer as its digest. */
  middle: PersistedChatEntry[];
  /** Sent verbatim. */
  tail: PersistedChatEntry[];
  /** Entries that have to be folded into the summary first; usually empty. */
  toSummarise: PersistedChatEntry[];
  /** What `through` becomes once they are folded in. */
  through: number;
  /** Where the verbatim turns begin. */
  condensedThrough: number;
  /** The condensed layer's answers with no digest yet; empty without a lookup. */
  toDigest: DigestRequest[];
}

export interface PlanTranscriptOptions {
  /**
   * Roll now, whatever the budgets say — "Compact context" from the
   * conversation menu. Everything before the verbatim tail goes into the
   * summary, the condensed layer included.
   */
  force?: boolean;
  /** The token budgets; `DEFAULT_CONTEXT_BUDGET` when absent. */
  budget?: ContextBudget;
  /** The digests made so far; without one, no answer counts as condensed. */
  digestOf?: AnswerDigestLookup;
}

/**
 * What of a transcript this turn should send, and what has to be folded into
 * the summary first. Pure: the folding itself is a model call and belongs to
 * the caller, and so is making a digest.
 *
 * Two steps, in this order. The verbatim part condenses its older turns once
 * it runs past `rollAt` tokens or past the entry window, keeping a tail within
 * `keep`. Then the condensed layer folds its oldest part into the summary once
 * it runs past `middle` tokens — until half of that is left — or the whole of
 * it once everything past the summary runs past the entry window, which is
 * what the window has always meant.
 *
 * A `through` past the end of the transcript describes a conversation that is
 * no longer there, so the summary is abandoned rather than trusted. It should
 * not happen — the window's saves merge rather than truncate, and a deleted
 * conversation takes its row with it — but a summary that claims to cover
 * entries nobody can see is the one failure here that cannot be noticed by
 * reading the result.
 */
export function planTranscriptContext(
  entries: PersistedChatEntry[],
  stored: StoredTranscriptSummary,
  window: ContextWindow = DEFAULT_CONTEXT_WINDOW,
  options: PlanTranscriptOptions = {}
): TranscriptContextPlan {
  // A count past the end describes a conversation that is no longer there, and
  // a summary with no count at all — or a count of zero — describes nothing.
  // Either way the pair is half-written, and the two are one fact. The safe
  // reading is *no summary*, the same way a half-written pause reads as *not
  // paused*: trusting it would send a summary of turns the model is also about
  // to read in full, and nothing downstream could notice.
  const valid =
    stored.through > 0 &&
    stored.through <= entries.length &&
    Boolean(stored.summary);
  const through = valid ? stored.through : 0;
  const summary = valid ? stored.summary : undefined;
  const budget = options.budget ?? DEFAULT_CONTEXT_BUDGET;
  const { digestOf } = options;

  const storedCondensed = stored.condensedThrough;
  let condensed =
    typeof storedCondensed === "number" &&
    Number.isInteger(storedCondensed) &&
    storedCondensed >= through &&
    storedCondensed <= entries.length
      ? storedCondensed
      : through;

  // 1. The verbatim part. Past its budget, only once a batch of four entries
  // would move: a tail over budget on its own (one very long answer) would
  // otherwise be condensed a turn at a time.
  const verbatim = entries.slice(condensed);
  const keep = tailLengthWithin(verbatim, window.keep, budget.keep);
  const condense = options.force
    ? verbatim.length > keep
    : verbatim.length > window.limit ||
      (verbatim.length - keep >= MIN_CONTEXT_GAP && tokensOf(verbatim) > budget.rollAt);
  if (condense) condensed = entries.length - keep;

  // 2. The condensed layer.
  let nextThrough = through;
  if (options.force || entries.length - through > window.limit) {
    nextThrough = condensed;
  } else {
    let cost = tokensOf(entries.slice(through, condensed), digestOf);
    if (cost > budget.middle) {
      while (nextThrough < condensed && cost > budget.middle / 2) {
        cost -= entryTokens(entries[nextThrough]!, digestOf);
        nextThrough += 1;
      }
    }
  }

  const middle = entries.slice(nextThrough, condensed);
  return {
    ...(summary ? { summary } : {}),
    middle,
    tail: entries.slice(condensed),
    toSummarise: entries.slice(through, nextThrough),
    through: nextThrough,
    condensedThrough: condensed,
    toDigest: digestOf ? undigested(middle, digestOf) : []
  };
}

/** How a summary turn begins, and so how one is recognised. */
const SUMMARY_HEADER = "[Earlier in this conversation, summarised]";

/** Whether a wire message is the summary `summaryContextMessage` built. */
export function isSummaryContextMessage(message: ChatMessage): boolean {
  return message.role === "user" && message.content.startsWith(SUMMARY_HEADER);
}

/** How many messages before its own a pipeline step's turn carries (P2.4). */
export const PIPELINE_RECENT_MESSAGES = 6;

/**
 * What a step of the plan pipeline sends (docs/coach-plan-canvas.md, P2.4):
 * the last few messages before the step and the step's own prompt, which
 * carries the brief and the outline. Not the whole conversation — a step's
 * cost must not grow with how long the athlete has been talking — and not a
 * summary either: a summary exists only once compaction has run, and making
 * one for the step would cost a call of its own. The system prompt and the
 * training snapshot are added by `streamChat` as for any turn.
 *
 * The step's message is the last user message of the wire the renderer
 * sent; what it said there (the athlete's words, the creation index) is
 * replaced by `prompt`. The kept messages start at a user message, which
 * every provider wants first, and the summary a compacted conversation opens
 * with is never among them.
 */
export function pipelineWire(
  messages: readonly ChatMessage[],
  prompt: string,
  recent = PIPELINE_RECENT_MESSAGES
): ChatMessage[] {
  const last = messages.map((message) => message.role).lastIndexOf("user");
  const before = (last < 0 ? messages : messages.slice(0, last)).filter(
    (message) => !isSummaryContextMessage(message)
  );
  const kept = before.slice(Math.max(0, before.length - recent));
  while (kept.length && kept[0]!.role !== "user") kept.shift();
  return [...kept, { role: "user", content: prompt }];
}

/**
 * How the summary reaches the model. A plain user turn, labelled, rather than
 * anything provider-specific: it has to read the same way to four providers,
 * and it has to be obvious to the model that this is a compression of the
 * conversation rather than something the athlete just said.
 */
export function summaryContextMessage(summary: string): ChatMessage {
  return {
    role: "user",
    content: [
      SUMMARY_HEADER,
      summary,
      "[End of summary. The messages that follow are the recent turns in full; an answer of yours marked " +
        `${CONDENSED_ANSWER_MARK} is its digest.]`
    ].join("\n\n")
  };
}

/** The turn that folds new entries into the running summary. */
export function buildRollingSummaryTurn(
  previous: string | undefined,
  entries: PersistedChatEntry[],
  /** Answers already condensed are summarised from their digests. */
  digestOf?: AnswerDigestLookup
): string {
  const transcript = toWireMessages(entries, digestOf)
    .map((message) => `${message.role === "user" ? "Athlete" : "Coach"}: ${message.content}`)
    .join("\n\n");
  return [
    previous
      ? "Here is the running summary of a coaching conversation so far, followed by the turns that have happened since it was written."
      : "Here are the opening turns of a coaching conversation.",
    ...(previous ? ["", "--- Running summary ---", previous] : []),
    "",
    "--- Newer turns ---",
    transcript,
    "",
    "Rewrite the running summary so it covers everything above, including the",
    "newer turns. It is the only record of these turns the coach will have on",
    "future runs, so keep what a coach would need: the athlete's goals, races,",
    "injuries and constraints, decisions taken, and how the training has",
    "actually gone. Keep every figure exactly as it was given — paces, heart",
    "rates, distances, weights, dates — and what the coach prescribed, with its",
    "numbers: those are what a summary of a summary loses first. Drop",
    "pleasantries, explanations the coach can give again, and anything already",
    "superseded. Write it as notes, not as a letter, and reply with the summary",
    "and nothing else."
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Applying a plan
// ---------------------------------------------------------------------------

export interface TranscriptContextResult {
  /** Sent ahead of the rest, when there is one. */
  summary?: string;
  /**
   * The condensed layer as it goes on the wire, between the summary and the
   * tail: the athlete's words as written, each coach answer as its digest
   * where one has been made.
   */
  middle: ChatMessage[];
  /** Sent verbatim. */
  tail: PersistedChatEntry[];
  /** Index into `entries` where `tail` begins, for callers that slice again. */
  tailStart: number;
  /** What the stored count is now — unchanged unless a roll landed. */
  through: number;
  /** Where the verbatim turns begin, as stored now. */
  condensedThrough: number;
  /** Whether a summariser turn actually ran. */
  rolled: boolean;
  /** A roll ran and produced nothing; the untrimmed tail is being sent. */
  failed: boolean;
  /**
   * Why it produced nothing. Carried rather than swallowed because a roll is
   * best-effort in two very different situations: the automatic pass, where
   * silence is right and the next turn tries again, and the athlete pressing
   * "Compact context", where silence is a dead button. The same code serves
   * both, so the reason has to survive the trip and let the caller decide
   * whether to show it.
   */
  failureReason?: string;
  /** What the roll cost, when it reported anything. */
  usage?: ChatTokenUsage;
}

export interface ApplyTranscriptContextParams {
  entries: PersistedChatEntry[];
  stored: StoredTranscriptSummary;
  window?: ContextWindow;
  force?: boolean;
  /**
   * Folds entries into the running summary. A null `summary` means it could
   * not — a roll is best-effort, and the turn it is preparing for still has to
   * happen.
   *
   * `usage` comes back separately because a roll is a full provider turn and
   * every one of them is counted. It is reported whether or not the roll
   * produced anything: a summariser that spent its tokens and then declined
   * still spent them, and a budget that could not see the one feature built to
   * make long conversations affordable would under-report exactly where it
   * matters most.
   */
  roll(
    previous: string | undefined,
    entries: PersistedChatEntry[]
  ): Promise<{
    summary: string | null;
    usage?: ChatTokenUsage;
    /** Why it produced nothing, in words fit to show someone. */
    reason?: string;
  }>;
  /** Persists the pair. Called only when a roll produced a summary. */
  store(summary: string, through: number): void;
  /** Budgets and digests; see `PlanTranscriptOptions`. */
  budget?: ContextBudget;
  digestOf?: AnswerDigestLookup;
  /**
   * Persists where the verbatim turns begin. Called when it moves, whether or
   * not a roll ran — condensing a batch is not a model call.
   */
  storeCondensed?(condensedThrough: number): void;
  /**
   * Asks for digests of the condensed layer's answers that have none. Not
   * awaited: a digest is made in the background and read on a later turn, and
   * until then its answer goes out whole.
   */
  digest?(requests: DigestRequest[]): void;
}

/**
 * Plans, rolls when the plan asks for one, and reports what to send.
 *
 * **A roll is best-effort.** If it fails — a provider that declined, or went
 * quiet — the turn does **not** fail and the middle of the conversation is
 * **not** dropped. It sends what it would have sent before the roll:
 * everything the stored summary does not already cover. That costs more this
 * once, and the next turn rolls again. The alternative, trimming to the tail
 * without a summary to stand in for the head, would quietly delete a year of
 * context and produce an answer that reads perfectly well.
 */
export async function applyTranscriptContext(
  params: ApplyTranscriptContextParams
): Promise<TranscriptContextResult> {
  const plan = planTranscriptContext(params.entries, params.stored, params.window ?? DEFAULT_CONTEXT_WINDOW, {
    ...(params.force ? { force: true } : {}),
    ...(params.budget ? { budget: params.budget } : {}),
    ...(params.digestOf ? { digestOf: params.digestOf } : {})
  });
  if (plan.toDigest.length) params.digest?.(plan.toDigest);
  const moved = plan.condensedThrough !== params.stored.condensedThrough;
  const settled = {
    tail: plan.tail,
    tailStart: plan.condensedThrough,
    condensedThrough: plan.condensedThrough
  };
  if (!plan.toSummarise.length) {
    if (moved) params.storeCondensed?.(plan.condensedThrough);
    return {
      ...(plan.summary ? { summary: plan.summary } : {}),
      middle: toWireMessages(plan.middle, params.digestOf),
      ...settled,
      through: plan.through,
      rolled: false,
      failed: false
    };
  }

  const rolled = await params.roll(plan.summary, plan.toSummarise);
  if (moved) params.storeCondensed?.(plan.condensedThrough);
  if (!rolled.summary) {
    return {
      ...(plan.summary ? { summary: plan.summary } : {}),
      // Nothing is dropped: what the roll would have folded goes out condensed.
      middle: toWireMessages([...plan.toSummarise, ...plan.middle], params.digestOf),
      ...settled,
      through: params.stored.through,
      rolled: true,
      failed: true,
      ...(rolled.reason ? { failureReason: rolled.reason } : {}),
      ...(rolled.usage ? { usage: rolled.usage } : {})
    };
  }

  params.store(rolled.summary, plan.through);
  return {
    summary: rolled.summary,
    middle: toWireMessages(plan.middle, params.digestOf),
    ...settled,
    through: plan.through,
    rolled: true,
    failed: false,
    ...(rolled.usage ? { usage: rolled.usage } : {})
  };
}

/** The messages a resolved context becomes: the summary, the condensed layer, then the tail. */
export function contextMessages(
  result: Pick<TranscriptContextResult, "summary" | "tail"> & { middle?: ChatMessage[] }
): ChatMessage[] {
  return [
    ...(result.summary ? [summaryContextMessage(result.summary)] : []),
    ...(result.middle ?? []),
    ...toWireMessages(result.tail)
  ];
}
