import { Gauge } from "lucide-react";
import type { AnthropicEffort, ChatProvider } from "../../electron/types";
import {
  REASONING_EFFORT_OPTIONS,
  supportsReasoningEffort
} from "../../electron/chatModels";
import { SelectDropdown } from "../components/SelectDropdown";

function renderEffortIcon() {
  return <Gauge size={14} strokeWidth={2.1} aria-hidden="true" />;
}

/** Reasoning effort picker, shown beside the model for the Claude backends. */
export function EffortSwitch({
  provider,
  effort,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  effort: AnthropicEffort;
  disabled?: boolean;
  onChange: (effort: AnthropicEffort) => void;
}) {
  if (!supportsReasoningEffort(provider)) {
    return null;
  }

  const selectedLabel =
    REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ??
    effort;

  return (
    <SelectDropdown
      className="app-select--pill chat-model-select chat-effort-select chat-select--claude"
      menuClassName="chat-select-menu chat-select-menu--claude"
      value={effort}
      options={REASONING_EFFORT_OPTIONS}
      onChange={onChange}
      renderIcon={renderEffortIcon}
      label="Reasoning effort"
      title={`Reasoning effort: ${selectedLabel}`}
      disabled={disabled}
      portal
    />
  );
}
