import { useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { ChartWhenNear } from "./ChartWhenNear";
import type { ChannelRow, CardChannel } from "./channelRows";
import { OptionChips } from "../../components/OptionGroup";
import { useTheme } from "../../theme/ThemeProvider";
import { useChartColors } from "../../training/useChartColors";
import { trainingChartMargin, trainingChartTooltipStyle } from "../../training/chartConfig";
import { formatPaceSecondsPerKm } from "../../training/formatters";
import {
  activityChannel,
  activityChannelColors,
  defaultSelectedChannels,
  toggleActivityChannel,
  type ActivityChannelKey,
  type ActivityMotion
} from "../../training/activityChannels";
import { elevationUnit, speedUnit, swimDistanceUnit } from "../../units/units";
import { formatDecimal, t } from "../../i18n/core";
import { formatSwimPaceClock, type ActivityReading } from "../../../electron/activityReading";
import type { UnitSystem } from "../../../electron/types";

/** How the app's Performance chart would read this sport, for its opening pair. */
const MOTION_OF: Record<ActivityReading, ActivityMotion> = {
  pace: "pace",
  speed: "speed",
  hike: "hike",
  swim: "pace",
  sets: "pace",
  effort: "pace"
};

/** In the order the Performance chart offers them. */
const CHANNEL_ORDER: readonly CardChannel[] = ["pace", "speed", "hr", "cadence", "power", "altitude"];

function countOf(rows: readonly ChannelRow[], key: CardChannel): number {
  return rows.reduce((count, row) => count + (row[key] === undefined ? 0 : 1), 0);
}

interface ChatChannelChartProps {
  previewId: string;
  reading: ActivityReading;
  /** COROS's sport code, which decides whether power is a run's Running power. */
  sportType?: number;
  rows: ChannelRow[];
  unitSystem: UnitSystem;
  cadenceUnit: string;
}

/**
 * A session's recorded channels on one chart, a chip each, the way the
 * Performance chart on the session's own page reads them: two at a time, one
 * axis each, opening on the pair that says whether the session went the way it
 * was meant to (pace and heart rate on a run, power or speed and heart rate on
 * a ride), with elevation as the ground behind them. A card used to stack a
 * chart per channel, five of them for an ordinary run.
 */
export function ChatChannelChart({
  previewId,
  reading,
  sportType,
  rows,
  unitSystem,
  cadenceUnit
}: ChatChannelChartProps) {
  const { theme } = useTheme();
  const { colors } = useChartColors();
  const palette = useMemo(() => activityChannelColors(theme), [theme]);
  const swim = reading === "swim";
  const motion = MOTION_OF[reading];

  const offered = useMemo(
    () => CHANNEL_ORDER.filter((key) => countOf(rows, key) >= 2).map((key) => activityChannel(key, motion, sportType)),
    [rows, motion, sportType]
  );
  const [selected, setSelected] = useState<ActivityChannelKey[]>(() =>
    defaultSelectedChannels(offered, motion)
  );
  // Elevation is where a hike was decided; anywhere else it waits to be asked for.
  const [showAltitude, setShowAltitude] = useState(reading === "hike");

  const channels = offered.filter((channel) => !channel.background && selected.includes(channel.key));
  const altitudeOffered = offered.some((channel) => channel.background);
  const altitudeShown = altitudeOffered && showAltitude;
  const altitudeFillId = `chatAltitudeFill-${previewId}`;
  const placed = rows.some((row) => row.label);

  const formatValue = (key: ActivityChannelKey, value: number): string => {
    switch (key) {
      case "pace":
        return swim
          ? `${formatSwimPaceClock(value)} /100${swimDistanceUnit(unitSystem)}`
          : formatPaceSecondsPerKm(value, unitSystem);
      case "speed":
        return `${formatDecimal(value, 1)} ${speedUnit(unitSystem)}`;
      case "hr":
        return `${Math.round(value)} bpm`;
      case "power":
        return `${Math.round(value)} W`;
      case "cadence":
        return `${Math.round(value)} ${cadenceUnit}`;
      default:
        return `${Math.round(value)} ${elevationUnit(unitSystem)}`;
    }
  };
  const formatTick = (key: ActivityChannelKey, value: number): string =>
    key === "pace"
      ? swim
        ? formatSwimPaceClock(value)
        : formatPaceSecondsPerKm(value, unitSystem).replace(/\/(?:km|mi)$/, "")
      : key === "speed"
        ? formatDecimal(value, 1)
        : `${Math.round(value)}`;

  const renderTooltip = ({ active, payload, label }: TooltipContentProps) => {
    const row = payload?.[0]?.payload as ChannelRow | undefined;
    if (!active || !row) return null;
    const readings = channels.flatMap((channel) => {
      const value = row[channel.key as CardChannel];
      return typeof value === "number"
        ? [{ key: channel.key, value, color: palette[channel.key].stroke }]
        : [];
    });
    return (
      <div className="training-chart-tooltip">
        {label ? <span className="training-chart-tooltip-label">{label}</span> : null}
        <ul className="training-chart-tooltip-rows">
          {readings.map((entry) => (
            <li key={entry.key} className="training-chart-tooltip-row">
              <span className="training-chart-tooltip-key">
                <i aria-hidden="true" style={{ background: entry.color }} />
                {activityChannel(entry.key, motion, sportType).label}
              </span>
              <strong>{formatValue(entry.key, entry.value)}</strong>
            </li>
          ))}
          {altitudeShown && typeof row.altitude === "number" ? (
            <li className="training-chart-tooltip-row">
              <span className="training-chart-tooltip-key">
                <i aria-hidden="true" style={{ background: "var(--text-muted)" }} />
                {activityChannel("altitude").label}
              </span>
              <strong>{formatValue("altitude", row.altitude)}</strong>
            </li>
          ) : null}
        </ul>
      </div>
    );
  };

  return (
    <section className="chat-visual-section">
      <div className="chat-visual-section-head">
        <h5>{t("activity.chart.channels")}</h5>
      </div>
      {offered.length > 1 ? (
        <OptionChips
          label={t("activity.chart.series")}
          className="chat-visual-chips"
          options={offered.map((channel) => ({ value: channel.key, label: channel.label }))}
          values={offered
            .filter((channel) => (channel.background ? showAltitude : selected.includes(channel.key)))
            .map((channel) => channel.key)}
          colorOf={(key) => palette[key as ActivityChannelKey]?.stroke}
          onToggle={(key) => {
            if (activityChannel(key as ActivityChannelKey).background) {
              setShowAltitude((previous) => !previous);
              return;
            }
            setSelected((previous) => toggleActivityChannel(previous, key as ActivityChannelKey));
          }}
        />
      ) : null}
      <div className="chat-visual-chart-shell chat-visual-chart-shell--channels">
        <ChartWhenNear>
          <ComposedChart data={rows} margin={trainingChartMargin}>
            <defs>
              <linearGradient id={altitudeFillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.altitude.stroke} stopOpacity={0.5} />
                <stop offset="100%" stopColor={palette.altitude.stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={placed ? { fill: colors.text, fontSize: 11 } : false}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            {altitudeShown ? (
              <YAxis yAxisId="altitude" hide width={0} domain={["dataMin", "dataMax"]} />
            ) : null}
            {channels.map((channel, index) => (
              <YAxis
                key={channel.key}
                yAxisId={channel.key}
                orientation={index === 0 ? "left" : "right"}
                domain={["auto", "auto"]}
                reversed={channel.reversed ?? false}
                tick={{ fill: colors.text, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickCount={4}
                tickFormatter={(value: number) => formatTick(channel.key, value)}
              />
            ))}
            {/* Two gutters whether or not there is a channel for each, so the
                plot does not widen and jump as a chip is let go. */}
            {channels.length === 0 ? (
              <YAxis yAxisId="spare-left" orientation="left" tick={false} axisLine={false} tickLine={false} width={40} />
            ) : null}
            {channels.length < 2 ? (
              <YAxis yAxisId="spare-right" orientation="right" tick={false} axisLine={false} tickLine={false} width={40} />
            ) : null}
            {altitudeShown ? (
              <Area
                yAxisId="altitude"
                dataKey="altitude"
                type="monotone"
                stroke={palette.altitude.stroke}
                strokeWidth={1}
                fill={`url(#${altitudeFillId})`}
                isAnimationActive={false}
                connectNulls
                activeDot={false}
              />
            ) : null}
            {channels.map((channel) => (
              <Line
                key={channel.key}
                yAxisId={channel.key}
                dataKey={channel.key}
                type="linear"
                stroke={palette[channel.key].stroke}
                strokeWidth={1.4}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={false}
                isAnimationActive={false}
                connectNulls
                activeDot={{ r: 4, fill: palette[channel.key].stroke, stroke: colors.dotStroke, strokeWidth: 2 }}
              />
            ))}
            <Tooltip
              content={renderTooltip}
              cursor={{ stroke: colors.cursor }}
              contentStyle={trainingChartTooltipStyle}
            />
          </ComposedChart>
        </ChartWhenNear>
      </div>
    </section>
  );
}
