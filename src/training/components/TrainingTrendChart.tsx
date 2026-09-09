import { useMemo, type CSSProperties } from "react";
import { Activity } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer } from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  TRAINING_LOAD_TREND_DAYS,
  TRAINING_LOAD_WINDOWS,
  trainingChartMargin,
  type TrainingLoadBlockStyle,
  type TrainingLoadWindow
} from "../chartConfig";
import {
  selectionIsOneOf,
  defineSelectionPreference,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { useChartColors } from "../useChartColors";
import { HrvBaselineChart } from "./HrvBaselineChart";
import { SleepTrendPanel } from "./SleepTrendPanel";
import {
  EmptyChartNotice,
  TrendChartAxes,
  TrendWindowToggle,
  formatRoundedValue,
  formatTooltipHeading,
  usePrefersReducedMotion
} from "./trendChartParts";
import {
  SPORT_COLOR_CATEGORIES,
  readStoredSportColors
} from "../sportColors";
import {
  TRAINING_LOAD_RESIDUAL_KEY,
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
/** A block below this is invisible; every block stands for a real session. */
const LOAD_BLOCK_MIN_HEIGHT = 3;
/** How much brighter the hovered column is drawn than its neighbours. */
const LOAD_BLOCK_ACTIVE_BOOST = 1.5;
/** Prefix for the per-sport gradient ids this chart puts in its own defs. */
const LOAD_GRADIENT_PREFIX = "trainingLoadBlock";
/** One shared white highlight, mapped to each block's own box by the browser. */
const LOAD_SHEEN_GRADIENT_ID = "trainingLoadBlockSheen";
/**
 * Bar width cap per window. A 7-day column has ten times the room a 30-day one
 * does, and the blocks inside it are only readable if it takes some of that.
 */
const LOAD_BAR_MAX_WIDTH: Record<TrainingLoadWindow, number> = {
  7: 56,
  14: 42,
  30: 30
};

/**
 * A hex sport color at a given alpha, for the one place a color has to be
 * inlined into a CSS filter string rather than handed to an SVG attribute.
 * Non-hex input is returned untouched — a caller passing a CSS color function
 * is already something drop-shadow can take.
 */
function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }
  const value = Number.parseInt(color.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

type BlockColorResolver = (block: TrainingLoadBlock) => string;
type BlockGradientResolver = (block: TrainingLoadBlock) => string;

/**
 * A rect with independent top and bottom corner radii — the column's own top is
 * rounded most, the edges facing a gap a little, and the edge sitting on the
 * axis not at all.
 */
function blockPath(
  x: number,
  y: number,
  width: number,
  height: number,
  topRadius: number,
  bottomRadius: number
): string {
  // A corner arc needs `r` of width on each side and `r` of height, so the two
  // radii together may use the full height — not half of it each. Clamping to
  // height / 2 is what squared the top of every column: the lit cap is only a
  // few pixels tall, so its radius collapsed to a fraction of the slab's and it
  // painted the rounded corners back in.
  let rt = Math.max(0, Math.min(topRadius, width / 2));
  let rb = Math.max(0, Math.min(bottomRadius, width / 2));
  if (rt + rb > height) {
    const fit = height / (rt + rb);
    rt *= fit;
    rb *= fit;
  }
  return [
    `M${x},${y + rt}`,
    rt > 0 ? `a${rt},${rt} 0 0 1 ${rt},${-rt}` : "",
    `h${width - rt * 2}`,
    rt > 0 ? `a${rt},${rt} 0 0 1 ${rt},${rt}` : "",
    `v${height - rt - rb}`,
    rb > 0 ? `a${rb},${rb} 0 0 1 ${-rb},${rb}` : "",
    `h${-(width - rb * 2)}`,
    rb > 0 ? `a${rb},${rb} 0 0 1 ${-rb},${-rb}` : "",
    "Z"
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Vertical gradient per sport, referenced by every block of that sport. The
 * stops are opacities of the sport's own color, so one recipe dresses all of
 * them and the color settings stay the only place a hue is chosen.
 */
function TrainingLoadBlockGradients({
  entries,
  style
}: {
  entries: { id: string; color: string }[];
  style: TrainingLoadBlockStyle;
}) {
  return (
    <>
      {entries.map((entry) => (
        <linearGradient key={entry.id} id={entry.id} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={entry.color}
            stopOpacity={style.fill.top}
          />
          <stop
            offset="100%"
            stopColor={entry.color}
            stopOpacity={style.fill.bottom}
          />
        </linearGradient>
      ))}
      <linearGradient
        id={LOAD_SHEEN_GRADIENT_ID}
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop offset="0%" stopColor="#ffffff" stopOpacity={style.sheenOpacity} />
        <stop
          offset="55%"
          stopColor="#ffffff"
          stopOpacity={style.sheenOpacity * 0.25}
        />
        <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
      </linearGradient>
    </>
  );
}

/**
 * The slot a day's column stands in — rounded on top like the column, square on
 * the axis. Drawn for every day, so an empty one reads as a rest day rather
 * than as a gap in the data.
 */
function TrainingLoadTrackShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill,
  radius,
  maxWidth
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill: string;
  radius: number;
  /** Recharts sizes backgrounds off the band, not off maxBarSize — match it. */
  maxWidth: number;
}) {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const trackWidth = Math.min(width, maxWidth);
  return (
    <path
      d={blockPath(
        x + (width - trackWidth) / 2,
        y,
        trackWidth,
        height,
        radius,
        0
      )}
      fill={fill}
    />
  );
}

interface TrainingLoadBarShapeProps {
  /** Recharts fills these in when it clones the element it was handed. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: TrainingLoadBar;
  blockColor: BlockColorResolver;
  blockGradient: BlockGradientResolver;
  style: TrainingLoadBlockStyle;
  /** Set on the hovered column, which is drawn brighter than its neighbours. */
  active?: boolean;
}

/**
 * Draws one day as a stack of translucent slabs instead of a single bar.
 * Recharts sizes the column from the day's total; this splits that pixel height
 * between the day's activities in proportion to their load, then paints each
 * piece as glass: a vertical gradient, a hairline in the same hue, and a lit
 * edge along the top so two sessions of one sport still read as two.
 */
function TrainingLoadBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
  blockColor,
  blockGradient,
  style,
  active = false
}: TrainingLoadBarShapeProps) {
  const blocks = payload?.blocks ?? [];
  const total = payload?.total ?? 0;

  if (width <= 0) {
    return null;
  }

  // A day with nothing on it draws no slab at all: its empty track is already
  // on screen, and an empty slot says "rest day" where a stub of color would
  // claim a session that never happened.
  if (blocks.length === 0 || total <= 0 || height <= 0) {
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
  const boost = active ? LOAD_BLOCK_ACTIVE_BOOST : 1;

  let baseline = y + height;

  return (
    <g>
      {blocks.map((block, index) => {
        const blockHeight = raw[index]! * scale;
        const blockY = baseline - blockHeight;
        baseline = blockY - gap;
        const isTop = index === blocks.length - 1;
        const isBottom = index === 0;
        const color = blockColor(block);
        const topRadius = isTop ? style.topRadius : style.innerRadius;
        const bottomRadius = isBottom ? 0 : style.innerRadius;
        // The lit edge has to be at least as tall as the corner it rounds, or
        // its own arc gets squeezed and the slab's corner shows through square.
        const capHeight = Math.min(
          blockHeight,
          Math.max(style.capHeight, topRadius)
        );

        return (
          <g key={block.key}>
            <path
              d={blockPath(x, blockY, width, blockHeight, topRadius, bottomRadius)}
              fill={`url(#${blockGradient(block)})`}
              stroke={color}
              strokeOpacity={Math.min(1, style.strokeOpacity * boost)}
              strokeWidth={style.strokeWidth}
              style={
                style.glowOpacity > 0
                  ? {
                      filter: `drop-shadow(0 1px ${style.glowBlur}px ${withAlpha(
                        color,
                        Math.min(1, style.glowOpacity * boost)
                      )})`
                    }
                  : undefined
              }
            />
            {style.sheenOpacity > 0 ? (
              <path
                d={blockPath(x, blockY, width, blockHeight, topRadius, bottomRadius)}
                fill={`url(#${LOAD_SHEEN_GRADIENT_ID})`}
              />
            ) : null}
            {capHeight > 0 ? (
              <path
                d={blockPath(x, blockY, width, capHeight, topRadius, 0)}
                fill={color}
                fillOpacity={Math.min(1, style.capOpacity * boost)}
              />
            ) : null}
          </g>
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

export function TrainingTrendCharts({
  points,
  activities = []
}: TrainingTrendChartsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { colors, metrics, loadBlock } = useChartColors();
  const [loadWindow, setLoadWindow] = useSelectionPreference(
    LOAD_WINDOW_PREFERENCE
  );
  // Read once per mount: the colors live in localStorage and are edited in
  // Settings, which unmounts Overview, so there is nothing to subscribe to.
  const sportColors = useMemo(() => readStoredSportColors(), []);

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
  const blockGradient = useMemo<BlockGradientResolver>(
    () => (block) =>
      `${LOAD_GRADIENT_PREFIX}-${block.category ?? TRAINING_LOAD_RESIDUAL_KEY}`,
    []
  );
  const blockGradientEntries = useMemo(
    () => [
      ...SPORT_COLOR_CATEGORIES.map((category) => ({
        id: `${LOAD_GRADIENT_PREFIX}-${category}`,
        color: sportColors[category]
      })),
      {
        id: `${LOAD_GRADIENT_PREFIX}-${TRAINING_LOAD_RESIDUAL_KEY}`,
        color: colors.neutralFill
      }
    ],
    [sportColors, colors.neutralFill]
  );
  // Recharts restarts the grow animation whenever these props change identity,
  // and it re-renders on every animation frame — so a fresh object literal here
  // pins the columns at a hair above zero forever.
  const loadBarShape = useMemo(
    () => (
      <TrainingLoadBarShape
        blockColor={blockColor}
        blockGradient={blockGradient}
        style={loadBlock}
      />
    ),
    [blockColor, blockGradient, loadBlock]
  );
  const loadActiveBarShape = useMemo(
    () => (
      <TrainingLoadBarShape
        blockColor={blockColor}
        blockGradient={blockGradient}
        style={loadBlock}
        active
      />
    ),
    [blockColor, blockGradient, loadBlock]
  );
  const loadBarTrack = useMemo(
    () => (
      <TrainingLoadTrackShape
        fill={loadBlock.trackFill}
        radius={loadBlock.trackRadius}
        maxWidth={LOAD_BAR_MAX_WIDTH[loadWindow]}
      />
    ),
    [loadBlock.trackFill, loadBlock.trackRadius, loadWindow]
  );
  // Recharts' own cursor spans the whole day band, which at seven columns is
  // three times the width of the column it is pointing at. Lighting up the
  // track instead keeps the hover the same shape as the thing being read.
  const loadBarCursor = useMemo(
    () => (
      <TrainingLoadTrackShape
        fill={loadBlock.trackHoverFill}
        radius={loadBlock.trackRadius}
        maxWidth={LOAD_BAR_MAX_WIDTH[loadWindow]}
      />
    ),
    [loadBlock.trackHoverFill, loadBlock.trackRadius, loadWindow]
  );
  const loadLegend = useMemo(
    () => trainingLoadBarLegend(loadBars, SPORT_COLOR_CATEGORIES),
    [loadBars]
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
            <TrendWindowToggle
              options={TRAINING_LOAD_WINDOWS}
              value={loadWindow}
              onChange={setLoadWindow}
              label="Training load range"
            />
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
                  <defs>
                    <TrainingLoadBlockGradients
                      entries={blockGradientEntries}
                      style={loadBlock}
                    />
                  </defs>
                  <TrendChartAxes
                    tooltipContent={(props) => (
                      <TrainingLoadTooltip {...props} blockColor={blockColor} />
                    )}
                    tooltipCursor={loadBarCursor}
                  />
                  <Bar
                    dataKey="total"
                    name="Training load"
                    background={loadBarTrack}
                    shape={loadBarShape}
                    activeBar={loadActiveBarShape}
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
                      style={
                        {
                          "--swatch-color": entry.category
                            ? sportColors[entry.category]
                            : colors.neutralFill
                        } as CSSProperties
                      }
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

      <HrvBaselineChart points={points} />

      <SleepTrendPanel points={points} />
    </div>
  );
}
