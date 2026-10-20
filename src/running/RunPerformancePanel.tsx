import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import {
  PERFORMANCE_BAND,
  type PerformanceProfile
} from "../../electron/runPerformance";
import { useI18n } from "../i18n/useI18n";
import { formatDecimal, getIntlLocale, t } from "../i18n/core";
import { formatPaceSecondsPerKm } from "../training/formatters";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { secondsPerKmToDisplayPace } from "../units/units";
import { periodLabel, periodPhrase, type PeriodDays } from "../preferences/periodScale";
import {
  niceScale,
  performanceContext,
  performanceCoverage,
  performanceForm,
  performanceHistory,
  performanceRunsNeeded,
  performanceSessions,
  performanceRollingMedian,
  performanceTrend,
  TREND_DAYS,
  performanceWeeks,
  type PerformanceSession,
  type PerformanceTrendPoint
} from "./runPerformanceModel";

interface RunPerformancePanelProps {
  /** The runs on screen: the period, on the chosen surface. */
  runs: readonly TrainingHubActivity[];
  /** Every run, for the usual. */
  allRuns: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  profile: PerformanceProfile | undefined;
  weeks: number;
  /** The period chosen on the screen, which the headline and the quadrant read. */
  periodDays: PeriodDays;
  nowMs: number;
}

const signed = (value: number, digits = 1): string =>
  `${value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(value), digits)}`;

/** Seconds as m:ss — a pace already in the display unit. */
function clock(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(getIntlLocale(), { month: "short", day: "numeric" });
}

interface TrendPoint {
  x: number;
  y: number;
  session?: PerformanceSession;
}

/**
 * Running performance across the period, in place of the efficiency chart.
 * Every road and track run with a stretch steady enough to read counts — no
 * easy-only filter, since the figure no longer favours a faster run.
 */
