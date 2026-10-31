import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { SwimStyle, TrainingHubSwimDetail, UnitSystem } from "../../electron/types";
import { secondsPer100m } from "../../electron/swimDetail";
import { OptionGroup } from "../components/OptionGroup";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { formatDurationSeconds } from "../training/formatters";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatPer100, formatPoolLength } from "./swimMetrics";
import { SWIM_STYLE_LABELS } from "./swimType";
import { SWIM_STYLE_COLORS } from "./swimColors";
import { formatDecimal, plural, t } from "../i18n/core";

/**
 * What each length is drawn by: its pace, its SWOLF, the strokes it took, or
 * the stroke rate. Pace is per 100 rather than the length's own seconds so a
 * drill logged at another distance stands on the same scale.
 */
type LengthMetric = "pace" | "swolf" | "strokes" | "rate";

const metricOptions = (): { value: LengthMetric; label: string }[] => [
  { value: "pace", label: t("activity.m.pace") },
  { value: "swolf", label: t("swim.m.swolf") },
  { value: "strokes", label: t("swim.m.strokes") },
  { value: "rate", label: t("swim.m.strokeRate") }
];

interface LengthRow {
  /** `length-12`, or `rest-12` for the rest before length 12: the x axis reads it. */
  key: string;
  index?: number;
  interval?: number;
  /**
   * The length's stroke. Not called `style`: recharts spreads a row onto its
   * bar, where a `style` string is React's style prop.
   */
  kind?: SwimStyle;
  seconds?: number;
  distance?: number;
  pace?: number;
  swolf?: number;
  strokes?: number;
  rate?: number;
  hr?: number;
  /** Seconds at the wall, on a rest's own slot. */
  rest?: number;
}

function valueOf(row: LengthRow, metric: LengthMetric): number | undefined {
  return row[metric];
}

function formatValue(metric: LengthMetric, value: number | undefined, unitSystem: UnitSystem): string {
  if (value === undefined) return "—";
  if (metric === "pace") return formatPer100(value, unitSystem);
  if (metric === "rate") return t("swim.rateValue", { value: Math.round(value) });
  return formatDecimal(value, 0);
}

/**
 * Every length of a pool swim, in the order it was swum, as a bar in its
 * stroke's colour — the swim as the watch counted it, turn by turn. A rest at
 * the wall is a gap the width of a length, so the sets stand apart the way they
 * did in the water. The line is the session's average over the lengths shown.
 */
