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
import { OptionGroup } from "../components/OptionGroup";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  MOVING_AVERAGE_WEEKS,
  formatMeasure,
  measureUnit,
  measured,
  oneYearEarlier,
  trailingAverage,
  type Volume,
  type VolumeMeasure
} from "../running/sportVolume";
import { buildHikeWeeks, summariseHikes, type HikeWeek } from "./hikeMetrics";
import { HIKE_TYPE_LABELS, type HikeType } from "./hikeType";
import { hikeTypeColors } from "./hikeTypeColors";
import { formatDecimal, plural, t } from "../i18n/core";

/**
 * What a week of hiking is measured in.
 *
 * It opens on ascent, where a ride's chart opens on time: ten kilometres by a
 * lake and ten kilometres up Fansipan are not the same week, and the height
 * gained is what tells them apart. Time on the trail and distance are a switch
 * away, and the bars, the average and the heading all follow the one chosen.
 */
const measureOptions = (): { value: VolumeMeasure; label: string }[] => [
  { value: "climb", label: t("hike.ascent") },
  { value: "time", label: t("activity.m.time") },
  { value: "distance", label: t("activity.m.distance") }
];

interface HikeVolumeChartProps {
  /** Hikes inside the chosen period, already narrowed to the chosen kind. */
  hikes: readonly TrainingHubActivity[];
  /** The same kind, but the whole history — for the year-ago comparison. */
  hikesAllTime: readonly TrainingHubActivity[];
  weeks: number;
  /** Kinds present in the period, so the stack only holds real ones. */
  types: readonly HikeType[];
  nowMs: number;
}

interface VolumeRow extends Record<string, number | string> {
  label: string;
  total: number;
  biggest: number;
}

/** The week's single biggest hike, by each measure — not one hike's three figures. */
function weekBiggest(week: HikeWeek): Volume {
  return {
    distance: week.longestHikeMeters,
    duration: week.longestHikeSeconds,
    elevationGain: week.biggestAscentMeters
  };
}

export function HikeVolumeChart({ hikes, hikesAllTime, weeks, types, nowMs }: HikeVolumeChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const palette = useMemo(() => hikeTypeColors(), []);
  const [measure, setMeasure] = useState<VolumeMeasure>("climb");

  const weekBuckets = useMemo(() => buildHikeWeeks(hikes, { weeks, nowMs }), [hikes, nowMs, weeks]);
  const averageBuckets = useMemo(
    () => buildHikeWeeks(hikesAllTime, { weeks: weeks + MOVING_AVERAGE_WEEKS - 1, nowMs }),
    [hikesAllTime, nowMs, weeks]
  );

  const rows = useMemo<VolumeRow[]>(
    () =>
      weekBuckets.map((week, index) => {
        const average = trailingAverage(
          averageBuckets,
          index + MOVING_AVERAGE_WEEKS - 1,
          measure,
          unitSystem
        );
        const row: VolumeRow = {
          label: week.label,
          total: measured(week, measure, unitSystem),
          biggest: measured(weekBiggest(week), measure, unitSystem),
          average
        };
        for (const type of types) {
          row[type] = measured(week.byType[type], measure, unitSystem);
        }
        return row;
      }),
    [averageBuckets, measure, types, unitSystem, weekBuckets]
  );

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.total, 0), [rows]);
  const lastYear = useMemo(() => oneYearEarlier(hikesAllTime, { weeks, nowMs }, summariseHikes), [hikesAllTime, nowMs, weeks]);

  const unit = measureUnit(measure, unitSystem);
  const biggestLabel =
    measure === "climb"
      ? t("hike.volume.biggestAscent")
      : measure === "time"
        ? t("hike.volume.longestDay")
        : t("hike.volume.longestHike");

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("run.volume.title")}</p>
          <h3>
            {formatDecimal(total, 0)} {unit}
            <span className="run-block-sub"> {plural("run.volume.over", weeks)}</span>
          </h3>
        </div>
        <div className="sport-volume-aside">
          {lastYear !== undefined ? (
            <p className="run-block-aside">
              {t("run.volume.yearAgo")}{" "}
              <strong>{formatDecimal(measured(lastYear, measure, unitSystem), 0)} {unit}</strong>
            </p>
          ) : null}
          <OptionGroup
            label={t("run.volume.measure")}
            value={measure}
            options={measureOptions()}
            onChange={(next) => setMeasure(next as VolumeMeasure)}
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
              tickFormatter={(value: number) => formatDecimal(value, 0)}
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
            {/* The week's single biggest day: the long day a hike is trained
                for, which a weekly total hides behind two short ones. */}
            <Line
              dataKey="biggest"
              type="monotone"
              stroke={colors.gold}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              cursor={{ fill: colors.cursorBand }}
              content={(props: TooltipContentProps) => (
                <VolumeTooltip
                  {...props}
                  types={types}
                  palette={palette}
                  measure={measure}
                  unitSystem={unitSystem}
                  biggestLabel={biggestLabel}
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
            {HIKE_TYPE_LABELS[type]}
          </span>
        ))}
        <span>
          <i style={{ background: colors.accentBright }} />
          {t("run.volume.avg4w")}
        </span>
        <span>
          <i className="is-dashed" style={{ background: colors.gold }} />
          {biggestLabel}
        </span>
      </div>
    </section>
  );
}

interface VolumeTooltipProps extends TooltipContentProps {
  types: readonly HikeType[];
  palette: Record<HikeType, string>;
  measure: VolumeMeasure;
  unitSystem: UnitSystem;
  biggestLabel: string;
}

function VolumeTooltip({
  active,
  payload,
  label,
  types,
  palette,
  measure,
  unitSystem,
  biggestLabel
}: VolumeTooltipProps) {
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
            {HIKE_TYPE_LABELS[type]} {formatMeasure(Number(row[type]), measure, unitSystem)}
          </span>
        ))}
      <span>
        {biggestLabel} {formatMeasure(Number(row.biggest), measure, unitSystem)}
      </span>
    </div>
  );
}
