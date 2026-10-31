import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { TrainingHubActivity, UnitSystem } from "../../electron/types";
import { swimDistanceUnit } from "../../electron/unitSystem";
import { OptionGroup } from "../components/OptionGroup";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { MOVING_AVERAGE_WEEKS, oneYearEarlier } from "../running/sportVolume";
import {
  buildSwimWeeks,
  measuredSwim,
  summariseSwims,
  type SwimVolumeMeasure,
  type SwimWeek
} from "./swimMetrics";
import { SWIM_TYPE_LABELS, type SwimType } from "./swimType";
import { swimTypeColors } from "./swimColors";
import { getIntlLocale, plural, t } from "../i18n/core";

const measureOptions = (): { value: SwimVolumeMeasure; label: string }[] => [
  { value: "distance", label: t("activity.m.distance") },
  { value: "time", label: t("activity.m.time") },
  { value: "count", label: t("swim.swims") }
];

interface SwimVolumeChartProps {
  /** Swims inside the chosen period, already narrowed to the chosen kind. */
  swims: readonly TrainingHubActivity[];
  /** The same kind, but the whole history — for the year-ago comparison. */
  swimsAllTime: readonly TrainingHubActivity[];
  weeks: number;
  /** Kinds present in the period, so the stack only holds real ones. */
  types: readonly SwimType[];
  nowMs: number;
}

interface VolumeRow extends Record<string, number | string> {
  label: string;
  total: number;
  longest: number;
}

function measureUnit(measure: SwimVolumeMeasure, unitSystem: UnitSystem): string {
  if (measure === "time") return "h";
  if (measure === "count") return "";
  return swimDistanceUnit(unitSystem);
}

