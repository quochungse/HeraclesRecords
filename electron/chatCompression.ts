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
import { compressionModelFor, providerModelOptions } from "./chatModels";
import {
  DIGEST_THINKING_BUDGET,
  digestProblems,
  digestSystemPrompt,
  digestUserPrompt
} from "./answerDigest";
import {
  ANALYSIS_DEFAULT_EFFORT,
  type AnalysisRuntime,
  type ChatProvider,
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
export const TEXT_JOB_IDLE_TIMEOUT_MS = 3 * 60_000;

/** What a text job runs on. */
export interface CompressionRuntime {
  runtime: AnalysisRuntime;
  /** Set for a model that takes a thinking budget rather than an effort. */
  thinkingBudget?: number;
}

/** The provider's model setting a conversation that names none falls back to. */
function savedModel(provider: ChatProvider, settings: ChatSettings): string | undefined {
  switch (provider) {
    case "claude-code":
      return settings.claudeCode.model || undefined;
    case "claude-api":
      return settings.anthropic.model || undefined;
    case "openrouter":
      return settings.openRouter.model || undefined;
    case "chatgpt":
      return settings.chatgpt.model || undefined;
    case "local":
      return settings.local.model || undefined;
  }
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
  const provider = base.provider ?? conversation?.provider ?? settings.provider;
  const model = base.model ?? conversation?.model ?? savedModel(provider, settings);
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
export function answerKey(answer: string): string {
  return createHash("sha256").update(answer).digest("hex");
}

/**
 * The digests made so far for a transcript's answers, read in one query. A
 * refused digest is stored as NULL and reads as none: its answer goes out
 * whole, and `requestDigests` does not try it again.
 */
export function transcriptDigests(entries: readonly PersistedChatEntry[]): AnswerDigestLookup {
  const answers = toWireMessages(entries)
    .filter((message) => message.role === "assistant")
    .map((message) => message.content);
  const digests = new Map<string, string>();
  for (const row of getChatAnswerDigestRows([...new Set(answers.map(answerKey))])) {
    if (row.digest) digests.set(row.answer_key, row.digest);
  }
  return (answer) => digests.get(answerKey(answer));
}

/** Answers being digested now, so a second turn does not start the same work. */
const digesting = new Set<string>();

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
  const known = new Set(getChatAnswerDigestRows(requests.map((request) => answerKey(request.answer))).map((row) => row.answer_key));
  const fresh = requests.filter((request) => {
    const key = answerKey(request.answer);
    if (known.has(key) || digesting.has(key)) return false;
    digesting.add(key);
    return true;
  });
  if (!fresh.length) return;
  let compression: CompressionRuntime;
  try {
    compression = resolveCompressionRuntime(sessionId, base);
  } catch (caught) {
    for (const request of fresh) digesting.delete(answerKey(request.answer));
    throw caught;
  }
  for (const request of fresh) {
    const key = answerKey(request.answer);
    try {
      const made = await makeDigest(request, compression);
      if (made.stored) putChatAnswerDigestRow(key, sessionId, made.digest, made.model ?? null);
    } catch (caught) {
      console.warn(`[coach] digest failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      digesting.delete(key);
    }
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
