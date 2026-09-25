import { Check, Link2, SkipForward, Undo2 } from "lucide-react";
import { useState } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown } from "../components/SelectDropdown";
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";

interface PlanStatusBlockProps {
  api: CorosLinkApi;
  day: CalendarDay;
  pair: PlannedActualPair;
  /** Re-reads the range, so the override the athlete just made is on screen. */
  onChanged: () => void;
  onError: (message: string | null) => void;
}

function activityLabel(activity: TrainingHubActivity): string {
  const name = activity.name ?? activity.sportName ?? "Activity";
  const minutes = activity.duration ? `${Math.round(activity.duration / 60)} min` : null;
  return minutes ? `${name} · ${minutes}` : name;
}

/**
 * What actually answered this planned session — and the two ways to say the
 * pairing got it wrong.
 *
 * This is where the Adherence tab's one irreplaceable capability went. Its
 * other three were duplicates: rescheduling is drag-and-drop on this calendar
 * already, its compliance figure now sits on the plan's own row, and its
 * "Recent activities" panel sent the reader to the Activities screen in its
 * own subtitle. Linking an activity by hand and marking a session skipped had
 * nowhere else to live — and this is the right home, because the planned
 * session and the day's activities are both already here.
 *
 * A manual choice is durable (`saveManualActivityMatch` stores it against the
 * session, over the matcher's own row), and `pairPlannedWithActual` honours it
 * ahead of its own greedy pass, so the calendar does not quietly overrule what
 * the athlete said on the next reload. "Match automatically" saves it with
 * `manual: false`, which hands the session back to the matcher.
 */
export function PlanStatusBlock({
  api,
  day,
  pair,
  onChanged,
  onError
}: PlanStatusBlockProps) {
  const [saving, setSaving] = useState(false);

  const save = async (
    patch: { activityId?: string; status: "completed" | "skipped" | "missed" | "upcoming" },
    manual: boolean
  ) => {
    setSaving(true);
    try {
      const activity = patch.activityId
        ? day.activities.find((item) => item.activityId === patch.activityId)
        : undefined;
      await api.saveManualActivityMatch({
        id: `${pair.scheduled.planId}:${pair.scheduled.idInPlan}`,
        schedulePlanId: pair.scheduled.planId,
        scheduleIdInPlan: pair.scheduled.idInPlan,
        happenDay: pair.scheduled.happenDay,
        activityId: patch.activityId,
        status: patch.status,
        confidence: activity ? 1 : undefined,
        manual,
        plannedTrainingLoad: pair.scheduled.trainingLoad,
        completedDurationSeconds: activity?.duration,
        completedDistanceMeters: activity?.distance,
        completedTrainingLoad: activity?.trainingLoad,
        updatedAt: new Date().toISOString()
      });
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const options = [
    { value: "", label: "Nothing yet" },
    ...day.activities.map((activity) => ({
      value: activity.activityId,
      label: activityLabel(activity)
    }))
  ];

  return (
    <section className="calendar-plan-status" aria-label="Plan status">
      <header>
        <span className="calendar-plan-status-icon" aria-hidden="true">
          {pair.activity ? <Check size={14} /> : <Link2 size={14} />}
        </span>
        <span>
          <strong>
            {pair.activity
              ? "Answered by"
              : day.isPast
                ? "Nothing matched this session"
                : "Not done yet"}
          </strong>
          <small>
            {day.activities.length
              ? "Pick the activity that was this session, if the match is wrong."
              : "No activity was recorded on this day."}
          </small>
        </span>
      </header>

      {day.activities.length ? (
        <SelectDropdown
          className="calendar-plan-status-pick"
          label="Activity that answered this session"
          value={pair.activity?.activityId ?? ""}
          options={options}
          portal
          onChange={(value) =>
            void save(
              value
                ? { activityId: value, status: "completed" }
                : { status: day.isPast ? "missed" : "upcoming" },
              /*
               * Clearing the pick is still a manual statement — "none of these
               * was it" — or the greedy pass would put its own guess straight
               * back on the next reload.
               */
              true
            )
          }
        />
      ) : null}

      <div className="calendar-plan-status-actions">
        <button
          type="button"
          className="ghost-button"
          disabled={saving}
          onClick={() => void save({ status: "skipped" }, true)}
        >
          <SkipForward size={14} aria-hidden="true" /> Mark skipped
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={saving}
          title="Forget what was said here and let the calendar match it again"
          onClick={() =>
            void save({ status: day.isPast ? "missed" : "upcoming" }, false)
          }
        >
          <Undo2 size={14} aria-hidden="true" /> Match automatically
        </button>
      </div>
    </section>
  );
}
