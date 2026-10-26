import { AlertTriangle, ArrowRight, Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { ChatProvider, ChatSettings, ClaudeCodeStatus } from "../../electron/types";
import {
  reasoningEffortForModel,
  reasoningEffortOptions,
  supportsReasoningEffort,
  withCurrentModel
} from "../../electron/chatModels";
import { OptionGroup } from "../components/OptionGroup";
import {
  COACH_PROVIDER_LABELS,
  claudeCodeUpdateFor
} from "../chat/coachProviders";
import { ClaudeCodeUpdateNote } from "../chat/ClaudeCodeUpdateNote";
import {
  GENERATOR_PROVIDERS,
  modelChipLabel,
  runtimeFromSettings,
  runtimeModelOptions,
  type GeneratorRuntime
} from "./planGeneratorRuntime";
import { messageRecord, t } from "../i18n/core";

/**
 * In the plan sheet, models are chips while they fit on one line;
 * past that they are a menu, since a track of chips wrapped onto a second line
 * reads as two controls. Decided from the labels, not measured, so the choice
 * cannot flip back and forth with the layout it changes. Four Claude names of
 * 59 characters measured just inside the 480px track.
 */
const MODEL_CHIP_LIMIT = 4;
const MODEL_CHIP_CHARACTERS = 60;

function modelsFitAsChips(labels: readonly string[]): boolean {
  return (
    labels.length <= MODEL_CHIP_LIMIT &&
    labels.reduce((sum, label) => sum + label.length, 0) <= MODEL_CHIP_CHARACTERS
  );
}

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
  /** A quiet control of the caller's at the footer's start, such as a conversation's plan usage. */
  footerStart?: ReactNode;
  onDone: () => void;
  onOpenCoach: () => void;
  /** Opens AI Model Providers, where a provider is connected; no link without it. */
  onOpenProviders?: () => void;
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
  onOpenProviders,
  subject = "plan",
  children,
  footerStart
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
  const efforts = reasoningEffortOptions(runtime.provider, listedModel);
  const effort = reasoningEffortForModel(runtime.provider, runtime.effort, listedModel);
  // A provider known not to be set up is left out unless it is the one chosen
  // or Coach's own: a list of six where four cannot answer is noise, and one
  // is connected under AI Model Providers.
  const listed = GENERATOR_PROVIDERS.filter(
    (provider) =>
      readiness[provider] !== false ||
      provider === runtime.provider ||
      provider === settings.provider
  );
  const pickProvider = (provider: ChatProvider) => {
    if (provider === runtime.provider) return;
    onChange(runtimeFromSettings(settings, provider));
  };

  const isConversation = subject === "conversation";
  const canChooseEffort = supportsReasoningEffort(runtime.provider) && effort !== undefined && efforts.length > 0;
  const effortDescription = efforts.find((option) => option.value === effort)?.detail
    ?? t(runtime.provider === "claude-code" || runtime.provider === "chatgpt"
      ? "chat.models.claudeEffortNote"
      : "chat.models.effortNote");
  const modelControl = runtime.provider === "local" ? (
      <p className="plan-generator-sheet-note">
        {runtime.model.trim()
          ? t("library.ai.runsLocal", { model: runtime.model.trim() })
          : t("library.fix.local")}
      </p>
  ) : (
      <OptionGroup
        label={t("library.ai.model")}
        className="plan-generator-sheet-models"
        mode={isConversation || !modelsFitAsChips(models.map((option) => modelChipLabel(option.label))) ? "dropdown" : "expanded"}
        size={isConversation ? "md" : "sm"}
        value={models.some((option) => option.value === runtime.model) ? runtime.model : (models[0]?.value ?? "")}
        options={models.map((option) => ({
          value: option.value,
          label: isConversation ? option.label : modelChipLabel(option.label),
          title: option.label,
          ...(option.detail ? { detail: option.detail } : {})
        }))}
        // As ModelSwitch: a qualifier wraps at the menu's floor, and the
        // trigger alone is too narrow to read one in.
        minMenuWidth={models.some((option) => option.detail) ? 420 : undefined}
        onChange={(model) => onChange({ ...runtime, model })}
      />
  );
  const effortControl = canChooseEffort ? (
      <OptionGroup
        label={t("library.ai.effort")}
        className="plan-generator-sheet-effort"
        mode={isConversation || runtime.provider === "chatgpt" ? "dropdown" : "expanded"}
        size={isConversation ? "md" : "sm"}
        value={effort ?? ""}
        options={efforts.map((option) => ({ ...option, title: option.detail }))}
        onChange={(next) => onChange({ ...runtime, effort: next })}
      />
  ) : (
      <p className="plan-generator-sheet-note">
        {supportsReasoningEffort(runtime.provider)
          ? runtime.provider === "chatgpt" && !listedModel?.reasoning
            ? t(runtime.model ? "library.ai.refreshEffort" : "library.ai.chooseEffortModel")
            : t("library.ai.noEffort", { name: listedModel ? listedModel.label : t("library.ai.thisModel") })
          : t("library.ai.noEffort", { name: COACH_PROVIDER_LABELS[runtime.provider] })}
      </p>
  );

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
          <div className="plan-generator-sheet-heading">
            <p className="tl-eyebrow">{t("library.ai.provider")}</p>
            {onOpenProviders ? (
              <button
                type="button"
                className="plan-generator-sheet-link"
                title={t("app.coachModels.title")}
                onClick={onOpenProviders}
              >
                {t("library.ai.manageProviders")}
                <ArrowRight size={12} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="plan-generator-provider-list">
            {listed.map((provider) => {
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

          {isConversation ? (
            <div className="conversation-ai-runtime">
              <div className="conversation-ai-field">
                <span className="conversation-ai-field-label">{t("library.ai.model")}</span>
                {modelControl}
              </div>
              <div className="conversation-ai-field">
                <span className="conversation-ai-field-label">{t("library.ai.effort")}</span>
                {effortControl}
                {canChooseEffort ? <p className="plan-generator-sheet-note">{effortDescription}</p> : null}
              </div>
            </div>
          ) : (
            <>
              <p className="tl-eyebrow">{t("library.ai.model")}</p>
              {modelControl}
              <p className="tl-eyebrow">{t("library.ai.effort")}</p>
              {effortControl}
            </>
          )}

          {children}
        </div>

        <footer>
          {footerStart}
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
