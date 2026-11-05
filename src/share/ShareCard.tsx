import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import wreathArt from "../assets/share/wreath.webp";
import recordArt from "../assets/training-hub/pr-laurel.webp";
import { BODY_OUTLINE, BODY_SHAPES, BODY_VIEW_BOX, type BodyView } from "../calendar/bodyShapes";
import { MUSCLE_SLUG, MUSCLE_VIEW } from "../calendar/bodyFigure";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import { createBaseLayer } from "../mapBase/baseLayers";
import { BASE_LAYERS } from "../mapBase/constants";
import { STAGE_NUMERALS } from "../records/labours";
import { LABOUR_ART, LaurelWreath } from "../records/recordsIcons";
import type { MuscleId } from "../strength/muscles";
import { activityChannelColors } from "../training/activityChannels";
import { performanceStretchColors } from "../training/components/routePerformance";
import {
  SHARE_FORMATS,
  SHARE_MAP_CREDITS,
  SHARE_MAX_STATS,
  fitRoute,
  groundTone,
  mixHexColor,
  photoCover,
  placeBox,
  plainBackground,
  privateRoute,
  routeInk,
  routeOutline,
  shownBackground,
  shownRouteStyle,
  statColumns,
  type ShareRect
} from "./shareModel";
import { drawShareRoute } from "./shareRoute";
import type { ShareChart, SharePayload, SharePhoto, SharePlaced, ShareStat, ShareSwim } from "./shareTypes";
import "./share.css";

/** A map's projection; null once that map is gone, so a stale one is never asked. */
type Projection = (point: [number, number]) => [number, number] | null;

interface ShareCardProps {
  payload: SharePayload;
  /** Drawing the file: called once the map, fonts and pictures are all painted. */
  onReady?: () => void;
  /** Where the route or the muscle map landed, for the preview to grab; null when nothing can be moved. */
  onPlaced?: (placed: SharePlaced | null) => void;
}

/** How far the route keeps from the edges of the space it is fitted into. */
const ZONE_MARGIN_X = 40;
const ZONE_MARGIN_Y = 30;
/** A map that never settles is drawn as it is rather than holding the image forever. */
const MAP_SETTLE_LIMIT_MS = 20_000;
const BODY_VIEWS: readonly BodyView[] = ["front", "back"];
const MUSCLES = Object.keys(MUSCLE_VIEW) as MuscleId[];
/** The two figures side by side, in the artwork's own units: 724 × 1448 each, with a gap between. */
const BODY_GAP = 40;
const BODY_WIDTH = 2 * 724 + BODY_GAP;
const BODY_HEIGHT = 1448;
const CHART_HEIGHT = 130;

/** Waits for a base map's tiles: a raster layer's `load`, a vector map's `idle`. */
function whenSettled(layer: L.Layer): Promise<void> {
  return new Promise((resolve) => {
    const limit = window.setTimeout(resolve, MAP_SETTLE_LIMIT_MS);
    const done = () => {
      window.clearTimeout(limit);
      // The vector plugin follows Leaflet on a 32 ms throttle; give it a frame.
      window.setTimeout(resolve, 80);
    };
    const vector = (
      layer as { getMaplibreMap?: () => { loaded(): boolean; areTilesLoaded(): boolean; once(event: string, run: () => void): void } }
    ).getMaplibreMap?.();
    if (vector) {
      if (vector.loaded() && vector.areTilesLoaded()) done();
      else vector.once("idle", done);
      return;
    }
    if (layer instanceof L.GridLayer && layer.isLoading()) {
      layer.once("load", done);
      return;
    }
    done();
  });
}

interface ShareCardMapProps {
  latLngs: [number, number][];
  style: keyof typeof SHARE_MAP_CREDITS;
  fit: ShareRect;
  width: number;
  height: number;
  capture: boolean;
  onProjection: (projection: Projection | null) => void;
  onSettled: () => void;
}

/**
 * The base map under the route, framed so the route fills the space the words
 * leave free. The map is built once per style and re-framed when the space
 * moves, rather than rebuilt: a rebuild reloads every tile.
 */
