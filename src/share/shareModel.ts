import type { RouteMetric } from "../training/components/routeColoring";
import type {
  ShareBackground,
  ShareBrandMark,
  ShareBrandPosition,
  ShareChartKind,
  ShareFormat,
  ShareLayout,
  ShareMapStyle,
  ShareOptions,
  SharePhoto,
  ShareRoute,
  ShareRouteMode,
  ShareSession,
  SharePlacement,
  ShareSport,
  ShareStat
} from "./shareTypes";

/**
 * The image's sizes, in the pixels of the saved file. `scale` sizes the words
 * and figures against the 9:16 story, `pad` is the margin they keep at the
 * sides, `padTop` and `padBottom` above and below.
 */
interface ShareFormatSpec {
  width: number;
  height: number;
  ratio: string;
  scale: number;
  pad: number;
  padTop: number;
  padBottom: number;
}

export const SHARE_FORMATS: Readonly<Record<ShareFormat, ShareFormatSpec>> = {
  // A story is shown under the platform's own header (Instagram, Facebook and
  // Zalo alike): the logo may sit under it, the words start below it. Every
  // foot is deeper than the sides, room for a logo or the map credit there.
  story: { width: 1080, height: 1920, ratio: "9:16", scale: 1, pad: 72, padTop: 120, padBottom: 100 },
  feed: { width: 1080, height: 1350, ratio: "4:5", scale: 0.9, pad: 64, padTop: 64, padBottom: 84 },
  portrait: { width: 1080, height: 1440, ratio: "3:4", scale: 0.92, pad: 66, padTop: 66, padBottom: 86 },
  square: { width: 1080, height: 1080, ratio: "1:1", scale: 0.8, pad: 56, padTop: 56, padBottom: 76 },
  landscape: { width: 1440, height: 1080, ratio: "4:3", scale: 0.8, pad: 60, padTop: 60, padBottom: 80 }
};

export const SHARE_FORMAT_ORDER: readonly ShareFormat[] = ["story", "feed", "portrait", "square", "landscape"];
export const SHARE_LAYOUTS: readonly ShareLayout[] = ["classic", "minimal", "poster", "bold"];
export const SHARE_BACKGROUNDS: readonly ShareBackground[] = ["map", "photo", "plain"];
export const SHARE_MAP_STYLES: readonly ShareMapStyle[] = ["dark", "light", "topo"];
const SHARE_ROUTE_MODES: readonly ShareRouteMode[] = ["neon", "solid", "performance"];
const SHARE_CHART_KINDS: readonly ShareChartKind[] = ["splits", "pace", "speed", "hr", "elevation", "power"];
export const SHARE_BRAND_POSITIONS: readonly ShareBrandPosition[] = ["tl", "t", "tr", "bl", "b", "br"];
const SHARE_BRAND_MARKS: readonly ShareBrandMark[] = ["gold", "mono"];
export const SHARE_METRICS: readonly RouteMetric[] = ["pace", "hr", "elevation"];

/** The most figures under the large one; more would not read at a phone's width. */
export const SHARE_MAX_STATS = 6;

/**
 * The credit each base map needs on a static image, cut to what its terms
 * require: OpenMapTiles and OpenStreetMap for OpenFreeMap's styles (OpenFreeMap
 * itself may be left out), the data and the CC-BY-SA style for OpenTopoMap,
 * and OpenStreetMap's copyright page printed out, since an image carries no
 * link. Satellite is not offered: Esri licenses its imagery to its own account
 * holders only.
 */
export const SHARE_MAP_CREDITS: Readonly<Record<ShareMapStyle, string>> = {
  dark: "© OpenMapTiles © OpenStreetMap · openstreetmap.org/copyright", // i18n-ignore: a map credit, the providers' own names
  light: "© OpenMapTiles © OpenStreetMap · openstreetmap.org/copyright", // i18n-ignore: a map credit, the providers' own names
  topo: "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA) · openstreetmap.org/copyright" // i18n-ignore: a map credit, the providers' own names
};

