/**
 * One-way arrows must lie along the road, not across it.
 *
 * OpenFreeMap's `oneway` sprite icon points up, while MapLibre rotates a
 * line-placed icon so its horizontal axis follows the line — so the rotation
 * in the style is the only thing standing between an arrow that shows a
 * direction and a tick mark that shows nothing. Measured against a due-east
 * and a due-north line, 90 puts the arrow along the way's own direction and
 * -90 reverses it; the 0/180 that OpenFreeMap's `dark` style ships put every
 * arrow perpendicular to the street.
 *
 * Run: npm run test:oneway-arrows
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl =
  pathToFileURL(path.join(repoRoot, "src/maps/routes/onewayArrows.ts")).href +
  "?cacheBust=" +
  Date.now();

const {
  ONEWAY_ARROW_LAYER_IDS,
  ONEWAY_ARROW_ROTATION,
  ONEWAY_ARROW_SPACING,
  ONEWAY_ARROW_MIN_ZOOM,
  onewayArrowLayer
} = await import(moduleUrl);

assert.deepEqual(
  [...ONEWAY_ARROW_LAYER_IDS],
  ["road_oneway", "road_oneway_opposite"],
  "these are the layer ids OpenFreeMap's styles use; renaming them silently disables the fix"
);

assert.deepEqual(
  Object.keys(ONEWAY_ARROW_ROTATION).sort(),
  [...ONEWAY_ARROW_LAYER_IDS].sort(),
  "every arrow layer needs a rotation"
);

// The whole point: an unrotated icon is the bug being fixed.
assert.equal(
  ONEWAY_ARROW_ROTATION.road_oneway,
  90,
  "forward arrows need +90 — the sprite icon points up, and 0 draws it across the road"
);
assert.equal(
  ONEWAY_ARROW_ROTATION.road_oneway_opposite,
  -90,
  "reversed arrows need -90 — 180 keeps them perpendicular, just upside down"
);

for (const id of ONEWAY_ARROW_LAYER_IDS) {
  const layer = onewayArrowLayer(id);

  assert.equal(layer.id, id);
  assert.equal(layer.type, "symbol");
  assert.equal(layer.source, "openmaptiles", `${id}: wrong source`);
  assert.equal(layer["source-layer"], "transportation", `${id}: wrong source layer`);
  assert.equal(layer.minzoom, ONEWAY_ARROW_MIN_ZOOM, `${id}: wrong minzoom`);

  const layout = layer.layout;
  assert.equal(layout["icon-image"], "oneway", `${id}: wrong sprite icon`);
  assert.equal(
    layout["symbol-placement"],
    "line",
    `${id}: arrows are placed along the line, not at a point`
  );
  assert.equal(
    layout["icon-rotation-alignment"],
    "map",
    `${id}: arrows must turn with the map, or they stop matching the road`
  );
  assert.equal(
    layout["icon-rotate"],
    ONEWAY_ARROW_ROTATION[id],
    `${id}: layer rotation must match the declared one`
  );
  assert.equal(
    layout["symbol-spacing"],
    ONEWAY_ARROW_SPACING,
    `${id}: wrong spacing`
  );

  // Each layer draws exactly one direction, or the two would sit on top of
  // each other and every one-way street would get arrows both ways.
  const expected = id === "road_oneway" ? 1 : -1;
  const onewayClause = layer.filter[1];
  assert.deepEqual(
    onewayClause,
    ["==", ["get", "oneway"], expected],
    `${id}: must filter on oneway === ${expected}`
  );
}

assert.notEqual(
  ONEWAY_ARROW_ROTATION.road_oneway,
  ONEWAY_ARROW_ROTATION.road_oneway_opposite,
  "the two directions must not render identically"
);

console.log(
  `oneway arrows ok — ${ONEWAY_ARROW_LAYER_IDS.length} layers, rotations ${ONEWAY_ARROW_ROTATION.road_oneway}/${ONEWAY_ARROW_ROTATION.road_oneway_opposite}`
);
