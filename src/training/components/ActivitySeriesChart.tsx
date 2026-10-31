import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { envelopeActivitySeries, smoothActivitySeries } from "../../../electron/activitySeries";
import { OptionChips, OptionGroup } from "../../components/OptionGroup";
import { useTheme } from "../../theme/ThemeProvider";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  formatVerticalRate,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  secondsPerKmToDisplayPace,
  speedUnit,
  swimDistanceUnit
} from "../../units/units";
import { formatDistanceValue } from "../../../electron/unitSystem";
import { swimPacePer100 } from "../../../electron/activityReading";
import { formatDurationSeconds } from "../formatters";
import {
  activityAxisTicks,
  formatXLabel,
  formatXTick,
  type ActivitySeriesAxis
} from "../activityAxis";
import { useChartColors } from "../useChartColors";
import "../activityChart.css";
import {
  availableActivityChannels,
  defaultSelectedChannels,
  activityChannel,
  activityChannelColors,
  activityChannelGroup,
  canSplitActivityChannels,
  fitActivityChannels,
  toggleActivityChannel,
  withSpeed,
  withVerticalSpeed,
  type ActivityChannelDefinition,
  type ActivityChannelGroup,
  type ActivityChannelKey,
  type ActivityChannelPoint,
  type ActivityMotion
} from "../activityChannels";
import { formatDecimal, t } from "../../i18n/core";
import {
  defineSelectionPreference,
  selectionIsBoolean,
  useSelectionPreference
} from "../../preferences/selectionPreferences";

/**
 * How many rows reach recharts.
 *
 * A real run is one sample a second — 5 149 of them on an 86-minute easy run —
 * and handing that to an SVG chart costs a second of layout per redraw for
 * detail no screen can show. A thousand is about one row per pixel of a full
 * width plot, and each bucket keeps its lowest and highest reading
 * (`envelopeActivitySeries`), so a surge or a stop shorter than a bucket is
 * still drawn at its full height. It was 400 bucket means: a bucket of nine
 * seconds on an hour's run, and every peak in it averaged down to a ripple.
 */
const CHART_POINTS = 1000;

const COMBINED_HEIGHT = 340;
/**
 * Split, the movement plot is the shorter one: it draws no time axis of its own
 * (the body plot's, under it, is the same clock) and the brush sits under the
 * body plot.
 */
const SPLIT_TOP_HEIGHT = 200;
const SPLIT_BOTTOM_HEIGHT = 262;

/** Axis ids a plot draws empty, so it keeps both gutters whatever channels it holds. */
const SPARE_LEFT_AXIS = "spare-left";
const SPARE_RIGHT_AXIS = "spare-right";

/**
 * Whether the chart is drawn as one plot or as two — the movement above, the
 * body below. One choice for every sport's page, a preference that syncs.
 */
const SPLIT_PREFERENCE = defineSelectionPreference<boolean>({
  key: "activity.chart.split",
  defaultValue: false,
  validate: selectionIsBoolean
});

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
   * Pace for a run, speed for a ride, speed and climbing rate for a hike, pace
   * and climbing rate for a trail run. Also decides the cadence unit — steps a
   * minute on foot, revolutions on a bike — and what the whole of it is called.
   */
  motion?: ActivityMotion;
  /**
   * The activity's COROS sport, where the caller reads more than one: power
   * read as a pace is Running power only on a run (`activityChannel`).
   */
  sportType?: number;
}

type ChartRow = ActivityChannelPoint & {
  x: number;
};

/** Which activity the chart is about, for its two sentences that name it. */
const ACTIVITY_NOUN: Record<ActivityMotion, "run" | "ride" | "hike" | "swim"> = {
  pace: "run",
  speed: "ride",
  hike: "hike",
  trail: "run",
  swim: "swim"
};

/** Whether a whole activity's movement is stated as a pace — a run's, on the road or a trail, or a swim's. */
function readsPace(motion: ActivityMotion): boolean {
  return motion === "pace" || motion === "trail" || motion === "swim";
}

function cadenceUnit(motion: ActivityMotion): string {
  return motion === "speed" ? "rpm" : "spm";
}

/** A pace's unit: per kilometre or mile, or per 100 m or yd in the water. */
function paceUnit(unitSystem: UnitSystem, motion: ActivityMotion): string {
  return motion === "swim" ? `/100${swimDistanceUnit(unitSystem)}` : `/${distanceUnit(unitSystem)}`;
}

