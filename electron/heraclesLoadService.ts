/**
 * Heracles Training Load, read once in the main process and carried on the
 * payloads the screens already receive (docs/heracles-training-load.md).
 *
 * Every figure is recomputed from what is stored — the cached breakdowns, the
 * rated runs, the body weight — and never stored itself. One run scores every
 * strength session oldest first and is kept until any of those inputs moves.
 */

import {
  getSetting,
  heraclesLoadInputsVersion,
  listRatedActivityLoads,
  listStoredStrengthSessions,
  listStrengthActivitiesWithoutBreakdown,
  setSetting
} from "./database";
import {
  bridgeFactor,
  estimatePlannedLoad,
  runHeraclesLoads,
  type HeraclesBridge,
  type HeraclesLoadRun,
  type PlannedStrengthSession,
  type RatedRun
} from "./heraclesLoad";
import { HERACLES_FACTORS_VERSION } from "./heraclesLoadFactors";
import { getStoredHevyStrengthSessions } from "./hevyService";
import { combineStrengthSessions } from "./strengthSessionMerge";
import { lastKnownCorosWeightKg } from "./trainingHubService";
import type {
  HeraclesLoad,
  HeraclesLoadInfo,
  StrengthLoadSource,
  StrengthSession,
  TrainingHubActivity
} from "./types";

export const STRENGTH_LOAD_SOURCE_SETTING = "strength.loadSource";
export const STRENGTH_LOAD_SPORT_TYPES: ReadonlySet<number> = new Set([400, 402]);
/** As far back as a lift's capacity reaches, and the bridge's runs. */
const HISTORY_DAYS = 3650;
const SECONDS_PER_DAY = 86_400;

export interface HeraclesLoadDeps {
  /** Every cached strength session, COROS's and Hevy's. */
  strengthSessions(): StrengthSession[];
  /** Strength activities stored with no breakdown. */
  withoutBreakdown(): string[];
  ratedRuns(): RatedRun[];
  bodyWeightKg(startTime: number | undefined): number | undefined;
  /** Changes whenever the inputs do. */
  inputsVersion(): string;
  /** Epoch seconds. */
  now(): number;
}

export function createDefaultDeps(): HeraclesLoadDeps {
  const since = () => Math.floor(Date.now() / 1000) - HISTORY_DAYS * SECONDS_PER_DAY;
  return {
    strengthSessions: () =>
      combineStrengthSessions(listStoredStrengthSessions(since()), getStoredHevyStrengthSessions(HISTORY_DAYS)),
    withoutBreakdown: () => listStrengthActivitiesWithoutBreakdown(),
    ratedRuns: () => listRatedActivityLoads(since()),
    bodyWeightKg: () => lastKnownCorosWeightKg(),
    inputsVersion: () => heraclesLoadInputsVersion(),
    now: () => Math.floor(Date.now() / 1000)
  };
}

let defaultDeps: HeraclesLoadDeps | undefined;
function depsOrDefault(deps: HeraclesLoadDeps | undefined): HeraclesLoadDeps {
  if (deps) return deps;
  defaultDeps ??= createDefaultDeps();
  return defaultDeps;
}

interface HeraclesLoadSnapshot {
  version: string;
  bridge: HeraclesBridge;
  run: HeraclesLoadRun;
  /** By every id a session goes by: its own, COROS's, Hevy's. */
  byId: Map<string, StrengthSession>;
  withoutBreakdown: ReadonlySet<string>;
}

const snapshots = new WeakMap<HeraclesLoadDeps, HeraclesLoadSnapshot>();

function snapshotFor(deps: HeraclesLoadDeps): HeraclesLoadSnapshot {
  const now = deps.now();
  const weight = deps.bodyWeightKg(now);
  // The day is part of it: the bridge's window and the capacities' move daily.
  const version = [
    deps.inputsVersion(),
    weight ?? "",
    HERACLES_FACTORS_VERSION,
    Math.floor(now / SECONDS_PER_DAY)
  ].join("#");
  const cached = snapshots.get(deps);
  if (cached?.version === version) return cached;

  const bridge = bridgeFactor(deps.ratedRuns(), now);
  const sessions = deps.strengthSessions();
  const run = runHeraclesLoads(sessions, { k: bridge.k, bodyWeightKg: (startTime) => deps.bodyWeightKg(startTime) });
  const byId = new Map<string, StrengthSession>();
  for (const session of sessions) {
    byId.set(session.activityId, session);
    if (session.sourceIds?.coros) byId.set(session.sourceIds.coros, session);
    if (session.sourceIds?.hevy) byId.set(`hevy:${session.sourceIds.hevy}`, session);
  }
  const snapshot: HeraclesLoadSnapshot = {
    version,
    bridge,
    run,
    byId,
    withoutBreakdown: new Set(deps.withoutBreakdown())
  };
  snapshots.set(deps, snapshot);
  return snapshot;
}