function ShareCardMap({ latLngs, style, fit, width, height, capture, onProjection, onSettled }: ShareCardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onProjection, onSettled });
  callbacks.current = { onProjection, onSettled };
  const mapRef = useRef<{ map: L.Map; layer: L.Layer } | null>(null);
  const [built, setBuilt] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      zoomSnap: 0
    });
    const layer = createBaseLayer(map, BASE_LAYERS[style], { capture }).addTo(map);
    mapRef.current = { map, layer };
    setBuilt((count) => count + 1);
    return () => {
      mapRef.current = null;
      callbacks.current.onProjection(null);
      map.remove();
    };
  }, [style, capture]);

  useEffect(() => {
    const current = mapRef.current;
    if (!current) return;
    const { map, layer } = current;
    map.invalidateSize({ pan: false });
    map.fitBounds(L.latLngBounds(latLngs), {
      paddingTopLeft: [fit.x, fit.y],
      paddingBottomRight: [Math.max(0, width - fit.x - fit.w), Math.max(0, height - fit.y - fit.h)],
      animate: false
    });
    let live = true;
    callbacks.current.onProjection((point) => {
      if (!live || mapRef.current?.map !== map) return null;
      const projected = map.latLngToContainerPoint(point);
      return [projected.x, projected.y];
    });
    void whenSettled(layer).then(() => {
      if (live) callbacks.current.onSettled();
    });
    return () => {
      live = false;
    };
  }, [built, latLngs, fit.x, fit.y, fit.w, fit.h, width, height]);

  return <div ref={containerRef} className="share-card-map" aria-hidden="true" />;
}

function sameRect(a: ShareRect | null, b: ShareRect): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function StatValue({ stat }: { stat: ShareStat }) {
  return (
    <>
      {stat.value}
      {stat.unit ? <small>{stat.unit}</small> : null}
    </>
  );
}

function StatCells({ stats, divided }: { stats: ShareStat[]; divided: boolean }) {
  const columns = statColumns(stats.length);
  return (
    <div className={`share-stats${divided ? " is-divided" : ""}`} style={{ "--share-columns": columns } as CSSProperties}>
      {stats.map((stat, index) => (
        <div key={stat.id} className={`share-stat${divided && index % columns === 0 ? " is-row-start" : ""}`}>
          <span className="share-label">{stat.label}</span>
          <span className="share-stat-value">
            <StatValue stat={stat} />
          </span>
        </div>
      ))}
    </div>
  );
}

