import { useMemo } from "react";
import type { TrainingHubActivity, TrainingHubThresholdZone } from "../../../electron/types";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import { MotionFigure } from "../../motion/MotionFigure";
import { zoneName } from "../../i18n/zoneNames";
import { formatDurationSpan } from "../../training/formatters";
import { formatHeartRateZoneRange, type HeartRateZoneModel } from "../../training/heartRateZoneModel";
import { zoneNamesFor } from "../../training/zoneTime";
import { useActivityDetailSummariesState } from "../../training/useActivityDetailSummaries";
import {
  heartRateSessions,
  intensityShares,
  zoneShares,
  zoneTimeEntries
} from "../../training/overview/distributionModel";
import { useI18n } from "../../i18n/useI18n";
import { PeriodControl, usePeriod } from "./trendParts";
import { ZoneRows, sharePercent } from "./ZoneRows";

/** Four weeks or three months: each session's detail is read for its zones. */
const EXERCISE_PERIODS = [28, 90] as const;
type ExercisePeriod = (typeof EXERCISE_PERIODS)[number];

interface ExerciseZonesPanelProps {
  api: HeraclesRecordsApi | null;
  activities: readonly TrainingHubActivity[];
  zoneModel: HeartRateZoneModel | null;
  lthrZones: TrainingHubThresholdZone[];
}

/**
 * Time in each of the athlete's own heart-rate zones over the period's
 * sessions, from each session's detail (COROS's seconds per zone), on the
 * account's zone model — the zones COROS scores it against. Only the sports
 * heart rate reads well count (`isHeartRateSport`), as on Overview.
 */
export function ExerciseZonesPanel({ api, activities, zoneModel, lthrZones }: ExerciseZonesPanelProps) {
  const { t, plural } = useI18n();
  const [period, choose] = usePeriod<ExercisePeriod>(28);
  const sessions = useMemo(() => heartRateSessions(activities, new Date(), period), [activities, period]);
  const { summaries, settled } = useActivityDetailSummariesState({ api, activities: sessions, enabled: true });
  const zoneTime = useMemo(() => zoneTimeEntries(sessions, summaries), [sessions, summaries]);
  const byZone = useMemo(() => zoneShares(zoneTime.entries), [zoneTime]);
  const family = zoneModel?.family ?? "lthr";
  const zones = zoneModel?.zones ?? lthrZones;
  const names = zoneNamesFor(family);
  const split = intensityShares(byZone.rows, family);

  return (
    <section className="panel stress-trend-panel heart-zones-panel">
      <div className="stress-trend-head">
        <h2 className="stress-pane-title">
          {t("heart.exercise.title")}
          {zoneModel ? <span className="heart-zones-model"> · {zoneModel.label}</span> : null}
        </h2>
        <PeriodControl periods={EXERCISE_PERIODS} value={period} onChange={choose} />
      </div>

      <dl className="stress-trend-figures">
        <div>
          <dt>{t("heart.exercise.time")}</dt>
          <dd>
            <strong>
              <MotionFigure text={formatDurationSpan(byZone.total)} value={byZone.total} />
            </strong>
            <span>
              {zoneTime.read < zoneTime.total
                ? t("overview.distribution.zoneCoverage", { read: zoneTime.read, total: zoneTime.total })
                : plural("heart.exercise.sessions", zoneTime.total)}
            </span>
          </dd>
        </div>
        {(["easy", "hard"] as const).map((key) => (
          <div key={key} className={`is-${key}`}>
            <dt>{t(key === "easy" ? "heart.exercise.easy" : "heart.exercise.hard")}</dt>
            <dd>
              <strong>
                <MotionFigure text={byZone.rows.length > 0 ? sharePercent(split[key]) : "–"} value={split[key]} />
              </strong>
              <span>{t(key === "easy" ? "heart.exercise.easyNote" : "heart.exercise.hardNote")}</span>
            </dd>
          </div>
        ))}
      </dl>

      {byZone.rows.length > 0 ? (
        <ZoneRows
          label={t("heart.exercise.title")}
          rows={byZone.rows.map((row) => {
            const label = names?.[row.position];
            return {
              position: row.position,
              name: label ? zoneName(label) : t("overview.zones.zone", { n: row.position + 1 }),
              range: zones.length > 0 ? formatHeartRateZoneRange(zones, row.position) : undefined,
              seconds: row.value,
              share: row.share
            };
          })}
        />
      ) : (
        <p className="stress-day-note">
          {!settled && zoneTime.total > 0 ? t("overview.zones.reading") : t("heart.exercise.none")}
        </p>
      )}

      <p className="stress-day-note">{t("overview.distribution.sportsNote")}</p>
    </section>
  );
}
