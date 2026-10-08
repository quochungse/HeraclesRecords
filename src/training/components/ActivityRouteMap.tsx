import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Maximize2, RotateCcw, X } from "lucide-react";
import type {
  TrainingHubActivityDetail,
  TrainingHubActivityTrack,
  TrainingHubTrackPoint
} from "../../../electron/types";
import { OptionGroup } from "../../components/OptionGroup";
import { useI18n } from "../../i18n/useI18n";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { kmhToDisplaySpeed, speedUnit } from "../../units/units";
import { formatElevationMeters, formatPaceSecondsPerKm } from "../formatters";
import { isSpeedSport } from "../sportTypes";
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
import {
  MapLayerControl,
  hasOpenLayerMenu,
  type MapLayerSection
} from "../../mapBase/MapLayerControl";
import { useTheme } from "../../theme/ThemeProvider";
import { curveBetween, curveHead, smoothPath, type SmoothPath } from "./routeSmoothing";
import {
  COVER_REPLAY_MAX_MS,
  REPLAY_DELAY_MS,
  buildRouteReplay,
  replayDurationMs,
  replayHead,
  type RouteReplay
} from "./routeReplay";
import {
  ELEVATION_STOPS,
  HEAT_BANDS,
  elevationColor,
  elevationColoring,
  elevationColors,
  heatBand,
  heatColors,
  heatCores,
  heatPositions,
  heatWeight,
  neonWidths,
  ROUTE_LINE_WIDTHS,
  ROUTE_NEON,
  routeNeon,
  whitenColor,
  passesBy,
  performanceColoring,
  performanceZones,
  rampColorAt,
  routeHeat,
  routeRamp,
  stretchValues,
  zoneColor,
  zoneColoring,
  zoneLabel,
  type RouteColorMode,
  type RouteColoring,
  type RouteHeat,
  type RouteMetric,
  type RouteZoneColoring
} from "./routeColoring";

import { formatDecimal, t } from "../../i18n/core";
/** What the full map colours a route by: the samples, COROS's zones and the sport. */
type RouteDetail = Partial<
  Pick<
    TrainingHubActivityDetail,
    "series" | "hrZones" | "paceZones" | "sportType" | "sportName"
  >
>;

interface ActivityRouteMapProps {
  track?: TrainingHubActivityTrack;
  /** The activity's detail, for colouring the full map by pace, heart rate or elevation. */
  detail?: RouteDetail;
}

/**
 * What Performance shows for one metric: pace and heart rate by the activity's
 * own zones where COROS scored it against some, else a ramp from its slowest
 * stretch to its fastest; elevation by fixed heights. Or why it shows nothing
 * — `recorded` when the metric was recorded but cannot be placed on the route.
 */
type PerformanceView =
  | { kind: "zones"; coloring: RouteZoneColoring }
  | { kind: "ramp"; coloring: RouteColoring }
  | { kind: "elevation"; heights: (number | null)[] }
  | { kind: "none"; reason: string; recorded: boolean };

type ShownView = Exclude<PerformanceView, { kind: "none" }>;

/** Heights are coloured to the nearest 5 m, so a flat road is one line, not hundreds. */
const ELEVATION_COLOR_STEP_M = 5;

const ROUTE_COLOR = "#74c08f";
const ROUTE_COLOR_PAPER = "#0f7f5f";
/**
 * The start and finish have a pane of their own, above the route's lines and
 * the heatmap's glow. In the overlay pane they shared one SVG with the route,
 * where the element added last is on top — so every redraw (a new colouring,
 * a new metric) laid its lines over both markers.
 */
const ROUTE_ENDS_PANE = "heraclesRouteEnds";

/**
 * How large the start and finish are drawn at a zoom: full size from street
 * level (16) in, half size from a city's width (12) out, and in between by
 * the level. The route's line keeps its width, but the route itself shrinks
 * as the map zooms out, and a full-size disc then sat over a stretch of it.
 */
function routeEndScale(zoom: number): number {
  return Math.min(1, Math.max(0.5, 1 - (16 - zoom) * 0.125));
}

/**
 * The pane the start and finish live in, scaled to the zoom — as the zoom
 * animation starts, so they shrink with the route rather than after it — and
 * hidden through a zoom whenever the route is: Leaflet hides the heatmap's
 * canvas while it animates a zoom (`leaflet-zoom-hide`), and two discs left
 * sliding over no line read as a glitch.
 */
function bindRouteEnds(map: L.Map): { hideWhileZooming: (hide: boolean) => void } {
  const pane = map.getPane(ROUTE_ENDS_PANE)!;
  const scaleTo = (zoom: number) =>
    pane.style.setProperty("--route-end-scale", String(routeEndScale(zoom)));
  map.on("zoomanim", (event) => scaleTo((event as L.ZoomAnimEvent).zoom));
  map.on("zoomend", () => scaleTo(map.getZoom()));
  scaleTo(map.getZoom());
  return {
    hideWhileZooming: (hide) => pane.classList.toggle("leaflet-zoom-hide", hide)
  };
}

/**
 * A disc in the marker's colour whitening out to its edge, so it stands off
 * any route colour. HTML rather than a Leaflet circle, which fills with one
 * flat colour; the look is `.activity-route-end` and the legend's
 * `.activity-route-dot`, which share it.
 */
function routeEndMarker(map: L.Map, at: [number, number], kind: "start" | "end"): L.Marker {
  if (!map.getPane(ROUTE_ENDS_PANE)) {
    map.createPane(ROUTE_ENDS_PANE).style.zIndex = "450";
  }
  return L.marker(at, {
    pane: ROUTE_ENDS_PANE,
    icon: L.divIcon({
      className: `activity-route-end is-${kind}`,
      // The disc is the inner element: it is the one scaled to the zoom, since
      // a scale on the icon itself would scale Leaflet's positioning with it.
      html: "<span></span>",
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    }),
    interactive: false,
    keyboard: false,
    // A marker is stacked by its latitude; the finish is always the one on
    // top where a loop finishes on its start.
    zIndexOffset: kind === "end" ? 1000 : 0
  });
}

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

