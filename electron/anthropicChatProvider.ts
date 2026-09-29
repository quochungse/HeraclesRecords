import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError
} from "@anthropic-ai/sdk";
import type {
  AnthropicApiConnectionTest,
  AnthropicEffort,
  ChatMessage,
  ChatTokenUsage,
  CorosMcpTool,
  ModelCatalogEntry
} from "./types";
import {
  DEFAULT_ANTHROPIC_MODEL,
  effortForModel,
  formatClaudeModelName
} from "./chatModels";

export { DEFAULT_ANTHROPIC_MODEL };
export const DEFAULT_ANTHROPIC_EFFORT: AnthropicEffort = "high";

// Pinned so a stray ANTHROPIC_BASE_URL in the user's environment can never
// redirect their key to another host.
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
// Requests stream, so a generous cap costs nothing and avoids mid-plan cutoffs.
const MAX_OUTPUT_TOKENS = 64_000;
// Used for model ids this build does not know: over-asking is a hard 400, while
// a lower ceiling only risks truncating an unusually long plan.
const CONSERVATIVE_OUTPUT_TOKENS = 32_000;
// Server-side rescue when a safety classifier declines a turn. The same beta
// is what makes `/v1/models` publish each model's `allowed_fallback_models`,
// so the list is asked for under it too.
const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-06-01";
// Preferred while a model still allows it, which keeps the rescue what it was
// before the list was read from the API; otherwise the model's first allowed
// target is taken, so a retired fallback does not strand the ones that named it.
const PREFERRED_FALLBACK_MODEL = "claude-opus-4-8";

export type AnthropicFailureKind =
  | "no-key"
  | "auth"
  | "usage-limit"
  | "model-unavailable"
  | "refusal"
  | "cancelled"
  | "connection";

export class AnthropicProviderError extends Error {
  constructor(
    message: string,
    readonly kind: AnthropicFailureKind
  ) {
    super(message);
    this.name = "AnthropicProviderError";
  }
}

export interface AnthropicModelCapabilities {
  /** Accepts thinking: { type: "adaptive" }. */
  adaptiveThinking: boolean;
  /** Accepts output_config.effort. */
  effort: boolean;
  /** The levels it accepts, where known; absent means every level. */
  efforts?: AnthropicEffort[];
  /** Model a refusal is retried on server-side; `""` for none. */
  fallbackModel: string;
  /** Ceiling for max_tokens; asking for more than a model allows is a 400. */
  maxOutputTokens: number;
}

/*
 * What this build knew about the models it shipped with. The account's own
 * list (`listAnthropicModels`, cached in `modelCatalogs`) outranks every row
 * here field by field; this table answers only before that list has been
 * read, or for a field the API left out.
 */
const MODEL_CAPABILITIES: Record<string, AnthropicModelCapabilities> = {
  "claude-opus-5": {
    adaptiveThinking: true,
    effort: true,
    fallbackModel: PREFERRED_FALLBACK_MODEL,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-opus-5-5": {
    adaptiveThinking: true,
    effort: true,
    // Its permitted targets were still open at launch; the API's list says.
    fallbackModel: "",
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-fable-5": {
    adaptiveThinking: true,
    effort: true,
    fallbackModel: PREFERRED_FALLBACK_MODEL,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-fable-5-1": {
    adaptiveThinking: true,
    effort: true,
    fallbackModel: PREFERRED_FALLBACK_MODEL,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-sonnet-5": {
    adaptiveThinking: true,
    effort: true,
    fallbackModel: "",
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-haiku-4-5": {
    adaptiveThinking: false,
    effort: false,
    efforts: [],
    fallbackModel: "",
    maxOutputTokens: MAX_OUTPUT_TOKENS
  }
};

// A model id newer than this build is far likelier to be current-generation
// than pre-4.6, so assume adaptive thinking and effort rather than dropping
// them. Refusal fallbacks stay opt-in per known model.
const ASSUMED_CAPABILITIES: AnthropicModelCapabilities = {
  adaptiveThinking: true,
  effort: true,
  fallbackModel: "",
  maxOutputTokens: CONSERVATIVE_OUTPUT_TOKENS
};

/**
 * What a request to `model` may carry: the account's list where it states a
 * field (`listed`), this build's table where it does not, and the assumed
 * modern shape for an id neither knows. The output ceiling is the API's own
 * figure, held to this app's cap — a request streams, so the cap costs
 * nothing, and the figure is what keeps a new model from a 400.
 */