const ChartStrip = memo(function ChartStrip({ chart, color, lightGround }: { chart: ShareChart; color: string; lightGround: boolean }) {
  const channels = activityChannelColors(lightGround ? "paper" : "dark");
  const stroke =
    chart.kind === "hr"
      ? channels.hr.stroke
      : chart.kind === "power"
        ? channels.power.stroke
        : chart.kind === "pace" || chart.kind === "speed"
          ? channels.pace.stroke
          : chart.kind === "elevation"
            ? lightGround ? "#26998e" : "#3dbbae"
            : color;
  const values = chart.values;
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  let body: ReactNode;
  if (chart.bars) {
    const gap = 10;
    const width = (1000 - gap * (values.length - 1)) / values.length;
    body = values.map((value, index) => {
      const share = (value - low) / span;
      const barHeight = CHART_HEIGHT * (0.28 + 0.72 * share);
      return (
        <rect
          key={index}
          x={index * (width + gap)}
          y={CHART_HEIGHT - barHeight}
          width={width}
          height={barHeight}
          fill={stroke}
          fillOpacity={0.4 + 0.6 * share}
        />
      );
    });
  } else {
    const y = (value: number) => CHART_HEIGHT - 6 - (CHART_HEIGHT - 14) * ((value - low) / span);
    const line = values
      // i18n-ignore: SVG path data, not digits anyone reads
      .map((value, index) => `${index ? "L" : "M"}${((index / Math.max(1, values.length - 1)) * 1000).toFixed(1)},${y(value).toFixed(1)}`)
      .join("");
    body = (
      <>
        <path d={`${line}L1000,${CHART_HEIGHT}L0,${CHART_HEIGHT}Z`} fill={stroke} fillOpacity={0.24} />
        <path d={line} fill="none" stroke={stroke} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </>
    );
  }
  return (
    <div className="share-chart">
      <div className="share-chart-head">
        <span>{chart.title}</span>
        <span>{chart.note}</span>
      </div>
      <svg viewBox={`0 0 1000 ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {body}
      </svg>
    </div>
  );
});

/** One side of the muscle map: the app's own figure, the worked muscles in the strength heat ramp. */
const BodyFigure = memo(function BodyFigure({ view, heat }: { view: BodyView; heat: Partial<Record<MuscleId, number>> }) {
  return (
    <svg className="share-body-figure" viewBox={BODY_VIEW_BOX[view]} aria-hidden="true">
      <path className="share-body-outline" d={BODY_OUTLINE[view]} />
      {MUSCLES.filter((muscle) => MUSCLE_VIEW[muscle] === view).map((muscle) => {
        const level = heat[muscle] ?? 0;
        return (BODY_SHAPES[view][MUSCLE_SLUG[muscle]] ?? []).map((d, index) => (
          <path key={`${muscle}-${index}`} d={d} className={level > 0 ? `share-heat-${level}` : "share-body-muscle"} />
        ));
      })}
    </svg>
  );
});

const SwimLengths = memo(function SwimLengths({ swim }: { swim: ShareSwim }) {
  const speeds = swim.lengths.map((length) => length.speed);
  const low = Math.min(...speeds);
  const span = Math.max(...speeds) - low || 1;
  const gap = 6;
  const barWidth = (1000 - gap * (speeds.length - 1)) / Math.max(1, speeds.length);
  return (
    <div className="share-graphic share-graphic-swim">
      <div className="share-chart-head">
        <span>{swim.title}</span>
        <span>{swim.note}</span>
      </div>
      <svg viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
        {swim.lengths.map((length, index) => {
          const share = (length.speed - low) / span;
          const barHeight = 400 * (0.35 + 0.65 * share);
          return (
            <rect
              key={index}
              x={index * (barWidth + gap)}
              y={400 - barHeight}
              width={barWidth}
              height={barHeight}
              fill={length.color}
              fillOpacity={0.55 + 0.45 * share}
            />
          );
        })}
      </svg>
      <div className="share-legend">
        {swim.legend.map((entry) => (
          <span key={entry.label}>
            <i style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
});

/** A photo covering the card, zoomed and moved, with its move kept so no edge shows. */
function photoStyle(photo: SharePhoto, width: number, height: number): CSSProperties {
  const drawn = photoCover(photo, width, height);
  return {
    width: drawn.width,
    height: drawn.height,
    left: (width - drawn.width) / 2 + drawn.panX,
    top: (height - drawn.height) / 2 + drawn.panY
  };
}

/**
 * The shade under the words, as deep as the words go, read off where the free
 * space ends: a fixed share either left a tall block of words on a busy map
 * bare, or shaded the map where nothing was written.
 */
function scrimBackground(zone: ShareRect, width: number, height: number, lightGround: boolean, landscape: boolean, darken?: number): string {
  const colour = lightGround ? "241, 240, 235" : "5, 8, 11";
  const strength = lightGround ? 0.9 : 0.84;
  const shade = (alpha: number) => `rgba(${colour}, ${Math.round(alpha * 100) / 100})`;
  const fade = 0.12;
  const stop = (share: number) => `${Math.min(100, Math.round(share * 1000) / 10)}%`;
  const layers: string[] = [];
  if (landscape) {
    const reach = zone.x / width;
    layers.push(
      `linear-gradient(to bottom, ${shade(0.55)} 0%, ${shade(0)} 18%)`,
      `linear-gradient(to right, ${shade(strength)} 0%, ${shade(strength * 0.85)} ${stop(reach)}, ${shade(0)} ${stop(reach + fade)})`
    );
  } else {
    const top = zone.y / height;
    const bottom = (height - zone.y - zone.h) / height;
    layers.push(
      `linear-gradient(to bottom, ${shade(strength)} 0%, ${shade(strength * 0.7)} ${stop(top)}, ${shade(0)} ${stop(top + fade)})`,
      `linear-gradient(to top, ${shade(strength)} 0%, ${shade(strength * 0.85)} ${stop(bottom)}, ${shade(0)} ${stop(bottom + fade)})`
    );
  }
  if (darken) {
    layers.push(`linear-gradient(rgba(0, 0, 0, ${darken / 100}), rgba(0, 0, 0, ${darken / 100}))`);
  }
  return layers.join(", ");
}

/** The image of one session at the size of the file. */
export function ShareCard({ payload, onReady, onPlaced }: ShareCardProps) {
  useI18n();
  const { session, options, edits } = payload;
  const { width, height, scale, pad, padTop, padBottom } = SHARE_FORMATS[options.format];
  const landscape = width > height;
  const tall = height / width >= 1.45;
  const background = shownBackground(options, session);
  const lightGround = groundTone(options, session) === "light";
  const capture = Boolean(onReady);
  const route = session.route;
  const showMap = background === "map" && Boolean(route);
  const placement = edits.placement;

  const zoneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<ShareRect | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [mapSettled, setMapSettled] = useState(false);
  const [fontsReady, setFontsReady] = useState(!capture);
  const [routeDrawn, setRouteDrawn] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!capture) return;
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) setFontsReady(true);
    });
    return () => {
      live = false;
    };
  }, [capture]);

  // The free space is wherever the words end up, so it is read off the laid-out card.
  useLayoutEffect(() => {
    const element = zoneRef.current;
    if (!element) return;
    const next = { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
    if (!sameRect(zone, next)) setZone(next);
  });

  const fit = useMemo<ShareRect | null>(
    () =>
      zone
        ? {
            x: zone.x + ZONE_MARGIN_X,
            y: zone.y + ZONE_MARGIN_Y,
            w: Math.max(120, zone.w - 2 * ZONE_MARGIN_X),
            h: Math.max(120, zone.h - 2 * ZONE_MARGIN_Y)
          }
        : null,
    [zone]
  );
  const bounds = useMemo<ShareRect>(
    () => ({ x: pad, y: padTop, w: width - 2 * pad, h: height - padTop - padBottom }),
    [pad, padTop, padBottom, width, height]
  );

  const handleProjection = useCallback((next: Projection | null) => {
    setMapSettled(false);
    setProjection(() => next);
  }, []);
  const handleSettled = useCallback(() => setMapSettled(true), []);

  // The muscle map stands where the route would: in the free space, sized and moved by hand.
  const strength = route ? undefined : session.strength;
  const bodyBox = strength && options.graphicBody && fit ? placeBox(BODY_WIDTH, BODY_HEIGHT, fit, bounds, placement) : null;

  // What of the route is shown — all of it, or what is left once its ends are
  // hidden — projected once, and its colours worked out once: a drag only
  // places it again.
  const line = useMemo(
    () => (route ? (options.privacy ? privateRoute(route.latLngs, route.distances) : { latLngs: route.latLngs, first: 0 }) : null),
    [route, options.privacy]
  );
  const outline = useMemo(() => (line && !showMap ? routeOutline(line.latLngs) : null), [line, showMap]);
  const routeStyle = route ? shownRouteStyle(options, route) : null;
  const routeMode = routeStyle?.mode ?? options.routeMode;
  const routeMetric = routeStyle?.metric;
  const lineColors = useMemo(() => {
    const view = route && line && routeMode === "performance" && routeMetric ? route.performance[routeMetric] : undefined;
    if (!view || view.kind === "none" || !line) return null;
    return performanceStretchColors(view, lightGround).slice(line.first, line.first + line.latLngs.length - 1);
  }, [route, line, routeMode, routeMetric, lightGround]);

  const color = routeInk(options, session);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !route || !fit) return;
    if (!options.routeShown || !line) {
      drawShareRoute(canvas, [], null, { mode: routeMode, lightGround, color, scale, markers: false });
      setRouteDrawn(true);
      if (!showMap) onPlaced?.(null);
      return;
    }
    let points: [number, number][];
    let applied = { dx: placement.dx, dy: placement.dy };
    if (showMap) {
      if (!projection) return;
      const projected = line.latLngs.map(projection);
      if (projected.some((point) => point === null)) return;
      points = projected as [number, number][];
    } else {
      if (!outline) return;
      const placed = fitRoute(outline, fit, bounds, placement);
      points = placed.points;
      applied = { dx: placed.dx, dy: placed.dy };
    }
    drawShareRoute(canvas, points, lineColors, { mode: routeMode, lightGround, color, scale, markers: !options.privacy });
    setRouteDrawn(true);
    if (!showMap) onPlaced?.({ kind: "line", points, ...applied });
  }, [
    route,
    line,
    outline,
    lineColors,
    fit,
    bounds,
    projection,
    showMap,
    options.routeShown,
    routeMode,
    options.privacy,
    lightGround,
    color,
    scale,
    placement,
    onPlaced
  ]);

  // Only a route on a plain or photo ground, or the muscle map, can be moved.
  const movable = bodyBox !== null || (Boolean(route) && options.routeShown && !showMap);
  useEffect(() => {
    if (bodyBox) {
      onPlaced?.({ kind: "box", rect: { x: bodyBox.x, y: bodyBox.y, w: bodyBox.w, h: bodyBox.h }, dx: bodyBox.dx, dy: bodyBox.dy });
    } else if (!movable) {
      onPlaced?.(null);
    }
  }, [bodyBox?.x, bodyBox?.y, bodyBox?.w, bodyBox?.h, bodyBox?.dx, bodyBox?.dy, movable, onPlaced]);

  // The file is captured only once everything that loads has loaded.
  useEffect(() => {
    if (!onReady || readyRef.current || !fontsReady || !zone) return;
    if (route && !routeDrawn) return;
    if (showMap && !mapSettled) return;
    const images = Array.from(cardRef.current?.querySelectorAll("img") ?? []);
    let live = true;
    void Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!live || readyRef.current) return;
          readyRef.current = true;
          onReady();
        })
      );
    });
    return () => {
      live = false;
    };
  }, [onReady, fontsReady, zone, route, routeDrawn, showMap, mapSettled]);

  const heroStat = session.stats.find((stat) => stat.id === options.heroId);
  const grid = options.statIds
    .filter((id) => id !== options.heroId)
    .map((id) => session.stats.find((stat) => stat.id === id))
    .filter((stat): stat is ShareStat => Boolean(stat))
    .slice(0, SHARE_MAX_STATS);
  const figures = heroStat ? [heroStat, ...grid] : grid;
  const name = edits.name.trim() || session.name;
  const eyebrowParts = [...(options.showKind ? [session.kind] : []), ...(options.showDate ? [session.date] : [])];
  const place = options.showPlace && session.place ? session.place : undefined;
  const eyebrow = [...eyebrowParts, ...(place && options.layout !== "poster" ? [place] : [])].join(" · ");
  const chart = options.chartShown ? session.charts.find((candidate) => candidate.kind === options.chartKind) : undefined;
  const chartNode = chart ? <ChartStrip chart={chart} color={session.color} lightGround={lightGround} /> : null;

  const chips: ReactNode[] = [];
  if (options.showLabel && session.trainingLabel && options.layout !== "poster") {
    chips.push(
      <span key="label" className="share-chip">
        <i style={{ background: session.trainingLabel.color }} />
        {session.trainingLabel.name}
      </span>
    );
  }
  if (options.showRecord && session.record) {
    chips.push(
      <span key="record" className="share-badge">
        <img src={recordArt} alt="" draggable={false} />
        {session.record}
      </span>
    );
  }
  const chipsNode = chips.length > 0 ? <div className="share-chips">{chips}</div> : null;

  const labour =
    options.showLabour && session.labour ? (
      <div className="share-labour">
        <span className={`share-emblem is-stage-${session.labour.stage}`}>
          <img src={LABOUR_ART[session.labour.id]} alt="" draggable={false} />
        </span>
        <span className="share-labour-words">
          <small>{t("share.card.labourReached", { stage: STAGE_NUMERALS[session.labour.stage] })}</small>
          <b>{session.labour.name}</b>
          <em>{session.labour.goal}</em>
        </span>
      </div>
    ) : null;

  const brandOnTop = options.brandPosition.startsWith("t");
  const brandSide = options.brandPosition.slice(1);
  // A logo at the foot sits in the margin under the words rather than lifting
  // them, where nothing else is: a map's credit takes that margin, and a
  // poster's frame leaves too little of it.
  const brandInMargin = !brandOnTop && !showMap && options.layout !== "poster";
  const brandRow = (
    <div
      className={`share-brand-row ${brandOnTop ? "is-top" : "is-foot"}${brandInMargin ? " is-margin" : ""}`}
      style={{ justifyContent: brandSide === "l" ? "flex-start" : brandSide === "r" ? "flex-end" : "center" }}
    >
      <div className={`share-brand is-${options.brandMark}`}>
        {options.brandMark === "gold" ? (
          <img src={wreathArt} alt="" draggable={false} />
        ) : (
          <LaurelWreath size={Math.round((brandOnTop ? 60 : 48) * scale)} />
        )}
        <span>Heracles Records</span>
      </div>
    </div>
  );
  const top = brandOnTop ? brandRow : null;
  const foot = brandOnTop || brandInMargin ? null : brandRow;
  const title = options.showName ? <h2 className="share-title">{name}</h2> : null;
  const eyebrowNode = eyebrow ? <p className="share-eyebrow">{eyebrow}</p> : null;

  // A strength session's heaviest sets are words, so they sit with the words.
  const setRows = landscape ? 4 : tall ? 6 : height >= 1350 ? 4 : 2;
  const sets =
    strength && options.graphicSets && strength.sets.length > 0 ? (
      <ul className="share-sets">
        {strength.sets.slice(0, setRows).map((set) => (
          <li key={set.name}>
            <span className="share-set-name">{set.name}</span>
            <span className="share-set-value">{set.value}</span>
            {set.record ? <span className="share-set-record">{t("strength.pr")}</span> : null}
          </li>
        ))}
      </ul>
    ) : null;

  const zoneNode = (
    <div ref={zoneRef} className="share-zone">
      {!route && session.swim && options.graphicLengths ? <SwimLengths swim={session.swim} /> : null}
    </div>
  );

  let content: ReactNode;
  if (options.layout === "minimal") {
    content = (
      <>
        {top}
        {zoneNode}
        <div className="share-bottom">
          {labour}
          {chipsNode}
          {eyebrowNode}
          {title}
          {sets}
          {figures.length > 0 ? <StatCells stats={figures} divided /> : null}
          {chartNode}
        </div>
        {foot}
      </>
    );
  } else if (options.layout === "poster") {
    content = (
      <>
        <div className="share-frame" />
        {top}
        <div className="share-top">
          {labour}
          {eyebrowParts.length > 0 ? <p className="share-eyebrow">{eyebrowParts.join(" · ")}</p> : null}
          {options.showName ? <h2 className="share-poster-title">{name}</h2> : null}
          {place ? <span className="share-place">{place}</span> : null}
          {chipsNode}
        </div>
        {zoneNode}
        <div className="share-bottom">
          {sets}
          {heroStat ? (
            <div className="share-poster-hero">
              <span className="share-hero-value">
                <StatValue stat={heroStat} />
              </span>
              <span className="share-label">{heroStat.label}</span>
            </div>
          ) : null}
          {grid.length > 0 ? (
            <div className="share-rows" style={{ "--share-row-columns": grid.length >= 4 ? 2 : 1 } as CSSProperties}>
              {grid.map((stat) => (
                <div key={stat.id} className="share-row">
                  <span className="share-label">{stat.label}</span>
                  <span className="share-stat-value">
                    <StatValue stat={stat} />
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {chartNode}
        </div>
        {foot}
      </>
    );
  } else if (options.layout === "bold") {
    const story = !landscape && height / width >= 1.7;
    const columns = figures.length <= (story || landscape ? 4 : 2) ? 1 : 2;
    const size = landscape ? (columns === 1 ? 96 : 62) : story ? (columns === 1 ? 120 : 86) : columns === 1 ? 104 : 76;
    const labelColor = lightGround ? mixHexColor(session.color, "#000000", 0.38) : session.color;
    content = (
      <>
        {top}
        <div className="share-top">
          {labour}
          {eyebrowNode}
          {title}
          {chipsNode}
        </div>
        {zoneNode}
        <div className="share-bottom">
          {sets}
          <div className="share-bold" style={{ "--share-bold-columns": columns, "--share-bold-size": `${size}px` } as CSSProperties}>
            {figures.map((stat) => (
              <div key={stat.id} className="share-bold-stat">
                <span className="share-label" style={{ color: labelColor }}>
                  {stat.label}
                </span>
                <span className="share-bold-value">
                  <StatValue stat={stat} />
                </span>
              </div>
            ))}
          </div>
          {chartNode}
        </div>
        {foot}
      </>
    );
  } else {
    content = (
      <>
        {top}
        {zoneNode}
        <div className="share-bottom">
          {labour}
          {eyebrowNode}
          {title}
          {chipsNode}
          {sets}
          {heroStat ? (
            <div className="share-hero">
              <span className="share-hero-value">
                <StatValue stat={heroStat} />
              </span>
              <span className="share-label">{heroStat.label}</span>
            </div>
          ) : null}
          {grid.length > 0 ? <StatCells stats={grid} divided={false} /> : null}
          {chartNode}
        </div>
        {foot}
      </>
    );
  }

  const photo = background === "photo" ? edits.photo : undefined;
  const scrim =
    background !== "plain" && zone ? scrimBackground(zone, width, height, lightGround, landscape, photo?.darken) : "none";

  return (
    <div
      ref={cardRef}
      className={`share-card share-card--${options.layout} is-${lightGround ? "light" : "dark"}${landscape ? " is-landscape" : ""}`}
      style={
        {
          width,
          height,
          "--share-k": scale,
          "--share-pad": `${pad}px`,
          "--share-pad-top": `${padTop}px`,
          "--share-pad-bottom": `${padBottom}px`
        } as CSSProperties
      }
    >
      <div className="share-ground" style={{ background: background === "plain" ? plainBackground(options, session) : undefined }}>
        {photo ? <img className="share-photo" src={photo.src} alt="" style={photoStyle(photo, width, height)} draggable={false} /> : null}
        {showMap && fit && fontsReady ? (
          <ShareCardMap
            latLngs={line?.latLngs ?? route!.latLngs}
            style={options.mapStyle}
            fit={fit}
            width={width}
            height={height}
            capture={capture}
            onProjection={handleProjection}
            onSettled={handleSettled}
          />
        ) : null}
        <div className="share-scrim" style={{ background: scrim }} />
        <canvas ref={canvasRef} className="share-route" width={width} height={height} />
        {bodyBox && strength ? (
          <div className="share-body" style={{ left: bodyBox.x, top: bodyBox.y, width: bodyBox.w, height: bodyBox.h }}>
            {BODY_VIEWS.map((view) => (
              <BodyFigure key={view} view={view} heat={strength.heat} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="share-ui">{content}</div>
      {brandInMargin ? brandRow : null}
      {showMap ? <span className="share-credit">{SHARE_MAP_CREDITS[options.mapStyle]}</span> : null}
    </div>
  );
}
