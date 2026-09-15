import type { StrengthSession, StrengthSetType } from "../../electron/types";
import type { MuscleId } from "./muscles";
import {
  buildStrengthAnalytics,
  estimateOneRepMax,
  exerciseDisplayName,
  exerciseTargets,
  UNNAMED_EXERCISE,
  type HeatMetric,
  type MuscleStat,
  type StrengthAnalytics
} from "./strengthAnalytics";

/**
 * How much of a session the rules could place on specific muscles, which
 * decides what the figure can honestly show before any colour is picked:
 *
 * - `attributed` — at least one working set landed on a named muscle.
 * - `generic` — nothing specific, but COROS said Full Body, so the whole
 *   figure is drawn at the faintest level.
 * - `unmapped` — only exercises no rule recognises; nothing to draw.
 * - `empty` — no working sets at all: warm-ups and stretching, or an empty log.
 */
export type SessionAttribution = "attributed" | "generic" | "unmapped" | "empty";

/** Working sets by what the muscle rules made of them. */
export interface SessionCoverage {
  attributed: number;
  /** COROS S4208 sets, which say only "Full Body". */
  generic: number;
  unmapped: number;
  /** Warm-ups, stretching and foam rolling — counted, but not working sets. */
  mobility: number;
  /** attributed + generic + unmapped. */
  working: number;
}

export type PersonalRecordKind = "weight" | "e1rm";

/**
 * A lift that beat every earlier session of the same exercise. "Earlier" reaches
 * back only as far as the history that was loaded — the Strength window — so
 * this is the best in that window, not necessarily of all time.
 */
export interface SessionPersonalRecord {
  exercise: string;
  kind: PersonalRecordKind;
  valueKg: number;
  /** The best any earlier session in the window managed. */
  previousKg: number;
}

export interface SessionAnalytics {
  session: StrengthSession;
  /** The session analysed on its own. */
  analytics: StrengthAnalytics;
  attribution: SessionAttribution;
  coverage: SessionCoverage;
  records: SessionPersonalRecord[];
}

export interface StrengthSessionIndex {
  /** Every session in the history, keyed by activityId. */
  byId: Map<string, SessionAnalytics>;
}

/** What the body map draws for one session: per-muscle values and the scale they are read on. */
export interface SessionHeat {
  muscleById: Record<MuscleId, MuscleStat>;
  max: number;
}

/**
 * Anything closer than this is the same weight: e1RMs are products of floats,
 * and a PR for matching a best to the fourteenth decimal would be noise.
 */
const RECORD_EPSILON_KG = 1e-6;

/**
 * `heatLevel` splits the scale into five equal bands, so a value of 1 against
 * a max of 5 is exactly the first band on every muscle, whatever the metric.
 */
const FAINT_VALUE = 1;
const FAINT_MAX = 5;

/**
 * The whole figure at its faintest, for a session COROS recorded only as Full
 * Body. For the figure alone: the numbers are placeholders, so the muscle panel
 * must keep reading the session's own analytics, where every muscle is zero.
 */
const FULL_BODY_FAINT: SessionHeat = {
  muscleById: Object.fromEntries(
    Object.entries(buildStrengthAnalytics([], 1).muscleById).map(([id, stat]) => [
      id,
      { ...stat, sets: FAINT_VALUE, volumeKg: FAINT_VALUE, workSec: FAINT_VALUE }
    ])
  ) as Record<MuscleId, MuscleStat>,
  max: FAINT_MAX
};

export function sessionAttribution(coverage: SessionCoverage): SessionAttribution {
  if (coverage.working <= 0) return "empty";
  if (coverage.attributed > 0) return "attributed";
  if (coverage.generic > 0) return "generic";
  return "unmapped";
}

interface LiftBest {
  weightKg: number;
  e1rmKg: number;
}

/**
 * Heaviest set and best estimated max per exercise in one session. Records do
 * not depend on muscle attribution — a lift no rule recognises can still be the
 * heaviest you have pulled — but Full Body, mobility and unnamed entries lump
 * different movements under one name, so they keep none.
 */
