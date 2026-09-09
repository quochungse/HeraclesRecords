import type { TrainingHubActivity } from "../../electron/types";
import { isActivityInLastFourWeeks } from "./activityWindow";

export interface DistanceZoneBucket {
  /** Metric fallback label; the panel relabels these in the display unit. */
  label: string;
  /** Inclusive lower bound, in metres. */
  minMeters: number;
  /** Exclusive upper bound, in metres; absent on the open-ended top bucket. */
  maxMeters?: number;
}

export interface DistanceZoneTotal extends DistanceZoneBucket {
  count: number;
  trainingLoad: number;
  duration: number;
}

/**
 * The 5 km steps COROS itself buckets distance on, so this panel and the COROS
 * app put a session in the same place. The boundaries are not stated anywhere
 * in their payload — they were probed against the live `/analyse/query` on
 * 2026-09-09; see the note on `buildDistanceZoneTotals`.
 *
 * Half-open: an activity belongs to the bucket whose `minMeters` it reaches and
 * whose `maxMeters` it has not, so "5–10 km" is strictly under 10 km and a
 * 10.00 km session lands in "10–15 km".
 */
export const DISTANCE_ZONE_BUCKETS: readonly DistanceZoneBucket[] = [
  { label: "0–5 km", minMeters: 0, maxMeters: 5_000 },
  { label: "5–10 km", minMeters: 5_000, maxMeters: 10_000 },
  { label: "10–15 km", minMeters: 10_000, maxMeters: 15_000 },
  { label: "15–20 km", minMeters: 15_000, maxMeters: 20_000 },
  { label: "20–25 km", minMeters: 20_000, maxMeters: 25_000 },
  { label: "25+ km", minMeters: 25_000 }
];

/**
 * Index of the bucket a distance falls in, or -1 for a distance no bucket
 * claims (a non-finite value, or zero — a session that recorded no distance
 * is not a 0 km session and must not pad the first bucket).
 */
export function distanceZoneIndex(
  distanceMeters: number | undefined,
  buckets: readonly DistanceZoneBucket[] = DISTANCE_ZONE_BUCKETS
): number {
  if (
    distanceMeters === undefined ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0
  ) {
    return -1;
  }

  return buckets.findIndex(
    (bucket) =>
      distanceMeters >= bucket.minMeters &&
      (bucket.maxMeters === undefined || distanceMeters < bucket.maxMeters)
  );
}

/**
 * Tally the last four weeks into the distance buckets — every sport that
 * records a distance, which is to say every activity that has one. Sports that
 * record no distance (strength, and anything else that arrives without one)
 * are simply absent rather than filtered by sport code: the distance is the
 * thing being bucketed, so its absence is the only test that matters.
 *
 * **Why this is computed here rather than read off COROS.** `/analyse/query`
 * ships its own `summaryInfo.distanceCountAreaList` / `distanceTlAreaList` /
 * `distanceTimeAreaList` on these same 5 km boundaries, and the panel used to
 * render those. Two problems, both found by probing the live API on
 * 2026-09-09. The boundaries are nowhere in the payload, so the panel had
 * guessed 10 km steps and pasted those labels on by array position — index 2
 * ("10–15 km", eight runs) was drawn as "20–30 km" and index 3 ("15–20 km",
 * three runs) as "30–40 km", which is how an athlete whose longest run was
 * 16.34 km saw counts above 20 km. And COROS counts *every* session in that
 * list, so seven strength workouts with no distance at all sat in its first
 * bucket, reading 8 where the honest answer was 1.
 *
 * The renderer holds the full activity history, so nothing is lost by tallying
 * locally, the distance-less sessions stay out, and the labels are true by
 * construction while still agreeing with what the COROS app shows.
 */
export function buildDistanceZoneTotals(
  activities: TrainingHubActivity[],
  options: { now?: number; buckets?: readonly DistanceZoneBucket[] } = {}
): DistanceZoneTotal[] {
  const buckets = options.buckets ?? DISTANCE_ZONE_BUCKETS;
  // Read once, not per activity: the window has to be the same one for every
  // session in a tally, and this runs over the whole history.
  const now = options.now ?? Date.now();
  const totals: DistanceZoneTotal[] = buckets.map((bucket) => ({
    ...bucket,
    count: 0,
    trainingLoad: 0,
    duration: 0
  }));

  for (const activity of activities) {
    if (!isActivityInLastFourWeeks(activity, now)) {
      continue;
    }

    const index = distanceZoneIndex(activity.distance, buckets);

    if (index < 0) {
      continue;
    }

    const bucket = totals[index];

    if (!bucket) {
      continue;
    }

    bucket.count += 1;
    bucket.trainingLoad += Number.isFinite(activity.trainingLoad)
      ? activity.trainingLoad ?? 0
      : 0;
    bucket.duration += Number.isFinite(activity.duration)
      ? activity.duration ?? 0
      : 0;
  }

  return totals;
}
