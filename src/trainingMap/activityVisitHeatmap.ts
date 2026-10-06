import { activityStartPoint } from "../../electron/activityMetrics";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubTrackPoint,
} from "../../electron/types";

export interface GlobePoint {
  lat: number;
  lon: number;
}

export interface ActivityVisitPoint extends GlobePoint {
  activityId: string;
}

/** Downsampled GPS track for one activity (street-map polylines). */
export interface ActivityRoutePolyline {
  activityId: string;
  points: GlobePoint[];
}

/** A place as the globe draws it: a pin, sized by its activities. */
export interface GeoHeatBucket {
  key: string;
  lat: number;
  lon: number;
  count: number;
}

const VISIT_CACHE = new Map<string, GlobePoint | null>();
const ROUTE_CACHE = new Map<string, GlobePoint[] | null>();
const MAX_VISIT_ACTIVITIES = 20;
const VISIT_CONCURRENCY = 5;
/** Cap cached track points per activity to keep memory bounded. */
const MAX_CACHED_ROUTE_POINTS = 280;
/** Keep only recent, downsampled coordinates in the renderer's local storage. */
const MAX_PERSISTED_GEO_ACTIVITIES = 80;
const GEO_CACHE_STORAGE_KEY = "heraclesrecords.activity-globe.geo-cache.v1";
// Version 2: a visit is where the activity started. Version 1 held the middle
// of its route, which put a ride from home to the hills in neither, and is not
// read; the next write replaces it.
const GEO_CACHE_VERSION = 2;

interface PersistedGeoRecord {
  activityId: string;
  visit?: GlobePoint | null;
  route?: GlobePoint[] | null;
}

interface PersistedGeoCache {
  version: typeof GEO_CACHE_VERSION;
  records: PersistedGeoRecord[];
}

let geoCacheHydrated = false;
let geoCacheWriteScheduled = false;

function isStoredGlobePoint(value: unknown): value is GlobePoint {
  if (!value || typeof value !== "object") {
    return false;
  }
  const point = value as Partial<GlobePoint>;
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    typeof point.lon === "number" &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180
  );
}

function hydrateGeoCache(): void {
  if (geoCacheHydrated) {
    return;
  }
  geoCacheHydrated = true;
  if (typeof window === "undefined") {
    return;
  }

  try {
    const stored = window.localStorage.getItem(GEO_CACHE_STORAGE_KEY);
    if (!stored) {
      return;
    }
    const parsed = JSON.parse(stored) as Partial<PersistedGeoCache>;
    if (parsed.version !== GEO_CACHE_VERSION || !Array.isArray(parsed.records)) {
      return;
    }
    for (const record of parsed.records.slice(-MAX_PERSISTED_GEO_ACTIVITIES)) {
      if (!record || typeof record.activityId !== "string") {
        continue;
      }
      if (record.visit === null || isStoredGlobePoint(record.visit)) {
        VISIT_CACHE.set(record.activityId, record.visit);
      }
      if (record.route === null) {
        ROUTE_CACHE.set(record.activityId, null);
      } else if (Array.isArray(record.route)) {
        const route = record.route
          .filter(isStoredGlobePoint)
          .slice(0, MAX_CACHED_ROUTE_POINTS);
        ROUTE_CACHE.set(record.activityId, route.length >= 2 ? route : null);
      }
    }
  } catch {
    // Storage is best-effort; a corrupt or unavailable cache must not block UI.
  }
}

function persistGeoCache(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const activityIds = Array.from(
      new Set([...VISIT_CACHE.keys(), ...ROUTE_CACHE.keys()]),
    ).slice(-MAX_PERSISTED_GEO_ACTIVITIES);
    const records = activityIds.map<PersistedGeoRecord>((activityId) => ({
      activityId,
      ...(VISIT_CACHE.has(activityId)
        ? { visit: VISIT_CACHE.get(activityId) ?? null }
        : {}),
      ...(ROUTE_CACHE.has(activityId)
        ? { route: ROUTE_CACHE.get(activityId) ?? null }
        : {}),
    }));
    const payload: PersistedGeoCache = { version: GEO_CACHE_VERSION, records };
    window.localStorage.setItem(GEO_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota and privacy settings can disable storage; memory cache still works.
  }
}

function scheduleGeoCacheWrite(): void {
  if (geoCacheWriteScheduled || typeof window === "undefined") {
    return;
  }
  geoCacheWriteScheduled = true;
  const write = () => {
    geoCacheWriteScheduled = false;
    persistGeoCache();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(write, { timeout: 1_500 });
  } else {
    window.setTimeout(write, 400);
  }
}

function rememberCacheEntry<T>(
  cache: Map<string, T>,
  activityId: string,
  value: T,
): void {
  cache.delete(activityId);
  cache.set(activityId, value);
}

export function isGlobePoint(
  point: TrainingHubTrackPoint,
): point is GlobePoint {
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    typeof point.lon === "number" &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180
  );
}

