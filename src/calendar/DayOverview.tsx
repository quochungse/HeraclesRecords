import { Activity, ChevronRight } from "lucide-react";
import type { TrainingHubActivity, UnitSystem } from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatUpcomingWorkoutVolumeDisplay
} from "../training/formatters";
import { isSwimSportType } from "../training/sportTypes";
import { scheduledWorkoutSport } from "../training/workoutSport";
import { activityWorkoutSport } from "../training/askCoachAbout";
import { sportChipStyle, sportTheme } from "../training-library/sportTheme";
import { dayItems, type CalendarDay, type CalendarItemSelection } from "./calendarTypes";
import { formatPlannedVolume } from "./scheduledStructure";
import { t } from "../i18n/core";

function activityLine(activity: TrainingHubActivity, unitSystem: UnitSystem): string {
  return [
    activity.duration ? formatDurationSeconds(activity.duration) : undefined,
    activity.distance ? formatDistanceMeters(activity.distance, unitSystem, isSwimSportType(activity.sportType)) : undefined,
    activity.trainingLoad !== undefined ? t("units.trainingLoadShort", { value: Math.round(activity.trainingLoad) }) : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A day with more than one thing on it, read as a whole (UAT): what was done
 * and what was planned, each a row that opens as its chip does, with the
 * day's totals above them.
 */
export function DayOverview({
  day,
  onOpen
}: {
  day: CalendarDay;
  onOpen: (item: CalendarItemSelection) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const items = dayItems(day);
  const done = day.activities;
  const planned = day.scheduled.length;
  const seconds = done.reduce((sum, activity) => sum + (activity.duration ?? 0), 0);
  const meters = done.reduce((sum, activity) => sum + (activity.distance ?? 0), 0);
  const load = done.reduce((sum, activity) => sum + (activity.trainingLoad ?? 0), 0);
  const totals = [
    done.length ? t("calendar.overview.done", { count: done.length }) : undefined,
    planned ? t("calendar.overview.planned", { count: planned }) : undefined,
    seconds ? formatDurationSeconds(seconds) : undefined,
    meters ? formatDistanceMeters(meters, unitSystem) : undefined,
    load ? t("units.trainingLoadShort", { value: Math.round(load) }) : undefined
  ].filter(Boolean);

  return (
    <div className="calendar-day-overview">
      {totals.length ? <p className="calendar-day-overview-totals">{totals.join(" · ")}</p> : null}
      <ul className="calendar-day-overview-list">
        {items.map((item) => {
          const key = item.kind === "activity" ? `a:${item.activity.activityId}` : `s:${item.entry.planId}:${item.entry.idInPlan}`;
          const pair =
            item.kind === "scheduled"
              ? day.pairs.find((candidate) => candidate.scheduled === item.entry)
              : day.pairs.find((candidate) => candidate.activity === item.activity);
          const sport =
            item.kind === "activity" ? activityWorkoutSport(item.activity.sportType) : scheduledWorkoutSport(item.entry.sportType);
          const Icon = sport ? sportTheme(sport).icon : Activity;
          const name =
            item.kind === "activity"
              ? item.activity.name ?? pair?.scheduled.name ?? item.activity.sportName ?? t("activity.untitled")
              : item.entry.name;
          const line =
            item.kind === "activity"
              ? activityLine(item.activity, unitSystem)
              : [
                  formatPlannedVolume(pair?.targets ?? {}, unitSystem, sport === "swim", () =>
                    formatUpcomingWorkoutVolumeDisplay(item.entry.volume, unitSystem)
                  ),
                  item.entry.trainingLoad !== undefined ? t("units.trainingLoadShort", { value: Math.round(item.entry.trainingLoad) }) : undefined
                ]
                  .filter(Boolean)
                  .join(" · ");
          const status =
            item.kind === "activity"
              ? pair
                ? { label: t("calendar.status.done"), tone: "done" }
                : { label: t("calendar.status.unplanned"), tone: "extra" }
              : day.isPast
                ? { label: t("calendar.status.missed"), tone: "missed" }
                : { label: t("calendar.status.planned"), tone: "planned" };
          return (
            <li key={key}>
              <button type="button" className="calendar-day-overview-item" onClick={() => onOpen(item)}>
                <span className="calendar-day-overview-icon" style={sportChipStyle(sport)} aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="calendar-day-overview-text">
                  <strong>{name}</strong>
                  {line ? <small>{line}</small> : null}
                </span>
                <span className="calendar-day-overview-status" data-tone={status.tone}>
                  {status.label}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="calendar-day-overview-chevron" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
