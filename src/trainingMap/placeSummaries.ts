// What the Where you've been screen says about each place, out of the view for
// the reason activityFilters.ts sits outside ActivitiesView: it is the part a
// test can reach. No `node:` imports and no React.
import type { TrainingHubActivity } from "../../electron/types";
import {
  sportColorCategory,
  type SportColorCategory,
} from "../training/sportColors";
import {
  geoHeatBucketKey,
  type ActivityVisitPoint,
  type GeoHeatBucket,
  type GlobePoint,
} from "./activityVisitHeatmap";
import type { PlaceLabel } from "./placeLabels";

export interface PlaceSummary {
  key: string;
  bucket: GeoHeatBucket;
  /** Newest first. */
  activities: TrainingHubActivity[];
  distanceMeters: number;
  durationSeconds: number;
  elevationMeters: number;
  /** Epoch ms of the newest and oldest visit; 0 when no activity carries a time. */
  lastVisitedMs: number;
  firstVisitedMs: number;
}

export type PlaceSort = "recent" | "visits";

/** COROS sends seconds; a value already in milliseconds is left alone. */
export function activityTimestampMs(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return 0;
  }
  return value < 10_000_000_000 ? value * 1000 : value;
}

/**
 * One summary per bucket that holds an activity still in the list, newest
 * visit first. A visit whose activity has left the list (another period) does
 * not count, so a bucket can come out empty and be dropped.
 */
export function buildPlaceSummaries(
  activities: readonly TrainingHubActivity[],
  visits: readonly ActivityVisitPoint[],
  buckets: readonly GeoHeatBucket[],
): PlaceSummary[] {
  const activitiesById = new Map(
    activities.map((activity) => [activity.activityId, activity]),
  );
  const idsByBucket = new Map<string, Set<string>>();
  for (const visit of visits) {
    const key = geoHeatBucketKey(visit);
    const ids = idsByBucket.get(key);
    if (ids) {
      ids.add(visit.activityId);
    } else {
      idsByBucket.set(key, new Set([visit.activityId]));
    }
  }
  return buckets
    .map((bucket) => {
      const placeActivities = [...(idsByBucket.get(bucket.key) ?? [])]
        .map((activityId) => activitiesById.get(activityId))
        .filter(
          (activity): activity is TrainingHubActivity => Boolean(activity),
        )
        .sort(
          (left, right) =>
            activityTimestampMs(right.startTime) -
            activityTimestampMs(left.startTime),
        );
      let distanceMeters = 0;
      let durationSeconds = 0;
      let elevationMeters = 0;
      for (const activity of placeActivities) {
        distanceMeters += activity.distance ?? 0;
        durationSeconds += activity.duration ?? 0;
        elevationMeters += activity.elevationGain ?? 0;
      }
      return {
        key: bucket.key,
        bucket,
        activities: placeActivities,
        distanceMeters,
        durationSeconds,
        elevationMeters,
        lastVisitedMs: activityTimestampMs(placeActivities[0]?.startTime),
        firstVisitedMs: activityTimestampMs(placeActivities.at(-1)?.startTime),
      };
    })
    .filter((summary) => summary.activities.length > 0)
    .sort((left, right) => right.lastVisitedMs - left.lastVisitedMs);
}

/** Newest visit first, or most visits first with the newest breaking a tie. */
export function sortPlaces(
  places: readonly PlaceSummary[],
  sort: PlaceSort,
): PlaceSummary[] {
  return [...places].sort((left, right) =>
    sort === "visits"
      ? right.activities.length - left.activities.length ||
        right.lastVisitedMs - left.lastVisitedMs
      : right.lastVisitedMs - left.lastVisitedMs,
  );
}

/** Where most of the training happens, which is what "home" means here. */
export function homePlace(
  places: readonly PlaceSummary[],
): PlaceSummary | undefined {
  return sortPlaces(places, "visits")[0];
}

const EARTH_RADIUS_KM = 6371;
const FARTHEST_MIN_KM = 100;

