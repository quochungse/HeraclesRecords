// Demo stress and heart rate, as COROS MCP would answer the Stress level and
// Heart rate screens. Worked out from the demo's own nights and sessions, so a
// day's readings stop for its sessions, run low through its sleep, and its
// highest heart rate is its hardest session's.
import type {
  StressDaySeries,
  StressHeartDay,
  StressHeartSnapshot,
  StressSeriesSnapshot,
  TrainingHubSleepRecord
} from "../../electron/types";
import { seededRandom } from "../../electron/sampleActivityKit";
import { STRESS_SLOTS_PER_DAY, daysBetween, emptyStressSlots, stressLevelOf } from "../../electron/stressHeartParser";
import { MINUTES_PER_SLOT, sessionsOnDay, sleepOnDay } from "../../src/stressHeart/stressHeartModel";
import { allActivities, dayKey, daysAgoDate } from "./demoData";
import { sleepRecords } from "./demoSleep";

/** COROS answers a year of days. */
const DAYS_ON_FILE = 365;

let nightsOnFile: TrainingHubSleepRecord[] | null = null;
const nights = () => (nightsOnFile ??= sleepRecords(DAYS_ON_FILE + 2));

/** Minutes past midnight now, for a day still being lived. */
function minutesNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Where stress sits awake at a time of day: busy mornings and afternoons, calmer evenings. */
function awakeBase(minute: number, weekend: boolean): number {
  const hour = minute / 60;
  const base = hour < 9 ? 21 : hour < 12 ? 36 : hour < 13.5 ? 27 : hour < 17.5 ? 40 : hour < 21 ? 28 : 20;
  return weekend ? base - 8 : base;
}

const seriesByDay = new Map<string, StressDaySeries>();

function daySeries(daysAgo: number): StressDaySeries {
  const day = dayKey(daysAgoDate(daysAgo));
  const known = seriesByDay.get(day);
  if (known) return known;

  const r = seededRandom(`stress-${day}`);
  const weekday = daysAgoDate(daysAgo).getDay();
  const weekend = weekday === 0 || weekday === 6;
  const sleep = sleepOnDay(day, nights());
  const sessions = sessionsOnDay(day, allActivities());
  // The watch off the wrist for a while most evenings: a shower, a charge.
  const offFrom = r() < 0.45 ? 1140 + Math.round(r() * 90) : -1;
  const offTo = offFrom + 25 + Math.round(r() * 30);
  const until = daysAgo === 0 ? minutesNow() : 24 * 60;

  const slots = emptyStressSlots();
  let wander = 0;
  let spike = 0;
  let moving = 0;
  for (let slot = 0; slot < STRESS_SLOTS_PER_DAY; slot += 1) {
    const minute = slot * MINUTES_PER_SLOT + MINUTES_PER_SLOT / 2;
    wander = wander * 0.82 + (r() - 0.5) * 12;
    spike = spike * 0.7;
    if (minute > until) break;
    // COROS reads no stress while the body moves, nor for a few minutes after.
    if (sessions.some((session) => minute >= session.from && minute < session.to + 5)) continue;
    if (minute >= offFrom && minute < offTo) continue;
    if (sleep.some((piece) => minute >= piece.from && minute < piece.to)) {
      slots[slot] = Math.max(4, Math.min(24, Math.round(12 + wander * 0.4)));
      continue;
    }
    // Awake, the day is still only now and then: a walk, the stairs, the commute.
    if (moving === 0 && r() < 0.08) moving = 2 + Math.floor(r() * 7);
    if (moving > 0) {
      moving -= 1;
      continue;
    }
    if (minute > 8 * 60 && minute < 18 * 60 && r() < 0.012) spike = 34 + r() * 18;
    // Heart rate still up after a session reads as stress for an hour or so.
    const after = sessions.reduce((most, session) => {
      const since = minute - session.to;
      return since >= 0 && since < 120 ? Math.max(most, 32 * Math.exp(-since / 35)) : most;
    }, 0);
    slots[slot] = Math.max(2, Math.min(98, Math.round(awakeBase(minute, weekend) + wander + spike + after)));
  }

  const series = { day, slots };
  seriesByDay.set(day, series);
  return series;
}

function dayFigures(daysAgo: number): StressHeartDay {
  const day = dayKey(daysAgoDate(daysAgo));
  const r = seededRandom(`heart-${day}`);
  const readings = daySeries(daysAgo).slots.filter((value): value is number => value !== null);
  const levels = { relaxed: 0, low: 0, medium: 0, high: 0 };
  for (const value of readings) levels[stressLevelOf(value)] += MINUTES_PER_SLOT;

  const night = nights()[daysAgo];
  const startedBy = daysAgo === 0 ? Date.now() / 1000 : Number.POSITIVE_INFINITY;
  const sessions = sessionsOnDay(day, allActivities()).filter((session) => (session.activity.startTime ?? 0) <= startedBy);
  const sessionMax = Math.max(0, ...sessions.map((session) => session.activity.maxHr ?? 0));
  const sessionMinutes = sessions.reduce((sum, session) => sum + (session.to - session.from), 0);
  const hardYesterday = sessionsOnDay(dayKey(daysAgoDate(daysAgo + 1)), allActivities()).some(
    (session) => (session.activity.trainingLoad ?? 0) > 120
  );

  return {
    day,
    stressAvg: readings.length > 0 ? Math.round(readings.reduce((sum, value) => sum + value, 0) / readings.length) : undefined,
    levels: readings.length > 0 ? levels : undefined,
    avgHr: Math.round(60 + r() * 5 + sessionMinutes / 25),
    minHr: night?.minHr,
    maxHr: Math.max(sessionMax, Math.round(94 + r() * 22)),
    restingHr: Math.round(50 + 1.5 * Math.sin(daysAgo / 9) + (r() - 0.5) * 2 + (hardYesterday ? 2 : 0))
  };
}

let snapshot: StressHeartDay[] | null = null;

export function stressHeartDays(): StressHeartSnapshot {
  snapshot ??= Array.from({ length: DAYS_ON_FILE }, (_, index) => dayFigures(DAYS_ON_FILE - 1 - index));
  return { days: snapshot, mcpState: "ready", fetchedAt: Date.now(), source: "cache" };
}

export function stressSeries(request: { fromDay: string; toDay: string }): StressSeriesSnapshot {
  const today = dayKey(daysAgoDate(0));
  const to = request.toDay > today ? today : request.toDay;
  // A day's distance from today is the days from it to today, less one.
  const days = daysBetween(request.fromDay, to).map((day) => daySeries(daysBetween(day, today).length - 1));
  return { days, mcpState: "ready" };
}