export function getAnthropicModelCapabilities(
  model: string,
  listed?: ModelCatalogEntry
): AnthropicModelCapabilities {
  const known = MODEL_CAPABILITIES[model.trim()] ?? ASSUMED_CAPABILITIES;
  if (!listed) return known;
  const efforts = listed.efforts ?? known.efforts;
  return {
    adaptiveThinking: listed.adaptiveThinking ?? known.adaptiveThinking,
    effort: efforts ? efforts.length > 0 : known.effort,
    ...(efforts ? { efforts } : {}),
    fallbackModel: listed.fallbackModel ?? known.fallbackModel,
    maxOutputTokens: listed.maxOutputTokens
      ? Math.min(MAX_OUTPUT_TOKENS, listed.maxOutputTokens)
      : known.maxOutputTokens
  };
}

export function resolveAnthropicModel(model?: string): string {
  return model?.trim() || DEFAULT_ANTHROPIC_MODEL;
}

export interface AnthropicRuntimeConfig {
  apiKey?: string;
  model: string;
  effort: AnthropicEffort;
  /** The model's row in the account's list, when that list has been read. */
  listed?: ModelCatalogEntry;
}

interface AnthropicRequestTuning {
  thinking?: Anthropic.Beta.BetaThinkingConfigParam;
  output_config?: Anthropic.Beta.BetaOutputConfig;
  betas?: Anthropic.Beta.AnthropicBeta[];
  fallbacks?: Anthropic.Beta.BetaFallbackParam[];
}

/**
 * Per-model request extras. Sending adaptive thinking or effort to a model that
 * does not support them is a 400, so each is gated on the model's capabilities.
 */
export function buildAnthropicRequestTuning(
  config: AnthropicRuntimeConfig
): AnthropicRequestTuning {
  const model = resolveAnthropicModel(config.model);
  const capabilities = getAnthropicModelCapabilities(model, config.listed);
  const tuning: AnthropicRequestTuning = {};

  if (capabilities.adaptiveThinking) {
    // "summarized" so the Coach transcript can show reasoning; the default
    // omits it and reads as a long pause before the answer appears.
    tuning.thinking = { type: "adaptive", display: "summarized" };
  }
  const effort = capabilities.effort
    ? effortForModel(config.effort, capabilities.efforts)
    : undefined;
  if (effort) {
    tuning.output_config = { effort };
  }
  if (capabilities.fallbackModel) {
    tuning.betas = [REFUSAL_FALLBACK_BETA];
    tuning.fallbacks = [{ model: capabilities.fallbackModel }];
  }
  return tuning;
}

export function buildAnthropicTools(
  tools: CorosMcpTool[]
): Anthropic.Beta.BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: (tool.inputSchema ?? {
      type: "object",
      properties: {}
    }) as Anthropic.Beta.BetaTool.InputSchema
  }));
}

/**
 * The Messages API requires the first message to be from the user and rejects
 * empty content, so a resumed or trimmed transcript is normalized here.
 */
export function buildAnthropicMessages(
  messages: ChatMessage[]
): Anthropic.Beta.BetaMessageParam[] {
  const usable = messages.filter((message) => message.content.trim().length > 0);
  const firstUserIndex = usable.findIndex((message) => message.role === "user");
  return firstUserIndex < 0
    ? []
    : usable.slice(firstUserIndex).map((message) => ({
        role: message.role,
        content: message.content
      }));
}

/**
 * The system prompt as two blocks, the first carrying a cache marker.
 *
 * A tool-using answer is several requests, each re-sending the tools, the
 * system prompt and the conversation so far — ~20k tokens before the athlete's
 * words, most of it tool schemas — and nothing was cached, so every round paid
 * for all of it again. The marker sits on the end of what does not change
 * within a conversation (tools render before the system prompt, so it covers
 * them too); `live`, the date and the COROS snapshot, comes after it, so a new
 * recovery figure costs only itself. The request's top-level `cache_control`
 * does the rest, moving a second marker along the growing conversation.
 */
export function buildAnthropicSystem(
  instructions: string,
  live?: string
): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: instructions, cache_control: { type: "ephemeral" } },
    ...(live?.trim() ? [{ type: "text" as const, text: live }] : [])
  ];
}

export interface StreamAnthropicChatOptions {
  config: AnthropicRuntimeConfig;
  /** What stays the same across a conversation; cached. */
  instructions: string;
  /** What this turn read (the date, the snapshot); sent after the cache marker. */
  liveInstructions?: string;
  messages: ChatMessage[];
  tools: CorosMcpTool[];
  maxToolRounds: number;
  signal: AbortSignal;
  onToken(delta: string): void;
  onThinking?(delta: string): void;
  onToolCallStart?(toolName: string): void;
  onToolCallError?(toolName: string, message: string): void;
  onToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string>;
}

