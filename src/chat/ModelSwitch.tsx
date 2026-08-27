import { KeyRound, Network, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import {
  getModelPickerOptions,
  type ChatModelOption
} from "../../electron/chatModels";
import { SelectDropdown } from "../components/SelectDropdown";

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
  defaultModel,
  availableModels,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  model: string;
  /** Model id Claude Code reported using when asked for none, if known. */
  defaultModel?: string;
  /** Account model list from the CLI; preferred over the static fallback. */
  availableModels?: ChatModelOption[];
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  if (provider === "local") {
    return null;
  }

  // The CLI list already carries versions and its own "Default (…)" label, so
  // it needs no relabelling; the static fallback does.
  const baseOptions = availableModels?.length
    ? availableModels
    : getModelPickerOptions(provider, defaultModel);
  const options: ChatModelOption[] = baseOptions.some(
    (option) => option.value === model
  )
    ? baseOptions
    : [...baseOptions, { value: model, label: model }];
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
