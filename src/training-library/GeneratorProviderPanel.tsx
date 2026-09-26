import { AlertTriangle, ArrowRight, Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatProvider, ChatSettings, ClaudeCodeStatus } from "../../electron/types";
import { REASONING_EFFORT_OPTIONS, supportsReasoningEffort } from "../../electron/chatModels";
import { OptionGroup } from "../components/OptionGroup";
import { COACH_PROVIDER_LABELS } from "../chat/CoachModelsPanel";
import {
  GENERATOR_PROVIDERS,
  modelChipLabel,
  runtimeFromSettings,
  runtimeModelOptions,
  type GeneratorRuntime
} from "./planGeneratorRuntime";

/** Where to fix a provider that is not ready, per provider. */
export const PROVIDER_FIX: Record<ChatProvider, string> = {
  chatgpt: "Sign in to ChatGPT in Coach settings.",
  "claude-code": "Connect your Claude subscription in Coach settings.",
  "claude-api": "Add an Anthropic API key in Coach settings.",
  openrouter: "Add an OpenRouter API key in Coach settings.",
  local: "Choose a local model in Coach settings."
};

interface GeneratorProviderPanelProps {
  settings: ChatSettings;
  /** `undefined` while a provider's status is still being read. */
  readiness: Partial<Record<ChatProvider, boolean>>;
  claudeStatus: ClaudeCodeStatus | null;
  runtime: GeneratorRuntime;
  /** Keep the choice for Coach too; the question is not asked without it. */
  keepForChat?: boolean;
  onChange: (runtime: GeneratorRuntime) => void;
  onKeepForChatChange?: (keep: boolean) => void;
  /** What the AI is chosen for: a generated plan, or one conversation (P2.0). */
  subject?: "plan" | "conversation";
  onDone: () => void;
  onOpenCoach: () => void;
}

/**
 * "AI for this plan": the provider, model and effort one generation runs
 * with. It sits over the generator rather than beside it, because the choice
 * is made once and then not again, and it closes on Done, the X, a press on
 * the scrim or Escape (the generator's own Escape steps back through it).
 */
export function GeneratorProviderPanel({
  settings,
  readiness,
  claudeStatus,
  runtime,
  keepForChat,
  onChange,
  onKeepForChatChange,
  onDone,
  onOpenCoach,
  subject = "plan"
}: GeneratorProviderPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
  }, []);

  const ready = readiness[runtime.provider];
  const models = runtimeModelOptions(runtime.provider, settings, claudeStatus);
  const pickProvider = (provider: ChatProvider) => {
    if (provider === runtime.provider) return;
    onChange(runtimeFromSettings(settings, provider));
  };

  return (
    <div className="plan-generator-sheet-layer">
      <button type="button" className="plan-generator-scrim" aria-label="Close AI settings" tabIndex={-1} onClick={onDone} />
      <div
        ref={panelRef}
        className="plan-generator-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-generator-ai-title"
      >
        <header>
          <div>
            <h3 id="plan-generator-ai-title">AI for this {subject}</h3>
            <p>
              {subject === "plan"
                ? "Which provider writes it, and how hard it thinks. Coach’s own settings stay as they are unless you keep this for Coach too."
                : "Which provider answers here, and how hard it thinks. Coach’s own settings stay as they are for every other conversation."}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close AI settings" onClick={onDone}><X size={16} /></button>
        </header>

        <div className="plan-generator-sheet-body">
          <p className="tl-eyebrow">Provider</p>
          <div className="plan-generator-provider-list">
            {GENERATOR_PROVIDERS.map((provider) => {
              const state = readiness[provider];
              const selected = provider === runtime.provider;
              return (
                <button
                  type="button"
                  key={provider}
                  className={`plan-generator-provider-option${selected ? " is-selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => pickProvider(provider)}
                >
                  <span className="plan-generator-provider-option-name">
                    {COACH_PROVIDER_LABELS[provider]}
                    {provider === settings.provider ? <small>Coach&rsquo;s</small> : null}
                  </span>
                  <span className={`plan-generator-provider-tag${state === true ? " is-ready" : state === false ? " is-blocked" : ""}`}>
                    {state === undefined ? <LoaderCircle className="is-spinning" size={11} aria-hidden="true" /> : state ? <Check size={11} aria-hidden="true" /> : null}
                    {state === undefined ? "Checking" : state ? "Connected" : "Not set up"}
                  </span>
                </button>
              );
            })}
          </div>

          {ready === false ? (
            <div className="plan-generator-sheet-warning" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <p>
                {runtime.provider === "claude-code" && claudeStatus?.message ? claudeStatus.message : PROVIDER_FIX[runtime.provider]}
              </p>
              <button type="button" className="ghost-button" onClick={onOpenCoach}>Coach settings <ArrowRight size={13} /></button>
            </div>
          ) : null}

          <p className="tl-eyebrow">Model</p>
          {runtime.provider === "local" ? (
            <p className="plan-generator-sheet-note">
              {settings.local.model.trim()
                ? `Runs ${settings.local.model.trim()}, the local model chosen in Coach settings.`
                : "Choose a local model in Coach settings."}
            </p>
          ) : (
            <OptionGroup
              label="Model"
              className="plan-generator-sheet-models"
              value={models.some((option) => option.value === runtime.model) ? runtime.model : (models[0]?.value ?? "")}
              options={models.map((option) => ({ value: option.value, label: modelChipLabel(option.label), title: option.label }))}
              onChange={(model) => onChange({ ...runtime, model })}
            />
          )}

          <p className="tl-eyebrow">Reasoning effort</p>
          {supportsReasoningEffort(runtime.provider) ? (
            <OptionGroup
              label="Reasoning effort"
              value={runtime.effort}
              options={REASONING_EFFORT_OPTIONS.map((option) => ({ value: option.value, label: option.label, title: option.detail }))}
              onChange={(effort) => onChange({ ...runtime, effort })}
            />
          ) : (
            <p className="plan-generator-sheet-note">{COACH_PROVIDER_LABELS[runtime.provider]} has no effort setting.</p>
          )}
        </div>

        <footer>
          {onKeepForChatChange ? (
            <label className="plan-generator-sheet-keep">
              <input type="checkbox" checked={keepForChat === true} onChange={(event) => onKeepForChatChange(event.target.checked)} />
              Keep this for Coach chat too
            </label>
          ) : null}
          <button type="button" className="primary-button" onClick={onDone}>Done</button>
        </footer>
      </div>
    </div>
  );
}
