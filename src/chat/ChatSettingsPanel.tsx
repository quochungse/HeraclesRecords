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
import { COACH_PROVIDER_LABELS } from "./CoachModelsPanel";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { formatTokens } from "./analyses/analysisLabels";
import { OptionGroup } from "../components/OptionGroup";
import {
  COACH_STYLE_CATALOG,
  COACH_STYLES,
  normalizeCoachStyle
} from "../../electron/coachStyles";

/**
 * The body of Coach settings. It edits the draft the dialog holds
 * (`ChatSettingsModal`): `chatSettings` is what is saved with the draft laid
 * over it, and `onUpdateChatSettings` changes the draft, never the store.
 */
export function ChatSettingsPanel({
  api,
  chatSettings,
  coachModelsSummary,
  onOpenCoachModels,
  onUpdateChatSettings,
  pendingBudget,
  onPendingBudgetChange
}: {
  api: HeraclesRecordsApi | undefined;
  chatSettings: ChatSettings;
  /** One line describing what is connected, or null while it is being read. */
  coachModelsSummary: string | null;
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
      setBaseInstructionsError("Could not load the base coach instructions.");
      return;
    }
    setBaseInstructionsError(null);
    try {
      setBaseInstructions(await api.getBaseCoachInstructions());
    } catch {
      setBaseInstructionsError("Could not load the base coach instructions.");
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
          <strong>Coach Models</strong>
          <span>{coachModelsSummary ?? "Checking connections…"}</span>
        </span>
        <ChevronRight
          className="settings-row-chevron"
          size={20}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      <section className="chat-settings-section">
        <h3>Coach style</h3>
        {/* Chips, warmest to harshest, so the choice reads as a scale: where
            Coach sits between the two ends is the thing being chosen. */}
        <OptionGroup<CoachStyle>
          label="How Coach sounds"
          size="md"
          fill
          value={coachStyle}
          onChange={(next) => onUpdateChatSettings({ coachStyle: next })}
          options={COACH_STYLES.map((style) => ({
            value: style,
            label: COACH_STYLE_CATALOG[style].label,
            title: COACH_STYLE_CATALOG[style].detail
          }))}
        />
        <p className="chat-settings-copy">
          {COACH_STYLE_CATALOG[coachStyle].detail} The style changes how Coach
          sounds, never the figures or the advice, and it stays out of anything
          saved to COROS — workout and plan names and descriptions are written
          plainly in every style. Your custom instructions below can fine-tune it.
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>Display</h3>
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
          <span>Show charts and activity visuals in chat</span>
        </label>
        <p className="chat-settings-copy">
          When off, heart rate trends, zone summaries, and activity charts are
          hidden. The coach still responds with text.
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>Workout suggestions</h3>
        <OptionGroup<InlineSuggestionsMode>
          label="Workout cards Coach offers unasked"
          size="md"
          fill
          value={chatSettings.inlineSuggestions ?? "auto"}
          onChange={(inlineSuggestions) => onUpdateChatSettings({ inlineSuggestions })}
          options={[
            { value: "on", label: "On" },
            { value: "auto", label: "Automatic" },
            { value: "off", label: "Off" }
          ]}
        />
        <p className="chat-settings-copy">
          When Coach recommends a session, it can attach it as a workout card
          you save in one press — at most two in one answer. Automatic turns
          this on for Claude, whose cached context keeps the extra steps cheap,
          and off for other providers, where each one costs more. The cost of
          every answer is shown under it.
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>Coach instructions</h3>
        <p className="chat-settings-copy">
          Extra preferences appended to every coaching prompt — for example your
          goal race, training days or equipment.
        </p>
        <p className="chat-settings-copy">
          Your custom instructions will be used in conjunction with the{" "}
          <button
            type="button"
            className="chat-inline-link"
            onClick={() => void openBaseInstructions()}
          >
            Base Coach instructions
          </button>
          .
        </p>
        <label className="chat-local-field">
          <span>Custom instructions</span>
          <textarea
            className="chat-custom-instructions"
            rows={5}
            maxLength={MAX_CUSTOM_COACH_INSTRUCTIONS}
            placeholder="e.g. I race a marathon in October, I can only run Tue/Thu/Sat, and I have no gym access."
            value={customInstructions}
            onChange={(event) => onUpdateChatSettings({ customInstructions: event.target.value })}
          />
        </label>
        <p className="chat-settings-copy">
          {customInstructions.length}/{MAX_CUSTOM_COACH_INSTRUCTIONS} characters.
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

const DETAIL_OPTIONS: { value: ContextDetail; label: string }[] = [
  { value: "lean", label: "Less" },
  { value: "balanced", label: "Balanced" },
  { value: "full", label: "More" }
];

type ModelChoiceKind = CompactModelChoice["kind"];

const MODEL_CHOICE_OPTIONS: { value: ModelChoiceKind; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "conversation", label: "Conversation’s model" },
  { value: "fixed", label: "Choose" }
];

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
      <h3>Compact context</h3>
      <p className="chat-settings-copy">
        A long conversation is sent in three layers: the newest turns word for
        word; the ones before them condensed — your messages as you wrote them,
        each of Coach&rsquo;s answers as a short digest of its figures and
        decisions; and everything older as a running summary. Only what is sent
        changes. The conversation stays complete on screen, and Coach can read
        any earlier turn word for word when it needs to.
      </p>
      <label className="chat-local-tools">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        <span>Compact long conversations automatically</span>
      </label>

      <div className="chat-local-field">
        <span>Kept word for word</span>
        <OptionGroup<ContextDetail>
          label="How much of a conversation is sent word for word"
          size="md"
          fill
          disabled={!enabled}
          value={detail}
          onChange={(next) => onChange({ detail: next })}
          options={DETAIL_OPTIONS}
        />
      </div>
      <p className="chat-settings-copy">
        About the last {thousands(budget.keep)} tokens go as written. Once the
        recent turns pass {thousands(budget.rollAt)}, the older ones are
        condensed; once the condensed part passes {thousands(budget.middle)}, its
        oldest turns go into the summary.{" "}
        {detail === "lean"
          ? "The cheapest, and Coach looks back more often."
          : detail === "full"
            ? "Costs more on every turn of a long conversation."
            : "The default."}
      </p>

      <div className="chat-local-field">
        <span>Condense with</span>
        <OptionGroup<ModelChoiceKind>
          label="The model that makes digests and summaries"
          size="md"
          fill
          disabled={!enabled}
          value={model.kind}
          onChange={chooseKind}
          options={MODEL_CHOICE_OPTIONS}
        />
      </div>
      {model.kind === "fixed" ? (
        <div className="chat-compact-fields">
          <div className="chat-local-field">
            <span>Provider</span>
            <OptionGroup<ChatProvider>
              label="Provider of the condensing model"
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
            <span>Model</span>
            <OptionGroup<string>
              label="Condensing model"
              mode="dropdown"
              disabled={!enabled}
              value={model.model}
              onChange={(next) => onChange({ model: { kind: "fixed", provider: model.provider, model: next } })}
              options={[
                ...fixedOptions.map((option) => ({ value: option.value, label: option.label })),
                ...(fixedModelKnown ? [] : [{ value: model.model, label: `${model.model} (not listed)` }])
              ]}
            />
          </div>
        </div>
      ) : null}
      <p className="chat-settings-copy">
        {model.kind === "auto"
          ? automatic
            ? `The smallest model the conversation’s AI offers — for ${COACH_PROVIDER_LABELS[coachProvider]}, ${automatic.label}. A conversation on an AI whose models say nothing about their size uses its own model.`
            : `The smallest model the conversation’s AI offers. ${COACH_PROVIDER_LABELS[coachProvider]} lists none by size, so its conversations use their own model.`
          : model.kind === "conversation"
            ? "The model each conversation answers with. It costs more, and digests and summaries read no better for it."
            : "Every conversation is condensed with this model, whatever AI it answers with."}{" "}
        A digest that states a figure its answer does not is refused, and that
        answer is sent whole.
      </p>
      <p className="chat-settings-copy">
        Compact one conversation right now from its &ldquo;⋯&rdquo; menu in the sidebar.
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
      <h3>Analyses</h3>
      <p className="chat-settings-copy">
        An analysis runs on its own inside the conversation it was written in —
        create one from the Analyses control in a conversation&rsquo;s header.
        What is here applies to all of them at once.
      </p>

      {error ? <p className="coach-analysis-error">{error}</p> : null}

      {pause ? (
        <p className="coach-analysis-banner" role="status">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <strong>Every analysis is paused.</strong>{" "}
            {pause.reason === "budget" ? (
              <>
                This month&rsquo;s token budget ran out, so they stopped rather
                than spending past a number you set. They start again on the
                1st — or now, if you raise the budget below.
              </>
            ) : (
              <>
                COROS asked for a login code and no analysis can supply one, so
                they stopped rather than filling the run log with the same skip
                every fifteen minutes. Sign in to COROS, then resume.
              </>
            )}
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
            Resume
          </button>
        </p>
      ) : null}

      {spend ? (
        <p className="coach-analysis-spend">
          <span>
            <strong>
              {formatTokens(spend.inputTokens + spend.outputTokens)}
            </strong>{" "}
            tokens this month
            {/* A total that is short of the truth has to say so, or a budget
                reads as comfortably under when nobody actually knows. */}
            {spend.providerRuns > spend.countedRuns ? (
              <>
                {" · "}
                <span title="Some providers do not report what a turn cost.">
                  {spend.providerRuns - spend.countedRuns} run
                  {spend.providerRuns - spend.countedRuns === 1 ? "" : "s"} not
                  counted
                </span>
              </>
            ) : null}
          </span>
          <label className="chat-local-field coach-analysis-budget">
            {/* The unit is in the label rather than after the field: the
                placeholder reads "none", and a suffix would leave the
                unset state saying "none tokens". */}
            <span>Monthly budget (tokens)</span>
            <input
              type="number"
              min={0}
              step={1000}
              placeholder="none"
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
          <h4 id="chat-base-instructions-title">Base Coach instructions</h4>
          <button
            type="button"
            className="icon-button"
            aria-label="Close base coach instructions"
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
              Loading…
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
