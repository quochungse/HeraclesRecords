import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, MapPin, Maximize2, X } from "lucide-react";
import type { TrainingHubActivityTrack } from "../../../electron/types";
import {
  BASE_LAYERS,
  TRAIL_OVERLAY_LAYERS,
  type BaseLayerConfig,
  type BaseLayerId,
  type TrailOverlayId
} from "../../mapBase/constants";
import { createBaseLayer } from "../../mapBase/baseLayers";
import { MapLayerControl } from "../../mapBase/MapLayerControl";
import { useTheme } from "../../theme/ThemeProvider";
import {
  defineSelectionPreference,
  selectionIsArrayOf,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";

interface ActivityRouteMapProps {
  track?: TrainingHubActivityTrack;
}

interface RouteGeometry {
  latLngs: [number, number][];
}

const ROUTE_COLOR = "#74c08f";
const ROUTE_COLOR_PAPER = "#0f7f5f";
const START_COLOR = "#4da3ff";
const END_COLOR = "#d89b22";
const ROUTE_ANIMATION_MS = 2200;

const ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE =
  defineSelectionPreference<BaseLayerId>({
    key: "training.activityRoute.baseLayer",
    defaultValue: "outdoors",
    validate: selectionIsOneOf([
      "street",
      "outdoors",
      "light",
      "dark",
      "topo",
      "satellite"
    ])
  });

const ACTIVITY_ROUTE_OVERLAYS_PREFERENCE =
  defineSelectionPreference<TrailOverlayId[]>({
    key: "training.activityRoute.overlays",
    defaultValue: [],
    validate: selectionIsArrayOf(
      selectionIsOneOf(["hiking", "cycling", "mtb"]),
      { unique: true }
    )
  });

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function getPartialRoute(
  latLngs: [number, number][],
  progress: number
): [number, number][] {
  if (latLngs.length === 0) {
    return [];
  }

  if (progress <= 0) {
    return [latLngs[0]!];
  }

  if (progress >= 1) {
    return latLngs;
  }

  let totalDistance = 0;
  const cumulativeDistances = [0];

  for (let index = 1; index < latLngs.length; index += 1) {
    totalDistance += L.latLng(latLngs[index - 1]!).distanceTo(
      L.latLng(latLngs[index]!)
    );
    cumulativeDistances.push(totalDistance);
  }

  if (totalDistance === 0) {
    return latLngs;
  }

  const targetDistance = totalDistance * progress;
  const partialRoute: [number, number][] = [latLngs[0]!];

  for (let index = 1; index < latLngs.length; index += 1) {
    const segmentEnd = cumulativeDistances[index]!;

    if (segmentEnd <= targetDistance) {
      partialRoute.push(latLngs[index]!);
      continue;
    }

    const segmentStart = cumulativeDistances[index - 1]!;
    const segmentLength = segmentEnd - segmentStart;
    const segmentProgress =
      segmentLength > 0 ? (targetDistance - segmentStart) / segmentLength : 1;
    const from = latLngs[index - 1]!;
    const to = latLngs[index]!;

    partialRoute.push([
      from[0] + (to[0] - from[0]) * segmentProgress,
      from[1] + (to[1] - from[1]) * segmentProgress
    ]);
    break;
  }

  return partialRoute;
}

function buildRouteGeometry(
  points: TrainingHubActivityTrack["points"]
): RouteGeometry | null {
  const routePoints = points.filter(
    (point) => point.lat !== undefined && point.lon !== undefined
  );

  if (routePoints.length < 2) {
    return null;
  }

  // No bounds here: the map fits `L.latLngBounds(latLngs)`, and the
  // `Math.min(...lats)` this used to carry was both unread and the one spread
  // over a whole track in this file — past the argument limit on an ultra.
  return {
    latLngs: routePoints.map((point) => [point.lat!, point.lon!])
  };
}

interface MapStyle {
  tile: BaseLayerConfig;
  routeColor: string;
  ghostOpacity: number;
}

/** The theme-matched layer used when no explicit layer is chosen. */
function themeBaseLayer(theme: string): BaseLayerId {
  return theme === "paper" ? "light" : "dark";
}

function resolveMapStyle(theme: string, baseLayer?: BaseLayerId): MapStyle {
  const layer = baseLayer ?? themeBaseLayer(theme);
  const isDarkGround = layer === "dark" || layer === "satellite";
  return {
    tile: BASE_LAYERS[layer],
    routeColor: isDarkGround ? ROUTE_COLOR : ROUTE_COLOR_PAPER,
    ghostOpacity: isDarkGround ? 0.18 : 0.28
  };
}

function RouteMapCanvas({
  route,
  scrollWheelZoom = false,
  interactive = true,
  visibleBand,
  baseLayer,
  overlays,
  ariaLabel
}: {
  route: RouteGeometry;
  scrollWheelZoom?: boolean;
  /**
   * False for a map that is only a picture: no panning, zooming or controls,
   * and the route is fitted again whenever the box changes size, since nobody
   * can move it back into view by hand.
   */
  interactive?: boolean;
  /**
   * Height of the band left showing at the top, as a fraction of the map's
   * **width**; everything below it has something drawn over it, and the route
   * is fitted into the band. Taken from the width because a cover grows taller
   * with what is laid over it while the part left clear stays put.
   */
  visibleBand?: number;
  baseLayer?: BaseLayerId;
  overlays?: TrailOverlayId[];
  ariaLabel: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.Layer | null>(null);
  const ghostLineRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const overlayLayersRef = useRef(new Map<TrailOverlayId, L.TileLayer>());
  // Read by the init effect without retriggering it: layer switches swap
  // tiles in place instead of rebuilding the map.
  const baseLayerPropRef = useRef(baseLayer);
  const appliedBaseLayerRef = useRef(baseLayer);
  const { theme } = useTheme();

  baseLayerPropRef.current = baseLayer;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !route) {
      return;
    }

    const initialLayer = baseLayerPropRef.current;
    const { tile, routeColor, ghostOpacity } = resolveMapStyle(
      theme,
      initialLayer
    );

    const map = L.map(container, {
      zoomControl: interactive,
      // A picture still credits its tiles. The corner is moved up for it,
      // because the bottom of a cover is under whatever is drawn over it.
      attributionControl: interactive,
      scrollWheelZoom: interactive && scrollWheelZoom,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive
    });
    // No "Leaflet" prefix: that link is a courtesy, not a licence term. The
    // tile credits after it are required and stay.
    if (interactive) {
      map.attributionControl.setPrefix(false);
    } else {
      L.control.attribution({ position: "topright", prefix: false }).addTo(map);
    }

    const tileLayer = createBaseLayer(map, tile).addTo(map);

    const ghostLine = L.polyline(route.latLngs, {
      color: routeColor,
      weight: 4,
      opacity: ghostOpacity,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    const routeLine = L.polyline([route.latLngs[0]!], {
      color: routeColor,
      weight: 4,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    const start = route.latLngs[0]!;
    const end = route.latLngs[route.latLngs.length - 1]!;

    L.circleMarker(start, {
      radius: 6,
      color: START_COLOR,
      fillColor: START_COLOR,
      fillOpacity: 1,
      weight: 2
    }).addTo(map);

    const fitRoute = () => {
      const band =
        visibleBand === undefined
          ? container.clientHeight
          : Math.max(96, Math.round(container.clientWidth * visibleBand));
      const covered = Math.max(0, container.clientHeight - band);
      map.fitBounds(L.latLngBounds(route.latLngs), {
        paddingTopLeft: [24, 24],
        paddingBottomRight: [24, 24 + covered]
      });
    };
    fitRoute();
    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    ghostLineRef.current = ghostLine;
    routeLineRef.current = routeLine;
    appliedBaseLayerRef.current = initialLayer;

    let animationFrame = 0;
    let animationStart: number | undefined;
    let endMarker: L.CircleMarker | undefined;

    const animateRoute = (timestamp: number) => {
      if (animationStart === undefined) {
        animationStart = timestamp;
      }

      const elapsed = timestamp - animationStart;
      const progress = Math.min(elapsed / ROUTE_ANIMATION_MS, 1);
      routeLine.setLatLngs(
        getPartialRoute(route.latLngs, easeOutCubic(progress))
      );

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(animateRoute);
        return;
      }

      if (!endMarker) {
        endMarker = L.circleMarker(end, {
          radius: 6,
          color: END_COLOR,
          fillColor: END_COLOR,
          fillOpacity: 1,
          weight: 2
        }).addTo(map);
      }
    };

    animationFrame = window.requestAnimationFrame(animateRoute);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      if (!interactive) {
        fitRoute();
      }
    });
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      ghostLineRef.current = null;
      routeLineRef.current = null;
      overlayLayersRef.current.clear();
    };
  }, [route, theme, scrollWheelZoom, interactive, visibleBand]);

  // Swap the base tile layer in place so zoom/pan and the route animation
  // survive a layer change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseLayer || appliedBaseLayerRef.current === baseLayer) {
      return;
    }

    const { tile, routeColor, ghostOpacity } = resolveMapStyle(
      theme,
      baseLayer
    );
    // The base map has its own pane below every other layer, so the new one
    // cannot cover the route however late it is added, and `createBaseLayer`
    // rebinds the map's max zoom to the style it just built.
    const next = createBaseLayer(map, tile).addTo(map);
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = next;
    ghostLineRef.current?.setStyle({ color: routeColor, opacity: ghostOpacity });
    routeLineRef.current?.setStyle({ color: routeColor });
    appliedBaseLayerRef.current = baseLayer;
  }, [baseLayer, theme]);

  // Sync Waymarked Trails overlays with the selection. The dependency list
  // carries every one of the init effect's, because that effect's cleanup
  // empties `overlayLayersRef`: a rebuild this one did not follow would leave
  // the overlays gone with nothing to put them back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const wanted = overlays ?? [];
    const active = overlayLayersRef.current;

    for (const [id, layer] of active) {
      if (!wanted.includes(id)) {
        map.removeLayer(layer);
        active.delete(id);
      }
    }

    for (const id of wanted) {
      if (active.has(id)) {
        continue;
      }
      const config = TRAIL_OVERLAY_LAYERS[id];
      const layer = L.tileLayer(config.url, {
        // `maxZoom` is the base map's to set, not an overlay's: an overlay
        // that ran out of tiles used to drag the whole map's zoom limit down
        // with it. `maxNativeZoom` stretches its last real tile instead.
        maxNativeZoom: config.maxZoom,
        attribution: config.attribution,
        opacity: 0.85
      });
      layer.addTo(map);
      active.set(id, layer);
    }
  }, [overlays, route, theme, scrollWheelZoom, interactive, visibleBand]);

  return (
    <div
      ref={mapContainerRef}
      className="activity-route-map-canvas"
      aria-label={ariaLabel}
    />
  );
}

