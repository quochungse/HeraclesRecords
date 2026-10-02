// The Hall of Records' arithmetic: every milestone, worked out from what the
// app already holds, and how far along each labour's open stage is.
//
// Out of the view for the reason `activityFilters.ts` sits outside
// `ActivitiesView`: it is the only part of the screen a test can reach, and it
// is the part that decides what the athlete is told they did.
//
// **Worked out again every time, not stored.** The activity list is complete —
// COROS keeps it for good — so a first, a ladder distance, a streak or a
// lifetime total can always be found again, and storing them would only give
// two machines a way to disagree. What a source forgets (VO2max past a year,
// nights past what a machine kept, plan runs) arrives as `remembered`, from
// `athlete_milestones`, and what this module works out of those sources goes
// back out as `toRemember`.
//
// **An id is the fact, not the moment.** `first:run`, `streak:weeks:26`,
// `pr:5000:<activityId>`: computing twice gives the same id, which is what the
// "New" badge and the notifications are keyed on, and what lets a remembered
// row and a freshly computed one be the same milestone.

import type {
  ActivityDetailSummary,
  BestEffort,
  RememberedMilestone,
  TrainingHubActivity,
  TrainingHubPersonalRecordGroup,
  UnitSystem
} from "../../electron/types";
import {
  distanceUnit,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  metersToDisplayDistance
} from "../../electron/unitSystem";
import { isRideSportType } from "../cycling/rideType";
import { isHikeSportType } from "../hiking/hikeType";
import { isRunSportType } from "../running/runSurface";
import { formatDurationSeconds, getLocalHappenDayKey } from "../training/formatters";
import { isStrengthSportType, isSwimSportType } from "../training/sportTypes";
import { RECORDS_SUMMARY_VERSION } from "../../electron/activityMetrics";
import { isIndoorSportType } from "../../electron/corosSportTypes";
import type { LabourId, LabourStage, StageProgress } from "./labours";
import { STAGE_NUMERALS, labourDefinition, labourStageKey } from "./labours";

export type MilestoneCategory =
  | "first"
  | "record"
  | "fitness"
  | "streak"
  | "lifetime"
  | "place"
  | "plan"
  | "sleep"
  | "anniversary";

/** The sport a milestone wears: its dot and its card's edge. */
export type RecordsSport = "run" | "ride" | "hike" | "swim" | "strength" | "other";

export interface MilestoneFigure {
  value: string;
  unit: string;
  label: string;
}

export interface Milestone {
  id: string;
  category: MilestoneCategory;
  /** Local `YYYYMMDD` it was reached. */
  day: string;
  /** Epoch seconds, for the order within a day. */
  at: number;
  /** The eyebrow: "First · Running", "Record", "Streak". */
  kind: string;
  title: string;
  /** One line of figures under a row. */
  detail?: string;
  /** A major milestone's card. */
  figures?: MilestoneFigure[];
  /** A sentence that puts it in its history. */
  context?: string;
  sport?: RecordsSport;
  /** Drawn as a card rather than a row. */
  major: boolean;
  /** The session it happened in, which its title opens. */
  activity?: { activityId: string; sportType: number; startTime?: number };
  /**
   * The labour stage it reached, if it reached one — the highest, when one
   * milestone reaches several at once (a 12-week plan kept at 91% is all three
   * of the Girdle's), with the others in `also`.
   */
  labour?: MilestoneLabour;
}

export interface MilestoneLabour {
  id: LabourId;
  stage: LabourStage;
  also?: LabourStage[];
}

/** Every stage a milestone reached, the badge's and the rest. */
export function stagesReached(labour: MilestoneLabour | undefined): LabourStage[] {
  return labour ? [labour.stage, ...(labour.also ?? [])] : [];
}

/** Fold one more stage into a milestone's labour: the badge keeps the highest. */
function withStage(
  current: MilestoneLabour | undefined,
  id: LabourId,
  stage: LabourStage
): MilestoneLabour {
  if (!current) return { id, stage };
  const all = [...stagesReached(current), stage];
  const top = Math.max(...all) as LabourStage;
  const rest = all.filter((entry) => entry !== top);
  return { id, stage: top, ...(rest.length > 0 ? { also: rest } : {}) };
}

/** A ~55 km cell of the 0.5° grid the globe clusters on, and a point in it. */
export interface PlaceCell {
  key: string;
  lat: number;
  lon: number;
  count: number;
}

export interface PlaceLabelLookup {
  city: string;
  country: string;
}

export interface WithinReach {
  id: string;
  /** "Hesperides · III", "Lifetime · Running". */
  label: string;
  title: string;
  value: string;
  hint: string;
  ratio: number;
  labour?: { id: LabourId; stage: LabourStage };
  sport?: RecordsSport;
}

export interface RecordsInput {
  activities: readonly TrainingHubActivity[];
  /** Stored summaries by activity id; the records figures are read off them. */
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** COROS's own current records (the dashboard's groups). */
  personalRecords?: readonly TrainingHubPersonalRecordGroup[];
  /** VO2max readings COROS still holds: `day` YYYYMMDD. */
  vo2Readings?: ReadonlyArray<{ day: string; value: number }>;
  /** One per night: the day's whole sleep in minutes (`totalSleepMinutes`). */
  sleepNights?: ReadonlyArray<{ day: string; minutes: number }>;
  remembered?: readonly RememberedMilestone[];
  /** Place names by cell key, where the geocoder has answered. */
  placeLabels?: Readonly<Record<string, PlaceLabelLookup>>;
  unitSystem: UnitSystem;
  /** Local `YYYYMMDD`; defaults to the clock. */
  today?: string;
}

export interface RecordsResult {
  /** Oldest first. */
  milestones: Milestone[];
  /** Progress towards each labour stage not yet reached, by `labourStageKey`. */
  progress: Map<string, StageProgress>;
  /** The nearest things to reach, best first. */
  withinReach: WithinReach[];
  /** VO2max and sleep milestones, for `athlete_milestones`. */
  toRemember: RememberedMilestone[];
  /** Every cell trained in, busiest first, so the screen can name them. */
  places: PlaceCell[];
  /** Runs whose summary does not yet carry best efforts and a start point. */
  pendingSummaries: number;
}

// --- Thresholds -------------------------------------------------------------

/** GPS rarely measures a course long: a half run on the line reads 21.0 km. */
const LADDER_TOLERANCE = 0.99;

interface LadderStep {
  distance: number;
  key: string;
  title: string;
  major: boolean;
  labour?: { id: LabourId; stage: LabourStage };
}

const RUN_LADDER: readonly LadderStep[] = [
  { distance: 10000, key: "10k", title: "First 10K", major: false },
  {
    distance: 21097.5,
    key: "half",
    title: "First half marathon distance",
    major: true,
    labour: { id: "bull", stage: 1 }
  },
  {
    distance: 42195,
    key: "marathon",
    title: "First marathon distance",
    major: true,
    labour: { id: "bull", stage: 2 }
  },
  { distance: 50000, key: "50k", title: "First 50K", major: true, labour: { id: "bull", stage: 3 } },
  { distance: 100000, key: "100k", title: "First 100K", major: true }
];

const RIDE_LADDER: readonly LadderStep[] = [
  { distance: 50000, key: "50k", title: "First 50 km ride", major: false },
  {
    distance: 100000,
    key: "100k",
    title: "First 100 km ride",
    major: true,
    labour: { id: "birds", stage: 2 }
  },
  {
    distance: 160934.4,
    key: "century",
    title: "First century ride",
    major: true,
    labour: { id: "birds", stage: 3 }
  },
  { distance: 200000, key: "200k", title: "First 200 km ride", major: true }
];

const SWIM_LADDER: readonly LadderStep[] = [
  { distance: 1000, key: "1k", title: "First 1 km swim", major: false },
  {
    distance: 1500,
    key: "1500",
    title: "First 1.5 km swim",
    major: false,
    labour: { id: "hydra", stage: 2 }
  },
  {
    distance: 3800,
    key: "3800",
    title: "First 3.8 km swim",
    major: true,
    labour: { id: "hydra", stage: 3 }
  }
];

