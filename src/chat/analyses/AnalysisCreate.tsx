import { useState } from "react";
import { Check, Loader2, Zap } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type {
  ChatProvider,
  CoachAnalysis,
  CoachAnalysisInput
} from "../../../electron/types";
import { DEFAULT_ANALYSIS_CONDITIONS } from "../../../electron/types";
import { AnalysisDefinitionForm } from "./AnalysisDefinitionForm";
import { TriggerForm, type TriggerDraft } from "./TriggerForm";
import { COACH_ANALYSIS_PRESETS } from "../../../electron/coachAnalysisPresets";
import { describeTrigger } from "./analysisLabels";
import { useAnalysesTitle } from "./analysesTitle";

/** One the athlete writes themselves, rather than starting from a preset. */
const BLANK: Omit<CoachAnalysisInput, "sessionId"> = {
  name: "",
  playbook: "",
  runtime: { effort: "low" }
};

/**
 * Writing an analysis, inside the conversation it will speak in.
 *
 * One screen rather than two, because there is nothing to attach: the
 * conversation is decided by where the athlete pressed the button, so what is
 * left is what it says and when it says it. A preset fills both in as a
 * starting point and every field stays editable before anything is saved.
 */
export function AnalysisCreate({
  api,
  provider,
  sessionId,
  onCancel,
  onCreated
}: {
  api: CorosLinkApi | undefined;
  provider: ChatProvider;
  /** The conversation this analysis will belong to, and cannot leave. */
  sessionId: string;
  onCancel: () => void;
  onCreated: (analysis: CoachAnalysis) => void | Promise<void>;
}) {
  const [presetId, setPresetId] = useState<string>(
    COACH_ANALYSIS_PRESETS[0]?.id ?? "blank"
  );
  const [draft, setDraft] = useState<Omit<CoachAnalysisInput, "sessionId">>(
    COACH_ANALYSIS_PRESETS[0]?.definition ?? BLANK
  );
  const [trigger, setTrigger] = useState<TriggerDraft>(() =>
    triggerDraftFor(COACH_ANALYSIS_PRESETS[0]?.id ?? "blank")
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    setPresetId(id);
    const preset = COACH_ANALYSIS_PRESETS.find((entry) => entry.id === id);
    // Switching the starting point replaces the draft wholesale — a preset is
    // a complete analysis, not a set of fields to merge into what is there.
    setDraft(preset ? { ...preset.definition } : { ...BLANK });
    setTrigger(triggerDraftFor(id));
  };

  const create = async () => {
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.createCoachAnalysis({
        ...draft,
        sessionId,
        trigger: trigger.trigger,
        conditions: trigger.conditions,
        deviceOnly: trigger.deviceOnly
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onCreated(result.analysis);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const ready = draft.name.trim().length > 0 && draft.playbook.trim().length > 0;

  useAnalysesTitle("New analysis");

  return (
    <div className="coach-analysis-create">
      {error ? <p className="coach-analysis-error">{error}</p> : null}

      <div className="coach-analysis-tabpanel">
        <fieldset className="coach-analysis-fieldset" disabled={saving}>
          <legend>Start from</legend>
          <div className="coach-analysis-starters">
            {[
              ...COACH_ANALYSIS_PRESETS.map((preset) => ({
                id: preset.id,
                label: preset.label,
                description: preset.description,
                trigger: describeTrigger(preset.suggestedTrigger ?? null)
              })),
              {
                id: "blank",
                label: "Write my own",
                description:
                  "An empty analysis you fill in yourself: what it should look at, and what to say about it.",
                trigger: describeTrigger(null)
              }
            ].map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="coach-analysis-starter"
                data-selected={presetId === starter.id ? "true" : undefined}
                aria-pressed={presetId === starter.id}
                onClick={() => choose(starter.id)}
              >
                <span className="coach-analysis-starter-head">
                  <Zap size={14} aria-hidden="true" />
                  {starter.label}
                  {presetId === starter.id ? (
                    <Check size={14} aria-hidden="true" />
                  ) : null}
                </span>
                <span className="coach-analysis-starter-copy">
                  {starter.description}
                </span>
                <span className="coach-analysis-starter-trigger">
                  {starter.trigger}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <AnalysisDefinitionForm
          draft={draft}
          provider={provider}
          disabled={saving}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />

        <TriggerForm draft={trigger} disabled={saving} onChange={setTrigger} />

        <div className="chat-local-actions coach-analysis-create-actions">
          <button type="button" className="chat-local-action" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={saving || !ready || !api}
            title={ready ? undefined : "A name and a playbook are required."}
            onClick={() => void create()}
          >
            {saving ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : null}
            {trigger.trigger ? "Create auto analysis" : "Create analysis"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A preset suggests a cadence; it does not assert one. The athlete sees it on
 * the form before anything is saved, and "Write my own" starts manual.
 */
function triggerDraftFor(presetId: string): TriggerDraft {
  const preset = COACH_ANALYSIS_PRESETS.find((entry) => entry.id === presetId);
  return {
    trigger: preset?.suggestedTrigger ?? null,
    conditions: {
      ...DEFAULT_ANALYSIS_CONDITIONS,
      ...(preset?.suggestedConditions ?? {})
    },
    deviceOnly: false
  };
}
