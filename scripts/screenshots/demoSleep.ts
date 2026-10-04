// Demo sleep and daily health.
import type {
  SleepHistorySnapshot,
  SleepNightSeries,
  SleepSeriesPoint,
  TrainingHubDailyHealthRecord,
  TrainingHubSleepRecord
} from "../../electron/types";
import { seededRandom } from "../../electron/sampleActivityKit";
import { dayKey, daysAgoDate } from "./demoData";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

interface Night {
  record: TrainingHubSleepRecord;
  startMin: number; // minutes after the previous midnight (e.g. 23:10 = 1390)
  endMin: number; // minutes after the wake day's midnight
}

const nights = new Map<string, Night>();

function night(daysAgo: number): Night {
  const day = dayKey(daysAgoDate(daysAgo));
  const cached = nights.get(day);
  if (cached) return cached;
  const r = seededRandom(`sleep-${day}`);
  const weekday = daysAgoDate(daysAgo).getDay();
  const weekend = weekday === 0 || weekday === 6;
  const late = r() < 0.12;
  const startMin = 1360 + r() * 50 + (late ? 55 : 0) + (weekend ? 20 : 0); // ~22:40–00:10
  const endMin = (weekend ? 400 : 330) + r() * 45; // ~05:30–07:25
  const windowMinutes = Math.round(1440 - startMin + endMin);
  const awake = Math.round(8 + r() * 22);
  const total = windowMinutes - awake;
  const deep = Math.round(total * (0.17 + r() * 0.07));
  const rem = Math.round(total * (0.2 + r() * 0.06));
  const light = total - deep - rem;
  const score = Math.max(52, Math.min(96, Math.round(60 + (total - 360) * 0.18 + deep * 0.05 + (r() - 0.5) * 10)));
  const prev = dayKey(daysAgoDate(daysAgo + 1));
  const record: TrainingHubSleepRecord = {
    happenDay: day,
    kind: "main",
    completeness: "complete",
    totalMinutes: total,
    score,
    deepMinutes: deep,
    lightMinutes: light,
    remMinutes: rem,
    awakeMinutes: awake,
    deepPercent: Math.round((deep / total) * 100),
    lightPercent: Math.round((light / total) * 100),
    remPercent: Math.round((rem / total) * 100),
    awakePercent: Math.round((awake / windowMinutes) * 100),
    awakeCountOverFiveMinutes: r() < 0.5 ? 0 : 1 + Math.floor(r() * 2),
    windowMinutes,
    avgHr: Math.round(50 + r() * 5),
    minHr: Math.round(43 + r() * 4),
    maxHr: Math.round(68 + r() * 14),
    sleepStart: clock(startMin),
    sleepEnd: clock(endMin),
    sleepStartDay: prev,
    sleepEndDay: day
  };
  if (r() < 0.1 && daysAgo > 0) {
    record.napMinutes = 20 + Math.round(r() * 25);
    const napStart = 780 + Math.round(r() * 60);
    record.napWindows = [{ start: clock(napStart), end: clock(napStart + record.napMinutes + 3), startDay: day, endDay: day }];
  }
  const built = { record, startMin, endMin };
  nights.set(day, built);
  return built;
}

export function sleepRecords(days: number): TrainingHubSleepRecord[] {
  return Array.from({ length: days }, (_, i) => night(i).record);
}

export function sleepHistory(days = 400): SleepHistorySnapshot {
  const records = sleepRecords(days);
  return { records, latest: records[0], mcpState: "ready", fetchedAt: Date.now(), source: "cache" };
}

export function sleepSummary(days = 28) {
  const records = sleepRecords(days);
  return { latest: records[0], records, mcpState: "ready" as const };
}

export function dailyHealth(days = 30) {
  const records: TrainingHubDailyHealthRecord[] = Array.from({ length: days }, (_, i) => {
    const day = dayKey(daysAgoDate(i));
    const r = seededRandom(`health-${day}`);
    const n = night(i).record;
    return {
      happenDay: day,
      steps: i === 0 ? 6840 : Math.round(8200 + r() * 7400),
      calories: Math.round(2300 + r() * 900),
      exerciseMinutes: Math.round(35 + r() * 60),
      stressAvg: Math.round(24 + r() * 14),
      sleepAvgHr: n.avgHr,
      sleepMinHr: n.minHr,
      sleepMaxHr: n.maxHr,
      sleepTotalMinutes: n.totalMinutes,
      sleepDeepMinutes: n.deepMinutes,
      sleepLightMinutes: n.lightMinutes,
      sleepRemMinutes: n.remMinutes,
      sleepAwakeMinutes: n.awakeMinutes
    };
  });
  return { latest: records[0], records, mcpState: "ready" as const };
}

const TZ_MS = 7 * 3600_000;

export function nightSeries(happenDay: string): SleepNightSeries {
  const daysAgo = Math.round((daysAgoDate(0).getTime() - new Date(Number(happenDay.slice(0, 4)), Number(happenDay.slice(4, 6)) - 1, Number(happenDay.slice(6, 8))).getTime()) / 86_400_000);
  const n = night(Math.max(0, daysAgo));
  const r = seededRandom(`series-${happenDay}`);
  const y = Number(happenDay.slice(0, 4));
  const mo = Number(happenDay.slice(4, 6)) - 1;
  const d = Number(happenDay.slice(6, 8));
  const startLocal = Date.UTC(y, mo, d - 1, 0, 0) + n.startMin * 60_000;
  const endLocal = Date.UTC(y, mo, d, 0, 0) + n.endMin * 60_000;
  const hrv: SleepSeriesPoint[] = [];
  const stress: SleepSeriesPoint[] = [];
  const span = endLocal - startLocal;
  let wander = 0;
  for (let t = startLocal; t <= endLocal; t += 5 * 60_000) {
    const p = (t - startLocal) / span;
    wander = wander * 0.8 + (r() - 0.5) * 8;
    // HRV climbs through the first half of the night, peaks, eases towards morning.
    const value = Math.round(52 + 30 * Math.sin(Math.PI * Math.min(1, p * 1.15)) + wander);
    const shifted = new Date(t);
    const point = { at: t - TZ_MS, localAt: t, clock: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}` };
    hrv.push({ ...point, value: Math.max(28, value) });
    stress.push({ ...point, value: Math.max(5, Math.round(22 - 14 * Math.sin(Math.PI * p) + (r() - 0.5) * 8)) });
  }
  const avg = Math.round(hrv.reduce((s, x) => s + x.value, 0) / hrv.length);
  return {
    happenDay,
    hrv,
    stress,
    assessment: { happenDay, avg, normalLow: 56, normalHigh: 74, baseline: 65, evaluation: "Balanced" },
    windowStart: startLocal,
    windowEnd: endLocal,
    fetchedAt: Date.now(),
    source: "cache",
    mcpState: "ready"
  };
}