export function SwimLengthsChart({ swim }: { swim: TrainingHubSwimDetail }) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const [metric, setMetric] = useState<LengthMetric>("pace");

  const rows = useMemo<LengthRow[]>(() => {
    const built: LengthRow[] = [];
    for (const length of swim.lengths) {
      if (length.restBefore !== undefined) {
        built.push({ key: `rest-${length.index}`, rest: length.restBefore });
      }
      built.push({
        key: `length-${length.index}`,
        index: length.index,
        ...(length.interval !== undefined ? { interval: length.interval } : {}),
        kind: length.style,
        seconds: length.seconds,
        distance: length.distance,
        ...(secondsPer100m(length.seconds, length.distance) !== undefined
          ? { pace: secondsPer100m(length.seconds, length.distance) }
          : {}),
        ...(length.swolf !== undefined ? { swolf: length.swolf } : {}),
        ...(length.strokes !== undefined ? { strokes: length.strokes } : {}),
        ...(length.strokeRate !== undefined ? { rate: length.strokeRate } : {}),
        ...(length.avgHr !== undefined ? { hr: length.avgHr } : {})
      });
    }
    return built;
  }, [swim]);

  const { average, floor, hasValues } = useMemo(() => {
    const values = rows.flatMap((row) => {
      const value = valueOf(row, metric);
      return value === undefined ? [] : [value];
    });
    if (values.length === 0) {
      return { average: undefined, floor: 0, hasValues: false };
    }
    const low = Math.min(...values);
    const high = Math.max(...values);
    // The pace line is the headline's — the lengths' seconds over their metres —
    // not a mean of paces, which lets a slow drill length weigh as much as a
    // fast hundred's.
    const meters = rows.reduce((sum, row) => sum + (row.distance ?? 0), 0);
    const seconds = rows.reduce((sum, row) => sum + (row.seconds ?? 0), 0);
    return {
      average:
        metric === "pace"
          ? secondsPer100m(seconds, meters)
          : values.reduce((sum, value) => sum + value, 0) / values.length,
      // Bars stand on a floor under the lowest length, not on zero: a 1:40 and
      // a 1:50 length differ by a tenth, which bars from zero would flatten away.
      floor: Math.max(0, low - (high - low) * 0.35 - (metric === "pace" ? 5 : 2)),
      hasValues: true
    };
  }, [metric, rows]);
  const { styles, fastest } = useMemo(
    () => ({
      styles: [...new Set(swim.lengths.map((length) => length.style))],
      fastest: swim.lengths.reduce<number | undefined>((best, length) => {
        const pace = secondsPer100m(length.seconds, length.distance);
        return length.style !== "drill" && pace !== undefined && (best === undefined || pace < best) ? pace : best;
      }, undefined)
    }),
    [swim]
  );

  return (
    <section className="panel run-detail-panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("swim.lengths.title")}</p>
          <h3>
            {plural("swim.lengths.count", swim.lengths.length)}
            {swim.poolLength !== undefined ? (
              <span className="run-block-sub">
                {" "}
                {t("swim.lengths.inPool", { pool: formatPoolLength(swim.poolLength, swim.poolUnit) })}
              </span>
            ) : null}
          </h3>
        </div>
        {fastest !== undefined ? (
          <p className="run-block-aside">
            {t("swim.lengths.fastest")} <strong>{formatPer100(fastest, unitSystem)}</strong>
          </p>
        ) : null}
      </header>

      <OptionGroup
        label={t("swim.lengths.metric")}
        value={metric}
        options={metricOptions()}
        onChange={(next) => setMetric(next as LengthMetric)}
      />

      {hasValues ? (
        <div className="run-block-plot">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="key"
                tick={{ fill: colors.text, fontSize: 11 }}
                stroke={colors.grid}
                // The tick's own row, not its position among the ticks drawn:
                // recharts thins them, and a rest's slot has no number.
                tickFormatter={(value: string) => (value.startsWith("length-") ? value.slice("length-".length) : "")}
                minTickGap={16}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: colors.text, fontSize: 11 }}
                stroke={colors.grid}
                width={52}
                domain={[floor, "auto"]}
                allowDataOverflow
                tickFormatter={(value: number) =>
                  metric === "pace" ? formatPer100(value, unitSystem).split(" ")[0]! : formatDecimal(value, 0)
                }
              />
              <Bar dataKey={metric} isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {rows.map((row) => (
                  <Cell key={row.key} fill={row.kind ? SWIM_STYLE_COLORS[row.kind] : "transparent"} fillOpacity={0.85} />
                ))}
              </Bar>
              {average !== undefined ? (
                <ReferenceLine y={average} stroke={colors.accentBright} strokeDasharray="4 3" />
              ) : null}
              <Tooltip
                cursor={{ fill: colors.cursorBand }}
                content={(props: TooltipContentProps) => (
                  <LengthTooltip {...props} unitSystem={unitSystem} />
                )}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="run-block-empty">{t("swim.lengths.noMetric")}</p>
      )}

      <div className="run-legend">
        {styles.map((style) => (
          <span key={style}>
            <i className="is-bar" style={{ background: SWIM_STYLE_COLORS[style] }} />
            {SWIM_STYLE_LABELS[style]}
          </span>
        ))}
        {average !== undefined ? (
          <span>
            <i className="is-dashed" style={{ background: colors.accentBright }} />
            {t("swim.lengths.average", { value: formatValue(metric, average, unitSystem) })}
          </span>
        ) : null}
      </div>
      <p className="run-block-note">{t("swim.lengths.note")}</p>
    </section>
  );
}

function LengthTooltip({
  active,
  payload,
  unitSystem
}: TooltipContentProps & { unitSystem: UnitSystem }) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload as LengthRow | undefined;
  if (!row) {
    return null;
  }
  if (row.rest !== undefined) {
    return (
      <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
        <strong>{t("swim.lengths.rest", { time: formatDurationSeconds(Math.round(row.rest)) })}</strong>
      </div>
    );
  }
  return (
    <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
      <span>
        {t("swim.lengths.length", { index: row.index ?? 0 })}
        {row.interval !== undefined ? ` · ${t("swim.sets.interval", { index: row.interval })}` : ""}
      </span>
      <strong style={{ color: row.kind ? SWIM_STYLE_COLORS[row.kind] : undefined }}>
        {row.kind ? SWIM_STYLE_LABELS[row.kind] : ""}
      </strong>
      <span>
        {formatDecimal(row.seconds ?? 0, 1)} s · {formatPer100(row.pace, unitSystem)}
      </span>
      {row.strokes !== undefined ? (
        <span>
          {t("swim.lengths.strokesSwolf", { strokes: row.strokes, swolf: row.swolf ?? "—" })}
        </span>
      ) : null}
      {row.rate !== undefined ? <span>{t("swim.rateValue", { value: row.rate })}</span> : null}
      {row.hr !== undefined ? <span>{row.hr} bpm</span> : null}
    </div>
  );
}
