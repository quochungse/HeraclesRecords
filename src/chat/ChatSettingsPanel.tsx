import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, ChevronRight, Loader2, TriangleAlert, X } from "lucide-react";
import type {
  InlineSuggestionsMode,
  ChatProvider,
  ChatSettings,
  CoachStyle,
  CoachAnalysisPause,
  CoachAnalysisSpend,
  CompactModelChoice,
  ContextDetail
} from "../../electron/types";
import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "../../electron/types";
import {
  CONTEXT_BUDGETS,
  DEFAULT_COMPACT_CONTEXT,
  normalizeCompactModelChoice,
  normalizeContextDetail
} from "../../electron/chatContextCompaction";
import { compressionModelFor, providerModelOptions } from "../../electron/chatModels";
import {
  COACH_PROVIDER_LABELS,
  ClaudeCodeUpdateNote,
  type ClaudeCodeUpdate
} from "./CoachModelsPanel";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { formatTokens } from "./analyses/analysisLabels";
import { OptionGroup } from "../components/OptionGroup";
import {
  COACH_STYLES,
  normalizeCoachStyle
} from "../../electron/coachStyles";
import { plural, t, type MessageKey } from "../i18n/core";

/**
 * The body of Coach settings. It edits the draft the dialog holds
 * (`ChatSettingsModal`): `chatSettings` is what is saved with the draft laid
 * over it, and `onUpdateChatSettings` changes the draft, never the store.
 */
export function ChatSettingsPanel({
  api,
  chatSettings,
  coachModelsSummary,
  claudeCodeUpdate,
  onOpenCoachModels,
  onUpdateChatSettings,
  pendingBudget,
  onPendingBudgetChange
}: {
  api: HeraclesRecordsApi | undefined;
  chatSettings: ChatSettings;
  /** One line describing what is connected, or null while it is being read. */
  coachModelsSummary: string | null;
  /** A newer Claude Code than the one installed, while Coach runs on it. */
  claudeCodeUpdate?: ClaudeCodeUpdate;
  onOpenCoachModels: () => void;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => void;
  /** The analyses' monthly budget as edited, or `undefined` while it is the saved one. */
  pendingBudget: number | null | undefined;
  onPendingBudgetChange: (budget: number | null | undefined) => void;
}) {
  const customInstructions = chatSettings.customInstructions ?? "";
  const coachStyle = normalizeCoachStyle(chatSettings.coachStyle);

  const compactContext = chatSettings.compactContext ?? DEFAULT_COMPACT_CONTEXT;
  const compactEnabled = compactContext.enabled !== false;
  const updateCompact = (patch: Partial<typeof compactContext>) =>
    onUpdateChatSettings({ compactContext: { ...compactContext, ...patch } });

  const [baseInstructionsOpen, setBaseInstructionsOpen] = useState(false);
  const [baseInstructions, setBaseInstructions] = useState<string | null>(null);
  const [baseInstructionsError, setBaseInstructionsError] = useState<string | null>(
    null
  );

  const openBaseInstructions = async () => {
    setBaseInstructionsOpen(true);
    if (baseInstructions !== null) return;
    if (!api) {
      setBaseInstructionsError(t("chat.set.baseFailed"));
      return;
    }
    setBaseInstructionsError(null);
    try {
      setBaseInstructions(await api.getBaseCoachInstructions());
    } catch {
      setBaseInstructionsError(t("chat.set.baseFailed"));
    }
  };

  return (
    <div className="chat-settings-panel">
      <button
        className="settings-nav-row chat-settings-nav-row"
        type="button"
        onClick={onOpenCoachModels}
      >
        <span className="settings-nav-row-icon" aria-hidden="true">
          <BrainCircuit size={22} strokeWidth={1.9} />
        </span>
        <span className="settings-nav-row-copy">
          <strong>{t("chat.models.title")}</strong>
          <span>{coachModelsSummary ?? t("chat.set.checking")}</span>
        </span>
        <ChevronRight
          className="settings-row-chevron"
          size={20}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {claudeCodeUpdate ? <ClaudeCodeUpdateNote update={claudeCodeUpdate} /> : null}

      <section className="chat-settings-section">
        <h3>{t("chat.set.style")}</h3>
        {/* Chips, warmest to harshest, so the choice reads as a scale: where
            Coach sits between the two ends is the thing being chosen. */}
        <OptionGroup<CoachStyle>
          label={t("chat.set.styleLabel")}
          size="md"
          fill
          value={coachStyle}
          onChange={(next) => onUpdateChatSettings({ coachStyle: next })}
          options={COACH_STYLES.map((style) => ({
            value: style,
            label: t(`chat.style.${style}` as MessageKey),
            title: t(`chat.style.${style}.detail` as MessageKey)
          }))}
        />
        <p className="chat-settings-copy">
          {t(`chat.style.${coachStyle}.detail` as MessageKey)} {t("chat.set.styleNote")}
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>{t("chat.set.display")}</h3>
        <label className="chat-local-tools">
          <input
            type="checkbox"
            checked={chatSettings.visualizationsEnabled === true}
            onChange={(event) =>
              onUpdateChatSettings({
                visualizationsEnabled: event.target.checked
              })
            }
          />
          <span>{t("chat.set.charts")}</span>
        </label>
        <p className="chat-settings-copy">{t("chat.set.chartsNote")}</p>
      </section>

      <section className="chat-settings-section">
        <h3>{t("chat.set.suggestions")}</h3>
        <OptionGroup<InlineSuggestionsMode>
          label={t("chat.set.suggestionsLabel")}
          size="md"
          fill
          value={chatSettings.inlineSuggestions ?? "auto"}
          onChange={(inlineSuggestions) => onUpdateChatSettings({ inlineSuggestions })}
          options={[
            { value: "on", label: t("chat.set.on") },
            { value: "auto", label: t("chat.set.automatic") },
            { value: "off", label: t("chat.set.off") }
          ]}
        />
        <p className="chat-settings-copy">
          {t("chat.set.suggestionsNote")}
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>{t("chat.set.instructions")}</h3>
        <p className="chat-settings-copy">{t("chat.set.instructionsNote")}</p>
        <p className="chat-settings-copy">
          {t("chat.set.withBase")}{" "}
          <button
            type="button"
            className="chat-inline-link"
            onClick={() => void openBaseInstructions()}
          >
            {t("chat.set.base")}
          </button>
        </p>
        <label className="chat-local-field">
          <span>{t("chat.set.custom")}</span>
          <textarea
            className="chat-custom-instructions"
            rows={5}
            maxLength={MAX_CUSTOM_COACH_INSTRUCTIONS}
            placeholder={t("chat.set.customPh")}
            value={customInstructions}
            onChange={(event) => onUpdateChatSettings({ customInstructions: event.target.value })}
          />
        </label>
        <p className="chat-settings-copy">
          {t("chat.set.characters", { n: customInstructions.length, max: MAX_CUSTOM_COACH_INSTRUCTIONS })}
        </p>
        {baseInstructionsOpen ? (
          <BaseCoachInstructionsDialog
            instructions={baseInstructions}
            error={baseInstructionsError}
            onClose={() => setBaseInstructionsOpen(false)}
          />
        ) : null}
      </section>

      <CompactContextSection
        chatSettings={chatSettings}
        enabled={compactEnabled}
        detail={normalizeContextDetail(compactContext.detail)}
        model={normalizeCompactModelChoice(compactContext.model)}
        onChange={updateCompact}
      />

      <AnalysesSettingsSection
        api={api}
        pendingBudget={pendingBudget}
        onPendingBudgetChange={onPendingBudgetChange}
      />
    </div>
  );
}

