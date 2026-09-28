import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Maximize2, RotateCcw, X } from "lucide-react";
import type {
  TrainingHubActivityDetail,
  TrainingHubActivityTrack
} from "../../../electron/types";
import { OptionGroup } from "../../components/OptionGroup";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatElevationMeters, formatPaceSecondsPerKm } from "../formatters";
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
import { SMOOTH_STEPS, smoothPath, smoothPathTo, type SmoothPath } from "./routeSmoothing";
import {
  REPLAY_DELAY_MS,
  buildRouteReplay,
  replayDurationMs,
  replayHead,
  type RouteReplay
} from "./routeReplay";
import {
  ZONE_COLORS,
  ZONE_COUNT,
  heatShare,
  passesBy,
  performanceColoring,
  rampColorAt,
  routeHeat,
  routeRamp,
  zoneColoring,
  type RouteColorMode,
  type RouteColoring,
  type RouteHeat,
  type RouteMetric,
  type RouteZoneColoring,
  type ZoneRange
} from "./routeColoring";

/** What the full map colours a route by: the samples and COROS's zones. */
type RouteDetail = Partial<
  Pick<TrainingHubActivityDetail, "series" | "hrZones" | "paceZones">
>;

interface ActivityRouteMapProps {
  track?: TrainingHubActivityTrack;
  /** The activity's detail, for colouring the full map by pace, heart rate or elevation. */
  detail?: RouteDetail;
}

/**
 * What Performance shows for one metric: the activity's own zones where COROS
 * scored it against some, else a ramp from its slowest stretch to its fastest.
 */
type PerformanceView =
  | { kind: "zones"; coloring: RouteZoneColoring }
  | { kind: "ramp"; coloring: RouteColoring };

type RouteGeometry = RouteReplay;

const ROUTE_COLOR = "#74c08f";
const ROUTE_COLOR_PAPER = "#0f7f5f";
const START_COLOR = "#4da3ff";
const END_COLOR = "#d89b22";

const ROUTE_COLOR_MODES = ["route", "performance", "heatmap"] as const;
const ROUTE_METRICS = ["pace", "hr", "elevation"] as const;

/** How the full map colours the route, remembered like the base map. */
const ROUTE_COLOR_MODE_PREFERENCE = defineSelectionPreference<RouteColorMode>({
  key: "training.activityRoute.colorMode",
  defaultValue: "route",
  validate: selectionIsOneOf(ROUTE_COLOR_MODES)
});

const ROUTE_METRIC_PREFERENCE = defineSelectionPreference<RouteMetric>({
  key: "training.activityRoute.metric",
  defaultValue: "pace",
  validate: selectionIsOneOf(ROUTE_METRICS)
});

const ROUTE_METRIC_LABELS: Record<RouteMetric, string> = {
  pace: "Pace",
  hr: "Heart rate",
  elevation: "Elevation"
};

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

/**
 * One stretch of the route drawn in one colour: points `from` to `to`.
 * `color` undefined is the route's own colour; null is a stretch with nothing
 * recorded, left to the faint ghost line under it.
 */
interface RouteRun {
  from: number;
  to: number;
  color: string | null | undefined;
}

function routeRuns(
  pointCount: number,
  stretchColors: readonly (string | null)[] | undefined
): RouteRun[] {
  if (!stretchColors) {
    return [{ from: 0, to: pointCount - 1, color: undefined }];
  }
  const runs: RouteRun[] = [];
  stretchColors.forEach((color, index) => {
    const last = runs[runs.length - 1];
    if (last && last.color === color) {
      last.to = index + 1;
    } else {
      runs.push({ from: index, to: index + 1, color });
    }
  });
  return runs;
}

/** How a route map draws its route: runs of flat colour, or a heatmap's glow. */
type RouteDrawing =
  | { kind: "lines"; stretchColors?: readonly (string | null)[] }
  | {
      kind: "glow";
      heat: RouteHeat;
      ramp: readonly string[];
      /** A dark ground takes a wider, brighter halo; a daylight one a faint one. */
      darkGround: boolean;
    };

interface Painter {
  /** Draws the route up to `progress` (0–1) and returns where its head is. */
  paint(progress: number): [number, number];
  setRouteColor(color: string): void;
  remove(): void;
}

/**
 * Where the replay's head is as a position along the route's points — 12.5 is
 * half way along the thirteenth stretch — which is what the curve is indexed
 * by.
 */