function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL });
}

export async function streamAnthropicChatCompletion(
  options: StreamAnthropicChatOptions
): Promise<{ fullText: string; usage?: ChatTokenUsage; model: string }> {
  const apiKey = options.config.apiKey?.trim();
  if (!apiKey) {
    throw new AnthropicProviderError(
      "Add your Anthropic API key in Settings to use Claude directly.",
      "no-key"
    );
  }

  const model = resolveAnthropicModel(options.config.model);
  const conversation = buildAnthropicMessages(options.messages);
  if (conversation.length === 0) {
    throw new AnthropicProviderError(
      "There is no athlete message to answer yet.",
      "connection"
    );
  }

  const client = createAnthropicClient(apiKey);
  const tuning = buildAnthropicRequestTuning(options.config);
  const tools = buildAnthropicTools(options.tools);
  let fullText = "";
  // Summed across rounds: a tool-using answer is several API calls and the
  // athlete pays for every one of them. `counted` stays false until a round
  // actually reports, so a run nobody told us about is undefined, not zero.
  let counted = false;
  const usage: ChatTokenUsage = { inputTokens: 0, outputTokens: 0 };

  try {
    for (let round = 0; round < options.maxToolRounds; round++) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: getAnthropicModelCapabilities(model, options.config.listed)
            .maxOutputTokens,
          system: buildAnthropicSystem(options.instructions, options.liveInstructions),
          cache_control: { type: "ephemeral" },
          messages: conversation,
          ...(tools.length > 0 ? { tools } : {}),
          ...tuning
        },
        { signal: options.signal }
      );

      stream.on("text", (delta) => {
        fullText += delta;
        options.onToken(delta);
      });
      if (options.onThinking) {
        stream.on("thinking", (delta) => options.onThinking?.(delta));
      }

      const message = await stream.finalMessage();

      if (message.usage) {
        counted = true;
        // Cache reads and writes are input the athlete is billed for, so they
        // belong in the input count rather than being quietly dropped.
        usage.inputTokens +=
          (message.usage.input_tokens ?? 0) +
          (message.usage.cache_creation_input_tokens ?? 0) +
          (message.usage.cache_read_input_tokens ?? 0);
        usage.outputTokens += message.usage.output_tokens ?? 0;
      }

      if (message.stop_reason === "refusal") {
        throw new AnthropicProviderError(
          refusalMessage(message.stop_details),
          "refusal"
        );
      }

      const toolUses = message.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock =>
          block.type === "tool_use"
      );

      // No tool calls this round means the model answered; we are done.
      if (toolUses.length === 0) {
        break;
      }

      conversation.push({ role: "assistant", content: message.content });

      // Every result for a round goes back in one user message; splitting them
      // teaches the model to stop calling tools in parallel.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of toolUses) {
        options.onToolCallStart?.(call.name);
        try {
          const output = await options.onToolCall(
            call.name,
            (call.input ?? {}) as Record<string, unknown>
          );
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: output
          });
        } catch (caught) {
          const detail = safeErrorMessage(caught);
          options.onToolCallError?.(call.name, detail);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Error: ${detail}`,
            is_error: true
          });
        }
      }
      conversation.push({ role: "user", content: results });
    }

    // Reported rather than left to the caller to infer: `resolveAnthropicModel`
    // fills in the default when nothing was chosen, so the config alone does
    // not say what answered.
    return { fullText, model, ...(counted ? { usage } : {}) };
  } catch (caught) {
    throw normalizeAnthropicError(caught);
  }
}

export async function testAnthropicApiConnectionRequest(
  config: AnthropicRuntimeConfig
): Promise<AnthropicApiConnectionTest> {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    return { ok: false, message: "Add your Anthropic API key first." };
  }

  const model = resolveAnthropicModel(config.model);
  try {
    // Retrieving the model validates the key and the account's access to that
    // model without spending any tokens.
    const info = await createAnthropicClient(apiKey).models.retrieve(model);
    return {
      ok: true,
      model: info.id,
      message: `Connected to ${info.display_name}.`
    };
  } catch (caught) {
    const error = normalizeAnthropicError(caught);
    return {
      ok: false,
      message:
        error.kind === "model-unavailable"
          ? `This API key cannot access ${model}.`
          : error.message
    };
  }
}

const EFFORT_LEVELS: AnthropicEffort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * One model as `/v1/models` describes it, as a picker row that also carries
 * what a request to it may hold. A capability the API left out (`null`
 * capabilities, an absent fallback list) stays absent, so the build's own
 * table can still answer for it — absent is "not stated", never "no".
 */
export function anthropicModelEntry(info: {
  id: string;
  display_name?: string | null;
  max_tokens?: number | null;
  allowed_fallback_models?: string[] | null;
  capabilities?: Anthropic.Beta.BetaModelCapabilities | null;
}): ModelCatalogEntry {
  const capabilities = info.capabilities;
  const efforts = capabilities?.effort
    ? capabilities.effort.supported
      ? EFFORT_LEVELS.filter((level) => capabilities.effort[level]?.supported === true)
      : []
    : undefined;
  const allowed = Array.isArray(info.allowed_fallback_models)
    ? info.allowed_fallback_models.filter((id) => typeof id === "string" && id.trim())
    : undefined;
  return {
    value: info.id,
    label: info.display_name?.trim() || formatClaudeModelName(info.id),
    ...(efforts ? { efforts } : {}),
    ...(capabilities?.thinking
      ? { adaptiveThinking: capabilities.thinking.types?.adaptive?.supported === true }
      : {}),
    ...(typeof info.max_tokens === "number" && info.max_tokens > 0
      ? { maxOutputTokens: info.max_tokens }
      : {}),
    ...(allowed
      ? {
          fallbackModel: allowed.includes(PREFERRED_FALLBACK_MODEL)
            ? PREFERRED_FALLBACK_MODEL
            : (allowed[0] ?? "")
        }
      : {})
  };
}

/**
 * Every model this key can use, newest first, as the API lists them. Costs
 * no tokens. The fallback beta is sent so each row carries its
 * `allowed_fallback_models`; without it the field is absent and every model
 * would read as having no rescue.
 */
export async function listAnthropicModels(
  apiKey: string,
  signal?: AbortSignal
): Promise<ModelCatalogEntry[]> {
  const client = createAnthropicClient(apiKey);
  const entries: ModelCatalogEntry[] = [];
  try {
    for await (const info of client.beta.models.list(
      { betas: [REFUSAL_FALLBACK_BETA], limit: 100 },
      { signal: signal ?? AbortSignal.timeout(15_000) }
    )) {
      if (info.id?.trim()) entries.push(anthropicModelEntry(info));
    }
  } catch (caught) {
    throw normalizeAnthropicError(caught);
  }
  return entries;
}

export function normalizeAnthropicError(
  caught: unknown
): AnthropicProviderError {
  if (caught instanceof AnthropicProviderError) {
    return caught;
  }
  if (caught instanceof APIUserAbortError) {
    return new AnthropicProviderError("Claude request cancelled.", "cancelled");
  }
  if (caught instanceof AuthenticationError) {
    return new AnthropicProviderError(
      "Your Anthropic API key was rejected. Check the key in Settings.",
      "auth"
    );
  }
  if (caught instanceof PermissionDeniedError) {
    return new AnthropicProviderError(
      "This Anthropic API key is not allowed to make this request.",
      "auth"
    );
  }
  if (caught instanceof RateLimitError) {
    return new AnthropicProviderError(
      "Anthropic rate limit reached, or the account is out of credit. Try again later or choose another provider.",
      "usage-limit"
    );
  }
  if (caught instanceof NotFoundError) {
    return new AnthropicProviderError(
      "That Claude model is not available to this API key.",
      "model-unavailable"
    );
  }
  if (caught instanceof APIConnectionError) {
    return new AnthropicProviderError(
      "Could not reach the Anthropic API. Check your connection.",
      "connection"
    );
  }
  if (caught instanceof APIError) {
    return new AnthropicProviderError(
      `Claude request failed (${caught.status ?? "unknown"}). ${truncate(caught.message, 400)}`,
      "connection"
    );
  }
  return new AnthropicProviderError(
    `Claude request failed: ${truncate(safeErrorMessage(caught), 400)}`,
    "connection"
  );
}

function refusalMessage(
  details: Anthropic.Beta.BetaMessage["stop_details"]
): string {
  const category =
    details && details.type === "refusal" ? details.category : undefined;
  return category
    ? `Claude declined this request (${category}). Try rephrasing it.`
    : "Claude declined this request. Try rephrasing it.";
}

function safeErrorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught || "Unknown error");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
