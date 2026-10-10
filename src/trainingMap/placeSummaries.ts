// What the Where you've been screen says about each place, out of the view for
// the reason activityFilters.ts sits outside ActivitiesView: it is the part a
// test can reach. No `node:` imports and no React.
import type { TrainingHubActivity } from "../../electron/types";
import {
  sportColorCategory,
  type SportColorCategory,
} from "../training/sportColors";
import type { ActivityVisitPoint, GlobePoint } from "./activityVisitHeatmap";
import type { AdminRegion } from "./adminRegions";
import {
  clusterPlaces,
  haversineKm,
  placeLabelKey,
  type PlaceCluster,
} from "./placeClusters";
import { coordinateLabel, type PlaceLabel } from "./placeLabels";
import { formatCount, getIntlLocale, getLocale, plural, t } from "../i18n/core";

export { haversineKm };

export interface PlaceSummary {
  key: string;
  cluster: PlaceCluster;
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
 * One summary per place, newest visit first. Places are found among the
 * activities still in the list (`placeClusters.ts`), so a period draws its own
 * places: a visit whose activity another period holds takes no part.
 */
export function buildPlaceSummaries(
  activities: readonly TrainingHubActivity[],
  visits: readonly ActivityVisitPoint[],
  regionOf?: (point: GlobePoint) => AdminRegion | undefined,
): PlaceSummary[] {
  const activitiesById = new Map(
    activities.map((activity) => [activity.activityId, activity]),
  );
  const points = visits.flatMap((visit) => {
    const activity = activitiesById.get(visit.activityId);
    return activity
      ? [{ ...visit, startTime: activityTimestampMs(activity.startTime) }]
      : [];
  });
  return clusterPlaces(points, regionOf)
    .map((cluster) => {
      const placeActivities = cluster.activityIds
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
        key: cluster.key,
        cluster,
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

const FARTHEST_MIN_KM = 100;

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
    const km = haversineKm(home.cluster, place.cluster);
    if (!best || km > best.km) {
      best = { place, km };
    }
  }
  return best && best.km >= FARTHEST_MIN_KM ? { home, ...best } : undefined;
}

/** Accents, case and spacing folded, so "Thành phố Hà Nội" holds "Hà Nội". */
function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/giu, "d")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

/**
 * What a place is called. The town is the geocoder's, once it has answered;
 * until then, and when it cannot be reached, the region it lies in, which is
 * known on the machine. The second line says where the town is — "Lâm Đồng,
 * Vietnam" under Đà Lạt — or only the country, when the town is the region
 * (Hà Nội, Bangkok). A place in no region at all (out at sea) is its coordinates.
 */
export function placeLabelFor(
  cluster: PlaceCluster,
  labels: Readonly<Record<string, PlaceLabel>>,
): PlaceLabel {
  const named = labels[placeLabelKey(cluster)];
  const region = cluster.region;
  if (!region) {
    return named ?? coordinateLabel(cluster);
  }
  const city = named?.city ?? region.name;
  // Either way round: "Thành phố Hà Nội" is Hà Nội, and Bangkok is Natural
  // Earth's "Bangkok Metropolis".
  const town = foldName(city);
  const regionName = foldName(region.name);
  const country =
    town.includes(regionName) || regionName.includes(town)
      ? region.countryName
      : `${region.name}, ${region.countryName}`;
  return { city, country, full: `${city}, ${country}`, countryCode: region.country };
}

/** How many countries the places are in, by the region each lies in. */
export function countriesVisited(places: readonly PlaceSummary[]): number {
  const countries = new Set<string>();
  for (const place of places) {
    if (place.cluster.region) {
      countries.add(place.cluster.region.country);
    }
  }
  return countries.size;
}

// Written out rather than asked of Intl: en-GB spells September "Sept", and
// the Hall of Records, which names the same days, writes "Sep".
// Another language takes its own short forms from Intl.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", // i18n-ignore: English's own spelling
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", // i18n-ignore
] as const;

/** Intl in the app's language; Vietnamese spells the month out ("thg 8" reads as a typo). */
function intlDate(ms: number, options: Intl.DateTimeFormatOptions): string {
  const month = getLocale() === "vi" && options.month ? "long" : options.month;
  return new Intl.DateTimeFormat(getIntlLocale(), { ...options, ...(month ? { month } : {}) }).format(new Date(ms));
}

/** "6 Aug 2024". */
export function formatDayLong(ms: number): string {
  if (getLocale() !== "en") return intlDate(ms, { day: "numeric", month: "short", year: "numeric" });
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Mar 2025". */
export function formatMonthYear(ms: number): string {
  if (getLocale() !== "en") return intlDate(ms, { month: "short", year: "numeric" });
  const date = new Date(ms);
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "4 Oct" within the current year, "14 Dec 2025" before it. */
export function formatDayNear(ms: number, nowMs = Date.now()): string {
  if (!ms) {
    return "";
  }
  const date = new Date(ms);
  if (date.getFullYear() !== new Date(nowMs).getFullYear()) return formatDayLong(ms);
  return getLocale() === "en"
    ? `${date.getDate()} ${MONTHS[date.getMonth()]}`
    : intlDate(ms, { day: "numeric", month: "short" });
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
  const countries = countriesVisited(places);
  const counts = {
    activities: plural("map.count.activities", activityCount),
    places: plural("map.count.places", places.length),
    countries: plural("map.count.countries", countries),
  };
  let line =
    countries > 1 ? t("map.summary.lineCountries", counts) : t("map.summary.line", counts);
  if (allTime) {
    const first = Math.min(
      ...places
        .map((place) => place.firstVisitedMs)
        .filter((ms) => ms > 0),
    );
    if (Number.isFinite(first)) {
      line = t("map.summary.since", { line, date: formatDayLong(first) });
    }
  }
  const farthest = farthestFromHome(places);
  if (farthest) {
    const where = placeLabelFor(farthest.place.cluster, labels).city;
    const from = placeLabelFor(farthest.home.cluster, labels).city;
    const km = formatCount(Math.round(farthest.km));
    line += ` · ${t("map.summary.farthest", { where, km, from })}`;
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