function RouteLegend() {
  return (
    <span className="activity-route-legend">
      <span className="activity-route-dot is-start" aria-hidden="true" />
      Start
      <span className="activity-route-dot is-end" aria-hidden="true" />
      Finish
    </span>
  );
}

/**
 * How long the tile credit stays spelled out before folding into its (i)
 * button. The OSM Foundation's attribution guidelines allow a credit to
 * collapse after five seconds provided it can still be found from an (i) in
 * the corner — which is what this does. It cannot be left out altogether:
 * OpenStreetMap, OpenMapTiles and OpenFreeMap all require it.
 */
const CREDIT_VISIBLE_MS = 5000;

/** Credit shown for five seconds from `key` changing, then toggled by an (i). */
function useFoldingCredit(key: unknown): [boolean, () => void] {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(true);
    const timer = window.setTimeout(() => setOpen(false), CREDIT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [key]);

  const toggle = useCallback(() => setOpen((current) => !current), []);
  return [open, toggle];
}

function CreditButton({
  open,
  onToggle,
  className
}: {
  open: boolean;
  onToggle: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label="Map data credits"
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Info size={13} aria-hidden="true" />
    </button>
  );
}

/**
 * The route on the whole window, with the layer picker. One component for
 * every way in — the Expand link under the side-panel map and a route cover —
 * so the two cannot drift apart.
 */
