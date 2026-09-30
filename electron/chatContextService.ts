import { getChatSettings } from "./chatService";
import {
  getChatSessionCoachSummaryRow,
  setChatSessionCoachSummaryRow,
  setChatSessionCondensedThroughRow
} from "./database";
import { chatSessionExists, getChatSession } from "./chatHistoryStore";
import {
  applyTranscriptContext,
  buildRollingSummaryTurn,
  CONTEXT_BUDGETS,
  normalizeContextDetail,
  normalizeContextWindow,
  planTranscriptContext,
  summaryContextMessage,
  toWireMessages,
  type AnswerDigestLookup,
  type ContextBudget,
  type ContextWindow,
  type StoredTranscriptSummary,
  type TranscriptContextResult
} from "./chatContextCompaction";
import {
  requestDigests,
  resolveCompressionRuntime,
  runTextJob,
  transcriptDigests
} from "./chatCompression";
import {
  type AnalysisRuntime,
  type ChatContextCompaction,
  type ChatContextInspection,
  type ChatTokenUsage,
  type PersistedChatEntry
} from "./types";

/**
 * The main-process half of context compaction: reading and writing the stored
 * summary, and running the summariser turn that produces it.
 *
 * Everything here is shared by the interactive chat and by analysis runs.
 * The pure planning lives in `chatContextCompaction.ts`; this file is the part
 * that touches SQLite and the provider.
 */

/**
 * How long the summariser may emit nothing before it is given up on.
 *
 * The bound matters beyond the roll that trips it. An interactive roll happens
 * while the athlete is waiting on their own message, and a summariser that
 * never settles would leave a composer spinning with nothing behind it.
 */
export const SUMMARISER_IDLE_TIMEOUT_MS = 3 * 60_000;

/** The configured window, or the defaults when nothing is stored. */
export function getContextWindow(): ContextWindow {
  return normalizeContextWindow(getChatSettings().compactContext);
}

/** Whether compaction is on at all. Off means conversations are sent whole. */
export function isContextCompactionEnabled(): boolean {
  return getChatSettings().compactContext?.enabled !== false;
}

export function readSessionSummary(sessionId: string): StoredTranscriptSummary {
  const row = getChatSessionCoachSummaryRow(sessionId);
  const summary = row?.coach_summary?.trim();
  return {
    ...(summary ? { summary } : {}),
    through:
      typeof row?.coach_summary_through === "number" &&
      Number.isFinite(row.coach_summary_through)
        ? row.coach_summary_through
        : 0,
    ...(typeof row?.coach_condensed_through === "number" && Number.isFinite(row.coach_condensed_through)
      ? { condensedThrough: row.coach_condensed_through }
      : {})
  };
}

export function writeSessionSummary(
  sessionId: string,
  summary: string,
  through: number
): void {
  setChatSessionCoachSummaryRow(sessionId, summary, through);
}

export interface RollSummaryOptions {
  /**
   * What the conversation answers with, which the roll's model is chosen from
   * (`resolveCompressionRuntime`). An analysis passes its own; the interactive
   * chat passes nothing, and the conversation's own AI is read from
   * `sessionId` — it used to be Coach's default, whatever the conversation used.
   */
  runtime?: AnalysisRuntime;
  sessionId?: string;
  /** Answers already condensed are summarised from their digests. */
  digestOf?: AnswerDigestLookup;
  idleTimeoutMs?: number;
}

/**
 * Folds entries into the running summary. Returns a null summary when it could
 * not — a roll is best-effort, and the turn it is preparing for still has to
 * happen.
 *
 * `usage` comes back whether or not the roll produced anything: a summariser
 * that spent its tokens and then declined still spent them, and a budget that
 * could not see the one feature built to make long conversations affordable
 * would under-report exactly where it matters most.
 */
export async function rollTranscriptSummary(
  previous: string | undefined,
  entries: PersistedChatEntry[],
  options: RollSummaryOptions = {}
): Promise<{ summary: string | null; usage?: ChatTokenUsage; reason?: string }> {
  const job = await runTextJob({
    system: SUMMARISER_SYSTEM,
    prompt: buildRollingSummaryTurn(previous, entries, options.digestOf),
    compression: resolveCompressionRuntime(options.sessionId, options.runtime),
    label: "rolling summary",
    idleTimeoutMs: options.idleTimeoutMs ?? SUMMARISER_IDLE_TIMEOUT_MS
  });
  return {
    summary: job.text,
    ...(job.usage ? { usage: job.usage } : {}),
    ...(job.reason ? { reason: `the summariser ${job.reason}` } : {})
  };
}

