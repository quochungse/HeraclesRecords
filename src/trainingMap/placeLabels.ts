import type { ReverseGeocodeResult } from "../../electron/types";
import type { GlobePoint } from "./activityVisitHeatmap";

// Names for the globe's visit clusters. This is out of the view on purpose,
// because the rules below are the only part of naming a place a test can reach
// — the same reason `activityFilters.ts` sits beside `ActivitiesView`.

export interface PlaceLabel {
  city: string;
  country: string;
  full: string;
}

const PLACE_LABEL_CACHE = new Map<string, PlaceLabel>();
const PLACE_LABEL_REQUESTS = new Map<string, Promise<PlaceLabel>>();

// A lookup that failed is not an answer, so it is not remembered as one. Caching
// the coordinates it fell back to made a single blocked request permanent for
// the life of the window: the place kept reading "21.0° N, 105.8° E" long after
// the network came back, and nothing short of a restart would ask again. What is
// remembered instead is when it failed, so a dead provider is not hammered
// either.
const PLACE_LABEL_RETRY_MS = 60_000;
const PLACE_LABEL_FAILURES = new Map<string, number>();

// A cluster key is a ~55 km grid cell (`GEO_HEAT_STEP`), and neither the cell
// nor the name of the city in it changes — so the answer is worth keeping past
// the window that asked for it. Held only in memory, every launch re-asked a
// public geocoder about every place on the screen, serialised behind its
// throttle, and the screen read coordinates for the ten-odd seconds that took.
//
// **Only a name is written here.** A coordinate fallback must never be
// persisted: it is what the screen shows when nobody answered, and storing it
// would bake one blocked launch in permanently — the same bug as caching a
// failure, made to survive a restart.
const PLACE_LABEL_STORAGE_KEY = "coroslink.activity-globe.place-labels.v1";
const MAX_PERSISTED_PLACE_LABELS = 200;
const PLACE_LABEL_NAMED = new Set<string>();

interface PersistedPlaceLabels {
  version: 1;
  entries: Array<[string, PlaceLabel]>;
}

let placeLabelsHydrated = false;
let placeLabelWriteScheduled = false;

export function coordinateLabel(point: GlobePoint): PlaceLabel {
  const lat = `${Math.abs(point.lat).toFixed(1)}° ${point.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(point.lon).toFixed(1)}° ${point.lon >= 0 ? "E" : "W"}`;
  return {
    city: `${lat}, ${lon}`,
    country: "Location",
    full: `${lat}, ${lon}`,
  };
}

/** A part of an address is a name only if it is made of letters. */
function isNamedPart(part: string): boolean {
  return /\p{L}/u.test(part);
}

export function parsePlaceLabel(label: string, point: GlobePoint): PlaceLabel {
  const parts = label
    .split(",")
    .map((part) => part.trim())
    .filter(isNamedPart);
  if (parts.length === 0) {
    return coordinateLabel(point);
  }
  return {
    city: parts[0]!,
    country: parts.length > 1 ? parts[parts.length - 1]! : "Location",
    full: label,
  };
}

/**
 * The answer as a place — or `undefined` when it named nowhere.
 *
 * The caller needs the two apart: a name is worth writing to storage and a
 * cluster in open water is not, even though both end up on the screen as a
 * label.
 */
export function toPlaceLabel(
  result: ReverseGeocodeResult,
  point: GlobePoint,
): PlaceLabel | undefined {
  if (result.city) {
    return {
      city: result.city,
      country: result.country ?? "Location",
      full: result.label,
    };
  }
  const parsed = parsePlaceLabel(result.label, point);
  return parsed.full === coordinateLabel(point).full ? undefined : parsed;
}

function isStoredPlaceLabel(value: unknown): value is PlaceLabel {
  if (!value || typeof value !== "object") {
    return false;
  }
  const label = value as Partial<PlaceLabel>;
  return (
    typeof label.city === "string" &&
    label.city.trim() !== "" &&
    typeof label.country === "string" &&
    typeof label.full === "string"
  );
}

