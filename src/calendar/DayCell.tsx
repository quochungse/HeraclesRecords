import { Check, GripVertical, Plus } from "lucide-react";
import { useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatUpcomingWorkoutVolumeDisplay
} from "../training/formatters";
import { sportColorCategory } from "../training/sportColors";
import { isSwimSportType } from "../training/sportTypes";
import {
  CALENDAR_DRAG_MIME,
  createCalendarDragPayload,
  parseCalendarDragPayload,
  type CalendarDragPayload
} from "./calendarDrag";
import type {
  CalendarDay,
  PlannedActualPair,
  PlannedTargets
} from "./calendarTypes";
import {
  formatStepDistanceLabel,
  formatStepTimeLabel
} from "./scheduledStructure";
import { dayNumber } from "./dateUtils";
import {
  scheduledSportCategory,
  scheduledWorkoutSport
} from "../training/workoutSport";

interface DayCellProps {
  day: CalendarDay;
  mode: "month" | "week";
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  isScheduledSelected: (entry: TrainingHubScheduledWorkoutEntry) => boolean;
  onAdd: (dateKey: string) => void;
  onDropEntry: (payload: CalendarDragPayload, targetDay: string) => void;
  selectionMode: boolean;
  busy: boolean;
}

// Color a completed activity chip by sport, matching the training heatmap.
function sportClass(activity: TrainingHubActivity): string {
  return `calendar-sport-${sportColorCategory(activity.sportType)}`;
}

/**
 * A planned chip is coloured by the sport it prescribes, the same way a
 * completed one is coloured by the sport that was done — so one colour means
 * one thing across the grid.
 *
 * It used to be coloured by `inferUpcomingWorkoutCategory`, an English
 * run-vocabulary regex over the workout's *name* that answers "Run" for
 * everything it does not recognise. A strength session called "Push Day", and
 * every workout named in any other language, wore the running colour; the
 * completed chip beside it wore the real one.
 */
function scheduledSportClass(
  entry: TrainingHubScheduledWorkoutEntry
): string | undefined {
  const category = scheduledSportCategory(entry.sportType);
  return category ? `calendar-sport-${category}` : undefined;
}

/**
 * Bands for the planned-vs-actual badge. Over-completion gets a band of its
 * own: three times a prescribed easy run is not "done", and reading it as
 * complete hid exactly the sessions worth a second look.
 */
function completionTone(pct?: number): string {
  if (pct === undefined) {
    return "";
  }
  if (pct > 115) {
    return "is-over";
  }
  if (pct >= 90) {
    return "is-complete";
  }
  if (pct >= 50) {
    return "is-partial";
  }
  return "is-missed";
}

/**
 * Actual first, planned second — everywhere. The paired chip used to print
 * `actual / planned` while the missed chip printed `planned / 0`, so the same
 * slash meant opposite things two rows apart.
 *
 * The unit is said once and the word "planned" not at all: a day cell is
 * ~150px wide, so `157 TL / 157 TL planned` wrapped to three lines and pushed
 * the whole week's row taller. What the second figure is gets said by the
 * chip's own dashed edge and by its tooltip instead of by a word on every row.
 */
function loadLine(actual: number | undefined, planned: number | undefined): string | null {
  if (actual === undefined && planned === undefined) {
    return null;
  }
  if (planned === undefined) {
    return `${Math.round(actual ?? 0)} TL`;
  }
  return `${Math.round(actual ?? 0)} / ${Math.round(planned)} TL`;
}

/**
 * What the plan asks for, on a chip.
 *
 * COROS's `volume` string reports a step count whenever a program has more
 * than one step, so a 13 km long run built as warm-up, main and cool-down read
 * "3 set(s)". The steps are asked first and the string is kept for a strength
 * workout, where sets really are the volume.
 */
function plannedVolumeLine(
  targets: PlannedTargets,
  volume: string | undefined,
  unitSystem: UnitSystem,
  swim: boolean
): string {
  if (targets.distanceMeters) {
    return formatStepDistanceLabel(targets.distanceMeters, unitSystem, swim);
  }
  if (targets.durationSeconds) {
    return formatStepTimeLabel(targets.durationSeconds);
  }
  return formatUpcomingWorkoutVolumeDisplay(volume, unitSystem);
}

