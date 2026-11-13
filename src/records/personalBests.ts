import type {
  TrainingHubActivity,
  TrainingHubPersonalRecordGroup
} from "../../electron/types";
import { isRideSportType } from "../cycling/rideType";
import { isHikeSportType } from "../hiking/hikeType";
import { isRunSportType } from "../running/runSurface";
import { isSwimSportType } from "../training/sportTypes";
import { capitalizeFirst, t } from "../i18n/core";
import {
  ageGrade,
  ageOnDay,
  athleteSex,
  isAgeGradedDistance
} from "./fitnessStandards";

// Node-free like everything under `src/records`, so the suites reach it.

/**
 * The Personal Records page, worked out with the rest of the hall
 * (`computeRecords`): the best time at each running distance for each of
 * COROS's periods, every time the all-time one fell, and the farthest and
 * highest the athlete has gone.
 *
 * The figures are COROS's own where it has them — they are the ones the
 * athlete sees on the watch and in the COROS app. What COROS does not keep, a
 * record's history, is read from the best efforts the hall already walks.
 */

/** COROS's record periods, by their dashboard group (`recordDetailList[].type`). */
export type RecordPeriod = "all" | "half" | "w12" | "w4";

export const RECORD_PERIODS: readonly RecordPeriod[] = ["all", "half", "w12", "w4"];

const COROS_PERIOD_GROUP: Readonly<Record<RecordPeriod, number>> = {
  all: 4,
  half: 2,
  w12: 3,
  w4: 1
};

/** How far back each period reaches, on the app's one period scale. */
export const RECORD_PERIOD_DAYS: Readonly<Record<RecordPeriod, 28 | 84 | 180 | null>> = {
  all: null,
  half: 180,
  w12: 84,
  w4: 28
};

/** One run at a distance: the time, the day, and the session it was run in. */
export interface RecordRun {
  seconds: number;
  /** Local `YYYYMMDD`. */
  day: string;
  activity?: { activityId: string; sportType: number; startTime?: number };
  /** The session's name, where COROS has one. */
  name?: string;
  /** Age grade 0–1 on its own day, at a graded distance (5K and longer). */
  grade?: number;
}

export interface DistanceRecord {
  /** Stable: "1k", "5k", "10k", "half", "marathon". */
  key: string;
  /** Metres. */
  distance: number;
  label: string;
  /** The best for each period that has one. */
  best: Partial<Record<RecordPeriod, RecordRun>>;
  /** Every time the all-time record fell, oldest first. */
  history: RecordRun[];
}

/** A distance or a height in one session. */
export interface FarthestMark {
  meters: number;
  day: string;
  activity?: RecordRun["activity"];
  name?: string;
}

export type BeyondKey = "ride" | "swim" | "hike" | "rideClimb";

export interface RecordBoard {
  /** Every running distance, in order, whether or not it has a record. */
  distances: DistanceRecord[];
  longestRun?: FarthestMark;
  mostClimb?: FarthestMark;
  /** The farthest and highest outside running, those the athlete has done. */
  beyond: Array<{ key: BeyondKey; mark: FarthestMark }>;
  /** The distance whose all-time record grades highest for age and sex. */
  bestByStandard?: string;
}

/**
 * The distances on the board, with COROS's record type for each: those the hall
 * reads off every run's best efforts (`BEST_EFFORT_DISTANCES`), so each has a
 * history. COROS's 3K is a figure without one, and is left out.
 */
const BOARD_DISTANCES: ReadonlyArray<{ key: string; distance: number; corosType: number; label: () => string }> = [
  { key: "1k", distance: 1000, corosType: 7, label: () => "1K" },
  { key: "5k", distance: 5000, corosType: 5, label: () => "5K" },
  { key: "10k", distance: 10000, corosType: 4, label: () => "10K" },
  { key: "half", distance: 21097.5, corosType: 2, label: () => capitalizeFirst(t("records.dist.half")) },
  { key: "marathon", distance: 42195, corosType: 13, label: () => capitalizeFirst(t("records.dist.marathon")) }
];

/** COROS's longest run and most elevation gain, in the all-time group. */
const COROS_LONGEST_RUN = 101;
const COROS_MOST_CLIMB = 103;

export interface RecordBoardInput {
  /** Oldest first. */
  activities: readonly TrainingHubActivity[];
  groups: readonly TrainingHubPersonalRecordGroup[] | undefined;
  /** Every time each distance's record fell, oldest first, by metres. */
  fell: ReadonlyMap<number, readonly RecordRun[]>;
  athlete?: { birthday?: number; sex?: number };
  /** Local `YYYYMMDD`. */
  today: string;
}

const isDay = (day: string | undefined): day is string => Boolean(day && /^\d{8}$/.test(day));

