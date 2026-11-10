import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Map as MapIcon, X, ZoomIn } from "lucide-react";
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
  CorosProfileZoneFamily,
  TrainingHubActivityLap,
  TrainingHubActivityPause,
  TrainingHubActivitySeriesPoint,
  TrainingHubActivityTrack,
  TrainingHubActivityZoneBucket,
  UnitSystem
} from "../../../electron/types";
import { isRecoveryLap, lapSections } from "../../../electron/lapSections";
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
import { zoneName } from "../../i18n/zoneNames";
import {
  distanceAtElapsed,
  elapsedAtDistance,
  linkClock,
  stretchFigures,
  wholeLaps,
  type ActivityLink,
  type StretchFigures
} from "../activityLink";
import { useLinkValue } from "../useActivityLink";
import { heartRateZoneTime } from "../zoneTime";
import {
  LAP_RULER_MOST,
  LapRuler,
  LinkedPlotStage,
  stretchTitle,
  type PlotRect
} from "./ActivityLinkParts";
import { ActivityRouteMap, hasActivityRoute } from "./ActivityRouteMap";
import type { RouteDetail } from "./routePerformance";
import { zoneColor, zoneLabel } from "./routeColoring";
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

/** Whether the route map stands beside the chart, on every sport's page. */
const MAP_PREFERENCE = defineSelectionPreference<boolean>({
  key: "activity.chart.map",
  defaultValue: true,
  validate: selectionIsBoolean
});

interface ActivitySeriesChartProps {
  series: readonly TrainingHubActivitySeriesPoint[];
  laps: readonly TrainingHubActivityLap[];
  /** This run's own HR zone buckets, shaded behind the heart-rate line. */
  hrZones: readonly TrainingHubActivityZoneBucket[];
  /**
   * The cursor and the selection this chart shares with the page's route map
   * and lap table (`activityLink.ts`), on the clock `series` is on.
   */
  link: ActivityLink;
  /**
   * The route, drawn beside the chart and tied to it. Given by a page whose
   * only other map is a picture; absent, the chart stands alone.
   */
  track?: TrainingHubActivityTrack;
  /** The activity's detail, for the layers of that map. */
  routeDetail?: RouteDetail;
  /** The pauses `series` had taken out of its clock, which the route still counts. */
  pauses?: readonly TrainingHubActivityPause[];
  /** The model the heart-rate zones were scored on, to name a selection's zones. */
  zoneFamily?: CorosProfileZoneFamily;
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
  link,
  track,
  routeDetail,
  pauses,
  zoneFamily,
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
  const [mapPreference, setMapPreference] = useSelectionPreference(MAP_PREFERENCE);
  const hasRoute = useMemo(() => hasActivityRoute(track), [track]);
  const mapShown = hasRoute && mapPreference;
  const [plotRect, setPlotRect] = useState<PlotRect | null>(null);
  const selection = useLinkValue(link, (state) => state.selection);
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

  // The link is in seconds whatever the chart is drawn over, so every x the
  // link draws or reads goes through the clock.
  const clock = useMemo(() => linkClock(series), [series]);
  const toAxis = useCallback(
    (elapsed: number) => (axis === "elapsed" ? elapsed : distanceAtElapsed(clock, elapsed)),
    [axis, clock]
  );
  const toElapsed = useCallback(
    (value: number) => (axis === "elapsed" ? value : elapsedAtDistance(clock, value)),
    [axis, clock]
  );
  /** A stretch of the clock as the rows the brush speaks in. */
  const rowsOf = useCallback(
    (from: number, to: number) => {
      const low = toAxis(from);
      const high = toAxis(to);
      if (low === undefined || high === undefined || rows.length === 0) {
        return null;
      }
      const start = Math.max(0, rows.findIndex((row) => row.x >= low));
      let end = rows.findIndex((row) => row.x >= high);
      if (end === -1) {
        end = rows.length - 1;
      }
      return start < end ? { start, end } : null;
    },
    [rows, toAxis]
  );

  // A selection made where the zoom does not reach — a lap pressed in the
  // table — is shown: the zoom lets go rather than hiding what was just chosen.
  useEffect(() => {
    if (!selection || range === null) {
      return;
    }
    const first = rows[range.start];
    const last = rows[range.end];
    const low = toAxis(selection.from);
    const high = toAxis(selection.to);
    if (first && last && low !== undefined && high !== undefined && (high <= first.x || low >= last.x)) {
      setRange(null);
    }
  }, [range, rows, selection, toAxis]);

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

