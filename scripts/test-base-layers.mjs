/**
 * The base map styles must stay free and keyless.
 *
 * This is not a style-guide preference. Nothing in the app holds a map
 * provider key, there is no setting to enter one, and no build step bakes one
 * in — so a style that needs a key does not degrade, it simply stops being a
 * map. CARTO showed how quiet that failure can be: in August 2026 its keyless
 * raster tiles began arriving as valid 200 PNGs with "API KEY REQUIRED"
 * printed across them, which no status check could see. The two screens that
 * pick a style by theme were the ones wearing it.
 *
 * Run: npm run test:base-layers
 * (Electron, because this machine's Node has no Amaro for --experimental-strip-types.)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const constantsUrl =
  pathToFileURL(path.join(repoRoot, "src/mapBase/constants.ts")).href +
  "?cacheBust=" +
  Date.now();

const { BASE_LAYERS, BASE_LAYER_ORDER } = await import(constantsUrl);

const ids = Object.keys(BASE_LAYERS);

// A style that reads as "needs credentials" in any of the usual spellings.
const KEY_SHAPED = /(api[_-]?key|access[_-]?token|apikey=|[?&]key=|\{key\}|subscription)/i;

// CARTO's raster basemaps are the reason this suite exists; they now watermark
// keyless requests, so nothing may point back at them.
const WATERMARKING_HOSTS = [/cartocdn\.com/i, /basemaps\.carto\.com/i];

assert.deepEqual(
  [...BASE_LAYER_ORDER].sort(),
  [...ids].sort(),
  "BASE_LAYER_ORDER must list every style exactly once"
);

for (const id of ids) {
  const config = BASE_LAYERS[id];

  assert.ok(
    config.kind === "raster" || config.kind === "vector",
    `${id}: kind must be "raster" or "vector", got ${JSON.stringify(config.kind)}`
  );
  assert.ok(config.label, `${id}: needs a label`);
  assert.ok(config.description, `${id}: needs a description`);
  assert.ok(
    config.attribution && config.attribution.length > 0,
    `${id}: attribution is not optional — every source here requires credit`
  );
  assert.ok(
    Number.isInteger(config.maxZoom) && config.maxZoom > 0,
    `${id}: maxZoom must be a positive integer`
  );

  const endpoint = config.kind === "vector" ? config.styleUrl : config.url;
  assert.ok(endpoint, `${id}: needs a url (raster) or styleUrl (vector)`);
  assert.ok(
    endpoint.startsWith("https://"),
    `${id}: must be https, got ${endpoint}`
  );
  assert.ok(
    !KEY_SHAPED.test(endpoint),
    `${id}: endpoint looks like it needs an API key — nothing in the app has one to give it: ${endpoint}`
  );
  for (const host of WATERMARKING_HOSTS) {
    assert.ok(
      !host.test(endpoint),
      `${id}: points at CARTO, which watermarks keyless tiles with "API KEY REQUIRED": ${endpoint}`
    );
  }

  if (config.kind === "raster") {
    assert.ok(
      endpoint.includes("{z}") && endpoint.includes("{x}") && endpoint.includes("{y}"),
      `${id}: raster url needs {z}/{x}/{y} placeholders`
    );
    // `{s}` without an explicit `subdomains` is fine — Leaflet defaults to
    // "abc" — but a declared one must actually be usable.
    assert.ok(
      config.subdomains === undefined ||
        (typeof config.subdomains === "string" && config.subdomains.length > 0),
      `${id}: subdomains, when given, must be a non-empty string`
    );
  } else {
    assert.equal(
      config.url,
      undefined,
      `${id}: a vector style must not also carry a raster url`
    );
  }
}

// The two theme-driven screens (Overview map, activity detail map) resolve to
// exactly these two ids, so they are the ones that must never regress.
for (const id of ["light", "dark"]) {
  assert.equal(
    BASE_LAYERS[id].kind,
    "vector",
    `${id}: the theme-matched styles are vector (OpenFreeMap) since the CARTO watermark`
  );
}

// ---------------------------------------------------------------------------
// What happens when the vector styles cannot be drawn.
//
// Both theme-matched styles are vector, so a machine whose WebGL is refused
// ("WebGL2 blocklisted" — a real Linux/NVIDIA case) falls back to raster. Every
// keyless raster style is a daylight one, so the dark theme showed a bright
// white map with nothing anywhere saying why. Two things stop that, and each is
// one line somebody could delete without a test noticing.
// ---------------------------------------------------------------------------

const read = (file) =>
  fs.readFileSync(path.join(repoRoot, file), "utf8");

assert.match(
  read("electron/main.ts"),
  /appendSwitch\("enable-unsafe-swiftshader"\)/,
  "main must let WebGL fall back to software rendering, or a blocklisted GPU costs every map its style"
);

const baseLayerSource = read("src/mapBase/baseLayers.ts");
assert.match(
  baseLayerSource,
  /BASEMAP_FALLBACK_CLASS = "is-basemap-fallback"/,
  "a map showing the raster stand-in must say so on its container"
);
assert.match(
  baseLayerSource,
  /classList\.toggle\(\s*BASEMAP_FALLBACK_CLASS,\s*resolved !== config\s*\)/,
  "the mark goes on when the style was swapped and off when it was not"
);
assert.match(
  read("src/styles.css"),
  /:root:not\(\[data-theme="paper"\]\) \.is-basemap-fallback \.leaflet-heraclesBasemap-pane/,
  "the dark theme must tone the raster stand-in, or the fallback is a white map in a dark app"
);

console.log(`base layers ok — ${ids.length} styles, all keyless, fallback marked and toned`);
