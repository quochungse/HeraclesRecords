// "Where you've been" names its clusters through `places:reverseGeocode`, and a
// single geocoding host is a single point of failure the app cannot route
// around: a resolver that answers `*.openstreetmap.org` with loopback — which is
// what a number of ISPs do — took Nominatim off the map for that machine, every
// lookup threw, and every place on the screen fell back to a pair of
// coordinates. This suite drives the provider chain that fixes it, and the
// distinction the renderer's cache rests on: a provider that answered about
// nowhere is an answer, and nobody answering is not.
//
// Mode: compiled main-process code from dist-electron.
//   npm run build:electron && node scripts/test-reverse-geocode.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  REVERSE_GEOCODE_PROVIDERS,
  parseNominatimPlace,
  parsePhotonPlace,
  resetReverseGeocodeProviders,
  reverseGeocodeLocation
} = await import(`${distUrl("reverseGeocodeService.js")}?cacheBust=${Date.now()}`);

const HANOI = { lat: 21.0278, lon: 105.8342 };

// Verbatim from the live APIs, trimmed to the fields each parser reads.
const NOMINATIM_PAYLOAD = {
  display_name:
    "Cat Linh Street, Van Mieu - Quoc Tu Giam Ward, Hanoi, 11508, Vietnam",
  name: "Cat Linh Street",
  address: {
    road: "Cat Linh Street",
    suburb: "Van Mieu - Quoc Tu Giam Ward",
    city: "Hanoi",
    country: "Vietnam"
  }
};

const PHOTON_PAYLOAD = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        osm_key: "highway",
        osm_value: "tertiary",
        name: "Cat Linh Street",
        locality: "Thanh Giám",
        district: "Van Mieu - Quoc Tu Giam Ward",
        city: "Hanoi",
        country: "Vietnam",
        postcode: "11508",
        countrycode: "VN"
      },
      geometry: { type: "Point", coordinates: [105.8342007, 21.0277915] }
    }
  ]
};

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => payload
  };
}

// ---------------------------------------------------------------------------
// 1. Both parsers name the same place from their own payload shape.

const fromNominatim = parseNominatimPlace(
  NOMINATIM_PAYLOAD,
  HANOI.lat,
  HANOI.lon
);
assert.equal(fromNominatim.city, "Hanoi", "Nominatim city");
assert.equal(fromNominatim.country, "Vietnam", "Nominatim country");
assert.match(fromNominatim.label, /Cat Linh Street/, "Nominatim display name");

const fromPhoton = parsePhotonPlace(PHOTON_PAYLOAD, HANOI.lat, HANOI.lon);
assert.equal(fromPhoton.city, "Hanoi", "Photon city");
assert.equal(fromPhoton.country, "Vietnam", "Photon country");
// Photon has no display_name, so the label is built most-specific first.
assert.equal(
  fromPhoton.label,
  "Cat Linh Street, Thanh Giám, Van Mieu - Quoc Tu Giam Ward, Hanoi, Vietnam",
  "Photon label is assembled, not a bare name"
);

// 1b. Photon answers with the nearest named feature, which is as often a shop as
// a street. The screen shows `city`, so it must never come from that name.
const atm = parsePhotonPlace(
  {
    features: [
      {
        properties: {
          osm_key: "amenity",
          osm_value: "atm",
          name: "Techcombank ATM",
          district: "Hòa Cường Ward",
          city: "Da Nang",
          country: "Vietnam"
        }
      }
    ]
  },
  16.0544,
  108.2022
);
assert.equal(atm.city, "Da Nang", "city comes from the administrative fields");

// 1c. A payload naming nowhere is not a place.
assert.equal(
  parsePhotonPlace({ features: [] }, HANOI.lat, HANOI.lon),
  undefined,
  "empty Photon collection"
);
assert.equal(
  parseNominatimPlace({ error: "Unable to geocode" }, HANOI.lat, HANOI.lon),
  undefined,
  "Nominatim error payload"
);

// ---------------------------------------------------------------------------
// 2. The chain has more than one provider, on more than one domain. One host is
//    what the blocked-resolver failure was made of.

const hosts = REVERSE_GEOCODE_PROVIDERS.map(
  (provider) => provider.buildUrl(HANOI.lat, HANOI.lon).hostname
);
assert.ok(hosts.length >= 2, "at least two providers");
assert.equal(new Set(hosts).size, hosts.length, "providers are on distinct hosts");
assert.ok(
  hosts.some((host) => !host.endsWith("openstreetmap.org")),
  "at least one provider survives an openstreetmap.org block"
);

// ---------------------------------------------------------------------------
// 3. A blocked first provider must not cost the place its name.

resetReverseGeocodeProviders();
{
  const asked = [];
  const result = await reverseGeocodeLocation(HANOI.lat, HANOI.lon, {
    fetch: async (url) => {
      const host = new URL(url).hostname;
      asked.push(host);
      if (host.endsWith("openstreetmap.org")) {
        // What a loopback-poisoned resolver produces.
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
      }
      return jsonResponse(PHOTON_PAYLOAD);
    }
  });
  assert.equal(result.city, "Hanoi", "the second provider names the place");
  assert.ok(asked.length >= 2, "the chain moved past the dead host");
}

// 3b. And the dead host is stood down rather than retried per cluster — the
//     globe asks about a screenful at once.
{
  let openStreetMapCalls = 0;
  const fetchImpl = async (url) => {
    const host = new URL(url).hostname;
    if (host.endsWith("openstreetmap.org")) {
      openStreetMapCalls += 1;
      throw new Error("fetch failed");
    }
    return jsonResponse(PHOTON_PAYLOAD);
  };
  for (let index = 0; index < 4; index += 1) {
    await reverseGeocodeLocation(HANOI.lat + index / 100, HANOI.lon, {
      fetch: fetchImpl
    });
  }
  assert.equal(
    openStreetMapCalls,
    0,
    "a provider stood down in test 3 stays down for the burst"
  );
}

// ---------------------------------------------------------------------------
// 4. Nobody answering throws; somebody answering about nowhere does not.
//    The renderer caches the second and retries the first, so they cannot be
//    the same return value.

resetReverseGeocodeProviders();
await assert.rejects(
  () =>
    reverseGeocodeLocation(51.5, -0.12, {
      fetch: async () => {
        throw new Error("fetch failed");
      }
    }),
  /Place lookup failed/,
  "every provider unreachable throws"
);

resetReverseGeocodeProviders();
{
  const nowhere = await reverseGeocodeLocation(0, 0, {
    fetch: async (url) =>
      new URL(url).hostname.endsWith("openstreetmap.org")
        ? jsonResponse({ error: "Unable to geocode" })
        : jsonResponse({ features: [] })
  });
  assert.equal(nowhere.city, undefined, "nowhere has no city");
  assert.equal(nowhere.label, "0.00000, 0.00000", "nowhere reads as coordinates");
}

// 4b. An HTTP error is a provider that did not answer, not a place with no name.
resetReverseGeocodeProviders();
await assert.rejects(
  () =>
    reverseGeocodeLocation(48.85, 2.35, {
      fetch: async () => jsonResponse({}, { ok: false, status: 429 })
    }),
  /Place lookup failed/,
  "429 from every provider throws"
);

// ---------------------------------------------------------------------------
// 5. Coordinates that are not coordinates never reach a provider.

resetReverseGeocodeProviders();
await assert.rejects(
  () =>
    reverseGeocodeLocation(Number.NaN, 0, {
      fetch: async () => {
        throw new Error("should not be asked");
      }
    }),
  /finite coordinates/,
  "NaN is refused before any request"
);

console.log("reverse geocode: all assertions passed");