function sessionLiftBests(session: StrengthSession): Map<string, LiftBest> {
  const bests = new Map<string, LiftBest>();
  for (const exercise of session.detail.exercises) {
    const name = exerciseDisplayName(exercise.nameKey, exercise.rawName);
    if (name === UNNAMED_EXERCISE) continue;
    const targets = exerciseTargets(exercise, name);
    if (targets.generic || targets.mobility) continue;

    // A superset can list the same exercise twice in one session; merge.
    const best = bests.get(name) ?? { weightKg: 0, e1rmKg: 0 };
    for (const entry of exercise.entries) {
      best.weightKg = Math.max(best.weightKg, entry.weightKg);
      best.e1rmKg = Math.max(best.e1rmKg, estimateOneRepMax(entry.weightKg, entry.reps));
    }
    bests.set(name, best);
  }
  return bests;
}

/**
 * Walks the history oldest first, holding the best of everything strictly
 * before each session. Sessions sharing a start time are judged against the
 * same earlier best, so neither can set a record over the other. A first
 * loaded appearance is not a record — there is nothing yet to beat.
 */
function buildPersonalRecords(
  sessions: StrengthSession[]
): Map<string, SessionPersonalRecord[]> {
  const dated = sessions
    .filter((session) => session.startTime !== undefined)
    .sort((a, b) => a.startTime! - b.startTime!);
  const earlier = new Map<string, LiftBest>();
  const records = new Map<string, SessionPersonalRecord[]>();

  for (let index = 0; index < dated.length; ) {
    const at = dated[index]!.startTime;
    const group: [StrengthSession, Map<string, LiftBest>][] = [];
    while (index < dated.length && dated[index]!.startTime === at) {
      const session = dated[index]!;
      group.push([session, sessionLiftBests(session)]);
      index += 1;
    }

    for (const [session, bests] of group) {
      const found: SessionPersonalRecord[] = [];
      for (const [exercise, lift] of bests) {
        const prior = earlier.get(exercise);
        if (!prior) continue;
        if (prior.weightKg > 0 && lift.weightKg > prior.weightKg + RECORD_EPSILON_KG) {
          found.push({ exercise, kind: "weight", valueKg: lift.weightKg, previousKg: prior.weightKg });
        }
        if (prior.e1rmKg > 0 && lift.e1rmKg > prior.e1rmKg + RECORD_EPSILON_KG) {
          found.push({ exercise, kind: "e1rm", valueKg: lift.e1rmKg, previousKg: prior.e1rmKg });
        }
      }
      records.set(session.activityId, found);
    }

    for (const [, bests] of group) {
      for (const [exercise, lift] of bests) {
        const prior = earlier.get(exercise);
        earlier.set(exercise, {
          weightKg: Math.max(prior?.weightKg ?? 0, lift.weightKg),
          e1rmKg: Math.max(prior?.e1rmKg ?? 0, lift.e1rmKg)
        });
      }
    }
  }

  return records;
}

/**
 * Analyses every session once, on its own. The session list and the detail
 * pane both read from this, so nothing re-runs the analytics per row or per
 * render.
 */
export function buildStrengthSessionIndex(sessions: StrengthSession[]): StrengthSessionIndex {
  const records = buildPersonalRecords(sessions);
  const byId = new Map<string, SessionAnalytics>();

  for (const session of sessions) {
    // The window length only feeds sessionsPerWeek, which means nothing for one session.
    const analytics = buildStrengthAnalytics([session], 1);
    const coverage: SessionCoverage = {
      attributed: analytics.attributedSets,
      generic: analytics.genericSets,
      unmapped: analytics.unmappedSets,
      mobility: analytics.mobilitySets,
      working: analytics.attributedSets + analytics.genericSets + analytics.unmappedSets
    };
    byId.set(session.activityId, {
      session,
      analytics,
      attribution: sessionAttribution(coverage),
      coverage,
      records: records.get(session.activityId) ?? []
    });
  }

  return { byId };
}

/**
 * The values and scale the body map should draw for one session: its own
 * busiest muscle is the hottest.
 */
export function sessionHeat(entry: SessionAnalytics, metric: HeatMetric): SessionHeat {
  if (entry.attribution === "generic") {
    return FULL_BODY_FAINT;
  }
  // Unmapped and empty sessions fall through with every muscle at zero, which
  // heatLevel draws as untouched whatever the scale.
  return {
    muscleById: entry.analytics.muscleById,
    max: entry.analytics.muscleMax[metric]
  };
}