export function getStrengthLoadSource(): StrengthLoadSource {
  return getSetting(STRENGTH_LOAD_SOURCE_SETTING) === "heracles" ? "heracles" : "coros";
}

export function setStrengthLoadSource(source: StrengthLoadSource): void {
  setSetting(STRENGTH_LOAD_SOURCE_SETTING, source === "heracles" ? "heracles" : "coros");
}

export function getHeraclesLoadInfo(deps?: HeraclesLoadDeps): HeraclesLoadInfo {
  const resolved = depsOrDefault(deps);
  const { bridge } = snapshotFor(resolved);
  const bodyWeightKg = resolved.bodyWeightKg(resolved.now());
  return {
    source: getStrengthLoadSource(),
    k: bridge.k,
    bridgeRuns: bridge.runs,
    bridgeMeasured: bridge.measured,
    ...(bodyWeightKg !== undefined ? { bodyWeightKg } : {})
  };
}

/**
 * A strength activity's Heracles load; undefined for any other sport. A
 * strength session whose sets have not been read yet carries COROS's figure,
 * marked as pending; one COROS kept no sets for is gym cardio, and COROS's
 * heart-rate figure is what it is.
 */
export function heraclesLoadFor(
  activity: Pick<TrainingHubActivity, "activityId" | "sportType" | "trainingLoad">,
  deps?: HeraclesLoadDeps
): HeraclesLoad | undefined {
  if (!STRENGTH_LOAD_SPORT_TYPES.has(activity.sportType)) return undefined;
  const snapshot = snapshotFor(depsOrDefault(deps));
  const session = snapshot.byId.get(activity.activityId);
  const scored = session ? snapshot.run.sessions.get(session.activityId) : undefined;
  if (scored) {
    const { sets: _sets, sessionRpe: _rpe, ...load } = scored;
    return load;
  }
  const cardio = activity.trainingLoad;
  const quality = snapshot.withoutBreakdown.has(activity.activityId) ? "conditioning" : "pending";
  return {
    value: cardio ?? 0,
    ...(cardio !== undefined ? { cardio } : {}),
    muscular: 0,
    quality
  };
}

/** The list as COROS sent it, each strength session carrying its Heracles load. */
export function withHeraclesLoads<T extends TrainingHubActivity>(activities: T[], deps?: HeraclesLoadDeps): T[] {
  if (!activities.some((activity) => STRENGTH_LOAD_SPORT_TYPES.has(activity.sportType))) return activities;
  return activities.map((activity) => {
    const heraclesLoad = heraclesLoadFor(activity, deps);
    return heraclesLoad ? { ...activity, heraclesLoad } : activity;
  });
}

function sameShape(left: StrengthSession, right: StrengthSession): boolean {
  const a = left.detail.exercises;
  const b = right.detail.exercises;
  return a.length === b.length && a.every((exercise, index) => exercise.entries.length === b[index].entries.length);
}

/**
 * Strength sessions as a source selection returned them, each with its
 * Heracles load. The sets are scored on the session the run read — the
 * merged one when COROS and Hevy logged the same workout — and are carried
 * only when they line up with the session handed in.
 */
export function withStrengthSessionLoads(sessions: StrengthSession[], deps?: HeraclesLoadDeps): StrengthSession[] {
  if (sessions.length === 0) return sessions;
  const snapshot = snapshotFor(depsOrDefault(deps));
  return sessions.map((session) => {
    const scoredSession =
      snapshot.byId.get(session.activityId) ??
      (session.sourceIds?.coros ? snapshot.byId.get(session.sourceIds.coros) : undefined) ??
      (session.sourceIds?.hevy ? snapshot.byId.get(`hevy:${session.sourceIds.hevy}`) : undefined);
    const scored = scoredSession ? snapshot.run.sessions.get(scoredSession.activityId) : undefined;
    if (!scored || !scoredSession) return session;
    if (sameShape(scoredSession, session)) return { ...session, heracles: scored };
    const { sets: _sets, ...withoutSets } = scored;
    return { ...session, heracles: withoutSets };
  });
}

/** A strength session still on the plan; undefined when the plan states neither sets nor a length. */
export function plannedHeraclesLoad(plan: PlannedStrengthSession, deps?: HeraclesLoadDeps): HeraclesLoad | undefined {
  const resolved = depsOrDefault(deps);
  const snapshot = snapshotFor(resolved);
  return estimatePlannedLoad(plan, snapshot.run.state, resolved.now());
}
