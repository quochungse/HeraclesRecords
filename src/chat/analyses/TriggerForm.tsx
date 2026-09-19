import { OptionChips, OptionGroup } from "../../components/OptionGroup";
import type {
  AnalysisConditions,
  AnalysisThresholdMetric,
  AnalysisTrigger
} from "../../../electron/types";
import {
  SPORT_FILTER_OPTIONS,
  THRESHOLD_METRIC_OPTIONS
} from "./analysisLabels";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  displayDistanceToMeters,
  distanceUnit,
  metersToDisplayDistance
} from "../../units/units";

/**
 * What an analysis fires on, and how often it is allowed to.
 *
 * Its own component rather than more fields on the definition form, because
 * two screens ask this question: the one that creates an analysis, and the
 * one that edits it afterwards. Most analyses start manual and are promoted
 * later, so the second is the common path and the two must not drift.
 */
export interface TriggerDraft {
  /** null is a manual analysis: attached, runnable by hand, never automatic. */
  trigger: AnalysisTrigger | null;
  conditions: AnalysisConditions;
  deviceOnly: boolean;
}

export function TriggerForm({
  draft,
  disabled,
  onChange
}: {
  draft: TriggerDraft;
  disabled?: boolean;
  onChange: (next: TriggerDraft) => void;
}) {
  const { trigger, conditions } = draft;
  const activityTrigger = trigger?.kind === "activity" ? trigger : null;
  const scheduleTrigger = trigger?.kind === "schedule" ? trigger : null;
  const thresholdTrigger = trigger?.kind === "threshold" ? trigger : null;
  const thresholdOption = thresholdTrigger
    ? THRESHOLD_METRIC_OPTIONS.find(
        (option) => option.value === thresholdTrigger.metric
      )
    : undefined;
  const quietHours = conditions.quietHours ?? null;
  const { unitSystem } = useUnitSystem();

  const setTrigger = (next: AnalysisTrigger | null) =>
    onChange({
      ...draft,
      trigger: next,
      // "This device only" is a statement about a trigger. Dropping the trigger
      // leaves nothing for it to be about, and a flag remembered against
      // nothing reads as a promise the next trigger never made.
      deviceOnly: next === null ? false : draft.deviceOnly
    });

  const patchActivity = (
    patch: Partial<Extract<AnalysisTrigger, { kind: "activity" }>>
  ) => {
    if (!activityTrigger) return;
    setTrigger({ ...activityTrigger, ...patch });
  };

  const patchSchedule = (
    patch: Partial<Extract<AnalysisTrigger, { kind: "schedule" }>>
  ) => {
    if (!scheduleTrigger) return;
    setTrigger({ ...scheduleTrigger, ...patch });
  };

  const patchConditions = (patch: {
    cooldownMin?: number;
    maxRunsPerDay?: number;
    /** null clears the window; an absent key leaves it alone. */
    quietHours?: { start: string; end: string } | null;
  }) => {
    const next: AnalysisConditions = {
      cooldownMin: patch.cooldownMin ?? conditions.cooldownMin,
      maxRunsPerDay: patch.maxRunsPerDay ?? conditions.maxRunsPerDay
    };
    const window =
      patch.quietHours === undefined ? conditions.quietHours : patch.quietHours;
    if (window) {
      next.quietHours = window;
    }
    onChange({ ...draft, conditions: next });
  };

  return (
    <>
      <label className="chat-local-field">
        <span>Run it</span>
        <OptionGroup
          label="Run it"
          mode="dropdown"
          size="md"
          value={trigger?.kind ?? "manual"}
          options={[
            { value: "manual", label: "Only when I ask" },
            { value: "activity", label: "After a new activity" },
            { value: "schedule", label: "On a schedule" },
            { value: "threshold", label: "When a metric crosses a threshold" }
          ]}
          disabled={disabled}
          onChange={(kind) => setTrigger(blankTrigger(kind))}
        />
      </label>

      {!trigger ? (
        <p className="coach-analysis-hint">
          It sits in this conversation and runs when you press Run now. Give it
          a trigger whenever you want it to speak on its own — you can come back
          to this at any time.
        </p>
      ) : null}

      {thresholdTrigger ? (
        <fieldset className="coach-analysis-fieldset" disabled={disabled}>
          <legend>Fires on a transition</legend>
          <div className="coach-analysis-row">
            <label className="chat-local-field">
              <span>Metric</span>
              <OptionGroup
                label="Metric"
                mode="dropdown"
                size="md"
                value={thresholdTrigger.metric}
                options={THRESHOLD_METRIC_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label
                }))}
                onChange={(metric) =>
                  setTrigger({
                    kind: "threshold",
                    metric,
                    // The number means something different per metric — per
                    // cent, bpm, hours — so switching carries the metric's own
                    // starting point rather than the last one's number.
                    value: THRESHOLD_METRIC_DEFAULTS[metric]
                  })
                }
              />
            </label>
            <label className="chat-local-field">
              <span>{thresholdOption?.unit ?? "Threshold"}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={thresholdTrigger.value}
                onChange={(event) =>
                  setTrigger({
                    ...thresholdTrigger,
                    value: Number(event.target.value)
                  })
                }
              />
            </label>
          </div>
          {/* 3.3: it fires on the transition, which is the thing an athlete
              would otherwise have to discover by being surprised twice. */}
          <p className="chat-settings-copy">
            {thresholdOption?.hint} It speaks once when this becomes true, not
            every hour it stays true — and a trigger set today starts from where
            things already stand rather than announcing history.
          </p>
        </fieldset>
      ) : null}

      {scheduleTrigger ? (
        <fieldset className="coach-analysis-fieldset" disabled={disabled}>
          <legend>Fires on a schedule</legend>
          <div className="coach-analysis-row">
            <label className="chat-local-field">
              <span>Repeats</span>
              <OptionGroup
                label="Repeats"
                size="md"
                fill
                value={scheduleTrigger.cadence}
                options={[
                  { value: "daily", label: "Every day" },
                  { value: "weekly", label: "Every week" }
                ]}
                onChange={(cadence) =>
                  // Rebuilt rather than merged: a daily trigger carries no
                  // `dayOfWeek`, and leaving a stale one behind would make the
                  // form read as edited after a save that dropped it.
                  setTrigger(
                    cadence === "weekly"
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
                  )
                }
              />
            </label>
            {scheduleTrigger.cadence === "weekly" ? (
              <label className="chat-local-field">
                <span>Day</span>
                <OptionGroup
                  label="Day"
                  mode="dropdown"
                  size="md"
                  value={String(scheduleTrigger.dayOfWeek ?? 1)}
                  options={WEEKDAY_OPTIONS.map((day, index) => ({
                    value: String(index),
                    label: day
                  }))}
                  onChange={(day) => patchSchedule({ dayOfWeek: Number(day) })}
                />
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
          <p className="coach-analysis-hint">
            Your local time, and only while Heracles Records is running. A slot
            missed by more than a day is written off rather than delivered late.
          </p>
        </fieldset>
      ) : null}

      {activityTrigger ? (
        <fieldset className="coach-analysis-fieldset" disabled={disabled}>
          <legend>Fires after a new activity</legend>
          <OptionChips
            label="Sports that fire this analysis"
            values={activityTrigger.sportTypes.map(String)}
            options={SPORT_FILTER_OPTIONS.map((sport) => ({
              value: String(sport.value),
              label: sport.label
            }))}
            disabled={disabled}
            onToggle={(value) => {
              const sportType = Number(value);
              patchActivity({
                sportTypes: activityTrigger.sportTypes.includes(sportType)
                  ? activityTrigger.sportTypes.filter(
                      (entry) => entry !== sportType
                    )
                  : [...activityTrigger.sportTypes, sportType]
              });
            }}
          />
          <p className="coach-analysis-hint">
            {activityTrigger.sportTypes.length === 0
              ? "No sport selected means every sport."
              : `${activityTrigger.sportTypes.length} sport(s) selected.`}
          </p>
          <div className="coach-analysis-row">
            <label className="chat-local-field">
              <span>Minimum duration (min)</span>
              <input
                type="number"
                min={0}
                value={Math.round((activityTrigger.minDurationSec ?? 0) / 60)}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  patchActivity({
                    minDurationSec: minutes > 0 ? minutes * 60 : undefined
                  });
                }}
              />
            </label>
            <label className="chat-local-field">
              {/* The summary beside this field goes through `describeTrigger`,
                  which reads the athlete's unit — so a field fixed to km put
                  "Minimum distance (km) 5" next to "≥ 3.1 mi", one threshold
                  printed as two numbers. Stored in metres either way. */}
              <span>Minimum distance ({distanceUnit(unitSystem)})</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={
                  Math.round(
                    metersToDisplayDistance(
                      activityTrigger.minDistanceM ?? 0,
                      unitSystem
                    ) * 100
                  ) / 100
                }
                onChange={(event) => {
                  const entered = Number(event.target.value);
                  patchActivity({
                    minDistanceM:
                      entered > 0
                        ? Math.round(displayDistanceToMeters(entered, unitSystem))
                        : undefined
                  });
                }}
              />
            </label>
          </div>
          <label className="coach-analysis-switch">
            <input
              type="checkbox"
              checked={activityTrigger.multiActivity === true}
              onChange={(event) =>
                patchActivity({ multiActivity: event.target.checked })
              }
            />
            <span>Analyse every new activity</span>
          </label>
          <p className="coach-analysis-hint">
            {activityTrigger.multiActivity
              ? "Every matching activity since the last analysis is analysed, one run each, oldest first."
              : "Only the most recent matching activity is analysed, however many piled up."}
          </p>
        </fieldset>
      ) : null}

      {/* Guard rails and the sync choice are both about a trigger, so both
          disappear with it. A manual analysis has no rhythm to limit and no
          schedule that could belong to one machine rather than another. */}
      {trigger ? (
        <>
          <fieldset className="coach-analysis-fieldset" disabled={disabled}>
            <legend>Guard rails</legend>
            <div className="coach-analysis-row">
              <label className="chat-local-field">
                <span>Cooldown (min)</span>
                <input
                  type="number"
                  min={0}
                  value={conditions.cooldownMin}
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
                  value={conditions.maxRunsPerDay}
                  onChange={(event) =>
                    patchConditions({
                      maxRunsPerDay: Number(event.target.value)
                    })
                  }
                />
              </label>
            </div>
            <label className="coach-analysis-switch">
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
              <div className="coach-analysis-row">
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
                        quietHours: {
                          ...quietHours,
                          end: event.target.value || "06:00"
                        }
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
            <p className="coach-analysis-hint">
              {quietHours
                ? "A scheduled run inside this window waits until it closes. An activity run is skipped instead — the activity is not going anywhere, and the next poll picks it up."
                : "Runs are allowed at any hour."}
            </p>
          </fieldset>

          <fieldset className="coach-analysis-fieldset" disabled={disabled}>
            <legend>Sync</legend>
            <label className="coach-analysis-switch">
              <input
                type="checkbox"
                checked={draft.deviceOnly}
                onChange={(event) =>
                  onChange({ ...draft, deviceOnly: event.target.checked })
                }
              />
              <span>This device only</span>
            </label>
            <p className="coach-analysis-hint">
              {draft.deviceOnly
                ? "The trigger stays on this computer — it is not synced and not written into a backup. Your other machines still see the analysis in this conversation, as a manual one."
                : "The trigger is synced, so this analysis runs on whichever of your machines is awake. Turn this on to keep the schedule to this computer."}
            </p>
          </fieldset>
        </>
      ) : null}
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
 * away and back deliberately resets rather than remembering: the kinds share no
 * fields, so there is nothing to preserve.
 */
function blankTrigger(kind: string): AnalysisTrigger | null {
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
  return null;
}

/**
 * A starting number per metric, because the number is a different quantity in
 * each: a 30 that means "per cent over the 4-week average" is nonsense as
 * "bpm above baseline".
 */
const THRESHOLD_METRIC_DEFAULTS: Record<AnalysisThresholdMetric, number> = {
  acuteChronicRamp: 30,
  restingHrDrift: 5,
  planAdherence: 24,
  sleepDebt: 5
};
