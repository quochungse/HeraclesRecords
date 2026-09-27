import { KeyRound, Network, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import {
  withCurrentModel,
  type ChatModelOption
} from "../../electron/chatModels";
import { SelectDropdown } from "../components/SelectDropdown";
import { useModelOptions } from "./modelOptionsContext";

function renderChatGptIcon() {
  return <Sparkles size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderClaudeIcon() {
  return <Terminal size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderOpenRouterIcon() {
  return <Network size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderClaudeApiIcon() {
  return <KeyRound size={14} strokeWidth={2.1} aria-hidden="true" />;
}

export function ModelSwitch({
  provider,
  model,
  options: listed,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  model: string;
  /** The provider's models; read from `ModelOptionsContext` when not given. */
  options?: ChatModelOption[];
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  // The provider's own list where it has been read, with the chosen model kept
  // in it even once the provider stops listing it.
  const modelOptions = useModelOptions();
  if (provider === "local") {
    return null;
  }

  const options: ChatModelOption[] = withCurrentModel(listed ?? modelOptions(provider), model);
  const isClaude = provider === "claude-code" || provider === "claude-api";
  const providerLabel = isClaude
    ? "Claude"
    : provider === "openrouter"
      ? "OpenRouter"
      : "ChatGPT";
  const tone = isClaude
    ? "claude"
    : provider === "openrouter"
      ? "openrouter"
      : "gpt";
  const renderIcon =
    provider === "claude-api"
      ? renderClaudeApiIcon
      : provider === "claude-code"
        ? renderClaudeIcon
        : provider === "openrouter"
          ? renderOpenRouterIcon
          : renderChatGptIcon;
  const selectedLabel =
    options.find((option) => option.value === model)?.label ?? model;
  // Qualifiers push the longest rows past 400px; without the wider menu they
  // wrap over three or four lines.
  const hasDetails = options.some((option) => option.detail);

  return (
    <SelectDropdown
      className={`app-select--pill chat-model-select chat-select--${tone}`}
      menuClassName={`chat-select-menu chat-select-menu--${tone}`}
      value={model}
      options={options}
      onChange={onChange}
      renderIcon={renderIcon}
      label={`${providerLabel} model`}
      title={`${providerLabel} model: ${selectedLabel}`}
      disabled={disabled}
      minMenuWidth={hasDetails ? 420 : undefined}
      portal
    />
  );
}
