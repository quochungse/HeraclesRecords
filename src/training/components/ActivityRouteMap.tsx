import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Maximize2, RotateCcw, X } from "lucide-react";
import type { TrainingHubActivityTrack } from "../../../electron/types";
import {
  BASE_LAYERS,
  isLightBaseLayer,
  type BaseLayerConfig,
  type BaseLayerId
} from "../../mapBase/constants";
import { createBaseLayer } from "../../mapBase/baseLayers";
import {
  defineBaseLayerPreference,
  themeBaseLayer,
  useBaseLayerPreference
} from "../../mapBase/baseLayerPreference";
import { MapCreditButton, useFoldingCredit } from "../../mapBase/MapCredit";
import { MapLayerControl } from "../../mapBase/MapLayerControl";
import { useTheme } from "../../theme/ThemeProvider";
import {
  REPLAY_DELAY_MS,
  buildRouteReplay,
  replayDurationMs,
  replayPath,
  type RouteReplay
} from "./routeReplay";

interface ActivityRouteMapProps {
  track?: TrainingHubActivityTrack;
}

type RouteGeometry = RouteReplay;

const ROUTE_COLOR = "#74c08f";
const ROUTE_COLOR_PAPER = "#0f7f5f";
const START_COLOR = "#4da3ff";
const END_COLOR = "#d89b22";

/** Shared by the side-panel map and the full map, so a pick in one is the other's. */
const ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE = defineBaseLayerPreference(
  "training.activityRoute.baseLayer"
);

interface MapStyle {
  tile: BaseLayerConfig;
  routeColor: string;
  ghostOpacity: number;
}

function resolveMapStyle(theme: string, baseLayer?: BaseLayerId): MapStyle {
  const layer = baseLayer ?? themeBaseLayer(theme);
  const isDarkGround = !isLightBaseLayer(layer);
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
  animate = true,
  replayToken = 0,
  ariaLabel
}: {
  route: RouteGeometry;
  scrollWheelZoom?: boolean;
  /**
   * Replay the route when the map opens. False for a map that is only a quick
   * look (the side panel): the route is drawn whole, finish marker in place.
   */
  animate?: boolean;
  /** Raised to replay the route again, without rebuilding the map. */
  replayToken?: number;
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
  ariaLabel: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.Layer | null>(null);
  const ghostLineRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const replayRef = useRef<(() => void) | null>(null);
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

    const routeLine = L.polyline(animate ? [route.latLngs[0]!] : route.latLngs, {
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

    // The replay: a still half second when the map opens, then the line grows
    // at the pace the activity was done (sped up, linear, so a slow stretch
    // reads as slow) with the finish marker riding its head to the finish.
    const endMarker = L.circleMarker(animate ? start : end, {
      radius: 6,
      color: END_COLOR,
      fillColor: END_COLOR,
      fillOpacity: 1,
      weight: 2
    });
    if (!animate) {
      endMarker.addTo(map);
    }

    let animationFrame = 0;
    const replayMs = replayDurationMs(route.meters);

    const play = (delayMs: number) => {
      window.cancelAnimationFrame(animationFrame);
      routeLine.setLatLngs([start]);
      endMarker.remove();
      let animationStart: number | undefined;

      const animateRoute = (timestamp: number) => {
        animationStart ??= timestamp;
        const elapsed = timestamp - animationStart - delayMs;
        if (elapsed < 0) {
          animationFrame = window.requestAnimationFrame(animateRoute);
          return;
        }

        const progress = Math.min(elapsed / replayMs, 1);
        const path = replayPath(route, progress);
        routeLine.setLatLngs(path);
        endMarker.setLatLng(progress >= 1 ? end : path[path.length - 1]!);
        if (!map.hasLayer(endMarker)) {
          endMarker.addTo(map);
        }

        if (progress < 1) {
          animationFrame = window.requestAnimationFrame(animateRoute);
        }
      };
      animationFrame = window.requestAnimationFrame(animateRoute);
    };

    if (animate) {
      play(REPLAY_DELAY_MS);
      // A replay asked for starts at once: the eye is already on the map.
      replayRef.current = () => play(0);
    }

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      if (!interactive) {
        fitRoute();
      }
    });
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      replayRef.current = null;
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      ghostLineRef.current = null;
      routeLineRef.current = null;
    };
  }, [route, theme, scrollWheelZoom, interactive, visibleBand, animate]);

  useEffect(() => {
    if (replayToken > 0) {
      replayRef.current?.();
    }
  }, [replayToken]);

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

