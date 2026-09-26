/**
 * What a question points at, read back as a line or two for the composer
 * (Coach Workbench UAT, option A): the week, the session or the plan an
 * Ask Coach put there, with enough of it to see which one before sending.
 *
 * Pure, outside the component, for the reason `planReaderModel.ts` is: it is
 * the part a test can reach. It reads the plan document already in hand, so
 * the preview costs no request.
 */
import type { PlanRef, ScheduleRef, TrainingPlanDocument, WorkoutSport } from "../../electron/types";
import type { UnitSystem } from "../../electron/types";
import { distanceUnit, metersToDisplayDistance } from "../../electron/unitSystem";
import { datedForReading } from "./planDating";
import { readPlan, ridgeMeasure, weekRidgeValues } from "../training-library/planReaderModel";

export interface RefPreview {
  kind: "plan" | "week" | "session" | "calendar" | "calendarWeek" | "activity";
  /** What it belongs to, after "Asking about ·": the plan's name, or "your calendar". */
  context: string;
  /** What it is: "Week 3 · Base", "Sat · Long run 1:10". */
  title: string;
  /** Its name on a chip, when several share the header: "Week 3", "Sat · Long run". */
  chip: string;
  /** The figures under it: "4 sessions · 3.1 h · Tue Wed Fri Sat". */
  detail?: string;
  sport?: WorkoutSport;
  /** Every week's height, 0–1, for a plan or a week; `current` marks the week. */
  bars?: { heights: number[]; current?: number };
}

/** "1:10" past an hour, "25m" under one. */
export function formatSessionTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} h`;
}

function formatDistance(meters: number, unitSystem: UnitSystem): string {
  const value = metersToDisplayDistance(meters, unitSystem);
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${distanceUnit(unitSystem)}`;
}

/** The preview of one Coach creation ref, or a bare one when its plan is not in hand. */
export function planRefPreview(
  ref: PlanRef,
  document: TrainingPlanDocument | null | undefined,
  unitSystem: UnitSystem
): RefPreview {
  const bare: RefPreview = {
    kind: ref.scope === "plan" ? "plan" : ref.scope,
    context: ref.scope === "plan" ? "Coach plan" : ref.name,
    title: ref.scope === "plan" ? ref.name : ref.label,
    chip: ref.scope === "plan" ? ref.name : ref.label
  };
  if (!document) return bare;

  const weeks = readPlan(datedForReading(document)).weeks;
  const measure = ridgeMeasure(weeks);
  const values = weekRidgeValues(weeks, measure);
  const peak = Math.max(0, ...values);
  const heights = values.map((value) => (peak > 0 ? value / peak : 0));
  // The sport most sessions are, for the bars' colour.
  const counts = new Map<WorkoutSport, number>();
  for (const item of document.entries) {
    const sport = (item.workout.sport ?? "run") as WorkoutSport;
    counts.set(sport, (counts.get(sport) ?? 0) + 1);
  }
  const mainSport = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  const sportOf = mainSport ? { sport: mainSport } : {};

  if (ref.scope === "plan") {
    if (ref.artifactType === "workout") return { ...bare, kind: "plan" };
    const sessions = weeks.reduce((sum, week) => sum + week.summary.workouts, 0);
    return {
      kind: "plan",
      context: "Coach plan",
      title: ref.name,
      chip: ref.name,
      detail: `${weeks.length} ${weeks.length === 1 ? "week" : "weeks"} · ${sessions} sessions`,
      ...sportOf,
      ...(weeks.length > 1 ? { bars: { heights } } : {})
    };
  }

  if (ref.scope === "week" && ref.weekIndex !== undefined) {
    const week = weeks[ref.weekIndex];
    if (!week) return bare;
    const days = week.days.filter((day) => day.entries.length).map((day) => day.label.slice(0, 3));
    const count = week.summary.workouts;
    const volume =
      week.timed && week.summary.durationSeconds > 0
        ? formatHours(week.summary.durationSeconds)
        : week.summary.distanceMeters > 0
          ? formatDistance(week.summary.distanceMeters, unitSystem)
          : undefined;
    return {
      kind: "week",
      context: ref.name,
      title: `Week ${ref.weekIndex + 1}${week.stage ? ` · ${week.stage}` : ""}`,
      chip: `Week ${ref.weekIndex + 1}`,
      detail: [`${count} ${count === 1 ? "session" : "sessions"}`, volume, days.join(" ")]
        .filter(Boolean)
        .join(" · "),
      ...sportOf,
      ...(weeks.length > 1 ? { bars: { heights, current: ref.weekIndex } } : {})
    };
  }

  if (ref.scope === "session" && ref.sessionKey) {
    const entry = document.entries.find((item) => (item.workout.key || item.id) === ref.sessionKey);
    if (!entry) return bare;
    for (const week of weeks) {
      for (const day of week.days) {
        const facts = day.entries.find((item) => item.id === entry.id);
        if (!facts) continue;
        const time =
          facts.durationComplete && facts.durationSeconds > 0 ? formatSessionTime(facts.durationSeconds) : undefined;
        const name = `${day.label.slice(0, 3)} · ${facts.title}`;
        return {
          kind: "session",
          context: `${ref.name} · week ${week.weekIndex + 1}`,
          title: time ? `${name} ${time}` : name,
          chip: name,
          ...(facts.distanceMeters > 0 ? { detail: formatDistance(facts.distanceMeters, unitSystem) } : {}),
          ...(facts.sport ? { sport: facts.sport } : {})
        };
      }
    }
    return bare;
  }
  return bare;
}

/**
 * A calendar, activity or COROS plan ref: its label names the day and what is
 * on it ("Sat 27 Sep · Long run"), and a screen that had its figures in hand
 * sent them along as `detail`.
 */
export function scheduleRefPreview(ref: ScheduleRef): RefPreview {
  const [first, ...rest] = ref.label.split(" · ");
  const detail = [rest.join(" · "), ref.detail].filter(Boolean).join(" · ");
  const kind: RefPreview["kind"] = ref.activityId ? "activity" : ref.scope === "week" ? "calendarWeek" : "calendar";
  return {
    kind,
    context: ref.activityId ? "your activity" : ref.planId && !ref.day ? "your COROS plan" : "your calendar",
    title: first,
    chip: first,
    ...(detail ? { detail } : {}),
    ...(ref.sport ? { sport: ref.sport } : {})
  };
}

/** The composer's placeholder for what it points at. */
export function refPlaceholder(previews: readonly RefPreview[]): string | undefined {
  if (previews.length !== 1) return previews.length ? "Ask about these…" : undefined;
  const [only] = previews;
  if (only.kind === "week") return "Ask about this week…";
  if (only.kind === "session") return "Ask about this session…";
  if (only.kind === "plan") return "Ask about this plan…";
  return "Ask about this…";
}
