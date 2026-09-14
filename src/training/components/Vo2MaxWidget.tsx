import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import {
  formatHappenDayLabel,
  formatSignedDelta,
  getLocalHappenDayKey
} from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import {
  buildVo2Trend,
  formatHappenDayNumeric,
  formatPlateauDuration,
  formatTrendSpan,
  type Vo2Reading,
  type Vo2Trend
} from "../vo2Trend";
import type { TrainingHubSnapshot } from "../types";

interface Vo2MaxWidgetProps {
  snapshot: TrainingHubSnapshot | null;
}

interface Vo2Band {
  min: number;
  max: number;
  color: string;
}

const VO2_MIN = 20;
const VO2_MAX = 60;
const VO2_CENTER_X = 120;
const VO2_CENTER_Y = 118;
const VO2_RADIUS = 84;

const VO2_BANDS: Vo2Band[] = [
  { min: 20, max: 30, color: "#ff4f5f" },
  { min: 30, max: 35, color: "#ffb23f" },
  { min: 35, max: 45, color: "#3ee88e" },
  { min: 45, max: 60, color: "#4aa3ff" }
];

/**
 * Smallest share of the bar that still fits "47 · 33d" under a segment. A
 * narrower plateau keeps its color and its tooltip and drops the caption,
 * rather than rendering one that collides with its neighbour.
 */
const PLATEAU_LABEL_MIN_SHARE = 0.14;

/** Tone share for the lowest level on the bar, so it stays legible. */
const PLATEAU_DIM = 0.32;

/**
 * A tooltip is centred on its segment, except near the ends of the bar: the
 * panel clips its overflow, so one centred on a segment whose middle sits
 * inside these margins would be cut off. Those anchor to the bar's edge
 * instead. Decided from the segment's own centre rather than `:first-child`,
 * which covers only the outermost two however many plateaus there are.
 */
const PLATEAU_TIP_EDGE = 0.28;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function valueToAngle(value: number): number {
  const percent = (clamp(value, VO2_MIN, VO2_MAX) - VO2_MIN) / (VO2_MAX - VO2_MIN);
  return 180 - percent * 180;
}

function pointOnArc(value: number, radius = VO2_RADIUS) {
  const angle = (valueToAngle(value) * Math.PI) / 180;

  return {
    x: VO2_CENTER_X + radius * Math.cos(angle),
    y: VO2_CENTER_Y - radius * Math.sin(angle)
  };
}

function describeArc(min: number, max: number): string {
  const start = pointOnArc(min);
  const end = pointOnArc(max);

  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${VO2_RADIUS} ${VO2_RADIUS} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
  ].join(" ");
}

function vo2Status(value?: number): { label: string; tone: string } {
  if (value === undefined) {
    return { label: "Waiting", tone: "neutral" };
  }

  if (value < 30) {
    return { label: "Base", tone: "low" };
  }

  if (value < 35) {
    return { label: "Building", tone: "mid" };
  }

  if (value < 45) {
    return { label: "Strong", tone: "good" };
  }

  return { label: "Peak", tone: "high" };
}

function isFocusedBand(value: number | undefined, band: Vo2Band): boolean {
  if (value === undefined) {
    return false;
  }

  const clampedValue = clamp(value, VO2_MIN, VO2_MAX);
  return (
    clampedValue >= band.min &&
    (clampedValue < band.max || (band.max === VO2_MAX && clampedValue === band.max))
  );
}

function latestVo2Readings(snapshot: TrainingHubSnapshot | null): Vo2Reading[] {
  return mergeTrainingDayLists(
    snapshot?.dailyMetrics ?? null,
    snapshot?.analytics ?? null
  )
    .map((day) => ({
      happenDay: day.happenDay,
      value: day.vo2max
    }))
    .filter(
      (reading): reading is Vo2Reading =>
        Number.isFinite(reading.value) && reading.value !== undefined
    );
}

/**
 * The bar is a picture of duration, not of magnitude: a segment's width is the
 * days the level held, so a long plateau reads as a long block. Height carries
 * nothing, which is why the level is told by opacity -- dimmest at the lowest
 * value observed, full at the highest -- rather than by a second axis.
 */
