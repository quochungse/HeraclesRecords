import { Bot, KeyRound, Network, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import { SelectDropdown } from "../components/SelectDropdown";
import { t } from "../i18n/core";
import { COACH_PROVIDER_LABELS } from "./CoachModelsPanel";

const PROVIDERS: ChatProvider[] = ["chatgpt", "claude-code", "claude-api", "openrouter", "local"];

function providerOptions(): Array<{ value: ChatProvider; label: string }> {
  return PROVIDERS.map((value) => ({ value, label: COACH_PROVIDER_LABELS[value] }));
}

function getProviderTone(provider: ChatProvider) {
  if (provider === "claude-code" || provider === "claude-api") return "claude";
  if (provider === "openrouter") return "openrouter";
  if (provider === "local") return "local";
  return "gpt";
}

function renderProviderIcon(provider: ChatProvider) {
  if (provider === "claude-code") {
    return <Terminal size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "claude-api") {
    return <KeyRound size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "local") {
    return <Bot size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "openrouter") {
    return <Network size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  return <Sparkles size={14} strokeWidth={2.1} aria-hidden="true" />;
}

export function ProviderSwitch({
  provider,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  disabled?: boolean;
  onChange: (provider: ChatProvider) => void;
}) {
  const options = providerOptions();
  const selectedLabel =
    options.find((option) => option.value === provider)?.label ?? provider;
  const tone = getProviderTone(provider);

  return (
    <SelectDropdown
      className={`app-select--pill chat-provider-select chat-select--${tone}`}
      menuClassName={`chat-select-menu chat-provider-menu chat-select-menu--${tone}`}
      value={provider}
      options={options}
      onChange={onChange}
      renderIcon={renderProviderIcon}
      label={t("chat.picker.provider")}
      title={t("chat.picker.providerTitle", { label: selectedLabel })}
      disabled={disabled}
      portal
    />
  );
}
