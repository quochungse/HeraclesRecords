import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { TrainingHubActivity, UnitSystem } from "../../electron/types";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { distanceUnit, secondsPerKmToDisplayPace } from "../units/units";
import {
  buildRunEfficiencyWeeks,
  countsForEfficiency,
  paceSecondsPerKm,
  type RunZoneScale
} from "./runMetrics";
import { RUN_SURFACE_LABELS, classifyRunSurface, type RunSurface } from "./runSurface";
import { runSurfaceColors } from "./runSurfaceColors";

interface ScatterPoint {
  /** Seconds per display unit — already converted, see `formatDisplayPace`. */
  pace: number;
  hr: number;
  surface: RunSurface;
  name: string;
}

/** First and last weeks with a reading must be at least three weeks apart
 *  before their difference is called a trend, so a four-week period still shows
 *  one when both its ends were run. Twenty days rather than twenty-one: week
 *  starts are local midnights, and across a clock change three weeks is an hour
 *  short of 21 × 24 h. */
const MIN_TREND_SPAN_MS = 20 * 86_400_000;

interface RunEfficiencyChartProps {
  runs: readonly TrainingHubActivity[];
  weeks: number;
  surfaces: readonly RunSurface[];
  zoneScale: RunZoneScale;
  nowMs: number;
}

/**
 * Seconds per *display* unit as `m:ss`. The scatter converts pace once, when it
 * builds its points, so anything reading those points back must not convert
 * again — on an imperial account that would apply the mile factor twice.
 */