function headPosition(route: RouteGeometry, progress: number): number {
  const { index, fraction } = replayHead(route, progress);
  return progress >= 1 ? route.latLngs.length - 1 : index + fraction;
}

/** The curve from point `from` to position `to` (see `headPosition`). */
function curveBetween(curve: SmoothPath, from: number, to: number): [number, number][] {
  const start = from * SMOOTH_STEPS;
  const { points } = smoothPathTo(curve, to);
  return points.slice(start);
}

/**
 * Draws the route as runs of one colour each, up to the replay's head, along
 * the smoothed curve. A frame touches only the run under the head and the runs
 * whose state just changed — a route coloured by zone can be hundreds of runs,
 * and resetting every one of them on every frame is what would make the
 * replay stutter.
 */
class LinePainter implements Painter {
  private readonly group: L.LayerGroup;
  private readonly lines: {
    run: RouteRun;
    line: L.Polyline;
    state: "empty" | "partial" | "full";
  }[];

  constructor(
    map: L.Map,
    private readonly route: RouteGeometry,
    private readonly curve: SmoothPath,
    routeColor: string,
    stretchColors: readonly (string | null)[] | undefined
  ) {
    this.group = L.layerGroup().addTo(map);
    this.lines = routeRuns(route.latLngs.length, stretchColors)
      .filter((run) => run.color !== null)
      .map((run) => ({
        run,
        line: L.polyline([], {
          color: run.color ?? routeColor,
          weight: 4,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round"
        }).addTo(this.group),
        state: "empty" as const
      }));
  }

  setRouteColor(color: string): void {
    for (const { run, line } of this.lines) {
      if (run.color === undefined) {
        line.setStyle({ color });
      }
    }
  }

  paint(progress: number): [number, number] {
    const position = headPosition(this.route, progress);
    for (const entry of this.lines) {
      const { from, to } = entry.run;
      if (to <= position) {
        if (entry.state !== "full") {
          entry.line.setLatLngs(curveBetween(this.curve, from, to));
          entry.state = "full";
        }
      } else if (from <= position) {
        entry.line.setLatLngs(curveBetween(this.curve, from, position));
        entry.state = "partial";
      } else if (entry.state !== "empty") {
        entry.line.setLatLngs([]);
        entry.state = "empty";
      }
    }
    return smoothPathTo(this.curve, position).head;
  }

  remove(): void {
    this.group.remove();
  }
}

/** Below Leaflet's overlay pane, so the start and finish markers sit on the glow. */
const GLOW_PANE = "heraclesRouteGlow";

/**
 * The heatmap's line, drawn the way Strava draws its heat: on a canvas, along
 * the smoothed curve, each piece a gradient from the colour at one end to the
 * colour at the other, over a soft blurred halo, and the more passes the
 * hotter and the wider.
 *
 * Ground is drawn once: a pass over ground the route already covered adds no
 * line beside the first — it makes the first one hotter (`RouteHeat.drawn`).
 * And the heat is counted as the replay goes (`passesBy`): a lapped route
 * starts as one pass everywhere and warms lap by lap, rather than arriving
 * already at its final colour.
 *
 * Laid over, never added: the colour already says how many times a stretch was
 * passed, and adding thirteen laps' worth of light on top of it burnt every
 * lapped route to the same white. The halo is drawn opaque on a canvas of its
 * own and then laid on faintly, so it is as wide once as it is thirteen times.
 *
 * The canvas covers the map's viewport and is redrawn when the view settles;
 * Leaflet hides it during a zoom animation (`leaflet-zoom-hide`), as it does
 * its own canvas renderer.
 */
class GlowPainter implements Painter {
  private readonly canvas: HTMLCanvasElement;
  private readonly halo = document.createElement("canvas");
  private progress = 0;
  private readonly redraw = () => this.draw();

  constructor(
    private readonly map: L.Map,
    private readonly route: RouteGeometry,
    private readonly curve: SmoothPath,
    private readonly drawing: Extract<RouteDrawing, { kind: "glow" }>
  ) {
    if (!map.getPane(GLOW_PANE)) {
      map.createPane(GLOW_PANE).style.zIndex = "390";
    }
    this.canvas = L.DomUtil.create("canvas", "activity-route-glow leaflet-zoom-hide");
    map.getPane(GLOW_PANE)!.appendChild(this.canvas);
    map.on("moveend zoomend resize viewreset", this.redraw);
  }

