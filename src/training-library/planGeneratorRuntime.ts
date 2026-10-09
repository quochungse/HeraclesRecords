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
  effortForModel,
  providerModelOptions,
  settingsModel,
  supportsReasoningEffort,
  type ChatModelOption
} from "../../electron/chatModels";

import { t } from "../i18n/core";
/** The order the provider list reads in: the two Claude paths first. */
export const GENERATOR_PROVIDERS: readonly ChatProvider[] = ["claude-code", "claude-api", "chatgpt", "openrouter", "local"];

export interface GeneratorRuntime {
  provider: ChatProvider;
  /** `""` is the provider's own default ("Default model", "Auto"). */
  model: string;
  effort: AnthropicEffort;
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
export function requestRuntime(
  runtime: GeneratorRuntime,
  settings: ChatSettings,
  /**
   * The provider an absent one means. Coach's for a run; a conversation's own
   * for a conversation (Coach Workbench review, Q1), since a conversation keeps
   * the provider it was started with.
   */
  baseProvider: ChatSettings["provider"] = settings.provider
): AnalysisRuntime | undefined {
  const coach = runtimeFromSettings(settings, runtime.provider);
  const override: AnalysisRuntime = {};
  if (runtime.provider !== baseProvider) override.provider = runtime.provider;
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

/** The models a provider offers: its own list where it has been read, the shipped one where not. */
export function runtimeModelOptions(
  provider: ChatProvider,
  settings: ChatSettings,
  claudeStatus: ClaudeCodeStatus | null
): ChatModelOption[] {
  return providerModelOptions(provider, settings, claudeStatus);
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
    ? runtime.model.trim() || t("library.runtime.noModel")
    : listed
      ? modelChipLabel(listed.label)
      : describeChatModel(runtime.model) || t("library.runtime.defaultModel");
  if (!supportsReasoningEffort(runtime.provider)) return model;
  // The level a request will carry, which is not always the one chosen: a
  // model that stops at High answers a "Max" conversation at High.
  const level = effortForModel(runtime.effort, listed?.efforts);
  if (!level) return model;
  const effort = REASONING_EFFORT_OPTIONS.find((option) => option.value === level)?.label ?? level;
  return t("library.runtime.effort", { model, effort });
}
