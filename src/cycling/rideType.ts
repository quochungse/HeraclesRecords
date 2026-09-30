import type { TrainingHubActivity } from "../../electron/types";

/**
 * The five kinds of ride, kept apart for the reason a run's surfaces are.
 *
 * Volume is volume on any bike — the legs turned the pedals either way — so the
 * totals on this screen add every kind together. Speed is not: 28 km/h on a
 * road bike and 14 km/h on a mountain bike on singletrack say nothing about each
 * other, an indoor trainer records no climb, and an e-bike's motor is in every
 * figure it returns. So speed and climb are read one kind at a time.
 *
 * Codes are COROS `sportType`; keep them in sync with electron/corosSportTypes.ts.
 */
export type RideType = "road" | "gravel" | "mountain" | "indoor" | "ebike";

/** Render order: outdoors first, most common first, the assisted kind last. */
export const RIDE_TYPES: readonly RideType[] = [
  "road",
  "gravel",
  "mountain",
  "indoor",
  "ebike"
];

const SPORT_TYPE_RIDE: Record<number, RideType> = {
  200: "road", //     Bike
  201: "indoor", //   Indoor Bike
  202: "ebike", //    Road E-Bike
  203: "gravel", //   Gravel Road Bike
  204: "mountain", // Mountain Bike
  205: "ebike", //    Mountain E-Bike
  // COROS's own name for a ride recorded through its smart helmet. It is an
  // outdoor ride on an unassisted bike, which is what "road" means here.
  299: "road" //      Helmet Bike
};

export const RIDE_TYPE_LABELS: Record<RideType, string> = {
  road: "Road",
  gravel: "Gravel",
  mountain: "Mountain",
  indoor: "Indoor",
  ebike: "E-bike"
};

/**
 * Every bike code COROS has, e-bikes included. An e-bike ride is a ride — it is
 * on the calendar, it went somewhere, it cost something — so it is counted; it
 * is kept to a kind of its own so its speed never sits beside an unassisted
 * one's.
 */
export function isRideSportType(sportType: number | undefined): boolean {
  return sportType !== undefined && sportType in SPORT_TYPE_RIDE;
}

/** The kind of ride a sport code is, or null when the code is not a ride. */
export function classifyRideType(sportType: number | undefined): RideType | null {
  if (sportType === undefined) {
    return null;
  }

  return SPORT_TYPE_RIDE[sportType] ?? null;
}

/**
 * Whether a kind of ride records the outdoors. A trainer reports no climb and
 * no route, so elevation figures must not count it as a zero — that would drag
 * every average down with data the watch never had.
 */
export function isOutdoorRideType(type: RideType): boolean {
  return type !== "indoor";
}

/** Every ride in a mixed activity list, newest first as COROS sends them. */
export function ridesOnly(
  activities: readonly TrainingHubActivity[]
): TrainingHubActivity[] {
  return activities.filter((activity) => isRideSportType(activity.sportType));
}

/** Rides of one kind, or all of them when no kind is asked for. */
export function ridesOfType(
  activities: readonly TrainingHubActivity[],
  type: RideType | null
): TrainingHubActivity[] {
  const rides = ridesOnly(activities);
  return type === null
    ? rides
    : rides.filter((activity) => classifyRideType(activity.sportType) === type);
}