interface RouteMapLayers {
  baseLayer: BaseLayerId;
  setBaseLayer: (layer: BaseLayerId) => void;
}

/**
 * The layer choice, held by whatever owns both the small map and the full map
 * it opens, so a pick made in one shows in the other without a remount.
 */
function useRouteMapLayers(): RouteMapLayers {
  const [baseLayer, setBaseLayer] = useBaseLayerPreference(
    ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE
  );
  return { baseLayer, setBaseLayer };
}

/**
 * An interactive route map with its layer picker and folding tile credit — the
 * side-panel map and the full map alike.
 */
function RouteMapFrame({
  route,
  layers,
  className,
  scrollWheelZoom,
  animate,
  replayToken,
  ariaLabel,
  onReplay
}: {
  route: RouteGeometry;
  layers: RouteMapLayers;
  className: string;
  scrollWheelZoom?: boolean;
  animate?: boolean;
  replayToken?: number;
  ariaLabel: string;
  /** Present on a map that replays its route: a button under the layer picker. */
  onReplay?: () => void;
}) {
  const [creditOpen, toggleCredit] = useFoldingCredit();
  return (
    <div className={`${className} map-frame${creditOpen ? " is-credit-open" : ""}`}>
      <RouteMapCanvas
        route={route}
        scrollWheelZoom={scrollWheelZoom}
        animate={animate}
        replayToken={replayToken}
        baseLayer={layers.baseLayer}
        ariaLabel={ariaLabel}
      />
      <MapLayerControl value={layers.baseLayer} onChange={layers.setBaseLayer} />
      {onReplay ? (
        // The layer picker's own look: one kind of button in that corner.
        <button
          type="button"
          className="basemap-toggle map-replay"
          onClick={onReplay}
          title="Replay route"
          aria-label="Replay route"
        >
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      ) : null}
      <MapCreditButton open={creditOpen} onToggle={toggleCredit} />
    </div>
  );
}

/**
 * The route on the whole window, with the layer picker. One component for
 * every way in — the Expand link under the side-panel map and a route cover —
 * so the two cannot drift apart.
 */
function RouteMapModal({
  route,
  layers,
  onClose
}: {
  route: RouteGeometry;
  layers: RouteMapLayers;
  onClose: () => void;
}) {
  const [replayToken, setReplayToken] = useState(0);

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
          <RouteMapFrame
            route={route}
            layers={layers}
            className="activity-route-modal-map"
            scrollWheelZoom
            replayToken={replayToken}
            onReplay={() => setReplayToken((token) => token + 1)}
            ariaLabel="Expanded activity route map"
          />
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
 * test `buildRouteReplay` applies, without building the geometry the cover
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
  const layers = useRouteMapLayers();
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const route = useMemo(
    () => (track?.points ? buildRouteReplay(track.points) : null),
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
      <RouteMapFrame
        route={route}
        layers={layers}
        className="activity-route-map-frame"
        // A quick look: the whole route at once. The full map replays it.
        animate={false}
        ariaLabel="Activity route map"
      />
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
      {expanded ? (
        <RouteMapModal route={route} layers={layers} onClose={closeExpanded} />
      ) : null}
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
  const route = useMemo(
    () => (track?.points ? buildRouteReplay(track.points) : null),
    [track]
  );

  return route ? (
    <RouteCover route={route} className={className} visibleBand={visibleBand} />
  ) : null;
}

/**
 * The cover once there is a route to draw. Its own component so the credit's
 * session clock starts with a map on screen, not with a run still loading.
 */
function RouteCover({
  route,
  className,
  visibleBand
}: {
  route: RouteGeometry;
  className?: string;
  visibleBand?: number;
}) {
  const layers = useRouteMapLayers();
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const [creditOpen, toggleCredit] = useFoldingCredit();

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
        <MapCreditButton
          open={creditOpen}
          onToggle={toggleCredit}
          className="activity-route-cover-credit"
        />
      </div>
      {/* A sibling, not a child: a portal still bubbles React events through
          its parent, and a backdrop click that closed the map would reach the
          cover's own click and open it again. */}
      {expanded ? (
        <RouteMapModal route={route} layers={layers} onClose={closeExpanded} />
      ) : null}
    </>
  );
}
