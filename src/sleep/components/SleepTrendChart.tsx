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
import { trainingChartMargin, trainingChartTooltipStyle } from "../../training/chartConfig";
import {
  formatHappenDayLabel,
  formatSleepDurationMinutes
} from "../../training/formatters";
import { useChartColors } from "../../training/useChartColors";
import type { TrainingHubSleepRecord } from "../../../electron/types";

interface SleepTrendChartProps {
  records: TrainingHubSleepRecord[];
  /** Highlighted so the night open on the right is findable in the run. */
  selectedDay?: string;
  onSelectDay?: (happenDay: string) => void;
}

interface TrendPoint {
  happenDay: string;
  label: string;
  hours?: number;
  score?: number;
}

function finite(value?: number): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * The run of nights behind the one on screen. This is the part a watch's own
 * card cannot show — it holds one night at a time — and it is why a full screen
 * earns its place over the Overview panel.
 */
export function SleepTrendChart({
  records,
  selectedDay,
  onSelectDay
}: SleepTrendChartProps) {
  const { colors } = useChartColors();

  const points: TrendPoint[] = [...records]
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay))
    .map((record) => {
      const minutes = finite(record.totalMinutes);
      return {
        happenDay: record.happenDay,
        label: formatHappenDayLabel(record.happenDay),
        hours: minutes !== undefined ? Math.round((minutes / 60) * 100) / 100 : undefined,
        score: finite(record.score)
      };
    });

  if (points.length < 2) {
    return (
      <p className="sleep-trend-empty">
        A trend needs more than one night. Keep syncing and it fills in here.
      </p>
    );
  }

  return (
    <div className="sleep-trend-chart">
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart
          data={points}
          margin={trainingChartMargin}
          onClick={(state) => {
            // Recharts hands back the index of the bar under the cursor; the
            // point itself comes from the data we handed it.
            const index = Number(state?.activeIndex);
            const point = Number.isInteger(index) ? points[index] : undefined;
            if (point && onSelectDay) {
              onSelectDay(point.happenDay);
            }
          }}
        >
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 6" vertical={false} />
          <XAxis
            dataKey="label"
            stroke={colors.text}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            fontSize={11}
          />
          <YAxis
            yAxisId="hours"
            stroke={colors.text}
            tickLine={false}
            axisLine={false}
            width={34}
            fontSize={11}
            tickFormatter={(value: number) => `${value}h`}
          />
          <YAxis
            yAxisId="score"
            orientation="right"
            stroke={colors.text}
            tickLine={false}
            axisLine={false}
            width={30}
            domain={[0, 100]}
            fontSize={11}
          />
          <Tooltip
            contentStyle={trainingChartTooltipStyle}
            cursor={{ fill: colors.cursorBand }}
            formatter={(value, name) => {
              const numeric = typeof value === "number" ? value : Number(value);
              const label = String(name);
              if (!Number.isFinite(numeric)) {
                return ["–", label];
              }
              return label === "Asleep"
                ? [formatSleepDurationMinutes(numeric * 60), label]
                : [String(Math.round(numeric)), label];
            }}
          />
          <Bar
            yAxisId="hours"
            dataKey="hours"
            name="Asleep"
            radius={[4, 4, 0, 0]}
            fill={colors.accentSoft}
            stroke={colors.accent}
            isAnimationActive={false}
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="score"
            name="Score"
            stroke={colors.gold}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {selectedDay ? (
        <p className="sleep-trend-caption">
          Showing {points.length} nights · selected {formatHappenDayLabel(selectedDay)}
        </p>
      ) : null}
    </div>
  );
}