/** A metric's name. On a ride the pace channel is read out as speed. */
function metricLabel(metric: RouteMetric, speed: boolean): string {
  return t(
    metric === "pace"
      ? speed
        ? "activity.m.speed"
        : "activity.m.pace"
      : metric === "hr"
        ? "activity.m.heartRate"
        : "activity.m.elevation"
  );
}

/** The metric's own key for a sentence about it: "pace", "speed", "hr" or "elevation". */
function metricKey(metric: RouteMetric, speed: boolean): "pace" | "speed" | "hr" | "elevation" {
  return metric === "pace" ? (speed ? "speed" : "pace") : metric;
}

/** Shared by the side-panel map and the full map, so a pick in one is the other's. */
const ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE = defineBaseLayerPreference(
  "training.activityRoute.baseLayer"
);

/** How a route is drawn on one ground: its own colour, its ghost, and which ground. */
interface RouteStyle {
  routeColor: string;
  ghostOpacity: number;
  lightGround: boolean;
}

interface MapStyle extends RouteStyle {
  tile: BaseLayerConfig;
}

function resolveMapStyle(theme: string, baseLayer?: BaseLayerId): MapStyle {
  const layer = baseLayer ?? themeBaseLayer(theme);
  const lightGround = isLightBaseLayer(layer);
  return {
    tile: BASE_LAYERS[layer],
    routeColor: lightGround ? ROUTE_COLOR_PAPER : ROUTE_COLOR,
    ghostOpacity: lightGround ? 0.28 : 0.18,
    lightGround
  };
}

/**
 * Where a point falls on the map's layer, to the fraction of a pixel. Leaflet's
 * `latLngToLayerPoint` rounds to a whole one, which is harmless for a line of
 * long chords and wrong for the smoothed curve, whose samples sit a pixel or
 * two apart: each snaps up or down by half a pixel and the curve draws as a
 * staircase. The line was anti-aliased all along; its corners were not.
 */
function subpixelLayerPoint(map: L.Map, latLng: L.LatLng): L.Point {
  return map.project(latLng).subtract(map.getPixelOrigin());
}

function subpixelContainerPoint(map: L.Map, latLng: L.LatLngExpression): L.Point {
  return map.layerPointToContainerPoint(subpixelLayerPoint(map, L.latLng(latLng)));
}

/**
 * A polyline projected by `subpixelLayerPoint` — `_projectLatlngs` is the one
 * place Leaflet projects a path's points, and the SVG path string writes them
 * out as they are. Simplified at a quarter of a pixel rather than Leaflet's
 * whole one, which would fold the curve back into visible chords.
 */
const SubpixelPolyline = L.Polyline.extend({
  options: { smoothFactor: 0.25 },
  _projectLatlngs(
    this: { _map: L.Map; _projectLatlngs: (...args: unknown[]) => void },
    latlngs: L.LatLng[] | L.LatLng[][],
    result: L.Point[][],
    projectedBounds: L.Bounds
  ) {
    if (latlngs[0] instanceof L.LatLng) {
      const ring = (latlngs as L.LatLng[]).map((latLng) => {
        const point = subpixelLayerPoint(this._map, latLng);
        projectedBounds.extend(point);
        return point;
      });
      result.push(ring);
      return;
    }
    for (const part of latlngs as L.LatLng[][]) {
      this._projectLatlngs(part, result, projectedBounds);
    }
  }
}) as unknown as new (
  latlngs: L.LatLngExpression[],
  options?: L.PolylineOptions
) => L.Polyline;

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

/**
 * The most stretches one run holds. A replay rewrites the run under its head
 * every frame, so a route in one colour drawn as a single run rewrote the whole
 * curve so far — thousands of samples — sixty times a second. Two runs of one
 * colour meet on a shared sample under opaque round caps, so the cut is not
 * seen.
 */
const MAX_RUN_STRETCHES = 32;

function routeRuns(
  pointCount: number,
  stretchColors: readonly (string | null)[] | undefined
): RouteRun[] {
  const runs: RouteRun[] = [];
  for (let index = 0; index < pointCount - 1; index += 1) {
    const color = stretchColors ? (stretchColors[index] ?? null) : undefined;
    const last = runs[runs.length - 1];
    if (last && last.color === color && last.to - last.from < MAX_RUN_STRETCHES) {
      last.to = index + 1;
    } else {
      runs.push({ from: index, to: index + 1, color });
    }
  }
  return runs;
}

/** How a route map draws its route: runs of flat colour, or a heatmap's glow. */
type RouteDrawing =
  | { kind: "lines"; stretchColors?: readonly (string | null)[] }
  | {
      kind: "glow";
      heat: RouteHeat;
      /** One colour per `HEAT_BANDS` entry. */
      colors: readonly string[];
      /** What each band's neon core whitens towards. */
      cores: readonly string[];
      /** A daylight ground takes the quieter neon (`routeNeon`). */
      darkGround: boolean;
    };

/** Where the drawn line starts and where its head is, for the two markers. */
interface PaintedEnds {
  start: [number, number];
  head: [number, number];
}

interface Painter {
  /**
   * Draws the route up to `progress` (0–1) and returns where the line it drew
   * starts and ends — which is where the markers go, since the heatmap moves
   * its line off the recorded points.
   */
  paint(progress: number): PaintedEnds;
  /** The ground changed under the route: a new base map. */
  restyle(style: RouteStyle): void;
  remove(): void;
}

/**
 * Where the replay's head is as a position along the route's points — 12.5 is
 * half way along the thirteenth stretch — which is what the curve is indexed
 * by.
 */
function headPosition(route: RouteReplay, progress: number): number {
  const { index, fraction } = replayHead(route, progress);
  return progress >= 1 ? route.latLngs.length - 1 : index + fraction;
}

/** Below the route's lines, above the heatmap's pane (which never shows with them). */
const LINE_HALO_PANE = "heraclesRouteHalo";

/**
 * Draws the route as runs of one colour each, up to the replay's head, along
 * the smoothed curve, each run three paths: halo, body and core. A frame
 * touches only the run under the head and the runs whose state just changed —
 * a route coloured by zone can be hundreds of runs, and resetting every one of
 * them on every frame is what would make the replay stutter.
 */