/**
 * The summariser's own prompt. It used to run as a turn of Coach — Coach's
 * rules, the athlete's snapshot read from COROS, the MCP connections — for a
 * job that compresses text it is handed; the turn itself carries the rules.
 */
const SUMMARISER_SYSTEM =
  "You keep the running summary of a conversation between an athlete and their running coach. " +
  "Follow the instructions in the message and reply with the summary only.";

export interface CompactSessionOptions {
  /** Roll now, whatever the limit says — the conversation menu's action. */
  force?: boolean;
  runtime?: AnalysisRuntime;
  window?: ContextWindow;
  idleTimeoutMs?: number;
}

/** The budgets the athlete chose (`chat.compactContext.detail`). */
export function getContextBudget(): ContextBudget {
  return CONTEXT_BUDGETS[normalizeContextDetail(getChatSettings().compactContext?.detail)];
}

export function writeCondensedThrough(sessionId: string, condensedThrough: number): void {
  setChatSessionCondensedThroughRow(sessionId, condensedThrough);
}

/**
 * Resolves what a turn in this conversation should send, rolling the summary
 * first when the window asks for it.
 *
 * `entries` is what the caller holds. The interactive chat passes its live
 * timeline, in-flight turn included: reading the transcript back from disk here
 * would race the window's own saves and could cut the tail at a boundary that
 * does not exist in the array the renderer is about to send.
 */
export async function compactSessionContext(
  sessionId: string,
  entries: PersistedChatEntry[],
  options: CompactSessionOptions = {}
): Promise<TranscriptContextResult> {
  // Digests that cannot be read leave the answers whole; they never cost the
  // conversation its compaction.
  let digestOf: AnswerDigestLookup | undefined;
  try {
    digestOf = transcriptDigests(entries);
  } catch {
    digestOf = undefined;
  }
  return applyTranscriptContext({
    entries,
    stored: readSessionSummary(sessionId),
    window: options.window ?? getContextWindow(),
    budget: getContextBudget(),
    ...(digestOf ? { digestOf } : {}),
    ...(options.force ? { force: true } : {}),
    roll: (previous, toSummarise) =>
      rollTranscriptSummary(previous, toSummarise, {
        sessionId,
        ...(digestOf ? { digestOf } : {}),
        ...(options.runtime ? { runtime: options.runtime } : {}),
        ...(options.idleTimeoutMs !== undefined
          ? { idleTimeoutMs: options.idleTimeoutMs }
          : {})
      }),
    store: (summary, through) =>
      writeSessionSummary(sessionId, summary, through),
    storeCondensed: (condensedThrough) => writeCondensedThrough(sessionId, condensedThrough),
    digest: (requests) => {
      requestDigests(sessionId, requests, options.runtime).catch((caught: unknown) => {
        console.warn(`[coach] digests not requested: ${caught instanceof Error ? caught.message : String(caught)}`);
      });
    }
  });
}

/**
 * What the IPC entry point needs from the rest of the process.
 *
 * A seam because the alternative is a function no suite can reach: the default
 * reads chat settings and the transcript out of SQLite, and rolls through a
 * provider. The decisions it makes — whether the switch applies, what stands in
 * for a transcript nobody handed over — are the ones the whole interactive
 * feature hangs on, so they are the ones that have to be reachable.
 */
export interface CompactChatSessionDeps {
  enabled(): boolean;
  /** The stored transcript, or an empty one for a conversation that is gone. */
  loadEntries(sessionId: string): PersistedChatEntry[];
  compact(
    sessionId: string,
    entries: PersistedChatEntry[],
    options: CompactSessionOptions
  ): Promise<TranscriptContextResult>;
}

export function createDefaultCompactDeps(): CompactChatSessionDeps {
  return {
    enabled: isContextCompactionEnabled,
    // getChatSession returns [] both for "empty" and "gone", and either way
    // there is nothing to compact — but the existence check keeps this honest
    // for a caller that ever wants to tell the two apart.
    loadEntries: (sessionId) =>
      chatSessionExists(sessionId) ? getChatSession(sessionId) : [],
    compact: compactSessionContext
  };
}

