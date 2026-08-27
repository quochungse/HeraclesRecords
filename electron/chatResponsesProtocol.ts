import type { ChatTokenUsage } from "./types";

/** Build the ChatGPT Responses request with safe reasoning summaries enabled. */
export function buildResponsesRequest(
  model: string,
  instructions: string,
  input: Record<string, unknown>[],
  tools: Record<string, unknown>[],
  includeReasoningSummary = true
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model,
    instructions,
    input,
    stream: true,
    store: false
  };
  if (includeReasoningSummary) {
    request.reasoning = { summary: "auto" };
  }
  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = "auto";
  }
  return request;
}

/** Pull incremental assistant output text from a Responses SSE event. */
export function extractResponseTextDelta(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const evt = event as { type?: string; delta?: unknown };
  return evt.type === "response.output_text.delta" &&
    typeof evt.delta === "string"
    ? evt.delta
    : "";
}

/** Pull a display-safe reasoning summary delta (never raw chain-of-thought). */
export function extractReasoningSummaryDelta(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const evt = event as { type?: string; delta?: unknown };
  return evt.type === "response.reasoning_summary_text.delta" &&
    typeof evt.delta === "string"
    ? evt.delta
    : "";
}

/**
 * Pull the token counts off a completed Responses event.
 *
 * `response.completed` carries the usage for that round only, so a tool-using
 * answer reports once per round and the caller sums them. Anything else — an
 * incomplete or failed response — reports nothing rather than zero, because a
 * round nobody counted is not a round that was free.
 */
export function extractResponseUsage(event: unknown): ChatTokenUsage | undefined {
  if (!event || typeof event !== "object") return undefined;
  const evt = event as { type?: string; response?: { usage?: Record<string, unknown> } };
  if (evt.type !== "response.completed") return undefined;
  const reported = evt.response?.usage;
  if (!reported) return undefined;
  const count = (key: string): number => {
    const value = reported[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const inputTokens = count("input_tokens");
  const outputTokens = count("output_tokens");
  return inputTokens || outputTokens ? { inputTokens, outputTokens } : undefined;
}
