import type {
  AnthropicEffort,
  ChatProvider,
  CoachAnalysisInput
} from "../../../electron/types";
import { ModelSwitch } from "../ModelSwitch";
import { EffortSwitch } from "../EffortSwitch";
import { supportsReasoningEffort } from "../../../electron/chatModels";

/**
 * The definition fields, shared by the create screen and the detail view's
 * Definition tab so the two can never drift apart.
 *
 * **No trigger here, and no guard rails.** They moved to `TriggerForm`, which
 * is part of attaching rather than of defining: an analysis is a question — a
 * role, a playbook, and how hard to think about it — and *when* to ask it only
 * means something once there is a conversation to ask it in. A cooldown on a
 * definition that is attached nowhere governs nothing, and a definition
 * attached twice needs two of them.
 */
export function AnalysisDefinitionForm({
  draft,
  provider,
  disabled,
  onChange
}: {
  draft: Omit<CoachAnalysisInput, "sessionId">;
  provider: ChatProvider;
  disabled?: boolean;
  onChange: (patch: Partial<Omit<CoachAnalysisInput, "sessionId">>) => void;
}) {
  const runtimeProvider = draft.runtime?.provider ?? provider;
  // Mirrors what the two switches themselves decide to render.
  const showModel = runtimeProvider !== "local";
  const showEffort = supportsReasoningEffort(runtimeProvider);

  return (
    <>
      <label className="chat-local-field">
        <span>Name</span>
        <input
          type="text"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>

      <label className="chat-local-field">
        <span>Role</span>
        <textarea
          className="chat-custom-instructions"
          rows={3}
          value={draft.role ?? ""}
          disabled={disabled}
          placeholder="Strict marathon coach, injury-prevention first"
          onChange={(event) => onChange({ role: event.target.value })}
        />
      </label>
      <p className="chat-settings-copy">
        The role is preference data, not operating rules — it can never widen what
        an analysis is allowed to do.
      </p>

      <label className="chat-local-field">
        <span>Playbook</span>
        <textarea
          className="chat-custom-instructions"
          rows={8}
          value={draft.playbook}
          disabled={disabled}
          onChange={(event) => onChange({ playbook: event.target.value })}
        />
      </label>
      <p className="coach-analysis-hint">
        Variables: {"{{rule.name}}"}, {"{{date}}"}, {"{{activity.name}}"},{" "}
        {"{{activity.sport}}"}, {"{{week.range}}"}
      </p>

      {/* Both switches render nothing for a local model, which would otherwise
          leave an empty box labelled "Model" on screen. */}
      {showModel || showEffort ? (
        <fieldset className="coach-analysis-fieldset" disabled={disabled}>
          <legend>Model</legend>
          <div className="coach-analysis-row coach-analysis-model-row">
            {showModel ? (
              <ModelSwitch
                provider={runtimeProvider}
                model={draft.runtime?.model ?? ""}
                onChange={(model) =>
                  onChange({ runtime: { ...draft.runtime, model } })
                }
              />
            ) : null}
            {showEffort ? (
              <EffortSwitch
                provider={runtimeProvider}
                effort={(draft.runtime?.effort ?? "low") as AnthropicEffort}
                onChange={(effort) =>
                  onChange({ runtime: { ...draft.runtime, effort } })
                }
              />
            ) : null}
          </div>
        </fieldset>
      ) : null}

      <p className="chat-settings-copy">
        Analysis runs are read-only: they can read, analyse and draft, but never
        write to COROS. Drafts wait in the conversation for you to confirm.
      </p>

    </>
  );
}
