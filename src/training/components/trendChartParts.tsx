import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { trainingChartTooltipStyle } from "../chartConfig";
import type { TrainingMetricPalette } from "../chartConfig";
import { useChartColors } from "../useChartColors";
import type { TrainingTrendPoint } from "../types";

/**
 * The pieces every trend panel is built from — axes, tooltip, area gradient,
 * empty notice, window chips. They live here rather than beside one chart
 * because three surfaces draw from them now: the Overview load and sleep
 * panels, and the HRV panel, which Overview and the Sleep screen share.
 */

export type ChartValueFormatter = (value: number) => string;

/**
 * A tooltip row's formatter. The series name rides along so one tooltip can
 * write hours on one row and a bare score on the next — a chart with two
 * y-axes has no single unit to format by.
 */
export type ChartRowFormatter = (value: number, name: string) => string;

export function formatRoundedValue(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1
  }).format(value);
}

function formatTooltipValue(
  value: unknown,
  name: string,
  valueFormatter?: ChartRowFormatter
): string {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (Number.isFinite(numericValue)) {
    return valueFormatter
      ? valueFormatter(numericValue, name)
      : formatRoundedValue(numericValue);
  }

  if (Array.isArray(value)) {
    return value.join(" – ");
  }

  return value === undefined || value === null ? "—" : String(value);
}

export function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

export function formatTooltipHeading(date: unknown, fallback: unknown): string {
  const raw =
    typeof date === "string" && /^\d{8}$/.test(date) ? date : undefined;

  if (!raw) {
    return typeof fallback === "string" || typeof fallback === "number"
      ? String(fallback)
      : "";
  }

  const parsed = new Date(
    Number(raw.slice(0, 4)),
    Number(raw.slice(4, 6)) - 1,
    Number(raw.slice(6, 8))
  );

  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export function TrendChartTooltip({
  active,
  payload,
  label,
  valueFormatter
}: TooltipContentProps & { valueFormatter?: ChartRowFormatter }) {
  if (!active || !payload?.length) {
    return null;
  }

  const heading = formatTooltipHeading(
    (payload[0]?.payload as TrainingTrendPoint | undefined)?.date,
    label
  );
  const accentColor = payload[0]?.color ?? "var(--accent)";

  return (
    <div className="training-chart-tooltip">
      <span
        className="training-chart-tooltip-accent"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`
        }}
      />
      {heading ? (
        <span className="training-chart-tooltip-label">{heading}</span>
      ) : null}
      <ul className="training-chart-tooltip-rows">
        {payload.map((entry) => {
          const dotColor = entry.color ?? "var(--accent)";
          const name = String(entry.name ?? "");
          return (
            <li
              className="training-chart-tooltip-row"
              key={String(entry.dataKey ?? entry.name)}
            >
              <span className="training-chart-tooltip-key">
                <i
                  aria-hidden="true"
                  style={{
                    background: dotColor,
                    boxShadow: `0 0 8px ${dotColor}`
                  }}
                />
                {name}
              </span>
              <strong>
                {formatTooltipValue(entry.value, name, valueFormatter)}
              </strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChartAreaGradient({
  id,
  stops
}: {
  id: string;
  stops?: { top: string; mid: string; bottom: string };
}) {
  const { fillStops } = useChartColors();
  const resolved = stops ?? fillStops;
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={resolved.top} stopOpacity={0.5} />
      <stop offset="55%" stopColor={resolved.mid} stopOpacity={0.16} />
      <stop offset="100%" stopColor={resolved.bottom} stopOpacity={0} />
    </linearGradient>
  );
}

export function EmptyChartNotice({
  icon: Icon,
  palette,
  title,
  children
}: {
  icon: LucideIcon;
  palette: TrainingMetricPalette;
  title: string;
  children: string;
}) {
  return (
    <div className="training-chart-empty">
      <span
        className="training-chart-empty-icon"
        style={{ background: palette.soft, color: palette.chip }}
      >
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="training-chart-empty-text">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </div>
  );
}

/**
 * The day-window chips a panel's heading carries. Every trend panel offers a
 * different list of windows, so the options are the caller's — the markup and
 * the pressed state are not, or three panels would drift apart.
 */
export function TrendWindowToggle<T extends number>({
  options,
  value,
  onChange,
  label
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Names the group for a screen reader; the chips themselves read as "7d". */
  label: string;
}) {
  return (
    <div className="training-metric-toggle" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`training-metric-option${
            value === option ? " is-active" : ""
          }`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}d
        </button>
      ))}
    </div>
  );
}

/** Resting dot for a metric series. */
export function metricDot(palette: TrainingMetricPalette, dotStroke: string) {
  return {
    r: 3,
    fill: palette.stroke,
    stroke: dotStroke,
    strokeWidth: 2
  };
}

/** The same dot under the cursor, ringed so the hover is findable. */
export function metricActiveDot(palette: TrainingMetricPalette) {
  return {
    r: 5,
    fill: palette.stroke,
    stroke: palette.halo,
    strokeWidth: 6
  };
}

export type TrendAxisDomain = [
  number | ((dataMin: number) => number),
  number | ((dataMax: number) => number)
];

/** Zero-based domain with a little headroom so peaks never touch the panel. */
function paddedZeroDomain(dataMax: number): number {
  return Math.ceil(dataMax * 1.15) || 1;
}

export function TrendChartAxes({
  tooltipValueFormatter,
  tooltipContent,
  tooltipCursor,
  yAxisTickFormatter,
  yAxisWidth = 36,
  yAxisDomain
}: {
  tooltipValueFormatter?: ChartRowFormatter;
  /** Replaces the default row-per-series tooltip body wholesale. */
  tooltipContent?: (props: TooltipContentProps) => ReactNode;
  /** Bars want a filled band; the line charts want a wide stroke. */
  tooltipCursor?: React.ComponentProps<typeof Tooltip>["cursor"];
  yAxisTickFormatter?: ChartValueFormatter;
  yAxisWidth?: number;
  yAxisDomain?: TrendAxisDomain;
}) {
  const { colors } = useChartColors();
  return (
    <>
      <CartesianGrid
        stroke={colors.grid}
        vertical={false}
        strokeDasharray="2 8"
      />
      <XAxis
        dataKey="label"
        tick={{ fill: colors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        dy={8}
        padding={{ left: 14, right: 14 }}
      />
      <YAxis
        tick={{ fill: colors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        tickFormatter={yAxisTickFormatter}
        width={yAxisWidth}
        tickCount={5}
        domain={yAxisDomain ?? [0, paddedZeroDomain]}
      />
      <Tooltip
        content={(props) =>
          tooltipContent ? (
            tooltipContent(props)
          ) : (
            <TrendChartTooltip
              {...props}
              valueFormatter={tooltipValueFormatter}
            />
          )
        }
        contentStyle={trainingChartTooltipStyle}
        cursor={
          tooltipCursor ?? { stroke: colors.cursorBand, strokeWidth: 26 }
        }
      />
    </>
  );
}