class LinePainter implements Painter {
  private readonly group: L.LayerGroup;
  private readonly lines: {
    run: RouteRun;
    halo: L.Polyline;
    body: L.Polyline;
    core: L.Polyline;
    state: "empty" | "partial" | "full";
  }[];

  constructor(
    map: L.Map,
    private readonly route: RouteReplay,
    private readonly curve: SmoothPath,
    style: RouteStyle,
    stretchColors: readonly (string | null)[] | undefined
  ) {
    if (!map.getPane(LINE_HALO_PANE)) {
      map.createPane(LINE_HALO_PANE).style.zIndex = "395";
    }
    this.group = L.layerGroup().addTo(map);
    const neon = routeNeon(style.lightGround);
    const line = (options: L.PolylineOptions) =>
      new SubpixelPolyline([], {
        // Opaque, or the round caps where two runs meet overlap into a darker
        // dot at every join. Nothing here answers the pointer either, so none
        // of it should wear the pointer cursor.
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
        ...options
      }).addTo(this.group);
    const runs = routeRuns(route.latLngs.length, stretchColors).filter(
      (run) => run.color !== null
    );
    const colorOf = (run: RouteRun) => run.color ?? style.routeColor;
    // Every body before every core: a later run's body laid over an earlier
    // run's core would cut the core at each join, under its round cap.
    const halos = runs.map((run) =>
      line({
        pane: LINE_HALO_PANE,
        color: colorOf(run),
        weight: ROUTE_LINE_WIDTHS.halo,
        opacity: neon.haloOpacity
      })
    );
    const bodies = runs.map((run) => line({ color: colorOf(run), weight: ROUTE_LINE_WIDTHS.body }));
    const cores = runs.map((run) =>
      line({ color: whitenColor(colorOf(run), neon.coreWhiten), weight: ROUTE_LINE_WIDTHS.core })
    );
    this.lines = runs.map((run, index) => ({
      run,
      halo: halos[index]!,
      body: bodies[index]!,
      core: cores[index]!,
      state: "empty" as const
    }));
  }

  restyle(style: RouteStyle): void {
    const neon = routeNeon(style.lightGround);
    for (const { run, halo, body, core } of this.lines) {
      const color = run.color ?? style.routeColor;
      halo.setStyle({ color, opacity: neon.haloOpacity });
      body.setStyle({ color });
      core.setStyle({ color: whitenColor(color, neon.coreWhiten) });
    }
  }

  paint(progress: number): PaintedEnds {
    const position = headPosition(this.route, progress);
    for (const entry of this.lines) {
      const { from, to } = entry.run;
      if (to <= position) {
        if (entry.state !== "full") {
          this.draw(entry, curveBetween(this.curve, from, to));
          entry.state = "full";
        }
      } else if (from <= position) {
        this.draw(entry, curveBetween(this.curve, from, position));
        entry.state = "partial";
      } else if (entry.state !== "empty") {
        this.draw(entry, []);
        entry.state = "empty";
      }
    }
    return {
      start: this.curve.points[0]!,
      head: curveHead(this.curve, position)
    };
  }

  private draw(
    entry: (typeof this.lines)[number],
    points: [number, number][]
  ): void {
    entry.halo.setLatLngs(points);
    entry.body.setLatLngs(points);
    entry.core.setLatLngs(points);
  }

  remove(): void {
    this.group.remove();
  }
}

/** Below Leaflet's overlay pane and the start and finish (`ROUTE_ENDS_PANE`). */
const GLOW_PANE = "heraclesRouteGlow";

/**
 * How far past the viewport the heatmap's canvas reaches on each side, as a
 * share of it: a drag shows what is already drawn at the edge it uncovers,
 * for the frame before the redraw catches up.
 */
const GLOW_PADDING = 0.1;

/**
 * The halo is drawn and blurred at this share of the canvas's resolution — a
 * quarter of the pixels, and a blur has no detail to lose — then laid on
 * scaled back up. The blur is the one costly step of a frame.
 */
const HALO_SCALE = 0.5;

/** Sizes a canvas's backing store, which clears and reallocates it — so only when it changes. */
function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/**
 * The heatmap's line, drawn on a canvas along the smoothed curve in the neon
 * every route line wears (`ROUTE_NEON`) — a whitened core down its middle over
 * a faint blurred halo — and the more passes the hotter and the wider
 * (`heatWeight`), in the same proportions at every width.
 *
 * Ground is drawn once: every pass is laid at the mean of the passes over its
 * spot (`heatPositions`), so a later lap lands on the earlier one rather than
 * beside it — the line gets hotter, wider and moves to the laps' middle. Every
 * stretch is drawn: choosing which pass draws a spot left gaps wherever the
 * choice changed hands, at the start of a lap and where a road left the loop.
 * The colour and the width are fixed per band of pass counts (`HEAT_BANDS`).
 * And the heat is counted as the replay goes (`passesBy`): a lapped route
 * starts as one pass everywhere and warms and settles lap by lap, rather than
 * arriving already at its final colour and place.
 *
 * Laid over, never added: the colour already says how many times a stretch was
 * passed, and adding thirteen laps' worth of light on top of it burnt every
 * lapped route to the same white. The halo is drawn opaque on a canvas of its
 * own and then laid on faintly, so it is as wide once as it is thirteen times.
 *
 * The canvas covers the viewport and `GLOW_PADDING` around it, and is redrawn
 * once a frame while the map moves — a drag included, so the line is never
 * cut off at the edge of where the view was. Leaflet hides it during a zoom
 * animation (`leaflet-zoom-hide`), as it does its own canvas renderer.
 */
class GlowPainter implements Painter {
  private readonly canvas: HTMLCanvasElement;
  private readonly halo = document.createElement("canvas");
  private readonly haloBlurred = document.createElement("canvas");
  private progress = 0;
  private frame = 0;
  private readonly schedule = () => {
    if (this.frame === 0) {
      this.frame = window.requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    }
  };
  /** The heat's curve for the passes up to `head`, kept until the head moves on. */
  private shaped?: { head: number; curve: SmoothPath };

