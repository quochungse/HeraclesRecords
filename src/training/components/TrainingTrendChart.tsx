import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  HeartPulse,
  MoonStar
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  TRAINING_LOAD_TREND_DAYS,
  TRAINING_LOAD_WINDOWS,
  TRAINING_SHORT_TREND_DAYS,
  trainingChartMargin,
  trainingChartTooltipStyle,
  type TrainingLoadWindow
} from "../chartConfig";
import type { TrainingMetricPalette } from "../chartConfig";
import {
  selectionIsOneOf,
  defineSelectionPreference,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { useChartColors } from "../useChartColors";
import {
  SPORT_COLOR_CATEGORIES,
  readStoredSportColors
} from "../sportColors";
import {
  buildTrainingLoadBars,
  trainingLoadBarLegend,
  trainingLoadBarsHaveLoad,
  type TrainingLoadBar,
  type TrainingLoadBlock
} from "../trainingLoadBars";
import type { TrainingTrendPoint } from "../types";
import type { TrainingHubActivity } from "../../../electron/types";

interface TrainingTrendChartsProps {
  points: TrainingTrendPoint[];
  /**
   * Full activity history. The load chart splits each day's column into one
   * block per activity, which is the only place the per-session breakdown
   * exists — the snapshot's trend points carry a daily total and nothing more.
   */
  activities?: TrainingHubActivity[];
}

const LOAD_WINDOW_PREFERENCE = defineSelectionPreference<TrainingLoadWindow>({
  key: "training.loadTrendWindow",
  defaultValue: TRAINING_LOAD_TREND_DAYS,
  validate: selectionIsOneOf(TRAINING_LOAD_WINDOWS)
});

/** Gap drawn between two blocks of the same column, so they read as separate. */
const LOAD_BLOCK_GAP = 2;
/** Corner radius on the topmost block only — the column sits flat on the axis. */
const LOAD_BLOCK_RADIUS = 4;
/** A block below this is invisible; every block stands for a real session. */
const LOAD_BLOCK_MIN_HEIGHT = 3;
/**
 * Bar width cap per window. A 7-day column has ten times the room a 30-day one
 * does, and the blocks inside it are only readable if it takes some of that.
 */
const LOAD_BAR_MAX_WIDTH: Record<TrainingLoadWindow, number> = {
  7: 56,
  14: 42,
  30: 30
};

type ChartValueFormatter = (value: number) => string;

function formatRoundedValue(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1
  }).format(value);
}

