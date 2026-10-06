import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { BASE_LAYERS, isLightBaseLayer } from "../mapBase/constants";
import { createBaseLayer } from "../mapBase/baseLayers";
import {
  defineBaseLayerPreference,
  useBaseLayerPreference,
} from "../mapBase/baseLayerPreference";
import { MapCreditButton, useFoldingCredit } from "../mapBase/MapCredit";
import { MapLayerControl } from "../mapBase/MapLayerControl";
import type {
  ActivityRoutePolyline,
  ActivityVisitPoint,
  GlobePoint,
} from "./activityVisitHeatmap";

export interface StreetMapFocus {
  lat: number;
  lon: number;
  /**
   * Open on this very point rather than framing the routes near it: zooming in
   * where no place of the athlete's is, the map opens where they pointed.
   */
  exact?: boolean;
  /**
   * The place it opens on, by its activities: the map frames their routes
   * rather than every route within `NEAR_FOCUS_DEG`, which pulled in the
   * places around it.
   */
  activityIds?: readonly string[];
}

interface ActivityGlobeStreetMapProps {
  focus: StreetMapFocus;
  visits: ActivityVisitPoint[];
  /** All GPS tracks available for the drilled region (latest + cached visits). */
  routes: ActivityRoutePolyline[];
  /** One activity's route to bring forward, the rest dimmed: the row pointed at beside the map. */
  highlightActivityId?: string | null;
  onRequestExit: () => void;
}

/** A route's points, and each line it is drawn with as it was first styled. */
type RouteLayers = Map<
  string,
  {
    latLngs: [number, number][];
    lines: Array<{ line: L.Polyline; style: RouteLineStyle }>;
  }
>;

interface RouteLineStyle {
  color: string;
  weight: number;
  opacity: number;
}

/**
 * Every route sits in one pane and the route pointed at is drawn again in a
 * pane above it. Dimming is the pane's opacity, not each line's: lines faded
 * one by one add up where they overlap, so a street run fifty times stood out
 * brighter than the route brought forward.
 */
const ROUTE_PANE = "heraclesRoutes";
const ROUTE_FOCUS_PANE = "heraclesRouteFocus";

/** While one route is brought forward the rest are a flat grey line, faded as a whole. */
const DIMMED_ROUTE = {
  dark: { color: "#9aa3ad", weight: 2, paneOpacity: 0.32 },
  light: { color: "#6b7280", weight: 2, paneOpacity: 0.3 },
} as const;

/** The street map never opens farther out than this. */
const MIN_OPEN_ZOOM = 9;
const EXIT_ZOOM = 8;
/** Prefer fitting polylines within this deg-ish window of focus. */
const NEAR_FOCUS_DEG = 1.2;
/** An exact focus opens a region around the point, close to the globe's last view. */
const EXACT_FOCUS_ZOOM = 10;

/** Neon cyan route stack — soft bloom under a bright core (Strava-style lines). */
const ROUTE_GLOW_DARK = {
  outer: { color: "#1a9e8f", weight: 16, opacity: 0.22 },
  mid: { color: "#2ec4b6", weight: 9, opacity: 0.38 },
  core: { color: "#6ef0e0", weight: 3.5, opacity: 0.96 },
} as const;

/** Slightly deeper teal so the glow still reads on light/street basemaps. */
const ROUTE_GLOW_LIGHT = {
  outer: { color: "#0b7a6e", weight: 14, opacity: 0.3 },
  mid: { color: "#14a898", weight: 8, opacity: 0.52 },
  core: { color: "#1fc4b4", weight: 3.25, opacity: 0.95 },
} as const;

const STREET_MAP_BASE_LAYER_PREFERENCE = defineBaseLayerPreference(
  "trainingMap.streetMap.baseLayer",
);

function nearFocus(point: GlobePoint, focus: StreetMapFocus): boolean {
  return Math.hypot(point.lat - focus.lat, point.lon - focus.lon) < NEAR_FOCUS_DEG;
}

function routeNearFocus(
  route: ActivityRoutePolyline,
  focus: StreetMapFocus,
): boolean {
  return route.points.some((point) => nearFocus(point, focus));
}

