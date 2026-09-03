import type {
  StrengthSession,
  TrainingHubActivity,
  UnitSystem
} from "../../electron/types";
import { resolveExerciseName } from "./exerciseNames";
import { formatDistanceMeters } from "./formatters";
import {
  happenDayFromTimestamp,
  sportColorCategory,
  SPORT_COLOR_LABELS,
  type SportColorCategory
} from "./sportColors";

/** One activity as it reads inside a Last-30-days heatmap card. */
export interface HeatmapDayEntry {
  activityId: string;
  /** Drives the dot color, from the same palette as the year heatmap. */
  sport: SportColorCategory;
  /** "Run", or "Strength: Shoulders, Chest" once the breakdown is cached. */
  title: string;
  /**
   * ["10.0 km", "1:21"] — kept apart rather than joined so a narrow card wraps
   * between them instead of ellipsing the tail of a single string away.
   */
  meta: string[];
}

/** Body regions listed before the card falls back to a "+N" suffix. */
const MAX_STRENGTH_PARTS = 2;
/**
 * A focus longer than this takes over the card, and every card in the band
 * grows with it. Structured sessions and Hevy imports carry real exercise
 * names ("Seated Lat Pulldowns, Seated Cable Row") that blow straight past it.
 */
const MAX_FOCUS_CHARS = 22;

/**
 * Duration in the shape a card can hold: "46'" under an hour, "1:21" above it.
 * Deliberately coarser than `formatDurationSeconds` — seconds do not fit in a
 * column a tenth of the panel wide, and are not what the summary is for.
 */