  const zoneRows = useMemo(() => heartRateZoneTime(hrZones, zoneFamily), [hrZones, zoneFamily]);
  const lapStretches = link.laps();

  /**
   * The figures under the chart: the whole of it, and — when a stretch is
   * selected, or the brush has cut one — that stretch. Off the recorded
   * samples, never the chart's rows (`stretchFigures`).
   */
  const segment = useMemo(() => {
    const reading = {
      // Only a ride states it: a run's power is the watch's own estimate.
      power: motion === "speed",
      // A ride's cadence is averaged over the pedalling, as the watch states
      // it, and a hike's over the walking: its watch records through every rest.
      cadenceSkipsZeros: !readsPace(motion),
      gain: true
    };
    // Each zone's floor in bpm, easiest first; the easiest has none.
    const bands =
      zoneRows.length > 1 && zoneRows.slice(1).every((row) => row.easyEdge !== undefined)
        ? zoneRows.map((row) => row.easyEdge ?? 0)
        : undefined;
    const key = hasElapsed ? "elapsed" : "distance";
    const measured = stretchFigures(series, key, -Infinity, Infinity, reading, bands);
    if (!measured) {
      return null;
    }
    // COROS's own activity time, stated for the whole of it.
    const whole: StretchFigures = activityTime !== undefined ? { ...measured, duration: activityTime } : measured;

    let stretch: StretchFigures | null = null;
    let title: string | null = null;
    if (selection && hasElapsed) {
      stretch = stretchFigures(series, "elapsed", selection.from, selection.to, reading, bands);
      title = stretchTitle(lapStretches, selection);
      // Exactly one lap: COROS's own figures for it, so this block and the lap
      // table below never read a second apart.
      const whole_ = wholeLaps(lapStretches, selection);
      const lap =
        whole_ && whole_.first.index === whole_.last.index
          ? laps.find((entry) => entry.index === whole_.first.index)
          : undefined;
      if (stretch && lap) {
        const pace =
          lap.distance && lap.duration ? lap.duration / (lap.distance / 1000) : (lap.pace ?? stretch.pace);
        stretch = {
          ...stretch,
          distance: lap.distance ?? stretch.distance,
          duration: lap.duration ?? stretch.duration,
          pace,
          speed: pace !== undefined && pace > 0 ? 3600 / pace : stretch.speed,
          hr: lap.avgHr ?? stretch.hr,
          hrMax: lap.maxHr ?? stretch.hrMax,
          cadence: lap.avgCadence ?? stretch.cadence
        };
      }
    } else if (range !== null && visible.length >= 2) {
      const axisKey = axis === "elapsed" ? "elapsed" : "distance";
      stretch = stretchFigures(series, axisKey, visible[0]!.x, visible[visible.length - 1]!.x, reading, bands);
    }
    return { whole, stretch, title };
  }, [activityTime, axis, hasElapsed, laps, lapStretches, motion, range, selection, series, visible, zoneRows]);

  /** The x at the plot's two edges: the whole of it, or what the brush has cut. */
  const domain = useMemo<readonly [number, number]>(
    () => (visible.length > 1 ? [visible[0]!.x, visible[visible.length - 1]!.x] : [0, 1]),
    [visible]
  );
  const lapSectionList = useMemo(() => lapSections(laps), [laps]);
  const lapRecoveries = useMemo(
    () => laps.map((lap, position) => isRecoveryLap(lap, lapSectionList[position])),
    [laps, lapSectionList]
  );

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
        <LinkedPlotStage
          link={link}
          domain={domain}
          toAxis={toAxis}
          toElapsed={toElapsed}
          // The ruler stands over the first plot; split, the body plot's area
          // has the same edges.
          onPlotRect={name === "body" ? undefined : setPlotRect}
        >
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
        </LinkedPlotStage>
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

  const ruler =
    plotRect && hasElapsed && lapStretches.length > 1 && lapStretches.length <= LAP_RULER_MOST ? (
      <LapRuler
        link={link}
        rect={plotRect}
        domain={domain}
        toAxis={toAxis}
        sections={lapSectionList}
        recoveries={lapRecoveries}
      />
    ) : null;

