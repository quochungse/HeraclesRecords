import { Check, Link2, SkipForward, Undo2 } from "lucide-react";
import { useState } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { SelectDropdown } from "../components/SelectDropdown";
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";
import { t } from "../i18n/core";

interface PlanStatusBlockProps {
  api: HeraclesRecordsApi;
  day: CalendarDay;
  pair: PlannedActualPair;
  /** Re-reads the range, so the override the athlete just made is on screen. */
  onChanged: () => void;
  onError: (message: string | null) => void;
}

function activityLabel(activity: TrainingHubActivity): string {
  const name = activity.name ?? activity.sportName ?? t("activity.untitled");
  const minutes = activity.duration ? t("units.min", { m: Math.round(activity.duration / 60) }) : null;
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
    { value: "", label: t("calendar.match.nothing") },
    ...day.activities.map((activity) => ({
      value: activity.activityId,
      label: activityLabel(activity)
    }))
  ];

  return (
    <section className="calendar-plan-status" aria-label={t("calendar.match.label")}>
      <header>
        <span className="calendar-plan-status-icon" aria-hidden="true">
          {pair.activity ? <Check size={14} /> : <Link2 size={14} />}
        </span>
        <span>
          <strong>
            {pair.activity
              ? t("calendar.match.answered")
              : day.isPast
                ? t("calendar.match.noMatch")
                : t("calendar.match.notYet")}
          </strong>
          <small>
            {day.activities.length
              ? t("calendar.match.pick")
              : t("calendar.match.noActivity")}
          </small>
        </span>
      </header>

      {day.activities.length ? (
        <SelectDropdown
          className="calendar-plan-status-pick"
          label={t("calendar.match.pickLabel")}
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
          <SkipForward size={14} aria-hidden="true" /> {t("calendar.match.skip")}
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={saving}
          title={t("calendar.match.autoTitle")}
          onClick={() =>
            void save({ status: day.isPast ? "missed" : "upcoming" }, false)
          }
        >
          <Undo2 size={14} aria-hidden="true" /> {t("calendar.match.auto")}
        </button>
      </div>
    </section>
  );
}
