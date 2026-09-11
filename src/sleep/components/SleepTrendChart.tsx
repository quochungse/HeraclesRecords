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
import { TrendChartTooltip } from "../../training/components/trendChartParts";
import {
  formatHappenDayLabel,
  formatSleepDurationMinutes
} from "../../training/formatters";
import { useChartColors } from "../../training/useChartColors";
import { MCP_UNAVAILABLE_SHORT, mcpTextOr, type McpConnectionState } from "../../mcp/mcpNotice";
import type { TrainingHubSleepRecord } from "../../../electron/types";

interface SleepTrendChartProps {
  records: TrainingHubSleepRecord[];
  /** Highlighted so the night open on the right is findable in the run. */
  selectedDay?: string;
  /**
   * Set only where clicking through to a night means something. It is also
   * what puts the caption on screen — the Overview copy has nowhere to open.
   */
  onSelectDay?: (happenDay: string) => void;
  /**
   * Passed as-is to Recharts. `"100%"` lets a panel that already has a height
   * of its own decide, which is how Overview drops this into a chart shell.
   */
  height?: number | `${number}%`;
  /** `false` names the server the missing nights were meant to come from. */
  mcpConnected?: McpConnectionState;
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
  onSelectDay,
  height = 200,
  mcpConnected
}: SleepTrendChartProps) {
  const { colors } = useChartColors();

  // Naps carry the happenDay of the night they belong to, so a feed that has
  // not folded them in yet would draw two bars under one label. The Sleep
  // screen hands over main sleeps only; Overview's source is looser.
  const points: TrendPoint[] = records
    .filter((record) => record.kind !== "nap")
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
        {mcpTextOr(
          mcpConnected,
          `No nights to trend. ${MCP_UNAVAILABLE_SHORT}`,
          "A trend needs more than one night. Keep syncing and it fills in here."
        )}
      </p>
    );
  }

  return (
    <div className="sleep-trend-chart">
      <ResponsiveContainer width="100%" height={height}>
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
          {/* The shared tooltip body, so this chart's hover card matches the
              training panels'. `trainingChartTooltipStyle` strips Recharts'
              own frame — the card it wraps brings its own. */}
          <Tooltip
            content={(props) => (
              <TrendChartTooltip
                {...props}
                valueFormatter={(value, name) =>
                  name === "Asleep"
                    ? formatSleepDurationMinutes(value * 60)
                    : String(Math.round(value))
                }
              />
            )}
            contentStyle={trainingChartTooltipStyle}
            cursor={{ fill: colors.cursorBand }}
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
      {onSelectDay ? (
        <p className="sleep-trend-caption">
          Click a bar to open that night
          {selectedDay ? ` · showing ${formatHappenDayLabel(selectedDay)}` : ""}
        </p>
      ) : null}
    </div>
  );
}
