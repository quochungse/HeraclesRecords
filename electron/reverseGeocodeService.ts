import type { ReverseGeocodeResult } from "./types";

// Nominatim's usage policy requires a descriptive User-Agent and no more than
// one request per second. Every call is funnelled through a single-flight
// throttle so a burst — the globe asking about a screenful of visit clusters at
// once — can never exceed that rate.
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const NOMINATIM_USER_AGENT =
  "HeraclesRecords/1.0 (https://github.com/quochungse/HeraclesRecords)";
const NOMINATIM_MIN_INTERVAL_MS = 1_100;

let lastRequestAt = 0;
let requestChain: Promise<unknown> = Promise.resolve();

/** Serialises requests and spaces them out to respect the 1 req/s policy. */
function throttle<T>(task: () => Promise<T>): Promise<T> {
  const run = requestChain.then(async () => {
    const waitMs = lastRequestAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive regardless of individual failures.
  requestChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state_district?: string;
    hamlet?: string;
    suburb?: string;
    country?: string;
  };
}

function toResult(place: NominatimPlace): ReverseGeocodeResult | undefined {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return undefined;
  }
  return {
    label: place.display_name || place.name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lat,
    lon,
    city:
      place.address?.city ||
      place.address?.town ||
      place.address?.village ||
      place.address?.municipality ||
      place.address?.county ||
      place.address?.state_district ||
      place.address?.hamlet ||
      place.address?.suburb,
    country: place.address?.country
  };
}

/** Reverse geocode: coordinates → a human-readable place label. */
export async function reverseGeocodeLocation(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult> {
  const url = new URL(`${NOMINATIM_BASE_URL}/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");

  const response = await throttle(() =>
    fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(15_000)
    })
  );
  if (!response.ok) {
    throw new Error(
      `Place lookup failed: ${response.status} ${response.statusText}`
    );
  }

  const place = (await response.json()) as NominatimPlace;
  const result = toResult({ ...place, lat: String(lat), lon: String(lon) });
  return (
    result ?? {
      label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      lat,
      lon
    }
  );
}
