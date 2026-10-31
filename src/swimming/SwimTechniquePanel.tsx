import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { ActivityDetailSummary, TrainingHubActivity, UnitSystem } from "../../electron/types";
import { OptionGroup } from "../components/OptionGroup";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { formatTrainingTableWhen } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatDistancePerStroke,
  formatPer100,
  formatPoolLength,
  lowerIsBetter,
  medianTechnique,
  metricNeedsOnePool,
  poolsSwum,
  rollingMedian,
  techniquePoints,
  type SwimTechniqueMetric
} from "./swimMetrics";
import { SWIM_STYLE_COLORS } from "./swimColors";
import { formatDecimal, getIntlLocale, plural, t } from "../i18n/core";

interface SwimTechniquePanelProps {
  /** Pool swims in the period: open water has no lengths to read. */
  swims: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
}

const metricOptions = (): { value: SwimTechniqueMetric; label: string }[] => [
  { value: "swolf", label: t("swim.m.swolf") },
  { value: "dps", label: t("swim.m.dps") },
  { value: "pace", label: t("activity.m.pace") },
  { value: "rate", label: t("swim.m.strokeRate") }
];

/** Swims the line takes its median over. */
const ROLLING_SWIMS = 5;

export function formatTechnique(
  metric: SwimTechniqueMetric,
  value: number | undefined,
  unitSystem: UnitSystem
): string {
  if (value === undefined) return "—";
  if (metric === "pace") return formatPer100(value, unitSystem);
  if (metric === "dps") return formatDistancePerStroke(value, unitSystem);
  if (metric === "rate") return t("swim.rateValue", { value: Math.round(value) });
  return formatDecimal(value, 0);
}

interface Row {
  at: number;
  value: number;
  median: number;
  name?: string;
}

/**
 * How the stroke is changing, swim by swim: SWOLF, the distance each stroke
 * carries, the pace and the stroke rate, all on freestyle, each swim a dot
 * and the line the median of the last five.
 *
 * Read on freestyle alone because every stroke has its own numbers — a
 * breaststroke length takes fewer strokes and more seconds — and a session
 * of mostly kick would move the line for no reason. SWOLF is read in one
 * length of pool: a 50 m length has one turn fewer to push off, so the same
 * swimmer scores a different number there. Distance per stroke, pace and
 * stroke rate travel between pools. Speed is distance per stroke times
 * stroke rate, so the last two say how a change in pace was bought: a longer
 * stroke, or a quicker one.
 */