  constructor(
    private readonly map: L.Map,
    private readonly route: RouteReplay,
    private readonly drawing: Extract<RouteDrawing, { kind: "glow" }>
  ) {
    if (!map.getPane(GLOW_PANE)) {
      map.createPane(GLOW_PANE).style.zIndex = "390";
    }
    this.canvas = L.DomUtil.create("canvas", "activity-route-glow leaflet-zoom-hide");
    map.getPane(GLOW_PANE)!.appendChild(this.canvas);
    map.on("move moveend zoomend resize viewreset", this.schedule);
  }

  restyle(): void {
    // The heat is coloured by its ramp and drawn for the ground it was made
    // for; a new ground is a new drawing (`useRouteDrawing`).
  }

  paint(progress: number): PaintedEnds {
    this.progress = progress;
    window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    return this.draw();
  }

  remove(): void {
    window.cancelAnimationFrame(this.frame);
    this.map.off("move moveend zoomend resize viewreset", this.schedule);
    this.canvas.remove();
  }

  private headStretch(position: number): number {
    return Math.min(this.route.latLngs.length - 2, Math.floor(position));
  }

  private heatCurve(head: number): SmoothPath {
    if (this.shaped?.head !== head) {
      this.shaped = {
        head,
        curve: smoothPath(heatPositions(this.drawing.heat, this.route.latLngs, head))
      };
    }
    return this.shaped.curve;
  }

  /** Draws the heat up to the head and returns where the line it drew starts and ends. */
  private draw(): PaintedEnds {
    const { map, canvas, route, drawing } = this;
    const { heat } = drawing;
    const position = headPosition(route, this.progress);
    const head = this.headStretch(position);
    const curve = this.heatCurve(head);
    const ends = { start: curve.points[0]!, head: curveHead(curve, position) };

    const context = canvas.getContext("2d");
    const halo = this.halo.getContext("2d");
    const blurred = this.haloBlurred.getContext("2d");
    if (!context || !halo || !blurred) {
      return ends;
    }
    const size = map.getSize();
    const pad = size.multiplyBy(GLOW_PADDING).round();
    const width = size.x + 2 * pad.x;
    const height = size.y + 2 * pad.y;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const haloRatio = ratio * HALO_SCALE;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([-pad.x, -pad.y]));
    fitCanvas(canvas, width * ratio, height * ratio);
    fitCanvas(this.halo, width * haloRatio, height * haloRatio);
    fitCanvas(this.haloBlurred, width * haloRatio, height * haloRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    // The band of each stretch the head has reached, counting only the passes
    // it has made so far, as a share of the top band for the colours and width.
    const topBand = HEAT_BANDS.length - 1;
    const shareOf = new Map<number, number>();
    const share = (stretch: number) => {
      let value = shareOf.get(stretch);
      if (value === undefined) {
        value = heatBand(passesBy(heat, stretch, head)) / topBand;
        shareOf.set(stretch, value);
      }
      return value;
    };

    // The whole route up to the head, each curve point with its heat. The
    // last point is the head itself, which falls short of the next sample.
    const points = curveBetween(curve, 0, position);
    const shares = points.map((_, k) => {
      const at = Math.min(curve.along[k] ?? position, position);
      const lower = Math.min(head, Math.floor(at));
      const t = at - Math.floor(at);
      const here = share(lower);
      const next = lower + 1 <= head ? share(lower + 1) : here;
      // A point is shared by the stretches either side of it; blend across
      // the second half of each stretch so the colour turns at the joins.
      return t < 0.5 ? here : here + (next - here) * (t - 0.5) * 2;
    });

    // Consecutive points of one heat become one path, stroked once: fewer
    // strokes, and the curve's joins are the path's own round joins rather than
    // caps laid over each other. Where the heat turns, a piece stands alone
    // with a gradient along it.
    type Run = { points: L.Point[]; from: number; to: number };
    const runs: Run[] = [];
    const projected = points.map((latLng) => subpixelContainerPoint(map, latLng).add(pad));
    for (let k = 0; k < projected.length - 1; k += 1) {
      const from = shares[k]!;
      const to = shares[k + 1] ?? from;
      const last = runs[runs.length - 1];
      if (from === to && last && last.from === from && last.to === from) {
        last.points.push(projected[k + 1]!);
      } else {
        runs.push({ points: [projected[k]!, projected[k + 1]!], from, to });
      }
    }

    // One stroke per run for a layer: `whiten` 0 is the heat's colour, 1 white.
    const stroke = (
      target: CanvasRenderingContext2D,
      width: (share: number) => number,
      whiten: number
    ) => {
      target.lineCap = "round";
      target.lineJoin = "round";
      for (const run of runs) {
        const first = run.points[0]!;
        const last = run.points[run.points.length - 1]!;
        if (run.from === run.to) {
          target.strokeStyle = rampColorAt(drawing.colors, run.from, whiten, drawing.cores);
        } else {
          const gradient = target.createLinearGradient(first.x, first.y, last.x, last.y);
          gradient.addColorStop(0, rampColorAt(drawing.colors, run.from, whiten, drawing.cores));
          gradient.addColorStop(1, rampColorAt(drawing.colors, run.to, whiten, drawing.cores));
          target.strokeStyle = gradient;
        }
        target.lineWidth = width((run.from + run.to) / 2);
        target.beginPath();
        target.moveTo(first.x, first.y);
        for (let k = 1; k < run.points.length; k += 1) {
          target.lineTo(run.points[k]!.x, run.points[k]!.y);
        }
        target.stroke();
      }
    };

    const neon = routeNeon(!drawing.darkGround);
    halo.setTransform(haloRatio, 0, 0, haloRatio, 0, 0);
    halo.clearRect(0, 0, width, height);
    stroke(halo, (share) => neonWidths(heatWeight(share)).halo, 0);
    blurred.setTransform(1, 0, 0, 1, 0, 0);
    blurred.clearRect(0, 0, this.haloBlurred.width, this.haloBlurred.height);
    blurred.filter = `blur(${ROUTE_NEON.haloBlur * haloRatio}px)`;
    blurred.drawImage(this.halo, 0, 0);
    blurred.filter = "none";
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = neon.haloOpacity;
    context.drawImage(this.haloBlurred, 0, 0, canvas.width, canvas.height);
    context.restore();

    // The line in the heat's colour, then its core over every run of it — a
    // later run's line laid over an earlier run's core would cut the core at
    // each join.
    stroke(context, heatWeight, 0);
    stroke(context, (share) => neonWidths(heatWeight(share)).core, neon.coreWhiten);
    return ends;
  }
}

