// A climbing session, read out of COROS's detail payload: its routes or
// problems, how each went, and the time on the wall against the time between.
//
// The field names and codes are COROS's web app's own (training.coros.com
// reads the same payload; no account here has a climb, so nothing is probed
// live). A climb is a lap of `lapList`'s `lapItemList`:
// - `mode` 3 is a rest lap, every other lap of an indoor climb or a boulder
//   session is a climb (the web app's lap table drops the rests);
// - an outdoor climb (802) or a multi-pitch (10003) is told in stages —
//   `sportStage` on the first, `mutliPitchStage` (COROS's spelling) on the
//   second: 0 the approach, 1 the climb, 2 the descent — and its climbing laps
//   are pitches, gathered into routes by `routeIndex`;
// - `gradingSystem` and `hardestGrade` are the grade (`climbGrades.ts`),
//   `style` how it went (0 redpoint, 1 onsight, 2 flash, 3 attempt, 5 repeat,
//   255 not recorded), `falls` the falls, `elevGain` the height in metres.
// Times are hundredths of a second, as everywhere in this payload.
//
// Written for both layers, like swimDetail.ts. No `node:` imports.

import type {
  ClimbStyle,
  ClimbSummary,
  TrainingHubClimb,
  TrainingHubClimbDetail
} from "./types";
import { climbGradeOf, type ClimbFamily } from "./climbGrades";

/**
 * Bump when a stored climb summary changes shape or meaning; a row written by
 * an older version is read again rather than trusted.
 */
export const CLIMB_SUMMARY_VERSION = 1;

export const INDOOR_CLIMB_SPORT_TYPE = 800;
export const BOULDERING_SPORT_TYPE = 801;
export const OUTDOOR_CLIMB_SPORT_TYPE = 802;
export const MULTI_PITCH_SPORT_TYPE = 10003;

const CLIMB_SPORT_TYPES: ReadonlySet<number> = new Set([
  INDOOR_CLIMB_SPORT_TYPE,
  BOULDERING_SPORT_TYPE,
  OUTDOOR_CLIMB_SPORT_TYPE,
  MULTI_PITCH_SPORT_TYPE
]);

/** An indoor climb, a boulder session, an outdoor climb or a multi-pitch. */
export function isClimbSportType(sportType: number | undefined): boolean {
  return sportType !== undefined && CLIMB_SPORT_TYPES.has(sportType);
}

/** The ladder a session's climbs are graded on, by its sport. */
export function climbFamilyOfSport(sportType: number | undefined): ClimbFamily {
  return sportType === BOULDERING_SPORT_TYPE ? "boulder" : "route";
}

/** COROS's `style` codes (`CLIMB_STYLE`). Anything else was not recorded. */
const STYLE_BY_CODE: Readonly<Record<number, ClimbStyle>> = {
  0: "redpoint",
  1: "onsight",
  2: "flash",
  3: "attempt",
  5: "repeat",
  255: "unrecorded"
};

export function climbStyleOf(code: unknown): ClimbStyle {
  const value = num(code);
  return (value !== undefined ? STYLE_BY_CODE[value] : undefined) ?? "unrecorded";
}

/** The climber reached the top: every style but an attempt, and one nobody marked. */
export function isSend(style: ClimbStyle): boolean {
  return style !== "attempt" && style !== "unrecorded";
}

/** Sent on the first go: onsight or flash. */
export function isFirstGo(style: ClimbStyle): boolean {
  return style === "onsight" || style === "flash";
}

/** COROS's lap `mode` for a rest (the web app's `Pr`). */
const REST_MODE = 3;
/** The climbing stage of an outdoor climb or a multi-pitch (`H2026`, "Climb"). */
const CLIMB_STAGE = 1;
/** COROS's `lapList` group of laps (`{ Lap: 2, Length: 1 }`). */
const LAP_TYPE_LAP = 2;

function num(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function positive(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** The laps of the payload: the lap group where there is one, else the first group. */
function lapItems(raw: Record<string, unknown>): Record<string, unknown>[] {
  const summary = asRecord(raw.summary);
  for (const source of [raw, summary]) {
    const list = source?.lapList;
    if (!Array.isArray(list)) continue;
    const groups = list.flatMap((entry) => {
      const group = asRecord(entry);
      return group && Array.isArray(group.lapItemList) ? [group] : [];
    });
    const group = groups.find((entry) => num(entry.type) === LAP_TYPE_LAP) ?? groups[0];
    if (group) {
      return (group.lapItemList as unknown[]).flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      });
    }
  }
  return [];
}