function RouteMapModal({
  route,
  onClose
}: {
  route: RouteGeometry;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const [baseLayer, setBaseLayer] = useSelectionPreference(
    ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE,
    themeBaseLayer(theme)
  );
  const [overlays, setOverlays] = useSelectionPreference(
    ACTIVITY_ROUTE_OVERLAYS_PREFERENCE
  );
  const [creditOpen, toggleCredit] = useFoldingCredit(route);

  useEffect(() => {
    // Captured on the window and stopped there: the screen underneath may
    // answer Escape itself — a run's page goes back to the list on it — and one
    // key press should close one thing.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="activity-route-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-route-modal-title"
      onClick={onClose}
    >
      <section
        className="panel activity-route-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="activity-route-modal-header">
          <div className="activity-route-modal-title">
            <MapPin size={16} aria-hidden="true" />
            <h2 id="activity-route-modal-title">Route</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close expanded map"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="activity-route-modal-body">
          <div
            className={`activity-route-modal-map${creditOpen ? " is-credit-open" : ""}`}
          >
            <RouteMapCanvas
              route={route}
              scrollWheelZoom
              baseLayer={baseLayer}
              overlays={overlays}
              ariaLabel="Expanded activity route map"
            />
            <MapLayerControl
              value={baseLayer}
              onChange={setBaseLayer}
              overlays={overlays}
              onToggleOverlay={(id) =>
                setOverlays((prev) =>
                  prev.includes(id)
                    ? prev.filter((overlay) => overlay !== id)
                    : [...prev, id]
                )
              }
            />
            <CreditButton
              open={creditOpen}
              onToggle={toggleCredit}
              className="activity-route-credit-toggle"
            />
          </div>
          <div className="activity-route-footer">
            <RouteLegend />
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

/**
 * Whether a track has enough located points to draw a route at all — the same
 * test `buildRouteGeometry` applies, without building the geometry the cover
 * is about to build anyway.
 */
export function hasActivityRoute(track?: TrainingHubActivityTrack): boolean {
  let located = 0;
  for (const point of track?.points ?? []) {
    if (point.lat !== undefined && point.lon !== undefined && ++located >= 2) {
      return true;
    }
  }
  return false;
}

export function ActivityRouteMap({ track }: ActivityRouteMapProps) {
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const route = useMemo(
    () => (track?.points ? buildRouteGeometry(track.points) : null),
    [track]
  );

  if (!route) {
    return (
      <div className="activity-route-empty">
        <MapPin size={18} aria-hidden="true" />
        <p>No GPS track available for this activity.</p>
      </div>
    );
  }

  return (
    <div className="activity-route-map">
      <RouteMapCanvas route={route} ariaLabel="Activity route map" />
      <div className="activity-route-footer">
        <RouteLegend />
        <button
          type="button"
          className="activity-route-expand"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={13} aria-hidden="true" />
          Expand
        </button>
      </div>
      {expanded ? <RouteMapModal route={route} onClose={closeExpanded} /> : null}
    </div>
  );
}

interface ActivityRouteCoverProps {
  track?: TrainingHubActivityTrack;
  className?: string;
  /** See `RouteMapCanvas`: the band at the top the page leaves clear. */
  visibleBand?: number;
}

/**
 * The route as a picture behind a page's heading: nothing to drag or zoom, and
 * a click anywhere on it opens the full map. Renders nothing without a route —
 * the caller decides what the heading looks like then.
 */
export function ActivityRouteCover({
  track,
  className,
  visibleBand
}: ActivityRouteCoverProps) {
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const route = useMemo(
    () => (track?.points ? buildRouteGeometry(track.points) : null),
    [track]
  );

  const [creditOpen, toggleCredit] = useFoldingCredit(route);

  if (!route) {
    return null;
  }

  return (
    <>
      {/* The map itself is decorative; the button is the way in for a
          keyboard, and the whole picture is the way in for a pointer. */}
      <div
        className={`activity-route-cover${creditOpen ? " is-credit-open" : ""}${
          className ? ` ${className}` : ""
        }`}
        onClick={() => setExpanded(true)}
      >
        <div className="activity-route-cover-map" aria-hidden="true">
          <RouteMapCanvas
            route={route}
            interactive={false}
            visibleBand={visibleBand}
            ariaLabel="Route"
          />
        </div>
        <button
          type="button"
          className="activity-route-cover-open"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(true);
          }}
        >
          <Maximize2 size={13} aria-hidden="true" />
          Full map
        </button>
        <CreditButton
          open={creditOpen}
          onToggle={toggleCredit}
          className="activity-route-cover-credit"
        />
      </div>
      {/* A sibling, not a child: a portal still bubbles React events through
          its parent, and a backdrop click that closed the map would reach the
          cover's own click and open it again. */}
      {expanded ? <RouteMapModal route={route} onClose={closeExpanded} /> : null}
    </>
  );
}