/** Plain grounds besides the sport's own colour. */
export const SHARE_PLAIN_COLORS = [
  { id: "navy", color: "#0b2545" },
  { id: "forest", color: "#123524" },
  { id: "wine", color: "#3d0c1e" },
  { id: "rust", color: "#7a2e0e" },
  { id: "gold", color: "#d89b22" },
  { id: "sand", color: "#e9e4d6" },
  { id: "graphite", color: "#2b2f36" },
  { id: "sky", color: "#9ec5f4" }
] as const;

export const SHARE_INK = "#151a26";
const HEX = /^#[0-9a-f]{6}$/i;

/** The choices an image of a session starts from, before anything is remembered. */
export function defaultShareOptions(session: Pick<ShareSession, "sport" | "defaultStats" | "defaultHero" | "route" | "charts">): ShareOptions {
  return {
    format: "story",
    layout: "classic",
    background: session.route ? "map" : "plain",
    mapStyle: "dark",
    plainColor: "sport",
    plainGradient: true,
    routeShown: true,
    routeMode: "neon",
    metric: "pace",
    privacy: false,
    statIds: [...session.defaultStats],
    heroId: session.defaultHero ?? "",
    chartShown: session.charts.length > 0 && session.sport !== "strength",
    chartKind: session.charts[0]?.kind ?? "hr",
    showName: true,
    showKind: true,
    showDate: true,
    showPlace: true,
    showLabel: true,
    showRecord: true,
    showLabour: true,
    graphicBody: true,
    graphicSets: true,
    graphicLengths: true,
    brandPosition: "tl",
    brandMark: "gold"
  };
}

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * The remembered choices laid over this session's defaults. Each field is read
 * on its own, so a choice a newer build stored, or one this session cannot
 * honour (a figure it does not have, a map without a route, a photo ground
 * with no photo chosen yet), falls back without losing the rest.
 */
export function resolveShareOptions(session: ShareSession, stored: unknown, hasPhoto = false): ShareOptions {
  const base = defaultShareOptions(session);
  if (!stored || typeof stored !== "object") {
    return base;
  }
  const raw = stored as Record<string, unknown>;
  const statIds = Array.isArray(raw.statIds)
    ? raw.statIds.filter((id): id is string => typeof id === "string" && session.stats.some((stat) => stat.id === id))
    : [];
  const heroId =
    typeof raw.heroId === "string" && (raw.heroId === "" || session.stats.some((stat) => stat.id === raw.heroId))
      ? raw.heroId
      : base.heroId;
  const chartKind = oneOf(SHARE_CHART_KINDS, raw.chartKind, base.chartKind);
  const background = oneOf(SHARE_BACKGROUNDS, raw.background, base.background);
  const groundLacking = (background === "map" && !session.route) || (background === "photo" && !hasPhoto);
  return {
    format: oneOf(SHARE_FORMAT_ORDER, raw.format, base.format),
    layout: oneOf(SHARE_LAYOUTS, raw.layout, base.layout),
    background: groundLacking ? (session.route ? "map" : "plain") : background,
    mapStyle: oneOf(SHARE_MAP_STYLES, raw.mapStyle, base.mapStyle),
    plainColor:
      raw.plainColor === "sport" || (typeof raw.plainColor === "string" && HEX.test(raw.plainColor))
        ? (raw.plainColor as string)
        : base.plainColor,
    plainGradient: flag(raw.plainGradient, base.plainGradient),
    routeShown: flag(raw.routeShown, base.routeShown),
    routeMode: oneOf(SHARE_ROUTE_MODES, raw.routeMode, base.routeMode),
    metric: oneOf(SHARE_METRICS, raw.metric, base.metric),
    privacy: flag(raw.privacy, base.privacy),
    // The large figure is never also one of the figures under it.
    statIds: (statIds.length > 0 ? statIds : base.statIds).filter((id) => id !== heroId).slice(0, SHARE_MAX_STATS),
    heroId,
    chartShown: flag(raw.chartShown, base.chartShown) && session.charts.length > 0,
    chartKind: session.charts.some((chart) => chart.kind === chartKind) ? chartKind : base.chartKind,
    showName: flag(raw.showName, base.showName),
    showKind: flag(raw.showKind, base.showKind),
    showDate: flag(raw.showDate, base.showDate),
    showPlace: flag(raw.showPlace, base.showPlace),
    showLabel: flag(raw.showLabel, base.showLabel),
    showRecord: flag(raw.showRecord, base.showRecord),
    showLabour: flag(raw.showLabour, base.showLabour),
    graphicBody: flag(raw.graphicBody, base.graphicBody),
    graphicSets: flag(raw.graphicSets, base.graphicSets),
    graphicLengths: flag(raw.graphicLengths, base.graphicLengths),
    brandPosition: oneOf(SHARE_BRAND_POSITIONS, raw.brandPosition, base.brandPosition),
    brandMark: oneOf(SHARE_BRAND_MARKS, raw.brandMark, base.brandMark)
  };
}