/** A lap's time in seconds, from `time` or its two timestamps. */
function lapSeconds(item: Record<string, unknown>): number {
  let raw = num(item.time) ?? num(item.totalTime);
  if (raw === undefined) {
    const start = num(item.startTimestamp);
    const end = num(item.endTimestamp);
    raw = start !== undefined && end !== undefined && end > start ? end - start : 0;
  }
  return Math.max(0, round(raw / 100, 2));
}

/** A lap's start, in seconds from the session's, where both are stamped. */
function lapStart(item: Record<string, unknown>, sessionStart: number | undefined): number | undefined {
  const start = num(item.startTimestamp);
  if (start === undefined || sessionStart === undefined || start < sessionStart) return undefined;
  return round((start - sessionStart) / 100, 2);
}

interface ClimbLap {
  start?: number;
  seconds: number;
  system?: number;
  gradeIndex?: number;
  style: ClimbStyle;
  falls?: number;
  height?: number;
  avgHr?: number;
  maxHr?: number;
  route?: number;
}

function readLap(item: Record<string, unknown>, sessionStart: number | undefined, sportType: number): ClimbLap {
  const system = num(item.gradingSystem);
  const gradeIndex = num(item.hardestGrade);
  const graded = climbGradeOf(sportType, system, gradeIndex);
  const falls = num(item.falls);
  const height = positive(item.elevGain);
  const avgHr = positive(item.avgHr);
  const maxHr = positive(item.maxHr);
  const start = lapStart(item, sessionStart);
  const route = num(item.routeIndex);
  return {
    ...(start !== undefined ? { start } : {}),
    seconds: lapSeconds(item),
    ...(graded ? { system: graded.system, gradeIndex: graded.index } : {}),
    style: climbStyleOf(item.style),
    ...(falls !== undefined && falls >= 0 ? { falls: Math.round(falls) } : {}),
    ...(height !== undefined ? { height: round(height, 1) } : {}),
    ...(avgHr !== undefined ? { avgHr: Math.round(avgHr) } : {}),
    ...(maxHr !== undefined ? { maxHr: Math.round(maxHr) } : {}),
    ...(route !== undefined ? { route } : {})
  };
}

/** The harder of two grades on the same session's ladder, by COROS's own steps. */
function harder(sportType: number, left: ClimbLap, right: ClimbLap): ClimbLap {
  const a = climbGradeOf(sportType, left.system, left.gradeIndex)?.ladder ?? -1;
  const b = climbGradeOf(sportType, right.system, right.gradeIndex)?.ladder ?? -1;
  return b > a ? right : left;
}

/**
 * The pitches of one route, as one climb: their time, falls and height added,
 * the hardest pitch's grade, and how the last pitch with a style went — as the
 * web app sums a route's laps (`Rr`).
 */
function routeOf(sportType: number, pitches: readonly ClimbLap[]): ClimbLap {
  const first = pitches[0]!;
  const graded = pitches.reduce((best, lap) => harder(sportType, best, lap), first);
  const marked = [...pitches].reverse().find((lap) => lap.style !== "unrecorded");
  const sum = (pick: (lap: ClimbLap) => number | undefined): number | undefined => {
    const values = pitches.map(pick).filter((value): value is number => value !== undefined);
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
  };
  const falls = sum((lap) => lap.falls);
  const height = sum((lap) => lap.height);
  const maxHr = Math.max(0, ...pitches.map((lap) => lap.maxHr ?? 0));
  const seconds = round(pitches.reduce((total, lap) => total + lap.seconds, 0), 2);
  const weighted = pitches.reduce(
    (acc, lap) => (lap.avgHr !== undefined ? { hr: acc.hr + lap.avgHr * lap.seconds, s: acc.s + lap.seconds } : acc),
    { hr: 0, s: 0 }
  );
  return {
    ...(first.start !== undefined ? { start: first.start } : {}),
    seconds,
    ...(graded.system !== undefined ? { system: graded.system, gradeIndex: graded.gradeIndex } : {}),
    style: marked?.style ?? "unrecorded",
    ...(falls !== undefined ? { falls } : {}),
    ...(height !== undefined ? { height: round(height, 1) } : {}),
    ...(weighted.s > 0 ? { avgHr: Math.round(weighted.hr / weighted.s) } : {}),
    ...(maxHr > 0 ? { maxHr } : {}),
    ...(first.route !== undefined ? { route: first.route } : {})
  };
}

export interface ParseClimbOptions {
  sportType?: number;
}

