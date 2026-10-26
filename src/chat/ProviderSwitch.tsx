import type { ChatProvider } from "../../electron/types";
import { SelectDropdown } from "../components/SelectDropdown";
import { t } from "../i18n/core";
import { COACH_PROVIDER_LABELS, COACH_PROVIDER_ORDER } from "./coachProviders";
import { ProviderIcon } from "./ProviderIcon";

function providerOptions(): Array<{ value: ChatProvider; label: string }> {
  return COACH_PROVIDER_ORDER.map((value) => ({ value, label: COACH_PROVIDER_LABELS[value] }));
}

function getProviderTone(provider: ChatProvider) {
  if (provider === "claude-code" || provider === "claude-api") return "claude";
  if (provider === "openrouter") return "openrouter";
  if (provider === "local") return "local";
  return "gpt";
}

function renderProviderIcon(provider: ChatProvider) {
  return <ProviderIcon provider={provider} />;
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
