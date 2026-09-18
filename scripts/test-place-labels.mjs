// Names for the globe's visit clusters, and the three rules that decide what is
// remembered. A cluster key is a ~55 km grid cell and the name of the city in it
// does not change, so a resolved name is kept across launches — but a coordinate
// fallback never is, or one blocked launch would be baked in permanently.
//
// Mode: renderer TypeScript with extensionless imports in the graph, so the
// resolver hook comes along. Run through Electron because a distro Node built
// without Amaro cannot strip types.
//   cross-env ELECTRON_RUN_AS_NODE=1 electron --experimental-strip-types \
//     --import ./scripts/register-ts-ext.mjs scripts/test-place-labels.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const STORAGE_KEY = "coroslink.activity-globe.place-labels.v1";

// A localStorage and a `window.corosLink` the module can find.
class MemoryStorage {
  #map = new Map();
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    this.#map.set(key, String(value));
  }
  removeItem(key) {
    this.#map.delete(key);
  }
  clear() {
    this.#map.clear();
  }
}

const storage = new MemoryStorage();
let answer = async () => {
  throw new Error("no geocoder");
};
const asked = [];

globalThis.window = {
  localStorage: storage,
  corosLink: {
    reverseGeocodeLocation: async (lat, lon) => {
      asked.push([lat, lon]);
      return answer(lat, lon);
    }
  },
  // No requestIdleCallback, so the module takes its setTimeout path; the suite
  // flushes explicitly rather than waiting on either.
  setTimeout: (fn, ms) => setTimeout(fn, ms)
};

const moduleUrl = pathToFileURL(
  path.join(repoRoot, "src", "trainingMap", "placeLabels.ts")
).href;
const {
  coordinateLabel,
  flushPlaceLabelWrites,
  knownPlaceLabels,
  loadPlaceLabel,
  parsePlaceLabel,
  resetPlaceLabels,
  toPlaceLabel
} = await import(`${moduleUrl}?cacheBust=${Date.now()}`);

const HANOI = { lat: 21.0278, lon: 105.8342 };
const OCEAN = { lat: 0, lon: 0 };

function storedEntries() {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw).entries : [];
}

function reset() {
  resetPlaceLabels();
  storage.clear();
  asked.length = 0;
}

// ---------------------------------------------------------------------------
// 1. A name resolved once is on the screen at the next launch's first paint,
//    without asking anybody.

reset();
answer = async () => ({
  label: "Cat Linh Street, Van Mieu - Quoc Tu Giam Ward, Hanoi, Vietnam",
  lat: HANOI.lat,
  lon: HANOI.lon,
  city: "Hanoi",
  country: "Vietnam"
});

const first = await loadPlaceLabel("42:211", HANOI);
assert.equal(first.city, "Hanoi", "the name is resolved");
assert.equal(asked.length, 1, "one request");
flushPlaceLabelWrites();
assert.deepEqual(
  storedEntries().map(([key, label]) => [key, label.city]),
  [["42:211", "Hanoi"]],
  "the name reached storage"
);

// A fresh launch: module state gone, storage kept.
resetPlaceLabels();
asked.length = 0;
assert.equal(
  knownPlaceLabels()["42:211"].city,
  "Hanoi",
  "the name is known before any request"
);
const again = await loadPlaceLabel("42:211", HANOI);
assert.equal(again.city, "Hanoi", "still named");
assert.equal(asked.length, 0, "nobody was asked on the second launch");

// ---------------------------------------------------------------------------
// 2. A failed lookup is shown as coordinates and remembered as nothing. This is
//    the rule that keeps one blocked launch from becoming permanent.

reset();
answer = async () => {
  throw new Error("Place lookup failed (nominatim: fetch failed)");
};

const failed = await loadPlaceLabel("42:211", HANOI);
assert.deepEqual(failed, coordinateLabel(HANOI), "falls back to coordinates");
flushPlaceLabelWrites();
assert.deepEqual(storedEntries(), [], "a failure is not written to storage");

// And a later launch asks again rather than reading the fallback back.
resetPlaceLabels();
asked.length = 0;
answer = async () => ({
  label: "Hanoi, Vietnam",
  lat: HANOI.lat,
  lon: HANOI.lon,
  city: "Hanoi",
  country: "Vietnam"
});
const recovered = await loadPlaceLabel("42:211", HANOI);
assert.equal(recovered.city, "Hanoi", "the next launch recovers the name");
assert.equal(asked.length, 1, "it asked again");

// ---------------------------------------------------------------------------
// 3. "Nobody knows this place" is an answer, but not a name — so it is shown
//    and not stored either. Storing it is indistinguishable from storing a
//    failure once it is read back.

reset();
answer = async () => ({ label: "0.00000, 0.00000", lat: 0, lon: 0 });

const nowhere = await loadPlaceLabel("0:0", OCEAN);
assert.deepEqual(nowhere, coordinateLabel(OCEAN), "open water reads as coordinates");
flushPlaceLabelWrites();
assert.deepEqual(storedEntries(), [], "open water is not written to storage");

// But it is not re-asked within the session — the answer will not change today.
asked.length = 0;
await loadPlaceLabel("0:0", OCEAN);
assert.equal(asked.length, 0, "the session remembers it asked");

// ---------------------------------------------------------------------------
// 4. `toPlaceLabel` is what splits a name from a non-name, and a bare pair of
//    coordinates must not read as one. "21.0° N" carries letters, so a
//    letters-anywhere test is not enough on its own.

assert.equal(
  toPlaceLabel({ label: "0.00000, 0.00000", lat: 0, lon: 0 }, OCEAN),
  undefined,
  "a coordinate label names nowhere"
);
assert.equal(
  toPlaceLabel(
    { label: coordinateLabel(HANOI).full, lat: HANOI.lat, lon: HANOI.lon },
    HANOI
  ),
  undefined,
  "the degrees-and-compass spelling names nowhere either"
);
assert.equal(
  toPlaceLabel({ label: "Hanoi, Vietnam", lat: HANOI.lat, lon: HANOI.lon }, HANOI)
    ?.city,
  "Hanoi",
  "a label with no city field is still parsed for one"
);

// 4b. Numeric parts of an address are not the city. A postcode leading the
//     string is what this guards.
assert.equal(
  parsePlaceLabel("11508, Hanoi, Vietnam", HANOI).city,
  "Hanoi",
  "a postcode is skipped"
);

// ---------------------------------------------------------------------------
// 5. A corrupt or foreign payload must not take the screen down with it.

reset();
storage.setItem(STORAGE_KEY, "{not json");
assert.deepEqual(knownPlaceLabels(), {}, "unparseable storage reads as empty");

reset();
storage.setItem(
  STORAGE_KEY,
  JSON.stringify({ version: 2, entries: [["42:211", { city: "Hanoi" }]] })
);
assert.deepEqual(knownPlaceLabels(), {}, "a future version is ignored");

reset();
storage.setItem(
  STORAGE_KEY,
  JSON.stringify({
    version: 1,
    entries: [
      ["42:211", { city: "Hanoi", country: "Vietnam", full: "Hanoi, Vietnam" }],
      ["bad", { city: "" }],
      ["worse", null],
      "not-an-entry"
    ]
  })
);
assert.deepEqual(
  Object.keys(knownPlaceLabels()),
  ["42:211"],
  "malformed entries are dropped and the good one survives"
);

console.log("place labels: all assertions passed");