function activityStatsLine(
  activity: TrainingHubActivity,
  unitSystem: UnitSystem
): string {
  const parts: string[] = [];
  if (activity.duration) {
    parts.push(formatDurationSeconds(activity.duration));
  }
  if (activity.distance) {
    parts.push(
      formatDistanceMeters(
        activity.distance,
        unitSystem,
        isSwimSportType(activity.sportType)
      )
    );
  }
  return parts.join(" · ");
}

function PairChip({
  pair,
  day,
  busy,
  selectionMode,
  selected,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled
}: {
  pair: PlannedActualPair;
  day: CalendarDay;
  busy: boolean;
  selectionMode: boolean;
  selected: boolean;
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const { scheduled, activity } = pair;
  const selectable = selectionMode && !day.isPast;

  if (activity) {
    // Completed: lead with the actual activity, show planned vs actual load.
    const plannedLoad = scheduled.trainingLoad;
    const actualLoad = activity.trainingLoad;
    return (
      <button
        type="button"
        className={[
          "calendar-chip",
          "calendar-chip-paired",
          sportClass(activity),
          selectable && "is-selection-enabled",
          selected && "is-selected",
          selectionMode && !selectable && "is-selection-unavailable"
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() =>
          selectable ? onToggleScheduled(scheduled) : onSelectActivity(activity)
        }
        disabled={selectionMode && !selectable}
        aria-pressed={selectable ? selected : undefined}
        title={
          selectable
            ? `${selected ? "Deselect" : "Select"} ${scheduled.name}`
            : `${scheduled.name} — planned vs actual`
        }
      >
        {selectable ? (
          <span className="calendar-chip-selector" aria-hidden="true">
            {selected ? <Check size={12} strokeWidth={3} /> : null}
          </span>
        ) : null}
        <span className="calendar-chip-title">
          <span className="calendar-chip-name">{activity.name ?? scheduled.name}</span>
          {pair.completionPct !== undefined ? (
            <span
              className={`calendar-chip-badge ${completionTone(pair.completionPct)}`}
              title={`${pair.completionPct}% of the planned session`}
            >
              {Math.min(pair.completionPct, 999)}%
            </span>
          ) : null}
        </span>
        <span className="calendar-chip-meta">{activityStatsLine(activity, unitSystem)}</span>
        {loadLine(actualLoad, plannedLoad) ? (
          <span
            className="calendar-chip-meta calendar-chip-load"
            title={
              plannedLoad === undefined
                ? "Training load"
                : `${Math.round(actualLoad ?? 0)} TL done of ${Math.round(plannedLoad)} TL planned`
            }
          >
            {loadLine(actualLoad, plannedLoad)}
          </span>
        ) : null}
      </button>
    );
  }

  // Planned only. Past days show the COROS-style "0 TL" miss.
  const missed = day.isPast;
  const canDrag = !day.isPast && !busy && !selectionMode;

  return (
    <button
      type="button"
      className={[
        "calendar-chip",
        "calendar-chip-planned",
        scheduledSportClass(scheduled),
        missed && "is-missed",
        selectable && "is-selection-enabled",
        selected && "is-selected",
        selectionMode && !selectable && "is-selection-unavailable"
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag) {
          event.preventDefault();
          return;
        }
        const payload = createCalendarDragPayload(scheduled);
        event.dataTransfer.setData(CALENDAR_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.setData("text/plain", scheduled.name);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() =>
        selectable ? onToggleScheduled(scheduled) : onSelectScheduled(scheduled)
      }
      disabled={selectionMode && !selectable}
      aria-pressed={selectable ? selected : undefined}
      title={
        selectable
          ? `${selected ? "Deselect" : "Select"} ${scheduled.name}`
          : missed
            ? `${scheduled.name} — planned, nothing logged`
            : canDrag
              ? `${scheduled.name} — planned. Drag to another day.`
              : `${scheduled.name} — planned`
      }
      /* The dashed edge is what says "planned" on screen, and a border says
         nothing to a screen reader, so the word lives here instead. */
      aria-label={
        selectable
          ? `${selected ? "Deselect" : "Select"} planned workout ${scheduled.name}`
          : canDrag
            ? `Planned: ${scheduled.name}. Drag to another day to reschedule.`
            : `Planned: ${scheduled.name}`
      }
    >
      {selectable ? (
        <span className="calendar-chip-selector" aria-hidden="true">
          {selected ? <Check size={12} strokeWidth={3} /> : null}
        </span>
      ) : null}
      <span className="calendar-chip-title">
        <span className="calendar-chip-name">{scheduled.name}</span>
      </span>
      <span className="calendar-chip-meta">
        {plannedVolumeLine(
          pair.targets,
          scheduled.volume,
          unitSystem,
          // A program sport code, not an activity code: swim is 3 here.
          scheduledWorkoutSport(scheduled.sportType) === "swim"
        )}
        {scheduled.trainingLoad !== undefined && !missed
          ? ` · ${Math.round(scheduled.trainingLoad)} TL`
          : ""}
      </span>
      {missed && scheduled.trainingLoad !== undefined ? (
        <span className="calendar-chip-meta calendar-chip-load">
          {loadLine(0, scheduled.trainingLoad)}
        </span>
      ) : null}
      {canDrag ? (
        <GripVertical
          className="calendar-chip-drag-handle"
          size={14}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

export function DayCell({
  day,
  mode,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled,
  isScheduledSelected,
  onAdd,
  onDropEntry,
  selectionMode,
  busy
}: DayCellProps) {
  const { unitSystem } = useUnitSystem();
  const [dropTarget, setDropTarget] = useState(false);
  const canReceiveDrop = !day.isPast && !busy && !selectionMode;

  return (
    <div
      className={[
        "calendar-day",
        mode === "week" && "calendar-day-week",
        !day.inMonth && "is-outside",
        day.isToday && "is-today",
        day.isPast && "is-past",
        dropTarget && "is-drop-target"
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={(event) => {
        if (
          !canReceiveDrop ||
          !Array.from(event.dataTransfer.types).includes(CALENDAR_DRAG_MIME)
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(true);
      }}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setDropTarget(false);
      }}
      onDrop={(event) => {
        setDropTarget(false);
        if (!canReceiveDrop) {
          return;
        }
        const raw = event.dataTransfer.getData(CALENDAR_DRAG_MIME);
        if (!raw) {
          return;
        }
        event.preventDefault();
        const payload = parseCalendarDragPayload(raw);
        if (payload) {
          onDropEntry(payload, day.dateKey);
        }
      }}
    >
      <div className="calendar-day-head">
        <span className="calendar-day-number">
          {day.isToday ? `Today ${String(dayNumber(day.dateKey)).padStart(2, "0")}` : dayNumber(day.dateKey)}
        </span>
        <button
          type="button"
          className="calendar-day-add"
          onClick={() => onAdd(day.dateKey)}
          disabled={busy || selectionMode}
          title={day.isPast ? "Log activity" : "Add workout"}
          aria-label={`${day.isPast ? "Log activity" : "Add workout"} on ${day.dateKey}`}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="calendar-day-items">
        {day.pairs.map((pair) => (
          <PairChip
            key={`pair-${pair.scheduled.planId}-${pair.scheduled.idInPlan}`}
            pair={pair}
            day={day}
            busy={busy}
            selectionMode={selectionMode}
            selected={isScheduledSelected(pair.scheduled)}
            onSelectScheduled={onSelectScheduled}
            onSelectActivity={onSelectActivity}
            onToggleScheduled={onToggleScheduled}
          />
        ))}
        {day.unplannedActivities.map((activity) => (
          <button
            key={`activity-${activity.activityId}`}
            type="button"
            className={[
              "calendar-chip",
              "calendar-chip-activity",
              sportClass(activity),
              selectionMode && "is-selection-unavailable"
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelectActivity(activity)}
            disabled={selectionMode}
            title={activity.name ?? activity.sportName ?? "Activity"}
          >
            <span className="calendar-chip-title">
              <span className="calendar-chip-name">
                {activity.name ?? activity.sportName ?? "Activity"}
              </span>
            </span>
            <span className="calendar-chip-meta">{activityStatsLine(activity, unitSystem)}</span>
            {activity.trainingLoad !== undefined ? (
              <span className="calendar-chip-meta calendar-chip-load">
                {Math.round(activity.trainingLoad)} TL
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