export function hydratePlaceLabels(): void {
  if (placeLabelsHydrated) {
    return;
  }
  placeLabelsHydrated = true;
  if (typeof window === "undefined") {
    return;
  }
  try {
    const stored = window.localStorage.getItem(PLACE_LABEL_STORAGE_KEY);
    if (!stored) {
      return;
    }
    const parsed = JSON.parse(stored) as Partial<PersistedPlaceLabels>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return;
    }
    for (const entry of parsed.entries.slice(-MAX_PERSISTED_PLACE_LABELS)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") {
        continue;
      }
      if (isStoredPlaceLabel(entry[1])) {
        PLACE_LABEL_CACHE.set(entry[0], entry[1]);
        PLACE_LABEL_NAMED.add(entry[0]);
      }
    }
  } catch {
    // Storage is best-effort; a corrupt or unavailable cache must not block UI.
  }
}

function persistPlaceLabels(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const entries: Array<[string, PlaceLabel]> = [];
    for (const [key, label] of PLACE_LABEL_CACHE) {
      if (PLACE_LABEL_NAMED.has(key)) {
        entries.push([key, label]);
      }
    }
    const payload: PersistedPlaceLabels = {
      version: 1,
      entries: entries.slice(-MAX_PERSISTED_PLACE_LABELS),
    };
    window.localStorage.setItem(
      PLACE_LABEL_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Quota and privacy settings can disable storage; memory cache still works.
  }
}

function schedulePlaceLabelWrite(): void {
  if (placeLabelWriteScheduled || typeof window === "undefined") {
    return;
  }
  placeLabelWriteScheduled = true;
  const write = () => {
    placeLabelWriteScheduled = false;
    persistPlaceLabels();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(write, { timeout: 1_500 });
  } else {
    window.setTimeout(write, 400);
  }
}

/** Every name resolved so far, for a view's first paint. */
export function knownPlaceLabels(): Record<string, PlaceLabel> {
  hydratePlaceLabels();
  return Object.fromEntries(PLACE_LABEL_CACHE);
}

export function loadPlaceLabel(
  key: string,
  point: GlobePoint,
): Promise<PlaceLabel> {
  hydratePlaceLabels();
  const cached = PLACE_LABEL_CACHE.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = PLACE_LABEL_REQUESTS.get(key);
  if (pending) {
    return pending;
  }
  const failedAt = PLACE_LABEL_FAILURES.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < PLACE_LABEL_RETRY_MS) {
    return Promise.resolve(coordinateLabel(point));
  }
  const api = window.corosLink;
  if (!api?.reverseGeocodeLocation) {
    return Promise.resolve(coordinateLabel(point));
  }
  const request = api
    .reverseGeocodeLocation(point.lat, point.lon)
    .then((result) => {
      const named = toPlaceLabel(result, point);
      const label = named ?? coordinateLabel(point);
      PLACE_LABEL_FAILURES.delete(key);
      PLACE_LABEL_CACHE.set(key, label);
      if (named) {
        PLACE_LABEL_NAMED.add(key);
        schedulePlaceLabelWrite();
      }
      return label;
    })
    .catch(() => {
      PLACE_LABEL_FAILURES.set(key, Date.now());
      return coordinateLabel(point);
    })
    .then((label) => {
      PLACE_LABEL_REQUESTS.delete(key);
      return label;
    });
  PLACE_LABEL_REQUESTS.set(key, request);
  return request;
}

/**
 * Forget everything, storage included.
 *
 * The caches are module state, deliberately — they exist so a name is asked for
 * once per app rather than once per view. That makes them the one thing a suite
 * cannot set up per scenario, so this is the seam it gets. Nothing in the app
 * calls it.
 */
export function resetPlaceLabels(): void {
  PLACE_LABEL_CACHE.clear();
  PLACE_LABEL_REQUESTS.clear();
  PLACE_LABEL_FAILURES.clear();
  PLACE_LABEL_NAMED.clear();
  placeLabelsHydrated = false;
  placeLabelWriteScheduled = false;
}

/** Writes the pending snapshot now, instead of at the next idle callback. */
export function flushPlaceLabelWrites(): void {
  placeLabelWriteScheduled = false;
  persistPlaceLabels();
}
