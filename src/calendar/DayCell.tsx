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
  formatHappenDayLabel,
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
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";
import { formatPlannedVolume } from "./scheduledStructure";
import { dayNumber } from "./dateUtils";
import { DaySkeletonChips } from "./CalendarSkeleton";
import {
  scheduledSportCategory,
  scheduledWorkoutSport
} from "../training/workoutSport";

import { t } from "../i18n/core";
interface DayCellProps {
  day: CalendarDay;
  mode: "month" | "week";
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  isScheduledSelected: (entry: TrainingHubScheduledWorkoutEntry) => boolean;
  onAdd: (dateKey: string) => void;
  /** Opens the day: the one thing on it, or the day as a whole (UAT). */
  onSelectDay: () => void;
  onDropEntry: (payload: CalendarDragPayload, targetDay: string) => void;
  selectionMode: boolean;
  busy: boolean;
  /**
   * Set while the range has not been read: the day draws stand-in chips,
   * their shimmer started this many milliseconds into the wave.
   */
  placeholderDelayMs?: number;
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
    return t("units.trainingLoadShort", { value: Math.round(actual ?? 0) });
  }
  return t("calendar.loadOf", { actual: Math.round(actual ?? 0), planned: Math.round(planned) });
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
    const pairedLoadLine = loadLine(actualLoad, plannedLoad);
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
            ? t(selected ? "calendar.chip.deselect" : "calendar.chip.select", { name: scheduled.name })
            : t("calendar.chip.plannedVsActual", { name: scheduled.name })
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
              title={t("calendar.chip.completion", { percent: pair.completionPct })}
            >
              {Math.min(pair.completionPct, 999)}%
            </span>
          ) : null}
        </span>
        <span className="calendar-chip-meta">{activityStatsLine(activity, unitSystem)}</span>
        {pairedLoadLine ? (
          <span
            className="calendar-chip-meta calendar-chip-load"
            title={
              plannedLoad === undefined
                ? t("activity.m.trainingLoad")
                : t("calendar.chip.loadDone", { actual: Math.round(actualLoad ?? 0), planned: Math.round(plannedLoad) })
            }
          >
            {pairedLoadLine}
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
          ? t(selected ? "calendar.chip.deselect" : "calendar.chip.select", { name: scheduled.name })
          : missed
            ? t("calendar.chip.missed", { name: scheduled.name })
            : canDrag
              ? t("calendar.chip.drag", { name: scheduled.name })
              : t("calendar.chip.planned", { name: scheduled.name })
      }
      /* The dashed edge is what says "planned" on screen, and a border says
         nothing to a screen reader, so the word lives here instead. */
      aria-label={
        selectable
          ? t(selected ? "calendar.chip.deselectPlanned" : "calendar.chip.selectPlanned", { name: scheduled.name })
          : canDrag
            ? t("calendar.chip.plannedDragLabel", { name: scheduled.name })
            : t("calendar.chip.plannedLabel", { name: scheduled.name })
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
        {/* The same figures the scheduled detail shows under "Volume", so a
            chip and the panel it opens cannot disagree about what was asked
            for. COROS's own `volume` string is the fallback, and only that:
            it reports a step count whenever a program has more than one step,
            so a 13 km long run built as warm-up, main and cool-down reads
            "3 set(s)" — right for a strength session, wrong for that run. */}
        {formatPlannedVolume(
          pair.targets,
          unitSystem,
          // A program sport code, not an activity code: swim is 3 here.
          scheduledWorkoutSport(scheduled.sportType) === "swim",
          () => formatUpcomingWorkoutVolumeDisplay(scheduled.volume, unitSystem)
        )}
        {scheduled.trainingLoad !== undefined && !missed
          ? ` · ${t("units.trainingLoadShort", { value: String(Math.round(scheduled.trainingLoad)) })}`
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
  onSelectDay,
  onDropEntry,
  selectionMode,
  busy,
  placeholderDelayMs
}: DayCellProps) {
  const { unitSystem } = useUnitSystem();
  const [dropTarget, setDropTarget] = useState(false);
  const canReceiveDrop = !day.isPast && !busy && !selectionMode;
  /* Only a day with something on it opens (UAT); an empty one has nothing to
     show but its + button. */
  const opens = !selectionMode && day.pairs.length + day.unplannedActivities.length > 0;
  /* A day that already holds something (a week shared with the month before,
     still on screen) shows it; only an empty one waits. */
  const waiting =
    placeholderDelayMs !== undefined &&
    day.pairs.length + day.unplannedActivities.length === 0;

  return (
    <div
      className={[
        "calendar-day",
        mode === "week" && "calendar-day-week",
        !day.inMonth && "is-outside",
        day.isToday && "is-today",
        day.isPast && "is-past",
        dropTarget && "is-drop-target",
        opens && "is-openable"
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        // A chip or a button inside the cell answers its own press.
        if (!opens || (event.target as HTMLElement).closest("button")) return;
        onSelectDay();
      }}
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
        {opens ? (
          <button
            type="button"
            className="calendar-day-number calendar-day-open"
            onClick={onSelectDay}
            aria-label={t("calendar.day.open", { day: formatHappenDayLabel(day.dateKey) })}
            title={t("calendar.day.openTitle")}
          >
            {day.isToday ? t("calendar.today", { day: String(dayNumber(day.dateKey)).padStart(2, "0") }) : dayNumber(day.dateKey)}
          </button>
        ) : (
          <span className="calendar-day-number">
            {day.isToday ? t("calendar.today", { day: String(dayNumber(day.dateKey)).padStart(2, "0") }) : dayNumber(day.dateKey)}
          </span>
        )}
        <button
          type="button"
          className="calendar-day-add"
          onClick={() => onAdd(day.dateKey)}
          disabled={busy || selectionMode}
          title={day.isPast ? t("calendar.day.log") : t("calendar.day.add")}
          aria-label={t(day.isPast ? "calendar.day.logOn" : "calendar.day.addOn", { day: formatHappenDayLabel(day.dateKey) })}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="calendar-day-items">
        {waiting ? (
          <DaySkeletonChips
            dateKey={day.dateKey}
            mode={mode}
            delayMs={placeholderDelayMs ?? 0}
          />
        ) : null}
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
            title={activity.name ?? activity.sportName ?? t("activity.untitled")}
          >
            <span className="calendar-chip-title">
              <span className="calendar-chip-name">
                {activity.name ?? activity.sportName ?? t("activity.untitled")}
              </span>
            </span>
            <span className="calendar-chip-meta">{activityStatsLine(activity, unitSystem)}</span>
            {activity.trainingLoad !== undefined ? (
              <span className="calendar-chip-meta calendar-chip-load">
                {t("units.trainingLoadShort", { value: Math.round(activity.trainingLoad) })}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
