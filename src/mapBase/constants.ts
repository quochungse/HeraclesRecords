import { t } from "../i18n/core";
/** A selectable base map style. */
export type BaseLayerId =
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
  'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'; // i18n-ignore: the credit OpenFreeMap asks for, verbatim

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
export const BASE_LAYERS: Record<BaseLayerId, BaseLayerConfig> = {
  street: {
    kind: "raster",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    get label() {
      return t("app.map.street.label");
    },
    get description() {
      return t("app.map.street.description");
    },
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  outdoors: {
    kind: "raster",
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxZoom: 20,
    subdomains: "abc",
    get label() {
      return t("app.map.outdoors.label");
    },
    get description() {
      return t("app.map.outdoors.description");
    },
    attribution:
      '&copy; <a href="https://www.cyclosm.org">CyclOSM</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  light: {
    kind: "vector",
    styleUrl: "https://tiles.openfreemap.org/styles/positron",
    maxZoom: 20,
    get label() {
      return t("app.map.light.label");
    },
    get description() {
      return t("app.map.light.description");
    },
    attribution: OPENFREEMAP_ATTRIBUTION
  },
  dark: {
    kind: "vector",
    styleUrl: "https://tiles.openfreemap.org/styles/dark",
    maxZoom: 20,
    get label() {
      return t("app.map.dark.label");
    },
    get description() {
      return t("app.map.dark.description");
    },
    attribution: OPENFREEMAP_ATTRIBUTION
  },
  topo: {
    kind: "raster",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
    subdomains: "abc",
    get label() {
      return t("app.map.topo.label");
    },
    get description() {
      return t("app.map.topo.description");
    },
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM, &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
  },
  satellite: {
    kind: "raster",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    get label() {
      return t("app.map.satellite.label");
    },
    get description() {
      return t("app.map.satellite.description");
    },
    attribution:
      'Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics' // i18n-ignore: a credit, verbatim
  }
};

export const BASE_LAYER_ORDER: BaseLayerId[] = [
  "street",
  "outdoors",
  "topo",
  "satellite",
  "light",
  "dark"
];

/**
 * Whether a style is a daylight map, so what is drawn over it — a route line, a
 * glow — can pick colours that read on it. `dark` and `satellite` are the two
 * dark grounds.
 */
export function isLightBaseLayer(id: BaseLayerId): boolean {
  return id !== "dark" && id !== "satellite";
}
