import { createHash, randomUUID } from "node:crypto";
import {
  cancelChat,
  createCollectorSink,
  createIdleWatchdog,
  getChatSettings,
  getConversationSettings,
  streamChat,
  type ChatStreamSink
} from "./chatService";
import {
  getChatAnswerDigestRows,
  putChatAnswerDigestRow
} from "./database";
import {
  normalizeCompactModelChoice,
  toWireMessages,
  type AnswerDigestLookup,
  type DigestRequest
} from "./chatContextCompaction";
import { compressionModelFor, providerModelOptions, runtimeOver, settingsModel } from "./chatModels";
import {
  DIGEST_THINKING_BUDGET,
  digestProblems,
  digestSystemPrompt,
  digestUserPrompt
} from "./answerDigest";
import {
  ANALYSIS_DEFAULT_EFFORT,
  type AnalysisRuntime,
  type ChatSettings,
  type ChatTokenUsage,
  type PersistedChatEntry
} from "./types";

/**
 * The model calls that make a long conversation cheaper to send: the digest
 * of a coach answer (`answerDigest.ts`) and the rolling summary. Both are text
 * jobs — Coach's prompt, snapshot and tools stay out of them — and both run on
 * the model `chat.compactContext.model` chooses.
 */

/** How long a text job may emit nothing before it is given up on. */
const TEXT_JOB_IDLE_TIMEOUT_MS = 3 * 60_000;

/** What a text job runs on. */
export interface CompressionRuntime {
  runtime: AnalysisRuntime;
  /** Set for a model that takes a thinking budget rather than an effort. */
  thinkingBudget?: number;
}

/**
 * The model a text job for this conversation runs on.
 *
 * `base` is what the conversation answers with — its own runtime, or an
 * analysis's — and Coach's settings fill in what it leaves out. `auto` takes
 * the smallest model that provider lists (`compressionModelFor`) and falls
 * back to the conversation's; `fixed` is the athlete's pick whatever the
 * conversation uses. The effort is always the lowest: compressing text it was
 * handed is nothing to think hard about.
 *
 * A thinking budget goes with a model that takes no effort — on Claude Code, a
 * row the CLI lists with no effort levels, which is how Haiku 4.5 arrives; on
 * the Messages API, the provider decides from the model's capabilities and
 * ignores the budget on a model with adaptive thinking.
 */
export function resolveCompressionRuntime(
  sessionId: string | undefined,
  base: AnalysisRuntime = {},
  settings: ChatSettings = getChatSettings()
): CompressionRuntime {
  const conversation = sessionId ? getConversationSettings(sessionId).runtime : undefined;
  // A base naming only its provider must not borrow a model the conversation
  // picked for another one.
  const pair = runtimeOver(base, conversation);
  const provider = pair.provider ?? settings.provider;
  const model = pair.model ?? (settingsModel(settings, provider) || undefined);
  const choice = normalizeCompactModelChoice(settings.compactContext?.model);
  const picked =
    choice.kind === "fixed"
      ? { provider: choice.provider, model: choice.model }
      : choice.kind === "conversation"
        ? { provider, model }
        : { provider, model: compressionModelFor(provider, providerModelOptions(provider, settings))?.value ?? model };
  const runtime: AnalysisRuntime = {
    provider: picked.provider,
    ...(picked.model ? { model: picked.model } : {}),
    effort: ANALYSIS_DEFAULT_EFFORT
  };
  const row = providerModelOptions(picked.provider, settings).find((option) => option.value === picked.model);
  const takesBudget =
    picked.provider === "claude-api" ||
    (picked.provider === "claude-code" && Boolean(row) && !row?.efforts?.length);
  return { runtime, ...(takesBudget ? { thinkingBudget: DIGEST_THINKING_BUDGET } : {}) };
}

/**
 * One text job: a system prompt, one message, the answer's text. Returns a
 * null text when it produced nothing, with the reason and whatever it spent —
 * a job that spent its tokens and then declined still spent them.
 */