/** A week runs to thousands of metres, so the figures group them: "8,400 m". */
function grouped(value: number, digits: number): string {
  return new Intl.NumberFormat(getIntlLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatMeasure(value: number, measure: SwimVolumeMeasure, unitSystem: UnitSystem): string {
  if (measure === "count") return plural("swim.count", Math.round(value));
  const digits = measure === "time" ? 1 : 0;
  return `${grouped(value, digits)} ${measureUnit(measure, unitSystem)}`;
}

/** The trailing average ending at `end`, over buckets that start before the chart does. */
function trailing(
  buckets: readonly SwimWeek[],
  end: number,
  measure: SwimVolumeMeasure,
  unitSystem: UnitSystem
): number {
  const window = buckets.slice(Math.max(0, end - MOVING_AVERAGE_WEEKS + 1), end + 1);
  return (
    window.reduce((sum, bucket) => sum + measuredSwim(bucket, measure, unitSystem), 0) /
    Math.max(1, window.length)
  );
}

/**
 * The weeks, in metres by default — how a swimmer counts a week — stacked by
 * pool and open water, with the four-week average and the week's longest swim.
 */
export function SwimVolumeChart({ swims, swimsAllTime, weeks, types, nowMs }: SwimVolumeChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const palette = useMemo(() => swimTypeColors(), []);
  const [measure, setMeasure] = useState<SwimVolumeMeasure>("distance");

  const weekBuckets = useMemo(() => buildSwimWeeks(swims, { weeks, nowMs }), [swims, nowMs, weeks]);
  const averageBuckets = useMemo(
    () => buildSwimWeeks(swimsAllTime, { weeks: weeks + MOVING_AVERAGE_WEEKS - 1, nowMs }),
    [swimsAllTime, nowMs, weeks]
  );

  const rows = useMemo<VolumeRow[]>(
    () =>
      weekBuckets.map((week, index) => {
        const row: VolumeRow = {
          label: week.label,
          total: measuredSwim(week, measure, unitSystem),
          longest:
            measure === "count"
              ? 0
              : measuredSwim(
                  { distance: week.longestSwimMeters, duration: week.longestSwimSeconds, count: 0 },
                  measure,
                  unitSystem
                ),
          average: trailing(averageBuckets, index + MOVING_AVERAGE_WEEKS - 1, measure, unitSystem)
        };
        for (const type of types) {
          row[type] = measuredSwim(week.byType[type], measure, unitSystem);
        }
        return row;
      }),
    [averageBuckets, measure, types, unitSystem, weekBuckets]
  );

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.total, 0), [rows]);
  const lastYear = useMemo(
    () => oneYearEarlier(swimsAllTime, { weeks, nowMs }, summariseSwims),
    [swimsAllTime, nowMs, weeks]
  );

  const showLongest = measure !== "count";

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("run.volume.title")}</p>
          <h3>
            {formatMeasure(total, measure, unitSystem)}
            <span className="run-block-sub"> {plural("run.volume.over", weeks)}</span>
          </h3>
        </div>
        <div className="sport-volume-aside">
          {lastYear !== undefined ? (
            <p className="run-block-aside">
              {t("run.volume.yearAgo")}{" "}
              <strong>
                {formatMeasure(
                  measuredSwim(
                    { distance: lastYear.distance, duration: lastYear.duration, count: lastYear.count },
                    measure,
                    unitSystem
                  ),
                  measure,
                  unitSystem
                )}
              </strong>
            </p>
          ) : null}
          <OptionGroup
            label={t("run.volume.measure")}
            value={measure}
            options={measureOptions()}
            onChange={(next) => setMeasure(next as SwimVolumeMeasure)}
          />
        </div>
      </header>

      <div className="run-block-plot">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              allowDecimals={false}
              width={48}
              tickFormatter={(value: number) => grouped(value, 0)}
            />
            {types.map((type) => (
              <Bar
                key={type}
                dataKey={type}
                stackId="volume"
                fill={palette[type]}
                fillOpacity={0.75}
                radius={type === types[types.length - 1] ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
            <Line
              dataKey="average"
              type="monotone"
              stroke={colors.accentBright}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {showLongest ? (
              <Line
                dataKey="longest"
                type="monotone"
                stroke={colors.gold}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Tooltip
              cursor={{ fill: colors.cursorBand }}
              content={(props: TooltipContentProps) => (
                <VolumeTooltip
                  {...props}
                  types={types}
                  palette={palette}
                  measure={measure}
                  unitSystem={unitSystem}
                />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="run-legend">
        {types.map((type) => (
          <span key={type}>
            <i className="is-bar" style={{ background: palette[type] }} />
            {SWIM_TYPE_LABELS[type]}
          </span>
        ))}
        <span>
          <i style={{ background: colors.accentBright }} />
          {t("run.volume.avg4w")}
        </span>
        {showLongest ? (
          <span>
            <i className="is-dashed" style={{ background: colors.gold }} />
            {t("swim.volume.longest")}
          </span>
        ) : null}
      </div>
    </section>
  );
}

interface VolumeTooltipProps extends TooltipContentProps {
  types: readonly SwimType[];
  palette: Record<SwimType, string>;
  measure: SwimVolumeMeasure;
  unitSystem: UnitSystem;
}

function VolumeTooltip({ active, payload, label, types, palette, measure, unitSystem }: VolumeTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload as VolumeRow | undefined;
  if (!row) {
    return null;
  }
  return (
    <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
      <span>{t("activity.week.of", { date: String(label ?? "") })}</span>
      <strong>{formatMeasure(Number(row.total), measure, unitSystem)}</strong>
      {types
        .filter((type) => Number(row[type]) > 0)
        .map((type) => (
          <span key={type} style={{ color: palette[type] }}>
            {SWIM_TYPE_LABELS[type]} {formatMeasure(Number(row[type]), measure, unitSystem)}
          </span>
        ))}
      {measure !== "count" && Number(row.longest) > 0 ? (
        <span>
          {t("swim.volume.longest")} {formatMeasure(Number(row.longest), measure, unitSystem)}
        </span>
      ) : null}
    </div>
  );
}
