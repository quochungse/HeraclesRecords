import {
  Area,
  AreaChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ChartWhenNear } from "./ChartWhenNear";
import type { TooltipContentProps } from "recharts";
import {
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../../training/chartConfig";
import { useChartColors } from "../../training/useChartColors";
import { ChartAreaGradient } from "../../training/components/trendChartParts";
import type { UnitSystem } from "../../../electron/types";
import {
  distanceUnit,
  metersToDisplayDistance,
  metersToElevation
} from "../../units/units";
import { formatDecimal } from "../../i18n/core";

export interface ChartDatum {
  label: string;
  value: number;
}

interface ChatMiniAreaChartProps {
  data: ChartDatum[];
  gradientId: string;
  name: string;
  formatValue: (value: number) => string;
  yAxisFormatter?: (value: number) => string;
}

function MiniAreaTooltip({
  active,
  payload,
  label,
  formatValue
}: TooltipContentProps & { formatValue: (value: number) => string }) {
  if (!active || !payload?.length) {
    return null;
  }

  const value = payload[0]?.value;

  return (
    <div className="training-chart-tooltip">
      {label ? <span>{label}</span> : null}
      <strong>
        {typeof value === "number" ? formatValue(value) : "-"}
      </strong>
    </div>
  );
}

export function ChatMiniAreaChart({
  data,
  gradientId,
  name,
  formatValue,
  yAxisFormatter = (value) => `${value}`
}: ChatMiniAreaChartProps) {
  const { colors, activeDot } = useChartColors();

  if (data.length < 2) {
    return null;
  }
  // A card stored before its samples carried a clock has no axis to mark.
  const placed = data.some((datum) => datum.label);

  return (
    <div className="chat-visual-chart-shell">
      <ChartWhenNear>
        <AreaChart data={data} margin={trainingChartMargin}>
          <defs>
            <ChartAreaGradient id={gradientId} />
          </defs>
          <XAxis
            dataKey="label"
            tick={placed ? { fill: colors.text, fontSize: 11 } : false}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: colors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={["auto", "auto"]}
            tickFormatter={yAxisFormatter}
          />
          <Tooltip
            content={(props) => (
              <MiniAreaTooltip {...props} formatValue={formatValue} />
            )}
            cursor={{ stroke: colors.cursor }}
            contentStyle={trainingChartTooltipStyle}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={name}
            stroke={colors.accentBright}
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            dot={false}
            activeDot={activeDot}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartWhenNear>
    </div>
  );
}

export function buildElevationSeriesData(
  points: { elevation?: number; distance?: number }[],
  unitSystem: UnitSystem
): ChartDatum[] {
  const withElevation = points.filter(
    (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
  );

  if (withElevation.length < 2) {
    return [];
  }

  const useDistance = withElevation.some(
    (point) => point.distance !== undefined && point.distance > 0
  );

  return withElevation.map((point, index): ChartDatum => {
    const displayDistance =
      useDistance && point.distance !== undefined
        ? metersToDisplayDistance(point.distance, unitSystem)
        : index;

    return {
      label: useDistance
        ? `${formatDecimal(displayDistance, 1)} ${distanceUnit(unitSystem)}`
        : "",
      value: metersToElevation(point.elevation!, unitSystem)
    };
  });
}
