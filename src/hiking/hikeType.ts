import type { TrainingHubActivity } from "../../electron/types";

/**
 * The two kinds of hike COROS records, kept apart for the reason a run's
 * surfaces and a ride's bikes are.
 *
 * Time on the trail and metres climbed are the same effort whichever mode the
 * watch was in, so the totals on this screen add both together. Speed is not:
 * a mountain climb spends its day on ground where a kilometre can take an hour,
 * and read beside a forest hike it only says the ground was different.
 *
 * Codes are COROS `sportType`; keep them in sync with electron/corosSportTypes.ts.
 * 106 ("Climb") is not here: nothing this app has seen says what COROS records
 * under it, and the climbing family (800–802) is rope and wall, not a trail.
 */
export type HikeType = "hike" | "mountain";

/** Render order: the everyday kind first. */
export const HIKE_TYPES: readonly HikeType[] = ["hike", "mountain"];

const SPORT_TYPE_HIKE: Record<number, HikeType> = {
  104: "hike", //     Hike
  105: "mountain" //  Mountain Climb
};

export const HIKE_TYPE_LABELS: Record<HikeType, string> = {
  hike: "Hike",
  mountain: "Mountain climb"
};

/**
 * A hike or a mountain climb. `isRunSportType` leaves both out on purpose —
 * a walking pace in a running pace distribution is noise — and this is where
 * they are counted instead.
 */
export function isHikeSportType(sportType: number | undefined): boolean {
  return sportType !== undefined && sportType in SPORT_TYPE_HIKE;
}

/** The kind of hike a sport code is, or null when the code is not one. */
export function classifyHikeType(sportType: number | undefined): HikeType | null {
  if (sportType === undefined) {
    return null;
  }

  return SPORT_TYPE_HIKE[sportType] ?? null;
}

/** Every hike in a mixed activity list, newest first as COROS sends them. */
export function hikesOnly(
  activities: readonly TrainingHubActivity[]
): TrainingHubActivity[] {
  return activities.filter((activity) => isHikeSportType(activity.sportType));
}

/** Hikes of one kind, or all of them when no kind is asked for. */
export function hikesOfType(
  activities: readonly TrainingHubActivity[],
  type: HikeType | null
): TrainingHubActivity[] {
  const hikes = hikesOnly(activities);
  return type === null
    ? hikes
    : hikes.filter((activity) => classifyHikeType(activity.sportType) === type);
}
