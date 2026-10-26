import type { ChatAuthStatus, ChatProvider, ChatSettings, ClaudeCodeStatus } from "../../electron/types";
import { messageRecord } from "../i18n/core";

/** Section order in the panel, which is also the skeleton's row count. */
export const COACH_PROVIDER_ORDER: readonly ChatProvider[] = [
  "chatgpt",
  "claude-code",
  "claude-api",
  "openrouter",
  "local"
];

/** Each provider's name: two brands, and three that say what they are. */
export const COACH_PROVIDER_LABELS: Readonly<Record<ChatProvider, string>> = messageRecord<ChatProvider>({
  chatgpt: "chat.provider.chatgpt",
  "claude-code": "chat.provider.claude-code",
  "claude-api": "chat.provider.claude-api",
  openrouter: "chat.provider.openrouter",
  local: "chat.provider.local"
});

export interface CoachModelsSummary {
  /** Connected providers, in the same order as the provider panel. */
  connectedProviders: ChatProvider[];
  connected: number;
}

export interface ClaudeCodeUpdate {
  installed: string;
  latest: string;
}

/**
 * A newer Claude Code to tell the athlete about — only while `provider` (Coach's,
 * or a conversation's) is Claude Code, since nothing else runs the CLI.
 */
export function claudeCodeUpdateFor(
  provider: ChatProvider,
  claudeStatus: ClaudeCodeStatus | null
): ClaudeCodeUpdate | undefined {
  if (provider !== "claude-code") return undefined;
  const installed = claudeStatus?.version?.match(/\d+\.\d+\.\d+/)?.[0];
  const latest = claudeStatus?.newerVersion;
  return installed && latest ? { installed, latest } : undefined;
}

/**
 * Whether each provider is usable, by the rule `summarizeCoachModels` states
 * below. A status not read yet (`null`) counts as not ready.
 */
export function coachProviderReadiness(
  chatSettings: ChatSettings,
  authStatus: ChatAuthStatus | null,
  claudeStatus: ClaudeCodeStatus | null
): Record<ChatProvider, boolean> {
  return {
    chatgpt: authStatus?.signedIn === true,
    "claude-code": claudeStatus?.state === "connected",
    "claude-api": chatSettings.anthropic.hasApiKey === true,
    openrouter: chatSettings.openRouter.hasApiKey === true,
    local: chatSettings.local.model.trim().length > 0
  };
}

/**
 * Which providers are actually usable, for the Connections row that opens this
 * panel. "Connected" means the credential each provider needs is in place — a
 * signed-in account, a stored key, or a chosen local model — not that a request
 * has been made with it.
 */
export function summarizeCoachModels(
  chatSettings: ChatSettings,
  authStatus: ChatAuthStatus | null,
  claudeStatus: ClaudeCodeStatus | null
): CoachModelsSummary {
  const ready = coachProviderReadiness(chatSettings, authStatus, claudeStatus);
  const connectedProviders = COACH_PROVIDER_ORDER.filter((provider) => ready[provider]);

  return {
    connectedProviders,
    connected: connectedProviders.length
  };
}

