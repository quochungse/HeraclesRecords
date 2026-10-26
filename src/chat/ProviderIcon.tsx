import { Bot, KeyRound, Network, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";

const PROVIDER_ICONS = {
  chatgpt: Sparkles,
  "claude-code": Terminal,
  "claude-api": KeyRound,
  openrouter: Network,
  local: Bot
};

/** The same provider marks in pickers and connection summaries. */
export function ProviderIcon({ provider }: { provider: ChatProvider }) {
  const Icon = PROVIDER_ICONS[provider];
  return <Icon size={14} strokeWidth={2.1} aria-hidden="true" />;
}
