import {
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Route,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
} from "../../electron/types";
import {
  extractTrackPoints,
  getCachedRoutePolylines,
  getCachedVisitPoints,
  loadActivityVisits,
  rememberActivityGeo,
  sampleGlobePoints,
  type ActivityRoutePolyline,
  type ActivityVisitPoint,
  type GlobePlace,
  type GlobePoint,
} from "./activityVisitHeatmap";
import { placeLabelKey } from "./placeClusters";
import {
  coordinateLabel,
  knownPlaceLabels,
  loadPlaceLabel,
  type PlaceLabel,
} from "./placeLabels";
import {
  activityTimestampMs,
  buildPlaceSummaries,
  farthestFromHome,
  homePlace,
  placeLabelFor,
  placesSummaryLine,
  sortPlaces,
  type PlaceSort,
  type PlaceSummary,
} from "./placeSummaries";
import { PlaceDetail, PlaceLabourCard, PlaceList } from "./PlacePanels";
import { useRegionIndex } from "./useRegionIndex";
import type { LabourState } from "../records/labours";
import {
  ActivityGlobeStreetMap,
  type StreetMapFocus,
} from "./ActivityGlobeStreetMap";
import {
  ActivityGlobeRenderer,
  type ActivityGlobeRendererHandle,
} from "./ActivityGlobeRenderer";
import { OptionGroup } from "../components/OptionGroup";
import { useBackGesture } from "../running/sportPage";
import { periodLabel } from "../preferences/periodScale";
import {
  defineSelectionPreference,
  useSelectionPreference,
} from "../preferences/selectionPreferences";
import "./activityGlobe.css";

interface ActivityGlobeCardProps {
  activities: TrainingHubActivity[];
  connected: boolean;
  detail: TrainingHubActivityDetail | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  /** Opens an activity on its own screen, from a place's list of them. */
  onOpenActivity: (activityId: string) => void;
  /** The Cattle of Geryon, once the Hall of Records has reckoned it. */
  labour?: LabourState;
  onOpenLabours: () => void;
}

type ActivityPeriod = "all" | "year" | "90-days" | "custom";