function addGlowingRoute(
  latLngs: [number, number][],
  lightBasemap: boolean,
  group: L.LayerGroup,
  pane: string,
): Array<{ line: L.Polyline; style: RouteLineStyle }> {
  const styles = lightBasemap ? ROUTE_GLOW_LIGHT : ROUTE_GLOW_DARK;
  return [styles.outer, styles.mid, styles.core].map((style) => ({
    line: L.polyline(latLngs, {
      pane,
      color: style.color,
      weight: style.weight,
      opacity: style.opacity,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(group),
    style,
  }));
}

function syncRouteGroup(
  group: L.LayerGroup,
  routes: ActivityRoutePolyline[],
  lightBasemap: boolean,
): RouteLayers {
  group.clearLayers();
  const layers: RouteLayers = new Map();
  for (const route of routes) {
    if (route.points.length < 2) {
      continue;
    }
    const latLngs = route.points.map(
      (point) => [point.lat, point.lon] as [number, number],
    );
    layers.set(route.activityId, {
      latLngs,
      lines: addGlowingRoute(latLngs, lightBasemap, group, ROUTE_PANE),
    });
  }
  return layers;
}

/**
 * Brings one route forward and greys the rest, or puts every route back as it
 * was drawn. The dimmed routes change style in place (redrawing a few hundred
 * glowing routes on every row the pointer crosses would be a frame each); only
 * the one brought forward is drawn again, above them.
 */
function applyRouteHighlight(
  map: L.Map,
  layers: RouteLayers,
  focusGroup: L.LayerGroup,
  activityId: string | null,
  lightBasemap: boolean,
): void {
  const focused = activityId !== null ? layers.get(activityId) : undefined;
  const dimmed = DIMMED_ROUTE[lightBasemap ? "light" : "dark"];
  for (const { lines } of layers.values()) {
    lines.forEach(({ line, style }, index) => {
      const isCore = index === lines.length - 1;
      line.setStyle(
        !focused
          ? style
          : isCore
            ? { color: dimmed.color, weight: dimmed.weight, opacity: 1 }
            : { opacity: 0 },
      );
    });
  }
  const pane = map.getPane(ROUTE_PANE);
  if (pane) {
    pane.style.opacity = focused ? String(dimmed.paneOpacity) : "";
  }
  focusGroup.clearLayers();
  if (focused) {
    addGlowingRoute(focused.latLngs, lightBasemap, focusGroup, ROUTE_FOCUS_PANE);
  }
}

function collectFitPoints(
  focus: StreetMapFocus,
  visits: ActivityVisitPoint[],
  routes: ActivityRoutePolyline[],
): GlobePoint[] {
  const nearbyRoutePoints = routes
    .filter((route) => routeNearFocus(route, focus))
    .flatMap((route) => route.points);

  if (nearbyRoutePoints.length >= 2) {
    return nearbyRoutePoints;
  }

  const allRoutePoints = routes.flatMap((route) => route.points);
  if (allRoutePoints.length >= 2) {
    const near = allRoutePoints.filter((point) => nearFocus(point, focus));
    if (near.length >= 2) {
      return near;
    }
  }

  const visitPoints =
    visits.length > 0
      ? visits
      : allRoutePoints.length > 0
        ? allRoutePoints.filter((_, index) => index % 8 === 0)
        : [focus];

  const nearby = visitPoints.filter((point) => nearFocus(point, focus));
  if (nearby.length > 0) {
    return nearby;
  }
  return visitPoints.length > 0 ? visitPoints : [focus];
}

export function ActivityGlobeStreetMap({
  focus,
  visits,
  routes,
  highlightActivityId = null,
  onRequestExit,
}: ActivityGlobeStreetMapProps) {
  const [baseLayer, setBaseLayer] = useBaseLayerPreference(
    STREET_MAP_BASE_LAYER_PREFERENCE,
  );
  const [creditOpen, toggleCredit] = useFoldingCredit();
  const containerRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onRequestExit);
  const routeGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayersRef = useRef<RouteLayers>(new Map());
  const routeFocusGroupRef = useRef<L.LayerGroup | null>(null);
  const highlightRef = useRef(highlightActivityId);
  highlightRef.current = highlightActivityId;
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.Layer | null>(null);
  const lightBasemapRef = useRef(false);
  // Read by the mount effect without retriggering it: a layer switch swaps the
  // base map in place so the view the athlete zoomed to survives it.
  const baseLayerRef = useRef(baseLayer);
  const appliedBaseLayerRef = useRef(baseLayer);
  onExitRef.current = onRequestExit;
  baseLayerRef.current = baseLayer;

  const applyHighlight = (activityId: string | null) => {
    const map = mapRef.current;
    const focusGroup = routeFocusGroupRef.current;
    if (map && focusGroup) {
      applyRouteHighlight(
        map,
        routeLayersRef.current,
        focusGroup,
        activityId,
        lightBasemapRef.current,
      );
    }
  };

  // Mount the map once per focus.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const layer = baseLayerRef.current;
    const lightBasemap = isLightBaseLayer(layer);
    lightBasemapRef.current = lightBasemap;
    appliedBaseLayerRef.current = layer;
    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
    });
    // No "Leaflet" prefix: that link is a courtesy, not a licence term. The
    // tile credits after it are required and stay.
    map.attributionControl.setPrefix(false);
    mapRef.current = map;

    tileLayerRef.current = createBaseLayer(map, BASE_LAYERS[layer]).addTo(map);

    map.createPane(ROUTE_PANE).style.zIndex = "400";
    map.createPane(ROUTE_FOCUS_PANE).style.zIndex = "410";
    const routeGroup = L.layerGroup().addTo(map);
    routeGroupRef.current = routeGroup;
    routeFocusGroupRef.current = L.layerGroup().addTo(map);
    routeLayersRef.current = syncRouteGroup(routeGroup, routes, lightBasemap);
    applyHighlight(highlightRef.current);

    const placeIds = new Set(focus.activityIds ?? []);
    const placeRoutePoints = routes
      .filter((route) => placeIds.has(route.activityId))
      .flatMap((route) => route.points);
    const fitPoints = focus.exact
      ? [focus]
      : placeRoutePoints.length >= 2
        ? placeRoutePoints
        : collectFitPoints(focus, visits, routes);

    if (fitPoints.length === 1) {
      map.setView(
        [focus.lat, focus.lon],
        focus.exact ? EXACT_FOCUS_ZOOM : 12,
        { animate: false },
      );
    } else {
      map.fitBounds(
        L.latLngBounds(fitPoints.map((point) => [point.lat, point.lon])),
        { padding: [36, 36], maxZoom: 14, animate: false },
      );
    }

    if (map.getZoom() < MIN_OPEN_ZOOM) {
      map.setZoom(MIN_OPEN_ZOOM, { animate: false });
    }

    const handleZoomEnd = () => {
      if (map.getZoom() <= EXIT_ZOOM) {
        onExitRef.current();
      }
    };
    map.on("zoomend", handleZoomEnd);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);
    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => {
      map.off("zoomend", handleZoomEnd);
      resizeObserver.disconnect();
      routeGroupRef.current = null;
      routeFocusGroupRef.current = null;
      routeLayersRef.current = new Map();
      tileLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // Intentionally omit visits/routes — updated via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.lat, focus.lon, focus.exact]);

  // Swap the base map in place, and recolour what is drawn over it for the new
  // ground — the glow is tuned per light or dark map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedBaseLayerRef.current === baseLayer) {
      return;
    }
    const next = createBaseLayer(map, BASE_LAYERS[baseLayer]).addTo(map);
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = next;
    appliedBaseLayerRef.current = baseLayer;

    const lightBasemap = isLightBaseLayer(baseLayer);
    if (lightBasemap !== lightBasemapRef.current) {
      lightBasemapRef.current = lightBasemap;
      if (routeGroupRef.current) {
        routeLayersRef.current = syncRouteGroup(
          routeGroupRef.current,
          routes,
          lightBasemap,
        );
        applyHighlight(highlightRef.current);
      }
    }
    // Routes are read, not watched — the effect below owns their changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayer]);

  useEffect(() => {
    const group = routeGroupRef.current;
    if (group) {
      routeLayersRef.current = syncRouteGroup(
        group,
        routes,
        lightBasemapRef.current,
      );
      applyHighlight(highlightRef.current);
    }
  }, [routes]);

  useEffect(() => {
    applyHighlight(highlightActivityId);
  }, [highlightActivityId]);

  return (
    <div
      className={`activity-globe-street-map map-frame${creditOpen ? " is-credit-open" : ""}`}
    >
      <div
        ref={containerRef}
        className="activity-globe-street-map-canvas"
        role="img"
        aria-label="Street map with activity routes. Zoom out or reset to return to the globe."
      />
      <MapLayerControl value={baseLayer} onChange={setBaseLayer} />
      <MapCreditButton open={creditOpen} onToggle={toggleCredit} />
    </div>
  );
}