export function haversineKm(a: GlobePoint, b: GlobePoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The place furthest from home, once it is 100 km away: nearer than that it is
 * a day out from home rather than a trip, the line the Hall of Records draws
 * for its "furthest from home" milestones too.
 */
export function farthestFromHome(
  places: readonly PlaceSummary[],
): { home: PlaceSummary; place: PlaceSummary; km: number } | undefined {
  const home = homePlace(places);
  if (!home) {
    return undefined;
  }
  let best: { place: PlaceSummary; km: number } | undefined;
  for (const place of places) {
    const km = haversineKm(home.bucket, place.bucket);
    if (!best || km > best.km) {
      best = { place, km };
    }
  }
  return best && best.km >= FARTHEST_MIN_KM ? { home, ...best } : undefined;
}

/** "Việt Nam" and "Vietnam" meet: the two geocoders name a country in two languages. */
function foldCountryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

/**
 * How many countries the places are in — or nothing, while any place is still
 * unnamed: a count of the named ones would read as the answer and be short.
 */
export function countriesVisited(
  places: readonly PlaceSummary[],
  labels: Readonly<Record<string, PlaceLabel>>,
): number | undefined {
  const countries = new Set<string>();
  for (const place of places) {
    const label = labels[place.key];
    if (!label?.country) {
      return undefined;
    }
    countries.add(
      label.countryCode?.toUpperCase() ?? foldCountryName(label.country),
    );
  }
  // A name cached before country codes existed counts once with its coded twin.
  const codes = new Map<string, string>();
  for (const place of places) {
    const label = labels[place.key];
    if (label?.countryCode) {
      codes.set(foldCountryName(label.country), label.countryCode.toUpperCase());
    }
  }
  const merged = new Set<string>();
  for (const country of countries) {
    merged.add(codes.get(country) ?? country);
  }
  return merged.size;
}

// Written out rather than asked of Intl: en-GB spells September "Sept", and
// the Hall of Records, which names the same days, writes "Sep".
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "6 Aug 2024". */
export function formatDayLong(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Mar 2025". */
export function formatMonthYear(ms: number): string {
  const date = new Date(ms);
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "4 Oct" within the current year, "14 Dec 2025" before it. */
export function formatDayNear(ms: number, nowMs = Date.now()): string {
  if (!ms) {
    return "";
  }
  const date = new Date(ms);
  return date.getFullYear() === new Date(nowMs).getFullYear()
    ? `${date.getDate()} ${MONTHS[date.getMonth()]}`
    : formatDayLong(ms);
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * The line under the screen's title: what the map holds, in one sentence.
 * "425 activities in 11 places and 2 countries since 6 Aug 2024 · Farthest:
 * Đà Lạt, 1,048 km from Hà Nội". The date only for all time — a shorter
 * period is already named by its own picker.
 */
export function placesSummaryLine({
  places,
  labels,
  allTime,
}: {
  places: readonly PlaceSummary[];
  labels: Readonly<Record<string, PlaceLabel>>;
  allTime: boolean;
}): string {
  if (places.length === 0) {
    return "";
  }
  const activityCount = places.reduce(
    (sum, place) => sum + place.activities.length,
    0,
  );
  const countries = countriesVisited(places, labels);
  let line = `${plural(activityCount, "activity", "activities")} in ${plural(places.length, "place", "places")}`;
  if (countries !== undefined && countries > 1) {
    line += ` and ${plural(countries, "country", "countries")}`;
  }
  if (allTime) {
    const first = Math.min(
      ...places
        .map((place) => place.firstVisitedMs)
        .filter((ms) => ms > 0),
    );
    if (Number.isFinite(first)) {
      line += ` since ${formatDayLong(first)}`;
    }
  }
  const farthest = farthestFromHome(places);
  if (farthest) {
    const where = labels[farthest.place.key]?.city;
    const from = labels[farthest.home.key]?.city ?? "home";
    const km = Math.round(farthest.km).toLocaleString("en-US");
    line += ` · Farthest: ${where ? `${where}, ` : ""}${km} km from ${from}`;
  }
  return line;
}

export interface SportShare {
  category: SportColorCategory;
  count: number;
}

/** The sports trained at a place, most sessions first. */
export function sportMix(
  activities: readonly TrainingHubActivity[],
): SportShare[] {
  const counts = new Map<SportColorCategory, number>();
  for (const activity of activities) {
    const category = sportColorCategory(activity.sportType);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count);
}

export interface MonthVisits {
  /** Epoch ms of the month's first day, local time. */
  monthMs: number;
  count: number;
}

/**
 * Visits per calendar month, from the first visit to the month `endMs` falls
 * in, the most recent `maxMonths` of them. Empty months are kept: the gaps are
 * what the bars are for.
 */
export function visitsByMonth(
  activities: readonly TrainingHubActivity[],
  endMs: number,
  maxMonths = 36,
): MonthVisits[] {
  const stamps = activities
    .map((activity) => activityTimestampMs(activity.startTime))
    .filter((ms) => ms > 0);
  if (stamps.length === 0) {
    return [];
  }
  const monthIndex = (ms: number) => {
    const date = new Date(ms);
    return date.getFullYear() * 12 + date.getMonth();
  };
  const last = Math.max(monthIndex(endMs), ...stamps.map(monthIndex));
  const first = Math.max(Math.min(...stamps.map(monthIndex)), last - maxMonths + 1);
  const counts = new Map<number, number>();
  for (const ms of stamps) {
    const index = monthIndex(ms);
    if (index >= first) {
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
  }
  const months: MonthVisits[] = [];
  for (let index = first; index <= last; index += 1) {
    months.push({
      monthMs: new Date(Math.floor(index / 12), index % 12, 1).getTime(),
      count: counts.get(index) ?? 0,
    });
  }
  return months;
}
