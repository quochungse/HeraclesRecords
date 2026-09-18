import type { LayerSpecification, Map as MaplibreMap } from "maplibre-gl";

/**
 * One-way arrows, fixed and made consistent across themes.
 *
 * OpenFreeMap's `oneway` sprite icon is drawn pointing **up**, but MapLibre
 * rotates a line-placed icon so the icon's horizontal axis follows the line —
 * so an unrotated icon lands across the road instead of along it. Their own
 * `bright` style compensates with 90/-90; `dark` ships 0/180, which is why
 * every arrow sat perpendicular to the street, and `positron` omits the layers
 * altogether, which is why the two themes disagreed about whether one-way
 * streets are shown at all.
 *
 * Both are corrected here from one description, so the themes cannot drift
 * again — see `applyOnewayArrows`.
 */
export const ONEWAY_ARROW_LAYER_IDS = [
  "road_oneway",
  "road_oneway_opposite"
] as const;

export type OnewayArrowLayerId = (typeof ONEWAY_ARROW_LAYER_IDS)[number];

/** The OpenMapTiles source and layer every arrow is read from. */
export const ONEWAY_ARROW_SOURCE = "openmaptiles";
const ONEWAY_ARROW_SOURCE_LAYER = "transportation";

/**
 * `road_oneway` marks ways digitised along the direction of travel, and
 * `road_oneway_opposite` those digitised against it — hence the mirrored
 * rotation, not a different icon.
 */
export const ONEWAY_ARROW_ROTATION: Record<OnewayArrowLayerId, number> = {
  road_oneway: 90,
  road_oneway_opposite: -90
};

/** The `oneway` attribute value each layer draws. */
const ONEWAY_VALUE: Record<OnewayArrowLayerId, number> = {
  road_oneway: 1,
  road_oneway_opposite: -1
};

/** Road classes worth an arrow — the same set OpenFreeMap's `bright` uses. */
const ARROW_ROAD_CLASSES = [
  "minor",
  "motorway",
  "primary",
  "secondary",
  "service",
  "tertiary",
  "trunk"
];

/**
 * How far apart the arrows sit. `bright` uses 75, which on a dual carriageway
 * (every Vietnamese boulevard is mapped as two one-way ways) reads as clutter
 * rather than information, so this keeps the roomier spacing `dark` shipped.
 */
export const ONEWAY_ARROW_SPACING = 200;

/** Below this zoom the arrows are noise; above it they are wayfinding. */
export const ONEWAY_ARROW_MIN_ZOOM = 15;

type SymbolLayer = Extract<LayerSpecification, { type: "symbol" }>;

/**
 * The one description of an arrow layer. Mirrors `bright` apart from the
 * spacing above — including its class filter, which `dark` omits, so without
 * this the dark theme would keep drawing arrows on paths and ferries that the
 * light theme leaves bare.
 */
export function onewayArrowLayer(id: OnewayArrowLayerId): SymbolLayer {
  return {
    id,
    type: "symbol",
    source: ONEWAY_ARROW_SOURCE,
    "source-layer": ONEWAY_ARROW_SOURCE_LAYER,
    minzoom: ONEWAY_ARROW_MIN_ZOOM,
    filter: [
      "all",
      ["==", ["get", "oneway"], ONEWAY_VALUE[id]],
      ["match", ["get", "class"], ARROW_ROAD_CLASSES, true, false]
    ],
    layout: {
      "icon-image": "oneway",
      "icon-padding": 2,
      "icon-rotate": ONEWAY_ARROW_ROTATION[id],
      "icon-rotation-alignment": "map",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.5, 19, 1],
      "symbol-placement": "line",
      "symbol-spacing": ONEWAY_ARROW_SPACING
    },
    paint: { "icon-opacity": 0.5 }
  };
}

/**
 * Replaces whatever one-way layers a style ships with the description above,
 * and adds them to a style that ships none.
 *
 * Patching only `icon-rotate` on an existing layer would leave the rest of the
 * style's own spec — `dark`'s missing class filter above all — so the arrows
 * would still differ between themes even once they pointed the right way.
 * Removing and re-adding applies the whole description in one move.
 */
export function applyOnewayArrows(gl: MaplibreMap): void {
  // A style built on some other schema has no `transportation` layer to read,
  // and `addLayer` against a missing source throws.
  if (!gl.getSource(ONEWAY_ARROW_SOURCE)) {
    return;
  }

  // Positions are read from one snapshot: each layer is put back exactly where
  // it was, so the snapshot stays true for the next id.
  const layers = gl.getStyle().layers;
  const firstSymbolId = layers.find((layer) => layer.type === "symbol")?.id;

  for (const id of ONEWAY_ARROW_LAYER_IDS) {
    const index = layers.findIndex((layer) => layer.id === id);
    if (index >= 0) {
      gl.removeLayer(id);
    }
    // Keep the layer where the style put it; a style without one gets it just
    // below the first label, which is where `bright` keeps it.
    gl.addLayer(
      onewayArrowLayer(id),
      index >= 0 ? layers[index + 1]?.id : firstSymbolId
    );
  }
}
