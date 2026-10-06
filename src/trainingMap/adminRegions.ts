import type { GlobePoint } from "./activityVisitHeatmap";

// Which first-level administrative region — a province, a state, a French
// département — a point lies in, answered on the machine from the outlines in
// `adminRegions.json` (`npm run admin-regions:fetch` says where they come from).
// Places are told apart by it: two starts in different regions are two places
// however close they are (`placeClusters.ts`).
//
// Node-free like the rest of the arithmetic here, so a suite can build an index
// from the file and ask it questions. Only `loadRegionIndex` knows how the
// renderer gets the file.

export interface AdminRegion {
  id: string;
  /** "Hà Nội", "Lâm Đồng", "California". */
  name: string;
  /** ISO alpha-2, or Natural Earth's three letters for a territory with none. */
  country: string;
  /** "Vietnam", "Thailand". */
  countryName: string;
}

export interface AdminRegionData {
  version: 1;
  /** Encoded-polyline precision: 1e4 is about 11 m. */
  precision: number;
  countries: Record<string, string>;
  /** `[id, name, country, rings]`, each ring an encoded polyline. */
  regions: Array<[string, string, string, string[]]>;
}

export interface RegionIndex {
  regionOf(point: GlobePoint): AdminRegion | undefined;
}

/**
 * A start outside every outline is still put in the nearest region within
 * this: a run along a beach, a ferry, a pier the simplification left in the
 * sea. Further out it is in no region, and counts as a place by distance alone.
 */
export const NEAREST_REGION_KM = 25;

/** The lookup grid, in degrees. */
const CELL_DEG = 1;
const KM_PER_DEG = 111.32;

interface Entry {
  region: AdminRegion;
  /** west, south, east, north */
  bbox: [number, number, number, number];
  /** Each ring as lon, lat pairs. */
  rings: Float32Array[];
}

function decodeRing(encoded: string, precision: number): Float32Array {
  const values: number[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    values.push(lon / precision, lat / precision);
  }
  return Float32Array.from(values);
}

/** Even-odd over every ring, so a hole or an island needs no flag. */
function contains(entry: Entry, lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of entry.rings) {
    const count = ring.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const xi = ring[i * 2]!;
      const yi = ring[i * 2 + 1]!;
      const xj = ring[j * 2]!;
      const yj = ring[j * 2 + 1]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** The distance to the nearest edge, flat-earth: it only ever measures a few km. */
function distanceToEdgeKm(entry: Entry, lon: number, lat: number): number {
  const kx = KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const ky = KM_PER_DEG;
  let best = Number.POSITIVE_INFINITY;
  for (const ring of entry.rings) {
    const count = ring.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const ax = (ring[j * 2]! - lon) * kx;
      const ay = (ring[j * 2 + 1]! - lat) * ky;
      const bx = (ring[i * 2]! - lon) * kx;
      const by = (ring[i * 2 + 1]! - lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const length = dx * dx + dy * dy;
      const t = length > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      best = Math.min(best, px * px + py * py);
    }
  }
  return Math.sqrt(best);
}

function cellKey(column: number, row: number): number {
  return row * 1000 + column;
}

function cellOf(lon: number, lat: number): [number, number] {
  return [Math.floor((lon + 180) / CELL_DEG), Math.floor((lat + 90) / CELL_DEG)];
}

export function buildRegionIndex(data: AdminRegionData): RegionIndex {
  const grid = new Map<number, Entry[]>();
  for (const [id, name, country, encodedRings] of data.regions) {
    const rings = encodedRings.map((ring) => decodeRing(ring, data.precision));
    const bbox: Entry["bbox"] = [180, 90, -180, -90];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        bbox[0] = Math.min(bbox[0], ring[i]!);
        bbox[1] = Math.min(bbox[1], ring[i + 1]!);
        bbox[2] = Math.max(bbox[2], ring[i]!);
        bbox[3] = Math.max(bbox[3], ring[i + 1]!);
      }
    }
    const entry: Entry = {
      region: { id, name, country, countryName: data.countries[country] ?? country },
      bbox,
      rings
    };
    const [west, south] = cellOf(bbox[0], bbox[1]);
    const [east, north] = cellOf(bbox[2], bbox[3]);
    for (let row = south; row <= north; row += 1) {
      for (let column = west; column <= east; column += 1) {
        const key = cellKey(column, row);
        const entries = grid.get(key);
        if (entries) entries.push(entry);
        else grid.set(key, [entry]);
      }
    }
  }

  const answers = new Map<string, AdminRegion | null>();
  return {
    regionOf(point) {
      const memo = `${point.lat},${point.lon}`;
      const known = answers.get(memo);
      if (known !== undefined) return known ?? undefined;
      const [column, row] = cellOf(point.lon, point.lat);
      // The first outline that holds the point. Việt Nam's provinces come
      // first in the file, so on its borders OpenStreetMap's line wins over
      // Natural Earth's neighbour drawn a little differently.
      let found: AdminRegion | undefined;
      for (const entry of grid.get(cellKey(column, row)) ?? []) {
        const [west, south, east, north] = entry.bbox;
        if (point.lon < west || point.lon > east || point.lat < south || point.lat > north) continue;
        if (contains(entry, point.lon, point.lat)) {
          found = entry.region;
          break;
        }
      }
      if (!found) {
        let nearest = NEAREST_REGION_KM;
        const seen = new Set<Entry>();
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            for (const entry of grid.get(cellKey(column + dc, row + dr)) ?? []) {
              if (seen.has(entry)) continue;
              seen.add(entry);
              const distance = distanceToEdgeKm(entry, point.lon, point.lat);
              if (distance <= nearest) {
                nearest = distance;
                found = entry.region;
              }
            }
          }
        }
      }
      answers.set(memo, found ?? null);
      return found;
    }
  };
}

/** No outlines at all: every start is in no region, told apart by distance. */
const NO_REGIONS: RegionIndex = { regionOf: () => undefined };

let loading: Promise<RegionIndex> | undefined;
let loaded: RegionIndex | undefined;

/**
 * The index, built once per window. The outlines are a chunk of their own
 * (2.6 MB), read the first time a screen asks, never with the main bundle. They
 * come in as text and are parsed here so the typechecker never reads the file.
 *
 * It never rejects. Both screens wait on it before drawing a place, so a file
 * that could not be read would leave the map loading and the Hall unsettled
 * for good; places told apart by distance alone are the better answer.
 */
export function loadRegionIndex(): Promise<RegionIndex> {
  loading ??= import("./adminRegions.json?raw")
    .then((module) => buildRegionIndex(JSON.parse(module.default) as AdminRegionData))
    .catch((error: unknown) => {
      console.error("Region outlines could not be read; places are told apart by distance alone.", error);
      return NO_REGIONS;
    })
    .then((index) => (loaded = index));
  return loading;
}

/** The index if it has been read already, so a screen opened again draws at once. */
export function loadedRegionIndex(): RegionIndex | undefined {
  return loaded;
}