  setRouteColor(): void {
    // The heat is coloured by its ramp; the route's own colour is not used.
  }

  paint(progress: number): [number, number] {
    this.progress = progress;
    this.draw();
    return smoothPathTo(this.curve, headPosition(this.route, progress)).head;
  }

  remove(): void {
    this.map.off("moveend zoomend resize viewreset", this.redraw);
    this.canvas.remove();
  }

  private draw(): void {
    const { map, canvas, route, curve, drawing } = this;
    const { heat } = drawing;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const size = map.getSize();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = Math.max(1, Math.floor(size.x * ratio));
    canvas.height = Math.max(1, Math.floor(size.y * ratio));
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);

    const position = headPosition(route, this.progress);
    const head = Math.min(route.latLngs.length - 2, Math.floor(position));

    // The heat of each stretch the head has reached, counting only the passes
    // it has made so far.
    const share = (stretch: number) =>
      heatShare(heat, passesBy(heat, stretch, head));

    // Runs of drawn ground, each a stretch of the curve with its heat.
    const pieces: { points: [number, number][]; shares: number[] }[] = [];
    let stretch = 0;
    while (stretch <= head) {
      if (!heat.drawn[stretch]) {
        stretch += 1;
        continue;
      }
      const from = stretch;
      while (stretch + 1 <= head && heat.drawn[stretch + 1]) {
        stretch += 1;
      }
      const to = Math.min(stretch + 1, position);
      const points = curveBetween(curve, from, to);
      const shares = points.map((_, k) => {
        const at = from + k / SMOOTH_STEPS;
        const lower = Math.min(stretch, Math.floor(at));
        const t = at - Math.floor(at);
        const here = share(lower);
        const next = lower + 1 <= stretch ? share(lower + 1) : here;
        // A point is shared by the stretches either side of it; blend across
        // the second half of each stretch so the colour turns at the joins.
        return t < 0.5 ? here : here + (next - here) * (t - 0.5) * 2;
      });
      pieces.push({ points, shares });
      stretch += 1;
    }

    const stroke = (target: CanvasRenderingContext2D, extra: number) => {
      target.lineCap = "round";
      target.lineJoin = "round";
      for (const piece of pieces) {
        const projected = piece.points.map((latLng) => map.latLngToContainerPoint(latLng));
        for (let k = 0; k < projected.length - 1; k += 1) {
          const a = projected[k]!;
          const b = projected[k + 1]!;
          const shareA = piece.shares[k]!;
          const shareB = piece.shares[k + 1] ?? shareA;
          const gradient = target.createLinearGradient(a.x, a.y, b.x, b.y);
          gradient.addColorStop(0, rampColorAt(drawing.ramp, shareA));
          gradient.addColorStop(1, rampColorAt(drawing.ramp, shareB));
          target.strokeStyle = gradient;
          // Wider with heat: 3 px for a single pass, 7 px for the most.
          target.lineWidth = 3 + 4 * ((shareA + shareB) / 2) + extra;
          target.beginPath();
          target.moveTo(a.x, a.y);
          target.lineTo(b.x, b.y);
          target.stroke();
        }
      }
    };

    const halo = this.halo.getContext("2d");
    if (halo) {
      this.halo.width = canvas.width;
      this.halo.height = canvas.height;
      halo.setTransform(ratio, 0, 0, ratio, 0, 0);
      stroke(halo, drawing.darkGround ? 7 : 5);
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = drawing.darkGround ? 0.45 : 0.2;
      context.filter = `blur(${(drawing.darkGround ? 5 : 3) * ratio}px)`;
      context.drawImage(this.halo, 0, 0);
      context.restore();
    }
    stroke(context, 0);
  }
}

function createPainter(
  map: L.Map,
  route: RouteGeometry,
  curve: SmoothPath,
  routeColor: string,
  drawing: RouteDrawing | undefined
): Painter {
  return drawing?.kind === "glow"
    ? new GlowPainter(map, route, curve, drawing)
    : new LinePainter(map, route, curve, routeColor, drawing?.stretchColors);
}

/** What the map's owner can ask of a route map once it is built. */
interface RouteMapControl {
  replay: () => void;
  redraw: (drawing: RouteDrawing | undefined) => void;
  /** The route's own colour and its ghost's opacity, for the ground under them. */
  setRouteColor: (color: string, ghostOpacity: number) => void;
}