export async function runTextJob(options: {
  system: string;
  prompt: string;
  compression: CompressionRuntime;
  /** Names the request, for the log. */
  label: string;
  idleTimeoutMs?: number;
}): Promise<{ text: string | null; usage?: ChatTokenUsage; model?: string; reason?: string }> {
  // Its own request id, never a caller's: a job must not be cancelled by a
  // Stop aimed at the turn it is preparing for.
  const requestId = `coach-${options.label}-${randomUUID()}`;
  const collector = createCollectorSink();
  const watchdog = createIdleWatchdog(options.idleTimeoutMs ?? TEXT_JOB_IDLE_TIMEOUT_MS);
  let model: string | undefined;
  const sink: ChatStreamSink = {
    emit(channel, payload) {
      watchdog.touch();
      if (channel === "chat:streamDone") {
        const answered = (payload as { model?: unknown }).model;
        if (typeof answered === "string") model = answered;
      }
      collector.emit(channel, payload);
    }
  };
  const spent = () => {
    const usage = collector.usage();
    return { ...(usage ? { usage } : {}), ...(model ? { model } : {}) };
  };
  const failed = (reason: string) => {
    console.warn(`[coach] ${options.label} failed: ${reason}`);
    return { text: null, reason, ...spent() };
  };
  try {
    const streaming = streamChat(sink, requestId, [{ role: "user", content: options.prompt }], {
      toolPolicy: "none",
      runtime: options.compression.runtime,
      textJob: {
        system: options.system,
        ...(options.compression.thinkingBudget ? { thinkingBudget: options.compression.thinkingBudget } : {})
      }
    });
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
      return failed("it stopped responding");
    }
    const providerError = collector.error();
    if (providerError) return failed(providerError);
    if (collector.cancelled()) return failed("it was cancelled");
    const text = collector.text().trim();
    if (!text) return failed("it answered with nothing");
    return { text, ...spent() };
  } catch (caught) {
    return failed(caught instanceof Error ? caught.message : String(caught));
  } finally {
    watchdog.stop();
  }
}

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

/** How a digest is keyed: the answer's text, as the wire carries it. */
function answerKey(answer: string): string {
  return createHash("sha256").update(answer).digest("hex");
}

/**
 * The digests made so far for a transcript's answers, read in one query. A
 * refused digest is stored as NULL and reads as none: its answer goes out
 * whole, and `requestDigests` does not try it again.
 */
export function transcriptDigests(entries: readonly PersistedChatEntry[]): AnswerDigestLookup {
  // Hashed once here: a turn's planning looks the same answer up several times.
  const keys = new Map<string, string>();
  for (const message of toWireMessages(entries)) {
    if (message.role === "assistant") keys.set(message.content, answerKey(message.content));
  }
  const digests = new Map<string, string>();
  for (const row of getChatAnswerDigestRows([...new Set(keys.values())])) {
    if (row.digest) digests.set(row.answer_key, row.digest);
  }
  return (answer) => digests.get(keys.get(answer) ?? answerKey(answer));
}

/** Answers being digested now, so a second turn does not start the same work. */
const digesting = new Set<string>();

/**
 * How long a model that could not run a digest is left alone. A job that could
 * not run — a provider signed out, a chosen model gone, a quota spent — says
 * nothing about the answer and will fail the same way for the next one, so the
 * batch stops there, and the turns after it do not start the same doomed jobs.
 */
const DIGEST_BACKOFF_MS = 10 * 60_000;
const unavailableUntil = new Map<string, number>();

function runtimeKey({ runtime }: CompressionRuntime): string {
  return `${runtime.provider ?? ""}:${runtime.model ?? ""}`;
}

/**
 * Makes digests for these answers, one at a time, in the background. An answer
 * with a row already — made, or refused — is skipped, and so is one already in
 * hand. Each digest is checked (`digestProblems`) and tried once more with the
 * reasons when it fails; a second failure is stored as refused.
 */
export async function requestDigests(
  sessionId: string,
  requests: readonly DigestRequest[],
  base: AnalysisRuntime = {}
): Promise<void> {
  const keyed = requests.map((request) => ({ request, key: answerKey(request.answer) }));
  const known = new Set(getChatAnswerDigestRows(keyed.map(({ key }) => key)).map((row) => row.answer_key));
  const fresh = keyed.filter(({ key }) => !known.has(key) && !digesting.has(key));
  if (!fresh.length) return;
  const compression = resolveCompressionRuntime(sessionId, base);
  const backoff = runtimeKey(compression);
  if ((unavailableUntil.get(backoff) ?? 0) > Date.now()) return;
  for (const { key } of fresh) digesting.add(key);
  try {
    for (const { request, key } of fresh) {
      try {
        const made = await makeDigest(request, compression);
        if (!made.stored) {
          unavailableUntil.set(backoff, Date.now() + DIGEST_BACKOFF_MS);
          return;
        }
        putChatAnswerDigestRow(key, sessionId, made.digest, made.model ?? null);
      } catch (caught) {
        console.warn(`[coach] digest failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
  } finally {
    for (const { key } of fresh) digesting.delete(key);
  }
}

async function makeDigest(
  request: DigestRequest,
  compression: CompressionRuntime
): Promise<{ stored: boolean; digest: string | null; model?: string }> {
  let problems: string[] = [];
  let model: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const job = await runTextJob({
      system: digestSystemPrompt(),
      prompt: digestUserPrompt(request.answer, request.question, problems),
      compression,
      label: "digest"
    });
    model = job.model ?? model;
    // A job that could not run says nothing about the answer: nothing is
    // stored, and a later turn asks again.
    if (job.text === null) return { stored: false, digest: null };
    problems = digestProblems(job.text, request.answer, request.question);
    if (!problems.length) return { stored: true, digest: job.text, ...(model ? { model } : {}) };
  }
  console.warn(`[coach] digest refused: ${problems.join("; ")}`);
  return { stored: true, digest: null, ...(model ? { model } : {}) };
}