function createPainter(
  map: L.Map,
  route: RouteReplay,
  curve: SmoothPath,
  style: RouteStyle,
  drawing: RouteDrawing | undefined
): Painter {
  return drawing?.kind === "glow"
    ? new GlowPainter(map, route, drawing)
    : new LinePainter(map, route, curve, style, drawing?.stretchColors);
}

/** What the map's owner can ask of a route map once it is built. */
interface RouteMapControl {
  replay: () => void;
  redraw: (drawing: RouteDrawing | undefined) => void;
  /** The route's own colour, its ghost and its glow, for a new ground under them. */
  restyle: (style: RouteStyle) => void;
}

function RouteMapCanvas({
  route,
  scrollWheelZoom = false,
  interactive = true,
  visibleBand,
  baseLayer,
  animate = true,
  replayCeilingMs,
  replayToken = 0,
  drawing,
  ariaLabel
}: {
  route: RouteReplay;
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
  /** The longest the replay may run, in ms; see `replayDurationMs`. */
  replayCeilingMs?: number;
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
  // What the map on screen is drawn with, so the redraw effect below can tell
  // a change from what a rebuild has just drawn.
  const drawnRef = useRef(drawing);
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
    const { tile, ...initialStyle } = resolveMapStyle(theme, initialLayer);
    let style: RouteStyle = initialStyle;

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
    const ghostLine = new SubpixelPolyline(curve.points, {
      color: style.routeColor,
      weight: ROUTE_NEON.weight,
      opacity: ghostShown(drawingRef.current) ? style.ghostOpacity : 0,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(map);

    let painter = createPainter(map, route, curve, style, drawingRef.current);
    // A rebuild — a theme switch — can change the drawing in the same render;
    // it is drawn here, and must not be drawn again by the redraw effect, which
    // would also cut short the replay just begun.
    drawnRef.current = drawingRef.current;

    const start = route.latLngs[0]!;
    const end = route.latLngs[route.latLngs.length - 1]!;

    const startMarker = routeEndMarker(map, start, "start").addTo(map);

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
    const routeEnds = bindRouteEnds(map);
    // The heatmap's canvas is hidden through a zoom; the lines are not.
    const endsHideWithRoute = (next: RouteDrawing | undefined) =>
      routeEnds.hideWhileZooming(next?.kind === "glow");
    endsHideWithRoute(drawingRef.current);
    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    appliedBaseLayerRef.current = initialLayer;

    // The replay: a still half second when the map opens, then the line grows
    // at the pace the activity was done (sped up, linear, so a slow stretch
    // reads as slow) with the finish marker riding its head to the finish.
    const endMarker = routeEndMarker(map, end, "end");

    let animationFrame = 0;
    const replayMs = replayDurationMs(route.meters, replayCeilingMs);

    // The markers sit on the line as drawn, which the heatmap moves off the
    // recorded points.
    const paintAt = (progress: number) => {
      const ends = painter.paint(progress);
      startMarker.setLatLng(ends.start);
      return ends.head;
    };

    const showWhole = () => {
      window.cancelAnimationFrame(animationFrame);
      endMarker.setLatLng(paintAt(1)).addTo(map);
    };

    const play = (delayMs: number) => {
      window.cancelAnimationFrame(animationFrame);
      paintAt(0);
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
        endMarker.setLatLng(paintAt(progress));
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
        painter = createPainter(map, route, curve, style, next);
        endsHideWithRoute(next);
        ghostLine.setStyle({ opacity: ghostShown(next) ? style.ghostOpacity : 0 });
        showWhole();
      },
      restyle: (next) => {
        style = next;
        painter.restyle(next);
        ghostLine.setStyle({
          color: next.routeColor,
          opacity: ghostShown(drawingRef.current) ? next.ghostOpacity : 0
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
  }, [route, theme, scrollWheelZoom, interactive, visibleBand, animate, replayCeilingMs]);

  useEffect(() => {
    if (replayToken > 0) {
      controlRef.current?.replay();
    }
  }, [replayToken]);

  // Redraw in place, unless the build just drew this.
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

    const { tile, ...style } = resolveMapStyle(theme, baseLayer);
    // The base map has its own pane below every other layer, so the new one
    // cannot cover the route however late it is added, and `createBaseLayer`
    // rebinds the map's max zoom to the style it just built.
    const next = createBaseLayer(map, tile).addTo(map);
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = next;
    controlRef.current?.restyle(style);
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
      {t("activity.route.start")}
      <span className="activity-route-dot is-end" aria-hidden="true" />
      {t("activity.route.finish")}
    </span>
  );
}

/**
 * How a reading is written: pace as a clock per km or mile or, on a ride, as
 * speed; heart rate in bpm. `unit` false leaves the unit off, for the first
 * half of a range.
 */
function useReadout(metric: "pace" | "hr", speed: boolean) {
  const { unitSystem } = useUnitSystem();
  return (value: number, unit = true): string => {
    if (metric === "hr") {
      return unit ? `${Math.round(value)} bpm` : `${Math.round(value)}`;
    }
    if (speed) {
      const figure = formatDecimal(kmhToDisplaySpeed(3600 / value, unitSystem), 1);
      return unit ? `${figure} ${speedUnit(unitSystem)}` : figure;
    }
    const pace = formatPaceSecondsPerKm(value, unitSystem);
    return unit ? pace : pace.replace(/\s*\/\s*\S+$/, "");
  };
}

/** The ramp under a route coloured without zones, with what its two ends stand for. */
function RouteColorLegend({
  metric,
  speed,
  coloring,
  ramp
}: {
  metric: "pace" | "hr";
  speed: boolean;
  coloring: RouteColoring;
  ramp: readonly string[];
}) {
  const read = useReadout(metric, speed);
  return (
    <span
      className="activity-route-color-legend"
      aria-label={t("activity.route.range", {
        metric: metricLabel(metric, speed),
        low: read(coloring.low),
        high: read(coloring.high)
      })}
    >
      <span>{read(coloring.low)}</span>
      <span className="activity-route-color-ramp" aria-hidden="true">
        {ramp.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
      </span>
      <span>{read(coloring.high)}</span>
    </span>
  );
}

/** Elevation's fixed scale: the stops' colours, placed at their heights. */
function RouteElevationLegend({ lightGround }: { lightGround: boolean }) {
  const { unitSystem } = useUnitSystem();
  const colors = elevationColors(lightGround);
  const top = ELEVATION_STOPS[ELEVATION_STOPS.length - 1];
  const stops = ELEVATION_STOPS.map(
    (meters, index) => `${colors[index]} ${(meters / top) * 100}%`
  ).join(", ");
  const heights = ELEVATION_STOPS.map((meters) => formatElevationMeters(meters, unitSystem));

  return (
    <span
      className="activity-route-color-legend"
      aria-label={t("activity.route.elevationScale", { heights: heights.join(", ") })}
      title={heights.join(" · ")}
    >
      <span>{heights[0]}</span>
      <span
        className="activity-route-color-gradient"
        aria-hidden="true"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      />
      <span>{heights[heights.length - 1]}+</span>
    </span>
  );
}

/**
 * COROS's buckets for the metric in the zone bar's colours and names, slowest
 * or lowest first, each one's bounds on hover as COROS scored the activity.
 */
function RouteZoneLegend({
  metric,
  speed,
  coloring
}: {
  metric: "pace" | "hr";
  speed: boolean;
  coloring: RouteZoneColoring;
}) {
  const read = useReadout(metric, speed);
  const { buckets } = coloring;
  // Bucket 0 has no floor and the top bucket no honest ceiling — COROS fills
  // it with a sentinel (404 bpm, 2:42/km) — so both read open-ended. A pace
  // bucket's `low` is its fast edge.
  const bounds = ({ index, low, high }: (typeof buckets)[number], position: number) => {
    const bottom = index === 0;
    const top = position === buckets.length - 1;
    if (metric === "hr") {
      if (bottom) return high !== undefined ? `under ${read(high)}` : undefined;
      if (top) return low !== undefined ? `over ${read(low)}` : undefined;
      return low !== undefined && high !== undefined
        ? `${read(low, false)}–${read(high)}`
        : undefined;
    }
    if (bottom) {
      return low === undefined ? undefined : speed ? `under ${read(low)}` : `slower than ${read(low)}`;
    }
    if (top) {
      return high === undefined ? undefined : speed ? `over ${read(high)}` : `faster than ${read(high)}`;
    }
    if (low === undefined || high === undefined) {
      return undefined;
    }
    return speed ? `${read(high, false)}–${read(low)}` : `${read(low, false)}–${read(high)}`;
  };
  const first = zoneLabel(buckets[0]!.index);
  const last = zoneLabel(buckets[buckets.length - 1]!.index);

  return (
    <span
      className="activity-route-color-legend"
      aria-label={t("activity.route.zonesRange", { metric: metricLabel(metric, speed), first, last })}
    >
      <span>{first}</span>
      <span className="activity-route-color-ramp">
        {buckets.map((bucket, position) => {
          const range = bounds(bucket, position);
          const name = zoneLabel(bucket.index);
          return (
            <i
              key={bucket.index}
              style={{ background: zoneColor(bucket.index) }}
              title={range ? `${name} · ${range}` : name}
            />
          );
        })}
      </span>
      <span>{last}</span>
    </span>
  );
}

/** The key to what Performance is colouring: the ramp, the zones or the heights. */
function RouteColoringKey({
  analysis,
  lightGround
}: {
  analysis: RouteAnalysis;
  lightGround: boolean;
}) {
  const { view, metric, speed } = analysis;
  if (!view) {
    return null;
  }
  const timed = metric === "pace" ? "pace" : "hr";
  return view.kind === "elevation" ? (
    <RouteElevationLegend lightGround={lightGround} />
  ) : view.kind === "zones" ? (
    <RouteZoneLegend metric={timed} speed={speed} coloring={view.coloring} />
  ) : (
    <RouteColorLegend
      metric={timed}
      speed={speed}
      coloring={view.coloring}
      ramp={routeRamp(lightGround)}
    />
  );
}

interface RouteMapLayers {
  baseLayer: BaseLayerId;
  setBaseLayer: (layer: BaseLayerId) => void;
  /** How the route is coloured, as picked — before falling back to what this activity has. */
  colorMode: RouteColorMode;
  setColorMode: (mode: RouteColorMode) => void;
  metric: RouteMetric;
  setMetric: (metric: RouteMetric) => void;
}

/**
 * The layer choices — the base map and how the route is coloured — held by
 * whatever owns both the small map (or the cover) and the full map it opens,
 * so a pick made in one shows in the other without a remount. A preference
 * is read once per hook, so two holders would not hear each other.
 */
function useRouteMapLayers(): RouteMapLayers {
  const [baseLayer, setBaseLayer] = useBaseLayerPreference(
    ACTIVITY_ROUTE_BASE_LAYER_PREFERENCE
  );
  const [colorMode, setColorMode] = useSelectionPreference(ROUTE_COLOR_MODE_PREFERENCE);
  const [metric, setMetric] = useSelectionPreference(ROUTE_METRIC_PREFERENCE);
  return { baseLayer, setBaseLayer, colorMode, setColorMode, metric, setMetric };
}

/**
 * What a route can be coloured by under the layer choices, worked out once by
 * whatever owns a map and the full map it opens, and read by both: what
 * Performance can show for each metric, the mode and metric after falling back
 * to what this activity recorded, the heat, and the layer menu's section.
 */
interface RouteAnalysis {
  performance: Record<RouteMetric, PerformanceView>;
  metric: RouteMetric;
  mode: RouteColorMode;
  /** What Performance draws, when it is the mode. */
  view: ShownView | null;
  /** The pass count, when the heatmap is the mode. */
  heat: RouteHeat | null;
  /** A ride: its pace is read out as speed. */
  speed: boolean;
  layerSection: MapLayerSection<RouteColorMode>;
}

function useRouteAnalysis(
  route: RouteReplay,
  detail: RouteDetail | undefined,
  layers: RouteMapLayers
): RouteAnalysis {
  const speed = isSpeedSport(detail?.sportType, detail?.sportName);
  const { locale } = useI18n();
  const performance = useMemo((): Record<RouteMetric, PerformanceView> => {
    const series = detail?.series ?? [];
    const timed = (metric: "pace" | "hr"): PerformanceView => {
      const key = metricKey(metric, speed);
      const stretches = stretchValues(route, series, metric);
      if ("missing" in stretches) {
        return stretches.missing === "unrecorded"
          ? { kind: "none", reason: t(`activity.route.none.${key}` as const), recorded: false }
          : {
              kind: "none",
              reason: t(`activity.route.untimed.${key}` as const),
              recorded: true
            };
      }
      const zones = zoneColoring(
        stretches.values,
        metric,
        performanceZones(metric, detail, speed)
      );
      return zones
        ? { kind: "zones", coloring: zones }
        : { kind: "ramp", coloring: performanceColoring(stretches.values, metric) };
    };
    const heights = elevationColoring(route);
    return {
      pace: timed("pace"),
      hr: timed("hr"),
      elevation: heights
        ? { kind: "elevation", heights }
        : { kind: "none", reason: t("activity.route.none.elevation"), recorded: false }
    };
    // The reasons are words, so a new language rebuilds them.
  }, [route, detail, speed, locale]);

  // A choice this activity cannot show falls back rather than drawing nothing:
  // a metric it did not record to the first one it did, and Performance with
  // nothing recorded at all to the plain route.
  const shows = (candidate: RouteMetric) => performance[candidate].kind !== "none";
  const metric = shows(layers.metric)
    ? layers.metric
    : ROUTE_METRICS.find(shows) ?? layers.metric;
  const mode =
    layers.colorMode === "performance" && !shows(metric) ? "route" : layers.colorMode;
  const current = performance[metric];
  const view = mode === "performance" && current.kind !== "none" ? current : null;
  // Counted only once the heatmap is asked for: it samples the route every 2 m.
  const heatmapShown = mode === "heatmap";
  const heat = useMemo(() => (heatmapShown ? routeHeat(route) : null), [route, heatmapShown]);

  const nothingShown = !ROUTE_METRICS.some(shows);
  const somethingRecorded = ROUTE_METRICS.some((candidate) => {
    const entry = performance[candidate];
    return entry.kind === "none" && entry.recorded;
  });
  const layerSection: MapLayerSection<RouteColorMode> = {
    title: t("activity.m.route"),
    value: mode,
    onChange: layers.setColorMode,
    options: [
      {
        value: "route",
        label: t("activity.m.route"),
        description: t("activity.route.layer.route.description")
      },
      {
        value: "performance",
        label: t("activity.route.layer.performance"),
        description: !nothingShown
          ? t("activity.route.layer.performance.description", { metric: metricLabel("pace", speed) })
          : somethingRecorded
            ? t("activity.route.layer.nothingPlaced")
            : t("activity.route.layer.nothingRecorded"),
        disabled: nothingShown
      },
      {
        value: "heatmap",
        label: t("activity.route.layer.heatmap"),
        description: t("activity.route.layer.heatmap.description")
      }
    ]
  };

  return { performance, metric, mode, view, heat, speed, layerSection };
}

/** How one map draws the analysed route on its ground: the colours read on it. */
function useRouteDrawing(
  { view, heat }: RouteAnalysis,
  lightGround: boolean
): RouteDrawing | undefined {
  return useMemo((): RouteDrawing | undefined => {
    if (heat) {
      return {
        kind: "glow",
        heat,
        colors: heatColors(lightGround),
        cores: heatCores(),
        darkGround: !lightGround
      };
    }
    if (!view) {
      return undefined;
    }
    if (view.kind === "elevation") {
      return {
        kind: "lines",
        stretchColors: view.heights.map((meters) =>
          meters === null
            ? null
            : elevationColor(
                Math.round(meters / ELEVATION_COLOR_STEP_M) * ELEVATION_COLOR_STEP_M,
                lightGround
              )
        )
      };
    }
    const ramp = routeRamp(lightGround);
    const colorOf =
      view.kind === "zones" ? zoneColor : (step: number) => ramp[step]!;
    return {
      kind: "lines",
      stretchColors: view.coloring.steps.map((step) => (step === null ? null : colorOf(step)))
    };
  }, [view, heat, lightGround]);
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
  onExpand,
  onReplay,
  layerSection
}: {
  route: RouteReplay;
  layers: RouteMapLayers;
  /** How the route is coloured, offered in the layer menu below the base maps. */
  layerSection?: MapLayerSection<RouteColorMode>;
  className: string;
  scrollWheelZoom?: boolean;
  animate?: boolean;
  replayToken?: number;
  drawing?: RouteDrawing;
  ariaLabel: string;
  /** Present on a map that opens a bigger one: a button over the layer picker. */
  onExpand?: () => void;
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
      {onExpand ? (
        // The layer picker's own look, like Replay, and before it in the tab
        // order as it is on screen.
        <button
          type="button"
          className="basemap-toggle map-expand"
          onClick={onExpand}
          title={t("activity.route.expand")}
          aria-label={t("activity.route.expand")}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      ) : null}
      <MapLayerControl
        value={layers.baseLayer}
        onChange={layers.setBaseLayer}
        section={layerSection}
      />
      {onReplay ? (
        // The layer picker's own look: one kind of button in that corner.
        <button
          type="button"
          className="basemap-toggle map-replay"
          onClick={onReplay}
          title={t("activity.route.replay")}
          aria-label={t("activity.route.replay")}
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
 * every way in — the side-panel map's Expand button and a route cover —
 * so the two cannot drift apart. It reads the analysis its opener already made.
 */
function RouteMapModal({
  route,
  analysis,
  layers,
  onClose
}: {
  route: RouteReplay;
  analysis: RouteAnalysis;
  layers: RouteMapLayers;
  onClose: () => void;
}) {
  const [replayToken, setReplayToken] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lightGround = isLightBaseLayer(layers.baseLayer);
  const drawing = useRouteDrawing(analysis, lightGround);
  const { performance, metric, mode, speed, layerSection } = analysis;

  useEffect(() => {
    // Captured on the window and stopped there: the screen underneath may
    // answer Escape itself — the Calendar's day panel closes on it — and one
    // key press should close one thing. An open layer menu is that one thing:
    // the Escape is left to it.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (dialogRef.current && hasOpenLayerMenu(dialogRef.current)) {
        return;
      }
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      ref={dialogRef}
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
            <h2 id="activity-route-modal-title">{t("activity.m.route")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("activity.route.closeExpanded")}
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
            ariaLabel={t("activity.route.expandedLabel")}
            layerSection={layerSection}
          />
          <div className="activity-route-footer">
            <div className="activity-route-coloring">
              {mode === "performance" ? (
                <OptionGroup
                  label={t("activity.route.metric")}
                  value={metric}
                  options={ROUTE_METRICS.map((candidate) => {
                    const entry = performance[candidate];
                    return {
                      value: candidate,
                      label: metricLabel(candidate, speed),
                      disabled: entry.kind === "none",
                      ...(entry.kind === "none" ? { title: entry.reason } : {})
                    };
                  })}
                  onChange={layers.setMetric}
                />
              ) : null}
              <RouteColoringKey analysis={analysis} lightGround={lightGround} />
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
 * The points a route map draws: the track's own route where the main process
 * made one, else the shared points — a track merged from two sources.
 */
function routePoints(track?: TrainingHubActivityTrack): TrainingHubTrackPoint[] {
  return track?.route ?? track?.points ?? [];
}

/**
 * Whether a track has enough located points to draw a route at all — the same
 * test `buildRouteReplay` applies, without building the geometry the cover
 * is about to build anyway.
 */
export function hasActivityRoute(track?: TrainingHubActivityTrack): boolean {
  let located = 0;
  for (const point of routePoints(track)) {
    if (point.lat !== undefined && point.lon !== undefined && ++located >= 2) {
      return true;
    }
  }
  return false;
}

function useRouteReplay(track?: TrainingHubActivityTrack): RouteReplay | null {
  return useMemo(() => buildRouteReplay(routePoints(track)), [track]);
}

export function ActivityRouteMap({ track, detail }: ActivityRouteMapProps) {
  const route = useRouteReplay(track);

  if (!route) {
    return (
      <div className="activity-route-empty">
        <MapPin size={18} aria-hidden="true" />
        <p>{t("activity.route.noTrack")}</p>
      </div>
    );
  }

  return <RoutePreviewMap route={route} detail={detail} />;
}

/** The side-panel map once there is a route, drawn the way the layer menu says. */
function RoutePreviewMap({ route, detail }: { route: RouteReplay; detail?: RouteDetail }) {
  const layers = useRouteMapLayers();
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const analysis = useRouteAnalysis(route, detail, layers);
  const lightGround = isLightBaseLayer(layers.baseLayer);
  const drawing = useRouteDrawing(analysis, lightGround);

  return (
    <div className="activity-route-map">
      <RouteMapFrame
        route={route}
        layers={layers}
        className="activity-route-map-frame"
        // A quick look: the whole route at once. The full map replays it.
        animate={false}
        drawing={drawing}
        layerSection={analysis.layerSection}
        ariaLabel={t("activity.route.mapLabel")}
        onExpand={() => setExpanded(true)}
      />
      {expanded ? (
        <RouteMapModal
          route={route}
          analysis={analysis}
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
 * a click anywhere on it opens the full map. Its corner holds Expand and the
 * layer picker, as the side-panel map's does, but the picker offers only how
 * the route is coloured: the cover is drawn on the theme's own base map. Its
 * replay is kept to `COVER_REPLAY_MAX_MS`. Renders nothing without a route —
 * the caller decides what the heading looks like then.
 */
export function ActivityRouteCover({
  track,
  detail,
  className,
  visibleBand
}: ActivityRouteCoverProps) {
  const route = useRouteReplay(track);

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
  route: RouteReplay;
  detail?: RouteDetail;
  className?: string;
  visibleBand?: number;
}) {
  const layers = useRouteMapLayers();
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const [creditOpen, toggleCredit] = useFoldingCredit();
  const analysis = useRouteAnalysis(route, detail, layers);
  // The cover draws on the theme's own base map, whatever the full map shows.
  const { theme } = useTheme();
  const drawing = useRouteDrawing(analysis, isLightBaseLayer(themeBaseLayer(theme)));
  const coverRef = useRef<HTMLDivElement>(null);
  // A press that closes the layer menu closes only the menu: the click it
  // ends in does not open the full map as well. Read on the way down, before
  // the menu's own listener on `document` has closed it.
  const menuWasOpenRef = useRef(false);

  return (
    <>
      {/* The map itself is decorative; the buttons are the way in for a
          keyboard, and the whole picture is the way in for a pointer. */}
      <div
        ref={coverRef}
        className={`activity-route-cover${creditOpen ? " is-credit-open" : ""}${
          className ? ` ${className}` : ""
        }`}
        onPointerDownCapture={() => {
          menuWasOpenRef.current = coverRef.current ? hasOpenLayerMenu(coverRef.current) : false;
        }}
        onClick={() => {
          const closedMenu = menuWasOpenRef.current;
          menuWasOpenRef.current = false;
          if (!closedMenu) {
            setExpanded(true);
          }
        }}
      >
        <div className="activity-route-cover-map" aria-hidden="true">
          <RouteMapCanvas
            route={route}
            interactive={false}
            visibleBand={visibleBand}
            replayCeilingMs={COVER_REPLAY_MAX_MS}
            drawing={drawing}
            ariaLabel={t("activity.m.route")}
          />
        </div>
        <button
          type="button"
          className="basemap-toggle map-expand"
          title={t("activity.route.expand")}
          aria-label={t("activity.route.expand")}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(true);
          }}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
        {/* A click in the picker or its menu is the picker's, not the cover's. */}
        <div className="activity-route-cover-layers" onClick={(event) => event.stopPropagation()}>
          <MapLayerControl section={analysis.layerSection} />
        </div>
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
          analysis={analysis}
          layers={layers}
          onClose={closeExpanded}
        />
      ) : null}
    </>
  );
}
