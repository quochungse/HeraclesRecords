import type { ReverseGeocodeResult } from "./types";

// "Where you've been" names its clusters by asking a public reverse geocoder,
// and it asks more than one of them in turn. A single host is a single point of
// failure the app cannot route around: a resolver that answers
// `*.openstreetmap.org` with loopback — which is what a number of ISPs do —
// takes Nominatim off the map for that machine entirely, so every lookup throws
// and every place on the screen falls back to a pair of coordinates with
// nothing anywhere saying why. Photon serves the same OSM data from a different
// domain, so the two are blocked independently.
//
// Each provider keeps its own throttle, because their rate policies differ and
// one being slow must not hold the other up. Nominatim's usage policy requires
// a descriptive User-Agent and no more than one request per second.

const REQUEST_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "HeraclesRecords/1.0 (https://github.com/quochungse/HeraclesRecords)";

// A provider that could not be reached is stood down for a while rather than
// retried per cluster. The globe asks about a screenful at once, and paying a
// dead host's timeout eight times over is what turns one blocked domain into a
// minute of "Loading" on a screen that had a working answer available all along.
const PROVIDER_COOLDOWN_MS = 5 * 60_000;

interface GeocodeProvider {
  readonly id: string;
  readonly minIntervalMs: number;
  buildUrl(lat: number, lon: number): URL;
  /**
   * Whatever the provider answered, as a place — or `undefined` when it
   * answered about nowhere. That is not a failure: a cluster in open water has
   * no name, so moving on to the next provider is right while standing this one
   * down is not.
   */
  parse(
    payload: unknown,
    lat: number,
    lon: number
  ): ReverseGeocodeResult | undefined;
}

/** Serialises one provider's requests and spaces them out to its own policy. */
class ProviderQueue {
  #lastRequestAt = 0;
  #chain: Promise<unknown> = Promise.resolve();
  #downUntil = 0;

  constructor(private readonly minIntervalMs: number) {}

  get isDown(): boolean {
    return Date.now() < this.#downUntil;
  }

  standDown(): void {
    this.#downUntil = Date.now() + PROVIDER_COOLDOWN_MS;
  }

  clearDown(): void {
    this.#downUntil = 0;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(async () => {
      const waitMs = this.#lastRequestAt + this.minIntervalMs - Date.now();
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.#lastRequestAt = Date.now();
      return task();
    });
    // Keep the chain alive regardless of individual failures.
    this.#chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function coordinateLabel(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Joins address parts most-specific first, dropping blanks and repeats. */
function joinParts(parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    kept.push(value);
  }
  return kept.join(", ");
}

interface NominatimPlace {
  display_name?: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state_district?: string;
    state?: string;
    hamlet?: string;
    suburb?: string;
    country?: string;
  };
  error?: unknown;
}

export function parseNominatimPlace(
  payload: unknown,
  lat: number,
  lon: number
): ReverseGeocodeResult | undefined {
  const place = payload as NominatimPlace | null;
  if (!place || typeof place !== "object" || place.error) {
    return undefined;
  }
  const address = place.address ?? {};
  const city = firstString(
    address.city,
    address.town,
    address.village,
    address.municipality,
    address.suburb,
    address.hamlet,
    address.county,
    address.state_district,
    address.state
  );
  const country = firstString(address.country);
  const label = firstString(place.display_name, place.name);
  if (!label && !city) {
    return undefined;
  }
  return {
    label: label ?? joinParts([city, country]),
    lat,
    lon,
    city,
    country
  };
}

interface PhotonFeature {
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

export function parsePhotonPlace(
  payload: unknown,
  lat: number,
  lon: number
): ReverseGeocodeResult | undefined {
  const collection = payload as { features?: PhotonFeature[] } | null;
  const properties = collection?.features?.[0]?.properties;
  if (!properties || typeof properties !== "object") {
    return undefined;
  }
  // Photon answers with the nearest named feature, which around a training
  // cluster is as often a cash machine as a street. `city` is what the screen
  // shows, so it comes from the administrative fields and never from that
  // feature's own name.
  const city = firstString(
    properties.city,
    properties.district,
    properties.locality,
    properties.county,
    properties.state
  );
  const country = firstString(properties.country);
  const street = properties.housenumber
    ? `${properties.housenumber} ${properties.street ?? ""}`.trim()
    : properties.street;
  // Photon has no `display_name`, so the full label is built the way Nominatim
  // writes one: most-specific first.
  const label = joinParts([
    properties.name,
    street,
    properties.locality,
    properties.district,
    properties.city,
    properties.state,
    country
  ]);
  if (!label && !city) {
    return undefined;
  }
  return {
    label: label || joinParts([city, country]),
    lat,
    lon,
    city,
    country
  };
}

const NOMINATIM: GeocodeProvider = {
  id: "nominatim",
  minIntervalMs: 1_100,
  buildUrl(lat, lon) {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    return url;
  },
  parse: parseNominatimPlace
};

const PHOTON: GeocodeProvider = {
  id: "photon",
  minIntervalMs: 350,
  buildUrl(lat, lon) {
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("lang", "en");
    return url;
  },
  parse: parsePhotonPlace
};

export const REVERSE_GEOCODE_PROVIDERS: readonly GeocodeProvider[] = [
  NOMINATIM,
  PHOTON
];

const QUEUES = new Map<string, ProviderQueue>();

function queueFor(provider: GeocodeProvider): ProviderQueue {
  let queue = QUEUES.get(provider.id);
  if (!queue) {
    queue = new ProviderQueue(provider.minIntervalMs);
    QUEUES.set(provider.id, queue);
  }
  return queue;
}

/**
 * Forget every provider's throttle and cooldown.
 *
 * The queues are module state, deliberately — they exist to pace a whole app
 * against a shared public service, so one per caller would pace nothing. That
 * makes them the one thing a suite cannot set up per scenario, so this is the
 * seam it gets. Nothing in the app calls it.
 */
export function resetReverseGeocodeProviders(): void {
  QUEUES.clear();
}

export interface ReverseGeocodeDeps {
  fetch: typeof fetch;
}

function createDefaultDeps(): ReverseGeocodeDeps {
  return { fetch: (...args) => fetch(...args) };
}

/**
 * Reverse geocode: coordinates → a human-readable place label.
 *
 * Throws when no provider could be reached, so the caller can tell "nobody
 * answered" from "the answer is that there is nothing here" and decline to
 * remember the first as though it were the second.
 */
export async function reverseGeocodeLocation(
  lat: number,
  lon: number,
  deps: ReverseGeocodeDeps = createDefaultDeps()
): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Place lookup needs finite coordinates, got ${lat}, ${lon}`);
  }

  let reached = false;
  const failures: string[] = [];

  for (const provider of REVERSE_GEOCODE_PROVIDERS) {
    const queue = queueFor(provider);
    if (queue.isDown) {
      failures.push(`${provider.id}: standing down`);
      continue;
    }
    let payload: unknown;
    try {
      const response = await queue.run(() =>
        deps.fetch(provider.buildUrl(lat, lon), {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      payload = await response.json();
    } catch (error) {
      queue.standDown();
      failures.push(
        `${provider.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      continue;
    }
    // It answered, so it is up — even if it had no name to offer.
    queue.clearDown();
    reached = true;
    const result = provider.parse(payload, lat, lon);
    if (result) {
      return result;
    }
  }

  if (reached) {
    // Somebody answered and nobody knew the place. That is an answer, and the
    // caller may remember it.
    return { label: coordinateLabel(lat, lon), lat, lon };
  }
  throw new Error(`Place lookup failed (${failures.join("; ")})`);
}