  const distanceText = (meters: number) =>
    motion === "swim"
      ? // A swim is said in metres (or yards), never in kilometres.
        formatDistanceValue(meters, unitSystem, { swim: true })
      : `${formatDecimal(metersToDisplayDistance(meters, unitSystem), 2)} ${distanceUnit(unitSystem)}`;
  const signed = (value: number, unit: string) => {
    const rounded = Math.round(value);
    return rounded === 0 ? undefined : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} ${unit}`;
  };
  const share = (part: number | undefined, all: number | undefined) =>
    part !== undefined && all !== undefined && all > 0
      ? t("activity.chart.selection.ofTotal", { percent: Math.round((part / all) * 100) })
      : undefined;

  /** A stretch's figures as they are written; `against` adds how each stands to the whole. */
  const figuresOf = (shown: StretchFigures, against: StretchFigures | null) => {
    const list: { key: string; label: string; value: string; delta?: string }[] = [];
    if (shown.distance !== undefined) {
      list.push({
        key: "distance",
        label: t("activity.m.distance"),
        value: distanceText(shown.distance),
        delta: against ? share(shown.distance, against.distance) : undefined
      });
    }
    if (shown.duration !== undefined) {
      list.push({
        key: "time",
        label: t("activity.m.time"),
        value: formatDurationSeconds(shown.duration),
        delta: against ? share(shown.duration, against.duration) : undefined
      });
    }
    if (readsPace(motion) && shown.pace !== undefined) {
      let delta: string | undefined;
      if (against?.pace !== undefined) {
        const gap = shown.pace - against.pace;
        const amount = formatPaceTick(Math.abs(gap), unitSystem, motion);
        if (amount !== "0:00") {
          delta = t(gap < 0 ? "activity.chart.selection.faster" : "activity.chart.selection.slower", {
            amount: `${amount} ${paceUnit(unitSystem, motion)}`
          });
        }
      }
      list.push({
        key: "pace",
        label: activityChannel("pace", motion, sportType).label,
        value: formatChannelValue("pace", shown.pace, unitSystem, motion),
        delta
      });
    }
    if (!readsPace(motion) && shown.speed !== undefined) {
      let delta: string | undefined;
      if (against?.speed !== undefined) {
        const gap = kmhToDisplaySpeed(shown.speed, unitSystem) - kmhToDisplaySpeed(against.speed, unitSystem);
        if (Math.abs(gap) >= 0.05) {
          delta = t(gap > 0 ? "activity.chart.selection.faster" : "activity.chart.selection.slower", {
            amount: `${formatDecimal(Math.abs(gap), 1)} ${speedUnit(unitSystem)}`
          });
        }
      }
      list.push({
        key: "speed",
        label: activityChannel("speed", motion, sportType).label,
        value: formatChannelValue("speed", shown.speed, unitSystem, motion),
        delta
      });
    }
    if (shown.power !== undefined) {
      list.push({
        key: "power",
        label: t("activity.m.power"),
        value: `${Math.round(shown.power)} W`,
        delta: against?.power !== undefined ? signed(shown.power - against.power, "W") : undefined
      });
    }
    if (shown.hr !== undefined) {
      list.push({
        key: "hr",
        label: t("activity.m.avgHr"),
        value: `${Math.round(shown.hr)} bpm`,
        delta: against?.hr !== undefined ? signed(shown.hr - against.hr, "bpm") : undefined
      });
    }
    if (shown.hrMax !== undefined) {
      list.push({ key: "hrMax", label: t("activity.m.maxHr"), value: `${Math.round(shown.hrMax)} bpm` });
    }
    if (shown.cadence !== undefined) {
      list.push({
        key: "cadence",
        label: activityChannel("cadence", motion, sportType).label,
        value: `${Math.round(shown.cadence)} ${cadenceUnit(motion)}`,
        delta:
          against?.cadence !== undefined
            ? signed(shown.cadence - against.cadence, cadenceUnit(motion))
            : undefined
      });
    }
    if (shown.gain !== undefined && shown.gain > 0) {
      list.push({
        key: "gain",
        label: t("activity.m.climb"),
        value: `+${Math.round(metersToElevation(shown.gain, unitSystem))} ${elevationUnit(unitSystem)}`
      });
    }
    return list;
  };

  const shownFigures = segment ? (segment.stretch ?? segment.whole) : null;
  const zoneTotal = shownFigures?.zoneSeconds?.reduce((sum, seconds) => sum + seconds, 0) ?? 0;

  return (
    <section
      className={surfaceClass}
      onKeyDown={(event) => {
        // Escape lets the selection go, and nothing else: the page is not left with it.
        if (event.key === "Escape" && link.getState().selection) {
          event.stopPropagation();
          link.setSelection(null);
        }
      }}
    >
      <div className="activity-chart-head">
        {heading}
        <div className="activity-chart-controls">
          {hasRoute ? (
            <button
              type="button"
              className="activity-chart-toggle"
              aria-pressed={mapShown}
              title={t(mapShown ? "activity.chart.map.hide" : "activity.chart.map.show")}
              aria-label={t(mapShown ? "activity.chart.map.hide" : "activity.chart.map.show")}
              onClick={() => setMapPreference(!mapPreference)}
            >
              <MapIcon size={15} aria-hidden="true" />
            </button>
          ) : null}
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

      <div className={mapShown ? "activity-chart-body has-map" : "activity-chart-body"}>
        {mapShown ? (
          <div className="activity-chart-map">
            <ActivityRouteMap track={track} detail={routeDetail} link={link} pauses={pauses} />
          </div>
        ) : null}
        <div className="activity-chart-main">
          {split ? (
            <>
              <div className="activity-chart-group">
                <span className="activity-chart-group-label">{t("activity.chart.groupMotion")}</span>
                {chips(offeredIn("motion"), t("activity.chart.groupMotion"))}
              </div>
              {ruler}
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
              {ruler}
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
        </div>
      </div>

      {segment && shownFigures ? (
        <div className="activity-chart-segment">
          <div className="activity-chart-segment-head">
            <span className="activity-chart-segment-label">
              {segment.stretch
                ? t("activity.chart.selection")
                : t(`activity.chart.whole.${ACTIVITY_NOUN[motion]}` as const)}
            </span>
            {segment.stretch && segment.title ? (
              <strong className="activity-chart-segment-title">{segment.title}</strong>
            ) : null}
            {!segment.stretch && hasElapsed ? (
              <span className="activity-chart-segment-hint">{t("activity.chart.selection.hint")}</span>
            ) : null}
            {selection ? (
              <span className="activity-chart-segment-actions">
                <button
                  type="button"
                  className="activity-chart-action"
                  onClick={() => {
                    const next = rowsOf(selection.from, selection.to);
                    if (next) {
                      setRange(next);
                    }
                  }}
                >
                  <ZoomIn size={14} aria-hidden="true" />
                  {t("activity.chart.selection.zoom")}
                </button>
                <button
                  type="button"
                  className="activity-chart-action"
                  onClick={() => link.setSelection(null)}
                >
                  <X size={14} aria-hidden="true" />
                  {t("activity.chart.selection.clear")}
                </button>
              </span>
            ) : null}
          </div>
          <dl className="activity-chart-figures">
            {figuresOf(shownFigures, segment.stretch ? segment.whole : null).map((figure) => (
              <div key={figure.key} className="activity-chart-figure">
                <dt>{figure.label}</dt>
                <dd>
                  <span>{figure.value}</span>
                  {figure.delta ? <small>{figure.delta}</small> : null}
                </dd>
              </div>
            ))}
          </dl>
          {segment.stretch && shownFigures.zoneSeconds && zoneTotal > 0 ? (
            <div className="activity-chart-zones">
              <div className="activity-chart-zone-bar" role="img" aria-label={t("activity.zones.timeIn")}>
                {zoneRows.map((row, at) => {
                  const seconds = shownFigures.zoneSeconds?.[at] ?? 0;
                  return seconds > 0 ? (
                    <i
                      key={row.position}
                      style={{ width: `${(seconds / zoneTotal) * 100}%`, background: zoneColor(row.position) }}
                    />
                  ) : null;
                })}
              </div>
              <div className="activity-chart-zone-key">
                {zoneRows.map((row, at) => {
                  const seconds = shownFigures.zoneSeconds?.[at] ?? 0;
                  return seconds > 0 ? (
                    <span key={row.position}>
                      <i aria-hidden="true" style={{ background: zoneColor(row.position) }} />
                      {row.label ? zoneName(row.label) : zoneLabel(row.position)}{" "}
                      {formatDurationSeconds(seconds)}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
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
