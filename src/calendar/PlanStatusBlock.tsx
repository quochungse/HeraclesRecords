import { Check } from "lucide-react";
import type { TrainingHubActivity } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { SelectDropdown } from "../components/SelectDropdown";
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";
import { t } from "../i18n/core";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { completionLine } from "./PlanCompletion";

interface PlanStatusBlockProps {
  api: HeraclesRecordsApi;
  day: CalendarDay;
  pair: PlannedActualPair;
  /** Re-reads the range, so the link the athlete just made is on screen. */
  onChanged: () => void;
  onError: (message: string | null) => void;
}

function activityLabel(activity: TrainingHubActivity): string {
  const name = activity.name ?? activity.sportName ?? t("activity.untitled");
  const minutes = activity.duration ? t("units.min", { m: Math.round(activity.duration / 60) }) : null;
  return minutes ? `${name} · ${minutes}` : name;
}

/**
 * The activity that answered this planned session, how much of the plan it
 * covered, and the way to say the pairing got it wrong: another of the day's
 * activities, or none of them. Drawn only once the session has an activity;
 * one not done has nothing to say here.
 *
 * A pick is durable (`saveManualActivityMatch` stores it against the session,
 * over the matcher's own row), and `pairPlannedWithActual` honours it ahead of
 * COROS's link and its own guess, so the calendar does not quietly overrule
 * what the athlete said on the next reload.
 */
export function PlanStatusBlock({
  api,
  day,
  pair,
  onChanged,
  onError
}: PlanStatusBlockProps) {
  const { unitSystem } = useUnitSystem();
  if (!pair.activity) return null;
  const completion = completionLine(pair, unitSystem);

  const save = async (activityId: string | undefined) => {
    try {
      const activity = activityId
        ? day.activities.find((item) => item.activityId === activityId)
        : undefined;
      await api.saveManualActivityMatch({
        id: `${pair.scheduled.planId}:${pair.scheduled.idInPlan}`,
        schedulePlanId: pair.scheduled.planId,
        scheduleIdInPlan: pair.scheduled.idInPlan,
        happenDay: pair.scheduled.happenDay,
        activityId,
        // Clearing the pick is still a statement — "none of these was it" —
        // or the matcher would put its own guess straight back.
        status: activity ? "completed" : day.isPast ? "missed" : "upcoming",
        confidence: activity ? 1 : undefined,
        manual: true,
        plannedTrainingLoad: pair.scheduled.trainingLoad,
        completedDurationSeconds: activity?.duration,
        completedDistanceMeters: activity?.distance,
        completedTrainingLoad: activity?.trainingLoad,
        plannedHeraclesLoad: pair.scheduled.heraclesLoad?.value,
        completedHeraclesLoad: activity?.heraclesLoad?.value,
        updatedAt: new Date().toISOString()
      });
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
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
          <Check size={14} />
        </span>
        <span>
          <strong>{t("calendar.match.answered")}</strong>
          {completion ? <small title={completion.note}>{completion.text}</small> : null}
          <small>{t("calendar.match.pick")}</small>
        </span>
      </header>

      <SelectDropdown
        className="calendar-plan-status-pick"
        label={t("calendar.match.pickLabel")}
        value={pair.activity.activityId}
        options={options}
        portal
        onChange={(value) => void save(value || undefined)}
      />
    </section>
  );
}
