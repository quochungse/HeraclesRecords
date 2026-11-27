import type {
  ActivityDetailSummary,
  ClimbStyle,
  ClimbSummary,
  TrainingHubActivity,
  WorkoutEditorContext
} from "../../electron/types";
import { CLIMB_SUMMARY_VERSION, climbFamilyOfSport, isFirstGo, isSend } from "../../electron/climbDetail";
import {
  CLIMB_DISPLAY_SYSTEMS,
  DEFAULT_CLIMB_SYSTEM,
  climbGradeOf,
  gradeNameOnLadder,
  ladderRungs,
  onsightLadder,
  rungIndexFor,
  type ClimbFamily,
  type LadderRung
} from "../../electron/climbGrades";
import { runWindowStartMs, startOfRunWeekMs } from "../running/runMetrics";
import { getIntlLocale } from "../i18n/core";
import { CLIMB_KINDS, classifyClimbKind, gradeLabel, type ClimbKind } from "./climbType";
import type { ClimbStyleGroup } from "./climbColors";

// "The last N weeks" is one definition across the sport screens — calendar
// weeks from a Monday, this one included — owned by the run module.
export { runWindowStartMs as climbWindowStartMs } from "../running/runMetrics";

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** COROS sends epoch seconds on the activity list. */
function startedAtMs(activity: TrainingHubActivity): number | undefined {
  const seconds = positive(activity.startTime);
  return seconds === undefined ? undefined : seconds * 1000;
}

/** A session's climbs as this build reads them, or nothing until its summary is read. */
export function climbSummaryFor(
  activity: TrainingHubActivity,
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): ClimbSummary | undefined {
  const summary = summaries.get(activity.activityId);
  return summary?.climbVersion === CLIMB_SUMMARY_VERSION ? summary.climb : undefined;
}

/** One climb of one session, placed on its ladder. */
export interface ClimbRecord {
  activity: TrainingHubActivity;
  kind: ClimbKind;
  family: ClimbFamily;
  /** The grade's step on its family's ladder; absent when the climb was not graded. */
  ladder?: number;
  /** COROS's scale of the grade as recorded. */
  system?: number;
  style: ClimbStyle;
  seconds: number;
  falls?: number;
  heightMeters?: number;
}

/** Every climb of these sessions whose summaries are read, oldest session first. */
export function climbRecords(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): ClimbRecord[] {
  const out: ClimbRecord[] = [];
  const ordered = [...activities].sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));
  for (const activity of ordered) {
    const kind = classifyClimbKind(activity.sportType);
    const summary = kind ? climbSummaryFor(activity, summaries) : undefined;
    if (!kind || !summary) continue;
    for (const entry of summary.climbs) {
      const grade = climbGradeOf(activity.sportType, entry.system, entry.gradeIndex);
      out.push({
        activity,
        kind,
        family: grade?.family ?? climbFamilyOfSport(activity.sportType),
        ...(grade ? { ladder: grade.ladder, system: grade.system } : {}),
        style: entry.style,
        seconds: entry.seconds,
        ...(entry.falls !== undefined ? { falls: entry.falls } : {}),
        ...(entry.heightMeters !== undefined ? { heightMeters: entry.heightMeters } : {})
      });
    }
  }
  return out;
}

export function styleGroupOf(style: ClimbStyle): ClimbStyleGroup {
  if (isFirstGo(style)) return "firstGo";
  if (style === "redpoint" || style === "repeat") return "worked";
  if (style === "attempt") return "attempt";
  return "unrecorded";
}

/**
 * The scales grades are shown in, and the athlete's onsight on each ladder.
 *
 * The scale is the one the athlete chose in COROS's climb settings; without
 * one, the scale most of their climbs were graded in; without that, COROS's
 * defaults. Every grade is converted onto it through COROS's own common
 * ladder, so a session graded in French and one in YDS sit in one pyramid —
 * the way a climber who travels reads their grades in the scale they grew up on.
 */
export interface ClimbScales {
  route: number;
  boulder: number;
  onsight: Partial<Record<ClimbFamily, number>>;
}

