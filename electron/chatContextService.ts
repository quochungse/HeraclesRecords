import { randomUUID } from "node:crypto";
import {
  cancelChat,
  createCollectorSink,
  createIdleWatchdog,
  getChatSettings,
  streamChat,
  type ChatStreamSink
} from "./chatService";
import {
  getChatSessionCoachSummaryRow,
  setChatSessionCoachSummaryRow
} from "./database";
import { chatSessionExists, getChatSession } from "./chatHistoryStore";
import {
  applyTranscriptContext,
  buildRollingSummaryTurn,
  normalizeContextWindow,
  planTranscriptContext,
  summaryContextMessage,
  toWireMessages,
  type ContextWindow,
  type StoredTranscriptSummary,
  type TranscriptContextResult
} from "./chatContextCompaction";
import {
  ANALYSIS_DEFAULT_EFFORT,
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
        : 0
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
   * The provider, model and effort the roll runs on. An analysis passes its
   * own (its tokens land on its run's row, and its provider is the one that was
   * pre-flighted); the interactive chat passes nothing and inherits the saved
   * settings.
   */
  runtime?: AnalysisRuntime;
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
  // Its own request id, never the caller's: an analysis roll happens while a
  // run is still being prepared and has no row yet, and an interactive roll
  // must not be cancelled by a Stop aimed at the turn it is preparing for.
  const requestId = `coach-summary-${randomUUID()}`;
  const collector = createCollectorSink();
  const watchdog = createIdleWatchdog(
    options.idleTimeoutMs ?? SUMMARISER_IDLE_TIMEOUT_MS
  );
  const sink: ChatStreamSink = {
    emit(channel, payload) {
      watchdog.touch();
      collector.emit(channel, payload);
    }
  };
  // Whatever the roll spent goes back with it on every exit, including the ones
  // that produce nothing.
  const spent = () => {
    const usage = collector.usage();
    return usage ? { usage } : {};
  };
  /**
   * Every exit that produced no summary comes through here, so no failure can
   * reach a caller as a bare null. It also lands in the main-process log: the
   * caller may choose not to show the reason, and a reason nobody can read is
   * how "nothing was compacted" became a message with no cause attached.
   */
  const failed = (reason: string) => {
    console.warn(`[coach] rolling summary failed: ${reason}`);
    return { reason, ...spent() };
  };
  try {
    const streaming = streamChat(
      sink,
      requestId,
      [{ role: "user", content: buildRollingSummaryTurn(previous, entries) }],
      {
        // Nothing to look up: it is compressing text it was handed, and a tool
        // round-trip here is both slower and a way to wander off.
        toolPolicy: "none",
        // Effort is the one thing that does not inherit. It is cost rather than
        // capability, and a summariser compressing text it was handed has
        // nothing to think harder about — so a coach set to `high` gets a
        // `high` answer and a `low` summary.
        runtime: { ...(options.runtime ?? {}), effort: ANALYSIS_DEFAULT_EFFORT }
      }
    );
    streaming.catch(() => undefined);
    let timedOut = false;
    await Promise.race([
      streaming,
      watchdog.expired.then(() => {
        timedOut = true;
      })
    ]);
    if (timedOut) {
      cancelChat(requestId);
      return { summary: null, ...failed("the summariser stopped responding") };
    }
    const providerError = collector.error();
    if (providerError) {
      return { summary: null, ...failed(providerError) };
    }
    if (collector.cancelled()) {
      return { summary: null, ...failed("the summariser turn was cancelled") };
    }
    const text = collector.text().trim();
    if (!text) {
      return {
        summary: null,
        ...failed("the summariser answered with nothing")
      };
    }
    return { summary: text, ...spent() };
  } catch (caught) {
    return {
      summary: null,
      ...failed(caught instanceof Error ? caught.message : String(caught))
    };
  } finally {
    watchdog.stop();
  }
}

export interface CompactSessionOptions {
  /** Roll now, whatever the limit says — the conversation menu's action. */
  force?: boolean;
  runtime?: AnalysisRuntime;
  window?: ContextWindow;
  idleTimeoutMs?: number;
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
  return applyTranscriptContext({
    entries,
    stored: readSessionSummary(sessionId),
    window: options.window ?? getContextWindow(),
    ...(options.force ? { force: true } : {}),
    roll: (previous, toSummarise) =>
      rollTranscriptSummary(previous, toSummarise, {
        ...(options.runtime ? { runtime: options.runtime } : {}),
        ...(options.idleTimeoutMs !== undefined
          ? { idleTimeoutMs: options.idleTimeoutMs }
          : {})
      }),
    store: (summary, through) =>
      writeSessionSummary(sessionId, summary, through)
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
}

export function createDefaultInspectDeps(): InspectChatSessionDeps {
  return {
    enabled: isContextCompactionEnabled,
    window: getContextWindow,
    stored: readSessionSummary,
    loadEntries: (sessionId) =>
      chatSessionExists(sessionId) ? getChatSession(sessionId) : []
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
  const plan = planTranscriptContext(transcript, deps.stored(sessionId), window);
  const pending = toWireMessages(plan.toSummarise);
  const tail = toWireMessages(plan.tail);
  const head = plan.summary ? [summaryContextMessage(plan.summary)] : [];
  return {
    ...(plan.summary ? { summary: plan.summary } : {}),
    // What the summary covers *now* — not the plan's `through`, which is what
    // that count becomes after a pending roll. An inspector that reported the
    // future value would say a summary covers turns it has never seen, and the
    // half of this view that matters is the difference between the two.
    through: transcript.length - plan.toSummarise.length - plan.tail.length,
    window,
    enabled: deps.enabled(),
    entryCount: transcript.length,
    tailStart: transcript.length - plan.tail.length,
    pending,
    tail,
    characterCount: [...head, ...pending, ...tail].reduce(
      (total, message) => total + message.content.length,
      0
    )
  };
}
