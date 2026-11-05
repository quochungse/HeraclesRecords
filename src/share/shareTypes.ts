import type { LabourId, LabourStage } from "../records/labours";
import type { MuscleId } from "../strength/muscles";
import type { RouteMetric } from "../training/components/routeColoring";
import type { PerformanceView } from "../training/components/routePerformance";

/** The five sports a session can be shared from, each with its own remembered choices. */
export type ShareSport = "run" | "ride" | "hike" | "swim" | "strength";

export type ShareFormat = "story" | "feed" | "portrait" | "square" | "landscape";
export type ShareLayout = "classic" | "minimal" | "poster" | "bold";
export type ShareBackground = "map" | "photo" | "plain";
/** The base maps a shared image may carry: the ones whose terms allow a static copy. */
export type ShareMapStyle = "dark" | "light" | "topo";
export type ShareRouteMode = "neon" | "solid" | "performance";
export type ShareChartKind = "splits" | "pace" | "speed" | "hr" | "elevation" | "power";
export type ShareBrandPosition = "tl" | "t" | "tr" | "bl" | "b" | "br";
export type ShareBrandMark = "gold" | "mono";

/** One figure as the image sets it: the number large, its unit small. */
export interface ShareStat {
  /** Stable across languages: what a remembered choice is stored as. */
  id: string;
  label: string;
  value: string;
  unit?: string;
}

/** The route as the image draws it, coloured the way the activity's own map colours it. */
export interface ShareRoute {
  /** `[lat, lon]`, the route's located points in order. */
  latLngs: [number, number][];
  /** Metres from the start at each point. */
  distances: number[];
  /** What Performance can show for each metric. */
  performance: Record<RouteMetric, PerformanceView>;
  /** A ride or a hike: pace is read out as speed. */
  speed: boolean;
}

export interface ShareChart {
  kind: ShareChartKind;
  title: string;
  /** The line at the chart's right: an average, a range, the fastest split. */
  note: string;
  /** Higher is more: faster, harder, higher. */
  values: number[];
  /** Drawn as bars rather than an area: splits. */
  bars?: boolean;
}

export interface ShareLabour {
  id: LabourId;
  stage: LabourStage;
  name: string;
  /** What the stage asks for, in the screen's language. */
  goal: string;
}

interface ShareStrength {
  /** Heat level 1–5 of each muscle the session worked. */
  heat: Partial<Record<MuscleId, number>>;
  sets: { name: string; value: string; record: boolean }[];
}

export interface ShareSwim {
  /** Speed of each length, metres a second, and its stroke's colour. */
  lengths: { speed: number; color: string }[];
  title: string;
  note: string;
  legend: { label: string; color: string }[];
}

/** Everything the image says about one session, in the screen's language. */
export interface ShareSession {
  sport: ShareSport;
  activityId: string;
  /** The sport's colour as the athlete has it. */
  color: string;
  /** "Road run", "Pool swim". */
  kind: string;
  date: string;
  name: string;
  place?: string;
  trainingLabel?: { name: string; color: string };
  stats: ShareStat[];
  /** What the image shows before the athlete chooses. */
  defaultStats: string[];
  defaultHero?: string;
  route?: ShareRoute;
  charts: ShareChart[];
  /** The badge's line when this session set a record. */
  record?: string;
  labour?: ShareLabour;
  strength?: ShareStrength;
  swim?: ShareSwim;
  /** The saved file's name, before its extension. */
  fileName: string;
}

/** The choices kept for the next image of the same sport. */
export interface ShareOptions {
  format: ShareFormat;
  layout: ShareLayout;
  background: ShareBackground;
  mapStyle: ShareMapStyle;
  /** "sport" for the sport's own colour, else `#rrggbb`. */
  plainColor: string;
  plainGradient: boolean;
  routeShown: boolean;
  routeMode: ShareRouteMode;
  metric: RouteMetric;
  privacy: boolean;
  statIds: string[];
  /** The figure set large; "" for none. */
  heroId: string;
  chartShown: boolean;
  chartKind: ShareChartKind;
  showName: boolean;
  showKind: boolean;
  showDate: boolean;
  showPlace: boolean;
  showLabel: boolean;
  showRecord: boolean;
  showLabour: boolean;
  graphicBody: boolean;
  graphicSets: boolean;
  graphicLengths: boolean;
  brandPosition: ShareBrandPosition;
  brandMark: ShareBrandMark;
}

export interface SharePhoto {
  /** A data URL: the image travels to the window that draws the file. */
  src: string;
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  darken: number;
}

/**
 * Where the route or the muscle map sits on a plain or photo ground: its size
 * as a percent of what fits the free space, and how far it was moved from the
 * middle of that space, in the file's pixels.
 */
export interface SharePlacement {
  scale: number;
  dx: number;
  dy: number;
}

/** What only this image has, kept for no other: the photo, the title as typed, where the route was moved. */
export interface ShareEdits {
  name: string;
  photo?: SharePhoto;
  placement: SharePlacement;
}

/** What the preview can grab: the route's line, or the muscle map's box. */
export type SharePlaced =
  | { kind: "line"; points: [number, number][]; dx: number; dy: number }
  | { kind: "box"; rect: { x: number; y: number; w: number; h: number }; dx: number; dy: number };

/** What the window that draws the file is given. */
export interface SharePayload {
  session: ShareSession;
  options: ShareOptions;
  edits: ShareEdits;
}
