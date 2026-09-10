import type {
  RouteActivityType,
  RouteElevationPreference
} from "../../../electron/types";
import type { LucideIcon } from "lucide-react";
import {
  Bike,
  Footprints,
  Mountain,
  MountainSnow,
  PersonStanding
} from "lucide-react";

/** A selectable base map style. */
export type RouteBaseLayer =
  | "street"
  | "outdoors"
  | "light"
  | "dark"
  | "topo"
  | "satellite";

/** Fields every base map style carries, whatever it is rendered from. */
interface BaseLayerCommon {
  label: string;
  description: string;
  attribution: string;
  maxZoom: number;
}

/** A classic {z}/{x}/{y} raster tile style, drawn by Leaflet itself. */
export interface RasterBaseLayerConfig extends BaseLayerCommon {
  kind: "raster";
  url: string;
  subdomains?: string;
}

/**
 * A vector style rendered client-side by MapLibre. Build these through
 * `createBaseLayer` in `baseLayers.ts` — never `L.tileLayer`.
 */
export interface VectorBaseLayerConfig extends BaseLayerCommon {
  kind: "vector";
  /** URL of the MapLibre style JSON. */
  styleUrl: string;
}

export type BaseLayerConfig = RasterBaseLayerConfig | VectorBaseLayerConfig;

/** OpenFreeMap asks for this wording specifically; keep all three credits. */
const OPENFREEMAP_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Base map styles. All are free and keyless — no style here may need an API
 * key, because nothing in the app has one to give it.
 *
 * `light` and `dark` are OpenFreeMap vector styles rather than raster tiles.
 * They used to be CARTO's `light_all`/`dark_all`, which in August 2026 started
 * answering keyless requests with a valid 200 PNG that has "API KEY REQUIRED"
 * printed across it — a watermark, not an error, so nothing in the app could
 * detect it. OpenFreeMap's `positron` is the same design lineage (CARTO's
 * Positron is where it came from) and its `dark` matches Dark Matter, so the
 * two screens that pick a style by theme look as they did before.
 */
export const ROUTE_BASE_LAYERS: Record<RouteBaseLayer, BaseLayerConfig> = {
  street: {
    kind: "raster",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    label: "Street",
    description: "Standard OpenStreetMap",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  outdoors: {
    kind: "raster",
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxZoom: 20,
    subdomains: "abc",
    label: "Outdoors",
    description: "CyclOSM — cycling & trails",
    attribution:
      '&copy; <a href="https://www.cyclosm.org">CyclOSM</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  light: {
    kind: "vector",
    styleUrl: "https://tiles.openfreemap.org/styles/positron",
    maxZoom: 20,
    label: "Light",
    description: "Clean minimal map",
    attribution: OPENFREEMAP_ATTRIBUTION
  },
  dark: {
    kind: "vector",
    styleUrl: "https://tiles.openfreemap.org/styles/dark",
    maxZoom: 20,
    label: "Dark",
    description: "Low-glare night map",
    attribution: OPENFREEMAP_ATTRIBUTION
  },
  topo: {
    kind: "raster",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
    subdomains: "abc",
    label: "Topo",
    description: "Contours & terrain",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM, &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
  },
  satellite: {
    kind: "raster",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    label: "Satellite",
    description: "Aerial imagery",
    attribution:
      'Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics'
  }
};

export const ROUTE_BASE_LAYER_ORDER: RouteBaseLayer[] = [
  "street",
  "outdoors",
  "topo",
  "satellite",
  "light",
  "dark"
];

/** A discoverable-routes overlay (the "Explore" / Strava-like layer). */
export type RouteOverlayId = "hiking" | "cycling" | "mtb";

export interface OverlayLayerConfig {
  url: string;
  attribution: string;
  maxZoom: number;
  label: string;
  description: string;
  /** Accent colour used in the legend chip. */
  swatch: string;
}

/**
 * Waymarked Trails overlays — free, keyless renders of real-world marked routes
 * from OpenStreetMap. This is the legitimate equivalent of Strava's
 * "here's where people actually go" layer.
 */
export const ROUTE_OVERLAY_LAYERS: Record<RouteOverlayId, OverlayLayerConfig> = {
  hiking: {
    url: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
    maxZoom: 18,
    label: "Hiking routes",
    description: "Marked walking & hiking trails",
    swatch: "#e2504b",
    attribution:
      '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>'
  },
  cycling: {
    url: "https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png",
    maxZoom: 18,
    label: "Cycle routes",
    description: "National & local cycle networks",
    swatch: "#4b7be2",
    attribution:
      '&copy; <a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>'
  },
  mtb: {
    url: "https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png",
    maxZoom: 18,
    label: "MTB routes",
    description: "Mountain-bike trail networks",
    swatch: "#d89b22",
    attribution:
      '&copy; <a href="https://mtb.waymarkedtrails.org">Waymarked Trails</a>'
  }
};

export const ROUTE_OVERLAY_ORDER: RouteOverlayId[] = ["hiking", "cycling", "mtb"];

export interface ActivityOption {
  value: RouteActivityType;
  label: string;
  /** Compact label shown in the sport picker cells. */
  shortLabel: string;
  /** Icon shown in the sport picker. */
  icon: LucideIcon;
}

export const ROUTE_ACTIVITY_OPTIONS: ActivityOption[] = [
  { value: "running", label: "Running", shortLabel: "Run", icon: Footprints },
  {
    value: "walking",
    label: "Walking",
    shortLabel: "Walk",
    icon: PersonStanding
  },
  { value: "hiking", label: "Hiking", shortLabel: "Hike", icon: Mountain },
  {
    value: "cycling-road",
    label: "Road cycling",
    shortLabel: "Road",
    icon: Bike
  },
  {
    value: "cycling-mountain",
    label: "Mountain biking",
    shortLabel: "MTB",
    icon: MountainSnow
  }
];

export const ROUTE_ELEVATION_OPTIONS: Array<{
  value: RouteElevationPreference;
  label: string;
}> = [
  { value: "any", label: "Any" },
  { value: "flatter", label: "Flatter" },
  { value: "hilly", label: "Hilly" }
];