function RouteMapCanvas({
  route,
  scrollWheelZoom = false,
  interactive = true,
  visibleBand,
  baseLayer,
  animate = true,
  replayToken = 0,
  drawing,
  ariaLabel
}: {
  route: RouteGeometry;
  /**
   * How the route is drawn when it is coloured by what happened along it.
   * Absent, it is one line in the route's own colour.
   */
  drawing?: RouteDrawing;
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
  const controlRef = useRef<RouteMapControl | null>(null);
  // Read when the map is built; a later change redraws in place.
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
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

    const curve = smoothPath(route.latLngs);
    // The faint whole route under the replay. The heatmap hides it: it would
    // draw again every strand the heat merges into one.
    const ghostShown = (next: RouteDrawing | undefined) => next?.kind !== "glow";
    let currentGhostOpacity = ghostOpacity;
    const ghostLine = L.polyline(curve.points, {
      color: routeColor,
      weight: 4,
      opacity: ghostShown(drawingRef.current) ? ghostOpacity : 0,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    let currentRouteColor = routeColor;
    let painter = createPainter(map, route, curve, routeColor, drawingRef.current);

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
    appliedBaseLayerRef.current = initialLayer;

    // The replay: a still half second when the map opens, then the line grows
    // at the pace the activity was done (sped up, linear, so a slow stretch
    // reads as slow) with the finish marker riding its head to the finish.
    const endMarker = L.circleMarker(end, {
      radius: 6,
      color: END_COLOR,
      fillColor: END_COLOR,
      fillOpacity: 1,
      weight: 2
    });

    let animationFrame = 0;
    const replayMs = replayDurationMs(route.meters);

    const showWhole = () => {
      window.cancelAnimationFrame(animationFrame);
      painter.paint(1);
      endMarker.setLatLng(end).addTo(map);
    };

    const play = (delayMs: number) => {
      window.cancelAnimationFrame(animationFrame);
      painter.paint(0);
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
        endMarker.setLatLng(painter.paint(progress));
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
    } else {
      showWhole();
    }
    controlRef.current = {
      // A replay asked for starts at once: the eye is already on the map.
      replay: () => {
        if (animate) {
          play(0);
        }
      },
      // A new colouring is shown whole: it answers a question about the whole
      // route, and replaying it would make the answer wait.
      redraw: (next) => {
        window.cancelAnimationFrame(animationFrame);
        painter.remove();
        painter = createPainter(map, route, curve, currentRouteColor, next);
        ghostLine.setStyle({ opacity: ghostShown(next) ? currentGhostOpacity : 0 });
        showWhole();
      },
      setRouteColor: (color, opacity) => {
        currentRouteColor = color;
        currentGhostOpacity = opacity;
        painter.setRouteColor(color);
        ghostLine.setStyle({
          color,
          opacity: ghostShown(drawingRef.current) ? opacity : 0
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      if (!interactive) {
        fitRoute();
      }
    });
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      controlRef.current = null;
      painter.remove();
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
  }, [route, theme, scrollWheelZoom, interactive, visibleBand, animate]);

  useEffect(() => {
    if (replayToken > 0) {
      controlRef.current?.replay();
    }
  }, [replayToken]);

  // Redraw in place. The first run is the build's own, which already drew
  // this.
  const drawnRef = useRef(drawing);
  useEffect(() => {
    if (drawnRef.current === drawing) {
      return;
    }
    drawnRef.current = drawing;
    controlRef.current?.redraw(drawing);
  }, [drawing]);

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
    controlRef.current?.setRouteColor(routeColor, ghostOpacity);
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

/** The ramp under a route coloured without zones, with what its two ends stand for. */
function RouteColorLegend({
  metric,
  coloring,
  ramp
}: {
  metric: RouteMetric;
  coloring: RouteColoring;
  ramp: readonly string[];
}) {
  const { unitSystem } = useUnitSystem();
  const label = (value: number) =>
    metric === "pace"
      ? formatPaceSecondsPerKm(value, unitSystem)
      : metric === "hr"
        ? `${Math.round(value)} bpm`
        : formatElevationMeters(value, unitSystem);

  return (
    <span
      className="activity-route-color-legend"
      aria-label={`${ROUTE_METRIC_LABELS[metric]} from ${label(coloring.low)} to ${label(coloring.high)}`}
    >
      <span>{label(coloring.low)}</span>
      <span className="activity-route-color-ramp" aria-hidden="true">
        {ramp.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
      </span>
      <span>{label(coloring.high)}</span>
    </span>
  );
}

/**
 * The six zones in the zone bar's colours, laid out like the elevation ramp —
 * Z1 at one end, Z6 at the other — whether or not this activity reached them,
 * so the key reads the same on every run. Each zone's bounds are on hover, as
 * COROS scored the activity.
 */
function RouteZoneLegend({
  metric,
  coloring
}: {
  metric: "pace" | "hr";
  coloring: RouteZoneColoring;
}) {
  const { unitSystem } = useUnitSystem();
  const pace = (value: number) => formatPaceSecondsPerKm(value, unitSystem);
  // The first zone has no floor and the last no honest ceiling — COROS fills
  // it with a sentinel (401 bpm, 2:42/km) — so both read open-ended.
  const bounds = ({ low, high }: ZoneRange, zone: number) => {
    const first = zone === 1;
    const last = zone === ZONE_COUNT;
    if (metric === "hr") {
      if (first) return high !== undefined ? `under ${Math.round(high)} bpm` : undefined;
      if (last) return low !== undefined ? `over ${Math.round(low)} bpm` : undefined;
      return low !== undefined && high !== undefined
        ? `${Math.round(low)}–${Math.round(high)} bpm`
        : undefined;
    }
    if (first) return low !== undefined ? `slower than ${pace(low)}` : undefined;
    if (last) return high !== undefined ? `faster than ${pace(high)}` : undefined;
    return low !== undefined && high !== undefined
      ? `${pace(low).replace(/\s*\/\s*\w+$/, "")}–${pace(high)}`
      : undefined;
  };

  return (
    <span
      className="activity-route-color-legend"
      aria-label={`${metric === "hr" ? "Heart rate" : "Pace"} zones, Z1 to Z${ZONE_COUNT}`}
    >
      <span>Z1</span>
      <span className="activity-route-color-ramp">
        {ZONE_COLORS.map((color, position) => {
          const zone = position + 1;
          const range = bounds(coloring.ranges[position] ?? {}, zone);
          return (
            <i
              key={zone}
              style={{ background: color }}
              title={range ? `Z${zone} · ${range}` : `Z${zone}`}
            />
          );
        })}
      </span>
      <span>Z{ZONE_COUNT}</span>
    </span>
  );
}

/** The heatmap's scale: how many passes its dimmest and brightest colour stand for. */
function RouteHeatLegend({ heat, ramp }: { heat: RouteHeat; ramp: readonly string[] }) {
  if (heat.most <= 1) {
    return (
      <span className="activity-route-color-legend">Every stretch was covered once</span>
    );
  }
  return (
    <span
      className="activity-route-color-legend"
      aria-label={`Times passed, from once to ${heat.most} times`}
    >
      <span>1×</span>
      <span
        className="activity-route-color-gradient"
        aria-hidden="true"
        style={{ background: `linear-gradient(to right, ${ramp.join(", ")})` }}
      />
      <span>{heat.most}×</span>
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
  drawing,
  ariaLabel,
  onReplay
}: {
  route: RouteGeometry;
  layers: RouteMapLayers;
  className: string;
  scrollWheelZoom?: boolean;
  animate?: boolean;
  replayToken?: number;
  drawing?: RouteDrawing;
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
        drawing={drawing}
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
  detail,
  layers,
  onClose
}: {
  route: RouteGeometry;
  detail?: RouteDetail;
  layers: RouteMapLayers;
  onClose: () => void;
}) {
  const [replayToken, setReplayToken] = useState(0);
  const [storedMode, setMode] = useSelectionPreference(ROUTE_COLOR_MODE_PREFERENCE);
  const [storedMetric, setMetric] = useSelectionPreference(ROUTE_METRIC_PREFERENCE);

  const performance = useMemo(() => {
    const series = detail?.series ?? [];
    const view = (metric: RouteMetric): PerformanceView | null => {
      if (metric !== "elevation") {
        const zones = zoneColoring(
          route,
          series,
          metric,
          metric === "hr" ? detail?.hrZones : detail?.paceZones
        );
        if (zones) {
          return { kind: "zones", coloring: zones };
        }
      }
      const ramp = performanceColoring(route, series, metric);
      return ramp ? { kind: "ramp", coloring: ramp } : null;
    };
    return Object.fromEntries(ROUTE_METRICS.map((metric) => [metric, view(metric)])) as Record<
      RouteMetric,
      PerformanceView | null
    >;
  }, [route, detail]);
  const heat = useMemo(() => routeHeat(route), [route]);

  // A choice this activity cannot show falls back rather than drawing nothing:
  // a metric it did not record to the first one it did, and Performance with
  // nothing recorded at all to the plain route.
  const metric =
    performance[storedMetric] !== null
      ? storedMetric
      : ROUTE_METRICS.find((candidate) => performance[candidate] !== null) ??
        storedMetric;
  const mode =
    storedMode === "performance" && performance[metric] === null
      ? "route"
      : storedMode;
  const view = mode === "performance" ? performance[metric] : null;
  const lightGround = isLightBaseLayer(layers.baseLayer);

  const drawing = useMemo((): RouteDrawing | undefined => {
    if (mode === "heatmap") {
      return {
        kind: "glow",
        heat,
        ramp: routeRamp("heatmap", lightGround),
        darkGround: !lightGround
      };
    }
    if (!view) {
      return undefined;
    }
    // A zone is numbered from 1; a ramp step from 0.
    const colorOf =
      view.kind === "zones"
        ? (step: number) => ZONE_COLORS[step - 1]!
        : (step: number) => routeRamp("performance", lightGround)[step]!;
    return {
      kind: "lines",
      stretchColors: view.coloring.steps.map((step) => (step === null ? null : colorOf(step)))
    };
  }, [mode, view, heat, lightGround]);

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
            drawing={drawing}
            ariaLabel="Expanded activity route map"
          />
          <div className="activity-route-footer">
            <div className="activity-route-coloring">
              <OptionGroup
                label="Colour the route by"
                value={mode}
                options={[
                  { value: "route", label: "Route" },
                  {
                    value: "performance",
                    label: "Performance",
                    disabled: ROUTE_METRICS.every((m) => performance[m] === null),
                    title: "Pace, heart rate or elevation along the route"
                  },
                  {
                    value: "heatmap",
                    label: "Heatmap",
                    title: "Brighter where the activity passed more often"
                  }
                ]}
                onChange={setMode}
              />
              {mode === "performance" ? (
                <OptionGroup
                  label="Performance metric"
                  value={metric}
                  options={ROUTE_METRICS.map((m) => ({
                    value: m,
                    label: ROUTE_METRIC_LABELS[m],
                    disabled: performance[m] === null,
                    ...(performance[m] === null
                      ? { title: `No ${ROUTE_METRIC_LABELS[m].toLowerCase()} recorded` }
                      : {})
                  }))}
                  onChange={setMetric}
                />
              ) : null}
              {mode === "heatmap" ? (
                <RouteHeatLegend heat={heat} ramp={routeRamp("heatmap", lightGround)} />
              ) : view?.kind === "zones" ? (
                <RouteZoneLegend
                  metric={metric === "pace" ? "pace" : "hr"}
                  coloring={view.coloring}
                />
              ) : view ? (
                <RouteColorLegend
                  metric={metric}
                  coloring={view.coloring}
                  ramp={routeRamp("performance", lightGround)}
                />
              ) : null}
            </div>
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

export function ActivityRouteMap({ track, detail }: ActivityRouteMapProps) {
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
        <RouteMapModal
          route={route}
          detail={detail}
          layers={layers}
          onClose={closeExpanded}
        />
      ) : null}
    </div>
  );
}

interface ActivityRouteCoverProps {
  track?: TrainingHubActivityTrack;
  /** The activity's detail, for colouring the full map it opens. */
  detail?: RouteDetail;
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
  detail,
  className,
  visibleBand
}: ActivityRouteCoverProps) {
  const route = useMemo(
    () => (track?.points ? buildRouteReplay(track.points) : null),
    [track]
  );

  return route ? (
    <RouteCover
      route={route}
      detail={detail}
      className={className}
      visibleBand={visibleBand}
    />
  ) : null;
}

/**
 * The cover once there is a route to draw. Its own component so the credit's
 * session clock starts with a map on screen, not with a run still loading.
 */
function RouteCover({
  route,
  detail,
  className,
  visibleBand
}: {
  route: RouteGeometry;
  detail?: RouteDetail;
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
        <RouteMapModal
          route={route}
          detail={detail}
          layers={layers}
          onClose={closeExpanded}
        />
      ) : null}
    </>
  );
}
