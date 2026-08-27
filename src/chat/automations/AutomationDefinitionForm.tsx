import type {
  AnthropicEffort,
  AutomationThresholdMetric,
  AutomationTrigger,
  ChatProvider,
  CoachAutomationInput
} from "../../../electron/types";
import { ModelSwitch } from "../ModelSwitch";
import { EffortSwitch } from "../EffortSwitch";
import { supportsReasoningEffort } from "../../../electron/chatModels";
import {
  SPORT_FILTER_OPTIONS,
  THRESHOLD_METRIC_OPTIONS
} from "./automationLabels";

/**
 * The definition fields, shared by the create screen and the detail view's
 * Definition tab so the two can never drift apart.
 */
export function AutomationDefinitionForm({
  draft,
  provider,
  disabled,
  onChange
}: {
  draft: CoachAutomationInput;
  provider: ChatProvider;
  disabled?: boolean;
  onChange: (patch: Partial<CoachAutomationInput>) => void;
}) {
  const activityTrigger = draft.trigger.kind === "activity" ? draft.trigger : null;
  const scheduleTrigger = draft.trigger.kind === "schedule" ? draft.trigger : null;
  const thresholdTrigger =
    draft.trigger.kind === "threshold" ? draft.trigger : null;
  const thresholdOption = thresholdTrigger
    ? THRESHOLD_METRIC_OPTIONS.find(
        (option) => option.value === thresholdTrigger.metric
      )
    : undefined;
  const quietHours = draft.conditions?.quietHours ?? null;
  const runtimeProvider = draft.runtime?.provider ?? provider;
  // Mirrors what the two switches themselves decide to render.
  const showModel = runtimeProvider !== "local";
  const showEffort = supportsReasoningEffort(runtimeProvider);

  const patchTrigger = (
    patch: Partial<Extract<AutomationTrigger, { kind: "activity" }>>
  ) => {
    if (!activityTrigger) return;
    onChange({ trigger: { ...activityTrigger, ...patch } });
  };

  const patchSchedule = (
    patch: Partial<Extract<AutomationTrigger, { kind: "schedule" }>>
  ) => {
    if (!scheduleTrigger) return;
    onChange({ trigger: { ...scheduleTrigger, ...patch } });
  };

  const patchConditions = (
    patch: NonNullable<CoachAutomationInput["conditions"]>
  ) => {
    onChange({ conditions: { ...draft.conditions, ...patch } });
  };

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
        an automation is allowed to do.
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
      <p className="coach-automation-hint">
        Variables: {"{{rule.name}}"}, {"{{date}}"}, {"{{activity.name}}"},{" "}
        {"{{activity.sport}}"}, {"{{week.range}}"}
      </p>

      <label className="chat-local-field">
        <span>Trigger</span>
        <select
          value={draft.trigger.kind}
          disabled={disabled}
          onChange={(event) =>
            onChange({ trigger: blankTrigger(event.target.value) })
          }
        >
          <option value="activity">After a new activity</option>
          <option value="schedule">On a schedule</option>
          <option value="threshold">When a metric crosses a threshold</option>
          <option value="manual">Manual only</option>
        </select>
      </label>

      {thresholdTrigger ? (
        <fieldset className="coach-automation-fieldset" disabled={disabled}>
          <legend>Fires on a transition</legend>
          <div className="coach-automation-row">
            <label className="chat-local-field">
              <span>Metric</span>
              <select
                value={thresholdTrigger.metric}
                onChange={(event) =>
                  onChange({
                    trigger: {
                      kind: "threshold",
                      metric: event.target.value as AutomationThresholdMetric,
                      // The number means something different per metric — per
                      // cent, bpm, hours — so switching carries the metric's own
                      // starting point rather than the last one's number.
                      value:
                        THRESHOLD_METRIC_DEFAULTS[
                          event.target.value as AutomationThresholdMetric
                        ]
                    }
                  })
                }
              >
                {THRESHOLD_METRIC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="chat-local-field">
              <span>{thresholdOption?.unit ?? "Threshold"}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={thresholdTrigger.value}
                onChange={(event) =>
                  onChange({
                    trigger: {
                      ...thresholdTrigger,
                      value: Number(event.target.value)
                    }
                  })
                }
              />
            </label>
          </div>
          {/* 3.3: it fires on the transition, which is the thing an athlete
              would otherwise have to discover by being surprised twice. */}
          <p className="chat-settings-copy">
            {thresholdOption?.hint} It speaks once when this becomes true, not
            every hour it stays true — and a coach attached today starts from
            where things already stand rather than announcing history.
          </p>
        </fieldset>
      ) : null}

      {scheduleTrigger ? (
        <fieldset className="coach-automation-fieldset" disabled={disabled}>
          <legend>Fires on a schedule</legend>
          <div className="coach-automation-row">
            <label className="chat-local-field">
              <span>Repeats</span>
              <select
                value={scheduleTrigger.cadence}
                onChange={(event) =>
                  // Rebuilt rather than merged: a daily trigger carries no
                  // `dayOfWeek`, and leaving a stale one behind would make the
                  // form read as edited after a save that dropped it.
                  onChange({
                    trigger:
                      event.target.value === "weekly"
                        ? {
                            kind: "schedule",
                            cadence: "weekly",
                            dayOfWeek: scheduleTrigger.dayOfWeek ?? 1,
                            timeOfDay: scheduleTrigger.timeOfDay
                          }
                        : {
                            kind: "schedule",
                            cadence: "daily",
                            timeOfDay: scheduleTrigger.timeOfDay
                          }
                  })
                }
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </label>
            {scheduleTrigger.cadence === "weekly" ? (
              <label className="chat-local-field">
                <span>Day</span>
                <select
                  value={scheduleTrigger.dayOfWeek ?? 1}
                  onChange={(event) =>
                    patchSchedule({ dayOfWeek: Number(event.target.value) })
                  }
                >
                  {WEEKDAY_OPTIONS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="chat-local-field">
              <span>At</span>
              <input
                type="time"
                value={scheduleTrigger.timeOfDay}
                onChange={(event) =>
                  patchSchedule({ timeOfDay: event.target.value || "07:00" })
                }
              />
            </label>
          </div>
          <p className="coach-automation-hint">
            Your local time, and only while CorosLink is running. A slot missed by
            more than a day is written off rather than delivered late.
          </p>
        </fieldset>
      ) : null}

      {activityTrigger ? (
        <fieldset className="coach-automation-fieldset" disabled={disabled}>
          <legend>Fires after a new activity</legend>
          <div className="coach-automation-sports">
            {SPORT_FILTER_OPTIONS.map((sport) => {
              const checked = activityTrigger.sportTypes.includes(sport.value);
              return (
                <label key={sport.value} className="coach-automation-chip">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      patchTrigger({
                        sportTypes: checked
                          ? activityTrigger.sportTypes.filter(
                              (value) => value !== sport.value
                            )
                          : [...activityTrigger.sportTypes, sport.value]
                      })
                    }
                  />
                  <span>{sport.label}</span>
                </label>
              );
            })}
          </div>
          <p className="coach-automation-hint">
            {activityTrigger.sportTypes.length === 0
              ? "No sport selected means every sport."
              : `${activityTrigger.sportTypes.length} sport(s) selected.`}
          </p>
          <div className="coach-automation-row">
            <label className="chat-local-field">
              <span>Minimum duration (min)</span>
              <input
                type="number"
                min={0}
                value={Math.round((activityTrigger.minDurationSec ?? 0) / 60)}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  patchTrigger({
                    minDurationSec: minutes > 0 ? minutes * 60 : undefined
                  });
                }}
              />
            </label>
            <label className="chat-local-field">
              <span>Minimum distance (km)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={(activityTrigger.minDistanceM ?? 0) / 1000}
                onChange={(event) => {
                  const km = Number(event.target.value);
                  patchTrigger({
                    minDistanceM: km > 0 ? Math.round(km * 1000) : undefined
                  });
                }}
              />
            </label>
          </div>
          <label className="coach-automation-switch">
            <input
              type="checkbox"
              checked={activityTrigger.multiActivity === true}
              onChange={(event) =>
                patchTrigger({ multiActivity: event.target.checked })
              }
            />
            <span>Analyse every new activity</span>
          </label>
          <p className="coach-automation-hint">
            {activityTrigger.multiActivity
              ? "Every matching activity since the last analysis is analysed, one run each, oldest first."
              : "Only the most recent matching activity is analysed, however many piled up."}
          </p>
        </fieldset>
      ) : null}

      {/* Both switches render nothing for a local model, which would otherwise
          leave an empty box labelled "Model" on screen. */}
      {showModel || showEffort ? (
        <fieldset className="coach-automation-fieldset" disabled={disabled}>
          <legend>Model</legend>
          <div className="coach-automation-row coach-automation-model-row">
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
        Automation runs are read-only: they can read, analyse and draft, but never
        write to COROS. Drafts wait in the conversation for you to confirm.
      </p>

      <fieldset className="coach-automation-fieldset" disabled={disabled}>
        <legend>Guard rails</legend>
        <div className="coach-automation-row">
          {/* The batch window only means anything to the activity watcher —
              it is how long several activities landing together are held so
              they become one run. A schedule fires on its own clock. */}
          {activityTrigger ? (
            <label className="chat-local-field">
              <span>Batch window (min)</span>
              <input
                type="number"
                min={0}
                value={draft.conditions?.batchWindowMin ?? 20}
                onChange={(event) =>
                  patchConditions({ batchWindowMin: Number(event.target.value) })
                }
              />
            </label>
          ) : null}
          <label className="chat-local-field">
            <span>Cooldown (min)</span>
            <input
              type="number"
              min={0}
              value={draft.conditions?.cooldownMin ?? 120}
              onChange={(event) =>
                patchConditions({ cooldownMin: Number(event.target.value) })
              }
            />
          </label>
          <label className="chat-local-field">
            <span>Max runs per day</span>
            <input
              type="number"
              min={1}
              max={24}
              value={draft.conditions?.maxRunsPerDay ?? 3}
              onChange={(event) =>
                patchConditions({ maxRunsPerDay: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <label className="coach-automation-switch">
          <input
            type="checkbox"
            checked={quietHours !== null}
            onChange={(event) =>
              patchConditions({
                quietHours: event.target.checked
                  ? { start: "22:00", end: "06:00" }
                  : null
              })
            }
          />
          <span>Quiet hours</span>
        </label>
        {quietHours ? (
          <div className="coach-automation-row">
            <label className="chat-local-field">
              <span>From</span>
              <input
                type="time"
                value={quietHours.start}
                onChange={(event) =>
                  patchConditions({
                    quietHours: {
                      ...quietHours,
                      start: event.target.value || "22:00"
                    }
                  })
                }
              />
            </label>
            <label className="chat-local-field">
              <span>Until</span>
              <input
                type="time"
                value={quietHours.end}
                onChange={(event) =>
                  patchConditions({
                    quietHours: { ...quietHours, end: event.target.value || "06:00" }
                  })
                }
              />
            </label>
          </div>
        ) : null}
        <p className="coach-automation-hint">
          {quietHours
            ? "A scheduled run inside this window waits until it closes. An activity run is skipped instead — the activity is not going anywhere, and the next poll picks it up."
            : "Runs are allowed at any hour."}
        </p>
      </fieldset>
    </>
  );
}

const WEEKDAY_OPTIONS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

/**
 * The starting point for a trigger kind the athlete just switched to. Switching
 * away and back deliberately resets rather than remembering: the two kinds share
 * no fields, so there is nothing to preserve.
 */
function blankTrigger(kind: string): AutomationTrigger {
  if (kind === "schedule") {
    return { kind: "schedule", cadence: "daily", timeOfDay: "07:00" };
  }
  if (kind === "activity") {
    return { kind: "activity", sportTypes: [] };
  }
  if (kind === "threshold") {
    return {
      kind: "threshold",
      metric: "acuteChronicRamp",
      value: THRESHOLD_METRIC_DEFAULTS.acuteChronicRamp
    };
  }
  return { kind: "manual" };
}

/**
 * A starting number per metric, because the number is a different quantity in
 * each: a 30 that means "per cent over the 4-week average" is nonsense as
 * "bpm above baseline".
 */
const THRESHOLD_METRIC_DEFAULTS: Record<AutomationThresholdMetric, number> = {
  acuteChronicRamp: 30,
  restingHrDrift: 5,
  planAdherence: 24,
  sleepDebt: 5
};