interface ClimbStep {
  meters: number;
  labour?: { id: LabourId; stage: LabourStage };
  major: boolean;
}

/** Height gained in one activity. */
const CLIMB_LADDER: readonly ClimbStep[] = [
  { meters: 500, labour: { id: "boar", stage: 1 }, major: false },
  { meters: 1000, major: false },
  { meters: 1500, labour: { id: "boar", stage: 2 }, major: true },
  { meters: 2500, major: true }
];

/** Mount Everest, the unit a month's or a lifetime's climbing is counted in. */
export const EVEREST_METERS = 8849;

const LIFETIME_HOURS: ReadonlyArray<{ hours: number; labour?: LabourStage; major?: boolean }> = [
  { hours: 50 },
  { hours: 100, labour: 1 },
  { hours: 250 },
  { hours: 500, labour: 2 },
  { hours: 1000, labour: 3, major: true },
  { hours: 2000, major: true },
  { hours: 5000, major: true }
];
const LIFETIME_RUN_DISTANCE = [100, 500, 1000, 2000, 5000, 10000];
const LIFETIME_RIDE_DISTANCE = [1000, 5000, 10000, 25000];
const LIFETIME_EVERESTS = [1, 5, 10, 25, 50];
const LIFETIME_ACTIVITIES = [100, 250, 500, 1000, 2000];
const STRENGTH_SESSIONS: ReadonlyArray<{ count: number; labour?: LabourStage }> = [
  { count: 10 },
  { count: 50, labour: 2 },
  { count: 100, labour: 3 },
  { count: 250 }
];

const STREAK_WEEKS: ReadonlyArray<{ weeks: number; labour?: LabourStage; major?: boolean }> = [
  { weeks: 4, labour: 1 },
  { weeks: 8 },
  { weeks: 12 },
  { weeks: 26, labour: 2 },
  { weeks: 52, labour: 3, major: true },
  { weeks: 104, major: true },
  { weeks: 156, major: true }
];

const PLACE_COUNTS: ReadonlyArray<{ count: number; labour?: LabourStage }> = [
  { count: 5, labour: 1 },
  { count: 10 },
  { count: 25 },
  { count: 50 }
];
/** Tiryns to the Strait of Gibraltar, more or less: Heracles' western edge. */
export const PILLARS_KM = 2700;

/** A "longest yet" before this many of a sport is every other session. */
const LONGEST_AFTER_SESSIONS = 10;
const LONGEST_MARGIN = 1.1;
const CLIMB_RECORD_MIN_M = 300;
const WEEK_RECORD_AFTER_WEEKS = 8;
const WEEK_RECORD_MIN_SECONDS = 5 * 3600;

/** Seven hours of sleep, counted against the day's whole sleep. */
export const GOOD_NIGHT_MINUTES = 420;
const SLEEP_STREAKS: ReadonlyArray<{ nights: number; labour?: LabourStage }> = [
  { nights: 7, labour: 2 },
  { nights: 14 },
  { nights: 30, labour: 3 }
];

const PLAN_STAGES: ReadonlyArray<{ stage: LabourStage; weeks: number; ratio: number }> = [
  { stage: 1, weeks: 4, ratio: 0.8 },
  { stage: 2, weeks: 8, ratio: 0.85 },
  { stage: 3, weeks: 12, ratio: 0.9 }
];

/** The best-effort distances, with COROS's record type for each. */
export const RECORD_DISTANCES: ReadonlyArray<{ distance: number; label: string; corosType: number }> = [
  { distance: 1000, label: "1K", corosType: 7 },
  { distance: 5000, label: "5K", corosType: 5 },
  { distance: 10000, label: "10K", corosType: 4 },
  { distance: 21097.5, label: "half marathon", corosType: 2 },
  { distance: 42195, label: "marathon", corosType: 13 }
];
/** COROS's "All" record group: all-time bests. */
const COROS_ALL_TIME_GROUP = 4;
/**
 * Our own effort faster than this share of COROS's all-time record is a GPS
 * fault COROS's own algorithm did not fall for — COROS's record is the best
 * there has been, so nothing may beat it by much.
 */
const EFFORT_FLOOR_OF_COROS_RECORD = 0.97;
/** The three records the Mares' second stage asks to have improved. */
const MARES_SET = [5000, 10000, 21097.5];
/** How long a distance's first efforts set the bar before beating it is news. */
const RECORD_SETTLE_DAYS = 28;
/** And how much it has to be beaten by: a 1% gain on a 25-minute 5K is 15 s. */
const RECORD_MIN_GAIN = 0.01;

// --- Days -------------------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export function dayOfEpochSeconds(seconds: number): string {
  return getLocalHappenDayKey(new Date(seconds * 1000));
}

export function dateOfDay(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
}

function addDays(day: string, count: number): string {
  const date = dateOfDay(day);
  date.setDate(date.getDate() + count);
  return getLocalHappenDayKey(date);
}

function daysBetween(from: string, to: string): number {
  return Math.round((dateOfDay(to).getTime() - dateOfDay(from).getTime()) / 86_400_000);
}

/** The Monday a day's week starts on. */
export function weekOf(day: string): string {
  const date = dateOfDay(day);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return getLocalHappenDayKey(date);
}

