import { useId, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import type { TrainingHubSnapshot } from "../types";
import { mergeTrainingDayLists } from "../parsers";
import { getLocalHappenDayKey } from "../formatters";
import { formatCount, formatDecimal, t } from "../../i18n/core";
import { overviewStatusTrend } from "./overviewModel";
import { OverviewChartTooltip, type ChartAnchor } from "./OverviewChartTooltip";
import {
  OverviewCardHeader,
  OverviewStat,
  overviewDate,
} from "./OverviewParts";

export function OverviewTrainingStatus({
  snapshot,
  loading = false,
}: {
  snapshot: TrainingHubSnapshot | null;
  loading?: boolean;
}) {
  const today = getLocalHappenDayKey();
  const tooltipId = useId();
  const [probe, setProbe] = useState<{
    index: number;
    anchor: ChartAnchor;
  } | null>(null);
  const days = useMemo(
    () =>
      mergeTrainingDayLists(
        snapshot?.dailyMetrics ?? null,
        snapshot?.analytics ?? null,
      )
        .filter((day) => day.happenDay <= today),
    [snapshot, today],
  );
  const latest =
    [...days]
      .reverse()
      .find((day) =>
        [day.cti, day.ati, day.trainingLoadRatio].some(
          (v) => v !== undefined && Number.isFinite(v),
        ),
      ) ?? days.at(-1);
  const ratio =
    latest?.trainingLoadRatio !== undefined && Number.isFinite(latest.trainingLoadRatio)
      ? latest.trainingLoadRatio
      : undefined;
  const fresh = latest?.happenDay === today;
  const trend = useMemo(() => overviewStatusTrend(days, today), [days, today]);
  const hasTrend = trend.some(
    (point) =>
      point.baseFitness !== undefined || point.loadImpact !== undefined,
  );
  const all = trend.flatMap((p) =>
    [p.baseFitness, p.loadImpact].filter((v): v is number => v !== undefined),
  );
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all) * 1.1;
  const y = (value: number) => 100 - ((value - min) / (max - min)) * 84;
  const figure = (value?: number) =>
    value !== undefined && Number.isFinite(value)
      ? formatCount(Math.round(value))
      : "—";
  const probeAt = (svg: SVGSVGElement, x: number, y: number) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const local = point.matrixTransform(matrix.inverse());
    setProbe({
      index: Math.max(0, Math.min(27, Math.round(((local.x - 34) / 394) * 27))),
      anchor: { x, y },
    });
  };
  const focusDay = (svg: SVGSVGElement, index: number) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = 34 + (index / 27) * 394;
    point.y = 16;
    const anchor = point.matrixTransform(matrix);
    setProbe({ index, anchor: { x: anchor.x, y: anchor.y } });
  };
  const selected = probe ? trend[probe.index] : undefined;
  const selectedDay = days.find((day) => day.happenDay === selected?.day);
  const label =
    !fresh || ratio === undefined
      ? t("overview.briefing.noStatus")
      : ratio < 0.85
        ? t("activity.load.backingOff")
        : ratio > 1.15
          ? t("activity.load.rampingUp")
          : t("activity.load.steady");
  return (
    <section className="panel overview-status" aria-busy={loading}>
      <OverviewCardHeader
        title={t("overview.briefing.status")}
        icon={<TrendingUp size={14} />}
      />
      <h3>{loading ? t("common.loading") : label}</h3>
      <p className="overview-caption">
        {latest
          ? t("overview.briefing.asOf", {
              date: overviewDate(latest.happenDay),
            })
          : t("overview.briefing.noStatus")}
      </p>
      <div className="overview-status-metrics">
        <OverviewStat
          label={t("calendar.week.baseFitness")}
          value={figure(latest?.cti)}
        />
        <OverviewStat
          label={t("calendar.week.loadImpact")}
          value={figure(latest?.ati)}
        />
        <OverviewStat
          label={t("calendar.week.loadRatio")}
          value={ratio !== undefined ? formatDecimal(ratio, 2) : "—"}
          unit={ratio !== undefined ? "×" : undefined}
        />
      </div>
      {hasTrend ? (
        <svg
          className="overview-status-chart"
          viewBox="0 0 440 125"
          role="group"
          tabIndex={0}
          aria-describedby={probe ? tooltipId : undefined}
          aria-label={`${t("calendar.week.baseFitness")} / ${t("calendar.week.loadImpact")}`}
          onPointerMove={(e) => probeAt(e.currentTarget, e.clientX, e.clientY)}
          onPointerLeave={() => setProbe(null)}
          onFocus={(e) => focusDay(e.currentTarget, 27)}
          onBlur={() => setProbe(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setProbe(null);
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              focusDay(
                e.currentTarget,
                Math.max(
                  0,
                  Math.min(
                    27,
                    (probe?.index ?? 27) + (e.key === "ArrowLeft" ? -1 : 1),
                  ),
                ),
              );
            }
          }}
        >
          {[0, 0.5, 1].map((p) => (
            <g key={p}>
              <line x1="34" x2="428" y1={100 - p * 84} y2={100 - p * 84} />
              <text x="27" y={103 - p * 84} textAnchor="end">
                {figure(min + p * (max - min))}
              </text>
            </g>
          ))}
          {(["baseFitness", "loadImpact"] as const).map((key, j) => {
            const segments: string[][] = [];
            let segment: string[] = [];
            trend.forEach((point, i) => {
              const value = point[key];
              if (value === undefined) {
                if (segment.length) segments.push(segment);
                segment = [];
              } else segment.push(`${34 + (i / 27) * 394},${y(value)}`);
            });
            if (segment.length) segments.push(segment);
            return (
              <g key={key}>
                {segments.map((points, i) => (
                  <polyline
                    key={`${key}-${i}`}
                    points={points.join(" ")}
                    fill="none"
                    stroke={j ? "var(--accent)" : "var(--sport-run)"}
                    strokeWidth="2"
                    strokeDasharray={j ? "4 4" : undefined}
                  />
                ))}
                {trend.map((point, i) =>
                  point[key] === undefined ? null : (
                    <circle
                      key={point.day}
                      cx={34 + (i / 27) * 394}
                      cy={y(point[key]!)}
                      r="2"
                      fill={j ? "var(--accent)" : "var(--sport-run)"}
                    >
                      <title>
                        {overviewDate(point.day)} ·{" "}
                        {j
                          ? t("calendar.week.loadImpact")
                          : t("calendar.week.baseFitness")}
                        : {figure(point[key])}
                      </title>
                    </circle>
                  ),
                )}
              </g>
            );
          })}
          {[0, 13, 27].map((i) => (
            <text
              key={i}
              x={34 + (i / 27) * 394}
              y="121"
              textAnchor={i === 0 ? "start" : i === 27 ? "end" : "middle"}
            >
              {overviewDate(trend[i].day)}
            </text>
          ))}
          {probe && (
            <line
              className="overview-status-guide"
              x1={34 + (probe.index / 27) * 394}
              x2={34 + (probe.index / 27) * 394}
              y1="12"
              y2="100"
              strokeDasharray="3 3"
            />
          )}
          <rect x="0" y="0" width="440" height="125" fill="transparent" />
        </svg>
      ) : (
        <p className="overview-empty">{t("overview.noData")}</p>
      )}
      {probe && selected && hasTrend && (
        <OverviewChartTooltip id={tooltipId} anchor={probe.anchor} onDismiss={() => setProbe(null)}>
          <strong>{overviewDate(selected.day)}</strong>
          <dl>
            <div>
              <dt>{t("calendar.week.baseFitness")}</dt>
              <dd>{figure(selected.baseFitness)}</dd>
            </div>
            <div>
              <dt>{t("calendar.week.loadImpact")}</dt>
              <dd>{figure(selected.loadImpact)}</dd>
            </div>
            <div>
              <dt>{t("calendar.week.loadRatio")}</dt>
              <dd>
                {selectedDay?.trainingLoadRatio !== undefined && Number.isFinite(selectedDay.trainingLoadRatio)
                  ? formatDecimal(selectedDay.trainingLoadRatio, 2)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("overview.trainingLoad")}</dt>
              <dd>{figure(selectedDay?.trainingLoad)}</dd>
            </div>
          </dl>
        </OverviewChartTooltip>
      )}
      <div className="overview-chart-legend">
        <span>{t("calendar.week.baseFitness")}</span>
        <span>{t("calendar.week.loadImpact")}</span>
      </div>
      <p className="overview-status-footer">
        {t("overview.sleepTrend.lastDays", { days: 28 })}
      </p>
    </section>
  );
}
