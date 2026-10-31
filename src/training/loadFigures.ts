/**
 * A session's load in the load the athlete reads strength in — COROS's
 * Training Load or Heracles Training Load (docs/heracles-training-load.md).
 * One figure, the chosen one; both only where a COROS-made figure stands
 * beside it (`loadPairTitle`). Pure, so the screens' models can use it;
 * the setting itself is `useLoadSource()` (`loadSource.tsx`).
 *
 * Only a strength session reads differently: every other sport's Heracles load
 * is COROS's. What COROS derives from the daily load — Base Fitness, Load
 * Impact, the recommended range — follows the choice through
 * `electron/heraclesFitness.ts`, never figure by figure here.
 */
import type { HeraclesLoad, StrengthLoadSource } from "../../electron/types";
import { formatCount, t } from "../i18n/core";
import { isStrengthStyleWorkout, scheduledWorkoutSport } from "./workoutSport";

interface Loaded {
  trainingLoad?: number;
  heraclesLoad?: HeraclesLoad;
}

/** A session on the plan, as the schedule lists it. */
interface PlannedSession extends Loaded {
  sportType?: number;
  exercises?: readonly { reps?: number; holdSec?: number }[];
}

/** A session's load as the athlete reads it: Heracles's for a strength session when chosen, else COROS's. */
export function activityLoad(activity: Loaded, source: StrengthLoadSource): number | undefined {
  return source === "heracles" && activity.heraclesLoad ? activity.heraclesLoad.value : activity.trainingLoad;
}

/** What Heracles adds to COROS's figure for one session: 0 for any other sport, or with COROS chosen. */
export function heraclesSurplus(activity: Loaded, source: StrengthLoadSource): number {
  if (source !== "heracles" || !activity.heraclesLoad) return 0;
  return Math.max(0, activity.heraclesLoad.value - (activity.trainingLoad ?? 0));
}

/** A planned session's load, the same way: Heracles's estimate for a strength session when chosen. */
export function plannedLoad(workout: Loaded, source: StrengthLoadSource): number | undefined {
  return activityLoad(workout, source);
}

/**
 * A strength or HYROX plan that states no reps and no holds — its steps left
 * open — so the load Heracles gives it is guessed from its length.
 */
export function planStatesNoSets(workout: PlannedSession): boolean {
  if (!isStrengthStyleWorkout(scheduledWorkoutSport(workout.sportType))) return false;
  return !(workout.exercises ?? []).some((exercise) => (exercise.reps ?? 0) > 0 || (exercise.holdSec ?? 0) > 0);
}

/**
 * A plan that is only a length — no sets stated, and no load COROS gave it —
 * so nothing done can be read against it: a 6-minute plan of open steps, done
 * in 61, read 1010%.
 */
export function planIsOnlyALength(workout: PlannedSession): boolean {
  return planStatesNoSets(workout) && !((workout.trainingLoad ?? 0) > 0);
}

/**
 * What a planned load needs said while Heracles is chosen: that it is
 * Heracles's estimate of the plan, from its sets or, where it states none,
 * from its length. Nothing for COROS's own planned figure.
 */
export function plannedLoadNote(workout: PlannedSession, source: StrengthLoadSource): string | undefined {
  if (source !== "heracles" || workout.heraclesLoad?.quality !== "planned") return undefined;
  return t(planStatesNoSets(workout) ? "units.load.plannedFromLength" : "units.load.planned");
}

/**
 * A session's load and its plan's, both in one load: Heracles's only where
 * both sides carry it, so a plan COROS priced is never set against a figure
 * of the other scale. A session whose sets are still loading (`pending`)
 * carries COROS's figure as its Heracles load, so it is not one of them yet.
 * The main process compares the same way (`loadsToCompare` in
 * `trainingLibraryService.ts`).
 */
export function comparableLoads(
  planned: Loaded,
  done: Loaded | undefined,
  source: StrengthLoadSource
): { planned?: number; done?: number } {
  if (source === "heracles" && planned.heraclesLoad && done?.heraclesLoad && done.heraclesLoad.quality !== "pending") {
    return { planned: planned.heraclesLoad.value, done: done.heraclesLoad.value };
  }
  return { planned: planned.trainingLoad, done: done?.trainingLoad };
}

/**
 * Sessions (done or planned) whose `trainingLoad` reads in the chosen load,
 * for code that only adds loads up or compares them — never for anything set
 * against COROS's own figures. The list as given while COROS is chosen.
 */
export function inLoadSource<T extends Loaded>(sessions: readonly T[], source: StrengthLoadSource): T[] {
  if (source !== "heracles") return sessions as T[];
  return sessions.map((session) =>
    session.heraclesLoad ? { ...session, trainingLoad: session.heraclesLoad.value } : session
  );
}

/**
 * What a single Heracles figure needs said beside it: that it is estimated,
 * or that it is still COROS's while the sets load. Nothing while COROS is the
 * chosen load, and nothing for a figure read off the sets.
 */
export function activityLoadNote(activity: Loaded, source: StrengthLoadSource): string | undefined {
  if (source !== "heracles") return undefined;
  const quality = activity.heraclesLoad?.quality;
  if (quality === "estimate") return t("units.load.estimate");
  if (quality === "pending") return t("units.load.pending");
  return undefined;
}

/**
 * One of COROS's own fitness figures run on Heracles Training Load, beside
 * COROS's — "Heracles 167 · COROS 108" — since the COROS app shows the other.
 * Undefined while COROS is chosen, or where the two read alike.
 */
export function figurePairTitle(
  source: StrengthLoadSource,
  heracles: string | undefined,
  coros: string | undefined
): string | undefined {
  if (source !== "heracles" || heracles === undefined || coros === undefined || heracles === coros) return undefined;
  return t("units.load.pairFigure", { heracles, coros });
}

/**
 * Both figures, for the few places a Heracles total stands beside something
 * COROS made from its own load — the recommended weekly range — where one
 * figure alone would read as a contradiction. Everywhere else a load is one
 * figure. Undefined while COROS is chosen, or where the two agree.
 */
export function loadPairTitle(
  source: StrengthLoadSource,
  heracles: number | undefined,
  coros: number | undefined
): string | undefined {
  if (source !== "heracles" || heracles === undefined || coros === undefined) return undefined;
  const shown = Math.round(heracles);
  const corosShown = Math.round(coros);
  if (corosShown === shown) return undefined;
  return t("units.load.pair", { heracles: formatCount(shown), coros: formatCount(corosShown) });
}
