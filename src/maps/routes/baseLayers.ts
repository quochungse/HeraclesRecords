import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { ROUTE_BASE_LAYERS, type BaseLayerConfig, type RouteBaseLayer } from "./constants";
import {
  ONEWAY_ARROW_LAYER_IDS,
  ONEWAY_ARROW_ROTATION,
  onewayArrowLayer
} from "./onewayArrows";
import type { Map as MaplibreMap } from "maplibre-gl";

/**
 * MapLibre v6 spawns its worker from a URL that Vite cannot statically see, so
 * the bundler emits no worker chunk and the URL arrives empty. An empty worker
 * URL resolves back to the page itself, and the browser rejects the HTML it
 * gets with "non-JavaScript MIME type text/html". The map still builds, still
 * fires `styledata`, and still paints its background colour — it just never
 * renders a single feature, which reads like a broken style rather than a
 * missing worker. Handing MapLibre a URL Vite *did* emit is the whole fix.
 */
setWorkerUrl(maplibreWorkerUrl);

/**
 * Base maps live below Leaflet's own `tilePane` (z-index 200) so trail
 * overlays and route lines always draw on top. Without a pane of their own,
 * layer order would depend on the order things were added: swapping the base
 * map re-appends it last, which is why the raster-only code had to call
 * `bringToBack()` every time. A vector base map has no `bringToBack()` to
 * call, so the pane does that job for both kinds.
 */
const BASEMAP_PANE = "heraclesBasemap";

function ensureBasemapPane(map: L.Map): string {
  if (!map.getPane(BASEMAP_PANE)) {
    const pane = map.createPane(BASEMAP_PANE);
    pane.style.zIndex = "190";
  }
  return BASEMAP_PANE;
}

/**
 * Vector styles need WebGL. Electron normally falls back to software rendering
 * when there is no usable GPU, but a machine that reaches this with no context
 * at all would get an empty map and no explanation, so fall back to a raster
 * style instead. Read once — the answer cannot change within a session.
 */
let webglSupported: boolean | undefined;

function supportsWebgl(): boolean {
  if (webglSupported === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupported = Boolean(
        canvas.getContext("webgl2") ?? canvas.getContext("webgl")
      );
    } catch {
      webglSupported = false;
    }
  }
  return webglSupported;
}

/** The raster style stood in for a vector one when WebGL is unavailable. */
const VECTOR_FALLBACK: RouteBaseLayer = "street";

export function resolveBaseLayerConfig(config: BaseLayerConfig): BaseLayerConfig {
  if (config.kind === "vector" && !supportsWebgl()) {
    return ROUTE_BASE_LAYERS[VECTOR_FALLBACK];
  }
  return config;
}

type VectorLayerOptions = Parameters<typeof L.maplibreGL>[0] & { pane: string };

/**
 * Corrects the one-way arrows a style ships, or adds them when it ships none.
 * See `onewayArrows.ts` for why every arrow was drawn across the road.
 *
 * New layers go beneath the first symbol layer so arrows never cover a label.
 */
function applyOnewayArrows(gl: MaplibreMap): void {
  const firstSymbolLayer = gl
    .getStyle()
    .layers.find((candidate) => candidate.type === "symbol")?.id;

  for (const id of ONEWAY_ARROW_LAYER_IDS) {
    if (gl.getLayer(id)) {
      gl.setLayoutProperty(id, "icon-rotate", ONEWAY_ARROW_ROTATION[id]);
    } else {
      gl.addLayer(onewayArrowLayer(id), firstSymbolLayer);
    }
  }
}

/**
 * The MapLibre map exists only once Leaflet has added the layer, and its style
 * is fetched after that, so the fix has two moments to wait for and either can
 * already have passed.
 */
function fixOnewayArrowsWhenReady(layer: L.MaplibreGL): void {
  layer.on("add", () => {
    const gl = layer.getMaplibreMap();

    // `style.load` already means the style is in place, so it must not be
    // gated on `isStyleLoaded()` — that reads false while the style is still
    // settling, and gating on it drops the fix with no second chance.
    // Listening rather than `once` keeps the fix across a style swap.
    gl.on("style.load", () => applyOnewayArrows(gl));

    // And a style that finished loading before this ran fires nothing at all.
    if (gl.isStyleLoaded()) {
      applyOnewayArrows(gl);
    }
  });
}

/**
 * Builds the base map layer for a style, raster or vector. Every screen goes
 * through here so the two kinds cannot drift apart — and so a caller never has
 * to know which kind it asked for.
 */
export function createBaseLayer(map: L.Map, config: BaseLayerConfig): L.Layer {
  const pane = ensureBasemapPane(map);
  const resolved = resolveBaseLayerConfig(config);

  if (resolved.kind === "vector") {
    // The plugin's typings describe only MapLibre's own map options, but at
    // runtime it is an ordinary Leaflet layer and reads `options.pane` through
    // `getPaneName()` like any other. Naming the wider type keeps `pane` out of
    // an excess-property error without casting the whole object away.
    const options: VectorLayerOptions = {
      style: resolved.styleUrl,
      pane,
      // The plugin creates its inner MapLibre map with attributionControl
      // false, so Leaflet's own attribution bar is the only place the credit
      // can appear, and this is where the plugin reads it from.
      attributionControl: { customAttribution: resolved.attribution }
    };
    const layer = L.maplibreGL(options);
    fixOnewayArrowsWhenReady(layer);
    return layer;
  }

  return L.tileLayer(resolved.url, {
    pane,
    maxZoom: resolved.maxZoom,
    attribution: resolved.attribution,
    ...(resolved.subdomains ? { subdomains: resolved.subdomains } : {})
  });
}

/** Max zoom actually available for a style, after any WebGL fallback. */
export function baseLayerMaxZoom(config: BaseLayerConfig): number {
  return resolveBaseLayerConfig(config).maxZoom;
}
