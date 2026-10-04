// The demo athlete's running plan, as COROS's calendar would hold it.
import type {
  TrainingHubScheduledExercise,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubUpcomingWorkout
} from "../../electron/types";
import { dayKey } from "./demoData";

/** Monday of last week: the plan started then. */
export function planStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday - 7);
  return d;
}

export const PLAN_WEEKS = 12;
export const RUNNING_PLAN_ID = "demo-run-plan";
export const PLAN_NAME = "Hanoi Marathon · 12 weeks";

export interface DemoSession {
  week: number; // 0-based from planStart
  day: number; // 0 = Monday
  name: string;
  km: number;
  load: number;
  minutes: number;
  kind: "easy" | "tempo" | "intervals" | "long" | "mp" | "race" | "strides";
  steps: TrainingHubScheduledExercise[];
}

const longKm = [18, 20, 22, 16, 24, 26, 20, 28, 30, 24, 18, 42.2];

export function planSessions(): DemoSession[] {
  const sessions: DemoSession[] = [];
  for (let w = 0; w < PLAN_WEEKS; w += 1) {
    const taper = w >= 10;
    const recovery = w === 3 || w === 6 || w === 9;
    // Tuesday quality.
    if (w === 11) {
      sessions.push({ week: w, day: 1, name: "Race-week tune-up", km: 8, load: 62, minutes: 45, kind: "strides", steps: [
        { name: "Warm up", targetLabel: "3 km" }, { name: "Marathon pace", targetLabel: "1 km" }, { name: "Marathon pace", targetLabel: "1 km" }, { name: "Marathon pace", targetLabel: "1 km" }, { name: "Cool down", targetLabel: "2 km" }] });
    } else if (w % 2 === 0) {
      const tempoKm = recovery ? 5 : Math.min(10, 7 + Math.floor(w / 2));
      sessions.push({ week: w, day: 1, name: taper ? "Tempo run" : `Tempo run`, km: tempoKm + 3.5, load: 82 + tempoKm * 6, minutes: Math.round(tempoKm * 4.4 + 22), kind: "tempo", steps: [
        { name: "Warm up", targetLabel: "2 km" }, { name: "Tempo", targetLabel: `${tempoKm} km` }, { name: "Cool down", targetLabel: "1.5 km" }] });
    } else {
      const reps = recovery ? 5 : Math.min(8, 6 + Math.floor((w - 1) / 3));
      sessions.push({ week: w, day: 1, name: `${reps} × 1 km intervals`, km: reps * 1.4 + 4.4, load: 102 + reps * 7, minutes: Math.round(reps * 6.2 + 26), kind: "intervals", steps: [
        { name: "Warm up", targetLabel: "2.4 km" }, ...Array.from({ length: reps }, (_, i) => [{ name: "Interval", targetLabel: "1 km" }, ...(i < reps - 1 ? [{ name: "Recovery jog", targetLabel: "400 m" }] : [])]).flat(), { name: "Cool down", targetLabel: "2 km" }] });
    }
    // Thursday easy.
    sessions.push({ week: w, day: 3, name: w % 3 === 2 ? "Easy run + strides" : "Easy run", km: recovery ? 7 : 9, load: recovery ? 70 : 90, minutes: recovery ? 45 : 57, kind: "easy", steps: [{ name: "Easy", targetLabel: recovery ? "7 km" : "9 km" }] });
    // Saturday marathon pace in the build.
    if (w >= 4 && w <= 9 && !recovery) {
      sessions.push({ week: w, day: 5, name: "Marathon pace 2 × 5 km", km: 14, load: 165, minutes: 72, kind: "mp", steps: [
        { name: "Warm up", targetLabel: "2 km" }, { name: "Marathon pace", targetLabel: "5 km" }, { name: "Float", targetLabel: "3:00" }, { name: "Marathon pace", targetLabel: "5 km" }, { name: "Cool down", targetLabel: "2 km" }] });
    }
    // Sunday long.
    const km = longKm[w]!;
    sessions.push({ week: w, day: 6, name: w === 11 ? "Hanoi Marathon" : `Long run ${km} km`, km, load: w === 11 ? 420 : Math.round(km * 10.3), minutes: Math.round(km * (w === 11 ? 4.7 : 6.1)), kind: w === 11 ? "race" : "long", steps: [{ name: w === 11 ? "Race" : "Long run", targetLabel: `${km} km` }] });
  }
  return sessions;
}

export function sessionDay(s: DemoSession): string {
  const d = planStart();
  d.setDate(d.getDate() + s.week * 7 + s.day);
  return dayKey(d);
}

export function scheduledEntries(startDay: string, endDay: string): TrainingHubScheduledWorkoutEntry[] {
  return planSessions()
    .map((s, index) => ({ s, index, day: sessionDay(s) }))
    .filter(({ day }) => day >= startDay && day <= endDay)
    .map(({ s, index, day }) => ({
      planId: RUNNING_PLAN_ID,
      idInPlan: String(index + 1),
      planProgramId: `demo-program-${index + 1}`,
      happenDay: day,
      name: s.name,
      sportType: 1,
      sortNo: 1,
      volume: `${s.km % 1 === 0 ? s.km.toFixed(0) : s.km.toFixed(1)} km`,
      trainingLoad: s.load,
      exercises: s.steps
    }));
}

export function upcomingWorkouts(days = 14): TrainingHubUpcomingWorkout[] {
  const today = dayKey(new Date());
  const end = new Date();
  end.setDate(end.getDate() + days);
  return scheduledEntries(today, dayKey(end)).map((e) => ({
    happenDay: e.happenDay,
    name: e.name,
    volume: e.volume,
    trainingLoad: e.trainingLoad,
    sportType: e.sportType,
    sortNo: e.sortNo,
    exercises: e.exercises
  }));
}