export function climbScales(
  context: WorkoutEditorContext | undefined,
  records: readonly ClimbRecord[]
): ClimbScales {
  const pick = (family: ClimbFamily, setting: { system: number } | undefined): number => {
    const allowed = CLIMB_DISPLAY_SYSTEMS[family];
    if (setting && allowed.includes(setting.system)) return setting.system;
    const counts = new Map<number, number>();
    for (const record of records) {
      if (record.family === family && record.system !== undefined && allowed.includes(record.system)) {
        counts.set(record.system, (counts.get(record.system) ?? 0) + 1);
      }
    }
    let best = DEFAULT_CLIMB_SYSTEM[family];
    let most = 0;
    for (const [system, count] of counts) {
      if (count > most) {
        most = count;
        best = system;
      }
    }
    return best;
  };
  const routeSetting = context?.climbSettings?.indoorClimb;
  const boulderSetting = context?.climbSettings?.bouldering;
  const onsight: ClimbScales["onsight"] = {};
  const routeOnsight = routeSetting ? onsightLadder("route", routeSetting.system, routeSetting.gradeIndex) : undefined;
  const boulderOnsight = boulderSetting
    ? onsightLadder("boulder", boulderSetting.system, boulderSetting.gradeIndex)
    : undefined;
  if (routeOnsight !== undefined) onsight.route = routeOnsight;
  if (boulderOnsight !== undefined) onsight.boulder = boulderOnsight;
  return { route: pick("route", routeSetting), boulder: pick("boulder", boulderSetting), onsight };
}

/** A step of a ladder named in the scale the screen shows it in. */
export function gradeName(family: ClimbFamily, ladder: number, scales: ClimbScales): string {
  return gradeLabel(gradeNameOnLadder(family, scales[family], ladder));
}

/** The rungs of the scale the screen shows a family in. */
export function scaleRungs(family: ClimbFamily, scales: ClimbScales): LadderRung[] {
  return ladderRungs(family, scales[family]);
}

/** The hardest send among these climbs of one family, if any was graded. */
export function hardestSend(
  records: readonly ClimbRecord[],
  family: ClimbFamily
): ClimbRecord | undefined {
  let best: ClimbRecord | undefined;
  for (const record of records) {
    if (record.family !== family || record.ladder === undefined || !isSend(record.style)) continue;
    // The first time a grade was sent stands: a repeat is not a new best.
    if (!best || record.ladder > (best.ladder ?? 0)) best = record;
  }
  return best;
}

/** Sends against everything marked, one family: a climb nobody marked counts in neither. */
export function sendRate(
  records: readonly ClimbRecord[],
  family: ClimbFamily
): { sent: number; marked: number } {
  let sent = 0;
  let marked = 0;
  for (const record of records) {
    if (record.family !== family || record.style === "unrecorded") continue;
    marked += 1;
    if (isSend(record.style)) sent += 1;
  }
  return { sent, marked };
}

/**
 * Climbs of the sessions inside the last `weeks` calendar weeks, this one
 * included — cut at a Monday, as every sport screen's "N weeks" and Overview's are.
 */
export function recordsWithin(
  records: readonly ClimbRecord[],
  weeks: number,
  nowMs: number
): ClimbRecord[] {
  const from = runWindowStartMs(weeks, nowMs);
  return records.filter((record) => (startedAtMs(record.activity) ?? 0) >= from);
}

export interface PyramidRow {
  name: string;
  counts: Record<ClimbStyleGroup, number>;
  total: number;
  /** The athlete's onsight grade, from COROS's climb settings. */
  onsight: boolean;
}

export interface GradePyramid {
  /** Hardest first, from the hardest climbed down to the easiest climbed. */
  rows: PyramidRow[];
  graded: number;
  sent: number;
  /** Climbs of this family no grade was recorded for. */
  ungraded: number;
  hardest?: ClimbRecord;
}

/** Every graded climb of one family, counted on the rungs of the scale shown. */
export function gradePyramid(
  records: readonly ClimbRecord[],
  family: ClimbFamily,
  scales: ClimbScales
): GradePyramid {
  const rungs = scaleRungs(family, scales);
  const counts = rungs.map(() => ({ firstGo: 0, worked: 0, attempt: 0, unrecorded: 0 }));
  let graded = 0;
  let sent = 0;
  let ungraded = 0;
  let low = rungs.length;
  let high = -1;
  for (const record of records) {
    if (record.family !== family) continue;
    if (record.ladder === undefined) {
      ungraded += 1;
      continue;
    }
    const index = rungIndexFor(rungs, record.ladder);
    counts[index]![styleGroupOf(record.style)] += 1;
    graded += 1;
    if (isSend(record.style)) sent += 1;
    low = Math.min(low, index);
    high = Math.max(high, index);
  }
  const onsight = scales.onsight[family];
  const onsightIndex = onsight === undefined ? -1 : rungIndexFor(rungs, onsight);
  if (onsightIndex >= 0 && high >= 0) {
    low = Math.min(low, onsightIndex);
    high = Math.max(high, onsightIndex);
  }
  const rows: PyramidRow[] = [];
  for (let index = high; index >= low && index >= 0; index -= 1) {
    const entry = counts[index]!;
    rows.push({
      name: gradeLabel(rungs[index]!.name),
      counts: entry,
      total: entry.firstGo + entry.worked + entry.attempt + entry.unrecorded,
      onsight: index === onsightIndex
    });
  }
  const hardest = hardestSend(records, family);
  return { rows, graded, sent, ungraded, ...(hardest ? { hardest } : {}) };
}