export function SwimTechniquePanel({ swims, summaries }: SwimTechniquePanelProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const [metric, setMetric] = useState<SwimTechniqueMetric>("swolf");
  const pools = useMemo(() => poolsSwum(swims, summaries), [summaries, swims]);
  const [chosenPool, setChosenPool] = useState<number | null>(null);
  const pool =
    pools.find((entry) => chosenPool !== null && Math.abs(entry.poolLength - chosenPool) < 0.1) ?? pools[0];
  const onePool = metricNeedsOnePool(metric);

  const points = useMemo(
    () => techniquePoints(swims, summaries, metric, onePool ? pool?.poolLength : undefined),
    [metric, onePool, pool, summaries, swims]
  );
  const rows = useMemo<Row[]>(() => {
    const medians = rollingMedian(points, ROLLING_SWIMS);
    return points.map((point, index) => ({
      at: point.at,
      value: point.value,
      median: medians[index]!,
      ...(point.name ? { name: point.name } : {})
    }));
  }, [points]);

  const median = medianTechnique(points);
  const first = rows[0]?.median;
  const last = rows[rows.length - 1]?.median;
  const change = rows.length >= ROLLING_SWIMS && first !== undefined && last !== undefined ? last - first : undefined;
  const better =
    change === undefined || metric === "rate" ? undefined : lowerIsBetter(metric) ? change < 0 : change > 0;
  const reversed = lowerIsBetter(metric);
  const dot = SWIM_STYLE_COLORS.free;

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("swim.technique.title")}</p>
          <h3>
            {formatTechnique(metric, median, unitSystem)}
            <span className="run-block-sub">
              {" "}
              {onePool && pool
                ? t("swim.technique.inPool", {
                    pool: formatPoolLength(pool.poolLength, pool.poolUnit),
                    swims: plural("swim.count", points.length)
                  })
                : t("swim.technique.median", { swims: plural("swim.count", points.length) })}
            </span>
          </h3>
        </div>
        {change !== undefined ? (
          <p className="run-block-aside">
            {t("swim.technique.change")}{" "}
            <strong className={better === undefined ? undefined : better ? "tone-up" : "tone-down"}>
              {change > 0 ? "+" : change < 0 ? "−" : ""}
              {metric === "pace"
                ? `${formatDecimal(Math.abs(change), 1)} s`
                : metric === "dps"
                  ? formatDistancePerStroke(Math.abs(change), unitSystem)
                  : formatDecimal(Math.abs(change), metric === "swolf" ? 1 : 0)}
            </strong>
          </p>
        ) : null}
      </header>

      <OptionGroup
        label={t("swim.technique.metric")}
        value={metric}
        options={metricOptions()}
        onChange={(next) => setMetric(next as SwimTechniqueMetric)}
      />
      {onePool && pools.length > 1 ? (
        <OptionGroup
          label={t("swim.technique.pool")}
          value={String(pool?.poolLength ?? "")}
          options={pools.map((entry) => ({
            value: String(entry.poolLength),
            label: formatPoolLength(entry.poolLength, entry.poolUnit)
          }))}
          onChange={(next) => setChosenPool(Number(next))}
        />
      ) : null}

      {rows.length >= 2 ? (
        <div className="run-block-plot">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="at"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tick={{ fill: colors.text, fontSize: 11 }}
                stroke={colors.grid}
                minTickGap={32}
                tickFormatter={(value: number) =>
                  new Date(value).toLocaleDateString(getIntlLocale(), { month: "short", day: "numeric" })
                }
              />
              <YAxis
                tick={{ fill: colors.text, fontSize: 11 }}
                stroke={colors.grid}
                reversed={reversed}
                width={56}
                domain={["auto", "auto"]}
                tickFormatter={(value: number) =>
                  metric === "pace"
                    ? formatPer100(value, unitSystem).split(" ")[0]!
                    : metric === "dps"
                      ? formatDecimal(value, 2)
                      : formatDecimal(value, 0)
                }
              />
              <Line
                dataKey="value"
                stroke="none"
                dot={{ r: 3, fill: dot, stroke: dot, fillOpacity: 0.55 }}
                activeDot={{ r: 5, fill: dot, stroke: colors.dotStroke }}
                isAnimationActive={false}
              />
              <Line
                dataKey="median"
                type="monotone"
                stroke={colors.accentBright}
                strokeWidth={2}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Tooltip
                cursor={{ stroke: colors.cursor }}
                content={(props: TooltipContentProps) => (
                  <TechniqueTooltip {...props} metric={metric} unitSystem={unitSystem} />
                )}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="run-block-empty">{t("swim.technique.empty")}</p>
      )}

      <div className="run-legend">
        <span>
          <i style={{ background: dot }} />
          {t("swim.technique.legendSwim")}
        </span>
        <span>
          <i style={{ background: colors.accentBright }} />
          {t("swim.technique.legendMedian", { count: ROLLING_SWIMS })}
        </span>
      </div>
      <p className="run-block-note">{t(`swim.technique.note.${metric}` as const)}</p>
    </section>
  );
}

interface TechniqueTooltipProps extends TooltipContentProps {
  metric: SwimTechniqueMetric;
  unitSystem: UnitSystem;
}

function TechniqueTooltip({ active, payload, metric, unitSystem }: TechniqueTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload as Row | undefined;
  if (!row) {
    return null;
  }
  return (
    <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
      <span>{formatTrainingTableWhen(row.at / 1000)}</span>
      {row.name ? <span>{row.name}</span> : null}
      <strong>{formatTechnique(metric, row.value, unitSystem)}</strong>
      <span>
        {t("swim.technique.legendMedian", { count: ROLLING_SWIMS })} {formatTechnique(metric, row.median, unitSystem)}
      </span>
    </div>
  );
}
