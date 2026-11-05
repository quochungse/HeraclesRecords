import {
  ROUTE_LINE_WIDTHS,
  ROUTE_NEON,
  routeNeon,
  whitenColor
} from "../training/components/routeColoring";
import type { ShareRouteMode } from "./shareTypes";
import { SHARE_INK } from "./shareModel";

/**
 * The route on a share image, drawn on a canvas over the ground. It is the
 * detail page's line — the same halo, body and whitened core, in the same
 * proportions — made wide enough to read on a phone: the page's 4 px line is
 * drawn at `ROUTE_SCALE` times the card's own scale.
 */
const ROUTE_SCALE = 2.6;
/** The start and finish discs, in the activity map's colours, sized for the 9:16 story. */
const START_COLOR = "#4da3ff";
const FINISH_COLOR = "#d89b22";
const MARKER_RADIUS = 16;

interface Run {
  color: string;
  from: number;
  to: number;
}

/** Stretches of one colour drawn as one line, so a colour change has no seam inside a run. */
function colourRuns(count: number, colors: readonly (string | null)[] | null, color: string): Run[] {
  if (!colors) {
    return [{ color, from: 0, to: count - 1 }];
  }
  const runs: Run[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const stretch = colors[index] ?? null;
    if (stretch === null) {
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.color === stretch && last.to === index) {
      last.to = index + 1;
    } else {
      runs.push({ color: stretch, from: index, to: index + 1 });
    }
  }
  return runs;
}

interface ShareRouteStyle {
  mode: ShareRouteMode;
  lightGround: boolean;
  /** The line's colour in the neon and route modes. */
  color: string;
  /** The card's scale: 1 on the 9:16 story. */
  scale: number;
  markers: boolean;
}

export function drawShareRoute(
  canvas: HTMLCanvasElement,
  points: readonly [number, number][],
  stretchColors: readonly (string | null)[] | null,
  style: ShareRouteStyle
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (points.length < 2) {
    return;
  }
  const unit = ROUTE_SCALE * style.scale;
  context.lineJoin = "round";
  context.lineCap = "round";
  const stroke = (from: number, to: number, color: string, width: number) => {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(points[from]![0], points[from]![1]);
    for (let index = from + 1; index <= to; index += 1) {
      context.lineTo(points[index]![0], points[index]![1]);
    }
    context.stroke();
  };

  if (style.mode === "solid") {
    const last = points.length - 1;
    stroke(0, last, style.lightGround ? "rgba(255, 255, 255, 0.95)" : "rgba(0, 0, 0, 0.35)", (ROUTE_LINE_WIDTHS.body + 3) * unit);
    stroke(0, last, style.lightGround ? SHARE_INK : "#ffffff", ROUTE_LINE_WIDTHS.body * unit);
  } else {
    const runs = colourRuns(points.length, style.mode === "performance" ? stretchColors : null, style.color);
    const neon = routeNeon(style.lightGround);
    context.save();
    context.filter = `blur(${ROUTE_NEON.haloBlur * unit}px)`;
    context.globalAlpha = neon.haloOpacity;
    for (const run of runs) stroke(run.from, run.to, run.color, ROUTE_LINE_WIDTHS.halo * unit);
    context.restore();
    for (const run of runs) stroke(run.from, run.to, run.color, ROUTE_LINE_WIDTHS.body * unit);
    for (const run of runs) stroke(run.from, run.to, whitenColor(run.color, neon.coreWhiten), ROUTE_LINE_WIDTHS.core * unit);
  }

  if (style.markers) {
    const radius = MARKER_RADIUS * style.scale;
    const disc = ([x, y]: [number, number], color: string) => {
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0.45, color);
      gradient.addColorStop(1, "#ffffff");
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = gradient;
      context.fill();
      context.lineWidth = Math.max(1, unit / 2);
      context.strokeStyle = "rgba(0, 0, 0, 0.3)";
      context.stroke();
    };
    disc(points[points.length - 1]!, FINISH_COLOR);
    disc(points[0]!, START_COLOR);
  }
}