export function buildRecordBoard(input: RecordBoardInput): RecordBoard {
  const byId = new Map(input.activities.map((activity) => [activity.activityId, activity]));
  const sex = athleteSex(input.athlete?.sex);
  const graded = (distance: number, run: RecordRun): RecordRun =>
    isAgeGradedDistance(distance)
      ? { ...run, grade: ageGrade(distance, run.seconds, ageOnDay(input.athlete?.birthday, run.day), sex) }
      : run;
  const session = (activityId: string | undefined) => {
    const activity = activityId ? byId.get(activityId) : undefined;
    if (!activity) return {};
    return {
      activity: {
        activityId: activity.activityId,
        sportType: activity.sportType,
        ...(activity.startTime ? { startTime: activity.startTime } : {})
      },
      ...(activity.name ? { name: activity.name } : {})
    };
  };
  const group = (period: RecordPeriod) =>
    input.groups?.find((candidate) => candidate.type === COROS_PERIOD_GROUP[period]);

  const distances = BOARD_DISTANCES.map((entry): DistanceRecord => {
    const history = (input.fell.get(entry.distance) ?? []).map((run) => graded(entry.distance, run));
    const best: DistanceRecord["best"] = {};
    for (const period of RECORD_PERIODS) {
      const record = group(period)?.records.find((candidate) => candidate.type === entry.corosType);
      if (!record?.duration || record.duration <= 0 || !isDay(record.happenDay)) continue;
      best[period] = graded(entry.distance, {
        seconds: record.duration,
        day: record.happenDay,
        ...session(record.activityId)
      });
    }
    // Before COROS has answered — or for a record it does not keep — the
    // all-time best is the last time the history fell.
    const last = history[history.length - 1];
    if (!best.all && last) best.all = last;
    return {
      key: entry.key,
      distance: entry.distance,
      get label() {
        return entry.label();
      },
      best,
      history
    };
  });

  // COROS keeps these two in the same group, as a distance in metres.
  const allTime = group("all")?.records ?? [];
  const corosMark = (type: number): FarthestMark | undefined => {
    const record = allTime.find((candidate) => candidate.type === type);
    if (!record?.distance || record.distance <= 0 || !isDay(record.happenDay)) return undefined;
    return { meters: record.distance, day: record.happenDay, ...session(record.activityId) };
  };

  // The rest is read off the activity list: the farthest of each sport, and
  // the most climbed on a ride.
  const farthest = new Map<BeyondKey | "run" | "runClimb", FarthestMark>();
  const keep = (key: BeyondKey | "run" | "runClimb", meters: number | undefined, activity: TrainingHubActivity) => {
    if (!meters || meters <= 0 || !activity.startTime) return;
    const held = farthest.get(key);
    if (held && held.meters >= meters) return;
    farthest.set(key, { meters, day: localDay(activity.startTime), ...session(activity.activityId) });
  };
  for (const activity of input.activities) {
    if (isRunSportType(activity.sportType)) {
      keep("run", activity.distance, activity);
      keep("runClimb", activity.elevationGain, activity);
    } else if (isRideSportType(activity.sportType)) {
      keep("ride", activity.distance, activity);
      keep("rideClimb", activity.elevationGain, activity);
    } else if (isSwimSportType(activity.sportType)) {
      keep("swim", activity.distance, activity);
    } else if (isHikeSportType(activity.sportType)) {
      keep("hike", activity.distance, activity);
    }
  }

  const longestRun = corosMark(COROS_LONGEST_RUN) ?? farthest.get("run");
  const mostClimb = corosMark(COROS_MOST_CLIMB) ?? farthest.get("runClimb");
  const beyond = (["ride", "swim", "hike", "rideClimb"] as const).flatMap((key) => {
    const mark = farthest.get(key);
    return mark ? [{ key, mark }] : [];
  });

  let bestByStandard: string | undefined;
  let bestGrade = 0;
  for (const row of distances) {
    const grade = row.best.all?.grade ?? 0;
    if (grade > bestGrade) {
      bestGrade = grade;
      bestByStandard = row.key;
    }
  }

  return {
    distances,
    ...(longestRun ? { longestRun } : {}),
    ...(mostClimb ? { mostClimb } : {}),
    beyond,
    ...(bestByStandard ? { bestByStandard } : {})
  };
}

/** Days between two local `YYYYMMDD` days. */
export function daysFrom(from: string, to: string): number {
  const at = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** How many records a board holds: a distance with an all-time best, and the two farthest. */
export function recordCount(board: RecordBoard): number {
  return (
    board.distances.filter((row) => row.best.all).length +
    (board.longestRun ? 1 : 0) +
    (board.mostClimb ? 1 : 0)
  );
}

function localDay(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}