function formatDisplayPace(secondsPerDisplayUnit: number): string {
  const rounded = Math.round(secondsPerDisplayUnit);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

/**
 * Efficiency: how much ground one heartbeat buys.
 *
 * The one chart on this screen that says whether the athlete is getting fitter
 * rather than just busier, and it costs nothing to compute — every figure it
 * needs is already in the activity list. It only means anything on comparable
 * running, so it is drawn per surface and, where the account has threshold
 * zones, over easy sessions alone.
 */
export function RunEfficiencyChart({
  runs,
  weeks,
  surfaces,
  zoneScale,
  nowMs
}: RunEfficiencyChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const palette = useMemo(() => runSurfaceColors(), []);

  /**
   * Easy running where there is any, every long run where there is not.
   *
   * An athlete who spends the whole block in the grey zone has no easy
   * sessions at all — which is a real and common state, and the intensity panel
   * beside this one is where it gets called out. Showing an empty chart here
   * would hide their efficiency trend as a side effect of that, so the filter
   * relaxes and the header says which of the two is being drawn.
   */
  const hasZones = zoneScale.zones.length > 0;
  const { rows, easyOnly } = useMemo(() => {
    const easy = buildRunEfficiencyWeeks(runs, { weeks, nowMs, zoneScale });
    if (zoneScale.zones.length === 0 || easy.some((row) => row.count > 0)) {
      return { rows: easy, easyOnly: zoneScale.zones.length > 0 };
    }
    return { rows: buildRunEfficiencyWeeks(runs, { weeks, nowMs }), easyOnly: false };
  }, [nowMs, runs, weeks, zoneScale]);

  // The zones the line was actually filtered by, for the scatter to match.
  const appliedScale = easyOnly ? zoneScale : undefined;

  const hasAny = rows.some((row) => row.count > 0);

  // Surfaces that actually carry a line. A surface with one lonely week makes a
  // dot and no trend, so it is left to the scatter beside it.
  const drawn = useMemo(
    () =>
      surfaces.filter(
        (surface) =>
          rows.filter((row) => row.bySurface[surface] !== undefined).length >= 2
      ),
    [rows, surfaces]
  );

  const chartRows = useMemo(
    () =>
      rows.map((row) => {
        const entry: Record<string, number | string | undefined> = {
          label: row.label,
          overall: row.overall
        };
        for (const surface of drawn) {
          entry[surface] = row.bySurface[surface];
        }
        return entry;
      }),
    [drawn, rows]
  );

  // Grouped by surface once, rather than filtered once per surface per render.
  const scatterBySurface = useMemo(() => {
    const grouped = new Map<RunSurface, ScatterPoint[]>();
    for (const activity of runs) {
      const pace = paceSecondsPerKm(activity);
      const surface = classifyRunSurface(activity.sportType);
      if (
        pace === undefined ||
        activity.avgHr === undefined ||
        surface === null ||
        !countsForEfficiency(activity, appliedScale)
      ) {
        continue;
      }
      const point: ScatterPoint = {
        pace: secondsPerKmToDisplayPace(pace, unitSystem),
        hr: activity.avgHr,
        surface,
        name: activity.name?.trim() || RUN_SURFACE_LABELS[surface]
      };
      const list = grouped.get(surface);
      if (list) {
        list.push(point);
      } else {
        grouped.set(surface, [point]);
      }
    }
    return grouped;
  }, [appliedScale, runs, unitSystem]);

  const latest = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]!.overall !== undefined) {
        return rows[index];
      }
    }
    return undefined;
  }, [rows]);

  /**
   * The change between the first and last weeks with a reading, when those are
   * far enough apart to be a trend. Two adjacent weeks are not: efficiency moves
   * a few percent week to week on unchanged fitness, and the old endpoint read
   * printed that noise, in bold, as the change "across the period". It also
   * names the week it measures from, because the first week with an easy run is
   * rarely the first week of the period.
   */
  const trend = useMemo(() => {
    const first = rows.find((row) => row.overall !== undefined);
    if (!first || !latest || first === latest) {
      return null;
    }
    if (latest.weekStartMs - first.weekStartMs < MIN_TREND_SPAN_MS) {
      return null;
    }
    return {
      since: first.label,
      deltaPct: ((latest.overall! - first.overall!) / first.overall!) * 100
    };
  }, [latest, rows]);

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">Aerobic efficiency</p>
          <h3>
            {latest?.overall !== undefined ? latest.overall.toFixed(2) : "—"}
            <span className="run-block-sub"> m per minute per beat</span>
          </h3>
        </div>
        <p className="run-block-aside">
          {easyOnly ? "Easy runs" : "All runs"} over 20 minutes
          {hasZones && !easyOnly ? " · no easy sessions to compare" : ""}
          {trend ? (
            <>
              {" · "}
              <strong className={trend.deltaPct >= 0 ? "tone-up" : "tone-down"}>
                {trend.deltaPct >= 0 ? "+" : ""}
                {trend.deltaPct.toFixed(1)}%
              </strong>{" "}
              since {trend.since}
            </>
          ) : null}
        </p>
      </header>

      {hasAny ? (
        <div className="run-block-split">
          <div className="run-block-plot">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: colors.text, fontSize: 11 }}
                  stroke={colors.grid}
                  minTickGap={24}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fill: colors.text, fontSize: 11 }}
                  stroke={colors.grid}
                  tickFormatter={(value: number) => value.toFixed(2)}
                />
                {drawn.map((surface) => (
                  <Line
                    key={surface}
                    dataKey={surface}
                    type="monotone"
                    stroke={palette[surface]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                {drawn.length === 0 ? (
                  <Line
                    dataKey="overall"
                    type="monotone"
                    stroke={colors.accentBright}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ) : null}
                <Tooltip
                  cursor={{ stroke: colors.cursor }}
                  contentStyle={trainingChartTooltipStyle}
                  formatter={(value) =>
                    typeof value === "number" ? value.toFixed(2) : String(value ?? "")
                  }
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="run-block-plot">
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="hr"
                  name="HR"
                  domain={["dataMin - 5", "dataMax + 5"]}
                  tick={{ fill: colors.text, fontSize: 11 }}
                  stroke={colors.grid}
                  unit=" bpm"
                />
                {/* Pace runs the other way so the fast runs sit at the top,
                    which is the direction an athlete reads improvement in. */}
                <YAxis
                  type="number"
                  dataKey="pace"
                  name="Pace"
                  reversed
                  domain={["dataMin - 20", "dataMax + 20"]}
                  tick={{ fill: colors.text, fontSize: 11 }}
                  stroke={colors.grid}
                  tickFormatter={(value: number) =>
                    formatDisplayPace(value)
                  }
                />
                <ZAxis range={[26, 26]} />
                {surfaces.map((surface) => (
                  <Scatter
                    key={surface}
                    data={scatterBySurface.get(surface) ?? []}
                    fill={palette[surface]}
                    fillOpacity={0.55}
                    isAnimationActive={false}
                  />
                ))}
                <Tooltip
                  cursor={{ strokeDasharray: "3 3", stroke: colors.cursor }}
                  content={(props: TooltipContentProps) => (
                    <ScatterTooltip {...props} unitSystem={unitSystem} />
                  )}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="run-block-empty">
          No runs over 20 minutes with a heart rate in this window, so there is
          nothing to compare yet.
        </p>
      )}
    </section>
  );
}

function ScatterTooltip({
  active,
  payload,
  unitSystem
}: TooltipContentProps & { unitSystem: UnitSystem }) {
  if (!active || !payload?.length) {
    return null;
  }
  const point = payload[0]?.payload as ScatterPoint | undefined;
  if (!point) {
    return null;
  }

  return (
    <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
      <span>{point.name}</span>
      <strong>
        {formatDisplayPace(point.pace)} /{distanceUnit(unitSystem)}
      </strong>
      <span>
        {point.hr} bpm · {RUN_SURFACE_LABELS[point.surface]}
      </span>
    </div>
  );
}