/** What is remembered per sport: only ids and flags, never the words. */
export type StoredShareOptions = Partial<Record<ShareSport, Partial<ShareOptions>>>;

/**
 * A change laid over what is remembered for the sport, field by field. What is
 * remembered is the athlete's own choice, not what this session made of it: a
 * treadmill run shown on a plain ground leaves the map remembered for the next
 * run outside.
 */
export function rememberShareOptions(
  stored: StoredShareOptions,
  sport: ShareSport,
  patch: Partial<ShareOptions>
): StoredShareOptions {
  return { ...stored, [sport]: { ...stored[sport], ...patch } };
}

export function isStoredShareOptions(value: unknown): value is StoredShareOptions {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * A figure as the detail page wrote it, "12.4 km", split into its number and
 * its unit so the unit can be set smaller. A value whose last word does not
 * start with a letter or a slash ("1:09:53", "24°C") stays whole.
 */
export function splitStatValue(text: string): { value: string; unit?: string } {
  const match = /^(.*\S)\s+([^\s\d][^\s]*)$/u.exec(text.trim());
  if (!match || !/\d/.test(match[1]!)) {
    return { value: text.trim() };
  }
  return { value: match[1]!, unit: match[2]! };
}

export function shareStat(id: string, label: string, text: string): ShareStat {
  return { id, label, ...splitStatValue(text) };
}

/** A figure written whole again, "12.4 km", for a list that names it. */
export function statText(stat: ShareStat): string {
  return stat.unit ? `${stat.value} ${stat.unit}` : stat.value;
}

/**
 * How the route is coloured: the choice, or what the session can give in its
 * place — the first measure it has when the chosen one is missing, and the
 * plain line when it has none. The choices on screen show the same.
 */
export function shownRouteStyle(options: ShareOptions, route: ShareRoute): { mode: ShareRouteMode; metric?: RouteMetric } {
  const metric =
    route.performance[options.metric].kind !== "none"
      ? options.metric
      : SHARE_METRICS.find((candidate) => route.performance[candidate].kind !== "none");
  return { mode: options.routeMode === "performance" && !metric ? "neon" : options.routeMode, metric };
}

/**
 * A photo covering a `width` × `height` card at its zoom, with its move kept
 * short of showing an edge. The dialog keeps the move this way too, so a drag
 * past the edge does not build up out of sight.
 */
export function photoCover(
  photo: Pick<SharePhoto, "width" | "height" | "zoom" | "panX" | "panY">,
  width: number,
  height: number
): { width: number; height: number; panX: number; panY: number } {
  const cover = Math.max(width / photo.width, height / photo.height) * photo.zoom;
  const drawnWidth = photo.width * cover;
  const drawnHeight = photo.height * cover;
  const spareX = (drawnWidth - width) / 2;
  const spareY = (drawnHeight - height) / 2;
  return {
    width: drawnWidth,
    height: drawnHeight,
    panX: Math.max(-spareX, Math.min(spareX, photo.panX)),
    panY: Math.max(-spareY, Math.min(spareY, photo.panY))
  };
}

/** Columns for `n` figures: one row up to three, two by two for four, rows of three beyond. */
export function statColumns(n: number): number {
  return n <= 3 ? Math.max(1, n) : n === 4 ? 2 : 3;
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

export function mixHexColor(from: string, to: string, ratio: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((channel, index) => Math.round(channel + (b[index]! - channel) * ratio).toString(16).padStart(2, "0"))
    .join("")}`;
}

type ShareTone = "dark" | "light";

/** The background the image actually has: a map needs a route to sit on. */
export function shownBackground(options: ShareOptions, session: ShareSession): ShareBackground {
  return options.background === "map" && !session.route ? "plain" : options.background;
}

function plainBase(options: ShareOptions, session: ShareSession): string {
  return options.plainColor === "sport" ? session.color : options.plainColor;
}

/** Whether the ground under the words is dark or light, which sets the words' ink. */
export function groundTone(options: ShareOptions, session: ShareSession): ShareTone {
  const background = shownBackground(options, session);
  if (background === "map") {
    return options.mapStyle === "dark" ? "dark" : "light";
  }
  if (background === "photo") {
    return "dark";
  }
  if (options.plainColor === "sport" && options.plainGradient) {
    return "dark";
  }
  const base = plainBase(options, session);
  return contrastRatio("#ffffff", base) >= contrastRatio(SHARE_INK, base) ? "dark" : "light";
}

/** The CSS background of a plain ground. */
export function plainBackground(options: ShareOptions, session: ShareSession): string {
  const base = plainBase(options, session);
  if (!options.plainGradient) {
    return base;
  }
  if (options.plainColor === "sport") {
    return `radial-gradient(130% 80% at 85% 8%, ${mixHexColor(base, "#07090c", 0.5)} 0%, ${mixHexColor(base, "#07090c", 0.82)} 45%, #07090c 80%)`;
  }
  return `radial-gradient(130% 85% at 85% 5%, ${mixHexColor(base, "#ffffff", 0.2)} 0%, ${base} 50%, ${mixHexColor(base, "#000000", 0.35)} 100%)`;
}

/** The route's own colour, unless a flat plain ground is too close to it to see it. */
export function routeInk(options: ShareOptions, session: ShareSession): string {
  if (shownBackground(options, session) !== "plain") {
    return session.color;
  }
  if (options.plainColor === "sport" && options.plainGradient) {
    return session.color;
  }
  if (contrastRatio(session.color, plainBase(options, session)) >= 2.2) {
    return session.color;
  }
  return groundTone(options, session) === "dark" ? "#ffffff" : SHARE_INK;
}

export interface ShareRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Web Mercator, in units of the world's width: what a map projects with, so the shape matches. */
function mercator([lat, lon]: [number, number]): [number, number] {
  const clamped = Math.max(-85, Math.min(85, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return [lon / 360 + 0.5, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

interface ShareBox extends ShareRect {
  /** Card pixels per unit of the content placed. */
  fit: number;
  /** The move actually applied, after keeping the box's centre inside `bounds`. */
  dx: number;
  dy: number;
}

/**
 * Where content `width` × `height` (in any unit) sits when fitted into `zone`
 * and centred, scaled by `placement.scale` percent (100 fills the zone), then
 * moved by its offset with its centre kept inside `bounds`. The offset applied
 * comes back, so a drag past the edge does not build up out of sight.
 */
export function placeBox(
  width: number,
  height: number,
  zone: ShareRect,
  bounds: ShareRect,
  placement: SharePlacement
): ShareBox {
  const fit = Math.min(zone.w / Math.max(width, 1e-9), zone.h / Math.max(height, 1e-9)) * (placement.scale / 100);
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  const x = Math.max(bounds.x, Math.min(bounds.x + bounds.w, cx + placement.dx));
  const y = Math.max(bounds.y, Math.min(bounds.y + bounds.h, cy + placement.dy));
  const w = width * fit;
  const h = height * fit;
  return { x: x - w / 2, y: y - h / 2, w, h, fit, dx: x - cx, dy: y - cy };
}

/** A route projected once, so moving it is only a scale and a shift. */
export interface RouteOutline {
  points: [number, number][];
  x0: number;
  y0: number;
  width: number;
  height: number;
}

export function routeOutline(latLngs: readonly [number, number][]): RouteOutline {
  const points = latLngs.map(mercator);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return points.length > 0 ? { points, x0, y0, width: x1 - x0, height: y1 - y0 } : { points, x0: 0, y0: 0, width: 0, height: 0 };
}

/** A route's points on the card when it is placed by `placeBox` rather than on a map. */
export function fitRoute(
  outline: RouteOutline,
  zone: ShareRect,
  bounds: ShareRect,
  placement: SharePlacement
): { points: [number, number][]; dx: number; dy: number } {
  const box = placeBox(outline.width, outline.height, zone, bounds, placement);
  return {
    points: outline.points.map(([px, py]) => [box.x + (px - outline.x0) * box.fit, box.y + (py - outline.y0) * box.fit]),
    dx: box.dx,
    dy: box.dy
  };
}

/**
 * The part of a route an image may show when its ends are hidden: 300 m off
 * each end, or less on a short route, so where the athlete lives is not on it.
 * Each end is cut where that distance falls, between two points if need be,
 * so a route of few points loses no more and keeps no less. Stretch `k` of
 * what is left lies on stretch `first + k` of the route. A route with no
 * length leaves nothing to show.
 */
export function privateRoute(
  latLngs: readonly [number, number][],
  distances: readonly number[]
): { latLngs: [number, number][]; first: number } | null {
  const total = distances[distances.length - 1] ?? 0;
  if (latLngs.length < 2 || !(total > 0)) {
    return null;
  }
  const cut = Math.min(300, total * 0.15);
  const at = (distance: number): { point: [number, number]; stretch: number } => {
    let stretch = 0;
    while (stretch < distances.length - 2 && distances[stretch + 1]! < distance) {
      stretch += 1;
    }
    const from = distances[stretch]!;
    const span = distances[stretch + 1]! - from;
    const share = span > 0 ? Math.max(0, Math.min(1, (distance - from) / span)) : 0;
    const [aLat, aLon] = latLngs[stretch]!;
    const [bLat, bLon] = latLngs[stretch + 1]!;
    return { point: [aLat + (bLat - aLat) * share, aLon + (bLon - aLon) * share], stretch };
  };
  const start = at(cut);
  const end = at(total - cut);
  return {
    latLngs: [start.point, ...latLngs.slice(start.stretch + 1, end.stretch + 1), end.point],
    first: start.stretch
  };
}

/** The nearest a point comes to a polyline, for telling a grab of the route from a grab of the photo. */
export function distanceToPolyline(point: [number, number], line: readonly [number, number][]): number {
  let best = Infinity;
  for (let index = 0; index < line.length - 1; index += 1) {
    const [ax, ay] = line[index]!;
    const [bx, by] = line[index + 1]!;
    const vx = bx - ax;
    const vy = by - ay;
    const length = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((point[0] - ax) * vx + (point[1] - ay) * vy) / length));
    best = Math.min(best, Math.hypot(point[0] - ax - vx * t, point[1] - ay - vy * t));
  }
  return best;
}

/** `values` thinned to at most `count`, keeping the first and the last. */
export function thin(values: readonly number[], count: number): number[] {
  if (values.length <= count) {
    return [...values];
  }
  return Array.from({ length: count }, (_, index) => values[Math.round((index / (count - 1)) * (values.length - 1))]!);
}

/** A file name from an activity name: letters and digits, dashes between. */
export function shareFileName(name: string, fallback: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
  return cleaned || fallback;
}
