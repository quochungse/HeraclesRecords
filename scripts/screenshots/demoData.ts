// Demo data for README screenshots.
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import { seededRandom } from "../../electron/sampleActivityKit";
import { withSampleRides, sampleRideDetail, withSampleRideSummaries, isSampleRideId } from "../../electron/sampleRides";
import { withSampleHikes, sampleHikeDetail, withSampleHikeSummaries, isSampleHikeId } from "../../electron/sampleHikes";
import { withSampleTrailRuns, sampleTrailRunDetail, withSampleTrailRunSummaries, isSampleTrailRunId } from "../../electron/sampleTrailRuns";
import { withSampleRoadRuns, sampleRoadRunDetail, withSampleRoadRunSummaries, isSampleRoadRunId } from "./sampleRoadRuns";
import { sampleRecordsInput } from "../../src/records/sampleRecords";
import { buildSampleStrengthSessions } from "../../src/strength/sampleSessions";
import { historyTrack } from "./demoTracks";

export const DAY_MS = 86_400_000;

export function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function daysAgoDate(days: number, hour = 0, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export const TODAY = dayKey(new Date());
const RECENT_DAYS = 84;
const recentCut = daysAgoDate(RECENT_DAYS).getTime() / 1000;

// ---------------------------------------------------------------- history --

const realistic = sampleRecordsInput("realistic", TODAY);
export const realisticInput = realistic;

function fillHistoryRow(a: TrainingHubActivity, index: number): TrainingHubActivity {
  const r = seededRandom(`fill-${a.activityId}`);
  const hours = (a.duration ?? 3600) / 3600;
  const isStrength = a.sportType === 402 || a.sportType === 400;
  const isSwim = a.sportType === 300 || a.sportType === 301;
  const isRide = a.sportType >= 200 && a.sportType < 300;
  const avgHr = Math.round(isStrength ? 112 + r() * 14 : isSwim ? 132 + r() * 10 : isRide ? 128 + r() * 14 : 141 + r() * 16);
  const load = Math.round(hours * (isStrength ? 45 : isRide ? 70 : 92) * (0.85 + r() * 0.4));
  return {
    ...a,
    endTime: (a.startTime ?? 0) + (a.duration ?? 0) + 30,
    elapsedDuration: (a.duration ?? 0) + Math.round(r() * 60),
    avgHr,
    maxHr: avgHr + 18 + Math.round(r() * 12),
    calories: Math.round(hours * (isStrength ? 380 : 640) * (0.9 + r() * 0.2)),
    trainingLoad: load
  };
}

const history = realistic.activities
  .filter((a) => (a.startTime ?? 0) < recentCut)
  .map(fillHistoryRow);

// --------------------------------------------------------- recent extras --

/** Strength sessions and swims for the last twelve weeks: list rows only. */
function recentExtras(): TrainingHubActivity[] {
  const rows: TrainingHubActivity[] = [];
  for (let day = 1; day < RECENT_DAYS; day += 1) {
    const date = daysAgoDate(day);
    const weekday = date.getDay();
    const r = seededRandom(`extra-${day}`);
    if (weekday === 3 && day % 14 < 7) {
      const start = daysAgoDate(day, 18, 40);
      const duration = 2400 + Math.round(r() * 600);
      rows.push({
        activityId: `demo-swim-${day}`,
        name: "Pool swim",
        sportType: 300,
        sportName: "Pool Swim",
        startTime: start.getTime() / 1000,
        endTime: start.getTime() / 1000 + duration,
        duration,
        elapsedDuration: duration,
        distance: 1800 + Math.round(r() * 6) * 100,
        avgHr: 128 + Math.round(r() * 10),
        maxHr: 152 + Math.round(r() * 10),
        calories: 380 + Math.round(r() * 60),
        trainingLoad: 42 + Math.round(r() * 14)
      });
    }
  }
  for (const s of buildSampleStrengthSessions(RECENT_DAYS)) {
    const wd = new Date((s.startTime ?? 0) * 1000).getDay();
    if (wd !== 1 && wd !== 4) continue;
    rows.push({ activityId: s.activityId, name: s.name, sportType: s.sportType, sportName: s.sportName ?? "Strength", startTime: s.startTime, endTime: (s.startTime ?? 0) + (s.duration ?? 0), duration: s.duration, elapsedDuration: s.duration, avgHr: s.avgHr, maxHr: s.maxHr, calories: s.calories, trainingLoad: s.trainingLoad });
  }
  return rows;
}

let all: TrainingHubActivity[] | null = null;

export function allActivities(): TrainingHubActivity[] {
  if (all) return all;
  let list: TrainingHubActivity[] = [...history, ...recentExtras()];
  const req = { page: 1 };
  list = withSampleRides(list, req);
  list = withSampleHikes(list, req);
  list = withSampleTrailRuns(list, req);
  list = withSampleRoadRuns(list, req);
  // One outdoor session a day at most, besides the gym and the pool: a run beats a trail run beats a hike beats a ride.
  const rank = (a: TrainingHubActivity) => isSampleRoadRunId(a.activityId) ? 4 : isSampleTrailRunId(a.activityId) ? 3 : isSampleHikeId(a.activityId) ? 2 : isSampleRideId(a.activityId) ? 1 : 0;
  const best = new Map<string, number>();
  for (const a of list) { const r = rank(a); if (!r) continue; const k = dayKey(new Date((a.startTime ?? 0) * 1000)); best.set(k, Math.max(best.get(k) ?? 0, r)); }
  list = list.filter((a) => { const r = rank(a); return !r || best.get(dayKey(new Date((a.startTime ?? 0) * 1000))) === r; });
  list.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  all = list;
  return all;
}

export function listPage(page: number, size: number, startDay?: string, endDay?: string): TrainingHubActivity[] {
  const filtered = allActivities().filter((a) => {
    const day = dayKey(new Date((a.startTime ?? 0) * 1000));
    return (startDay === undefined || day >= startDay) && (endDay === undefined || day <= endDay);
  });
  return filtered.slice((page - 1) * size, page * size);
}

export function findActivity(id: string): TrainingHubActivity | undefined {
  return allActivities().find((a) => a.activityId === id);
}

// ---------------------------------------------------------------- details --

const PLACE_FALLBACK = { lat: 21.03, lon: 105.85 };

function minimalDetail(a: TrainingHubActivity): TrainingHubActivityDetail {
  const summary = realistic.summaries.get(a.activityId);
  const indoor = a.sportType === 402 || a.sportType === 400 || a.sportType === 300 || a.sportType === 201;
  const base = summary?.startPoint ?? PLACE_FALLBACK;
  const points = indoor ? [] : historyTrack(a, base);
  return {
    ...a,
    laps: [],
    hrZones: [],
    ...(points.length ? { track: { points } } : {})
  } as TrainingHubActivityDetail;
}

export function activityDetail(id: string): TrainingHubActivityDetail {
  if (isSampleRideId(id)) return sampleRideDetail(id);
  if (isSampleHikeId(id)) return sampleHikeDetail(id);
  if (isSampleTrailRunId(id)) return sampleTrailRunDetail(id);
  if (isSampleRoadRunId(id)) return sampleRoadRunDetail(id);
  const a = findActivity(id);
  if (!a) throw new Error(`No demo activity ${id}`);
  return minimalDetail(a);
}

export function activitySummaries(ids: string[]): ActivityDetailSummary[] {
  let out: ActivityDetailSummary[] = ids.flatMap((id) => {
    const s = realistic.summaries.get(id);
    return s ? [s] : [];
  });
  out = withSampleRideSummaries(ids, out);
  out = withSampleHikeSummaries(ids, out);
  out = withSampleTrailRunSummaries(ids, out);
  out = withSampleRoadRunSummaries(ids, out);
  // Drift is a road-run figure (see the Activities fix): rides, hikes and trail runs carry none.
  return out.map((s) => (isSampleRoadRunId(s.activityId) ? s : { ...s, decouplingPercent: undefined }));
}
