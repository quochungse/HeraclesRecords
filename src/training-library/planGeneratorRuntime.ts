/**
 * Which AI writes a generated plan, and how hard it thinks.
 *
 * The generator runs with Coach's provider unless the athlete picks another
 * for this plan, which travels as the request's `runtime` — the override an
 * analysis already uses, so `streamChat` needs nothing new. Picking one here
 * changes nothing in Coach unless the athlete asks for that too
 * ("Keep this for Coach chat too"), and then it is written the way Coach's own
 * pickers write it (`settingsWithRuntime`).
 *
 * Pure, and outside the component, for the reason `planEditorModel.ts` is:
 * it is the part a test can reach.
 */
import type {
  AnalysisRuntime,
  AnthropicEffort,
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus
} from "../../electron/types";
import {
  REASONING_EFFORT_OPTIONS,
  describeChatModel,
  getModelPickerOptions,
  supportsReasoningEffort,
  type ChatModelOption
} from "../../electron/chatModels";

/** The order the provider list reads in: the two Claude paths first. */
export const GENERATOR_PROVIDERS: readonly ChatProvider[] = ["claude-code", "claude-api", "chatgpt", "openrouter", "local"];

export interface GeneratorRuntime {
  provider: ChatProvider;
  /** `""` is the provider's own default ("Default model", "Auto"). */
  model: string;
  effort: AnthropicEffort;
}

/** The model Coach has chosen for a provider, as its picker holds it. */
export function settingsModel(settings: ChatSettings, provider: ChatProvider): string {
  switch (provider) {
    case "claude-api":
      return settings.anthropic.model;
    case "claude-code":
      return settings.claudeCode.model ?? "";
    case "openrouter":
      return settings.openRouter.model;
    case "chatgpt":
      return settings.chatgpt.model ?? "";
    case "local":
      return settings.local.model;
  }
}

export function settingsEffort(settings: ChatSettings, provider: ChatProvider): AnthropicEffort {
  return provider === "claude-api" ? settings.anthropic.effort : settings.claudeCode.effort;
}

/** What Coach would run with, for a provider — the panel's starting point. */
export function runtimeFromSettings(settings: ChatSettings, provider: ChatProvider = settings.provider): GeneratorRuntime {
  return { provider, model: settingsModel(settings, provider), effort: settingsEffort(settings, provider) };
}

/**
 * What goes on the request: only what differs from Coach's settings, so an
 * untouched panel sends nothing and the run is exactly Coach's. A model is
 * sent only when it names one — `streamChat` reads `""` as a model id on the
 * Messages API — and an effort only where the provider takes one.
 */
export function requestRuntime(runtime: GeneratorRuntime, settings: ChatSettings): AnalysisRuntime | undefined {
  const coach = runtimeFromSettings(settings, runtime.provider);
  const override: AnalysisRuntime = {};
  if (runtime.provider !== settings.provider) override.provider = runtime.provider;
  if (runtime.provider !== "local" && runtime.model.trim() && runtime.model !== coach.model) override.model = runtime.model.trim();
  if (supportsReasoningEffort(runtime.provider) && runtime.effort !== coach.effort) override.effort = runtime.effort;
  return Object.keys(override).length ? override : undefined;
}

/** Coach's settings with this runtime made Coach's own, as Coach's pickers write it. */
export function settingsWithRuntime(settings: ChatSettings, runtime: GeneratorRuntime): ChatSettings {
  const model = runtime.model.trim();
  const next: ChatSettings = { ...settings, provider: runtime.provider };
  switch (runtime.provider) {
    case "claude-api":
      next.anthropic = { ...settings.anthropic, model: model || settings.anthropic.model, effort: runtime.effort };
      break;
    case "claude-code":
      next.claudeCode = { ...settings.claudeCode, model: model || undefined, effort: runtime.effort };
      break;
    case "openrouter":
      next.openRouter = { ...settings.openRouter, model: model || "openrouter/auto" };
      break;
    case "chatgpt":
      next.chatgpt = { ...settings.chatgpt, model: model || undefined };
      break;
    case "local":
      break;
  }
  return next;
}

/** The models a provider offers, the account's own list first where Claude Code reported one. */
export function runtimeModelOptions(
  provider: ChatProvider,
  settings: ChatSettings,
  claudeStatus: ClaudeCodeStatus | null
): ChatModelOption[] {
  if (provider === "local") return [];
  if (provider === "claude-code") {
    const listed = claudeStatus?.availableModels ?? settings.claudeCode.availableModels;
    if (listed?.length) return listed;
    return getModelPickerOptions(provider, claudeStatus?.defaultModel ?? settings.claudeCode.defaultModel);
  }
  return getModelPickerOptions(provider);
}

/**
 * A model's name for a chip: the menu's qualifier dropped ("Opus (most
 * capable)" is a menu row), except where it is the point — "Default (Opus 5)"
 * says which model the default is.
 */
export function modelChipLabel(label: string): string {
  return label.startsWith("Default (") ? label : label.replace(/\s*\([^)]*\)$/, "");
}

/**
 * The runtime as one line for the provider card: "Opus · High effort". A
 * model nobody picked reads as its picker's label ("Default model", "Auto").
 */
export function runtimeSummary(runtime: GeneratorRuntime, options: readonly ChatModelOption[]): string {
  const listed = options.find((option) => option.value === runtime.model);
  const model = runtime.provider === "local"
    ? runtime.model || "Local model"
    : listed
      ? modelChipLabel(listed.label)
      : describeChatModel(runtime.model) || "Default model";
  if (!supportsReasoningEffort(runtime.provider)) return model;
  const effort = REASONING_EFFORT_OPTIONS.find((option) => option.value === runtime.effort)?.label ?? runtime.effort;
  return `${model} · ${effort} effort`;
}
