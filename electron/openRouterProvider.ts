import type {
  ChatTokenUsage,
  OpenRouterConfig,
  OpenRouterConnectionTest,
  OpenRouterModelOption
} from "./types";
import {
  streamOpenAiCompatibleChatCompletion,
  type StreamOpenAiCompatibleChatOptions
} from "./localChatProvider";
import { ScreenError } from "./screenText";
import { mainPlural, mainText } from "./mainText";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";
export const OPENROUTER_MODELS_URL =
  "https://openrouter.ai/models?supported_parameters=tools";
export const DEFAULT_OPENROUTER_MODEL = "openrouter/auto";
export const OPENROUTER_ROUTER_MODELS: OpenRouterModelOption[] = [
  { id: DEFAULT_OPENROUTER_MODEL, name: "Auto Router" },
  { id: "openrouter/free", name: "Free Router" }
];

interface OpenRouterModelPayload {
  id?: unknown;
  name?: unknown;
  supported_parameters?: unknown;
}

interface OpenRouterKeyPayload {
  label?: unknown;
}

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Title": "Heracles Records"
  };
}

async function responseError(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => "");
  if (!bodyText) return response.statusText;
  try {
    const payload = JSON.parse(bodyText) as {
      error?: string | { message?: unknown };
      message?: unknown;
    };
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.error?.message === "string") {
      return payload.error.message;
    }
    if (typeof payload.message === "string") return payload.message;
  } catch {
    // Preserve a short non-JSON response below.
  }
  return bodyText.length > 400 ? `${bodyText.slice(0, 400)}...` : bodyText;
}

export async function listOpenRouterModelsRequest(
  apiKey: string,
  signal?: AbortSignal
): Promise<OpenRouterModelOption[]> {
  const url = new URL(`${OPENROUTER_API_BASE_URL}/models/user`);
  url.searchParams.set("supported_parameters", "tools");
  url.searchParams.set("sort", "most-popular");
  const response = await fetch(url, {
    method: "GET",
    signal: signal ?? AbortSignal.timeout(15_000),
    headers: openRouterHeaders(apiKey)
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter model lookup failed (${response.status}). ${await responseError(response)}`
    );
  }

  const payload = (await response.json()) as { data?: OpenRouterModelPayload[] };
  if (!Array.isArray(payload.data)) {
    throw new ScreenError("main.ai.openRouterList");
  }
  const listedModels = payload.data.flatMap((entry): OpenRouterModelOption[] => {
    if (typeof entry.id !== "string" || !entry.id.trim()) return [];
    const supported = Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters
      : [];
    if (!supported.includes("tools")) return [];
    return [
      {
        id: entry.id,
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name
            : entry.id
      }
    ];
  });
  const routerIds = new Set(OPENROUTER_ROUTER_MODELS.map((model) => model.id));
  return [
    ...OPENROUTER_ROUTER_MODELS,
    ...listedModels.filter((model) => !routerIds.has(model.id))
  ];
}

export async function testOpenRouterConnectionRequest(
  config: OpenRouterConfig,
  signal?: AbortSignal
): Promise<OpenRouterConnectionTest> {
  const apiKey = config.apiKey?.trim();
  const model = config.model.trim();
  if (!apiKey) {
    return {
      ok: false,
      message: mainText("main.ai.openRouterKey"),
      models: []
    };
  }
  if (!model) {
    return {
      ok: false,
      message: mainText("main.ai.openRouterModel"),
      models: []
    };
  }

  try {
    const keyResponse = await fetch(`${OPENROUTER_API_BASE_URL}/key`, {
      method: "GET",
      signal: signal ?? AbortSignal.timeout(15_000),
      headers: openRouterHeaders(apiKey)
    });
    if (!keyResponse.ok) {
      return {
        ok: false,
        message:
          keyResponse.status === 401
            ? "OpenRouter rejected this API key."
            : `OpenRouter key check failed (${keyResponse.status}). ${await responseError(keyResponse)}`,
        models: []
      };
    }
    const keyPayload = (await keyResponse.json()) as {
      data?: OpenRouterKeyPayload;
    };
    const models = await listOpenRouterModelsRequest(apiKey, signal);
    if (!models.some((entry) => entry.id === model)) {
      return {
        ok: false,
        message: mainText("main.ai.openRouterNoTools", { model }),
        models,
        keyLabel:
          typeof keyPayload.data?.label === "string"
            ? keyPayload.data.label
            : undefined
      };
    }
    return {
      ok: true,
      message: mainPlural("main.ai.openRouterConnected", models.length, { model }),
      models,
      keyLabel:
        typeof keyPayload.data?.label === "string"
          ? keyPayload.data.label
          : undefined
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "OpenRouter connection check failed.",
      models: []
    };
  }
}

export interface StreamOpenRouterChatOptions
  extends Omit<
    StreamOpenAiCompatibleChatOptions,
    "model" | "toolsEnabled" | "onToolsDisabled"
  > {
  config: Pick<OpenRouterConfig, "model"> & { apiKey: string };
  /** Offer OpenRouter's web search server tool; the model decides when to search. */
  webSearch?: boolean;
}

/**
 * OpenRouter's own search, run on its side within the request and billed per
 * search on the account's credit. Bounded, because the model decides how often.
 */
export const OPENROUTER_WEB_SEARCH_TOOL: Record<string, unknown> = {
  type: "openrouter:web_search",
  parameters: { max_results: 5, max_uses: 3 }
};

export function streamOpenRouterChatCompletion(
  options: StreamOpenRouterChatOptions
): Promise<{ fullText: string; usage?: ChatTokenUsage; model: string }> {
  return streamOpenAiCompatibleChatCompletion(
    {
      instructions: options.instructions,
      fallbackInstructions: options.fallbackInstructions,
      messages: options.messages,
      tools: options.tools,
      maxToolRounds: options.maxToolRounds,
      signal: options.signal,
      onToken: options.onToken,
      onToolsDisabled: () => undefined,
      onToolCall: options.onToolCall,
      onToolCallStart: options.onToolCallStart,
      onToolCallError: options.onToolCallError,
      model: options.config.model,
      toolsEnabled: true,
      ...(options.webSearch ? { serverTools: [OPENROUTER_WEB_SEARCH_TOOL] } : {}),
      ...(options.onServerToolUse ? { onServerToolUse: options.onServerToolUse } : {})
    },
    {
      baseUrl: OPENROUTER_API_BASE_URL,
      apiKey: options.config.apiKey,
      requestLabel: "OpenRouter",
      headers: { "X-Title": "Heracles Records" },
      allowToolsFallback: false
    }
  );
}