function formatPaceTick(secondsPerKm: number, unitSystem: UnitSystem, motion: ActivityMotion): string {
  const perDisplayUnit = Math.round(
    motion === "swim"
      ? swimPacePer100(secondsPerKm, unitSystem)
      : secondsPerKmToDisplayPace(secondsPerKm, unitSystem)
  );
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
    return `${formatPaceTick(value, unitSystem, motion)} ${paceUnit(unitSystem, motion)}`;
  }
  if (key === "speed") {
    return `${formatDecimal(kmhToDisplaySpeed(value, unitSystem), 1)} ${speedUnit(unitSystem)}`;
  }
  if (key === "verticalSpeed") {
    return formatVerticalRate(value, unitSystem);
  }
  if (key === "cadence") {
    return `${formatDecimal(value, definition.decimals)} ${cadenceUnit(motion)}`;
  }
  if (key === "altitude") {
    return `${Math.round(metersToElevation(value, unitSystem))} ${elevationUnit(unitSystem)}`;
  }

  return `${formatDecimal(value, definition.decimals)} ${definition.unit}`.trim();
}

function formatAxisTick(
  key: ActivityChannelKey,
  value: number,
  unitSystem: UnitSystem,
  motion: ActivityMotion
): string {
  if (key === "pace" || key === "adjustedPace") {
    return formatPaceTick(value, unitSystem, motion);
  }
  if (key === "speed") {
    return formatDecimal(kmhToDisplaySpeed(value, unitSystem), 0);
  }
  if (key === "altitude" || key === "verticalSpeed") {
    return String(Math.round(metersToElevation(value, unitSystem)));
  }
  return formatDecimal(value, activityChannel(key).decimals);
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
  motion = "pace",
  sportType
}: ActivitySeriesChartProps) {
  const { unitSystem } = useUnitSystem();
  const { theme } = useTheme();
  const { colors } = useChartColors();
  const palette = useMemo(() => activityChannelColors(theme), [theme]);

  const points = useMemo<ActivityChannelPoint[]>(() => {
    // Smoothed first, then reduced: the envelope keeps a bucket's extremes, and
    // on raw GPS pace those are the noise, not the run.
    const sampled = envelopeActivitySeries(smoothActivitySeries(series), CHART_POINTS);
    if (motion === "hike") {
      return withVerticalSpeed(withSpeed(sampled));
    }
    if (motion === "trail") {
      return withVerticalSpeed(sampled);
    }
    return motion === "speed" ? withSpeed(sampled) : sampled;
  }, [motion, series]);

  const available = useMemo(
    () => availableActivityChannels(points, motion, sportType),
    [motion, points, sportType]
  );
  const hasAltitude = available.some((channel) => channel.key === "altitude");
  const hasDistance = points.some((point) => typeof point.distance === "number");
  const hasElapsed = points.some((point) => typeof point.elapsed === "number");

  const [axis, setAxis] = useState<ActivitySeriesAxis>("elapsed");
  const [selected, setSelected] = useState<ActivityChannelKey[]>([]);
  const [showAltitude, setShowAltitude] = useState(true);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [splitPreference, setSplitPreference] = useSelectionPreference(SPLIT_PREFERENCE);
  const splittable = canSplitActivityChannels(available);
  const split = splitPreference && splittable;
  // One id per mounted chart: it names the elevation gradients and, split, ties
  // the two plots' tooltip and brush together — and nothing on another screen.
  const syncId = `activity-chart-${useId().replace(/[^\w-]/g, "")}`;

  // A different set of channels means different chips; re-open on their
  // defaults rather than leaving chips selected that have no readings. Keyed on
  // which channels exist, not on the array: "Try again" re-fetches the same run
  // and hands back a new detail object, and an identity key wiped the athlete's
  // chip choice and brush on a run they never left.
  const availableKey = available.map((channel) => channel.key).join(",");
  const availableRef = useRef(available);
  availableRef.current = available;
  const splitRef = useRef(split);
  splitRef.current = split;
  useEffect(() => {
    setSelected(
      fitActivityChannels(
        defaultSelectedChannels(availableRef.current, motion),
        availableRef.current,
        splitRef.current
      )
    );
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

  // Round marks over the stretch on screen, the same ones the efficiency chart
  // above a run's page draws, so a minute reads at one x in both.
  const xTicks = useMemo(
    () =>
      visible.length > 0
        ? activityAxisTicks(visible[0]!.x, visible[visible.length - 1]!.x, axis, unitSystem)
        : undefined,
    [axis, unitSystem, visible]
  );

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

    // From the first and last rows that carry a distance, not the stretch's
    // ends: a watch records the clock before GPS has a fix and after it has
    // stopped counting, and a stretch ending on such a row stated no distance.
    const firstDistance = visible.find((row) => typeof row.distance === "number")?.distance;
    const lastDistance = [...visible].reverse().find((row) => typeof row.distance === "number")?.distance;
    const distance =
      firstDistance !== undefined && lastDistance !== undefined
        ? lastDistance - firstDistance
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
      cadence: mean("cadence", !readsPace(motion)),
      // Only a ride states it: a run's power is the watch's own estimate, and
      // the Running screen has never put it beside the segment's figures.
      power: motion === "speed" ? mean("power") : undefined,
      // What a walker asks of a stretch first: how much height it gained. A
      // trail runner asks it second, after the pace.
      gain: motion === "hike" || motion === "trail" ? stretchGain(source) : undefined
    };
  }, [activityTime, axis, motion, range, series, visible]);

  const surfaceClass = embedded
    ? "activity-chart-panel is-embedded"
    : "panel run-detail-panel activity-chart-panel";
  const heading = embedded ? (
    <h3>{t("activity.chart.channels")}</h3>
  ) : (
    <p className="running-eyebrow">{t("activity.chart.channels")}</p>
  );

  if (rows.length < 2) {
    return (
      <section className={surfaceClass}>
        {heading}
        <p className="activity-chart-empty">
          {t(`activity.chart.empty.${ACTIVITY_NOUN[motion]}` as const)}
        </p>
      </section>
    );
  }

  const plot = ({
    name,
    channels,
    height,
    withBrush,
    tooltipAltitude,
    showXAxis = true
  }: {
    /** Which plot this is, so each SVG names its own gradient. */
    name: "combined" | ActivityChannelGroup;
    channels: readonly ActivityChannelDefinition[];
    height: number;
    withBrush: boolean;
    tooltipAltitude: boolean;
    showXAxis?: boolean;
  }) => {
    const leftAxisId = channels[0]?.key ?? SPARE_LEFT_AXIS;
    const altitudeFillId = `${syncId}-${name}-altitude-fill`;
    return (
      <>
        <PlotAxisCaptions channels={channels} palette={palette} motion={motion} unitSystem={unitSystem} />
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
            {...(split ? { syncId } : {})}
          >
            <defs>
              <linearGradient id={altitudeFillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.altitude.stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={palette.altitude.stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {/* Hairlines, not dashes: the grid is there to be read against, and
                a dashed one competes with the lap markers drawn the same way. */}
            <CartesianGrid stroke={colors.grid} vertical={false} />

            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              hide={!showXAxis}
              ticks={xTicks}
              tick={{ fill: colors.text, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colors.grid }}
              tickMargin={6}
              tickFormatter={(value: number) => formatXTick(axis, value, unitSystem)}
              minTickGap={48}
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
            {/* Ticks in the muted ink, never the series colour: which axis is
                which is said by the caption above each, where the colour sits on
                a mark beside the words. */}
            {channels.map((channel, index) => (
              <YAxis
                key={channel.key}
                yAxisId={channel.key}
                orientation={index === 0 ? "left" : "right"}
                domain={["auto", "auto"]}
                reversed={channel.reversed ?? false}
                tick={{ fill: colors.text, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickCount={5}
                tickFormatter={(value: number) =>
                  formatAxisTick(channel.key, value, unitSystem, motion)
                }
              />
            ))}
            {/* A left and a right gutter whether or not there is a channel for
                each, so x positions line up with whatever is drawn on the same
                clock — the other plot of a split, the efficiency chart above a
                run's page — and the plot does not widen as a channel is let go. */}
            {channels.length === 0 ? (
              <YAxis yAxisId={SPARE_LEFT_AXIS} orientation="left" tick={false} axisLine={false} tickLine={false} />
            ) : null}
            {channels.length < 2 ? (
              <YAxis yAxisId={SPARE_RIGHT_AXIS} orientation="right" tick={false} axisLine={false} tickLine={false} />
            ) : null}

            {altitudeDomain && showAltitude ? (
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

            {/* This run's own heart-rate bands, so a glance says which zone the
                line was sitting in without reading the axis. */}
            {channels.some((channel) => channel.key === "hr")
              ? zoneBands.map((zone) => (
                  <ReferenceArea
                    key={`zone-${zone.index}`}
                    yAxisId="hr"
                    y1={zone.low}
                    y2={zone.high}
                    fill={palette.hr.stroke}
                    fillOpacity={0.02 + zone.index * 0.012}
                    stroke="none"
                    ifOverflow="hidden"
                  />
                ))
              : null}

            {boundaries.length <= 40
              ? boundaries.slice(0, -1).map((lap) => (
                  <ReferenceLine
                    key={`lap-${lap.index}`}
                    yAxisId={leftAxisId}
                    x={lap.to}
                    // Not the grid colour: on the paper theme that is pale
                    // enough to make the lap markers disappear entirely, and a
                    // marker one theme cannot show is a feature it does not have.
                    stroke={colors.text}
                    strokeOpacity={0.22}
                    strokeDasharray="1 3"
                  />
                ))
              : null}

            {/* Straight segments between recorded readings: a spline through a
                surge rounds its corners off and draws values between samples
                that nobody recorded. */}
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
              cursor={{ stroke: colors.text, strokeOpacity: 0.35, strokeWidth: 1 }}
              content={(props: TooltipContentProps) => (
                <RunChartTooltip
                  {...props}
                  axis={axis}
                  unitSystem={unitSystem}
                  motion={motion}
                  sportType={sportType}
                  showAltitude={tooltipAltitude && showAltitude && altitudeDomain !== null}
                  palette={palette}
                />
              )}
            />

            {withBrush ? (
              <Brush
                dataKey="x"
                height={20}
                travellerWidth={10}
                stroke={colors.grid}
                fill="transparent"
                traveller={(props: { x: number; y: number; width: number; height: number }) => (
                  <BrushHandle {...props} color={colors.text} fill={colors.tooltipBg} />
                )}
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
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </>
    );
  };

  // The chip wears its own series colour, because that colour is how the line
  // is found in the plot — it is data, not decoration.
  const chips = (offered: readonly ActivityChannelDefinition[], label: string) => (
    <OptionChips
      label={label}
      className="activity-chart-chips"
      options={offered.map((channel) => ({
        value: channel.key,
        label: channel.label
      }))}
      values={offered
        .filter((channel) =>
          channel.background ? showAltitude : selected.includes(channel.key)
        )
        .map((channel) => channel.key)}
      colorOf={(key) => palette[key as ActivityChannelKey]?.stroke}
      onToggle={(key) => {
        const channel = offered.find((entry) => entry.key === key);
        if (channel?.background) {
          setShowAltitude((previous) => !previous);
          return;
        }
        setSelected((previous) =>
          toggleActivityChannel(previous, key as ActivityChannelKey, split)
        );
      }}
    />
  );

  const selectedIn = (group: ActivityChannelGroup) =>
    selected.filter((key) => activityChannelGroup(key) === group).map((key) => activityChannel(key, motion, sportType));
  const offeredIn = (group: ActivityChannelGroup) =>
    available.filter((channel) =>
      group === "motion"
        ? channel.background || activityChannelGroup(channel.key) === "motion"
        : activityChannelGroup(channel.key) === "body"
    );

  return (
    <section className={surfaceClass}>
      <div className="activity-chart-head">
        {heading}
        <div className="activity-chart-controls">
          {splittable ? (
            <OptionGroup
              label={t("activity.chart.layout")}
              value={split ? "split" : "combined"}
              options={[
                { value: "combined", label: t("activity.chart.layoutCombined") },
                { value: "split", label: t("activity.chart.layoutSplit") }
              ]}
              onChange={(next) => {
                const nextSplit = next === "split";
                setSplitPreference(nextSplit);
                setSelected((previous) => fitActivityChannels(previous, available, nextSplit));
              }}
            />
          ) : null}
          <OptionGroup
            label={t("activity.chart.xAxis")}
            className="activity-chart-axis"
            value={axis}
            options={[
              { value: "elapsed", label: t("activity.m.time"), disabled: !hasElapsed },
              { value: "distance", label: t("activity.m.distance"), disabled: !hasDistance }
            ]}
            onChange={(next) =>
              setAxis(next === "distance" ? "distance" : "elapsed")
            }
          />
        </div>
      </div>

      {split ? (
        <>
          <div className="activity-chart-group">
            <span className="activity-chart-group-label">{t("activity.chart.groupMotion")}</span>
            {chips(offeredIn("motion"), t("activity.chart.groupMotion"))}
          </div>
          <div className="activity-chart-plot is-split-top">
            {plot({
              name: "motion",
              channels: selectedIn("motion"),
              height: SPLIT_TOP_HEIGHT,
              withBrush: false,
              tooltipAltitude: true,
              showXAxis: false
            })}
          </div>
          <div className="activity-chart-group">
            <span className="activity-chart-group-label">{t("activity.chart.groupBody")}</span>
            {chips(offeredIn("body"), t("activity.chart.groupBody"))}
          </div>
          <div className="activity-chart-plot is-split-bottom">
            {plot({
              name: "body",
              channels: selectedIn("body"),
              height: SPLIT_BOTTOM_HEIGHT,
              withBrush: true,
              tooltipAltitude: false
            })}
          </div>
        </>
      ) : (
        <>
          {chips(available, t("activity.chart.series"))}
          <div className="activity-chart-plot">
            {plot({
              name: "combined",
              channels: selected.map((key) => activityChannel(key, motion, sportType)),
              height: COMBINED_HEIGHT,
              withBrush: true,
              tooltipAltitude: true
            })}
          </div>
        </>
      )}

      {segment ? (
        <div className="activity-chart-segment">
          <span className="activity-chart-segment-label">
            {range === null
              ? t(`activity.chart.whole.${ACTIVITY_NOUN[motion]}` as const)
              : t("activity.chart.selection")}
          </span>
          {segment.distance !== undefined ? (
            <span>
              {motion === "swim" ? (
                // A swim is said in metres (or yards), never in kilometres.
                formatDistanceValue(segment.distance, unitSystem, { swim: true })
              ) : (
                <>
                  {formatDecimal(metersToDisplayDistance(segment.distance, unitSystem), 2)}{" "}
                  {distanceUnit(unitSystem)}
                </>
              )}
            </span>
          ) : null}
          {segment.duration !== undefined ? (
            <span>{formatDurationSeconds(segment.duration)}</span>
          ) : null}
          {readsPace(motion) && segment.pace !== undefined ? (
            <span>{formatChannelValue("pace", segment.pace, unitSystem, motion)}</span>
          ) : null}
          {!readsPace(motion) && segment.speed !== undefined ? (
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

/** What a plot's axes measure: the left channel's caption at the left edge, the right's at the right. */
function PlotAxisCaptions({
  channels,
  palette,
  motion,
  unitSystem
}: {
  channels: readonly ActivityChannelDefinition[];
  palette: Record<ActivityChannelKey, { stroke: string; fill: string }>;
  motion: ActivityMotion;
  unitSystem: UnitSystem;
}) {
  if (channels.length === 0) {
    return <div className="activity-chart-captions" aria-hidden="true" />;
  }
  return (
    <div className="activity-chart-captions">
      {channels.map((channel) => (
        <span key={channel.key} className="activity-chart-caption">
          <i aria-hidden="true" style={{ background: palette[channel.key].stroke }} />
          {channel.label}
          <span className="activity-chart-caption-unit">
            {axisUnit(channel.key, unitSystem, motion)}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The unit a channel's axis ticks are written in, for its caption. */
function axisUnit(key: ActivityChannelKey, unitSystem: UnitSystem, motion: ActivityMotion): string {
  if (key === "pace" || key === "adjustedPace") return paceUnit(unitSystem, motion);
  if (key === "speed") return speedUnit(unitSystem);
  if (key === "verticalSpeed") return `${elevationUnit(unitSystem)}/h`;
  if (key === "cadence") return cadenceUnit(motion);
  return activityChannel(key).unit;
}

/** A brush handle: a rounded pill with a grip line, in place of recharts' square. */
function BrushHandle({
  x,
  y,
  width,
  height,
  color,
  fill
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fill: string;
}) {
  const centre = x + width / 2;
  return (
    <g>
      <rect
        x={x}
        y={y + 1}
        width={width}
        height={height - 2}
        rx={3}
        fill={fill}
        stroke={color}
        strokeOpacity={0.45}
      />
      <line
        x1={centre}
        x2={centre}
        y1={y + height * 0.3}
        y2={y + height * 0.7}
        stroke={color}
        strokeOpacity={0.7}
        strokeLinecap="round"
      />
    </g>
  );
}

interface RunChartTooltipProps extends TooltipContentProps {
  axis: ActivitySeriesAxis;
  unitSystem: UnitSystem;
  motion: ActivityMotion;
  sportType: number | undefined;
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
  sportType,
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
              {activityChannel(reading.key, motion, sportType).label}
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
