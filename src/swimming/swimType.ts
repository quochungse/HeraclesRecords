import type { SwimStyle, TrainingHubActivity } from "../../electron/types";
import { isSwimSportType } from "../../electron/swimDetail";
import { t } from "../i18n/core";

/**
 * The two kinds of swim COROS records, kept apart for the reason a run's
 * surfaces are.
 *
 * A pool swim is counted length by length: the watch feels each turn, so it
 * knows the strokes, the SWOLF and the stroke of every length, and its
 * distance is lengths times the pool. Open water has no walls — the distance
 * is GPS caught between strokes, and there is no length, no SWOLF and no
 * stroke to read. The totals add both together; everything about technique is
 * read in the pool.
 *
 * Codes are COROS `sportType`; keep them in sync with electron/corosSportTypes.ts.
 */
export type SwimType = "pool" | "open";

/** Render order: the everyday kind first. */
export const SWIM_TYPES: readonly SwimType[] = ["pool", "open"];

const SPORT_TYPE_SWIM: Record<number, SwimType> = {
  300: "pool", // Pool Swim
  301: "open" //  Open Water
};

export const SWIM_TYPE_LABELS: Readonly<Record<SwimType, string>> = {
  get pool() {
    return t("swim.type.pool");
  },
  get open() {
    return t("swim.type.open");
  }
};

/** A stroke's name, in the language on screen. */
export const SWIM_STYLE_LABELS: Readonly<Record<SwimStyle, string>> = {
  get free() {
    return t("swim.style.free");
  },
  get back() {
    return t("swim.style.back");
  },
  get breast() {
    return t("swim.style.breast");
  },
  get fly() {
    return t("swim.style.fly");
  },
  get medley() {
    return t("swim.style.medley");
  },
  get mixed() {
    return t("swim.style.mixed");
  },
  get drill() {
    return t("swim.style.drill");
  },
  get unknown() {
    return t("swim.style.unknown");
  }
};

/** A pool or open-water swim: the main process's answer, so both layers agree. */
export { isSwimSportType };

/** The kind of swim a sport code is, or null when the code is not one. */
export function classifySwimType(sportType: number | undefined): SwimType | null {
  if (sportType === undefined) {
    return null;
  }
  return SPORT_TYPE_SWIM[sportType] ?? null;
}

/** Every swim in a mixed activity list, newest first as COROS sends them. */
export function swimsOnly(activities: readonly TrainingHubActivity[]): TrainingHubActivity[] {
  return activities.filter((activity) => isSwimSportType(activity.sportType));
}

/** Swims of one kind, or all of them when no kind is asked for. */
export function swimsOfType(
  activities: readonly TrainingHubActivity[],
  type: SwimType | null
): TrainingHubActivity[] {
  const swims = swimsOnly(activities);
  return type === null
    ? swims
    : swims.filter((activity) => classifySwimType(activity.sportType) === type);
}
