import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type {
  TrainingHubActivityLap,
  TrainingHubActivitySeriesPoint,
  TrainingHubActivityZoneBucket,
  UnitSystem
} from "../../../electron/types";
import { downsampleActivitySeries } from "../../../electron/activitySeries";
import { OptionChips, OptionGroup } from "../../components/OptionGroup";
import { useTheme } from "../../theme/ThemeProvider";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  secondsPerKmToDisplayPace,
  speedUnit
} from "../../units/units";
import { formatDurationSeconds } from "../formatters";
import { useChartColors } from "../useChartColors";
import "../activityChart.css";
import {
  availableActivityChannels,
  defaultSelectedChannels,
  activityChannel,
  activityChannelColors,
  toggleActivityChannel,
  withSpeed,
  withVerticalSpeed,
  type ActivityChannelKey,
  type ActivityChannelPoint,
  type ActivityMotion
} from "../activityChannels";

/**
 * How many points reach recharts.
 *
 * A real run is one sample a second — 5 149 of them on an 86-minute easy run —
 * and handing that to an SVG chart costs a second of layout per redraw for
 * detail no screen can show. Four hundred is roughly one point per two pixels
 * at full width, so the line is already smoother than the display.
 */
const CHART_POINTS = 400;

export type ActivitySeriesAxis = "elapsed" | "distance";

interface ActivitySeriesChartProps {
  series: readonly TrainingHubActivitySeriesPoint[];
  laps: readonly TrainingHubActivityLap[];
  /** This run's own HR zone buckets, shaded behind the heart-rate line. */
  hrZones: readonly TrainingHubActivityZoneBucket[];
  /** Set from the lap table; focuses the chart on one lap. */
  focusLapIndex: number | null;
  onFocusLapHandled: () => void;
  /**
   * COROS's own activity time (`workoutTime`), stated for the whole run so the
   * unselected segment reads it directly rather than from the sample clock.
   */
  activityTime?: number;
  /**
   * Mounted inside a surface that is already a panel — the Activities detail
   * pane. The chart then draws as one block of that pane, not as a panel of its
   * own: `.panel` is translucent white under a backdrop blur, and two of them
   * stacked washed every line in the plot out to grey.
   */
  embedded?: boolean;
  /**
   * Pace for a run, speed for a ride, speed and climbing rate for a hike. Also
   * decides the cadence unit — steps a minute on foot, revolutions on a bike —
   * and what the whole of it is called.
   */
  motion?: ActivityMotion;
}

type ChartRow = ActivityChannelPoint & {
  x: number;
};

/** What one whole activity is called, by how it moves. */
const ACTIVITY_NOUN: Record<ActivityMotion, string> = {
  pace: "run",
  speed: "ride",
  hike: "hike"
};

function cadenceUnit(motion: ActivityMotion): string {
  return motion === "speed" ? "rpm" : "spm";
}