export function RunPerformancePanel({
  runs,
  allRuns,
  summaries,
  profile,
  weeks,
  periodDays,
  nowMs
}: RunPerformancePanelProps) {
  // Subscribed, so the chart's words follow a change of language.
  useI18n();
  const { colors } = useChartColors();
  const { unitSystem } = useUnitSystem();

  const coverage = useMemo(
    () => performanceCoverage(performanceRunsNeeded(allRuns, runs), summaries),
    [allRuns, runs, summaries]
  );

  const model = useMemo(() => {
    if (!profile) return null;
    const context = performanceContext(performanceHistory(allRuns, nowMs + 1), summaries, profile);
    const sessions = performanceSessions(runs, summaries, profile, context);
    const rows = performanceWeeks(sessions, weeks, nowMs);
    return {
      context,
      sessions,
      rows,
      form: performanceForm(sessions),
      trend: performanceTrend(rows)
    };
  }, [allRuns, nowMs, profile, runs, summaries, weeks]);

  const scale = model?.context.scale ?? 1;
  const usual = model?.context.baseline ? model.context.baseline.value * scale : undefined;
  // In ml/kg/min only: the screen states the figure, and how far a run sits
  // from the usual is the dashed line and each dot's colour.
  const { trendPoints, trendLine } = useMemo(() => {
    if (!model) return { trendPoints: [] as TrendPoint[], trendLine: [] as PerformanceTrendPoint[] };
    return {
      trendPoints: model.sessions.map<TrendPoint>((session) => ({
        x: session.startedAtMs,
        y: session.value,
        session
      })),
      trendLine: performanceRollingMedian(model.sessions)
    };
  }, [model]);

  const quadrant = useMemo(() => {
    if (!model?.context.baseline) return [];
    return model.sessions
      .filter((session) => session.pace !== undefined && session.change !== undefined)
      .map((session) => ({
        x: secondsPerKmToDisplayPace(session.pace!, unitSystem),
        y: session.change!,
        session
      }));
  }, [model, unitSystem]);
  const usualPace = useMemo(() => {
    const paces = quadrant.map((point) => point.x).sort((a, b) => a - b);
    return paces.length > 0 ? paces[paces.length >> 1] : undefined;
  }, [quadrant]);
  // Centred on the usual pace and the usual, and wide enough that the runs sit
  // in the middle and the four corners are left to their words.
  const quadrantScale = useMemo(() => {
    if (usualPace === undefined) return undefined;
    const paceReach = Math.max(20, ...quadrant.map((point) => Math.abs(point.x - usualPace))) * 1.6;
    const changeReach = Math.max(6, ...quadrant.map((point) => Math.abs(point.y))) * 1.6;
    return {
      x: [usualPace - paceReach, usualPace + paceReach] as [number, number],
      xTicks: [usualPace - paceReach / 2, usualPace, usualPace + paceReach / 2],
      y: niceScale(-changeReach, changeReach, { symmetric: true })
    };
  }, [quadrant, usualPace]);

  if (!profile) {
    return (
      <section className="panel run-block run-performance">
        <p className="running-eyebrow">{t("run.perf.title")}</p>
        <p className="run-block-empty">{t("run.perf.needProfile")}</p>
      </section>
    );
  }

  const pending = coverage.read < coverage.total;
  const headline = model?.form === undefined ? "—" : formatDecimal(model.form, 1);
  // From the Monday the period starts on, as its runs are cut: `now − weeks`
  // reached back into the week before, days no run on the chart can sit in.
  const start = Math.min(model?.rows[0]?.weekStartMs ?? nowMs, ...trendPoints.map((point) => point.x));
  const yValues = [...trendPoints.map((point) => point.y), ...trendLine.map((point) => point.median)];
  const band =
    usual === undefined ? undefined : [usual * (1 - PERFORMANCE_BAND), usual * (1 + PERFORMANCE_BAND)];
  const trendScale = niceScale(Math.min(...yValues, ...(band ?? [])), Math.max(...yValues, ...(band ?? [])));

  return (
    <section className="panel run-block run-performance">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("run.perf.title")}</p>
          <h3>
            {headline}
            <span className="run-block-sub">
              {" "}
              {t("run.perf.form", { period: periodPhrase(periodDays) })}
            </span>
          </h3>
        </div>
        <div className="sport-volume-aside">
          <p className="run-block-aside">
            {t("run.perf.scope")}
            {model?.trend ? (
              <>
                {" · "}
                <strong className={model.trend.change >= 0 ? "tone-up" : "tone-down"}>
                  {signed(model.trend.change)}%
                </strong>{" "}
                {t("run.perf.since", { date: dayLabel(model.trend.sinceMs) })}
              </>
            ) : null}
            {pending
              ? ` · ${t("run.perf.readingRuns", { read: coverage.read, total: coverage.total })}`
              : ""}
          </p>
        </div>
      </header>

      {trendPoints.length === 0 ? (
        <p className="run-block-empty">{pending ? t("run.perf.waiting") : t("run.perf.none")}</p>
      ) : (
        <div className="run-block-split">
          <div className="run-block-plot">
            <p className="run-performance-plot-title">{t("run.perf.rolling", { days: TREND_DAYS })}</p>
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[start, nowMs]}
                  tickFormatter={dayLabel}
                  tick={{ fill: colors.text, fontSize: 11 }}
                  stroke={colors.grid}
                  minTickGap={24}
                />
                <YAxis
                  domain={trendScale.domain}
                  ticks={trendScale.ticks}
                  tick={{ fill: colors.text, fontSize: 11 }}
                  stroke={colors.grid}
                  width={44}
                />
                {band ? (
                  <ReferenceArea y1={band[0]} y2={band[1]} fill={colors.cursorBand} fillOpacity={1} ifOverflow="hidden" />
                ) : null}
                {usual !== undefined ? (
                  <ReferenceLine
                    y={usual}
                    stroke={colors.text}
                    strokeDasharray="5 4"
                  />
                ) : null}
                <Scatter data={trendPoints} dataKey="y" isAnimationActive={false} shape={<TrendDot colors={colors} usual={usual} />} />
                <Line
                  data={trendLine}
                  dataKey="median"
                  type="monotone"
                  stroke={colors.text}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Tooltip
                  cursor={{ stroke: colors.cursor }}
                  content={(props: TooltipContentProps) => (
                    <SessionTooltip {...props} usual={usual} formatPace={(pace) => formatPaceSecondsPerKm(pace, unitSystem)} />
                  )}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {usual !== undefined ? (
              <p className="run-block-note">{t("run.perf.usualLine", { value: formatDecimal(usual, 1) })}</p>
            ) : (
              <p className="run-block-note">{t("run.perf.noBaseline")}</p>
            )}
          </div>

          {quadrant.length > 0 && usualPace !== undefined && quadrantScale ? (
            <div className="run-block-plot run-performance-quadrant">
              <p className="run-performance-plot-title">{t("run.perf.quadrant", { period: periodLabel(periodDays) })}</p>
              <div className="run-performance-quadrant-plot">
                <ResponsiveContainer width="100%" height={230}>
                  <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      reversed
                      domain={quadrantScale.x}
                      ticks={quadrantScale.xTicks}
                      tickFormatter={clock}
                      tick={{ fill: colors.text, fontSize: 11 }}
                      stroke={colors.grid}
                    />
                    <YAxis
                      dataKey="y"
                      type="number"
                      domain={quadrantScale.y.domain}
                      ticks={quadrantScale.y.ticks}
                      tickFormatter={(value: number) => (value === 0 ? "0" : `${signed(value, 0)}%`)}
                      tick={{ fill: colors.text, fontSize: 11 }}
                      stroke={colors.grid}
                      width={44}
                    />
                    <ZAxis range={[50, 50]} />
                    <ReferenceLine x={usualPace} stroke={colors.text} strokeDasharray="5 4" />
                    <ReferenceLine y={0} stroke={colors.text} strokeDasharray="5 4" />
                    <Scatter data={quadrant} isAnimationActive={false} shape={<QuadrantDot colors={colors} />} />
                    <Tooltip
                      cursor={false}
                      content={(props: TooltipContentProps) => (
                        <SessionTooltip {...props} usual={usual} formatPace={(pace) => formatPaceSecondsPerKm(pace, unitSystem)} />
                      )}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
                <span className="run-performance-corner is-top-left">
                  <strong>{t("run.perf.q.slowGood")}</strong>
                  {t("run.perf.q.slowGoodSub")}
                </span>
                <span className="run-performance-corner is-top-right">
                  <strong>{t("run.perf.q.fastGood")}</strong>
                  {t("run.perf.q.fastGoodSub")}
                </span>
                <span className="run-performance-corner is-bottom-left">
                  <strong>{t("run.perf.q.slowBad")}</strong>
                  {t("run.perf.q.slowBadSub")}
                </span>
                <span className="run-performance-corner is-bottom-right">
                  <strong>{t("run.perf.q.fastBad")}</strong>
                  {t("run.perf.q.fastBadSub")}
                </span>
              </div>
              <p className="run-block-note">{t("run.perf.quadrantNote")}</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

type Colors = ReturnType<typeof useChartColors>["colors"];

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: { session?: PerformanceSession; y?: number };
}

function TrendDot({ cx, cy, payload, colors, usual }: DotProps & { colors: Colors; usual?: number }) {
  if (cx === undefined || cy === undefined || !payload?.session) return null;
  const below = usual !== undefined && payload.session.value < usual;
  return <circle cx={cx} cy={cy} r={4} fill={below ? colors.worse : colors.better} stroke={colors.dotStroke} strokeWidth={1.5} />;
}

function QuadrantDot({ cx, cy, payload, colors }: DotProps & { colors: Colors }) {
  if (cx === undefined || cy === undefined || payload?.y === undefined) return null;
  return <circle cx={cx} cy={cy} r={5} fill={payload.y < 0 ? colors.worse : colors.better} stroke={colors.dotStroke} strokeWidth={1.5} />;
}

function SessionTooltip({
  active,
  payload,
  usual,
  formatPace
}: TooltipContentProps & { usual?: number; formatPace: (pace: number) => string }) {
  if (!active || !payload?.length) return null;
  const session = (payload[0]?.payload as { session?: PerformanceSession } | undefined)?.session;
  if (!session) return null;
  return (
    <div className="training-chart-tooltip">
      <span className="training-chart-tooltip-label">
        {dayLabel(session.startedAtMs)}
        {session.activity.name ? ` · ${session.activity.name}` : ""}
      </span>
      <ul className="training-chart-tooltip-rows">
        <li className="training-chart-tooltip-row">
          <span className="training-chart-tooltip-key">{t("run.perf.tip.run")}</span>
          <strong>
            {formatDecimal(session.value, 1)}
            {usual !== undefined ? ` · ${signed((session.value / usual - 1) * 100)}%` : ""}
          </strong>
        </li>
        {session.pace !== undefined ? (
          <li className="training-chart-tooltip-row">
            <span className="training-chart-tooltip-key">{t("activity.m.pace")}</span>
            <strong>{formatPace(session.pace)}</strong>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
