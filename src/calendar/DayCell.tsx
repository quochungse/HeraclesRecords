import { Activity, Check, Mountain, Plus, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem,
  WorkoutSport
} from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue, metersToDisplayDistance } from "../units/units";
import {
  formatDurationSpan,
  formatHappenDayLabel,
  formatUpcomingWorkoutVolumeDisplay
} from "../training/formatters";
import { sportColorCategory, type SportColorCategory } from "../training/sportColors";
import { isSwimSportType } from "../training/sportTypes";
import { activityWorkoutSport } from "../training/askCoachAbout";
import { sportTheme } from "../training-library/sportTheme";
import {
  CALENDAR_DRAG_MIME,
  createCalendarDragPayload,
  parseCalendarDragPayload,
  type CalendarDragPayload
} from "./calendarDrag";
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";
import { dayNumber } from "./dateUtils";
import { DaySkeletonChips } from "./CalendarSkeleton";
import {
  scheduledSportCategory,
  scheduledWorkoutSport
} from "../training/workoutSport";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

interface DayCellProps {
  day: CalendarDay;
  mode: "month" | "week";
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  isScheduledSelected: (entry: TrainingHubScheduledWorkoutEntry) => boolean;
  onAdd: (dateKey: string) => void;
  /** Opens the day as a whole: a press anywhere in the cell but a card. */
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

/**
 * Cards a month cell shows before the rest fold into "+N more", which opens
 * the day. A week row is tall enough to hold every one.
 */
const MONTH_CARDS = 3;

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
 * The card's icon: the sport's own, as the day panel draws it. A hike has no
 * workout sport, so it is read off the colour group it is drawn in.
 */
function sportIcon(sport: WorkoutSport | undefined, category: SportColorCategory | undefined): LucideIcon {
  if (sport) return sportTheme(sport).icon;
  return category === "hiking" ? Mountain : Activity;
}

/**
 * A distance to a tenth, and whole when the tenth is nothing: "8 km", "8.6 km".
 * Under a twentieth it is left out rather than written "0 km": a gym session's
 * few metres of GPS drift are no distance.
 */
function cardDistance(meters: number | undefined, unitSystem: UnitSystem, swim: boolean): string | undefined {
  if (!meters) return undefined;
  if (swim) return formatDistanceValue(meters, unitSystem, { swim });
  const tenths = Math.round(metersToDisplayDistance(meters, unitSystem) * 10);
  if (tenths === 0) return undefined;
  return formatDistanceValue(meters, unitSystem, { digits: tenths % 10 === 0 ? 0 : 1 });
}

function activityAmounts(activity: TrainingHubActivity, unitSystem: UnitSystem): string[] {
  return [
    cardDistance(activity.distance, unitSystem, isSwimSportType(activity.sportType)),
    activity.duration ? formatDurationSpan(activity.duration) : undefined,
    activity.trainingLoad !== undefined ? t("units.trainingLoadShort", { value: Math.round(activity.trainingLoad) }) : undefined
  ].filter((part): part is string => Boolean(part));
}

/**
 * What the plan asked for: the steps' distance and COROS's own estimate of the
 * time, so a strength session says how long it runs rather than nothing.
 * COROS's `volume` string stands in only when both are missing — it reports a
 * step count whenever a program has more than one step, so a 13 km long run
 * built as warm-up, main and cool-down reads "3 set(s)".
 */
function plannedAmounts(pair: PlannedActualPair, unitSystem: UnitSystem, swim: boolean): string[] {
  const { distanceMeters, durationSeconds, expectedSeconds } = pair.targets;
  const seconds = expectedSeconds ?? (distanceMeters ? undefined : durationSeconds);
  const parts = [
    cardDistance(distanceMeters, unitSystem, swim),
    seconds ? formatDurationSpan(seconds) : undefined
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) {
    const volume = formatUpcomingWorkoutVolumeDisplay(pair.scheduled.volume, unitSystem);
    if (volume) parts.push(volume);
  }
  return parts;
}

interface CardView {
  key: string;
  name: string;
  meta: string;
  sport: WorkoutSport | undefined;
  category: SportColorCategory | undefined;
  kind: "done" | "planned" | "missed";
  completionPct?: number;
  pair?: PlannedActualPair;
  activity?: TrainingHubActivity;
}

/**
 * A day's cards, in the order the day panel lists them: each planned session —
 * as the activity that did it, when one did — then what no plan asked for.
 */
function dayCards(day: CalendarDay, unitSystem: UnitSystem): CardView[] {
  const planned = day.pairs.map((pair): CardView => {
    const { scheduled, activity } = pair;
    const key = `pair-${scheduled.planId}-${scheduled.idInPlan}`;
    if (activity) {
      return {
        key,
        name: activity.name ?? scheduled.name,
        meta: activityAmounts(activity, unitSystem).join(" · "),
        sport: activityWorkoutSport(activity.sportType),
        category: sportColorCategory(activity.sportType),
        kind: "done",
        completionPct: pair.completionPct,
        pair,
        activity
      };
    }
    // A program sport code, not an activity code: swim is 3 here.
    const sport = scheduledWorkoutSport(scheduled.sportType);
    const missed = day.isPast;
    const load = scheduled.trainingLoad;
    return {
      key,
      name: scheduled.name,
      meta: [
        missed ? t("calendar.card.missed") : t("calendar.card.plan"),
        ...plannedAmounts(pair, unitSystem, sport === "swim"),
        // The line opens with "Plan", so the load needs no second "planned":
        // with a distance and a time before it, that word cut the figure off.
        load === undefined
          ? undefined
          : missed
            ? t("calendar.loadOf", { actual: 0, planned: Math.round(load) })
            : t("units.trainingLoadShort", { value: Math.round(load) })
      ]
        .filter(Boolean)
        .join(" · "),
      sport,
      category: scheduledSportCategory(scheduled.sportType),
      kind: missed ? "missed" : "planned",
      pair
    };
  });
  const unplanned = day.unplannedActivities.map((activity): CardView => ({
    key: `activity-${activity.activityId}`,
    name: activity.name ?? activity.sportName ?? t("activity.untitled"),
    meta: activityAmounts(activity, unitSystem).join(" · "),
    sport: activityWorkoutSport(activity.sportType),
    category: sportColorCategory(activity.sportType),
    kind: "done",
    activity
  }));
  return [...planned, ...unplanned];
}

/**
 * A session is a card of two lines: its sport's icon and name, then distance ·
 * time · load. The right of the name is kept for a session that strayed from
 * its plan, so a chip there means something; one done as planned wears none.
 * A planned card is dashed, a missed one dashed in red and struck through, and
 * its first word says which, for whoever cannot see the edge.
 */
function SessionCard({
  card,
  day,
  busy,
  selectionMode,
  selected,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled
}: {
  card: CardView;
  day: CalendarDay;
  busy: boolean;
  selectionMode: boolean;
  selected: boolean;
  onSelectScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
}) {
  const scheduled = card.pair?.scheduled;
  // Only a session on the calendar can be selected, and only on a day to come.
  const selectable = selectionMode && Boolean(scheduled) && !day.isPast;
  const unavailable = selectionMode && !selectable;
  const canDrag = card.kind === "planned" && !busy && !selectionMode;
  const Icon = sportIcon(card.sport, card.category);
  const offPlan =
    card.completionPct !== undefined && (card.completionPct < 90 || card.completionPct > 115);

  const title = selectable
    ? t(selected ? "calendar.chip.deselect" : "calendar.chip.select", { name: card.name })
    : card.kind === "missed"
      ? t("calendar.chip.missed", { name: card.name })
      : card.kind === "planned"
        ? canDrag
          ? t("calendar.chip.drag", { name: card.name })
          : t("calendar.chip.planned", { name: card.name })
        : card.pair
          ? t("calendar.chip.plannedVsActual", { name: scheduled?.name ?? card.name })
          : card.name;

  return (
    <button
      type="button"
      className={[
        "calendar-chip",
        card.kind === "done" ? (card.pair ? "calendar-chip-paired" : "calendar-chip-activity") : "calendar-chip-planned",
        card.category && `calendar-sport-${card.category}`,
        card.kind === "missed" && "is-missed",
        selectable && "is-selection-enabled",
        selected && "is-selected",
        unavailable && "is-selection-unavailable"
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag || !scheduled) {
          event.preventDefault();
          return;
        }
        const payload = createCalendarDragPayload(scheduled);
        event.dataTransfer.setData(CALENDAR_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.setData("text/plain", scheduled.name);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => {
        if (selectable && scheduled) {
          onToggleScheduled(scheduled);
        } else if (card.activity) {
          onSelectActivity(card.activity);
        } else if (scheduled) {
          onSelectScheduled(scheduled);
        }
      }}
      disabled={unavailable}
      aria-pressed={selectable ? selected : undefined}
      title={card.meta ? `${title}\n${card.meta}` : title}
      /* The dashed edge is what says "planned" on screen, and a border says
         nothing to a screen reader, so the word lives here as well. */
      aria-label={
        card.kind === "done"
          ? undefined
          : selectable
            ? t(selected ? "calendar.chip.deselectPlanned" : "calendar.chip.selectPlanned", { name: card.name })
            : canDrag
              ? t("calendar.chip.plannedDragLabel", { name: card.name })
              : t("calendar.chip.plannedLabel", { name: card.name })
      }
    >
      {selectable ? (
        <span className="calendar-chip-selector" aria-hidden="true">
          {selected ? <Check size={12} strokeWidth={3} /> : null}
        </span>
      ) : null}
      <span className="calendar-chip-title">
        <Icon className="calendar-chip-icon" size={12} strokeWidth={2.2} aria-hidden="true" />
        <span className="calendar-chip-name">{card.name}</span>
        {offPlan ? (
          <span
            className={`calendar-chip-badge ${completionTone(card.completionPct)}`}
            title={t("calendar.chip.completion", { percent: card.completionPct ?? 0 })}
          >
            {Math.min(card.completionPct ?? 0, 999)}%
          </span>
        ) : null}
      </span>
      {card.meta ? <span className="calendar-chip-meta">{card.meta}</span> : null}
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
  const { locale } = useI18n();
  const [dropTarget, setDropTarget] = useState(false);
  const canReceiveDrop = !day.isPast && !busy && !selectionMode;
  /* Every cell re-renders when the screen's state moves — a panel opening, a
     drag over another day — and a day only changes when its range is read
     again, so its lines are worked out once per day, units and language. */
  const cards = useMemo(() => dayCards(day, unitSystem), [day, unitSystem, locale]);
  /* A day that already holds something (a week shared with the month before,
     still on screen) shows it; only an empty one waits. */
  const waiting = placeholderDelayMs !== undefined && cards.length === 0;
  const shown = mode === "month" && cards.length > MONTH_CARDS ? cards.slice(0, MONTH_CARDS - 1) : cards;
  const hidden = cards.length - shown.length;
  const dayLabel = formatHappenDayLabel(day.dateKey);

  return (
    <div
      className={[
        "calendar-day",
        mode === "week" && "calendar-day-week",
        !day.inMonth && "is-outside",
        day.isToday && "is-today",
        day.isPast && "is-past",
        cards.length === 0 && !waiting && "is-empty",
        dropTarget && "is-drop-target",
        !selectionMode && "is-openable"
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
        {/* The whole cell opens the day: this button is stretched over it
            (`::after`), under the cards and the "+", which answer their own
            press. A real button rather than a click on the cell, so the
            keyboard reaches the day too. */}
        <button
          type="button"
          className="calendar-day-number calendar-day-open"
          onClick={onSelectDay}
          disabled={selectionMode}
          aria-label={t("calendar.day.open", { day: dayLabel })}
          title={day.isToday ? t("calendar.today", { day: dayLabel }) : t("calendar.day.openTitle")}
        >
          {dayNumber(day.dateKey)}
        </button>
      </div>

      {waiting || shown.length ? (
        <div className="calendar-day-items">
          {waiting ? (
            <DaySkeletonChips
              dateKey={day.dateKey}
              mode={mode}
              delayMs={placeholderDelayMs ?? 0}
            />
          ) : null}
          {shown.map((card) => (
            <SessionCard
              key={card.key}
              card={card}
              day={day}
              busy={busy}
              selectionMode={selectionMode}
              selected={card.pair ? isScheduledSelected(card.pair.scheduled) : false}
              onSelectScheduled={onSelectScheduled}
              onSelectActivity={onSelectActivity}
              onToggleScheduled={onToggleScheduled}
            />
          ))}
        </div>
      ) : null}

      {hidden > 0 ? (
        <button
          type="button"
          className="calendar-day-more"
          onClick={onSelectDay}
          disabled={selectionMode}
          aria-label={t("calendar.day.open", { day: dayLabel })}
        >
          {t("calendar.day.more", { count: hidden })}
        </button>
      ) : null}

      {/* Right under the last card, or in the middle of an empty day; drawn
          under the pointer and on focus only. */}
      <div className="calendar-day-add-slot">
        <button
          type="button"
          className="calendar-day-add"
          onClick={() => onAdd(day.dateKey)}
          disabled={busy || selectionMode}
          title={day.isPast ? t("calendar.day.log") : t("calendar.day.add")}
          aria-label={t(day.isPast ? "calendar.day.logOn" : "calendar.day.addOn", { day: dayLabel })}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