function detailOptions(): { value: ContextDetail; label: string }[] {
  return [
    { value: "lean", label: t("chat.set.less") },
    { value: "balanced", label: t("chat.set.balanced") },
    { value: "full", label: t("chat.set.more") }
  ];
}

type ModelChoiceKind = CompactModelChoice["kind"];

function modelChoiceOptions(): { value: ModelChoiceKind; label: string }[] {
  return [
    { value: "auto", label: t("chat.set.automatic") },
    { value: "conversation", label: t("chat.set.conversationModel") },
    { value: "fixed", label: t("chat.set.choose") }
  ];
}

/** Providers a model can be chosen from here: a local server lists none. */
const CHOOSABLE_PROVIDERS: ChatProvider[] = ["claude-code", "claude-api", "chatgpt", "openrouter"];

const thousands = (tokens: number) => `${Math.round(tokens / 1000)}k`;

/**
 * How a long conversation is sent (`CONTEXT_BUDGETS`) and what condenses it
 * (`CompactModelChoice`). It replaced two number fields counted in entries —
 * "compact after 60, keep 20" — which could not say what a turn weighs, the
 * thing that decides what a conversation costs.
 */
function CompactContextSection({
  chatSettings,
  enabled,
  detail,
  model,
  onChange
}: {
  chatSettings: ChatSettings;
  enabled: boolean;
  detail: ContextDetail;
  model: CompactModelChoice;
  onChange: (patch: Partial<ChatSettings["compactContext"]>) => void;
}) {
  const budget = CONTEXT_BUDGETS[detail];
  const coachProvider = chatSettings.provider;
  const automatic = compressionModelFor(coachProvider, providerModelOptions(coachProvider, chatSettings));
  const fixedProvider = model.kind === "fixed" ? model.provider : null;
  const fixedOptions = fixedProvider
    ? providerModelOptions(fixedProvider, chatSettings).filter((option) => option.value)
    : [];
  const fixedModelKnown = model.kind === "fixed" && fixedOptions.some((option) => option.value === model.model);

  const chooseProvider = (provider: ChatProvider) => {
    const options = providerModelOptions(provider, chatSettings).filter((option) => option.value);
    const first = compressionModelFor(provider, options) ?? options[0];
    if (first) onChange({ model: { kind: "fixed", provider, model: first.value } });
  };
  const chooseKind = (kind: ModelChoiceKind) => {
    if (kind === "fixed") chooseProvider(CHOOSABLE_PROVIDERS.includes(coachProvider) ? coachProvider : "claude-code");
    else onChange({ model: { kind } });
  };

  return (
    <section className="chat-settings-section">
      <h3>{t("chat.row.compact")}</h3>
      <p className="chat-settings-copy">{t("chat.set.compactNote")}</p>
      <label className="chat-local-tools">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        <span>{t("chat.set.compactAuto")}</span>
      </label>

      <div className="chat-local-field">
        <span>{t("chat.set.verbatim")}</span>
        <OptionGroup<ContextDetail>
          label={t("chat.set.verbatimLabel")}
          size="md"
          fill
          disabled={!enabled}
          value={detail}
          onChange={(next) => onChange({ detail: next })}
          options={detailOptions()}
        />
      </div>
      <p className="chat-settings-copy">
        {t("chat.set.budget", {
          keep: thousands(budget.keep),
          rollAt: thousands(budget.rollAt),
          middle: thousands(budget.middle)
        })}{" "}
        {detail === "lean"
          ? t("chat.set.lean")
          : detail === "full"
            ? t("chat.set.full")
            : t("chat.set.default")}
      </p>

      <div className="chat-local-field">
        <span>{t("chat.set.condenseWith")}</span>
        <OptionGroup<ModelChoiceKind>
          label={t("chat.set.condenseLabel")}
          size="md"
          fill
          disabled={!enabled}
          value={model.kind}
          onChange={chooseKind}
          options={modelChoiceOptions()}
        />
      </div>
      {model.kind === "fixed" ? (
        <div className="chat-compact-fields">
          <div className="chat-local-field">
            <span>{t("chat.models.provider")}</span>
            <OptionGroup<ChatProvider>
              label={t("chat.set.condenseProvider")}
              mode="dropdown"
              disabled={!enabled}
              value={model.provider}
              onChange={chooseProvider}
              options={CHOOSABLE_PROVIDERS.map((provider) => ({
                value: provider,
                label: COACH_PROVIDER_LABELS[provider]
              }))}
            />
          </div>
          <div className="chat-local-field">
            <span>{t("chat.models.model")}</span>
            <OptionGroup<string>
              label={t("chat.set.condenseModel")}
              mode="dropdown"
              disabled={!enabled}
              value={model.model}
              onChange={(next) => onChange({ model: { kind: "fixed", provider: model.provider, model: next } })}
              options={[
                ...fixedOptions.map((option) => ({ value: option.value, label: option.label })),
                ...(fixedModelKnown ? [] : [{ value: model.model, label: t("chat.set.notListed", { model: model.model }) }])
              ]}
            />
          </div>
        </div>
      ) : null}
      <p className="chat-settings-copy">
        {model.kind === "auto"
          ? automatic
            ? t("chat.set.autoModel", { provider: COACH_PROVIDER_LABELS[coachProvider], model: automatic.label })
            : t("chat.set.autoNone", { provider: COACH_PROVIDER_LABELS[coachProvider] })
          : model.kind === "conversation"
            ? t("chat.set.conversationNote")
            : t("chat.set.fixedNote")}{" "}
        {t("chat.set.digestRefused")}
      </p>
      <p className="chat-settings-copy">
        {t("chat.set.compactNow")}
      </p>
    </section>
  );
}

