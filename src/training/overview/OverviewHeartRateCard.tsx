import { useMemo, useState } from "react";
import { HeartPulse } from "lucide-react";
import { OptionGroup } from "../../components/OptionGroup";
import { formatCount, formatDecimal, t } from "../../i18n/core";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../../electron/types";
import type { TrainingHubSnapshot } from "../types";
import type { HeartRateZoneModel } from "../heartRateZoneModel";
import {
  overviewEnduranceActivities,
  overviewEnduranceZones,
} from "./overviewEnduranceZones";
import { formatHeartRateZoneRange, heartRateZoneCaption } from "../heartRateZoneModel";
import { formatDurationSpan, getLocalHappenDayKey } from "../formatters";
import { zoneColor } from "../components/routeColoring";

export function OverviewHeartRateCard({
  snapshot,
  activities,
  model,
  loading,
  summaries,
  summariesLoading,
}: {
  snapshot: TrainingHubSnapshot | null;
  activities: TrainingHubActivity[];
  model: HeartRateZoneModel | null;
  loading: boolean;
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  summariesLoading: boolean;
}) {
  const [metric, setMetric] = useState<"time" | "trainingLoad">("time");
  const zones = useMemo(
    () => [...(model?.zones ?? snapshot?.dashboard?.lthrZones ?? [])]
      .sort((a, b) => a.index - b.index),
    [model, snapshot?.dashboard?.lthrZones],
  );
  const today = getLocalHappenDayKey();
  const endurance = useMemo(
    () => overviewEnduranceActivities(activities),
    [activities, today],
  );
  const distribution = useMemo(
    () => overviewEnduranceZones(
      loading || summariesLoading ? [] : endurance, summaries, zones, metric,
    ),
    [endurance, summaries, zones, metric, loading, summariesLoading],
  );
  const data =
    distribution.total > 0
      ? distribution.entries.map((z) => ({
          ...z,
          zoneIndex: z.index + 1,
          label: t("overview.zones.zone", { n: z.index + 1 }),
          color: zoneColor(z.index),
          detail:
            metric === "time"
              ? formatDurationSpan(z.value)
              : formatCount(Math.round(z.value)),
          range: formatHeartRateZoneRange(zones, zones[z.index].index),
        }))
      : [];
  const top = [...data].sort((a, b) => b.percent - a.percent)[0];
  return (
    <section
      className="panel overview-hr"
      aria-busy={loading || summariesLoading}
    >
      <div className="overview-hr-intro">
        <p className="eyebrow">
          <HeartPulse size={14} />
          {model?.title ?? t("overview.zones.lthr.title")}
        </p>
        {model?.anchorNote && <p className="overview-caption">{model.anchorNote}</p>}
        {top ? (
          <>
            <strong className="overview-hr-dominant">
              {formatDecimal(top.percent, 0)}
              <small>%</small>
            </strong>
            <h3>
              {top.label} · {heartRateZoneCaption(top.zoneIndex)}
            </h3>
            <p className="overview-caption">
              {t("overview.zones.fourWeeks")} ·{" "}
              {metric === "time"
                ? t("overview.zones.time")
                : t("overview.trainingLoad")}
            </p>
            <div className="overview-hr-segments" aria-hidden="true">
              {data.map((z) => (
                <i
                  key={z.zoneIndex}
                  style={{ flex: z.percent, background: z.color }}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="overview-empty">
            {loading || summariesLoading
              ? t("overview.zones.reading")
              : t("overview.zones.hrEmpty")}
          </p>
        )}
        <p className="overview-caption" role="status">
          {t("overview.briefing.enduranceOnly")}
          {distribution.estimated > 0 && (
            <> {t("overview.briefing.avgHr", { count: formatCount(distribution.estimated) })}</>
          )}
          {metric === "trainingLoad" && (
            <> {t("overview.briefing.loadAllocation")}</>
          )}
          {!summariesLoading && distribution.unplaced > 0 && (
            <>
              {" "}
              {t("overview.briefing.unplaced", {
                count: distribution.unplaced,
              })}
            </>
          )}
        </p>
      </div>
      <div className="overview-hr-details">
        <header>
          <span className="overview-caption">
            {t("overview.zones.distribution")}
          </span>
          <OptionGroup
            label={t("overview.zones.hrMetric")}
            value={metric}
            options={[
              { value: "time", label: t("overview.zones.time") },
              { value: "trainingLoad", label: t("overview.trainingLoad") },
            ]}
            onChange={setMetric}
          />
        </header>
        {data.map((z) => (
          <div className="overview-hr-row" key={z.zoneIndex}>
            <span style={{ color: z.color }}>Z{z.zoneIndex}</span>
            <div>
              <strong>{heartRateZoneCaption(z.zoneIndex)}</strong>
              <small>{z.range ?? t("overview.noData")}</small>
            </div>
            <i>
              <b style={{ width: `${z.percent}%`, background: z.color }} />
            </i>
            <strong>{z.detail}</strong>
            <small>{formatDecimal(z.percent, 0)}%</small>
          </div>
        ))}
      </div>
    </section>
  );
}
