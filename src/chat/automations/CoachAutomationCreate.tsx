import { useState } from "react";
import { Check, Loader2, Zap } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type {
  ChatProvider,
  CoachAutomation,
  CoachAutomationInput
} from "../../../electron/types";
import { AutomationDefinitionForm } from "./AutomationDefinitionForm";
import { COACH_AUTOMATION_PRESETS } from "../../../electron/coachAutomationPresets";
import { describeTrigger } from "./automationLabels";
import { useAutomationsNav } from "./automationsNav";

/** A rule the athlete writes themselves, rather than starting from a preset. */
const BLANK: CoachAutomationInput = {
  name: "",
  playbook: "",
  trigger: { kind: "activity", sportTypes: [] },
  runtime: { effort: "low" },
  conditions: { batchWindowMin: 20, cooldownMin: 120, maxRunsPerDay: 3 }
};

/**
 * Creating an automation is its own screen rather than an inline "Add" button:
 * a definition is a paragraph of coaching instructions plus a trigger and guard
 * rails, which is too much to fill in beside a list.
 */
export function CoachAutomationCreate({
  api,
  provider,
  onCancel,
  onCreated
}: {
  api: CorosLinkApi | undefined;
  provider: ChatProvider;
  onCancel: () => void;
  onCreated: (automation: CoachAutomation) => void;
}) {
  const [presetId, setPresetId] = useState<string>(
    COACH_AUTOMATION_PRESETS[0]?.id ?? "blank"
  );
  const [draft, setDraft] = useState<CoachAutomationInput>(
    COACH_AUTOMATION_PRESETS[0]?.definition ?? BLANK
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    setPresetId(id);
    const preset = COACH_AUTOMATION_PRESETS.find((entry) => entry.id === id);
    // Switching the starting point replaces the draft wholesale — a preset is a
    // complete definition, not a set of fields to merge into what is there.
    setDraft(preset ? { ...preset.definition } : { ...BLANK });
  };

  const create = async () => {
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.saveCoachAutomation(draft);
      if (created) {
        onCreated(created);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const ready = draft.name.trim().length > 0 && draft.playbook.trim().length > 0;

  useAutomationsNav({ title: "New automation", onBack: onCancel });

  return (
    <div className="coach-automation-create">
      {error ? <p className="coach-automation-error">{error}</p> : null}

      <div className="coach-automation-tabpanel">
        <fieldset className="coach-automation-fieldset" disabled={saving}>
          <legend>Start from</legend>
          <div className="coach-automation-starters">
            {[
              ...COACH_AUTOMATION_PRESETS.map((preset) => ({
                id: preset.id,
                label: preset.label,
                description: preset.description,
                trigger: describeTrigger(preset.definition.trigger)
              })),
              {
                id: "blank",
                label: "Write my own",
                description:
                  "An empty rule you fill in yourself: what the coach should look at, and when.",
                trigger: describeTrigger(BLANK.trigger)
              }
            ].map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="coach-automation-starter"
                data-selected={presetId === starter.id ? "true" : undefined}
                aria-pressed={presetId === starter.id}
                onClick={() => choose(starter.id)}
              >
                <span className="coach-automation-starter-head">
                  <Zap size={14} aria-hidden="true" />
                  {starter.label}
                  {presetId === starter.id ? (
                    <Check size={14} aria-hidden="true" />
                  ) : null}
                </span>
                <span className="coach-automation-starter-copy">
                  {starter.description}
                </span>
                <span className="coach-automation-starter-trigger">
                  {starter.trigger}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <AutomationDefinitionForm
          draft={draft}
          provider={provider}
          disabled={saving}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />

        <div className="chat-local-actions coach-automation-create-actions">
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
            Create automation
          </button>
        </div>
        <p className="coach-automation-hint">
          Next you will choose where it runs — an automation attached to nothing
          never fires.
        </p>
      </div>
    </div>
  );
}
