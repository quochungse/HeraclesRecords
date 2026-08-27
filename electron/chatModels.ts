import type { AnthropicEffort } from "./types";

export interface ChatModelOption {
  value: string;
  label: string;
  /** Qualifier shown only in an open menu, never on the closed pill. */
  detail?: string;
}

export interface ChatEffortOption {
  value: AnthropicEffort;
  /** Short form, for the compact picker beside the model. */
  label: string;
  /** Extra wording for the roomier Settings selects. */
  detail?: string;
}

/** Shared by both Claude paths: the Messages API and the Agent SDK take the same levels. */
export const REASONING_EFFORT_OPTIONS: ChatEffortOption[] = [
  { value: "low", label: "Low", detail: "fastest and cheapest" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High", detail: "default" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max", detail: "most thorough" }
];

/** Menu form of a model row: the pill uses `label` alone. */
export function formatModelOptionLabel(option: ChatModelOption): string {
  return option.detail ? `${option.label} (${option.detail})` : option.label;
}

export function formatEffortOption(option: ChatEffortOption): string {
  return option.detail ? `${option.label} — ${option.detail}` : option.label;
}

/** Effort only reaches the two Claude backends; the others ignore it. */
export function supportsReasoningEffort(provider: string): boolean {
  return provider === "claude-code" || provider === "claude-api";
}

export const CHATGPT_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "", label: "Auto" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" }
];

/** Default Messages API model for the direct Claude (API key) provider. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export const ANTHROPIC_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "claude-opus-5", label: "Claude Opus 5" },
  { value: "claude-fable-5", label: "Claude Fable 5 (most capable)" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" }
];

export const CLAUDE_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "", label: "Default model" },
  { value: "opus", label: "Opus (most capable)" },
  { value: "sonnet", label: "Sonnet (balanced)" },
  { value: "haiku", label: "Haiku (fastest)" }
];

export const OPENROUTER_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "openrouter/auto", label: "Auto Router" },
  { value: "openrouter/free", label: "Free Router" }
];

const CHATGPT_AUTO_MODEL_IDS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5-codex"
];

export function getChatGptModelCandidates(
  selectedModel?: string,
  cachedModel?: string
): string[] {
  const selected = selectedModel?.trim();
  if (selected) {
    return [selected];
  }

  const cached = cachedModel?.trim();
  return cached
    ? [cached, ...CHATGPT_AUTO_MODEL_IDS.filter((model) => model !== cached)]
    : [...CHATGPT_AUTO_MODEL_IDS];
}

const MODEL_FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;

/**
 * Turns a Claude model id into something worth showing a person:
 * `claude-sonnet-4-6-20250219` becomes `Sonnet 4.6`. Ids that do not match the
 * family-and-version shape are returned untouched rather than mangled.
 */
export function formatClaudeModelName(modelId: string): string {
  const id = modelId.trim();
  const match = new RegExp(
    `^claude-(${MODEL_FAMILIES.join("|")})-(\\d+)(?:-(\\d+))?`
  ).exec(id);
  if (!match) return id;
  const [, family, major, minor] = match;
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`;
}

/**
 * Names the "let Claude Code decide" entry once the CLI has reported which
 * model that is. Other entries are returned untouched.
 */
export function withNamedDefaultModel(
  options: ChatModelOption[],
  defaultModel?: string
): ChatModelOption[] {
  const named = defaultModel?.trim()
    ? formatClaudeModelName(defaultModel)
    : undefined;
  if (!named) return options;
  return options.map((option) =>
    option.value === "" ? { ...option, label: `Default (${named})` } : option
  );
}

export function getChatModelOptions(provider: string): ChatModelOption[] {
  if (provider === "claude-code") return CLAUDE_MODEL_OPTIONS;
  if (provider === "openrouter") return OPENROUTER_MODEL_OPTIONS;
  if (provider === "claude-api") return ANTHROPIC_MODEL_OPTIONS;
  return CHATGPT_MODEL_OPTIONS;
}

/**
 * Options for a provider's model picker. `defaultModel` is the id Claude Code
 * reported for its "Default model" entry, so it only ever names that entry —
 * every other provider's empty-value option means something else of its own
 * (ChatGPT's "Auto") and must keep its label.
 */
export function getModelPickerOptions(
  provider: string,
  defaultModel?: string
): ChatModelOption[] {
  const options = getChatModelOptions(provider);
  return provider === "claude-code"
    ? withNamedDefaultModel(options, defaultModel)
    : options;
}
