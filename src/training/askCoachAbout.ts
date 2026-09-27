/**
 * Ask Coach about a finished session, from the screen it is read on
 * (Activities, Running, Strength): a calendar ref carrying the activity's id,
 * which Coach's read tools take, as the Calendar's own Ask Coach sends one.
 *
 * Pure, outside the three views, so they cannot word it three ways and a test
 * can reach it.
 */
import type { CoachOpenRequest, UnitSystem, WorkoutSport } from "../../electron/types";
import { formatDistanceMeters, formatDurationSeconds, formatHappenDayLabel } from "./formatters";

/**
 * The workout sport a finished activity's COROS code is, for its icon. An
 * activity code is not a program code (100 is a run here, 1 is there), so
 * `workoutSportFromType` does not apply; `undefined` falls back to the
 * default icon.
 */
export function activityWorkoutSport(sportType: number | undefined): WorkoutSport | undefined {
  if (sportType === undefined) return undefined;
  if (sportType === 102) return "trailRun";
  if (sportType >= 100 && sportType <= 103) return "run";
  if (sportType >= 200 && sportType <= 299) return "bike";
  if (sportType === 300 || sportType === 301) return "swim";
  if (sportType === 400 || sportType === 402) return "strength";
  if (sportType === 1200) return "hyrox";
  return undefined;
}

export interface AskableActivity {
  /** A COROS activity id; absent for a session that exists only in Hevy. */
  activityId?: string;
  name?: string;
  sportName?: string;
  /** The COROS activity code, for the header's icon. */
  sportType?: number;
  /** Epoch seconds (or milliseconds, as the list sometimes carries). */
  startTime?: number;
  duration?: number;
  distance?: number;
}

/** `yyyyMMdd` of the local day a session started on. */
export function happenDayOf(startTime: number | undefined): string | undefined {
  if (!startTime) return undefined;
  const date = new Date(startTime < 10_000_000_000 ? startTime * 1000 : startTime);
  if (Number.isNaN(date.valueOf())) return undefined;
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function activityCoachRequest(activity: AskableActivity, unitSystem: UnitSystem): CoachOpenRequest {
  const day = happenDayOf(activity.startTime);
  const name = activity.name?.trim() || activity.sportName || "Activity";
  const sport = activityWorkoutSport(activity.sportType);
  const detail = [
    activity.sportName && activity.sportName !== name ? activity.sportName : undefined,
    activity.distance && activity.distance > 0 ? formatDistanceMeters(activity.distance, unitSystem) : undefined,
    activity.duration && activity.duration > 0 ? formatDurationSeconds(activity.duration) : undefined
  ].filter(Boolean);
  return {
    prompt: "Can you review it?",
    scheduleRefs: [
      {
        scope: "session",
        ...(day ? { day } : {}),
        ...(activity.activityId ? { activityId: activity.activityId } : {}),
        label: day ? `${formatHappenDayLabel(day)} · ${name}` : name,
        ...(detail.length ? { detail: detail.join(" · ") } : {}),
        ...(sport ? { sport } : {})
      }
    ]
  };
}