interface ActivityPeriodPreference {
  period: ActivityPeriod;
  customStart: string;
  customEnd: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCATION_ZOOM_DURATION_MS = 1_100;
/** One press of + or −: the camera's altitude times this, or divided by it. */
const ZOOM_STEP = 0.7;
/** Places named per batch, as the list scrolls: the geocoder is throttled. */
const LABEL_BATCH = 40;

function isIsoDateOrEmpty(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

// The key keeps its `overview.` spelling after the map moved off Overview into
// its own screen: it is already in every athlete's localStorage, and renaming it
// would silently reset the period they had chosen.
const ACTIVITY_PERIOD_PREFERENCE =
  defineSelectionPreference<ActivityPeriodPreference>({
    key: "overview.activityPeriod",
    defaultValue: { period: "all", customStart: "", customEnd: "" },
    validate: (value): value is ActivityPeriodPreference => {
      if (typeof value !== "object" || value === null) return false;
      const candidate = value as Record<string, unknown>;
      if (
        !["all", "year", "90-days", "custom"].includes(
          String(candidate.period),
        ) ||
        !isIsoDateOrEmpty(candidate.customStart) ||
        !isIsoDateOrEmpty(candidate.customEnd)
      ) {
        return false;
      }
      return !(
        candidate.customStart &&
        candidate.customEnd &&
        candidate.customStart > candidate.customEnd
      );
    },
  });

const PLACE_SORT_PREFERENCE = defineSelectionPreference<PlaceSort>({
  key: "trainingMap.placeSort",
  defaultValue: "recent",
  validate: (value): value is PlaceSort =>
    value === "recent" || value === "visits",
});

/**
 * The place open beside the globe, kept for the session rather than the mount:
 * an activity opened from a place leaves this screen, and Back from it should
 * land on the place it was opened from, not on the list.
 */
let rememberedPlaceKey: string | null = null;

const MAX_RENDERED_POINTS = 900;

function samplePoints(points: GlobePoint[]): GlobePoint[] {
  return sampleGlobePoints(points, MAX_RENDERED_POINTS);
}

function mergeVisits(
  base: ActivityVisitPoint[],
  next: ActivityVisitPoint,
): ActivityVisitPoint[] {
  return mergeVisitBatch(base, [next]);
}

function mergeVisitBatch(
  base: ActivityVisitPoint[],
  incoming: ActivityVisitPoint[],
): ActivityVisitPoint[] {
  if (incoming.length === 0) {
    return base;
  }
  const activityIds = new Set(base.map((visit) => visit.activityId));
  const additions = incoming.filter((visit) => {
    if (activityIds.has(visit.activityId)) {
      return false;
    }
    activityIds.add(visit.activityId);
    return true;
  });
  return additions.length > 0 ? [...base, ...additions] : base;
}

function mergeRoutes(
  base: ActivityRoutePolyline[],
  next: ActivityRoutePolyline,
): ActivityRoutePolyline[] {
  return mergeRouteBatch(base, [next]);
}

function mergeRouteBatch(
  base: ActivityRoutePolyline[],
  incoming: ActivityRoutePolyline[],
): ActivityRoutePolyline[] {
  if (incoming.length === 0) {
    return base;
  }
  const routesById = new Map(
    base.map((route) => [route.activityId, route] as const),
  );
  let changed = false;
  for (const route of incoming) {
    if (route.points.length < 2) {
      continue;
    }
    const current = routesById.get(route.activityId);
    if (!current || current.points.length < route.points.length) {
      routesById.set(route.activityId, route);
      changed = true;
    }
  }
  return changed ? Array.from(routesById.values()) : base;
}

export function ActivityGlobeCard({
  activities,
  connected,
  detail,
  onSelectActivity,
  onOpenActivity,
  labour,
  onOpenLabours,
}: ActivityGlobeCardProps) {
  const globeRendererRef = useRef<ActivityGlobeRendererHandle>(null);
  const streetEnterTimerRef = useRef<number | null>(null);

  const [periodPreference, setPeriodPreference] = useSelectionPreference(
    ACTIVITY_PERIOD_PREFERENCE,
  );
  const { period, customStart, customEnd } = periodPreference;
  const [placeSort, setPlaceSort] = useSelectionPreference(
    PLACE_SORT_PREFERENCE,
  );
  const [selectedLocationKey, setSelectedLocationKeyState] = useState<
    string | null
  >(rememberedPlaceKey);
  const setSelectedLocationKey = useCallback((key: string | null) => {
    rememberedPlaceKey = key;
    setSelectedLocationKeyState(key);
  }, []);
  const [labelReach, setLabelReach] = useState(LABEL_BATCH);
  // Seeded from storage, so the names a previous launch resolved are on the
  // screen in the first paint instead of arriving one request later.
  const [placeLabels, setPlaceLabels] = useState<Record<string, PlaceLabel>>(
    knownPlaceLabels,
  );
  const [globeError, setGlobeError] = useState(false);
  // The outlines that tell places apart. Until they are here there are no
  // places to draw: grouping without them would draw a different map a moment
  // later.
  const regionIndex = useRegionIndex();

  const filteredActivities = useMemo(() => {
    if (period === "all") {
      return activities;
    }
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const ninetyDaysAgo = now.getTime() - 90 * 86_400_000;
    const customStartMs = customStart
      ? new Date(`${customStart}T00:00:00`).getTime()
      : Number.NEGATIVE_INFINITY;
    const customEndMs = customEnd
      ? new Date(`${customEnd}T23:59:59.999`).getTime()
      : Number.POSITIVE_INFINITY;

    return activities.filter((activity) => {
      const timestamp = activityTimestampMs(activity.startTime);
      if (!timestamp) {
        return false;
      }
      if (period === "year") {
        return timestamp >= yearStart;
      }
      if (period === "90-days") {
        return timestamp >= ninetyDaysAgo;
      }
      return timestamp >= customStartMs && timestamp <= customEndMs;
    });
  }, [activities, period, customStart, customEnd]);

  const activitiesRef = useRef(filteredActivities);
  activitiesRef.current = filteredActivities;

  const activityKey = useMemo(
    () =>
      filteredActivities
        .map((activity) => activity.activityId)
        .join("|"),
    [filteredActivities],
  );

  const [visits, setVisits] = useState<ActivityVisitPoint[]>(() =>
    getCachedVisitPoints(filteredActivities),
  );
  const [routes, setRoutes] = useState<ActivityRoutePolyline[]>(() =>
    getCachedRoutePolylines(filteredActivities),
  );
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [canResetView, setCanResetView] = useState(false);
  // One place pointed at, from either side: a row in the list lights its pin,
  // and a pin under the pointer lights its row.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // The activity row pointed at in an open place: its route comes forward on
  // the street map.
  const [hoveredActivityId, setHoveredActivityId] = useState<string | null>(
    null,
  );
  const [streetFocus, setStreetFocus] = useState<StreetMapFocus | null>(null);
  const [zoomingToStreet, setZoomingToStreet] = useState(false);
  const streetMode = streetFocus !== null;

  const routePoints = useMemo(() => {
    return samplePoints(extractTrackPoints(detail));
  }, [detail]);

  // Prefer cached visit routes + latest featured track for the street map.
  const streetRoutes = useMemo(() => {
    let merged = routes;
    if (detail?.activityId && routePoints.length >= 2) {
      merged = mergeRoutes(merged, {
        activityId: detail.activityId,
        points: routePoints,
      });
    }
    return merged;
  }, [routes, detail?.activityId, routePoints]);

  const places = useMemo(
    () =>
      regionIndex
        ? buildPlaceSummaries(filteredActivities, visits, regionIndex.regionOf)
        : [],
    [filteredActivities, regionIndex, visits],
  );
  const sortedPlaces = useMemo(
    () => sortPlaces(places, placeSort),
    [places, placeSort],
  );

  const selectedPlace = useMemo(
    () => places.find((place) => place.key === selectedLocationKey) ?? null,
    [places, selectedLocationKey],
  );
  const globeLocations = useMemo(
    () => places.map((place) => place.cluster),
    [places],
  );
  // Names for the places pinned on the globe. Only the geocoder's go in, so a
  // place it has not named yet stays a dot rather than a province's name that
  // a town's will replace — except the selected one and the one pointed at,
  // which always say something.
  const globeLabels = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const place of places) {
      if (
        placeLabels[placeLabelKey(place.cluster)] ||
        place.key === selectedLocationKey ||
        place.key === hoveredKey
      ) {
        entries[place.key] = placeLabelFor(place.cluster, placeLabels).city;
      }
    }
    return entries;
  }, [hoveredKey, places, placeLabels, selectedLocationKey]);

  // A place that is no longer on the map is let go — but not while the map is
  // still empty, which is every mount before the visits are read back.
  useEffect(() => {
    if (
      selectedLocationKey &&
      places.length > 0 &&
      !places.some((place) => place.key === selectedLocationKey)
    ) {
      setSelectedLocationKey(null);
    }
  }, [places, selectedLocationKey]);

  // Names are fetched for the places whose names are on the screen: the list's
  // rows as far as it has been scrolled, in the order it is sorted, and the
  // places the line under the title names. A list can hold hundreds, and the
  // geocoder is throttled, so naming them all up front would put the rows the
  // athlete is looking at behind ones they may never scroll to.
  useEffect(() => {
    let cancelled = false;
    const wanted: PlaceSummary[] = [];
    const seen = new Set<string>();
    const want = (place: PlaceSummary | null | undefined) => {
      if (!place || seen.has(place.key)) {
        return;
      }
      seen.add(place.key);
      wanted.push(place);
    };
    want(selectedPlace);
    want(homePlace(places));
    want(farthestFromHome(places)?.place);
    for (const place of sortedPlaces.slice(0, labelReach)) {
      want(place);
    }
    for (const place of wanted) {
      const key = placeLabelKey(place.cluster);
      void loadPlaceLabel(key, place.cluster).then((label) => {
        // Only a name: a coordinate fallback would hide the region's name.
        if (cancelled || label.full === coordinateLabel(place.cluster).full) {
          return;
        }
        setPlaceLabels((current) =>
          current[key]?.full === label.full
            ? current
            : { ...current, [key]: label },
        );
      });
    }
    return () => {
      cancelled = true;
    };
  }, [labelReach, places, selectedPlace, sortedPlaces]);

  // A street map scheduled to open once the globe has flown in.
  const cancelStreetEnter = useCallback(() => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
  }, []);

  // A new period is a new map: whatever was open belongs to the old one. The
  // first run is the mount, which must keep a place remembered from before.
  const periodKey = `${period}|${customStart}|${customEnd}`;
  const periodKeyRef = useRef(periodKey);
  useEffect(() => {
    if (periodKeyRef.current === periodKey) {
      return;
    }
    periodKeyRef.current = periodKey;
    cancelStreetEnter();
    setSelectedLocationKey(null);
    setStreetFocus(null);
    setZoomingToStreet(false);
    setCanResetView(false);
    setLabelReach(LABEL_BATCH);
  }, [periodKey]);

  // Stable, like `selectLocation`, so the memoised globe is not drawn again
  // whenever something beside it changes.
  const enterStreetFocus = useCallback(
    (focus: StreetMapFocus) => {
      cancelStreetEnter();
      setZoomingToStreet(false);
      setStreetFocus(focus);
      setCanResetView(true);
      setHoveredKey(null);
    },
    [cancelStreetEnter],
  );

  const scheduleStreetFocus = (focus: StreetMapFocus, delayMs: number) => {
    cancelStreetEnter();
    streetEnterTimerRef.current = window.setTimeout(() => {
      streetEnterTimerRef.current = null;
      enterStreetFocus(focus);
    }, delayMs);
  };

  // Picking a place, on the globe or in the list, flies the globe to it and
  // opens it beside the map. The street map is a step further, taken from
  // there: it used to open on its own the moment a pin was clicked.
  const selectLocation = useCallback(
    (location: GlobePlace) => {
      cancelStreetEnter();
      setZoomingToStreet(false);
      setStreetFocus(null);
      // The row that was clicked unmounts under the pointer, so it never hears
      // the pointer leave.
      setHoveredKey(null);
      const place = places.find((candidate) => candidate.key === location.key);
      setSelectedLocationKey(location.key);
      const latestActivity = place?.activities[0];
      if (latestActivity) {
        onSelectActivity(latestActivity);
      }
    },
    [cancelStreetEnter, onSelectActivity, places, setSelectedLocationKey],
  );

  const zoomIntoSelectedLocation = () => {
    if (!selectedPlace || zoomingToStreet) {
      return;
    }
    const focus = {
      lat: selectedPlace.cluster.lat,
      lon: selectedPlace.cluster.lon,
      activityIds: selectedPlace.cluster.activityIds,
    };
    const duration =
      globeRendererRef.current?.zoomToLocation(
        focus,
        LOCATION_ZOOM_DURATION_MS,
      ) ?? 0;
    if (duration === 0) {
      enterStreetFocus(focus);
      return;
    }
    setZoomingToStreet(true);
    scheduleStreetFocus(focus, duration);
  };

  const restoreBaselineCamera = () => {
    cancelStreetEnter();
    setZoomingToStreet(false);
    globeRendererRef.current?.resetView(900);
    setCanResetView(false);
  };

  const exitStreetMode = () => {
    setStreetFocus(null);
    restoreBaselineCamera();
  };

  // Letting the place go is enough: the globe flies back to every place on
  // its own when nothing is picked.
  const showAllPlaces = () => {
    cancelStreetEnter();
    setZoomingToStreet(false);
    setStreetFocus(null);
    setHoveredActivityId(null);
    setSelectedLocationKey(null);
  };

  // The mouse's back button steps back one layer, as it does from a run's
  // page: out of the street map to the globe, then from a place to the list.
  useBackGesture(() => {
    if (streetFocus) {
      exitStreetMode();
    } else if (selectedLocationKey) {
      showAllPlaces();
    }
  });

  useEffect(() => cancelStreetEnter, [cancelStreetEnter]);

  // Seed / refresh latest activity geo into the visit + route caches.
  useEffect(() => {
    if (!detail?.activityId) {
      return;
    }

    const { start, route } = rememberActivityGeo(detail.activityId, detail);
    if (start) {
      setVisits((current) =>
        mergeVisits(current, {
          activityId: detail.activityId!,
          ...start,
        }),
      );
    }
    if (route && route.length >= 2) {
      setRoutes((current) =>
        mergeRoutes(current, {
          activityId: detail.activityId!,
          points: route,
        }),
      );
    }
  }, [detail]);

  // Background-load visit centroids + route polylines for recent activities.
  useEffect(() => {
    const api = window.heraclesRecords;
    const list = activitiesRef.current;
    if (!api || !connected || list.length === 0) {
      setVisits(getCachedVisitPoints(list));
      setRoutes(getCachedRoutePolylines(list));
      return;
    }

    const controller = new AbortController();
    const pendingVisits: ActivityVisitPoint[] = [];
    const pendingRoutes: ActivityRoutePolyline[] = [];
    let flushTimer: number | null = null;
    const flushUpdates = () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (controller.signal.aborted) {
        pendingVisits.length = 0;
        pendingRoutes.length = 0;
        return;
      }
      const visitBatch = pendingVisits.splice(0);
      const routeBatch = pendingRoutes.splice(0);
      if (visitBatch.length > 0) {
        setVisits((current) => mergeVisitBatch(current, visitBatch));
      }
      if (routeBatch.length > 0) {
        setRoutes((current) => mergeRouteBatch(current, routeBatch));
      }
    };
    const scheduleFlush = () => {
      if (flushTimer === null) {
        flushTimer = window.setTimeout(flushUpdates, 80);
      }
    };
    setVisits(getCachedVisitPoints(list));
    setRoutes(getCachedRoutePolylines(list));
    setVisitsLoading(true);

    void loadActivityVisits(
      list,
      (activityId, sportType, listActivity) =>
        api.getTrainingHubActivityDetail(activityId, sportType, listActivity),
      {
        limit: list.length,
        signal: controller.signal,
        onVisit: (visit) => {
          if (controller.signal.aborted) {
            return;
          }
          pendingVisits.push(visit);
          scheduleFlush();
        },
        onRoute: (route) => {
          if (controller.signal.aborted) {
            return;
          }
          pendingRoutes.push(route);
          scheduleFlush();
        },
      },
    ).finally(() => {
      if (!controller.signal.aborted) {
        flushUpdates();
        setVisitsLoading(false);
      }
    });

    return () => {
      controller.abort();
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
    };
  }, [activityKey, connected]);

  const handleResetView = () => {
    if (streetFocus) {
      exitStreetMode();
      return;
    }
    restoreBaselineCamera();
  };

  const mapHasRoute = routePoints.length > 0;
  const mapHasVisits = visits.length > 0;
  const mapLoading = (visitsLoading && !mapHasVisits) || (mapHasVisits && !regionIndex);
  const summary = mapLoading
    ? "Mapping your GPS activities…"
    : filteredActivities.length === 0
      ? connected
        ? "No activities in this period."
        : "Training Hub is offline."
      : places.length === 0
        ? "No activities with GPS in this period."
        : placesSummaryLine({ places, labels: placeLabels, allTime: period === "all" });

  return (
    <section className="training-map" aria-labelledby="training-map-title">
      <header className="training-map-page-header">
        <div>
          <h1 id="training-map-title">Where you’ve been</h1>
          <p>{summary}</p>
        </div>
        <div className="training-map-period-wrap">
          {/* Folded: four options with labels this long were the widest
              thing in the header, and the period is chosen once and then
              looked at. "Custom" keeps its icon — it is the one option that
              opens something rather than answering. */}
          <OptionGroup
            label="Training period"
            mode="collapsible"
            className="training-map-periods"
            value={period}
            options={[
              { value: "all", label: "All time" },
              { value: "year", label: "This year" },
              { value: "90-days", label: periodLabel(90) },
              {
                value: "custom",
                label: "Custom",
                icon: <CalendarDays size={14} aria-hidden="true" />
              }
            ]}
            onChange={(next) =>
              setPeriodPreference((current) => ({
                ...current,
                period: next as ActivityPeriod
              }))
            }
          />
          {period === "custom" ? (
            <div className="training-map-date-range">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={customStart}
                  max={customEnd || undefined}
                  onChange={(event) =>
                    setPeriodPreference((current) => ({
                      ...current,
                      customStart: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart || undefined}
                  onChange={(event) =>
                    setPeriodPreference((current) => ({
                      ...current,
                      customEnd: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          ) : null}
        </div>
      </header>

      <div className="training-map-stage">
        <section
          className={`training-map-globe-panel${streetMode ? " is-street-mode" : ""}`}
          aria-label="Interactive training globe"
        >
          <div
            className={`training-map-globe-stage${hoveredKey ? " is-hovering-cluster" : ""}`}
            role="img"
            aria-label={
              streetMode
                ? "Street map of your routes near the selected location. Zoom out or go back to return to the globe."
                : mapHasVisits
                  ? `Interactive globe showing ${places.length} training locations. Drag to rotate, scroll to zoom, and select a location for details.`
                  : mapHasRoute
                    ? "Interactive globe showing the latest GPS route."
                    : "Interactive globe waiting for GPS activity data."
            }
          >
            <ActivityGlobeRenderer
              ref={globeRendererRef}
              frameKey={activityKey}
              locations={globeLocations}
              routePoints={routePoints}
              selectedLocation={selectedPlace?.cluster ?? null}
              hoveredKey={hoveredKey}
              labels={globeLabels}
              streetMode={streetMode}
              onError={setGlobeError}
              onHoverChange={setHoveredKey}
              onRequestStreet={enterStreetFocus}
              onSelectLocation={selectLocation}
              onViewChange={setCanResetView}
            />
            {streetFocus ? (
              <ActivityGlobeStreetMap
                focus={streetFocus}
                visits={visits}
                routes={streetRoutes}
                highlightActivityId={hoveredActivityId}
                onRequestExit={exitStreetMode}
              />
            ) : null}
            {globeError ? (
              <div className="training-map-globe-error" role="status">
                <CircleAlert size={20} aria-hidden="true" />
                <span>The globe could not be rendered on this device.</span>
              </div>
            ) : null}
          </div>

          {streetMode ? (
            <button
              type="button"
              className="training-map-globe-back"
              onClick={exitStreetMode}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Back to globe
            </button>
          ) : globeError ? null : (
            <div className="training-map-zoom" role="group" aria-label="Globe view">
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => globeRendererRef.current?.zoomBy(ZOOM_STEP)}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => globeRendererRef.current?.zoomBy(1 / ZOOM_STEP)}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              {canResetView ? (
                <button
                  type="button"
                  className="training-map-zoom-reset"
                  aria-label="Reset view"
                  title="Reset view"
                  onClick={handleResetView}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )}

          {!streetMode && (mapHasVisits || mapHasRoute) ? (
            <div className="training-map-legend" aria-label="Visits, from fewer to more">
              <span>Fewer</span>
              <i className="is-low" aria-hidden="true" />
              <i className="is-medium" aria-hidden="true" />
              <i className="is-high" aria-hidden="true" />
              <span>More visits</span>
            </div>
          ) : null}
        </section>

        <aside className="training-map-side panel" aria-label="Places">
          {selectedPlace ? (
            <PlaceDetail
              key={selectedPlace.key}
              place={selectedPlace}
              label={placeLabelFor(selectedPlace.cluster, placeLabels)}
              zooming={zoomingToStreet}
              streetMode={streetMode}
              onBack={showAllPlaces}
              onStreetView={zoomIntoSelectedLocation}
              onOpenActivity={onOpenActivity}
              onHoverActivity={setHoveredActivityId}
            />
          ) : mapLoading ? (
            <div className="training-map-side-loading" role="status" aria-label="Mapping GPS activities">
              <span />
              <span />
              <span />
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="training-map-side-empty">
              <MapPin size={22} aria-hidden="true" />
              <h2>{connected ? "No activities in this period" : "Training Hub is offline"}</h2>
              <p>
                {connected
                  ? "Choose another period when more activity history is available."
                  : "Connect Training Hub to map your routes and training history."}
              </p>
            </div>
          ) : places.length === 0 ? (
            <div className="training-map-side-empty">
              <Route size={22} aria-hidden="true" />
              <h2>No GPS routes found</h2>
              <p>Outdoor activities with location data will appear here.</p>
            </div>
          ) : (
            <>
              <PlaceList
                places={sortedPlaces}
                labels={placeLabels}
                sort={placeSort}
                hoveredKey={hoveredKey}
                onHover={setHoveredKey}
                onSortChange={setPlaceSort}
                onSelect={(place) => selectLocation(place.cluster)}
                onScrolledTo={(rows) =>
                  // Whole batches, half a batch ahead of the rows in view.
                  setLabelReach((reach) =>
                    Math.max(
                      reach,
                      Math.ceil((rows + LABEL_BATCH / 2) / LABEL_BATCH) * LABEL_BATCH,
                    ),
                  )
                }
              />
              {labour ? (
                <PlaceLabourCard labour={labour} onOpen={onOpenLabours} />
              ) : null}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