function Vo2PlateauBar({ trend }: { trend: Vo2Trend }) {
  const values = trend.plateaus.map((plateau) => plateau.value);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const span = highest - lowest;

  return (
    <div className="vo2-plateaus">
      <div className="vo2-plateaus-head">
        <span>Last {formatTrendSpan(trend.spanDays)}</span>
        <strong
          className={`vo2-plateaus-delta${trend.delta > 0 ? " is-up" : trend.delta < 0 ? " is-down" : ""}`}
        >
          {formatSignedDelta(trend.delta)}
        </strong>
      </div>

      <div className="vo2-plateaus-bar">
        {trend.plateaus.map((plateau, index) => {
          const strength =
            span > 0
              ? PLATEAU_DIM + ((plateau.value - lowest) / span) * (1 - PLATEAU_DIM)
              : 1;
          // Running centre of this segment across the bar, 0..1.
          const centre =
            trend.plateaus
              .slice(0, index)
              .reduce((sum, earlier) => sum + earlier.share, 0) +
            plateau.share / 2;
          const range = `${formatHappenDayNumeric(plateau.startDay)} - ${formatHappenDayNumeric(plateau.endDay)}`;

          return (
            <span
              key={`${plateau.startDay}-${plateau.value}`}
              className={`vo2-plateau${index === trend.plateaus.length - 1 ? " is-current" : ""}`}
              style={{
                flexGrow: plateau.share,
                ["--plateau-strength" as string]: `${(strength * 100).toFixed(1)}%`
              }}
              data-tip-anchor={
                centre < PLATEAU_TIP_EDGE
                  ? "start"
                  : centre > 1 - PLATEAU_TIP_EDGE
                    ? "end"
                    : "centre"
              }
              tabIndex={0}
              role="img"
              aria-label={`VO2 Max ${plateau.value}, ${plateau.days} days, ${range}`}
            >
              <span className="vo2-plateau-tip" role="tooltip">
                VO2 Max <strong>{plateau.value}</strong> · {range}
              </span>
            </span>
          );
        })}
      </div>

      <div className="vo2-plateaus-scale" aria-hidden="true">
        {trend.plateaus.map((plateau) => (
          <span
            key={`${plateau.startDay}-label`}
            className="vo2-plateau-label"
            style={{ flexGrow: plateau.share }}
          >
            {plateau.share >= PLATEAU_LABEL_MIN_SHARE
              ? `${plateau.value} · ${formatPlateauDuration(plateau.days)}`
              : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Vo2MaxWidget({ snapshot }: Vo2MaxWidgetProps) {
  const [isReady, setIsReady] = useState(false);
  const readings = latestVo2Readings(snapshot);
  const latest = readings.at(-1);
  const trend = buildVo2Trend(readings, getLocalHappenDayKey());
  const displayValue = latest?.value;
  const needle = pointOnArc(displayValue ?? VO2_MIN, VO2_RADIUS - 18);
  const status = vo2Status(displayValue);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsReady(true));

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className={`panel vo2-widget-panel tone-${status.tone}${isReady ? " is-ready" : ""}`}
    >
      <div className="vo2-widget-header">
        <div>
          <p className="eyebrow">VO2 Max</p>
          <h2>Running engine</h2>
        </div>
        <span className="vo2-widget-icon" aria-hidden="true">
          <Activity size={16} />
        </span>
      </div>

      <div className="vo2-gauge" aria-label="VO2 max gauge">
        <svg viewBox="0 0 240 144" aria-hidden="true">
          <path
            className="vo2-gauge-track"
            d={describeArc(VO2_MIN, VO2_MAX)}
          />
          {VO2_BANDS.map((band) => {
            const isFocused = isFocusedBand(displayValue, band);

            return (
              <path
                key={`${band.min}-${band.max}`}
                className={`vo2-gauge-band${isFocused ? " is-focused" : ""}`}
                d={describeArc(band.min, band.max)}
                pathLength={100}
                stroke={band.color}
              />
            );
          })}
          <line
            className="vo2-gauge-needle"
            x1={VO2_CENTER_X}
            y1={VO2_CENTER_Y}
            x2={needle.x}
            y2={needle.y}
          />
          <circle
            className="vo2-gauge-pin"
            cx={VO2_CENTER_X}
            cy={VO2_CENTER_Y}
            r="5"
          />
        </svg>

        <div className={`vo2-gauge-value${displayValue !== undefined ? " has-value" : ""}`}>
          <strong>{displayValue !== undefined ? Math.round(displayValue) : "-"}</strong>
        </div>
      </div>

      <div className="vo2-widget-footer">
        <div>
          <span>Level</span>
          <strong>{status.label}</strong>
        </div>
        <div>
          <span>Last step</span>
          <strong>
            {trend?.lastStep === undefined
              ? "-"
              : `${formatSignedDelta(trend.lastStep)} · ${formatPlateauDuration(trend.daysAtCurrent)} ago`}
          </strong>
        </div>
        <div>
          <span>Updated</span>
          <strong>
            {latest ? formatHappenDayLabel(latest.happenDay) : "-"}
          </strong>
        </div>
      </div>

      {trend ? <Vo2PlateauBar trend={trend} /> : null}
    </section>
  );
}