/** Noon of a day, in epoch seconds: where a milestone with no session sits. */
function noonOf(day: string): number {
  const date = dateOfDay(day);
  date.setHours(12, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** "14 Jun 2026". */
export function formatDayShort(day: string): string {
  const date = dateOfDay(day);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "June 2025". */
function formatMonthYear(day: string): string {
  return dateOfDay(day).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

// --- Sports -----------------------------------------------------------------

export function recordsSportOf(sportType: number | undefined): RecordsSport {
  if (isRunSportType(sportType)) return "run";
  if (isRideSportType(sportType)) return "ride";
  if (isHikeSportType(sportType)) return "hike";
  if (isSwimSportType(sportType)) return "swim";
  if (isStrengthSportType(sportType)) return "strength";
  return "other";
}

const SPORT_NOUN: Readonly<Record<RecordsSport, string>> = {
  run: "Running",
  ride: "Cycling",
  hike: "Hiking",
  swim: "Swimming",
  strength: "Strength",
  other: "Training"
};

const FIRST_TITLE: Readonly<Record<Exclude<RecordsSport, "other">, string>> = {
  run: "First run",
  ride: "First ride",
  hike: "First hike",
  swim: "First swim",
  strength: "First strength session"
};

const FIRST_LABOUR: Partial<Record<RecordsSport, { id: LabourId; stage: LabourStage }>> = {
  ride: { id: "birds", stage: 1 },
  swim: { id: "hydra", stage: 1 },
  strength: { id: "lion", stage: 1 }
};

const LONGEST_TITLE: Partial<Record<RecordsSport, string>> = {
  run: "Longest run yet",
  ride: "Longest ride yet",
  hike: "Longest hike yet",
  swim: "Longest swim yet"
};

/**
 * Whether an activity's summary still lacks the records figures and is worth
 * a detail fetch for them: anything outdoor that moved — a run for its best
 * efforts, everything for where it started. An indoor session has neither.
 */
export function needsRecordsSummary(
  activity: Pick<TrainingHubActivity, "sportType" | "distance">,
  summary: Pick<ActivityDetailSummary, "recordsVersion"> | undefined
): boolean {
  if (summary?.recordsVersion === RECORDS_SUMMARY_VERSION) return false;
  if (isIndoorSportType(activity.sportType) || isStrengthSportType(activity.sportType)) return false;
  return (activity.distance ?? 0) > 0;
}

// --- Formatting ---------------------------------------------------------------

function splitValue(text: string): { value: string; unit: string } {
  const index = text.lastIndexOf(" ");
  return index < 0
    ? { value: text, unit: "" }
    : { value: text.slice(0, index), unit: text.slice(index + 1) };
}

function distanceFigure(meters: number, unitSystem: UnitSystem, swim = false): MilestoneFigure {
  return { ...splitValue(formatDistanceValue(meters, unitSystem, { swim })), label: "Distance" };
}

function groupThousands(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function activityLine(activity: TrainingHubActivity, unitSystem: UnitSystem): string {
  const sport = recordsSportOf(activity.sportType);
  const parts: string[] = [];
  if (activity.distance && activity.distance > 0) {
    parts.push(formatDistanceValue(activity.distance, unitSystem, { swim: sport === "swim" }));
  }
  if (activity.duration && activity.duration > 0) {
    parts.push(formatDurationSeconds(activity.duration));
  }
  if (sport === "run" && activity.distance && activity.duration && activity.distance > 0) {
    parts.push(formatPaceValue(activity.duration / (activity.distance / 1000), unitSystem));
  }
  return parts.join(" · ");
}

function activityFigures(activity: TrainingHubActivity, unitSystem: UnitSystem): MilestoneFigure[] {
  const sport = recordsSportOf(activity.sportType);
  const figures: MilestoneFigure[] = [];
  if (activity.distance && activity.distance > 0) {
    figures.push(distanceFigure(activity.distance, unitSystem, sport === "swim"));
  }
  if (activity.duration && activity.duration > 0) {
    figures.push({ value: formatDurationSeconds(activity.duration), unit: "", label: "Time" });
  }
  if (sport === "run" && activity.distance && activity.duration && activity.distance > 0) {
    const pace = formatPaceValue(activity.duration / (activity.distance / 1000), unitSystem);
    const [value, unit] = pace.split(" ");
    figures.push({ value, unit: unit ?? "", label: "Pace" });
  } else if (activity.elevationGain && activity.elevationGain > 0) {
    figures.push({
      ...splitValue(formatElevationValue(activity.elevationGain, unitSystem)),
      label: "Climbed"
    });
  }
  return figures;
}

function activityRef(activity: TrainingHubActivity): Milestone["activity"] {
  return {
    activityId: activity.activityId,
    sportType: activity.sportType,
    ...(activity.startTime ? { startTime: activity.startTime } : {})
  };
}

/** "1:38 faster" — a gap between two times. */
function formatGap(seconds: number): string {
  return formatDurationSeconds(Math.abs(seconds));
}

// --- The walk -------------------------------------------------------------------

interface Emitter {
  push(milestone: Omit<Milestone, "major"> & { major?: boolean }): void;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The globe's 0.5° cell (`geoHeatBucketKey`), so a name it has already found is reused. */
export function placeCellKey(point: { lat: number; lon: number }): string {
  return `${Math.round(point.lat / 0.5)}:${Math.round(point.lon / 0.5)}`;
}

function ratioOf(value: number, target: number): number {
  return target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
}

export function computeRecords(input: RecordsInput): RecordsResult {
  const { unitSystem } = input;
  const today = input.today ?? getLocalHappenDayKey();
  const milestones: Milestone[] = [];
  const seen = new Set<string>();
  const emit: Emitter = {
    push(milestone) {
      if (seen.has(milestone.id)) return;
      seen.add(milestone.id);
      milestones.push({ major: false, ...milestone });
    }
  };
  const progress = new Map<string, StageProgress>();

  const activities = input.activities
    .filter((activity) => typeof activity.startTime === "number" && activity.startTime > 0)
    .slice()
    .sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));

  // --- Activities, oldest first ---------------------------------------------
  const firstBySport = new Set<RecordsSport>();
  const countBySport = new Map<RecordsSport, number>();
  const longestBySport = new Map<RecordsSport, number>();
  const ladderReached = new Set<string>();
  let longestClimb = 0;
  const climbByMonth = new Map<string, number>();
  let bestClimbMonth = 0;
  let totalSeconds = 0;
  let runMeters = 0;
  let rideMeters = 0;
  let climbMeters = 0;
  let activityCount = 0;
  const weekSeconds = new Map<string, number>();
  const weekLastActivity = new Map<string, TrainingHubActivity>();
  const weekFirstActivity = new Map<string, TrainingHubActivity>();

  const crossed = (before: number, after: number, threshold: number) =>
    before < threshold && after >= threshold;

  for (const activity of activities) {
    const startTime = activity.startTime as number;
    const day = dayOfEpochSeconds(startTime);
    const sport = recordsSportOf(activity.sportType);
    const distance = activity.distance && activity.distance > 0 ? activity.distance : 0;
    const duration = activity.duration && activity.duration > 0 ? activity.duration : 0;
    const climb = activity.elevationGain && activity.elevationGain > 0 ? activity.elevationGain : 0;
    const ref = activityRef(activity);
    const line = activityLine(activity, unitSystem);

    const sessions = (countBySport.get(sport) ?? 0) + 1;
    countBySport.set(sport, sessions);
    let firedHere = false;
    const isFirstOfSport = sessions === 1;

    if (activityCount === 0) {
      // The very first activity is the beginning, and it is also the first of
      // its sport: one milestone, not two, carrying the labour stage a first
      // of that sport reaches.
      if (sport !== "other") firstBySport.add(sport);
      emit.push({
        id: "start",
        category: "first",
        day,
        at: startTime - 1,
        kind: "The beginning",
        title: "Your first activity on COROS",
        detail: [activity.sportName ?? SPORT_NOUN[sport], line].filter(Boolean).join(" · "),
        sport,
        activity: ref,
        ...(FIRST_LABOUR[sport] ? { labour: FIRST_LABOUR[sport] } : {})
      });
      firedHere = true;
    }

    if (sport !== "other" && !firstBySport.has(sport)) {
      firstBySport.add(sport);
      emit.push({
        id: `first:${sport}`,
        category: "first",
        day,
        at: startTime,
        kind: `First · ${SPORT_NOUN[sport]}`,
        title: FIRST_TITLE[sport],
        detail: line || undefined,
        figures: activityFigures(activity, unitSystem),
        sport,
        major: true,
        activity: ref,
        ...(FIRST_LABOUR[sport] ? { labour: FIRST_LABOUR[sport] } : {})
      });
      firedHere = true;
    }
    if (activity.sportType === 301 && !ladderReached.has("openwater")) {
      ladderReached.add("openwater");
      emit.push({
        id: "first:openwater",
        category: "first",
        day,
        at: startTime + 1,
        kind: "First · Swimming",
        title: "First open-water swim",
        detail: line || undefined,
        sport,
        activity: ref
      });
    }

    const ladder = sport === "run" ? RUN_LADDER : sport === "ride" ? RIDE_LADDER : sport === "swim" ? SWIM_LADDER : [];
    for (const step of ladder) {
      const key = `${sport}:${step.key}`;
      if (ladderReached.has(key) || distance < step.distance * LADDER_TOLERANCE) continue;
      ladderReached.add(key);
      // A first run that is also a first 10K is one milestone, not two; a
      // first that reaches a labour stage or a card's distance still says so.
      if (isFirstOfSport && !step.major && !step.labour) continue;
      const previous = longestBySport.get(sport) ?? 0;
      emit.push({
        id: `distance:${key}`,
        category: "first",
        day,
        at: startTime + 2,
        kind: `First · ${SPORT_NOUN[sport]}`,
        title: step.title,
        detail: line,
        figures: activityFigures(activity, unitSystem),
        ...(previous > 0
          ? {
              context: `The longest ${sport === "ride" ? "ride" : sport === "swim" ? "swim" : "run"} before it was ${formatDistanceValue(previous, unitSystem, { swim: sport === "swim" })}.`
            }
          : {}),
        sport,
        major: step.major,
        activity: ref,
        ...(step.labour ? { labour: step.labour } : {})
      });
      firedHere = true;
    }

    const longest = longestBySport.get(sport) ?? 0;
    if (
      LONGEST_TITLE[sport] &&
      !firedHere &&
      sessions > LONGEST_AFTER_SESSIONS &&
      distance > longest * LONGEST_MARGIN &&
      longest > 0
    ) {
      emit.push({
        id: `longest:${sport}:${activity.activityId}`,
        category: "record",
        day,
        at: startTime + 3,
        kind: `Record · ${SPORT_NOUN[sport]}`,
        title: `${LONGEST_TITLE[sport]} — ${formatDistanceValue(distance, unitSystem, { swim: sport === "swim" })}`,
        detail: `${formatDistanceValue(distance - longest, unitSystem, { swim: sport === "swim" })} further than the last longest`,
        sport,
        activity: ref
      });
    }
    if (distance > longest) longestBySport.set(sport, distance);

    // Height gained in one go, any sport that climbs.
    let climbFired = false;
    for (const step of CLIMB_LADDER) {
      const key = `climb:${step.meters}`;
      if (ladderReached.has(key) || climb < step.meters) continue;
      ladderReached.add(key);
      emit.push({
        id: key,
        category: "first",
        day,
        at: startTime + 4,
        kind: `First · ${SPORT_NOUN[sport]}`,
        title: `${formatElevationValue(step.meters, unitSystem)} climbed in one activity`,
        detail: [activity.name, `${formatElevationValue(climb, unitSystem)} climbed`].filter(Boolean).join(" · "),
        figures: [
          { ...splitValue(formatElevationValue(climb, unitSystem)), label: "Climbed" },
          ...activityFigures(activity, unitSystem).filter((figure) => figure.label !== "Climbed")
        ],
        ...(longestClimb > 0
          ? { context: `${formatElevationValue(climb - longestClimb, unitSystem)} more than your previous biggest climb.` }
          : {}),
        sport,
        major: step.major,
        activity: ref,
        ...(step.labour ? { labour: step.labour } : {})
      });
      climbFired = true;
    }
    if (
      !climbFired &&
      climb >= CLIMB_RECORD_MIN_M &&
      longestClimb > 0 &&
      climb > longestClimb * LONGEST_MARGIN &&
      activityCount >= LONGEST_AFTER_SESSIONS
    ) {
      emit.push({
        id: `climb:record:${activity.activityId}`,
        category: "record",
        day,
        at: startTime + 4,
        kind: `Biggest climb · ${SPORT_NOUN[sport]}`,
        title: activity.name ? `Biggest climb yet: ${activity.name}` : "Biggest climb yet",
        detail: `${formatElevationValue(climb, unitSystem)} · ${formatElevationValue(climb - longestClimb, unitSystem)} more than before`,
        sport,
        activity: ref
      });
    }
    longestClimb = Math.max(longestClimb, climb);

    const month = day.slice(0, 6);
    const monthBefore = climbByMonth.get(month) ?? 0;
    const monthAfter = monthBefore + climb;
    climbByMonth.set(month, monthAfter);
    bestClimbMonth = Math.max(bestClimbMonth, monthAfter);
    if (crossed(monthBefore, monthAfter, EVEREST_METERS) && !ladderReached.has("climb:month")) {
      ladderReached.add("climb:month");
      emit.push({
        id: "climb:month:everest",
        category: "lifetime",
        day,
        at: startTime + 5,
        kind: "Mountains",
        title: "An Everest climbed in a month",
        detail: `${formatElevationValue(monthAfter, unitSystem)} in ${formatMonthYear(day)}`,
        sport,
        major: true,
        activity: ref,
        labour: { id: "boar", stage: 3 }
      });
    }

    // Lifetime totals.
    const secondsBefore = totalSeconds;
    totalSeconds += duration;
    for (const step of LIFETIME_HOURS) {
      if (!crossed(secondsBefore, totalSeconds, step.hours * 3600)) continue;
      emit.push({
        id: `lifetime:hours:${step.hours}`,
        category: "lifetime",
        day,
        at: startTime + 6,
        kind: "Lifetime",
        title: `${groupThousands(step.hours)} hours of training`,
        detail: `${groupThousands(activityCount + 1)} activities since ${formatMonthYear(dayOfEpochSeconds(activities[0].startTime as number))}`,
        major: step.major ?? false,
        activity: ref,
        ...(step.labour ? { labour: { id: "stables", stage: step.labour } } : {})
      });
    }

    const unit = distanceUnit(unitSystem);
    if (sport === "run") {
      const before = metersToDisplayDistance(runMeters, unitSystem);
      runMeters += distance;
      const after = metersToDisplayDistance(runMeters, unitSystem);
      for (const threshold of LIFETIME_RUN_DISTANCE) {
        if (!crossed(before, after, threshold)) continue;
        emit.push({
          id: `lifetime:run:${threshold}${unit}`,
          category: "lifetime",
          day,
          at: startTime + 7,
          kind: "Lifetime · Running",
          title: `${groupThousands(threshold)} ${unit} of running`,
          detail: `${groupThousands(sessions)} runs`,
          sport,
          major: threshold >= 1000,
          activity: ref
        });
      }
    }
    if (sport === "ride") {
      const before = metersToDisplayDistance(rideMeters, unitSystem);
      rideMeters += distance;
      const after = metersToDisplayDistance(rideMeters, unitSystem);
      for (const threshold of LIFETIME_RIDE_DISTANCE) {
        if (!crossed(before, after, threshold)) continue;
        emit.push({
          id: `lifetime:ride:${threshold}${unit}`,
          category: "lifetime",
          day,
          at: startTime + 7,
          kind: "Lifetime · Cycling",
          title: `${groupThousands(threshold)} ${unit} of riding`,
          detail: `${groupThousands(sessions)} rides`,
          sport,
          major: threshold >= 10000,
          activity: ref
        });
      }
    }
    const climbBefore = climbMeters;
    climbMeters += climb;
    for (const count of LIFETIME_EVERESTS) {
      if (!crossed(climbBefore, climbMeters, count * EVEREST_METERS)) continue;
      emit.push({
        id: `lifetime:everest:${count}`,
        category: "lifetime",
        day,
        at: startTime + 8,
        kind: "Lifetime · Climbing",
        title: count === 1 ? "An Everest climbed, all told" : `${count} Everests climbed, all told`,
        detail: `${formatElevationValue(climbMeters, unitSystem)} gained since you started`,
        major: count >= 10,
        activity: ref
      });
    }
    activityCount += 1;
    for (const count of LIFETIME_ACTIVITIES) {
      if (activityCount !== count) continue;
      emit.push({
        id: `lifetime:activities:${count}`,
        category: "lifetime",
        day,
        at: startTime + 9,
        kind: "Lifetime",
        title: `${groupThousands(count)} activities`,
        detail: `The ${groupThousands(count)}th was ${activity.name ?? SPORT_NOUN[sport].toLowerCase()}`,
        major: count >= 1000,
        activity: ref
      });
    }
    if (sport === "strength") {
      for (const step of STRENGTH_SESSIONS) {
        if (sessions !== step.count) continue;
        emit.push({
          id: `lifetime:strength:${step.count}`,
          category: "lifetime",
          day,
          at: startTime + 9,
          kind: "Lifetime · Strength",
          title: `${step.count} strength sessions`,
          sport,
          activity: ref,
          ...(step.labour ? { labour: { id: "lion", stage: step.labour } } : {})
        });
      }
    }

    const week = weekOf(day);
    weekSeconds.set(week, (weekSeconds.get(week) ?? 0) + duration);
    weekLastActivity.set(week, activity);
    if (!weekFirstActivity.has(week)) weekFirstActivity.set(week, activity);
  }

  // --- Weeks: the biggest, and the streaks -------------------------------------
  const weeks = [...weekSeconds.keys()].sort();
  let biggestWeek = 0;
  weeks.forEach((week, index) => {
    const seconds = weekSeconds.get(week) ?? 0;
    if (
      index >= WEEK_RECORD_AFTER_WEEKS &&
      seconds >= WEEK_RECORD_MIN_SECONDS &&
      seconds > biggestWeek * LONGEST_MARGIN
    ) {
      const last = weekLastActivity.get(week) as TrainingHubActivity;
      const hours = seconds / 3600;
      emit.push({
        id: `week:${week}`,
        category: "record",
        day: dayOfEpochSeconds(last.startTime as number),
        at: (last.startTime as number) + 10,
        kind: "Record · Volume",
        title: `Biggest week yet — ${hours.toFixed(1)} h`,
        detail: `${(hours - biggestWeek / 3600).toFixed(1)} h more than any week before it`
      });
    }
    biggestWeek = Math.max(biggestWeek, seconds);
  });

  let run = 0;
  let previousWeek: string | undefined;
  let bestStreak = 0;
  for (const week of weeks) {
    run = previousWeek && addDays(previousWeek, 7) === week ? run + 1 : 1;
    previousWeek = week;
    bestStreak = Math.max(bestStreak, run);
    for (const step of STREAK_WEEKS) {
      if (run !== step.weeks || seen.has(`streak:weeks:${step.weeks}`)) continue;
      const first = weekFirstActivity.get(week) as TrainingHubActivity;
      emit.push({
        id: `streak:weeks:${step.weeks}`,
        category: "streak",
        day: dayOfEpochSeconds(first.startTime as number),
        at: (first.startTime as number) + 11,
        kind: "Streak",
        title: `${step.weeks} weeks in a row`,
        detail: `At least one session every week since ${formatDayShort(addDays(week, -7 * (step.weeks - 1)))}`,
        major: step.major ?? false,
        activity: activityRef(first),
        ...(step.labour ? { labour: { id: "hind", stage: step.labour } } : {})
      });
    }
  }
  // The streak still alive: this week counts once it has a session, and until
  // then the run is judged through last week.
  const thisWeek = weekOf(today);
  let currentStreak = 0;
  {
    let cursor = weekSeconds.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
    while (weekSeconds.has(cursor)) {
      currentStreak += 1;
      cursor = addDays(cursor, -7);
    }
  }

  // --- Anniversaries ---------------------------------------------------------------
  if (activities.length > 0) {
    const firstDay = dayOfEpochSeconds(activities[0].startTime as number);
    for (let years = 1; years < 100; years += 1) {
      const date = dateOfDay(firstDay);
      date.setFullYear(date.getFullYear() + years);
      const day = getLocalHappenDayKey(date);
      if (day > today) break;
      emit.push({
        id: `anniversary:${years}`,
        category: "anniversary",
        day,
        at: noonOf(day),
        kind: "Anniversary",
        title: years === 1 ? "One year since your first activity" : `${years} years since your first activity`,
        detail: `Your first was on ${formatDayShort(firstDay)}`
      });
    }
  }

  // --- Records: best efforts, and COROS's own -----------------------------------------
  const records = recordMilestones(activities, input);
  for (const milestone of records.milestones) emit.push(milestone);
  const pendingSummaries = activities.filter((activity) =>
    needsRecordsSummary(activity, input.summaries.get(activity.activityId))
  ).length;

  // --- VO2max ---------------------------------------------------------------------------
  const toRemember: RememberedMilestone[] = [];
  const vo2 = vo2Milestones(input);
  for (const milestone of vo2.milestones) {
    emit.push(milestone);
    toRemember.push({
      id: milestone.id,
      kind: "vo2max",
      day: milestone.day,
      data: { value: vo2.values.get(milestone.id) }
    });
  }

  // --- Sleep -------------------------------------------------------------------------------
  const sleep = sleepMilestones(input);
  for (const milestone of sleep.milestones) {
    emit.push(milestone);
    toRemember.push({
      id: milestone.id,
      kind: "sleep",
      day: milestone.day,
      data: sleep.data.get(milestone.id) ?? {}
    });
  }

  // --- Plans --------------------------------------------------------------------------------
  const plans = planMilestones(input);
  for (const milestone of plans) emit.push(milestone);

  // --- Places ----------------------------------------------------------------------------------
  const places = placeMilestones(activities, input);
  for (const milestone of places.milestones) emit.push(milestone);

  // --- Progress towards what is still open --------------------------------------------------------
  const reached = new Set(
    milestones.flatMap((milestone) =>
      stagesReached(milestone.labour).map((stage) =>
        labourStageKey((milestone.labour as MilestoneLabour).id, stage)
      )
    )
  );
  const open = (id: LabourId, stage: LabourStage, value: StageProgress) => {
    const key = labourStageKey(id, stage);
    if (!reached.has(key)) progress.set(key, value);
  };
  const strengthCount = countBySport.get("strength") ?? 0;
  open("lion", 2, { text: `${strengthCount} / 50 sessions`, ratio: ratioOf(strengthCount, 50) });
  open("lion", 3, { text: `${strengthCount} / 100 sessions`, ratio: ratioOf(strengthCount, 100) });
  const longestSwim = longestBySport.get("swim") ?? 0;
  if (longestSwim > 0) {
    open("hydra", 2, { text: `Best ${formatDistanceValue(longestSwim, unitSystem, { swim: true })}`, ratio: ratioOf(longestSwim, 1500) });
    open("hydra", 3, { text: `Best ${formatDistanceValue(longestSwim, unitSystem, { swim: true })}`, ratio: ratioOf(longestSwim, 3800) });
  }
  for (const [stage, target] of [[1, 4], [2, 26], [3, 52]] as const) {
    open("hind", stage, {
      text: `${currentStreak} / ${target} weeks${bestStreak > currentStreak ? ` · best ${bestStreak}` : ""}`,
      ratio: ratioOf(currentStreak, target)
    });
  }
  open("boar", 1, { text: `Best ${formatElevationValue(longestClimb, unitSystem, "0 m")}`, ratio: ratioOf(longestClimb, 500) });
  open("boar", 2, { text: `Best ${formatElevationValue(longestClimb, unitSystem, "0 m")}`, ratio: ratioOf(longestClimb, 1500) });
  open("boar", 3, {
    text: `Best month ${formatElevationValue(bestClimbMonth, unitSystem, "0 m")}`,
    ratio: ratioOf(bestClimbMonth, EVEREST_METERS)
  });
  const hours = totalSeconds / 3600;
  for (const [stage, target] of [[1, 100], [2, 500], [3, 1000]] as const) {
    open("stables", stage, { text: `${groupThousands(hours)} / ${groupThousands(target)} h`, ratio: ratioOf(hours, target) });
  }
  const longestRide = longestBySport.get("ride") ?? 0;
  if (longestRide > 0) {
    open("birds", 2, { text: `Best ${formatDistanceValue(longestRide, unitSystem)}`, ratio: ratioOf(longestRide, 100000) });
    open("birds", 3, { text: `Best ${formatDistanceValue(longestRide, unitSystem)}`, ratio: ratioOf(longestRide, 160934.4) });
  }
  const longestRun = longestBySport.get("run") ?? 0;
  if (longestRun > 0) {
    for (const [stage, target] of [[1, 21097.5], [2, 42195], [3, 50000]] as const) {
      open("bull", stage, { text: `Best ${formatDistanceValue(longestRun, unitSystem)}`, ratio: ratioOf(longestRun, target) });
    }
  }
  for (const [key, value] of records.progress) {
    if (!reached.has(key)) progress.set(key, value);
  }
  for (const [key, value] of vo2.progress) {
    if (!reached.has(key)) progress.set(key, value);
  }
  for (const [key, value] of sleep.progress) {
    if (!reached.has(key)) progress.set(key, value);
  }
  for (const [key, value] of places.progress) {
    if (!reached.has(key)) progress.set(key, value);
  }

  milestones.sort((left, right) => left.day.localeCompare(right.day) || left.at - right.at);

  // --- Within reach ----------------------------------------------------------------------------------
  const candidates: WithinReach[] = [];
  for (const [key, value] of progress) {
    if (value.ratio === undefined || value.ratio <= 0 || value.ratio >= 1) continue;
    const [id, stageText] = key.split(":");
    const stage = Number(stageText) as LabourStage;
    // Only the first stage of a labour still open is the one being worked on.
    const earlier = ([1, 2, 3] as const).filter(
      (candidate) => candidate < stage && !reached.has(labourStageKey(id as LabourId, candidate))
    );
    if (earlier.length > 0) continue;
    const definition = labourDefinition(id as LabourId);
    candidates.push({
      id: key,
      label: `${definition.short} · ${STAGE_NUMERALS[stage]}`,
      title: definition.stages[stage - 1],
      value: value.text,
      hint: `${Math.round(value.ratio * 100)}% there`,
      ratio: value.ratio,
      labour: { id: id as LabourId, stage }
    });
  }
  const runDisplay = metersToDisplayDistance(runMeters, unitSystem);
  const nextRun = LIFETIME_RUN_DISTANCE.find((threshold) => threshold > runDisplay);
  if (nextRun && runDisplay > 0) {
    const unit = distanceUnit(unitSystem);
    candidates.push({
      id: "lifetime:run",
      label: "Lifetime · Running",
      title: `${groupThousands(nextRun)} ${unit} of running`,
      value: `${groupThousands(runDisplay)} / ${groupThousands(nextRun)} ${unit}`,
      hint: `${groupThousands(nextRun - runDisplay)} ${unit} to go`,
      ratio: runDisplay / nextRun,
      sport: "run"
    });
  }
  const withinReach = candidates
    .filter((candidate) => candidate.ratio >= 0.5)
    .sort((left, right) => right.ratio - left.ratio)
    .slice(0, 3);

  return {
    milestones,
    progress,
    withinReach,
    toRemember,
    places: places.cells,
    pendingSummaries
  };
}

// --- Records ------------------------------------------------------------------------

interface RecordsPart {
  milestones: Milestone[];
  progress: Map<string, StageProgress>;
}

function corosAllTimeRecords(
  groups: readonly TrainingHubPersonalRecordGroup[] | undefined
): Map<number, { seconds: number; day: string; activityId?: string }> {
  const found = new Map<number, { seconds: number; day: string; activityId?: string }>();
  const group = groups?.find((candidate) => candidate.type === COROS_ALL_TIME_GROUP);
  for (const record of group?.records ?? []) {
    const distance = RECORD_DISTANCES.find((entry) => entry.corosType === record.type)?.distance;
    if (
      distance === undefined ||
      !record.duration ||
      record.duration <= 0 ||
      !record.happenDay ||
      !/^\d{8}$/.test(record.happenDay)
    ) {
      continue;
    }
    found.set(distance, {
      seconds: record.duration,
      day: record.happenDay,
      ...(record.activityId ? { activityId: record.activityId } : {})
    });
  }
  return found;
}

function recordMilestones(
  activities: readonly TrainingHubActivity[],
  input: RecordsInput
): RecordsPart {
  const milestones: Milestone[] = [];
  const progress = new Map<string, StageProgress>();
  const coros = corosAllTimeRecords(input.personalRecords);
  const best = new Map<number, { seconds: number; day: string }>();
  const firstEffort = new Map<number, string>();
  const improved = new Set<number>();
  let maresFirst = false;
  let maresSet = false;
  let maresYear = false;
  const labelOf = (distance: number) =>
    RECORD_DISTANCES.find((entry) => entry.distance === distance)?.label ?? `${distance} m`;

  // Every effort, in the order it was run.
  type Entry = {
    distance: number;
    seconds: number;
    day: string;
    at: number;
    activity: TrainingHubActivity;
    source: "effort" | "coros";
  };
  const entries: Entry[] = [];
  for (const activity of activities) {
    const summary = input.summaries.get(activity.activityId);
    for (const effort of summary?.bestEfforts ?? ([] as BestEffort[])) {
      const record = coros.get(effort.distance);
      if (record && effort.seconds < record.seconds * EFFORT_FLOOR_OF_COROS_RECORD) continue;
      entries.push({
        distance: effort.distance,
        seconds: effort.seconds,
        day: dayOfEpochSeconds(activity.startTime as number),
        at: (activity.startTime as number) + 20,
        activity,
        source: "effort"
      });
    }
  }

  // COROS's record goes in at its own day, as the effort its activity would
  // have been — and in place of ours where it names the same activity, since
  // COROS's figure is the one the athlete has seen.
  const byId = new Map(activities.map((activity) => [activity.activityId, activity]));
  for (const [distance, record] of coros) {
    const index = entries.findIndex(
      (entry) => entry.distance === distance && entry.activity.activityId === record.activityId
    );
    const activity = record.activityId ? byId.get(record.activityId) : undefined;
    if (index >= 0) {
      entries[index] = { ...entries[index], seconds: record.seconds, source: "coros" };
    } else if (activity) {
      entries.push({
        distance,
        seconds: record.seconds,
        day: record.day,
        at: (activity.startTime as number) + 20,
        activity,
        source: "coros"
      });
    }
  }
  entries.sort((left, right) => left.day.localeCompare(right.day) || left.at - right.at);

  // Improvements, gathered per run: one run that sets three records is one
  // milestone, not three.
  type Gain = { distance: number; seconds: number; previous: { seconds: number; day: string }; source: Entry["source"] };
  const gains = new Map<string, { entry: Entry; gains: Gain[] }>();
  for (const entry of entries) {
    const previous = best.get(entry.distance);
    if (previous && entry.seconds >= previous.seconds) continue;
    best.set(entry.distance, { seconds: entry.seconds, day: entry.day });
    if (!firstEffort.has(entry.distance)) firstEffort.set(entry.distance, entry.day);

    if (!previous) {
      // The first effort at a distance beats nothing, so it is no record — but
      // COROS's own current record is shown however little history the
      // backfill has reached, since it is the one the athlete has seen.
      if (entry.source === "coros") {
        milestones.push({
          id: `record:${entry.distance}:${entry.activity.activityId}`,
          category: "record",
          day: entry.day,
          at: entry.at,
          kind: "Record · Running",
          title: `Your ${labelOf(entry.distance)} record — ${formatDurationSeconds(entry.seconds)}`,
          detail: "COROS's current record",
          sport: "run",
          major: false,
          activity: activityRef(entry.activity)
        });
      }
      continue;
    }
    // A record a beginner breaks every other run is no milestone: the first
    // four weeks at a distance set the bar, and a sliver under it is noise.
    const settled = daysBetween(firstEffort.get(entry.distance) as string, entry.day) >= RECORD_SETTLE_DAYS;
    const meaningful = (previous.seconds - entry.seconds) / previous.seconds >= RECORD_MIN_GAIN;
    if (!settled || !meaningful) continue;
    const key = entry.activity.activityId;
    const group = gains.get(key) ?? { entry, gains: [] };
    group.gains.push({ distance: entry.distance, seconds: entry.seconds, previous, source: entry.source });
    gains.set(key, group);
  }

  const groups = [...gains.values()].sort(
    (left, right) => left.entry.day.localeCompare(right.entry.day) || left.entry.at - right.entry.at
  );
  for (const { entry, gains: list } of groups) {
    list.sort((left, right) => left.distance - right.distance);
    let labour: MilestoneLabour | undefined;
    for (const gain of list) {
      improved.add(gain.distance);
      if (!maresYear && daysBetween(gain.previous.day, entry.day) >= 365) {
        maresYear = true;
        labour = withStage(labour, "mares", 3);
      }
    }
    if (!maresFirst) {
      maresFirst = true;
      labour = withStage(labour, "mares", 1);
    }
    if (!maresSet && MARES_SET.every((distance) => improved.has(distance))) {
      maresSet = true;
      labour = withStage(labour, "mares", 2);
    }
    const labels = list.map((gain) => labelOf(gain.distance));
    const named =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    const describe = (gain: Gain) =>
      `${formatGap(gain.previous.seconds - gain.seconds)} faster than the record from ${formatDayShort(gain.previous.day)}`;
    milestones.push({
      id: `pr:${entry.activity.activityId}`,
      category: "record",
      day: entry.day,
      at: entry.at,
      kind: "Record · Running",
      title:
        list.length === 1
          ? `New ${named} record — ${formatDurationSeconds(list[0].seconds)}`
          : `New ${named} records`,
      detail:
        list.length === 1
          ? `${describe(list[0])}${list[0].source === "coros" ? " · COROS's own record" : ""}`
          : list
              .map((gain) => `${labelOf(gain.distance)} ${formatDurationSeconds(gain.seconds)}`)
              .join(" · "),
      ...(list.length > 1
        ? { context: list.map((gain) => `${labelOf(gain.distance)}: ${describe(gain)}.`).join(" ") }
        : {}),
      sport: "run",
      major: list.some((gain) => gain.distance >= 21097.5),
      activity: activityRef(entry.activity),
      ...(labour ? { labour } : {})
    });
  }

  // Progress: the Mares' open stages.
  const missing = MARES_SET.filter((distance) => !improved.has(distance));
  progress.set(labourStageKey("mares", 2), {
    text: `${3 - missing.length} of 3 improved`,
    ratio: (3 - missing.length) / 3
  });
  const today = input.today ?? getLocalHappenDayKey();
  let oldest: { distance: number; day: string } | undefined;
  for (const [distance, record] of best) {
    if (!oldest || record.day < oldest.day) oldest = { distance, day: record.day };
  }
  if (oldest) {
    const age = daysBetween(oldest.day, today);
    progress.set(labourStageKey("mares", 3), {
      text:
        age >= 365
          ? `Your ${labelOf(oldest.distance)} record has stood since ${formatDayShort(oldest.day)}`
          : `Your ${labelOf(oldest.distance)} record turns one on ${formatDayShort(addDays(oldest.day, 365))}`,
      ratio: Math.min(1, age / 365)
    });
  }
  return { milestones, progress };
}

// --- VO2max ----------------------------------------------------------------------------

function vo2Milestones(input: RecordsInput): {
  milestones: Milestone[];
  values: Map<string, number>;
  progress: Map<string, StageProgress>;
} {
  const milestones: Milestone[] = [];
  const values = new Map<string, number>();
  const progress = new Map<string, StageProgress>();

  // What COROS holds, and what a reading it no longer holds left behind.
  const readings = new Map<string, number>();
  const take = (day: string, value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
    const current = readings.get(day);
    readings.set(day, current === undefined ? value : Math.max(current, value));
  };
  for (const reading of input.vo2Readings ?? []) take(reading.day, reading.value);
  for (const row of input.remembered ?? []) {
    if (row.kind === "vo2max") take(row.day, row.data.value);
  }
  const ordered = [...readings.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (ordered.length === 0) return { milestones, values, progress };

  const [firstDay, firstValue] = ordered[0];
  const push = (milestone: Omit<Milestone, "major" | "category" | "kind" | "at">, value: number) => {
    values.set(milestone.id, Math.round(value * 10) / 10);
    milestones.push({
      category: "fitness",
      kind: "Fitness",
      at: noonOf(milestone.day),
      major: false,
      ...milestone
    });
  };
  push(
    {
      id: "vo2max:first",
      day: firstDay,
      title: `First VO2max reading — ${Math.round(firstValue)}`,
      labour: { id: "apples", stage: 1 }
    },
    firstValue
  );

  let highest = Math.floor(firstValue);
  let plusTwo = false;
  let plusFive = false;
  let peak = firstValue;
  for (const [day, value] of ordered.slice(1)) {
    peak = Math.max(peak, value);
    let labour: MilestoneLabour | undefined;
    if (!plusTwo && value - firstValue >= 2) {
      plusTwo = true;
      labour = withStage(labour, "apples", 2);
    }
    if (!plusFive && value - firstValue >= 5) {
      plusFive = true;
      labour = withStage(labour, "apples", 3);
    }
    const whole = Math.floor(value);
    if (whole > highest) {
      highest = whole;
      push(
        {
          id: `vo2max:high:${whole}`,
          day,
          title: `VO2max ${whole} — a new high`,
          detail: `Up ${(value - firstValue).toFixed(1)} since your first reading in ${formatMonthYear(firstDay)}`,
          ...(labour ? { labour } : {})
        },
        value
      );
    } else if (labour) {
      push(
        {
          id: `vo2max:plus:${labour.stage === 2 ? 2 : 5}`,
          day,
          title: `VO2max ${labour.stage === 2 ? 2 : 5} above your first reading`,
          detail: `${value.toFixed(1)} against ${firstValue.toFixed(1)}`,
          labour
        },
        value
      );
    }
  }

  const peakText = `${Math.round(peak * 10) / 10} / ${Math.round((firstValue + 2) * 10) / 10}`;
  progress.set(labourStageKey("apples", 2), {
    text: peakText,
    ratio: ratioOf(peak - firstValue, 2)
  });
  progress.set(labourStageKey("apples", 3), {
    text: `${Math.round(peak * 10) / 10} / ${Math.round((firstValue + 5) * 10) / 10}`,
    ratio: ratioOf(peak - firstValue, 5)
  });
  return { milestones, values, progress };
}

// --- Sleep ------------------------------------------------------------------------------

function sleepMilestones(input: RecordsInput): {
  milestones: Milestone[];
  data: Map<string, Record<string, unknown>>;
  progress: Map<string, StageProgress>;
} {
  const milestones: Milestone[] = [];
  const data = new Map<string, Record<string, unknown>>();
  const progress = new Map<string, StageProgress>();
  const remembered = new Map(
    (input.remembered ?? []).filter((row) => row.kind === "sleep").map((row) => [row.id, row])
  );
  const nights = (input.sleepNights ?? [])
    .filter((night) => /^\d{8}$/.test(night.day) && night.minutes > 0)
    .slice()
    .sort((left, right) => left.day.localeCompare(right.day));

  const push = (
    id: string,
    day: string,
    title: string,
    detail: string,
    payload: Record<string, unknown>,
    labour?: MilestoneLabour
  ) => {
    data.set(id, payload);
    milestones.push({
      id,
      category: "sleep",
      day,
      at: noonOf(day),
      kind: "Sleep",
      title,
      detail,
      major: false,
      ...(labour ? { labour } : {})
    });
  };

  if (nights.length > 0) {
    const first = nights[0];
    push(
      "sleep:first",
      first.day,
      "First night recorded",
      `${Math.floor(first.minutes / 60)} h ${Math.round(first.minutes % 60)} min`,
      { minutes: Math.round(first.minutes) },
      { id: "cerberus", stage: 1 }
    );
  }

  let streak = 0;
  let previous: string | undefined;
  for (const night of nights) {
    const good = night.minutes >= GOOD_NIGHT_MINUTES;
    const consecutive = previous !== undefined && addDays(previous, 1) === night.day;
    streak = good ? (consecutive ? streak + 1 : 1) : 0;
    previous = night.day;
    for (const step of SLEEP_STREAKS) {
      if (streak !== step.nights) continue;
      push(
        `sleep:streak:${step.nights}`,
        night.day,
        `${step.nights} nights in a row of 7 h+`,
        `Every night since ${formatDayShort(addDays(night.day, -(step.nights - 1)))}`,
        { nights: step.nights },
        step.labour ? { id: "cerberus", stage: step.labour } : undefined
      );
    }
  }

  // A remembered milestone this machine's nights no longer show still stands,
  // at the day it was first reached.
  for (const [id, row] of remembered) {
    if (milestones.some((milestone) => milestone.id === id)) continue;
    const nightsValue = typeof row.data.nights === "number" ? row.data.nights : undefined;
    const step = SLEEP_STREAKS.find((entry) => entry.nights === nightsValue);
    if (id === "sleep:first") {
      push(id, row.day, "First night recorded", "", row.data, { id: "cerberus", stage: 1 });
    } else if (step) {
      push(
        id,
        row.day,
        `${step.nights} nights in a row of 7 h+`,
        `Every night since ${formatDayShort(addDays(row.day, -(step.nights - 1)))}`,
        row.data,
        step.labour ? { id: "cerberus", stage: step.labour } : undefined
      );
    }
  }
  for (const milestone of milestones) {
    const row = remembered.get(milestone.id);
    if (row && row.day < milestone.day) milestone.day = row.day;
  }

  const today = input.today ?? getLocalHappenDayKey();
  // The run still alive, through last night.
  let alive = 0;
  const byDay = new Map(nights.map((night) => [night.day, night.minutes]));
  for (let cursor = today; (byDay.get(cursor) ?? 0) >= GOOD_NIGHT_MINUTES; cursor = addDays(cursor, -1)) {
    alive += 1;
  }
  if (alive === 0) {
    for (
      let cursor = addDays(today, -1);
      (byDay.get(cursor) ?? 0) >= GOOD_NIGHT_MINUTES;
      cursor = addDays(cursor, -1)
    ) {
      alive += 1;
    }
  }
  progress.set(labourStageKey("cerberus", 2), {
    text: `${alive} / 7 nights`,
    ratio: ratioOf(alive, 7)
  });
  progress.set(labourStageKey("cerberus", 3), {
    text: `${alive} / 30 nights`,
    ratio: ratioOf(alive, 30)
  });
  return { milestones, data, progress };
}

// --- Plans ---------------------------------------------------------------------------------

function planMilestones(input: RecordsInput): Milestone[] {
  const rows = (input.remembered ?? [])
    .filter((row) => row.kind === "plan")
    .slice()
    .sort((left, right) => left.day.localeCompare(right.day));
  const reached = new Set<LabourStage>();
  return rows.map((row, index) => {
    const weeks = typeof row.data.weeks === "number" ? row.data.weeks : 0;
    const ratio = typeof row.data.ratio === "number" ? row.data.ratio : 0;
    const done = typeof row.data.done === "number" ? row.data.done : undefined;
    const settled = typeof row.data.settled === "number" ? row.data.settled : undefined;
    const name = typeof row.data.name === "string" && row.data.name ? row.data.name : "A plan";
    let labour: MilestoneLabour | undefined;
    for (const step of PLAN_STAGES) {
      if (!reached.has(step.stage) && weeks >= step.weeks && ratio >= step.ratio) {
        reached.add(step.stage);
        labour = withStage(labour, "girdle", step.stage);
      }
    }
    const ordinal = ["first", "second", "third", "fourth", "fifth"][index] ?? `${index + 1}th`;
    return {
      id: row.id,
      category: "plan" as const,
      day: row.day,
      at: noonOf(row.day),
      kind: "Plan finished",
      title: `${name} · ${weeks} weeks`,
      figures: [
        { value: String(Math.round(ratio * 100)), unit: "%", label: "Done as planned" },
        ...(done !== undefined && settled !== undefined
          ? [{ value: String(done), unit: `of ${settled}`, label: "Sessions" }]
          : []),
        { value: String(weeks), unit: "weeks", label: "Length" }
      ],
      context: `Your ${ordinal} finished plan.`,
      major: true,
      ...(labour ? { labour } : {})
    };
  });
}

// --- Places ------------------------------------------------------------------------------------

function placeMilestones(
  activities: readonly TrainingHubActivity[],
  input: RecordsInput
): { milestones: Milestone[]; cells: PlaceCell[]; progress: Map<string, StageProgress> } {
  const milestones: Milestone[] = [];
  const progress = new Map<string, StageProgress>();
  const located: Array<{ activity: TrainingHubActivity; point: { lat: number; lon: number } }> = [];
  for (const activity of activities) {
    const point = input.summaries.get(activity.activityId)?.startPoint;
    if (point) located.push({ activity, point });
  }
  const cells = new Map<string, PlaceCell>();
  for (const { point } of located) {
    const key = placeCellKey(point);
    const cell = cells.get(key);
    if (cell) cell.count += 1;
    else cells.set(key, { key, lat: point.lat, lon: point.lon, count: 1 });
  }
  const ranked = [...cells.values()].sort((left, right) => right.count - left.count);
  const home = ranked[0];
  if (!home) return { milestones, cells: ranked, progress };

  const labels = input.placeLabels ?? {};
  const homeCountry = labels[home.key]?.country;
  const visited = new Set<string>();
  const countries = new Set<string>(homeCountry ? [homeCountry] : []);
  let furthest = 0;
  let pillars = false;
  let secondCountry = false;
  for (const { activity, point } of located) {
    const startTime = activity.startTime as number;
    const day = dayOfEpochSeconds(startTime);
    const sport = recordsSportOf(activity.sportType);
    const key = placeCellKey(point);
    const ref = activityRef(activity);
    const label = labels[key];
    if (!visited.has(key)) {
      visited.add(key);
      for (const step of PLACE_COUNTS) {
        if (visited.size !== step.count) continue;
        milestones.push({
          id: `place:count:${step.count}`,
          category: "place",
          day,
          at: startTime + 30,
          kind: "Places",
          title: `${step.count} different places`,
          detail: label ? `The ${step.count}th: ${label.city}` : undefined,
          sport,
          major: false,
          activity: ref,
          ...(step.labour ? { labour: { id: "cattle" as const, stage: step.labour } } : {})
        });
      }
      if (label?.country && countries.size === 0) {
        // The first country named is home, not a new one.
        countries.add(label.country);
      } else if (label?.country && !countries.has(label.country)) {
        countries.add(label.country);
        const labour = !secondCountry && countries.size >= 2 ? { id: "cattle" as const, stage: 2 as const } : undefined;
        if (labour) secondCountry = true;
        milestones.push({
          id: `place:country:${label.country.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`,
          category: "place",
          day,
          at: startTime + 31,
          kind: "Places",
          title: `A new country: ${label.country}`,
          detail: [label.city, activity.name].filter(Boolean).join(" · "),
          sport,
          major: Boolean(labour),
          activity: ref,
          ...(labour ? { labour } : {})
        });
      }
    }
    const away = haversineKm(home, point);
    if (!pillars && away >= PILLARS_KM) {
      pillars = true;
      milestones.push({
        id: "place:pillars",
        category: "place",
        day,
        at: startTime + 32,
        kind: "Places",
        title: `Trained ${groupThousands(away)} km from home`,
        detail: [label?.city, activity.name].filter(Boolean).join(" · ") || undefined,
        sport,
        major: true,
        activity: ref,
        labour: { id: "cattle", stage: 3 }
      });
    } else if (away >= 100 && away > furthest * 1.25 && furthest > 0) {
      milestones.push({
        id: `place:far:${activity.activityId}`,
        category: "place",
        day,
        at: startTime + 32,
        kind: "Places",
        title: `Furthest from home yet — ${groupThousands(Math.round(away))} km`,
        detail: [label?.city, activity.name].filter(Boolean).join(" · ") || undefined,
        sport,
        major: false,
        activity: ref
      });
    }
    furthest = Math.max(furthest, away);
  }

  progress.set(labourStageKey("cattle", 1), {
    text: `${visited.size} / 5 places`,
    ratio: ratioOf(visited.size, 5)
  });
  progress.set(labourStageKey("cattle", 2), {
    text: countries.size > 0 ? `${countries.size} ${countries.size === 1 ? "country" : "countries"} so far` : "Countries named as places resolve"
  });
  progress.set(labourStageKey("cattle", 3), {
    text: `Furthest ${groupThousands(Math.round(furthest))} km`,
    ratio: ratioOf(furthest, PILLARS_KM)
  });
  return { milestones, cells: ranked, progress };
}