/** The figures a session's header shows. Optional ones are absent when the log does not record them. */
export interface SessionStats {
  durationSec: number;
  /** Every set that is not a warm-up. */
  workingSets: number;
  warmupSets: number;
  reps: number;
  volumeKg: number;
  /** Weight lifted per minute of the session; absent without load or duration. */
  densityKgPerMin?: number;
  /** Seconds of rest per second of work; absent when the log records no rest, as Hevy's never does. */
  restPerWork?: number;
  avgHr?: number;
  maxHr?: number;
  trainingLoad?: number;
  calories?: number;
}

export function buildSessionStats(session: StrengthSession): SessionStats {
  const summary = session.detail.summary;
  let workingSets = 0;
  let warmupSets = 0;
  let reps = 0;
  let volumeKg = 0;
  let workSec = 0;
  let restSec = 0;
  for (const exercise of session.detail.exercises) {
    for (const entry of exercise.entries) {
      if (entry.type === "warmup") warmupSets += 1;
      else workingSets += 1;
      reps += entry.reps;
      volumeKg += entry.reps * entry.weightKg;
      workSec += entry.workSec;
      restSec += entry.restSec;
    }
  }
  const durationSec = summary.durationSec || session.duration || 0;
  const optional = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
  return {
    durationSec,
    workingSets,
    warmupSets,
    reps,
    volumeKg,
    densityKgPerMin: volumeKg > 0 && durationSec > 0 ? volumeKg / (durationSec / 60) : undefined,
    restPerWork: workSec > 0 && restSec > 0 ? restSec / workSec : undefined,
    avgHr: optional(session.avgHr ?? summary.avgHr),
    maxHr: optional(session.maxHr ?? summary.maxHr),
    trainingLoad: optional(session.trainingLoad ?? summary.trainingLoad),
    calories: optional(session.calories ?? summary.calories)
  };
}

export interface ExerciseSetRow {
  type: StrengthSetType;
  reps: number;
  weightKg: number;
  /** 0 when the set is outside the range an estimate means anything in. */
  e1rmKg: number;
  workSec: number;
  restSec: number;
  rpe?: number;
}

export interface SessionExerciseRow {
  /** Stable within a session even when a superset lists one exercise twice. */
  key: string;
  name: string;
  sets: ExerciseSetRow[];
  reps: number;
  volumeKg: number;
  /** The heaviest set, the one with more reps on a tie; absent for bodyweight work. */
  topSet?: { weightKg: number; reps: number };
  bestE1rmKg: number;
  /** Records this row set. A superset's two rows never both claim one. */
  records: SessionPersonalRecord[];
}

/** The exercise table, in the order the session logged it. */
export function buildExerciseRows(entry: SessionAnalytics): SessionExerciseRow[] {
  const rows: SessionExerciseRow[] = entry.session.detail.exercises.map((exercise, index) => {
    const sets = exercise.entries.map((set) => ({
      type: set.type ?? "normal",
      reps: set.reps,
      weightKg: set.weightKg,
      e1rmKg: estimateOneRepMax(set.weightKg, set.reps),
      workSec: set.workSec,
      restSec: set.restSec,
      ...(set.rpe !== undefined ? { rpe: set.rpe } : {})
    }));
    const top = sets.reduce<ExerciseSetRow | undefined>(
      (best, set) =>
        set.weightKg > 0 &&
        (!best || set.weightKg > best.weightKg || (set.weightKg === best.weightKg && set.reps > best.reps))
          ? set
          : best,
      undefined
    );
    return {
      key: `${index}-${exercise.nameKey}`,
      name: exerciseDisplayName(exercise.nameKey, exercise.rawName),
      sets,
      reps: sets.reduce((total, set) => total + set.reps, 0),
      volumeKg: sets.reduce((total, set) => total + set.reps * set.weightKg, 0),
      topSet: top ? { weightKg: top.weightKg, reps: top.reps } : undefined,
      bestE1rmKg: Math.max(0, ...sets.map((set) => set.e1rmKg)),
      records: []
    };
  });

  for (const record of entry.records) {
    const holder =
      rows.find(
        (row) =>
          row.name === record.exercise &&
          (record.kind === "weight" ? row.topSet?.weightKg ?? 0 : row.bestE1rmKg) >=
            record.valueKg - RECORD_EPSILON_KG
      ) ?? rows.find((row) => row.name === record.exercise);
    holder?.records.push(record);
  }
  return rows;
}