/**
 * The IPC entry point. `entries` is optional so the conversation menu can
 * compact a thread the window has not opened; when it is omitted the stored
 * transcript stands in.
 *
 * A conversation that is gone, or compaction that is switched off, is not an
 * error — both answer "send it whole", which is what a `tailStart` of zero and
 * no summary mean.
 */
export async function compactChatSessionContext(
  sessionId: string,
  entries?: PersistedChatEntry[],
  options: { force?: boolean } = {},
  deps: CompactChatSessionDeps = createDefaultCompactDeps()
): Promise<ChatContextCompaction> {
  const transcript = entries ?? deps.loadEntries(sessionId);
  // A forced compact is the athlete asking for one by name, so it runs even
  // with the automatic window switched off; only the per-turn pass obeys it.
  if (!options.force && !deps.enabled()) {
    return {
      tailStart: 0,
      through: 0,
      rolled: false,
      failed: false,
      tailLength: transcript.length,
      entryCount: transcript.length
    };
  }
  const result = await deps.compact(
    sessionId,
    transcript,
    options.force ? { force: true } : {}
  );
  return {
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.middle?.length ? { middle: result.middle } : {}),
    tailStart: result.tailStart,
    through: result.through,
    rolled: result.rolled,
    failed: result.failed,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    tailLength: result.tail.length,
    entryCount: transcript.length
  };
}

/**
 * What the dev-build inspector needs. Same reason as
 * `CompactChatSessionDeps`: the default reads settings and the transcript out
 * of SQLite, so without a seam this is a function no suite can reach.
 */
export interface InspectChatSessionDeps {
  enabled(): boolean;
  window(): ContextWindow;
  stored(sessionId: string): StoredTranscriptSummary;
  loadEntries(sessionId: string): PersistedChatEntry[];
  /** The budgets in force; the default ones when absent. */
  budget?(): ContextBudget;
  /** The digests made so far for this transcript's answers. */
  digests?(entries: PersistedChatEntry[]): AnswerDigestLookup;
}

export function createDefaultInspectDeps(): InspectChatSessionDeps {
  return {
    enabled: isContextCompactionEnabled,
    window: getContextWindow,
    stored: readSessionSummary,
    loadEntries: (sessionId) =>
      chatSessionExists(sessionId) ? getChatSession(sessionId) : [],
    budget: getContextBudget,
    digests: transcriptDigests
  };
}

/**
 * Reports what compaction has done to a conversation, without doing any of it.
 *
 * It plans and stops: no roll, no provider call, no write. Opening the
 * inspector must not change what it is inspecting, and it must not put a
 * summariser turn on the athlete's bill for the privilege of looking.
 *
 * With the automatic pass switched off the plan is still shown, because "what
 * would this send if it were on" is exactly the question the inspector is open
 * to answer; `enabled` says which of the two the athlete is actually getting.
 */
export function inspectChatSessionContext(
  sessionId: string,
  entries?: PersistedChatEntry[],
  deps: InspectChatSessionDeps = createDefaultInspectDeps()
): ChatContextInspection {
  const transcript = entries ?? deps.loadEntries(sessionId);
  const window = deps.window();
  const budget = deps.budget?.();
  const digestOf = deps.digests?.(transcript);
  const plan = planTranscriptContext(transcript, deps.stored(sessionId), window, {
    ...(budget ? { budget } : {}),
    ...(digestOf ? { digestOf } : {})
  });
  const pending = toWireMessages(plan.toSummarise, digestOf);
  const middle = toWireMessages(plan.middle, digestOf);
  const tail = toWireMessages(plan.tail);
  const head = plan.summary ? [summaryContextMessage(plan.summary)] : [];
  return {
    ...(plan.summary ? { summary: plan.summary } : {}),
    // What the summary covers *now* — not the plan's `through`, which is what
    // that count becomes after a pending roll. An inspector that reported the
    // future value would say a summary covers turns it has never seen, and the
    // half of this view that matters is the difference between the two.
    through: transcript.length - plan.toSummarise.length - plan.middle.length - plan.tail.length,
    window,
    enabled: deps.enabled(),
    entryCount: transcript.length,
    tailStart: transcript.length - plan.tail.length,
    pending,
    ...(middle.length ? { middle } : {}),
    tail,
    characterCount: [...head, ...pending, ...middle, ...tail].reduce(
      (total, message) => total + message.content.length,
      0
    )
  };
}
