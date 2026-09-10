import type { LayerSpecification } from "maplibre-gl";

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
 * again: an existing layer has its rotation set, a missing one is added.
 */
export const ONEWAY_ARROW_LAYER_IDS = [
  "road_oneway",
  "road_oneway_opposite"
] as const;

export type OnewayArrowLayerId = (typeof ONEWAY_ARROW_LAYER_IDS)[number];

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

/**
 * The full layer description, used when a style has no one-way layer of its
 * own. Mirrors `bright` apart from the spacing above.
 */
export function onewayArrowLayer(id: OnewayArrowLayerId): LayerSpecification {
  return {
    id,
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "transportation",
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
