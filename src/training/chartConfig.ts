import type { Theme } from "../theme/theme";

export const TRAINING_HEATMAP_DAYS = 365;

/**
 * Days of trend the Overview snapshot carries — the training-load chart's
 * window, and the longest of the trend charts. The rest draw a tail of it.
 */
export const TRAINING_LOAD_TREND_DAYS = 30;

/** Days drawn by the trend charts that stay on a short window (HRV, sleep). */
export const TRAINING_SHORT_TREND_DAYS = 7;

/**
 * Windows the training-load bar chart can be switched between, in render order.
 * The widest must stay <= TRAINING_LOAD_TREND_DAYS, which is all the snapshot
 * carries — a wider option would draw empty columns for days it has no load for.
 */
export const TRAINING_LOAD_WINDOWS = [7, 14, 30] as const;

export type TrainingLoadWindow = (typeof TRAINING_LOAD_WINDOWS)[number];

/** Ranges the load heatmap can be switched between, in render order. */
export type TrainingHeatmapRange = "year" | "month";

export const TRAINING_HEATMAP_RANGES = ["year", "month"] as const;

export const TRAINING_HEATMAP_RANGE_DAYS: Record<TrainingHeatmapRange, number> = {
  year: TRAINING_HEATMAP_DAYS,
  month: 30
};

export interface TrainingChartColors {
  accent: string;
  accentBright: string;
  accentGlow: string;
  accentSoft: string;
  gold: string;
  grid: string;
  text: string;
  cursor: string;
  cursorBand: string;
  dotStroke: string;
  tooltipBg: string;
  tooltipBorder: string;
  /** Hue-free color for a bar block that stands for no sport in particular. */
  neutralFill: string;
}

export type TrainingMetricKey = "load" | "rpe" | "hrv" | "sleep";

export interface TrainingMetricPalette {
  /** Series stroke + resting dot color. */
  stroke: string;
  /** Translucent ring rendered behind the hover (active) dot. */
  halo: string;
  /** Soft tinted background for the header delta chip. */
  soft: string;
  /** Text/icon color rendered on top of `soft`. */
  chip: string;
  /** Vertical gradient stops for the area fill. */
  stops: { top: string; mid: string; bottom: string };
}

const DARK_CHART_COLORS: TrainingChartColors = {
  accent: "#2d9a74",
  accentBright: "#74c08f",
  accentGlow: "#6ee7a8",
  accentSoft: "rgba(45, 154, 116, 0.25)",
  gold: "#d89b22",
  grid: "rgba(255, 255, 255, 0.05)",
  text: "#a1a1a6",
  cursor: "rgba(255, 255, 255, 0.1)",
  cursorBand: "rgba(255, 255, 255, 0.05)",
  dotStroke: "rgba(12, 14, 13, 0.85)",
  tooltipBg: "rgba(18, 18, 20, 0.96)",
  tooltipBorder: "rgba(255, 255, 255, 0.12)",
  neutralFill: "#5c6167"
};

const PAPER_CHART_COLORS: TrainingChartColors = {
  accent: "#12946e",
  accentBright: "#0f7f5f",
  accentGlow: "#0f7f5f",
  accentSoft: "rgba(18, 148, 110, 0.2)",
  gold: "#b9791a",
  grid: "rgba(38, 34, 28, 0.08)",
  text: "#57544e",
  cursor: "rgba(38, 34, 28, 0.08)",
  cursorBand: "rgba(38, 34, 28, 0.06)",
  dotStroke: "rgba(255, 255, 255, 0.9)",
  tooltipBg: "rgba(255, 255, 255, 0.98)",
  tooltipBorder: "rgba(38, 34, 28, 0.12)",
  neutralFill: "#a5a097"
};

export function getTrainingChartColors(theme: Theme): TrainingChartColors {
  return theme === "paper" ? PAPER_CHART_COLORS : DARK_CHART_COLORS;
}

export function getTrainingChartFillStops(theme: Theme) {
  const colors = getTrainingChartColors(theme);
  return {
    top: colors.accentBright,
    mid: colors.accent,
    bottom: colors.accent
  };
}

export function getTrainingChartActiveDot(theme: Theme) {
  const colors = getTrainingChartColors(theme);
  return {
    r: 4,
    fill: colors.accentGlow,
    stroke: colors.dotStroke,
    strokeWidth: 2
  };
}

const DARK_METRIC_PALETTES: Record<TrainingMetricKey, TrainingMetricPalette> = {
  load: {
    stroke: "#f3bf5c",
    halo: "rgba(243, 191, 92, 0.3)",
    soft: "rgba(243, 191, 92, 0.14)",
    chip: "#f7d489",
    stops: { top: "#f3bf5c", mid: "#b8892f", bottom: "#b8892f" }
  },
  rpe: {
    stroke: "#b79bff",
    halo: "rgba(183, 155, 255, 0.3)",
    soft: "rgba(183, 155, 255, 0.15)",
    chip: "#d2c1ff",
    stops: { top: "#b79bff", mid: "#7b61c9", bottom: "#7b61c9" }
  },
  hrv: {
    stroke: "#74c08f",
    halo: "rgba(116, 192, 143, 0.3)",
    soft: "rgba(116, 192, 143, 0.14)",
    chip: "#a5ddb9",
    stops: { top: "#74c08f", mid: "#2d9a74", bottom: "#2d9a74" }
  },
  sleep: {
    stroke: "#7ab8ff",
    halo: "rgba(122, 184, 255, 0.3)",
    soft: "rgba(122, 184, 255, 0.15)",
    chip: "#aacfff",
    stops: { top: "#7ab8ff", mid: "#4a7fd6", bottom: "#4a7fd6" }
  }
};

