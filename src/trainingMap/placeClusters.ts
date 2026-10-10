import type { GlobePoint } from "./activityVisitHeatmap";
import type { AdminRegion } from "./adminRegions";

// What a "place" is, for "Where you've been" and the Hall of Records alike.
//
// Two rules, and nothing else:
//
// - **Two regions, two places.** Starts in different provinces or states are
//   never one place, however close (`adminRegions.ts`).
// - **Inside a region, a place is at most `PLACE_DIAMETER_KM` across**: no two
//   activities in it started further apart than that. This is a diameter, not
//   a radius around a centre, on purpose. A centre moves as starts join it, so
//   a chain of starts 24 km apart each walks it along and ends up one place
//   36, 48 km wide. Complete-linkage clustering states the rule directly:
//   merge the two places whose union is narrowest, while that union is no
//   wider than the limit.
//
// The result does not depend on the order activities arrive in, so two
// screens, two machines and two launches reading the same activities find the
// same places. A place is named after its oldest activity (`key`), which a new
// activity elsewhere leaves alone.

/** The widest a place may be: two starts further apart are two places. */
export const PLACE_DIAMETER_KM = 25;

/**
 * Above this many distinct starts in one region, starts are first put on a
 * ~5 km grid. The pairwise table is n² numbers, and no athlete is near it —
 * starts are rounded to about a kilometre and a run from home starts at home —
 * but a region must not be able to take the window's memory.
 */
const MAX_SITES_PER_REGION = 2_500;

export interface PlacePoint extends GlobePoint {
  activityId: string;
  /** Epoch seconds or milliseconds — only the order matters. */
  startTime: number;
}

/** `lat`/`lon` are the mean of its starts: where the place is drawn and named. */
export interface PlaceCluster extends GlobePoint {
  /** `place:<the oldest activity's id>` */
  key: string;
  /** Activities, one start each. */
  count: number;
  region?: AdminRegion;
  /** Oldest first. */
  activityIds: string[];
}

export function haversineKm(a: GlobePoint, b: GlobePoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Two decimals, about a kilometre: what a start is rounded to everywhere. */
function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The key a place's name is kept under. A name belongs to where the place is,
 * not to which activities are in it, so it is the centre to two decimals —
 * which is also all the geocoder is ever told.
 */
export function placeLabelKey(point: GlobePoint): string {
  return `${roundCoordinate(point.lat).toFixed(2)},${roundCoordinate(point.lon).toFixed(2)}`; // i18n-ignore: a cache key, not a figure
}

interface Site extends GlobePoint {
  points: PlacePoint[];
}

function byAge(left: PlacePoint, right: PlacePoint): number {
  return left.startTime - right.startTime || (left.activityId < right.activityId ? -1 : 1);
}

/** Complete linkage by nearest-neighbour chain: O(n²), and every merge ≤ the limit. */
function linkSites(sites: Site[], limitKm: number): number[][] {
  const n = sites.length;
  const members = sites.map((_, index) => [index]);
  if (n < 2) return members;
  const distance = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = haversineKm(sites[i]!, sites[j]!);
      distance[i * n + j] = d;
      distance[j * n + i] = d;
    }
  }
  const active = new Uint8Array(n).fill(1);
  let activeCount = n;
  const chain: number[] = [];
  while (activeCount > 1) {
    if (chain.length === 0) {
      chain.push(active.indexOf(1));
    }
    const a = chain[chain.length - 1]!;
    const previous = chain.length > 1 ? chain[chain.length - 2]! : -1;
    // The nearest, keeping the one it came from on a tie, or the chain loops.
    let best = previous;
    let bestDistance = previous >= 0 ? distance[a * n + previous]! : Number.POSITIVE_INFINITY;
    for (let k = 0; k < n; k += 1) {
      if (k === a || !active[k]) continue;
      const d = distance[a * n + k]!;
      if (d < bestDistance) {
        best = k;
        bestDistance = d;
      }
    }
    if (best < 0 || bestDistance > limitKm) {
      // Nothing is near enough to `a`, and nothing ever will be: joining
      // only widens a place. So `a` is a place as it stands. The rest of the
      // chain reached `a` as their nearest, so they are as far from the rest,
      // and come back round to be closed the same way.
      active[a] = 0;
      activeCount -= 1;
      chain.length = 0;
      continue;
    }
    if (best !== previous) {
      chain.push(best);
      continue;
    }
    // Reciprocal nearest neighbours: one place, as wide as its widest pair.
    const keep = Math.min(a, previous);
    const drop = Math.max(a, previous);
    for (let k = 0; k < n; k += 1) {
      if (!active[k] || k === keep || k === drop) continue;
      const d = Math.max(distance[keep * n + k]!, distance[drop * n + k]!);
      distance[keep * n + k] = d;
      distance[k * n + keep] = d;
    }
    members[keep]!.push(...members[drop]!);
    members[drop] = [];
    active[drop] = 0;
    activeCount -= 1;
    chain.length -= 2;
  }
  return members.filter((group) => group.length > 0);
}

function sitesOf(points: readonly PlacePoint[], step: number): Site[] {
  const sites = new Map<string, Site>();
  for (const point of points) {
    const lat = Math.round(point.lat / step) * step;
    const lon = Math.round(point.lon / step) * step;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const site = sites.get(key);
    if (site) site.points.push(point);
    else sites.set(key, { lat, lon, points: [point] });
  }
  // A fixed order, so a tie breaks the same way whatever order the
  // activities came in.
  return [...sites.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, site]) => site);
}

/**
 * Every place, busiest first. `regionOf` is the region index's own; without
 * one every start is in the same region and places are told apart by distance
 * alone.
 */
export function clusterPlaces(
  points: readonly PlacePoint[],
  regionOf?: (point: GlobePoint) => AdminRegion | undefined,
  limitKm: number = PLACE_DIAMETER_KM
): PlaceCluster[] {
  const groups = new Map<string, { region?: AdminRegion; points: PlacePoint[] }>();
  for (const point of points) {
    const region = regionOf?.(point);
    const id = region?.id ?? "";
    const group = groups.get(id);
    if (group) group.points.push(point);
    else groups.set(id, { region, points: [point] });
  }
  const places: PlaceCluster[] = [];
  for (const { region, points: inRegion } of groups.values()) {
    let sites = sitesOf(inRegion, 0.01);
    if (sites.length > MAX_SITES_PER_REGION) sites = sitesOf(inRegion, 0.05);
    for (const group of linkSites(sites, limitKm)) {
      const members = group.flatMap((index) => sites[index]!.points).sort(byAge);
      const lat = members.reduce((sum, point) => sum + point.lat, 0) / members.length;
      const lon = members.reduce((sum, point) => sum + point.lon, 0) / members.length;
      places.push({
        key: `place:${members[0]!.activityId}`,
        lat,
        lon,
        count: members.length,
        ...(region ? { region } : {}),
        activityIds: members.map((point) => point.activityId)
      });
    }
  }
  return places.sort(
    (left, right) => right.count - left.count || (left.key < right.key ? -1 : 1)
  );
}
