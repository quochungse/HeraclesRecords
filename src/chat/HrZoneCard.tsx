import { memo, useMemo } from "react";
import { Heart } from "lucide-react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { ChartWhenNear } from "./charts/ChartWhenNear";
import type { TooltipContentProps } from "recharts";
import type { HrZonePreview } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds
} from "../training/formatters";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { formatHeartRateZoneRange } from "../training/heartRateZoneModel";
import { HEART_RATE_ZONE_COLORS } from "./charts/zoneChartConfig";
import type { UnitSystem } from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDecimal, messageRecord, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

interface HrZoneCardProps {
  preview: HrZonePreview;
}

const METRIC_LABELS = messageRecord<HrZonePreview["metric"]>({
  time: "chat.zones.metric.time",
  distance: "chat.zones.metric.distance",
  trainingLoad: "chat.zones.metric.load"
});

const METRIC_COLUMN_LABELS = messageRecord<HrZonePreview["metric"]>({
  time: "activity.m.duration",
  distance: "activity.m.distance",
  trainingLoad: "library.session.load"
});

interface ZoneRow {
  index: number;
  label: string;
  percent: number;
  value: number;
  detail: string;
  caption: string;
  hrRange: string;
  color: string;
}

function heartRateZoneCaption(zoneIndex: number): string {
  switch (zoneIndex) {
    case 0:
      return t("chat.zones.caption.0");
    case 1:
      return t("chat.zones.caption.1");
    case 2:
      return t("chat.zones.caption.2");
    case 3:
      return t("chat.zones.caption.3");
    case 4:
      return t("chat.zones.caption.4");
    case 5:
      return t("chat.zones.caption.5");
    case 6:
      return t("chat.zones.caption.6");
    default:
      return t("chat.zones.caption.other");
  }
}

function formatZoneMetricValue(
  value: number,
  metric: HrZonePreview["metric"],
  unitSystem: UnitSystem
): string {
  if (metric === "distance") {
    return formatDistanceMeters(value, unitSystem);
  }

  if (metric === "time") {
    if (value >= 3600) {
      return formatDurationSeconds(value);
    }

    return t("units.min", { m: Math.round(value / 60) });
  }

  return String(Math.round(value));
}

function formatPercent(value: number): string {
  return `${formatDecimal(value, 1)}%`;
}

function ZoneTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const entry = payload[0]?.payload as ZoneRow | undefined;

  if (!entry) {
    return null;
  }

  return (
    <div className="training-zone-tooltip">
      <span>{entry.label}</span>
      <strong>{formatPercent(entry.percent)}</strong>
      <em>{entry.detail}</em>
    </div>
  );
}

/** Memoised on `preview`, as `ActivityVisualCard` is and for the same reason. */
export const HrZoneCard = memo(function HrZoneCard({ preview }: HrZoneCardProps) {
  const { locale } = useI18n();
  const { unitSystem } = useUnitSystem();
  const rows = useMemo((): ZoneRow[] => {
    return preview.zones.map((zone, index) => ({
      index: zone.index,
      label: zone.label,
      percent: zone.percent,
      value: zone.value,
      detail: formatZoneMetricValue(zone.value, preview.metric, unitSystem),
      caption: heartRateZoneCaption(zone.index),
      hrRange: formatHeartRateZoneRange(preview.lthrZones, zone.index),
      color: HEART_RATE_ZONE_COLORS[index % HEART_RATE_ZONE_COLORS.length]
    }));
  }, [locale, preview, unitSystem]);

  const chartData = rows.filter((row) => row.percent > 0);
  const topZone = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }

    return [...rows].sort((left, right) => right.percent - left.percent)[0];
  }, [rows]);

  const activeZones = rows.filter((row) => row.percent > 0).length;

  return (
    <div className="chat-visual-card chat-zone-card">
      <div className="chat-visual-card-header">
        <div>
          <h4>{t("chat.zones.title")}</h4>
          <span className="chat-visual-card-subtitle">
            {METRIC_LABELS[preview.metric]} · {t("chat.zones.last4")}
          </span>
        </div>
        {topZone ? (
          <div className="chat-visual-stats">
            <span className="chat-visual-stat">
              {t("chat.zones.primary")} <strong>{topZone.label}</strong>
            </span>
            <span className="chat-visual-stat">
              {t("chat.zones.active")} <strong>{activeZones}</strong>
            </span>
          </div>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="chat-zone-body">
          <div className="chat-zone-top">
            <div className="chat-zone-donut-wrap">
              <div className="chat-zone-donut" aria-hidden="true">
                {chartData.length > 0 ? (
                  <ChartWhenNear>
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="percent"
                        nameKey="label"
                        innerRadius="58%"
                        outerRadius="88%"
                        paddingAngle={2}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {chartData.map((entry) => (
                          <Cell key={entry.index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={(props) => <ZoneTooltip {...props} />}
                        contentStyle={trainingChartTooltipStyle}
                      />
                    </PieChart>
                  </ChartWhenNear>
                ) : (
                  <div className="chat-zone-empty-ring" />
                )}
              </div>
              <span className="chat-zone-donut-icon">
                <Heart size={22} strokeWidth={2.2} aria-hidden="true" />
              </span>
            </div>

            {topZone ? (
              <div className="chat-zone-hero">
                <p className="chat-zone-hero-kicker">{t("chat.zones.primaryZone")}</p>
                <h3>{topZone.label}</h3>
                <p className="chat-zone-hero-percent">
                  {formatPercent(topZone.percent)}
                </p>
                <p className="chat-zone-hero-detail">{topZone.detail}</p>
                <p className="chat-zone-hero-caption">{topZone.caption}</p>
                {topZone.hrRange !== "—" ? (
                  <p className="chat-zone-hero-range">{topZone.hrRange}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="chat-zone-table">
            <div className="chat-zone-table-head">
              <span>{t("profile.zones.zone")}</span>
              <span>{t("chat.zones.range")}</span>
              <span aria-hidden="true" />
              <span>%</span>
              <span>{METRIC_COLUMN_LABELS[preview.metric]}</span>
            </div>
            <div className="chat-zone-list">
              {rows.map((row) => (
                <div className="chat-zone-row" key={row.index}>
                  <span className="chat-zone-name">{row.label}</span>
                  <span className="chat-zone-range">{row.hrRange}</span>
                  <span className="chat-zone-track" aria-hidden="true">
                    <span
                      className="chat-zone-fill"
                      style={{
                        width: `${Math.max(row.percent, row.percent > 0 ? 4 : 0)}%`,
                        backgroundColor: row.color
                      }}
                    />
                  </span>
                  <span className="chat-zone-percent">
                    {formatPercent(row.percent)}
                  </span>
                  <strong className="chat-zone-detail">{row.detail}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="chat-visual-empty">{t("chat.zones.none")}</p>
      )}
    </div>
  );
});
