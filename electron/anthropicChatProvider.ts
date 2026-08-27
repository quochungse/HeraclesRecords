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
  CorosMcpTool
} from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
export const DEFAULT_ANTHROPIC_EFFORT: AnthropicEffort = "high";

// Pinned so a stray ANTHROPIC_BASE_URL in the user's environment can never
// redirect their key to another host.
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
// Requests stream, so a generous cap costs nothing and avoids mid-plan cutoffs.
const MAX_OUTPUT_TOKENS = 64_000;
// Used for model ids this build does not know: over-asking is a hard 400, while
// a lower ceiling only risks truncating an unusually long plan.
const CONSERVATIVE_OUTPUT_TOKENS = 32_000;
// Server-side rescue when a safety classifier declines a turn.
const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-06-01";
const REFUSAL_FALLBACK_MODEL = "claude-opus-4-8";

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
  /** Refusals on this model can be rescued by a server-side fallback. */
  refusalFallback: boolean;
  /** Ceiling for max_tokens; asking for more than a model allows is a 400. */
  maxOutputTokens: number;
}

const MODEL_CAPABILITIES: Record<string, AnthropicModelCapabilities> = {
  "claude-opus-5": {
    adaptiveThinking: true,
    effort: true,
    refusalFallback: true,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-fable-5": {
    adaptiveThinking: true,
    effort: true,
    refusalFallback: true,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-sonnet-5": {
    adaptiveThinking: true,
    effort: true,
    refusalFallback: false,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  },
  "claude-haiku-4-5": {
    adaptiveThinking: false,
    effort: false,
    refusalFallback: false,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  }
};

// A model id newer than this build is far likelier to be current-generation
// than pre-4.6, so assume adaptive thinking and effort rather than dropping
// them. Refusal fallbacks stay opt-in per known model.
const ASSUMED_CAPABILITIES: AnthropicModelCapabilities = {
  adaptiveThinking: true,
  effort: true,
  refusalFallback: false,
  maxOutputTokens: CONSERVATIVE_OUTPUT_TOKENS
};

export function getAnthropicModelCapabilities(
  model: string
): AnthropicModelCapabilities {
  return MODEL_CAPABILITIES[model.trim()] ?? ASSUMED_CAPABILITIES;
}

export function resolveAnthropicModel(model?: string): string {
  return model?.trim() || DEFAULT_ANTHROPIC_MODEL;
}

export interface AnthropicRuntimeConfig {
  apiKey?: string;
  model: string;
  effort: AnthropicEffort;
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
  const capabilities = getAnthropicModelCapabilities(model);
  const tuning: AnthropicRequestTuning = {};

  if (capabilities.adaptiveThinking) {
    // "summarized" so the Coach transcript can show reasoning; the default
    // omits it and reads as a long pause before the answer appears.
    tuning.thinking = { type: "adaptive", display: "summarized" };
  }
  if (capabilities.effort) {
    tuning.output_config = { effort: config.effort };
  }
  if (capabilities.refusalFallback) {
    tuning.betas = [REFUSAL_FALLBACK_BETA];
    tuning.fallbacks = [{ model: REFUSAL_FALLBACK_MODEL }];
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

export interface StreamAnthropicChatOptions {
  config: AnthropicRuntimeConfig;
  instructions: string;
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
): Promise<{ fullText: string; usage?: ChatTokenUsage }> {
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
          max_tokens: getAnthropicModelCapabilities(model).maxOutputTokens,
          system: options.instructions,
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

    return { fullText, ...(counted ? { usage } : {}) };
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
