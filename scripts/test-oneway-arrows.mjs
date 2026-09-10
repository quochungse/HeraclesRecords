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
  ONEWAY_ARROW_SOURCE,
  ONEWAY_ARROW_SPACING,
  ONEWAY_ARROW_MIN_ZOOM,
  applyOnewayArrows,
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

// Every arrow layer must carry the road-class filter. `dark` ships these
// layers without one, so patching only the rotation would leave it drawing
// arrows on paths and ferries that `positron` — which gets the layer built
// from scratch — never shows.
for (const id of ONEWAY_ARROW_LAYER_IDS) {
  const [combinator, , classClause] = onewayArrowLayer(id).filter;
  assert.equal(combinator, "all", `${id}: filter must combine both clauses`);
  assert.equal(
    classClause?.[0],
    "match",
    `${id}: needs the road-class filter, or the themes disagree about which ways get an arrow`
  );
}

/**
 * A stand-in for the MapLibre map, recording what `applyOnewayArrows` does to
 * a style. Only the handful of methods the fix calls are implemented.
 */
function fakeGlMap(layers, { sources = [ONEWAY_ARROW_SOURCE] } = {}) {
  const state = layers.map((layer) => ({ ...layer }));
  return {
    layers: state,
    getSource: (id) => (sources.includes(id) ? {} : undefined),
    getStyle: () => ({ layers: state.map((layer) => ({ ...layer })) }),
    // Not used by the fix — patching one property is the shape being guarded
    // against — but implemented so that regressing to it fails on the
    // assertions below rather than on a missing method.
    setLayoutProperty(id, name, value) {
      const layer = state.find((candidate) => candidate.id === id);
      assert.ok(layer, `setLayoutProperty on unknown layer ${id}`);
      layer.layout = { ...layer.layout, [name]: value };
    },
    removeLayer(id) {
      const index = state.findIndex((layer) => layer.id === id);
      assert.notEqual(index, -1, `removeLayer(${id}) on a layer that is not there`);
      state.splice(index, 1);
    },
    addLayer(layer, beforeId) {
      const index =
        beforeId === undefined
          ? state.length
          : state.findIndex((candidate) => candidate.id === beforeId);
      assert.notEqual(index, -1, `addLayer before unknown layer ${beforeId}`);
      state.splice(index, 0, layer);
    }
  };
}

const expectedArrowLayers = ONEWAY_ARROW_LAYER_IDS.map(onewayArrowLayer);

// `dark` ships both layers, with the rotation that put every arrow across the
// road and no class filter. They must come back as the canonical description,
// in the positions the style had them.
{
  const gl = fakeGlMap([
    { id: "highway_minor", type: "line" },
    { id: "road_oneway", type: "symbol", layout: { "icon-rotate": 0 }, filter: ["==", ["get", "oneway"], 1] },
    { id: "road_oneway_opposite", type: "symbol", layout: { "icon-rotate": 180 }, filter: ["==", ["get", "oneway"], -1] },
    { id: "water_name", type: "symbol" }
  ]);
  applyOnewayArrows(gl);

  assert.deepEqual(
    gl.layers.map((layer) => layer.id),
    ["highway_minor", "road_oneway", "road_oneway_opposite", "water_name"],
    "a style's own arrow layers must be replaced in place, not moved to the end"
  );
  assert.deepEqual(
    gl.layers.slice(1, 3),
    expectedArrowLayers,
    "an existing arrow layer must end up as the whole description, not just a new rotation"
  );
}

// `positron` ships neither, and the arrows have to land above the road lines
// but below the first label.
{
  const gl = fakeGlMap([
    { id: "highway_minor", type: "line" },
    { id: "boundary_2", type: "line" },
    { id: "waterway_line_label", type: "symbol" },
    { id: "label_city", type: "symbol" }
  ]);
  applyOnewayArrows(gl);

  assert.deepEqual(
    gl.layers.map((layer) => layer.id),
    [
      "highway_minor",
      "boundary_2",
      "road_oneway",
      "road_oneway_opposite",
      "waterway_line_label",
      "label_city"
    ],
    "arrows go above every line layer and below the first label"
  );
  assert.deepEqual(
    gl.layers.slice(2, 4),
    expectedArrowLayers,
    "a style with no arrow layers gets the description verbatim"
  );
}

// Both styles must end with byte-identical arrow layers — that is the whole
// claim this module makes.
{
  const shipped = fakeGlMap([
    { id: "road_oneway", type: "symbol", layout: { "icon-rotate": 0 } },
    { id: "road_oneway_opposite", type: "symbol", layout: { "icon-rotate": 180 } },
    { id: "water_name", type: "symbol" }
  ]);
  const missing = fakeGlMap([{ id: "water_name", type: "symbol" }]);
  applyOnewayArrows(shipped);
  applyOnewayArrows(missing);

  assert.deepEqual(
    shipped.layers.filter((layer) => layer.id.startsWith("road_oneway")),
    missing.layers.filter((layer) => layer.id.startsWith("road_oneway")),
    "the two themes must not drift apart"
  );
}

// A style built on another schema has no `transportation` layer to read, and
// `addLayer` against a missing source throws inside a style.load handler.
{
  const gl = fakeGlMap([{ id: "water_name", type: "symbol" }], { sources: ["other"] });
  applyOnewayArrows(gl);
  assert.deepEqual(
    gl.layers.map((layer) => layer.id),
    ["water_name"],
    "no openmaptiles source means no arrows, not a thrown error"
  );
}

console.log(
  `oneway arrows ok — ${ONEWAY_ARROW_LAYER_IDS.length} layers, rotations ${ONEWAY_ARROW_ROTATION.road_oneway}/${ONEWAY_ARROW_ROTATION.road_oneway_opposite}`
);