export interface ClimbKindVolume {
  sessions: number;
  duration: number;
  /** Climbs counted, over the sessions whose summaries are read. */
  climbs: number;
  climbingSeconds: number;
}

export interface ClimbWeek extends ClimbKindVolume {
  weekStartMs: number;
  label: string;
  byKind: Record<ClimbKind, ClimbKindVolume>;
  /** Sessions in the week whose climbs are not read yet. */
  unread: number;
  /** Per family: the hardest send's step and the average step of what was sent. */
  hardest: Partial<Record<ClimbFamily, number>>;
  sentLadder: Partial<Record<ClimbFamily, { sum: number; count: number }>>;
}

function emptyVolume(): ClimbKindVolume {
  return { sessions: 0, duration: 0, climbs: 0, climbingSeconds: 0 };
}

function weekLabel(weekStartMs: number): string {
  return new Date(weekStartMs).toLocaleDateString(getIntlLocale(), { month: "short", day: "numeric" });
}

/**
 * One bucket per week, oldest first, with no gaps — the shape of
 * `buildSwimWeeks`. Sessions and their time come off the list; climbs, the
 * time on the wall and the grades off each session's summary.
 */
export function buildClimbWeeks(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  { weeks, nowMs = Date.now() }: { weeks: number; nowMs?: number }
): ClimbWeek[] {
  if (weeks <= 0) {
    return [];
  }
  const currentWeekStart = startOfRunWeekMs(nowMs);
  const buckets = new Map<number, ClimbWeek>();
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const cursor = new Date(currentWeekStart);
    cursor.setDate(cursor.getDate() - index * 7);
    const weekStartMs = cursor.getTime();
    buckets.set(weekStartMs, {
      weekStartMs,
      label: weekLabel(weekStartMs),
      ...emptyVolume(),
      byKind: Object.fromEntries(CLIMB_KINDS.map((kind) => [kind, emptyVolume()])) as Record<ClimbKind, ClimbKindVolume>,
      unread: 0,
      hardest: {},
      sentLadder: {}
    });
  }

  for (const activity of activities) {
    const kind = classifyClimbKind(activity.sportType);
    const at = startedAtMs(activity);
    if (kind === null || at === undefined) continue;
    const bucket = buckets.get(startOfRunWeekMs(at));
    if (!bucket) continue;
    const duration = positive(activity.duration) ?? 0;
    const summary = climbSummaryFor(activity, summaries);
    const own = bucket.byKind[kind];
    for (const volume of [bucket, own]) {
      volume.sessions += 1;
      volume.duration += duration;
      if (summary) {
        volume.climbs += summary.climbs.length;
        volume.climbingSeconds += summary.climbingSeconds;
      }
    }
    if (!summary) {
      bucket.unread += 1;
      continue;
    }
    for (const entry of summary.climbs) {
      const grade = climbGradeOf(activity.sportType, entry.system, entry.gradeIndex);
      if (!grade || !isSend(entry.style)) continue;
      bucket.hardest[grade.family] = Math.max(bucket.hardest[grade.family] ?? 0, grade.ladder);
      const sent = bucket.sentLadder[grade.family] ?? { sum: 0, count: 0 };
      sent.sum += grade.ladder;
      sent.count += 1;
      bucket.sentLadder[grade.family] = sent;
    }
  }

  return [...buckets.values()].sort((left, right) => left.weekStartMs - right.weekStartMs);
}

export type ClimbVolumeMeasure = "climbs" | "time" | "sessions";

/** A week by one measure: climbs counted, hours on the wall, or sessions. */
export function measuredClimb(volume: ClimbKindVolume, measure: ClimbVolumeMeasure): number {
  if (measure === "time") return volume.climbingSeconds / 3600;
  if (measure === "sessions") return volume.sessions;
  return volume.climbs;
}

