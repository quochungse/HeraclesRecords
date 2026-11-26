import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import { isSend } from "../../electron/climbDetail";
import { rungIndexFor, type ClimbFamily } from "../../electron/climbGrades";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useChartMotion } from "../motion/useChartMotion";
import { readStoredSportColors } from "../training/sportColors";
import { startOfRunWeekMs } from "../running/runMetrics";
import { buildClimbWeeks, climbRecords, scaleRungs, type ClimbScales } from "./climbMetrics";
import { CLIMB_FAMILY_LABELS, gradeLabel } from "./climbType";
import { t } from "../i18n/core";

interface GradeTrendPanelProps {
  sessions: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  family: ClimbFamily;
  scales: ClimbScales;
  weeks: number;
  nowMs: number;
  settled: boolean;
}

interface TrendRow {
  label: string;
  weekStartMs: number;
  /** Rungs of the scale shown, 0 the easiest. */
  hardest?: number;
  average?: number;
}

/** Weeks the "lately" figure averages over. */
const RECENT_WEEKS = 4;

/**
 * The grades, week by week: the hardest send of each week and the average
 * grade of what was sent, on the rungs of the scale shown, with the onsight
 * grade from COROS's settings as the line to climb past. One family at a
 * time — the pyramid's — because a route's grade and a boulder's are not
 * on one axis.
 */
export function GradeTrendPanel({ sessions, summaries, family, scales, weeks, nowMs, settled }: GradeTrendPanelProps) {
  const { colors } = useChartColors();
  const climbColor = useMemo(() => readStoredSportColors().climb, []);
  const rungs = useMemo(() => scaleRungs(family, scales), [family, scales]);

  const rows = useMemo<TrendRow[]>(() => {
    const buckets = buildClimbWeeks(sessions, summaries, { weeks, nowMs });
    const sends = new Map<number, number[]>();
    for (const record of climbRecords(sessions, summaries)) {
      if (record.family !== family || record.ladder === undefined || !isSend(record.style)) continue;
      const at = (record.activity.startTime ?? 0) * 1000;
      const week = startOfRunWeekMs(at);
      const list = sends.get(week) ?? [];
      list.push(rungIndexFor(rungs, record.ladder));
      sends.set(week, list);
    }
    return buckets.map((bucket) => {
      const list = sends.get(bucket.weekStartMs) ?? [];
      return {
        label: bucket.label,
        weekStartMs: bucket.weekStartMs,
        ...(list.length > 0
          ? { hardest: Math.max(...list), average: list.reduce((sum, value) => sum + value, 0) / list.length }
          : {})
      };
    });
  }, [family, nowMs, rungs, sessions, summaries, weeks]);
  const motion = useChartMotion(rows, "weekStartMs");

  const onsight = scales.onsight[family];
  const onsightRung = onsight === undefined ? undefined : rungIndexFor(rungs, onsight);
  const values = rows.flatMap((row) => [row.hardest, row.average]).filter((value): value is number => value !== undefined);
  const low = Math.max(0, Math.floor(Math.min(...values, onsightRung ?? Infinity)) - 1);
  const high = Math.min(rungs.length - 1, Math.ceil(Math.max(...values, onsightRung ?? -Infinity)) + 1);
  const ticks = values.length > 0 ? spacedTicks(low, high) : [];
  const nameAt = (index: number) => gradeLabel(rungs[Math.round(index)]?.name ?? "");

  const recent = rows.slice(-RECENT_WEEKS).map((row) => row.average).filter((value): value is number => value !== undefined);
  const lately = recent.length > 0 ? recent.reduce((sum, value) => sum + value, 0) / recent.length : undefined;

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("climb.trend.title", { family: CLIMB_FAMILY_LABELS[family] })}</p>
          <h3>
            {lately !== undefined ? nameAt(lately) : ""}
            <span className="run-block-sub">
              {" "}
              {lately !== undefined ? t("climb.trend.lately") : settled ? t("climb.trend.none") : t("climb.reading")}
            </span>
          </h3>
        </div>
      </header>

      {values.length > 0 ? (
        <div className="run-block-plot">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                allowDataOverflow
                tick={{ fill: colors.text, fontSize: 11 }}
                stroke={colors.grid}
                minTickGap={24}
              />
              <YAxis
                domain={[low, high]}
                ticks={ticks}
                allowDecimals={false}
                tick={{ fill: colors.text, fontSize: 11 }}
                stroke={colors.grid}
                width={44}
                tickFormatter={(value: number) => nameAt(value)}
              />
              {onsightRung !== undefined ? (
                <ReferenceLine
                  y={onsightRung}
                  stroke={colors.text}
                  strokeOpacity={0.6}
                  strokeDasharray="4 4"
                  label={{ value: t("climb.pyramid.onsight"), position: "insideTopRight", fill: colors.text, fontSize: 11 }}
                />
              ) : null}
              <Line
                dataKey="average"
                type="monotone"
                stroke={climbColor}
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
                {...motion.line}
              />
              <Line
                dataKey="hardest"
                type="linear"
                stroke={colors.gold}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={{ r: 3.5, fill: colors.gold, strokeWidth: 0 }}
                connectNulls={false}
                {...motion.line}
              />
              <Tooltip
                cursor={{ stroke: colors.grid }}
                content={(props: TooltipContentProps) => <TrendTooltip {...props} nameAt={nameAt} />}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {values.length > 0 ? (
        <div className="run-legend">
          <span>
            <i style={{ background: climbColor }} />
            {t("climb.trend.average")}
          </span>
          <span>
            <i className="is-dashed" style={{ background: colors.gold }} />
            {t("climb.trend.hardest")}
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** Every rung when they fit, else every other: a tick a grade, never half of one. */
function spacedTicks(low: number, high: number): number[] {
  const step = high - low > 8 ? 2 : 1;
  const ticks: number[] = [];
  for (let value = low; value <= high; value += step) ticks.push(value);
  return ticks;
}

interface TrendTooltipProps extends TooltipContentProps {
  nameAt: (index: number) => string;
}

function TrendTooltip({ active, payload, label, nameAt }: TrendTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as TrendRow | undefined;
  if (!row || row.hardest === undefined) return null;
  return (
    <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
      <span>{t("activity.week.of", { date: String(label ?? "") })}</span>
      <strong>{t("climb.trend.hardestValue", { grade: nameAt(row.hardest) })}</strong>
      {row.average !== undefined ? <span>{t("climb.trend.averageValue", { grade: nameAt(row.average) })}</span> : null}
    </div>
  );
}