/** A climbing session's climbs (perhaps none), or undefined for another sport. */
export function parseClimbDetail(
  raw: Record<string, unknown>,
  options: ParseClimbOptions = {}
): TrainingHubClimbDetail | undefined {
  const summary = asRecord(raw.summary) ?? raw;
  const sportType = options.sportType ?? num(raw.sportType) ?? num(summary.sportType);
  if (sportType === undefined || !isClimbSportType(sportType)) {
    return undefined;
  }
  const sessionStart = num(summary.startTimestamp) ?? num(raw.startTimestamp);
  const items = lapItems(raw);
  const staged = sportType === OUTDOOR_CLIMB_SPORT_TYPE || sportType === MULTI_PITCH_SPORT_TYPE;
  const stageKey = sportType === MULTI_PITCH_SPORT_TYPE ? "mutliPitchStage" : "sportStage";
  const hasStages = staged && items.some((item) => num(item[stageKey]) !== undefined && num(item[stageKey]) !== 0);

  let restSeconds = 0;
  let restLaps = 0;
  const laps: ClimbLap[] = [];
  for (const item of items) {
    if (num(item.mode) === REST_MODE) {
      restSeconds += lapSeconds(item);
      restLaps += 1;
      continue;
    }
    // An outdoor day's approach and descent are walking, not climbing.
    if (hasStages && num(item[stageKey]) !== CLIMB_STAGE) {
      continue;
    }
    laps.push(readLap(item, sessionStart, sportType));
  }

  let pieces: ClimbLap[][];
  if (staged) {
    // Pitches gather into routes by `routeIndex`; a lap with none is a route.
    const byRoute = new Map<string, ClimbLap[]>();
    laps.forEach((lap, order) => {
      const key = lap.route !== undefined ? `r${lap.route}` : `l${order}`;
      const list = byRoute.get(key) ?? [];
      list.push(lap);
      byRoute.set(key, list);
    });
    pieces = [...byRoute.values()];
  } else {
    pieces = laps.map((lap) => [lap]);
  }
  // A session with no climbing laps still answers, with no climbs: a summary
  // that asked for its climbs and found none is not read again and again.
  const routes = pieces.map((pitches) => ({ climb: routeOf(sportType, pitches), pitches: pitches.length }));

  const climbs: TrainingHubClimb[] = routes.map(({ climb, pitches }, order) => {
    const next = routes[order + 1]?.climb;
    const restAfter =
      climb.start !== undefined && next?.start !== undefined
        ? Math.max(0, round(next.start - climb.start - climb.seconds, 2))
        : undefined;
    return {
      index: order + 1,
      ...(climb.start !== undefined ? { startSeconds: climb.start } : {}),
      seconds: climb.seconds,
      ...(restAfter !== undefined ? { restAfter } : {}),
      ...(climb.system !== undefined && climb.gradeIndex !== undefined
        ? { system: climb.system, gradeIndex: climb.gradeIndex }
        : {}),
      style: climb.style,
      ...(climb.falls !== undefined ? { falls: climb.falls } : {}),
      ...(climb.height !== undefined ? { heightMeters: climb.height } : {}),
      ...(climb.avgHr !== undefined ? { avgHr: climb.avgHr } : {}),
      ...(climb.maxHr !== undefined ? { maxHr: climb.maxHr } : {}),
      ...(pitches > 1 ? { pitches } : {})
    };
  });

  const climbingSeconds = round(climbs.reduce((total, climb) => total + climb.seconds, 0), 2);
  const falls = climbs.reduce((total, climb) => total + (climb.falls ?? 0), 0);
  const heights = climbs.map((climb) => climb.heightMeters).filter((value): value is number => value !== undefined);
  return {
    climbs,
    climbingSeconds,
    ...(restLaps > 0 ? { restSeconds: round(restSeconds, 2) } : {}),
    falls,
    ...(heights.length > 0 ? { heightMeters: round(heights.reduce((total, value) => total + value, 0), 1) } : {})
  };
}

/** What a session's summary keeps of its climbs. */
export function climbSummaryOf(detail: TrainingHubClimbDetail): ClimbSummary {
  return {
    version: CLIMB_SUMMARY_VERSION,
    climbs: detail.climbs.map((climb) => ({
      ...(climb.system !== undefined && climb.gradeIndex !== undefined
        ? { system: climb.system, gradeIndex: climb.gradeIndex }
        : {}),
      style: climb.style,
      seconds: Math.round(climb.seconds),
      ...(climb.falls !== undefined ? { falls: climb.falls } : {}),
      ...(climb.heightMeters !== undefined ? { heightMeters: climb.heightMeters } : {})
    })),
    climbingSeconds: Math.round(detail.climbingSeconds),
    ...(detail.restSeconds !== undefined ? { restSeconds: Math.round(detail.restSeconds) } : {}),
    falls: detail.falls,
    ...(detail.heightMeters !== undefined ? { heightMeters: detail.heightMeters } : {})
  };
}