/**
 * The two things about analyses that are not about any one analysis: what they
 * have cost this month, and whether they are all held.
 *
 * They live in Settings because that is what they are — feature-wide
 * preferences with no conversation to belong to. They used to sit at the top
 * of a screen that listed every analysis the athlete had; that screen went
 * when an analysis became something that lives in one conversation, and these
 * two would otherwise have gone with it.
 */
function AnalysesSettingsSection({
  api,
  pendingBudget,
  onPendingBudgetChange
}: {
  api: HeraclesRecordsApi | undefined;
  pendingBudget: number | null | undefined;
  onPendingBudgetChange: (budget: number | null | undefined) => void;
}) {
  const [pause, setPause] = useState<CoachAnalysisPause | null>(null);
  const [spend, setSpend] = useState<CoachAnalysisSpend | null>(null);
  const [resuming, setResuming] = useState(false);
  /**
   * The field's text, held apart from the draft budget so a half-typed or
   * cleared number is not fought by a re-render; `null` shows the draft.
   */
  const [budgetText, setBudgetText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A discard or a save puts the draft back to "unchanged": show the budget again.
  useEffect(() => {
    if (pendingBudget === undefined) setBudgetText(null);
  }, [pendingBudget]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [nextPause, nextSpend] = await Promise.all([
          api.getCoachAnalysisPause(),
          api.getCoachAnalysisSpend()
        ]);
        if (cancelled) return;
        setPause(nextPause);
        setSpend(nextSpend);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // The trip usually happens with no window open at all — a scheduled run
  // finding COROS asking for a login code at 07:30 — so this panel follows the
  // push rather than only reading once on mount.
  useEffect(() => {
    if (!api?.onCoachAnalysisPauseUpdate) return;
    return api.onCoachAnalysisPauseUpdate((next) => setPause(next));
  }, [api]);

  /** Into the dialog's draft, written on Save; an unusable number changes nothing. */
  const editBudget = (raw: string) => {
    setBudgetText(raw);
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return;
    onPendingBudgetChange(parsed === (spend?.budget ?? null) ? undefined : parsed);
  };

  const shownBudget = pendingBudget !== undefined ? pendingBudget : (spend?.budget ?? null);

  const resume = async () => {
    if (!api) return;
    setResuming(true);
    setError(null);
    try {
      setPause(await api.resumeCoachAnalyses());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setResuming(false);
    }
  };

  return (
    <section className="chat-settings-section">
      <h3>{t("chat.set.analyses")}</h3>
      <p className="chat-settings-copy">{t("chat.set.analysesNote")}</p>

      {error ? <p className="coach-analysis-error">{error}</p> : null}

      {pause ? (
        <p className="coach-analysis-banner" role="status">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <strong>{t("chat.set.paused")}</strong>{" "}
            {pause.reason === "budget" ? t("chat.set.pausedBudget") : t("chat.set.pausedLogin")}
          </span>
          <button
            type="button"
            className="chat-local-action"
            disabled={!api || resuming}
            onClick={() => void resume()}
          >
            {resuming ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : null}
            {t("chat.set.resume")}
          </button>
        </p>
      ) : null}

      {spend ? (
        <p className="coach-analysis-spend">
          <span>
            <strong>
              {formatTokens(spend.countedTokens)}
            </strong>{" "}
            {t("chat.set.tokensMonth")}
            {spend.cacheReadTokens > 0 ? (
              <>
                {" · "}
                <span
                  title={t("chat.set.cacheReadsTitle", { count: formatTokens(spend.cacheReadTokens) })}
                >
                  {t("chat.set.cacheReads")}
                </span>
              </>
            ) : null}
            {/* A total that is short of the truth has to say so, or a budget
                reads as comfortably under when nobody actually knows. */}
            {spend.providerRuns > spend.countedRuns ? (
              <>
                {" · "}
                <span title={t("chat.set.uncountedTitle")}>
                  {plural("chat.set.uncounted", spend.providerRuns - spend.countedRuns)}
                </span>
              </>
            ) : null}
          </span>
          <label className="chat-local-field coach-analysis-budget">
            {/* The unit is in the label rather than after the field: the
                placeholder reads "none", and a suffix would leave the
                unset state saying "none tokens". */}
            <span>{t("chat.set.budgetField")}</span>
            <input
              type="number"
              min={0}
              step={1000}
              placeholder={t("chat.set.none")}
              disabled={!api}
              value={budgetText ?? (shownBudget === null ? "" : String(shownBudget))}
              onChange={(event) => editBudget(event.target.value)}
              onBlur={() => setBudgetText(null)}
            />
          </label>
        </p>
      ) : null}
    </section>
  );
}

function BaseCoachInstructionsDialog({
  instructions,
  error,
  onClose
}: {
  instructions: string | null;
  error: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    // Capture phase so Escape closes this dialog without also closing the
    // settings modal, which listens on document in the bubble phase.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="chat-base-instructions-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-base-instructions-title"
      onClick={onClose}
    >
      <div
        className="panel chat-base-instructions-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-base-instructions-header">
          <h4 id="chat-base-instructions-title">{t("chat.set.base")}</h4>
          <button
            type="button"
            className="icon-button"
            aria-label={t("chat.set.closeBase")}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-base-instructions-body">
          {error ? (
            <p className="chat-settings-copy">{error}</p>
          ) : instructions === null ? (
            <p className="chat-settings-copy">
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />{" "}
              {t("common.loading")}
            </p>
          ) : (
            <pre>{instructions}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
