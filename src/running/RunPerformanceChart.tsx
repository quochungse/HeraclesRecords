import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
  TrainingHubActivitySeriesPoint,
  UnitSystem
} from "../../electron/types";
import {
  PERFORMANCE_BAND,
  PERFORMANCE_STEP_SECONDS,
  PERFORMANCE_WARM_UP_SECONDS,
  performanceCurveFromSteps,
  performanceGapKind,
  performanceRun,
  performanceVerdict,
  readingGapReason,
  runPerformanceSteps,
  sessionPerformance,
  shapeAt,
  type PerformanceGapKind,
  type PerformanceGapReason,
  type PerformanceProfile,
  type PerformanceVerdict
} from "../../electron/runPerformance";
import { OptionGroup } from "../components/OptionGroup";
import { useI18n } from "../i18n/useI18n";
import { formatDecimal, t } from "../i18n/core";
import {
  activityAxisTicks,
  axisPositionOf,
  formatXLabel,
  formatXTick,
  seriesAxisExtent,
  type ActivitySeriesAxis
} from "../training/activityAxis";
import { formatPaceSecondsPerKm } from "../training/formatters";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  niceScale,
  performanceAthleteScale,
  performanceContext,
  performanceHistory,
  performanceScaleRuns,
  STEADY_BAND_PERCENT,
  zeroOffsetIn
} from "./runPerformanceModel";

type Reading = "percent" | "absolute";

const GAP_KIND_KEYS = {
  noData: "run.perf.gap.noData",
  unsteady: "run.perf.gap.unsteady"
} as const;

const GAP_REASON_KEYS = {
  stopped: "run.perf.reason.stopped",
  walking: "run.perf.reason.walking",
  noHeartRate: "run.perf.reason.noHeartRate",
  tooEasy: "run.perf.reason.tooEasy",
  aboveMax: "run.perf.reason.aboveMax",
  end: "run.perf.reason.end",
  warmUp: "run.perf.reason.warmUp",
  paceChanging: "run.perf.reason.paceChanging",
  heartRateSettling: "run.perf.reason.heartRateSettling"
} as const;

/**
 * The run's verdict is said with its figure, in the head — a pill of its own
 * under the head read as a key to the chart's colours. The usual's own figure
 * is read on the ml/kg/min reading and in the tooltip, beside COROS's VO2max.
 */
const VERDICT_KEYS = {
  better: "run.perf.against.better",
  usual: "run.perf.against.usual",
  worse: "run.perf.against.worse"
} as const;

function VerdictIcon({ verdict }: { verdict: PerformanceVerdict }) {
  const Icon = verdict === "better" ? ArrowUpRight : verdict === "worse" ? ArrowDownRight : Minus;
  return <Icon aria-hidden="true" size={16} strokeWidth={2.25} />;
}

interface RunPerformanceChartProps {
  activity: TrainingHubActivity;
  /** The run on activity time, pauses out. */
  series: readonly TrainingHubActivitySeriesPoint[];
  /** COROS's VO2max as of this run, drawn on the ml/kg/min reading; it anchors the scale without history. */
  corosVo2max?: number;
  durationSeconds: number;
  profile: PerformanceProfile;
  /** Every run, for the six weeks before this one and the year the scale is read over. */
  allRuns: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** The year the scale is read over, read on its own (`performanceScaleRuns`). */
  scaleSummaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** The Running screen's now, so the scale's year is the one the screen reads. */
  nowMs: number;
}

interface Row {
  /** Seconds of activity time. */
  t: number;
  /** Where that moment sits on the axis: `t` itself, or the distance by then. */
  x: number;
  value?: number;
  /** The usual at this minute, on the absolute reading. */
  usual?: number;
  band?: [number, number];
  speed?: number;
  heartRate?: number;
  raw?: number;
  /** Why this step has no reading. */
  gap?: PerformanceGapReason;
  /** A value on every row, drawn by nothing: recharts hides its tooltip when no series has one. */
  hover?: number;
}

const signed = (value: number, digits = 1): string =>
  `${value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(value), digits)}`;