function formatSleepDuration(value: number): string {
  const totalMinutes = Math.max(0, Math.round(value));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatSleepAxisTick(value: number): string {
  return `${formatRoundedValue(value / 60)}h`;
}

function formatTooltipValue(
  value: unknown,
  valueFormatter?: ChartValueFormatter
): string {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (Number.isFinite(numericValue)) {
    return valueFormatter
      ? valueFormatter(numericValue)
      : formatRoundedValue(numericValue);
  }

  if (Array.isArray(value)) {
    return value.join(" – ");
  }

  return value === undefined || value === null ? "—" : String(value);
}

function usePrefersReducedMotion() {
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

function formatTooltipHeading(date: unknown, fallback: unknown): string {
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

function TrendChartTooltip({
  active,
  payload,
  label,
  valueFormatter
}: TooltipContentProps & { valueFormatter?: ChartValueFormatter }) {
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
                {entry.name}
              </span>
              <strong>{formatTooltipValue(entry.value, valueFormatter)}</strong>
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

function EmptyChartNotice({
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

interface ChartLatestStatProps {
  points: TrainingTrendPoint[];
  dataKey: keyof Pick<
    TrainingTrendPoint,
    "trainingLoad" | "rpeLoad" | "avgSleepHrv" | "sleepMinutes"
  >;
  palette: TrainingMetricPalette;
  formatValue: ChartValueFormatter;
  formatDelta: (delta: number) => string;
}

function ChartLatestStat({
  points,
  dataKey,
  palette,
  formatValue,
  formatDelta
}: ChartLatestStatProps) {
  const values = points
    .map((point) => point[dataKey])
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    );

  if (values.length === 0) {
    return null;
  }

  const latest = values[values.length - 1]!;
  const previous = values.length > 1 ? values[values.length - 2]! : undefined;
  const delta = previous === undefined ? undefined : latest - previous;

  return (
    <div className="training-chart-stat">
      <span className="training-chart-stat-value">{formatValue(latest)}</span>
      {delta !== undefined && Math.abs(delta) > 1e-9 ? (
        <span
          className="training-chart-stat-delta"
          style={{ background: palette.soft, color: palette.chip }}
        >
          {delta > 0 ? (
            <ArrowUpRight size={12} strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <ArrowDownRight size={12} strokeWidth={2.5} aria-hidden="true" />
          )}
          {formatDelta(Math.abs(delta))}
        </span>
      ) : null}
    </div>
  );
}

function HrvChartLegend() {
  return (
    <div className="training-chart-legend" aria-hidden="true">
      <span className="training-chart-legend-item">
        <span className="training-chart-legend-dot is-accent" />
        HRV
      </span>
      <span className="training-chart-legend-item">
        <span className="training-chart-legend-line is-gold" />
        Baseline
      </span>
    </div>
  );
}

type BlockColorResolver = (block: TrainingLoadBlock) => string;

/**
 * A rect whose top corners are rounded and whose bottom sits square on whatever
 * is beneath it — the axis for a single-block column, the next block down
 * otherwise.
 */
function blockPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): string {
  const r = Math.max(0, Math.min(radius, height, width / 2));
  if (r === 0) {
    return `M${x},${y}h${width}v${height}h${-width}Z`;
  }
  return [
    `M${x},${y + r}`,
    `a${r},${r} 0 0 1 ${r},${-r}`,
    `h${width - r * 2}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `v${height - r}`,
    `h${-width}`,
    "Z"
  ].join(" ");
}

interface TrainingLoadBarShapeProps {
  /** Recharts fills these in when it clones the element it was handed. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: TrainingLoadBar;
  blockColor: BlockColorResolver;
}

/**
 * Draws one day as a stack of blocks instead of a single bar. Recharts sizes
 * the column from the day's total; this splits that pixel height between the
 * day's activities in proportion to their load.
 */
function TrainingLoadBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
  blockColor
}: TrainingLoadBarShapeProps) {
  const blocks = payload?.blocks ?? [];
  const total = payload?.total ?? 0;

  if (blocks.length === 0 || total <= 0 || width <= 0 || height <= 0) {
    return null;
  }

  // A column too short to hold its gaps drops them rather than losing blocks.
  const gap =
    blocks.length > 1 && height > blocks.length * (LOAD_BLOCK_MIN_HEIGHT + 2)
      ? LOAD_BLOCK_GAP
      : 0;
  const drawable = Math.max(1, height - gap * (blocks.length - 1));
  const raw = blocks.map((block) =>
    Math.max(LOAD_BLOCK_MIN_HEIGHT, (block.value / total) * drawable)
  );
  // The per-block minimum can push the stack past the plot area; scaling it
  // back keeps the column inside its own height, which matters more.
  const rawSum = raw.reduce((sum, value) => sum + value, 0);
  const scale = rawSum > drawable ? drawable / rawSum : 1;

  let baseline = y + height;

  return (
    <g>
      {blocks.map((block, index) => {
        const blockHeight = raw[index]! * scale;
        const blockY = baseline - blockHeight;
        baseline = blockY - gap;
        const isTop = index === blocks.length - 1;
        return (
          <path
            key={block.key}
            d={blockPath(
              x,
              blockY,
              width,
              blockHeight,
              isTop ? LOAD_BLOCK_RADIUS : 0
            )}
            fill={blockColor(block)}
          />
        );
      })}
    </g>
  );
}

function TrainingLoadTooltip({
  active,
  payload,
  blockColor
}: TooltipContentProps & { blockColor: BlockColorResolver }) {
  if (!active || !payload?.length) {
    return null;
  }

  const bar = payload[0]?.payload as TrainingLoadBar | undefined;
  if (!bar) {
    return null;
  }

  const heading = formatTooltipHeading(bar.date, bar.label);
  // Top block first, so the list reads in the order the column is stacked.
  const rows = [...bar.blocks].reverse();

  return (
    <div className="training-chart-tooltip is-blocks">
      <span
        className="training-chart-tooltip-accent"
        style={{
          background: `linear-gradient(90deg, transparent, ${
            rows[0] ? blockColor(rows[0]) : "var(--accent)"
          }, transparent)`
        }}
      />
      {heading ? (
        <span className="training-chart-tooltip-label">{heading}</span>
      ) : null}
      {rows.length === 0 ? (
        <span className="training-chart-tooltip-empty">Rest day</span>
      ) : (
        <>
          <ul className="training-chart-tooltip-rows">
            {rows.map((block) => {
              const dotColor = blockColor(block);
              return (
                <li className="training-chart-tooltip-row" key={block.key}>
                  <span className="training-chart-tooltip-key">
                    <i
                      aria-hidden="true"
                      style={{
                        background: dotColor,
                        boxShadow: `0 0 8px ${dotColor}`
                      }}
                    />
                    <span className="training-chart-tooltip-name">
                      {block.label}
                    </span>
                  </span>
                  <strong>{formatRoundedValue(block.value)}</strong>
                </li>
              );
            })}
          </ul>
          {rows.length > 1 ? (
            <span className="training-chart-tooltip-total">
              Total <strong>{formatRoundedValue(bar.total)}</strong>
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

type TrendAxisDomain = [
  number | ((dataMin: number) => number),
  number | ((dataMax: number) => number)
];

/** Zero-based domain with a little headroom so peaks never touch the panel. */
function paddedZeroDomain(dataMax: number): number {
  return Math.ceil(dataMax * 1.15) || 1;
}

function TrendChartAxes({
  tooltipValueFormatter,
  tooltipContent,
  tooltipCursor,
  yAxisTickFormatter,
  yAxisWidth = 36,
  yAxisDomain
}: {
  tooltipValueFormatter?: ChartValueFormatter;
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

export function TrainingTrendCharts({
  points,
  activities = []
}: TrainingTrendChartsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { colors, metrics } = useChartColors();
  const [loadWindow, setLoadWindow] = useSelectionPreference(
    LOAD_WINDOW_PREFERENCE
  );
  // Read once per mount: the colors live in localStorage and are edited in
  // Settings, which unmounts Overview, so there is nothing to subscribe to.
  const sportColors = useMemo(() => readStoredSportColors(), []);

  const metricDot = (palette: TrainingMetricPalette) => ({
    r: 3,
    fill: palette.stroke,
    stroke: colors.dotStroke,
    strokeWidth: 2
  });
  const metricActiveDot = (palette: TrainingMetricPalette) => ({
    r: 5,
    fill: palette.stroke,
    stroke: palette.halo,
    strokeWidth: 6
  });

  const loadPoints = points.filter((point) => point.trainingLoad !== undefined);
  const loadBars = useMemo(
    () =>
      buildTrainingLoadBars({
        points,
        activities,
        days: loadWindow
      }),
    [points, activities, loadWindow]
  );
  // The empty notice answers "has this account ever logged load", so it asks
  // the widest window. A quiet week is a real answer, not a missing chart.
  const loadHistoryBars = useMemo(
    () =>
      loadWindow === TRAINING_LOAD_TREND_DAYS
        ? loadBars
        : buildTrainingLoadBars({
            points,
            activities,
            days: TRAINING_LOAD_TREND_DAYS
          }),
    [loadBars, loadWindow, points, activities]
  );
  const hasLoadHistory = trainingLoadBarsHaveLoad(loadHistoryBars);
  const blockColor = useMemo<BlockColorResolver>(
    () => (block) =>
      block.category ? sportColors[block.category] : colors.neutralFill,
    [sportColors, colors.neutralFill]
  );
  const loadLegend = useMemo(
    () => trainingLoadBarLegend(loadBars, SPORT_COLOR_CATEGORIES),
    [loadBars]
  );
  // The snapshot carries the load chart's window; the other two show its tail.
  const shortPoints = points.slice(-TRAINING_SHORT_TREND_DAYS);
  const hrvPoints = shortPoints.filter(
    (point) => point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
  );
  const sleepPoints = shortPoints.filter(
    (point) => point.sleepMinutes !== undefined
  );

  return (
    <div className="training-chart-grid">
      <section className="panel training-chart-panel" data-metric="load">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">Training Load</p>
            <h2>Last {loadWindow} days</h2>
          </div>
          <div className="training-chart-heading-side">
            {loadPoints.length > 0 ? (
              <ChartLatestStat
                points={loadPoints}
                dataKey="trainingLoad"
                palette={metrics.load}
                formatValue={formatRoundedValue}
                formatDelta={formatRoundedValue}
              />
            ) : null}
            <div
              className="training-metric-toggle"
              role="group"
              aria-label="Training load range"
            >
              {TRAINING_LOAD_WINDOWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`training-metric-option${
                    loadWindow === option ? " is-active" : ""
                  }`}
                  aria-pressed={loadWindow === option}
                  onClick={() => setLoadWindow(option)}
                >
                  {option}d
                </button>
              ))}
            </div>
          </div>
        </div>
        {hasLoadHistory ? (
          <div className="training-chart-body">
            <div className="training-chart-shell">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={loadBars}
                  margin={trainingChartMargin}
                  barCategoryGap="20%"
                  maxBarSize={LOAD_BAR_MAX_WIDTH[loadWindow]}
                >
                  <TrendChartAxes
                    tooltipContent={(props) => (
                      <TrainingLoadTooltip {...props} blockColor={blockColor} />
                    )}
                    tooltipCursor={{ fill: colors.cursorBand }}
                  />
                  <Bar
                    dataKey="total"
                    name="Training load"
                    shape={<TrainingLoadBarShape blockColor={blockColor} />}
                    isAnimationActive={!reducedMotion}
                    animationDuration={700}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {loadLegend.length > 0 ? (
              <ul className="training-chart-sport-legend">
                {loadLegend.map((entry) => (
                  <li className="training-chart-legend-item" key={entry.key}>
                    <span
                      className="training-chart-legend-swatch"
                      style={{
                        background: entry.category
                          ? sportColors[entry.category]
                          : colors.neutralFill
                      }}
                      aria-hidden="true"
                    />
                    {entry.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <EmptyChartNotice
            icon={Activity}
            palette={metrics.load}
            title="No training load yet"
          >
            Complete a workout and sync from COROS to see your load trend.
          </EmptyChartNotice>
        )}
      </section>

      <section className="panel training-chart-panel" data-metric="hrv">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">HRV vs Baseline · ms</p>
            <h2>Last 7 days</h2>
          </div>
          <div className="training-chart-heading-side">
            {hrvPoints.length > 0 ? (
              <ChartLatestStat
                points={hrvPoints}
                dataKey="avgSleepHrv"
                palette={metrics.hrv}
                formatValue={(value) => `${formatRoundedValue(value)} ms`}
                formatDelta={(delta) => `${formatRoundedValue(delta)} ms`}
              />
            ) : null}
            <HrvChartLegend />
          </div>
        </div>
        {hrvPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hrvPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id="hrvFill" stops={metrics.hrv.stops} />
                </defs>
                <TrendChartAxes
                  tooltipValueFormatter={(value) => `${formatRoundedValue(value)} ms`}
                  yAxisDomain={[
                    (dataMin: number) => Math.max(0, Math.floor(dataMin - 14)),
                    (dataMax: number) => Math.ceil(dataMax + 12) || 1
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="avgSleepHrv"
                  name="HRV"
                  stroke={metrics.hrv.stroke}
                  fill="url(#hrvFill)"
                  strokeWidth={2.5}
                  dot={metricDot(metrics.hrv)}
                  activeDot={metricActiveDot(metrics.hrv)}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                  animationDuration={850}
                />
                <Line
                  type="monotone"
                  dataKey="sleepHrvBase"
                  name="Baseline"
                  stroke={colors.gold}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                  animationDuration={850}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChartNotice
            icon={HeartPulse}
            palette={metrics.hrv}
            title="No HRV readings"
          >
            Wear your device during sleep to capture nightly HRV.
          </EmptyChartNotice>
        )}
      </section>

      <section className="panel training-chart-panel" data-metric="sleep">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">Sleep Duration · hours</p>
            <h2>Last 7 days</h2>
          </div>
          {sleepPoints.length > 0 ? (
            <ChartLatestStat
              points={sleepPoints}
              dataKey="sleepMinutes"
              palette={metrics.sleep}
              formatValue={formatSleepDuration}
              formatDelta={formatSleepDuration}
            />
          ) : null}
        </div>
        {sleepPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sleepPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient
                    id="sleepDurationFill"
                    stops={metrics.sleep.stops}
                  />
                </defs>
                <TrendChartAxes
                  tooltipValueFormatter={formatSleepDuration}
                  yAxisTickFormatter={formatSleepAxisTick}
                  yAxisWidth={42}
                />
                <Area
                  type="monotone"
                  dataKey="sleepMinutes"
                  name="Sleep duration"
                  stroke={metrics.sleep.stroke}
                  fill="url(#sleepDurationFill)"
                  strokeWidth={2.5}
                  dot={metricDot(metrics.sleep)}
                  activeDot={metricActiveDot(metrics.sleep)}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChartNotice
            icon={MoonStar}
            palette={metrics.sleep}
            title="No sleep data"
          >
            Sync sleep sessions from COROS to see duration trends.
          </EmptyChartNotice>
        )}
      </section>
    </div>
  );
}
