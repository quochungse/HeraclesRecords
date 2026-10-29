/**
 * A session's load in the load the athlete reads strength in — COROS's
 * Training Load or Heracles Training Load (docs/heracles-training-load.md) —
 * and the hover that states both. Pure, so the screens' models can use it;
 * the setting itself is `useLoadSource()` (`loadSource.tsx`).
 *
 * Only a strength session reads differently: every other sport's Heracles load
 * is COROS's, and anything COROS derives from its own load — Base Fitness,
 * Load Impact, the recommended range — is only ever set against COROS's load.
 */
import type { HeraclesLoad, HeraclesLoadQuality, StrengthLoadSource } from "../../electron/types";
import { formatCount, t } from "../i18n/core";

interface Loaded {
  trainingLoad?: number;
  heraclesLoad?: HeraclesLoad;
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
 * A session's load and its plan's, both in one load: Heracles's only where
 * both sides carry it, so a plan COROS priced is never set against a figure
 * of the other scale. The main process compares the same way
 * (`loadsToCompare` in `trainingLibraryService.ts`).
 */
export function comparableLoads(
  planned: Loaded,
  done: Loaded | undefined,
  source: StrengthLoadSource
): { planned?: number; done?: number } {
  if (source === "heracles" && planned.heraclesLoad && done?.heraclesLoad) {
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

function qualityNote(quality: HeraclesLoadQuality | undefined): string | undefined {
  if (quality === "estimate") return t("units.load.estimate");
  if (quality === "pending") return t("units.load.pending");
  if (quality === "planned") return t("units.load.planned");
  return undefined;
}

/**
 * The hover that states both figures, so whoever reads Heracles TL always
 * sees COROS's beside it. Undefined while COROS is the chosen load, and where
 * the two agree with nothing to flag.
 */
export function loadPairTitle(
  source: StrengthLoadSource,
  heracles: number | undefined,
  coros: number | undefined,
  quality?: HeraclesLoadQuality
): string | undefined {
  if (source !== "heracles" || heracles === undefined) return undefined;
  const note = qualityNote(quality);
  const shown = Math.round(heracles);
  const corosShown = coros !== undefined ? Math.round(coros) : undefined;
  if (corosShown === shown && !note) return undefined;
  const pair =
    corosShown !== undefined
      ? t("units.load.pair", { heracles: formatCount(shown), coros: formatCount(corosShown) })
      : t("units.load.pairNoCoros", { heracles: formatCount(shown) });
  return note ? `${pair}\n${note}` : pair;
}

/** `loadPairTitle` for one session. */
export function activityLoadTitle(activity: Loaded, source: StrengthLoadSource): string | undefined {
  return loadPairTitle(source, activity.heraclesLoad?.value, activity.trainingLoad, activity.heraclesLoad?.quality);
}