export interface ClimbTotals {
  sessions: number;
  duration: number;
  /** Over the sessions whose climbs are read. */
  climbs: number;
  climbingSeconds: number;
  heightMeters: number;
  falls: number;
  /** Sessions whose climbs are read: the figures above that need them stand for these. */
  read: number;
}

export function summariseClimbs(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): ClimbTotals {
  const totals: ClimbTotals = { sessions: 0, duration: 0, climbs: 0, climbingSeconds: 0, heightMeters: 0, falls: 0, read: 0 };
  for (const activity of activities) {
    if (classifyClimbKind(activity.sportType) === null) continue;
    totals.sessions += 1;
    totals.duration += positive(activity.duration) ?? 0;
    const summary = climbSummaryFor(activity, summaries);
    if (!summary) continue;
    totals.read += 1;
    totals.climbs += summary.climbs.length;
    totals.climbingSeconds += summary.climbingSeconds;
    totals.heightMeters += summary.heightMeters ?? 0;
    totals.falls += summary.falls;
  }
  return totals;
}

/** A session list's totals for the year-ago comparison: sessions only, the list has no climbs. */
export function sessionTotals(activities: readonly TrainingHubActivity[]): ClimbKindVolume {
  return {
    sessions: activities.length,
    duration: activities.reduce((sum, activity) => sum + (positive(activity.duration) ?? 0), 0),
    climbs: 0,
    climbingSeconds: 0
  };
}

export interface ClimbKindShare {
  kind: ClimbKind;
  /** Of the sessions in the window. */
  share: number;
  sessions: number;
  climbs: number;
  climbingSeconds: number;
  /** The hardest send, named in the scale shown. */
  hardest?: string;
  sent?: { sent: number; marked: number };
}

/** The kinds climbed, by sessions — the one block the kind filter does not narrow. */
export function climbKindBreakdown(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  scales: ClimbScales
): ClimbKindShare[] {
  const sessions = activities.filter((activity) => classifyClimbKind(activity.sportType) !== null);
  const total = sessions.length;
  return CLIMB_KINDS.flatMap((kind) => {
    const own = sessions.filter((activity) => classifyClimbKind(activity.sportType) === kind);
    if (own.length === 0) return [];
    const records = climbRecords(own, summaries);
    const family: ClimbFamily = kind === "boulder" ? "boulder" : "route";
    const best = hardestSend(records, family);
    const rate = sendRate(records, family);
    const totals = summariseClimbs(own, summaries);
    return [
      {
        kind,
        share: total > 0 ? own.length / total : 0,
        sessions: own.length,
        climbs: totals.climbs,
        climbingSeconds: totals.climbingSeconds,
        ...(best?.ladder !== undefined ? { hardest: gradeName(family, best.ladder, scales) } : {}),
        ...(rate.marked > 0 ? { sent: rate } : {})
      }
    ];
  });
}

export interface WallFigures {
  /** Of the session time, the time spent climbing. */
  share?: number;
  avgRouteSeconds?: number;
  avgProblemSeconds?: number;
  /** Session time off the wall, per climb. */
  restPerClimb?: number;
  fallsPerClimb?: number;
}

/** How a session is spent: on the wall, and between climbs. */
export function wallFigures(
  activities: readonly TrainingHubActivity[],
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): WallFigures {
  let session = 0;
  let climbing = 0;
  let climbs = 0;
  let falls = 0;
  const routes = { seconds: 0, count: 0 };
  const problems = { seconds: 0, count: 0 };
  for (const activity of activities) {
    const summary = climbSummaryFor(activity, summaries);
    const duration = positive(activity.duration);
    if (!summary || !duration || summary.climbs.length === 0) continue;
    session += duration;
    climbing += summary.climbingSeconds;
    climbs += summary.climbs.length;
    falls += summary.falls;
    const bucket = climbFamilyOfSport(activity.sportType) === "boulder" ? problems : routes;
    bucket.seconds += summary.climbingSeconds;
    bucket.count += summary.climbs.length;
  }
  if (climbs === 0 || session === 0) return {};
  return {
    share: Math.min(1, climbing / session),
    ...(routes.count > 0 ? { avgRouteSeconds: routes.seconds / routes.count } : {}),
    ...(problems.count > 0 ? { avgProblemSeconds: problems.seconds / problems.count } : {}),
    restPerClimb: Math.max(0, session - climbing) / climbs,
    fallsPerClimb: falls / climbs
  };
}

/** `2:48` for a climb's minutes and seconds; an hour or more as `1:02:05`. */
export function formatClimbClock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = String(rounded % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