/**
 * A run's performance minute by minute, against the athlete's usual at the same
 * minute. Read as a percentage of the usual, or on COROS's VO2max scale beside
 * the usual curve. A stretch with no reading is drawn as one of two kinds —
 * nothing to compare (stopped, walking, no heart rate) or not steady enough to
 * read (pace changing, heart rate catching up) — and says which on hover.
 *
 * Time or distance is its own switch, apart from the Performance chart's
 * below; on the same one, the two share an extent, marks and gutters, so a
 * stretch is read straight down from one to the other.
 */
export function RunPerformanceChart({
  activity,
  series,
  corosVo2max,
  durationSeconds,
  profile,
  allRuns,
  summaries,
  scaleSummaries,
  nowMs
}: RunPerformanceChartProps) {
  // Subscribed, so the chart's words follow a change of language.
  useI18n();
  const { colors } = useChartColors();
  const { unitSystem } = useUnitSystem();
  const [reading, setReading] = useState<Reading>("percent");
  const [pickedAxis, setPickedAxis] = useState<ActivitySeriesAxis>("elapsed");
  // Every step is stamped in time; distance needs the series to have measured some.
  const hasDistance = useMemo(() => seriesAxisExtent(series, "distance") !== undefined, [series]);
  const axis: ActivitySeriesAxis = hasDistance ? pickedAxis : "elapsed";

  const { own, gapAt } = useMemo(() => {
    // The steps once, for the curve the summary would keep and for the reasons
    // the steps it leaves out are drawn with.
    const steps = runPerformanceSteps(series);
    const reasons = new Map<number, PerformanceGapReason>();
    for (const step of steps) {
      const reason =
        step.reason ?? (step.reading ? readingGapReason(step.reading[1], step.reading[2], profile) : undefined);
      if (reason) reasons.set(step.t, reason);
    }
    return { own: performanceRun(performanceCurveFromSteps(steps, corosVo2max), profile), gapAt: reasons };
  }, [corosVo2max, profile, series]);

  // The Running screen's scale, worked out from the year's own read.
  const athleteScaleValue = useMemo(
    () => performanceAthleteScale(performanceScaleRuns(allRuns, nowMs), scaleSummaries, profile),
    [allRuns, nowMs, profile, scaleSummaries]
  );

  const context = useMemo(() => {
    const at = (activity.startTime ?? 0) * 1000;
    return performanceContext(performanceHistory(allRuns, at), summaries, profile, athleteScaleValue, own);
  }, [activity.startTime, allRuns, athleteScaleValue, own, profile, summaries]);

  const baseline = context.baseline;
  const shape = baseline?.shape;
  const scale = context.scale ?? 1;
  const effective: Reading = baseline ? reading : "absolute";

  const raw = sessionPerformance(own.points, shape);
  const change = raw !== undefined && baseline ? (raw / baseline.value - 1) * 100 : undefined;
  const verdict = raw !== undefined && baseline ? performanceVerdict(raw, baseline.value) : undefined;
  const held = shape && durationSeconds / 60 > shape.lastMinute ? shape.lastMinute : undefined;

  // The steps stop where the series does, as the chart below does, or a step
  // past its last sample would stretch this axis beyond that one's.
  const lastSecond = useMemo(
    () => seriesAxisExtent(series, "elapsed")?.[1] ?? durationSeconds,
    [durationSeconds, series]
  );
  const xAt = useMemo(() => axisPositionOf(series, axis), [axis, series]);
  const xExtent = useMemo<[number, number]>(
    () => seriesAxisExtent(series, axis) ?? [0, lastSecond],
    [axis, lastSecond, series]
  );

  const rows = useMemo<Row[]>(() => {
    const byStep = new Map(own.points.map((point) => [point.t, point]));
    const out: Row[] = [];
    for (let at = 0; at <= lastSecond; at += PERFORMANCE_STEP_SECONDS) {
      const x = xAt(at);
      if (x === undefined) continue;
      const point = byStep.get(at);
      const usual = baseline ? baseline.value * shapeAt(shape, at) : undefined;
      const row: Row = { t: at, x };
      if (effective === "absolute" && usual !== undefined && at >= PERFORMANCE_WARM_UP_SECONDS) {
        row.usual = usual * scale;
        row.band = [usual * scale * (1 - PERFORMANCE_BAND), usual * scale * (1 + PERFORMANCE_BAND)];
      }
      if (!point) {
        row.gap = gapAt.get(at) ?? "end";
      } else {
        row.raw = point.value;
        row.speed = point.speed;
        row.heartRate = point.heartRate;
        row.value =
          effective === "percent" && usual !== undefined
            ? (point.value / usual - 1) * 100
            : point.value * scale;
      }
      out.push(row);
    }
    return out;
  }, [baseline, effective, gapAt, lastSecond, own.points, scale, shape, xAt]);

  // Stretches with no reading, one per run of the same kind: hatched where the
  // data was not steady, dotted where there was none to compare. A step is drawn
  // from half a step before it to half a step after, so a lone gap shows too.
  const gaps = useMemo(() => {
    const out: { from: number; to: number; kind: PerformanceGapKind; warmUp: boolean }[] = [];
    const half = PERFORMANCE_STEP_SECONDS / 2;
    for (const row of rows) {
      if (row.gap === undefined) continue;
      const kind = performanceGapKind(row.gap);
      const last = out[out.length - 1];
      const from = Math.max(0, row.t - half);
      const to = Math.min(lastSecond, row.t + half);
      if (last && last.kind === kind && last.to >= from) {
        last.to = to;
        last.warmUp &&= row.gap === "warmUp";
      } else {
        out.push({ from, to, kind, warmUp: row.gap === "warmUp" });
      }
    }
    // Placed on the axis once merged: on distance, a stretch spans the ground
    // covered in it.
    return out.flatMap((gap) => {
      const x1 = xAt(gap.from);
      const x2 = xAt(gap.to);
      return x1 === undefined || x2 === undefined ? [] : [{ ...gap, x1, x2 }];
    });
  }, [lastSecond, rows, xAt]);

  // COROS's own figure, beside the usual on the ml/kg/min reading: the one the
  // curve kept, which is checked to be a VO2max at all.
  const corosLine = effective === "absolute" ? own.corosVo2max : undefined;
  const values = [
    ...rows.flatMap((row) => [...(row.value !== undefined ? [row.value] : []), ...(row.band ?? [])]),
    ...(corosLine !== undefined ? [corosLine] : [])
  ];
  const yMin = Math.min(effective === "percent" ? -6 : Infinity, ...values);
  const yMax = Math.max(effective === "percent" ? 6 : -Infinity, ...values);
  const { domain, ticks: yTicks } = niceScale(yMin, yMax, { includeZero: effective === "percent" });
  const hoverRows = rows.map((row) => ({ ...row, hover: domain[0] }));
  // Where zero falls, for the gradients that colour above and below it — each in
  // its own shape's box, not the plot's: the line spans its readings, the fill
  // its readings down (or up) to zero.
  const readings = rows.flatMap((row) => (row.value !== undefined ? [row.value] : []));
  const lowest = Math.min(...readings);
  const highest = Math.max(...readings);
  const lineZeroAt = zeroOffsetIn(lowest, highest);
  const fillZeroAt = zeroOffsetIn(Math.min(0, lowest), Math.max(0, highest));
  const xTicks = activityAxisTicks(xExtent[0], xExtent[1], axis, unitSystem);

  if (own.points.length === 0) {
    return (
      <section className="panel run-block run-performance">
        <p className="running-eyebrow">{t("run.perf.title")}</p>
        <p className="run-block-empty">{t("run.perf.noReadings")}</p>
      </section>
    );
  }

  return (
    <section className="panel run-block run-performance">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("run.perf.title")}</p>
          <h3>
            {raw !== undefined ? formatDecimal(raw * scale, 1) : "—"}
            <span className="run-block-sub"> {t("run.perf.unit")}</span>
            {change !== undefined && verdict ? (
              <span className={`run-performance-change is-${verdict}`}>
                {" "}
                <span className="run-performance-delta">
                  <VerdictIcon verdict={verdict} />
                  {signed(change)}%
                </span>{" "}
                <span className="run-block-sub">{t(VERDICT_KEYS[verdict])}</span>
              </span>
            ) : null}
          </h3>
        </div>
        <div className="run-performance-controls">
          <OptionGroup<Reading>
            label={t("run.perf.reading")}
            value={effective}
            options={[
              { value: "percent", label: t("run.perf.readingPercent"), disabled: !baseline },
              { value: "absolute", label: t("run.perf.unit") }
            ]}
            onChange={setReading}
          />
          <OptionGroup<ActivitySeriesAxis>
            label={t("activity.chart.xAxis")}
            value={axis}
            options={[
              { value: "elapsed", label: t("activity.m.time") },
              { value: "distance", label: t("activity.m.distance"), disabled: !hasDistance }
            ]}
            onChange={setPickedAxis}
          />
        </div>
      </header>

      <div className="run-block-plot">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={hoverRows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <defs>
              <pattern
                id="run-performance-hatch"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="6" stroke={colors.cursor} strokeWidth="2" />
              </pattern>
              <pattern id="run-performance-dots" width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="3" cy="3" r="1" fill={colors.cursor} />
              </pattern>
              <linearGradient id="run-performance-split" x1="0" y1="0" x2="0" y2="1">
                <stop offset={lineZeroAt} stopColor={colors.better} />
                <stop offset={lineZeroAt} stopColor={colors.worse} />
              </linearGradient>
              <linearGradient id="run-performance-split-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset={fillZeroAt} stopColor={colors.better} stopOpacity={0.18} />
                <stop offset={fillZeroAt} stopColor={colors.worse} stopOpacity={0.18} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            {/* The Performance chart's axis, prop for prop. */}
            <XAxis
              dataKey="x"
              type="number"
              domain={xExtent}
              ticks={xTicks}
              tick={{ fill: colors.text, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colors.grid }}
              tickMargin={6}
              tickFormatter={(value: number) => formatXTick(axis, value, unitSystem)}
              minTickGap={48}
            />
            <YAxis
              domain={domain}
              ticks={yTicks}
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              tickFormatter={(value: number) =>
                effective === "percent" ? (value === 0 ? "0" : `${signed(value, 0)}%`) : String(value)
              }
            />
            {/* Recharts' own gutter on the left, as below, and an empty one on
                the right as wide as the Performance chart's right axis. */}
            <YAxis yAxisId="spare-right" orientation="right" tick={false} axisLine={false} tickLine={false} />
            {gaps.map((gap) => (
              <ReferenceArea
                key={gap.from}
                x1={gap.x1}
                x2={gap.x2}
                fill={gap.kind === "unsteady" ? "url(#run-performance-hatch)" : "url(#run-performance-dots)"}
                fillOpacity={1}
                ifOverflow="hidden"
                label={
                  gap.warmUp && gap.to - gap.from >= 8 * 60
                    ? { value: t("run.perf.reason.warmUp"), fill: colors.text, fontSize: 11, position: "insideTop" }
                    : undefined
                }
              />
            ))}
            {effective === "percent" ? (
              <ReferenceArea
                y1={-PERFORMANCE_BAND * 100}
                y2={PERFORMANCE_BAND * 100}
                fill={colors.cursorBand}
                fillOpacity={1}
                ifOverflow="hidden"
              />
            ) : (
              <Area
                dataKey="band"
                stroke="none"
                fill={colors.cursorBand}
                fillOpacity={1}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            {effective === "percent" ? (
              <ReferenceLine y={0} stroke={colors.text} strokeDasharray="5 4" />
            ) : (
              <Line
                dataKey="usual"
                stroke={colors.text}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            {corosLine !== undefined ? (
              // Dotted where the usual is dashed, in the same quiet ink: a reference, not the run.
              <ReferenceLine y={corosLine} stroke={colors.text} strokeWidth={1.5} strokeDasharray="1 4" strokeLinecap="round" />
            ) : null}
            {held !== undefined ? (
              <ReferenceLine
                x={xAt(held * 60)}
                stroke={colors.text}
                strokeOpacity={0.6}
                label={{
                  value: t("run.perf.held", { minute: held }),
                  fill: colors.text,
                  fontSize: 11,
                  position: "insideBottomRight"
                }}
              />
            ) : null}
            {effective === "percent" ? (
              <Area
                dataKey="value"
                baseValue={0}
                stroke="url(#run-performance-split)"
                strokeWidth={2}
                fill="url(#run-performance-split-fill)"
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : (
              <Line
                dataKey="value"
                stroke={colors.accentBright}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            <Line
              dataKey="hover"
              stroke="none"
              dot={false}
              activeDot={false}
              legendType="none"
              isAnimationActive={false}
            />
            <Tooltip
              cursor={{ stroke: colors.cursor }}
              content={(props: TooltipContentProps) => (
                <PerformanceTooltip
                  {...props}
                  axis={axis}
                  unitSystem={unitSystem}
                  reading={effective}
                  scale={scale}
                  usualAt={(at) => (baseline ? baseline.value * shapeAt(shape, at) * scale : undefined)}
                  formatPace={(speed) => formatPaceSecondsPerKm(60_000 / speed, unitSystem)}
                />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="run-legend run-performance-legend">
        <span>
          <i className="run-performance-swatch is-unsteady" aria-hidden="true" />
          {t("run.perf.gap.unsteady")}
        </span>
        <span>
          <i className="run-performance-swatch is-no-data" aria-hidden="true" />
          {t("run.perf.gap.noData")}
        </span>
      </div>

      <p className="run-block-note">
        {baseline
          ? t("run.perf.scaleNote", STEADY_BAND_PERCENT)
          : t("run.perf.noBaseline")}
        {corosLine !== undefined ? ` ${t("run.perf.corosNote")}` : ""}
        {held !== undefined ? ` ${t("run.perf.heldNote", { minute: held })}` : ""}
      </p>
    </section>
  );
}

function PerformanceTooltip({
  active,
  payload,
  axis,
  unitSystem,
  reading,
  scale,
  usualAt,
  formatPace
}: TooltipContentProps & {
  axis: ActivitySeriesAxis;
  unitSystem: UnitSystem;
  reading: Reading;
  scale: number;
  usualAt: (seconds: number) => number | undefined;
  formatPace: (speed: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  // Headed as the chart below heads its tooltip, and the clock beside a distance.
  const clock =
    axis === "distance"
      ? `${formatXLabel("distance", row.x, unitSystem)} · ${formatXLabel("elapsed", row.t, unitSystem)}`
      : formatXLabel("elapsed", row.t, unitSystem);
  const usual = usualAt(row.t);
  const read = row.raw !== undefined && row.speed !== undefined && row.heartRate !== undefined;
  return (
    <div className="training-chart-tooltip">
      <span className="training-chart-tooltip-label">{clock}</span>
      <ul className="training-chart-tooltip-rows">
        {read ? (
          <>
            <li className="training-chart-tooltip-row">
              <span className="training-chart-tooltip-key">{t("run.perf.tip.run")}</span>
              <strong>
                {formatDecimal(row.raw! * scale, 1)}
                {reading === "percent" && row.value !== undefined ? ` · ${signed(row.value)}%` : ""}
              </strong>
            </li>
            {usual !== undefined ? (
              <li className="training-chart-tooltip-row">
                <span className="training-chart-tooltip-key">{t("run.perf.tip.usual")}</span>
                <strong>{formatDecimal(usual, 1)}</strong>
              </li>
            ) : null}
            <li className="training-chart-tooltip-row">
              <span className="training-chart-tooltip-key">{t("activity.channel.adjustedPace")}</span>
              <strong>{formatPace(row.speed!)}</strong>
            </li>
            <li className="training-chart-tooltip-row">
              <span className="training-chart-tooltip-key">{t("activity.channel.hr")}</span>
              {/* i18n-ignore: a unit */}
              <strong>{Math.round(row.heartRate!)} bpm</strong>
            </li>
          </>
        ) : row.gap ? (
          <li className="training-chart-tooltip-row">
            <span className="training-chart-tooltip-key">
              <i
                className={`run-performance-swatch is-${performanceGapKind(row.gap) === "unsteady" ? "unsteady" : "no-data"}`}
                aria-hidden="true"
              />
              {t(GAP_KIND_KEYS[performanceGapKind(row.gap)])}
            </span>
            <strong>{t(GAP_REASON_KEYS[row.gap])}</strong>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
