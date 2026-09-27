import { Gauge } from "lucide-react";
import type { AnthropicEffort, ChatProvider } from "../../electron/types";
import {
  effortForModel,
  effortOptionsFor,
  supportsReasoningEffort,
  type ChatModelOption
} from "../../electron/chatModels";
import { SelectDropdown } from "../components/SelectDropdown";
import { useModelOptions } from "./modelOptionsContext";

function renderEffortIcon() {
  return <Gauge size={14} strokeWidth={2.1} aria-hidden="true" />;
}

/**
 * Reasoning effort picker, shown beside the model for the Claude backends.
 * With a `model`, it offers only the levels that model takes, shows the level
 * a request will actually carry, and steps aside for a model that takes none.
 */
export function EffortSwitch({
  provider,
  model,
  modelOptions: listedOptions,
  effort,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  /** The model the effort is for; `""` is the provider's default. */
  model?: string;
  /** The provider's models; read from `ModelOptionsContext` when not given. */
  modelOptions?: ChatModelOption[];
  effort: AnthropicEffort;
  disabled?: boolean;
  onChange: (effort: AnthropicEffort) => void;
}) {
  const modelOptions = useModelOptions();
  if (!supportsReasoningEffort(provider)) {
    return null;
  }

  const listed = model === undefined
    ? undefined
    : (listedOptions ?? modelOptions(provider)).find((option) => option.value === model);
  const options = effortOptionsFor(listed);
  const shown = effortForModel(effort, listed?.efforts);
  if (!shown || options.length === 0) {
    return null;
  }
  const selectedLabel =
    options.find((option) => option.value === shown)?.label ?? shown;

  return (
    <SelectDropdown
      className="app-select--pill chat-model-select chat-effort-select chat-select--claude"
      menuClassName="chat-select-menu chat-select-menu--claude"
      value={shown}
      options={options}
      onChange={onChange}
      renderIcon={renderEffortIcon}
      label="Reasoning effort"
      title={`Reasoning effort: ${selectedLabel}`}
      disabled={disabled}
      portal
    />
  );
}
