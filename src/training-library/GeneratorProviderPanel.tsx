import { AlertTriangle, ArrowRight, Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { ChatProvider, ChatSettings, ClaudeCodeStatus } from "../../electron/types";
import {
  effortForModel,
  effortOptionsFor,
  supportsReasoningEffort,
  withCurrentModel
} from "../../electron/chatModels";
import { OptionGroup } from "../components/OptionGroup";
import {
  COACH_PROVIDER_LABELS,
  ClaudeCodeUpdateNote,
  claudeCodeUpdateFor
} from "../chat/CoachModelsPanel";
import {
  GENERATOR_PROVIDERS,
  modelChipLabel,
  runtimeFromSettings,
  runtimeModelOptions,
  type GeneratorRuntime
} from "./planGeneratorRuntime";

import { messageRecord, t } from "../i18n/core";
/** More models than this are offered as a menu rather than a row of chips. */
const MODEL_CHIP_LIMIT = 6;

/** Where to fix a provider that is not ready, per provider. */
export const PROVIDER_FIX: Readonly<Record<ChatProvider, string>> = messageRecord({
  chatgpt: "library.fix.chatgpt",
  "claude-code": "library.fix.claudeCode",
  "claude-api": "library.fix.claudeApi",
  openrouter: "library.fix.openrouter",
  local: "library.fix.local"
});

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
  /** A section of the caller's under the AI, such as a conversation's permissions. */
  children?: ReactNode;
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
  subject = "plan",
  children
}: GeneratorProviderPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
  }, []);

  const ready = readiness[runtime.provider];
  const claudeCodeUpdate = claudeCodeUpdateFor(runtime.provider, claudeStatus);
  const models = withCurrentModel(
    runtimeModelOptions(runtime.provider, settings, claudeStatus),
    runtime.model
  );
  const listedModel = models.find((option) => option.value === runtime.model);
  const efforts = effortOptionsFor(listedModel);
  const effort = effortForModel(runtime.effort, listedModel?.efforts);
  const pickProvider = (provider: ChatProvider) => {
    if (provider === runtime.provider) return;
    onChange(runtimeFromSettings(settings, provider));
  };

  return (
    <div className="plan-generator-sheet-layer">
      <button type="button" className="plan-generator-scrim" aria-label={t("library.ai.close")} tabIndex={-1} onClick={onDone} />
      <div
        ref={panelRef}
        className="plan-generator-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-generator-ai-title"
      >
        <header>
          <div>
            <h3 id="plan-generator-ai-title">{subject === "plan" ? t("library.ai.titlePlan") : t("library.ai.titleConversation")}</h3>
            <p>
              {subject === "plan"
                ? t("library.ai.bodyPlan")
                : t("library.ai.bodyConversation")}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label={t("library.ai.close")} onClick={onDone}><X size={16} /></button>
        </header>

        <div className="plan-generator-sheet-body">
          <p className="tl-eyebrow">{t("library.ai.provider")}</p>
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
                    {provider === settings.provider ? <small>{t("library.ai.coachs")}</small> : null}
                  </span>
                  <span className={`plan-generator-provider-tag${state === true ? " is-ready" : state === false ? " is-blocked" : ""}`}>
                    {state === undefined ? <LoaderCircle className="is-spinning" size={11} aria-hidden="true" /> : state ? <Check size={11} aria-hidden="true" /> : null}
                    {state === undefined ? t("library.ai.checking") : state ? t("library.ai.connected") : t("library.ai.notSetUp")}
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
              <button type="button" className="ghost-button" onClick={onOpenCoach}>{t("library.ai.coachSettings")} <ArrowRight size={13} /></button>
            </div>
          ) : null}

          {claudeCodeUpdate ? <ClaudeCodeUpdateNote update={claudeCodeUpdate} /> : null}

          <p className="tl-eyebrow">{t("library.ai.model")}</p>
          {runtime.provider === "local" ? (
            <p className="plan-generator-sheet-note">
              {settings.local.model.trim()
                ? t("library.ai.runsLocal", { model: settings.local.model.trim() })
                : t("library.fix.local")}
            </p>
          ) : (
            <OptionGroup
              label={t("library.ai.model")}
              className="plan-generator-sheet-models"
              // A provider's own list can run to dozens (OpenRouter's is cut
              // at 40); past a handful, chips are a wall rather than a choice.
              mode={models.length > MODEL_CHIP_LIMIT ? "dropdown" : "expanded"}
              value={models.some((option) => option.value === runtime.model) ? runtime.model : (models[0]?.value ?? "")}
              options={models.map((option) => ({
                value: option.value,
                label: modelChipLabel(option.label),
                title: option.label,
                ...(option.detail ? { detail: option.detail } : {})
              }))}
              // As ModelSwitch: a qualifier wraps at the menu's floor, and the
              // trigger alone is too narrow to read one in.
              minMenuWidth={models.some((option) => option.detail) ? 420 : undefined}
              onChange={(model) => onChange({ ...runtime, model })}
            />
          )}

          <p className="tl-eyebrow">{t("library.ai.effort")}</p>
          {supportsReasoningEffort(runtime.provider) && effort && efforts.length > 0 ? (
            <OptionGroup
              label={t("library.ai.effort")}
              value={effort}
              options={efforts.map((option) => ({ value: option.value, label: option.label, title: option.detail }))}
              onChange={(next) => onChange({ ...runtime, effort: next })}
            />
          ) : (
            <p className="plan-generator-sheet-note">
              {supportsReasoningEffort(runtime.provider)
                ? t("library.ai.noEffort", { name: listedModel ? listedModel.label : t("library.ai.thisModel") })
                : t("library.ai.noEffort", { name: COACH_PROVIDER_LABELS[runtime.provider] })}
            </p>
          )}

          {children}
        </div>

        <footer>
          {onKeepForChatChange ? (
            <label className="plan-generator-sheet-keep">
              <input type="checkbox" checked={keepForChat === true} onChange={(event) => onKeepForChatChange(event.target.checked)} />
              {t("library.ai.keep")}
            </label>
          ) : null}
          <button type="button" className="primary-button" onClick={onDone}>{t("common.done")}</button>
        </footer>
      </div>
    </div>
  );
}