export function sampleGlobePoints(
  points: GlobePoint[],
  maxPoints = MAX_CACHED_ROUTE_POINTS,
): GlobePoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = points.length / maxPoints;
  return Array.from(
    { length: maxPoints },
    (_, index) => points[Math.floor(index * step)]!,
  );
}

export function extractTrackPoints(
  detail: TrainingHubActivityDetail | null | undefined,
): GlobePoint[] {
  return (detail?.track?.points ?? []).filter(isGlobePoint);
}

export function rememberActivityGeo(
  activityId: string,
  detail: TrainingHubActivityDetail | null | undefined,
): { start: GlobePoint | null; route: GlobePoint[] | null } {
  hydrateGeoCache();
  const track = extractTrackPoints(detail);
  // Where it started, read exactly as the Hall of Records reads it off the
  // stored summary — the same point, rounded the same way — so the two count
  // the same places.
  const start = activityStartPoint(detail?.track?.points) ?? null;
  const route = track.length >= 2 ? sampleGlobePoints(track) : null;
  rememberCacheEntry(VISIT_CACHE, activityId, start);
  rememberCacheEntry(ROUTE_CACHE, activityId, route);
  scheduleGeoCacheWrite();
  return { start, route };
}

export function getCachedVisitPoints(
  activities: TrainingHubActivity[],
): ActivityVisitPoint[] {
  hydrateGeoCache();
  const visits: ActivityVisitPoint[] = [];
  for (const activity of activities) {
    const cached = VISIT_CACHE.get(activity.activityId);
    if (cached) {
      visits.push({
        activityId: activity.activityId,
        lat: cached.lat,
        lon: cached.lon,
      });
    }
  }
  return visits;
}

export function getCachedRoutePolylines(
  activities: TrainingHubActivity[],
): ActivityRoutePolyline[] {
  hydrateGeoCache();
  const routes: ActivityRoutePolyline[] = [];
  for (const activity of activities) {
    const cached = ROUTE_CACHE.get(activity.activityId);
    if (cached && cached.length >= 2) {
      routes.push({
        activityId: activity.activityId,
        points: cached,
      });
    }
  }
  return routes;
}

type DetailFetcher = (
  activityId: string,
  sportType: number,
  listActivity?: TrainingHubActivity,
) => Promise<TrainingHubActivityDetail>;

function emitCachedRoute(
  activityId: string,
  onRoute?: (route: ActivityRoutePolyline) => void,
): void {
  const cached = ROUTE_CACHE.get(activityId);
  if (cached && cached.length >= 2) {
    onRoute?.({ activityId, points: cached });
  }
}

export async function loadActivityVisits(
  activities: TrainingHubActivity[],
  fetchDetail: DetailFetcher,
  options?: {
    limit?: number;
    concurrency?: number;
    signal?: AbortSignal;
    onVisit?: (visit: ActivityVisitPoint) => void;
    onRoute?: (route: ActivityRoutePolyline) => void;
  },
): Promise<ActivityVisitPoint[]> {
  hydrateGeoCache();
  const limit = options?.limit ?? MAX_VISIT_ACTIVITIES;
  const concurrency = options?.concurrency ?? VISIT_CONCURRENCY;
  const signal = options?.signal;
  const candidates = activities.slice(0, limit);
  const visits: ActivityVisitPoint[] = [];

  let index = 0;

  async function worker(): Promise<void> {
    while (index < candidates.length) {
      if (signal?.aborted) {
        return;
      }

      const current = index;
      index += 1;
      const activity = candidates[current]!;
      const cachedVisit = VISIT_CACHE.get(activity.activityId);
      const cachedRoute = ROUTE_CACHE.get(activity.activityId);
      // Both caches filled (including null miss) — reuse without refetching.
      if (cachedVisit !== undefined && cachedRoute !== undefined) {
        if (cachedVisit) {
          const visit = {
            activityId: activity.activityId,
            lat: cachedVisit.lat,
            lon: cachedVisit.lon,
          };
          visits.push(visit);
          options?.onVisit?.(visit);
        }
        emitCachedRoute(activity.activityId, options?.onRoute);
        continue;
      }

      try {
        const detail = await fetchDetail(
          activity.activityId,
          activity.sportType,
          activity,
        );
        if (signal?.aborted) {
          return;
        }

        const { start, route } = rememberActivityGeo(
          activity.activityId,
          detail,
        );
        if (start) {
          const visit = {
            activityId: activity.activityId,
            ...start,
          };
          visits.push(visit);
          options?.onVisit?.(visit);
        }
        if (route && route.length >= 2) {
          options?.onRoute?.({
            activityId: activity.activityId,
            points: route,
          });
        }
      } catch {
        // Skip failed lookups; never block the globe on one activity.
        VISIT_CACHE.set(activity.activityId, null);
        ROUTE_CACHE.set(activity.activityId, null);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, candidates.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return visits;
}
