import type { Theme } from "../theme/theme";

export const TRAINING_HEATMAP_DAYS = 365;

/**
 * Days of trend the Overview snapshot carries — the training-load chart's
 * window, and the longest of the trend charts. The rest draw a tail of it.
 */
export const TRAINING_LOAD_TREND_DAYS = 30;

/** Days drawn by the trend charts that stay on a short window (HRV, sleep). */
export const TRAINING_SHORT_TREND_DAYS = 7;

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
  tooltipBorder: "rgba(255, 255, 255, 0.12)"
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
  tooltipBorder: "rgba(38, 34, 28, 0.12)"
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