function formatPaceTick(secondsPerKm: number, unitSystem: UnitSystem): string {
  const perDisplayUnit = Math.round(secondsPerKmToDisplayPace(secondsPerKm, unitSystem));
  const minutes = Math.floor(perDisplayUnit / 60);
  const seconds = perDisplayUnit % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatChannelValue(
  key: ActivityChannelKey,
  value: number,
  unitSystem: UnitSystem,
  motion: ActivityMotion
): string {
  const definition = activityChannel(key);

  if (key === "pace" || key === "adjustedPace") {
    return `${formatPaceTick(value, unitSystem)} /${distanceUnit(unitSystem)}`;
  }
  if (key === "speed") {
    return `${kmhToDisplaySpeed(value, unitSystem).toFixed(1)} ${speedUnit(unitSystem)}`;
  }
  if (key === "verticalSpeed") {
    return `${Math.round(metersToElevation(value, unitSystem))} ${elevationUnit(unitSystem)}/h`;
  }
  if (key === "cadence") {
    return `${value.toFixed(definition.decimals)} ${cadenceUnit(motion)}`;
  }
  if (key === "altitude") {
    return `${Math.round(metersToElevation(value, unitSystem))} ${elevationUnit(unitSystem)}`;
  }

  return `${value.toFixed(definition.decimals)} ${definition.unit}`.trim();
}

function formatAxisTick(
  key: ActivityChannelKey,
  value: number,
  unitSystem: UnitSystem
): string {
  if (key === "pace" || key === "adjustedPace") {
    return formatPaceTick(value, unitSystem);
  }
  if (key === "speed") {
    return kmhToDisplaySpeed(value, unitSystem).toFixed(0);
  }
  if (key === "altitude" || key === "verticalSpeed") {
    return String(Math.round(metersToElevation(value, unitSystem)));
  }
  return value.toFixed(activityChannel(key).decimals);
}

/**
 * Metres climbed in a stretch, as a barometric watch counts them: a rise is
 * only counted once it has held for 2 m, so the altimeter's own wobble on the
 * flat adds nothing.
 */
function stretchGain(points: readonly ActivityChannelPoint[]): number | undefined {
  let gain = 0;
  let anchor: number | undefined;
  for (const point of points) {
    if (typeof point.altitude !== "number") continue;
    if (anchor === undefined) {
      anchor = point.altitude;
    } else if (point.altitude - anchor >= 2) {
      gain += point.altitude - anchor;
      anchor = point.altitude;
    } else if (anchor - point.altitude >= 2) {
      anchor = point.altitude;
    }
  }
  return anchor === undefined ? undefined : gain;
}

function formatXTick(
  axis: ActivitySeriesAxis,
  value: number,
  unitSystem: UnitSystem
): string {
  if (axis === "elapsed") {
    return formatDurationSeconds(value);
  }
  return metersToDisplayDistance(value, unitSystem).toFixed(1);
}

/** The tooltip's heading: the same position as a tick, with its unit. */
function formatXLabel(
  axis: ActivitySeriesAxis,
  value: number,
  unitSystem: UnitSystem
): string {
  if (axis === "elapsed") {
    return formatDurationSeconds(value);
  }
  return `${metersToDisplayDistance(value, unitSystem).toFixed(2)} ${distanceUnit(unitSystem)}`;
}

/**
 * Heart-rate zones as bands that meet.
 *
 * COROS states each zone's bounds in whole beats, so one zone ends a beat below
 * where the next begins. Drawn as given, every boundary was a dark 1 bpm stripe
 * across the plot; each band runs up to the next one's floor instead.
 */
function hrZoneBands(
  zones: readonly TrainingHubActivityZoneBucket[]
): { index: number; low: number; high: number }[] {
  const bounded: { index: number; low: number; high: number }[] = [];
  for (const zone of zones) {
    if (zone.index > 0 && zone.low !== undefined && zone.high !== undefined) {
      bounded.push({ index: zone.index, low: zone.low, high: zone.high });
    }
  }
  bounded.sort((a, b) => a.low - b.low);

  return bounded.map((zone, position) => {
    const next = bounded[position + 1];
    return next ? { ...zone, high: Math.max(zone.high, next.low) } : zone;
  });
}

/**
 * Laps as positions on the current axis.
 *
 * COROS states a lap's own distance and duration, never a running total, so the
 * boundaries are accumulated here. A lap missing either figure would shift
 * every boundary after it, so an incomplete lap ends the sequence instead.
 */
function lapBoundaries(
  laps: readonly TrainingHubActivityLap[],
  axis: ActivitySeriesAxis
): { index: number; from: number; to: number }[] {
  const boundaries: { index: number; from: number; to: number }[] = [];
  let cursor = 0;

  for (const lap of laps) {
    const span = axis === "elapsed" ? lap.duration : lap.distance;
    if (span === undefined || !Number.isFinite(span) || span <= 0) {
      break;
    }
    boundaries.push({ index: lap.index, from: cursor, to: cursor + span });
    cursor += span;
  }

  return boundaries;
}

export function ActivitySeriesChart({
  series,
  laps,
  hrZones,
  focusLapIndex,
  onFocusLapHandled,
  activityTime,
  embedded = false,
  motion = "pace"
}: ActivitySeriesChartProps) {
  const { unitSystem } = useUnitSystem();
  const { theme } = useTheme();
  const { colors } = useChartColors();
  const palette = useMemo(() => activityChannelColors(theme), [theme]);

  const points = useMemo<ActivityChannelPoint[]>(() => {
    const sampled = downsampleActivitySeries([...series], CHART_POINTS);
    if (motion === "hike") {
      return withVerticalSpeed(withSpeed(sampled));
    }
    return motion === "speed" ? withSpeed(sampled) : sampled;
  }, [motion, series]);

  const available = useMemo(
    () => availableActivityChannels(points, motion),
    [motion, points]
  );
  const hasAltitude = available.some((channel) => channel.key === "altitude");
  const hasDistance = points.some((point) => typeof point.distance === "number");
  const hasElapsed = points.some((point) => typeof point.elapsed === "number");

  const [axis, setAxis] = useState<ActivitySeriesAxis>("elapsed");
  const [selected, setSelected] = useState<ActivityChannelKey[]>([]);
  const [showAltitude, setShowAltitude] = useState(true);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  // A different set of channels means different chips; re-open on their
  // defaults rather than leaving chips selected that have no readings. Keyed on
  // which channels exist, not on the array: "Try again" re-fetches the same run
  // and hands back a new detail object, and an identity key wiped the athlete's
  // chip choice and brush on a run they never left.
  const availableKey = available.map((channel) => channel.key).join(",");
  const availableRef = useRef(available);
  availableRef.current = available;
  useEffect(() => {
    setSelected(defaultSelectedChannels(availableRef.current, motion));
    setRange(null);
  }, [availableKey, motion]);

  useEffect(() => {
    if (!hasElapsed && hasDistance) {
      setAxis("distance");
    }
  }, [hasDistance, hasElapsed]);

  const rows = useMemo<ChartRow[]>(() => {
    const key = axis === "elapsed" ? "elapsed" : "distance";
    return points
      .filter((point) => typeof point[key] === "number")
      .map((point) => ({ ...point, x: point[key] as number }));
  }, [axis, points]);

  const boundaries = useMemo(() => lapBoundaries(laps, axis), [axis, laps]);
  const zoneBands = useMemo(() => hrZoneBands(hrZones), [hrZones]);

  // A lap picked in the table below: translate its span on the current axis
  // into the row indices the brush speaks in.
  useEffect(() => {
    if (focusLapIndex === null) {
      return;
    }
    const lap = boundaries.find((entry) => entry.index === focusLapIndex);
    if (lap && rows.length > 0) {
      const start = rows.findIndex((row) => row.x >= lap.from);
      let end = rows.findIndex((row) => row.x >= lap.to);
      if (end === -1) {
        end = rows.length - 1;
      }
      if (start !== -1 && end > start) {
        setRange({ start, end });
      }
    }
    onFocusLapHandled();
  }, [boundaries, focusLapIndex, onFocusLapHandled, rows]);

  const altitudeDomain = useMemo<[number, number] | null>(() => {
    if (!hasAltitude) {
      return null;
    }
    const values = rows
      .map((row) => row.altitude)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) {
      return null;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    // The backdrop must sit under the lines, so its band is pushed into the
    // bottom third of the plot rather than filling it.
    const span = Math.max(max - min, 1);
    return [min - span * 0.1, max + span * 2];
  }, [hasAltitude, rows]);

  const visible = useMemo(() => {
    if (range === null) {
      return rows;
    }
    return rows.slice(range.start, range.end + 1);
  }, [range, rows]);

  const segment = useMemo(() => {
    if (visible.length < 2) {
      return null;
    }
    const first = visible[0]!;
    const last = visible[visible.length - 1]!;
    // Averages come off the recorded samples inside the stretch, not the
    // chart's downsampled rows: a row is a bucket's mean, so one that holds
    // ten seconds of pedalling and twenty of freewheeling reads 30 rpm, and
    // no zero to skip — the segment then sat 10 rpm under the ride's figure.
    const axisKey = axis === "elapsed" ? "elapsed" : "distance";
    const recorded = series.filter((point) => {
      const at = point[axisKey];
      return typeof at === "number" && at >= first.x && at <= last.x;
    });
    const source: readonly ActivityChannelPoint[] = recorded.length >= 2 ? recorded : visible;
    const mean = (key: ActivityChannelKey, skipZeros = false) => {
      const values = source
        .map((row) => row[key])
        .filter(
          (value): value is number =>
            typeof value === "number" && (!skipZeros || value > 0)
        );
      return values.length === 0
        ? undefined
        : values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const distance =
      typeof first.distance === "number" && typeof last.distance === "number"
        ? last.distance - first.distance
        : undefined;
    const duration =
      range === null && activityTime !== undefined
        ? activityTime
        : typeof first.elapsed === "number" && typeof last.elapsed === "number"
          ? last.elapsed - first.elapsed
          : undefined;

    // The segment's own pace, from its own distance and clock, rather than
    // the mean of per-sample paces — a run that stopped would otherwise read
    // faster than it was, since a stopped sample carries no pace at all.
    const pace =
      distance !== undefined && duration !== undefined && distance > 0
        ? duration / (distance / 1000)
        : mean("pace");

    return {
      distance,
      duration,
      pace,
      // A ride's speed is that same figure the other way up, not the mean of
      // the samples' speeds, for the same reason.
      speed: pace !== undefined && pace > 0 ? 3600 / pace : undefined,
      hr: mean("hr"),
      // A ride's cadence is averaged over the pedalling, as the watch states it:
      // every coasting second reads 0, and counting them put the segment 15 rpm
      // under the ride's own figure on the same page. A hike's over the walking,
      // for the same reason: its watch keeps recording through every rest.
      cadence: mean("cadence", motion !== "pace"),
      // Only a ride states it: a run's power is the watch's own estimate, and
      // the Running screen has never put it beside the segment's figures.
      power: motion === "speed" ? mean("power") : undefined,
      // What a walker asks of a stretch first: how much height it gained.
      gain: motion === "hike" ? stretchGain(source) : undefined
    };
  }, [activityTime, axis, motion, range, series, visible]);

  const surfaceClass = embedded
    ? "activity-chart-panel is-embedded"
    : "panel run-detail-panel activity-chart-panel";
  const heading = embedded ? (
    <h3>Channels</h3>
  ) : (
    <p className="running-eyebrow">Channels</p>
  );

  if (rows.length < 2) {
    return (
      <section className={surfaceClass}>
        {heading}
        <p className="activity-chart-empty">
          COROS returned no per-sample readings for this {ACTIVITY_NOUN[motion]},
          so there is nothing to plot. The summary above is everything it sent.
        </p>
      </section>
    );
  }

  const axisChannels = selected.map(activityChannel);

  return (
    <section className={surfaceClass}>
      <div className="activity-chart-head">
        {heading}
        <OptionGroup
          label="X axis"
          className="activity-chart-axis"
          value={axis}
          options={[
            { value: "elapsed", label: "Time", disabled: !hasElapsed },
            { value: "distance", label: "Distance", disabled: !hasDistance }
          ]}
          onChange={(next) =>
            setAxis(next === "distance" ? "distance" : "elapsed")
          }
        />
      </div>

      {/* The chip wears its own series colour, because that colour is how the
          line is found in the plot — it is data, not decoration. */}
      <OptionChips
        label="Series"
        className="activity-chart-chips"
        options={available.map((channel) => ({
          value: channel.key,
          label: channel.label
        }))}
        values={available
          .filter((channel) =>
            channel.background ? showAltitude : selected.includes(channel.key)
          )
          .map((channel) => channel.key)}
        colorOf={(key) => palette[key as ActivityChannelKey]?.stroke}
        onToggle={(key) => {
          const channel = available.find((entry) => entry.key === key);
          if (channel?.background) {
            setShowAltitude((previous) => !previous);
            return;
          }
          setSelected((previous) =>
            toggleActivityChannel(previous, key as ActivityChannelKey)
          );
        }}
      />

      <div className="activity-chart-plot">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="run-altitude-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.altitude.stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={palette.altitude.stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />

            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              tickFormatter={(value: number) => formatXTick(axis, value, unitSystem)}
              minTickGap={40}
            />

            {/* `hide` does not take the axis out of the layout: recharts still
                reserves a left gutter for it and then pushes the real left axis
                into negative x, where it is clipped away. Width zero is what
                actually keeps the elevation scale out of the way. */}
            {altitudeDomain && showAltitude ? (
              <YAxis yAxisId="altitude" hide width={0} domain={altitudeDomain} />
            ) : null}

            {/* No `width` here on purpose: recharts lays the plot out against
                its own default gutter and then draws the axis at that same
                default, so a narrower width leaves the two disagreeing and the
                left axis is drawn off the canvas at a negative x. */}
            {axisChannels.map((channel, index) => (
              <YAxis
                key={channel.key}
                yAxisId={channel.key}
                orientation={index === 0 ? "left" : "right"}
                domain={["auto", "auto"]}
                reversed={channel.reversed ?? false}
                tick={{ fill: palette[channel.key].stroke, fontSize: 11 }}
                stroke={colors.grid}
                tickFormatter={(value: number) =>
                  formatAxisTick(channel.key, value, unitSystem)
                }
              />
            ))}

            {altitudeDomain && showAltitude ? (
              <Area
                yAxisId="altitude"
                dataKey="altitude"
                type="monotone"
                stroke={palette.altitude.stroke}
                strokeWidth={1}
                fill="url(#run-altitude-fill)"
                isAnimationActive={false}
                connectNulls
                activeDot={false}
              />
            ) : null}

            {/* This run's own heart-rate bands, so a glance says which zone the
                line was sitting in without reading the axis. */}
            {selected.includes("hr")
              ? zoneBands.map((zone) => (
                  <ReferenceArea
                    key={`zone-${zone.index}`}
                    yAxisId="hr"
                    y1={zone.low}
                    y2={zone.high}
                    fill={palette.hr.stroke}
                    fillOpacity={0.03 + zone.index * 0.015}
                    stroke="none"
                    ifOverflow="hidden"
                  />
                ))
              : null}

            {axisChannels.length > 0 && boundaries.length <= 40
              ? boundaries.slice(0, -1).map((lap) => (
                  <ReferenceLine
                    key={`lap-${lap.index}`}
                    yAxisId={axisChannels[0]!.key}
                    x={lap.to}
                    // Not the grid colour: on the paper theme that is pale
                    // enough to make the lap markers disappear entirely, and a
                    // marker one theme cannot show is a feature it does not have.
                    stroke={colors.text}
                    strokeOpacity={0.3}
                    strokeDasharray="2 4"
                  />
                ))
              : null}

            {axisChannels.map((channel) => (
              <Line
                key={channel.key}
                yAxisId={channel.key}
                dataKey={channel.key}
                type="monotone"
                stroke={palette[channel.key].stroke}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
                connectNulls
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            ))}

            <Tooltip
              cursor={{ stroke: colors.cursor, strokeWidth: 1 }}
              content={(props: TooltipContentProps) => (
                <RunChartTooltip
                  {...props}
                  axis={axis}
                  unitSystem={unitSystem}
                  motion={motion}
                  showAltitude={showAltitude && altitudeDomain !== null}
                  palette={palette}
                />
              )}
            />

            <Brush
              dataKey="x"
              height={22}
              travellerWidth={8}
              stroke={colors.grid}
              fill="transparent"
              startIndex={range?.start}
              endIndex={range?.end}
              tickFormatter={(value: number) => formatXTick(axis, value, unitSystem)}
              onChange={(next) => {
                const start = (next as { startIndex?: number }).startIndex;
                const end = (next as { endIndex?: number }).endIndex;
                if (typeof start === "number" && typeof end === "number") {
                  setRange(
                    start === 0 && end === rows.length - 1 ? null : { start, end }
                  );
                }
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {segment ? (
        <div className="activity-chart-segment">
          <span className="activity-chart-segment-label">
            {range === null ? `Whole ${ACTIVITY_NOUN[motion]}` : "Selection"}
          </span>
          {segment.distance !== undefined ? (
            <span>
              {metersToDisplayDistance(segment.distance, unitSystem).toFixed(2)}{" "}
              {distanceUnit(unitSystem)}
            </span>
          ) : null}
          {segment.duration !== undefined ? (
            <span>{formatDurationSeconds(segment.duration)}</span>
          ) : null}
          {motion === "pace" && segment.pace !== undefined ? (
            <span>{formatChannelValue("pace", segment.pace, unitSystem, motion)}</span>
          ) : null}
          {motion !== "pace" && segment.speed !== undefined ? (
            <span>{formatChannelValue("speed", segment.speed, unitSystem, motion)}</span>
          ) : null}
          {segment.gain !== undefined && segment.gain > 0 ? (
            <span>
              +{Math.round(metersToElevation(segment.gain, unitSystem))} {elevationUnit(unitSystem)}
            </span>
          ) : null}
          {segment.power !== undefined ? (
            <span>{Math.round(segment.power)} W</span>
          ) : null}
          {segment.hr !== undefined ? (
            <span>{Math.round(segment.hr)} bpm</span>
          ) : null}
          {segment.cadence !== undefined ? (
            <span>
              {Math.round(segment.cadence)} {cadenceUnit(motion)}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

interface RunChartTooltipProps extends TooltipContentProps {
  axis: ActivitySeriesAxis;
  unitSystem: UnitSystem;
  motion: ActivityMotion;
  showAltitude: boolean;
  palette: Record<ActivityChannelKey, { stroke: string; fill: string }>;
}

function RunChartTooltip({
  active,
  payload,
  label,
  axis,
  unitSystem,
  motion,
  showAltitude,
  palette
}: RunChartTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) {
    return null;
  }

  const readings = payload
    .map((entry) => entry.dataKey as ActivityChannelKey)
    .filter((key) => key !== "altitude")
    .flatMap((key) => {
      const value = row[key];
      return typeof value === "number" ? [{ key, value, color: palette[key].stroke }] : [];
    });

  // A gradient needs two stops, so a single channel fades in and out of its own
  // colour instead of being handed a gradient the browser would drop.
  const accent =
    readings.length === 1
      ? `transparent, ${readings[0]!.color}, transparent`
      : readings.map((reading) => reading.color).join(", ");

  return (
    <div className="training-chart-tooltip">
      {readings.length > 0 ? (
        <span
          className="training-chart-tooltip-accent"
          style={{ background: `linear-gradient(90deg, ${accent})` }}
        />
      ) : null}
      <span className="training-chart-tooltip-label">
        {formatXLabel(axis, Number(label), unitSystem)}
      </span>
      <ul className="training-chart-tooltip-rows">
        {readings.map((reading) => (
          <li key={reading.key} className="training-chart-tooltip-row">
            <span className="training-chart-tooltip-key">
              <i aria-hidden="true" style={{ background: reading.color }} />
              {activityChannel(reading.key).label}
            </span>
            <strong>
              {formatChannelValue(reading.key, reading.value, unitSystem, motion)}
            </strong>
          </li>
        ))}
        {showAltitude && typeof row.altitude === "number" ? (
          <li className="training-chart-tooltip-row">
            {/* The backdrop's own stroke is a faint wash by design; a dot in
                it would be invisible, so the key takes the muted ink. */}
            <span className="training-chart-tooltip-key">
              <i aria-hidden="true" style={{ background: "var(--text-muted)" }} />
              {activityChannel("altitude").label}
            </span>
            <strong>
              {formatChannelValue("altitude", row.altitude, unitSystem, motion)}
            </strong>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