const PAPER_METRIC_PALETTES: Record<TrainingMetricKey, TrainingMetricPalette> = {
  load: {
    stroke: "#8a5a12",
    halo: "rgba(138, 90, 18, 0.24)",
    soft: "rgba(138, 90, 18, 0.12)",
    chip: "#6b450d",
    stops: { top: "#9a6414", mid: "#7a4f0f", bottom: "#7a4f0f" }
  },
  rpe: {
    stroke: "#7c5cd6",
    halo: "rgba(124, 92, 214, 0.24)",
    soft: "rgba(124, 92, 214, 0.12)",
    chip: "#5f44ad",
    stops: { top: "#8b6ce0", mid: "#6d4fc4", bottom: "#6d4fc4" }
  },
  hrv: {
    stroke: "#0f7f5f",
    halo: "rgba(15, 127, 95, 0.24)",
    soft: "rgba(15, 127, 95, 0.12)",
    chip: "#0b6550",
    stops: { top: "#12946e", mid: "#0f7f5f", bottom: "#0f7f5f" }
  },
  sleep: {
    stroke: "#3d6fd6",
    halo: "rgba(61, 111, 214, 0.24)",
    soft: "rgba(61, 111, 214, 0.12)",
    chip: "#2f56ab",
    stops: { top: "#4a80e0", mid: "#3d6fd6", bottom: "#3d6fd6" }
  }
};

/**
 * How one block of a training-load column is painted. Every value is expressed
 * against the block's own sport color, so the recipe holds for all five sports
 * and the neutral one without naming any of them.
 */
export interface TrainingLoadBlockStyle {
  /** Vertical gradient, as opacity of the block color at top and bottom. */
  fill: { top: number; bottom: number };
  /** White highlight over the block's upper part — what makes it read as lit. */
  sheenOpacity: number;
  /** Hairline in the block color, separating the slab from the track behind. */
  strokeOpacity: number;
  strokeWidth: number;
  /** Lit edge along the block's top. Height in px; 0 leaves it off. */
  capHeight: number;
  capOpacity: number;
  /** Soft bloom in the block's own color, so a column reads as lit glass. */
  glowOpacity: number;
  glowBlur: number;
  /**
   * Corner radius. `topRadius` rounds the column's own two top corners and is
   * kept in step with `trackRadius` so the slab and its slot agree; the edges
   * where two blocks of one day meet get the much smaller `innerRadius`, which
   * softens the seam without making each block look like a separate pill.
   */
  topRadius: number;
  innerRadius: number;
  /**
   * The faint slot every day sits in, drawn whether the day has load or not.
   * It gives the columns something to stand in and is what makes a rest day
   * read as a day with nothing on it rather than as missing data.
   */
  trackFill: string;
  /** The same slot under the pointer — the chart's only hover affordance. */
  trackHoverFill: string;
  trackRadius: number;
}

const DARK_LOAD_BLOCK_STYLE: TrainingLoadBlockStyle = {
  fill: { top: 1, bottom: 0.62 },
  sheenOpacity: 0.2,
  strokeOpacity: 0.35,
  strokeWidth: 1,
  capHeight: 2.5,
  capOpacity: 1,
  glowOpacity: 0.4,
  glowBlur: 9,
  topRadius: 6,
  innerRadius: 2,
  trackFill: "rgba(255, 255, 255, 0.045)",
  trackHoverFill: "rgba(255, 255, 255, 0.1)",
  trackRadius: 6
};

/**
 * Paper needs more ink than dark: the same translucency that reads as glass on
 * a near-black panel reads as washed-out on white, and a light ground gives a
 * colored bloom almost nothing to bloom against.
 */
const PAPER_LOAD_BLOCK_STYLE: TrainingLoadBlockStyle = {
  fill: { top: 1, bottom: 0.7 },
  sheenOpacity: 0.3,
  strokeOpacity: 0.22,
  strokeWidth: 1,
  capHeight: 2.5,
  capOpacity: 1,
  glowOpacity: 0.2,
  glowBlur: 6,
  topRadius: 6,
  innerRadius: 2,
  trackFill: "rgba(38, 34, 28, 0.05)",
  trackHoverFill: "rgba(38, 34, 28, 0.1)",
  trackRadius: 6
};

export function getTrainingLoadBlockStyle(theme: Theme): TrainingLoadBlockStyle {
  return theme === "paper" ? PAPER_LOAD_BLOCK_STYLE : DARK_LOAD_BLOCK_STYLE;
}

/** Per-metric series palette — gives each trend chart its own color identity. */
export function getTrainingMetricPalettes(
  theme: Theme
): Record<TrainingMetricKey, TrainingMetricPalette> {
  return theme === "paper" ? PAPER_METRIC_PALETTES : DARK_METRIC_PALETTES;
}

/** Back-compat static exports (dark palette) for any non-theme-aware callers. */
export const trainingChartColors = DARK_CHART_COLORS;
export const trainingChartFillStops = getTrainingChartFillStops("dark");
export const trainingChartActiveDot = getTrainingChartActiveDot("dark");

export const trainingChartMargin = {
  top: 12,
  right: 12,
  left: -8,
  bottom: 4
};

export const trainingChartTooltipStyle = {
  backgroundColor: "transparent",
  border: "none",
  borderRadius: 0,
  boxShadow: "none",
  padding: 0
};
