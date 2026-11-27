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
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import { VolumeChartHead } from "../running/VolumeChartHead";
import { useChartMotion } from "../motion/useChartMotion";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { MOVING_AVERAGE_WEEKS, oneYearEarlier } from "../running/sportVolume";
import {
  buildClimbWeeks,
  measuredClimb,
  sessionTotals,
  type ClimbVolumeMeasure,
  type ClimbWeek
} from "./climbMetrics";
import { CLIMB_KIND_LABELS, type ClimbKind } from "./climbType";
import { climbKindColors } from "./climbColors";
import { formatDecimal, plural, t } from "../i18n/core";

const measureOptions = (): { value: ClimbVolumeMeasure; label: string }[] => [
  { value: "climbs", label: t("climb.climbs") },
  { value: "time", label: t("climb.climbingTime") },
  { value: "sessions", label: t("climb.sessions") }
];

interface ClimbVolumeChartProps {
  /** Sessions inside the chosen period, already narrowed to the chosen kind. */
  sessions: readonly TrainingHubActivity[];
  /** The same kind, but the whole history — for the year-ago comparison. */
  sessionsAllTime: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  settled: boolean;
  weeks: number;
  /** Kinds present in the period, so the stack only holds real ones. */
  kinds: readonly ClimbKind[];
  nowMs: number;
}

interface VolumeRow extends Record<string, number | string> {
  label: string;
  /** The week itself, the same in every window: what a period change zooms by. */
  weekStartMs: number;
  total: number;
}

function formatMeasure(value: number, measure: ClimbVolumeMeasure): string {
  if (measure === "time") return `${formatDecimal(value, 1)} h`;
  if (measure === "sessions") return plural("climb.sessionCount", Math.round(value));
  return plural("climb.climbCount", Math.round(value));
}

/**
 * The trailing average ending at `end`, over buckets that start before the
 * chart does. Climbs and climbing time come off each session's summary: a
 * week not read yet would count as a zero, so it is left out of the average
 * rather than pulling it down.
 */
function trailing(buckets: readonly ClimbWeek[], end: number, measure: ClimbVolumeMeasure): number {
  const window = buckets
    .slice(Math.max(0, end - MOVING_AVERAGE_WEEKS + 1), end + 1)
    .filter((bucket) => measure === "sessions" || bucket.unread === 0);
  return window.reduce((sum, bucket) => sum + measuredClimb(bucket, measure), 0) / Math.max(1, window.length);
}

/**
 * The weeks, in climbs by default — a route or a problem, sent or not, is how
 * a climber counts a session — stacked by kind, with the four-week average.
 * Climbs and the time on the wall are read off each session's detail; until
 * those are read the head says so, and sessions are counted off the list.
 */
export function ClimbVolumeChart({
  sessions,
  sessionsAllTime,
  summaries,
  settled,
  weeks,
  kinds,
  nowMs
}: ClimbVolumeChartProps) {
  const { colors } = useChartColors();
  const palette = useMemo(() => climbKindColors(), []);
  const [measure, setMeasure] = useState<ClimbVolumeMeasure>("climbs");

  const weekBuckets = useMemo(
    () => buildClimbWeeks(sessions, summaries, { weeks, nowMs }),
    [sessions, summaries, nowMs, weeks]
  );
  const averageBuckets = useMemo(
    () => buildClimbWeeks(sessionsAllTime, summaries, { weeks: weeks + MOVING_AVERAGE_WEEKS - 1, nowMs }),
    [sessionsAllTime, summaries, nowMs, weeks]
  );

  const rows = useMemo<VolumeRow[]>(
    () =>
      weekBuckets.map((week, index) => {
        const row: VolumeRow = {
          label: week.label,
          weekStartMs: week.weekStartMs,
          total: measuredClimb(week, measure),
          average: trailing(averageBuckets, index + MOVING_AVERAGE_WEEKS - 1, measure)
        };
        for (const kind of kinds) {
          row[kind] = measuredClimb(week.byKind[kind], measure);
        }
        return row;
      }),
    [averageBuckets, kinds, measure, weekBuckets]
  );
  // A period zooms the weeks along the axis; a filter or a measure changes
  // the bars where they stand. Only when chosen here (src/motion/).
  const motion = useChartMotion(rows, "weekStartMs");

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.total, 0), [rows]);
  const unread = weekBuckets.some((week) => week.unread > 0);
  // The list carries sessions, not climbs: a year ago is compared in sessions only.
  const lastYear = useMemo(
    () => (measure === "sessions" ? oneYearEarlier(sessionsAllTime, { weeks, nowMs }, sessionTotals) : undefined),
    [measure, sessionsAllTime, nowMs, weeks]
  );
  const readingClimbs = measure !== "sessions" && unread && !settled;

  return (
    <section className="panel run-block">
      <VolumeChartHead
        totalText={readingClimbs ? t("climb.reading") : formatMeasure(total, measure)}
        total={total}
        weeks={weeks}
        lastYear={
          lastYear === undefined
            ? undefined
            : { text: formatMeasure(lastYear.sessions, measure), value: lastYear.sessions }
        }
        measure={measure}
        options={measureOptions()}
        onMeasureChange={setMeasure}
      />

      <div className="run-block-plot">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              // Clips the plot, so a period change zooms inside it.
              allowDataOverflow
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              allowDecimals={measure === "time"}
              width={40}
            />
            {kinds.map((kind) => (
              <Bar
                key={kind}
                dataKey={kind}
                stackId="volume"
                fill={palette[kind]}
                fillOpacity={0.8}
                radius={kind === kinds[kinds.length - 1] ? [3, 3, 0, 0] : undefined}
                {...motion.bar}
              />
            ))}
            <Line
              dataKey="average"
              type="monotone"
              stroke={colors.accentBright}
              strokeWidth={2}
              dot={false}
              {...motion.line}
            />
            <Tooltip
              cursor={{ fill: colors.cursorBand }}
              content={(props: TooltipContentProps) => (
                <VolumeTooltip {...props} kinds={kinds} palette={palette} measure={measure} />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="run-legend">
        {kinds.map((kind) => (
          <span key={kind}>
            <i className="is-bar" style={{ background: palette[kind] }} />
            {CLIMB_KIND_LABELS[kind]}
          </span>
        ))}
        <span>
          <i style={{ background: colors.accentBright }} />
          {t("run.volume.avg4w")}
        </span>
      </div>
      <p className="run-block-note">{t("climb.volume.note")}</p>
    </section>
  );
}

interface VolumeTooltipProps extends TooltipContentProps {
  kinds: readonly ClimbKind[];
  palette: Record<ClimbKind, string>;
  measure: ClimbVolumeMeasure;
}

function VolumeTooltip({ active, payload, label, kinds, palette, measure }: VolumeTooltipProps) {
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
      <strong>{formatMeasure(Number(row.total), measure)}</strong>
      {kinds
        .filter((kind) => Number(row[kind]) > 0)
        .map((kind) => (
          <span key={kind} style={{ color: palette[kind] }}>
            {CLIMB_KIND_LABELS[kind]} {formatMeasure(Number(row[kind]), measure)}
          </span>
        ))}
    </div>
  );
}