export function formatCardDuration(seconds?: number): string {
  if (!Number.isFinite(seconds) || (seconds ?? 0) <= 0) {
    return "";
  }

  const totalMinutes = Math.max(1, Math.round((seconds ?? 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}`
    : `${minutes}'`;
}

/**
 * What a strength session worked, e.g. "Shoulders, Chest".
 *
 * An unstructured COROS session labels each auto-detected segment by body
 * region, which is exactly the summary a card wants. A structured session (or
 * a Hevy import) lists real exercise names instead, so the list is capped and
 * suffixed rather than allowed to wrap the card.
 */
export function formatStrengthFocus(session?: StrengthSession): string {
  const names: string[] = [];

  for (const exercise of session?.detail?.exercises ?? []) {
    const name = resolveExerciseName(exercise.nameKey, exercise.rawName).trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    return "";
  }

  const shown = names.slice(0, MAX_STRENGTH_PARTS);
  const rest = names.length - shown.length;
  const label = rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
  if (label.length <= MAX_FOCUS_CHARS) {
    return label;
  }

  // Past the budget the count says more than a mid-word cut would; a single
  // long name is worth keeping, so it is trimmed at a word boundary instead.
  return names.length > 1
    ? `${names.length} exercises`
    : truncateAtWord(names[0], MAX_FOCUS_CHARS - 2);
}

function truncateAtWord(value: string, budget: number): string {
  const clipped = value.slice(0, budget);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > budget / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * Index strength breakdowns by the activity they belong to. Merged sessions
 * carry the COROS id under `sourceIds` as well, so both are registered — a
 * Hevy-only session simply never matches a COROS activity.
 */
export function indexStrengthSessions(
  sessions: StrengthSession[]
): Map<string, StrengthSession> {
  const byActivity = new Map<string, StrengthSession>();

  for (const session of sessions) {
    if (session.activityId) {
      byActivity.set(session.activityId, session);
    }
    const corosId = session.sourceIds?.coros;
    if (corosId) {
      byActivity.set(corosId, session);
    }
  }

  return byActivity;
}

/**
 * Group activities into per-day card lines, oldest activity of the day first.
 * Days with no activity are simply absent from the map.
 */
export function buildHeatmapDayEntries(
  activities: TrainingHubActivity[],
  strengthByActivity: Map<string, StrengthSession>,
  unitSystem: UnitSystem
): Map<string, HeatmapDayEntry[]> {
  const byDay = new Map<string, HeatmapDayEntry[]>();

  const ordered = [...activities].sort(
    (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
  );

  for (const activity of ordered) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }

    const sport = sportColorCategory(activity.sportType);
    const sportLabel =
      activity.sportName?.trim() || SPORT_COLOR_LABELS[sport];
    const focus =
      sport === "strength"
        ? formatStrengthFocus(strengthByActivity.get(activity.activityId))
        : "";

    const meta: string[] = [];
    if ((activity.distance ?? 0) > 0) {
      meta.push(formatDistanceMeters(activity.distance, unitSystem));
    }
    const duration = formatCardDuration(activity.duration);
    if (duration) {
      meta.push(duration);
    }

    const entries = byDay.get(happenDay) ?? [];
    entries.push({
      activityId: activity.activityId,
      sport,
      title: focus ? `${sportLabel}: ${focus}` : sportLabel,
      meta
    });
    byDay.set(happenDay, entries);
  }

  return byDay;
}

/** One sport's slice of the accent stripe down a card's left edge. */
export interface SportShare {
  sport: SportColorCategory;
  /** 0–1, summing to 1 across the day. Never below MIN_SPORT_SHARE. */
  share: number;
}

/**
 * A sport that took a sliver of the day still has to be visible in a stripe
 * ~70px tall, so every sport is given this much before the rest is shared out
 * by load.
 */
const MIN_SPORT_SHARE = 0.1;

/**
 * Split each day's stripe between the sports trained that day, proportional to
 * time spent.
 *
 * Time is what the stripe is measuring: an hour of lifting reads as an hour
 * whatever COROS scored it, where load would shrink it next to a run. Load
 * stands in when a session carries no duration, and an equal split is the last
 * resort — a sport that happened is never given a zero-length slice.
 *
 * Days with a single sport return one full-length share, which the card renders
 * exactly as the solid stripe it drew before.
 */
export function buildSportSharesByDay(
  activities: TrainingHubActivity[]
): Map<string, SportShare[]> {
  const durationsByDay = new Map<string, Map<SportColorCategory, number>>();
  const loadsByDay = new Map<string, Map<SportColorCategory, number>>();

  // Sorted, so insertion order is the order the day was trained — the stripe
  // then reads top to bottom in step with the lines printed beside it.
  const ordered = [...activities].sort(
    (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
  );

  for (const activity of ordered) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }

    const sport = sportColorCategory(activity.sportType);
    const load = Number.isFinite(activity.trainingLoad)
      ? Math.max(0, activity.trainingLoad ?? 0)
      : 0;
    const duration = Number.isFinite(activity.duration)
      ? Math.max(0, activity.duration ?? 0)
      : 0;

    const durations = durationsByDay.get(happenDay) ?? new Map();
    durations.set(sport, (durations.get(sport) ?? 0) + duration);
    durationsByDay.set(happenDay, durations);

    const loads = loadsByDay.get(happenDay) ?? new Map();
    loads.set(sport, (loads.get(sport) ?? 0) + load);
    loadsByDay.set(happenDay, loads);
  }

  const result = new Map<string, SportShare[]>();

  for (const [happenDay, durations] of durationsByDay) {
    const loads = loadsByDay.get(happenDay);
    const weights =
      sumOf(durations) > 0
        ? durations
        : loads && sumOf(loads) > 0
          ? loads
          : null;
    const sports = [...durations.keys()];
    const total = weights ? sumOf(weights) : 0;

    // Every sport gets the floor; time only decides how the remainder splits,
    // so no slice can fall under it however lopsided the day was.
    const remainder = 1 - MIN_SPORT_SHARE * sports.length;
    result.set(
      happenDay,
      sports.map((sport) => ({
        sport,
        share:
          sports.length === 1
            ? 1
            : MIN_SPORT_SHARE +
              remainder *
                (total > 0 ? (weights?.get(sport) ?? 0) / total : 1 / sports.length)
      }))
    );
  }

  return result;
}

function sumOf(values: Map<SportColorCategory, number>): number {
  return [...values.values()].reduce((sum, value) => sum + value, 0);
}

/**
 * The stripe itself: hard-stopped colour bands down the card's left edge.
 *
 * A single sport still returns a (one-band) gradient rather than deferring to
 * the card's --cell-color, because that variable is only set for days that
 * scored load — a day trained at load 0 would otherwise fall through to the
 * empty-day grey.
 */
export function sportStripeGradient(
  shares: SportShare[] | undefined
): string | undefined {
  if (!shares || shares.length === 0) {
    return undefined;
  }

  const stops: string[] = [];
  let position = 0;

  shares.forEach((entry, index) => {
    const start = position * 100;
    position = index === shares.length - 1 ? 1 : position + entry.share;
    const end = position * 100;
    stops.push(
      `color-mix(in srgb, var(--sport-${entry.sport}) 75%, transparent) ${start.toFixed(
        2
      )}% ${end.toFixed(2)}%`
    );
  });

  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/** "20260805" → "5/8", the day/month label above each card. */
export function formatHappenDayShort(happenDay: string): string {
  if (!/^\d{8}$/.test(happenDay)) {
    return happenDay;
  }

  return `${Number(happenDay.slice(6, 8))}/${Number(happenDay.slice(4, 6))}`;
}
