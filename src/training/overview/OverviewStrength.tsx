import "../../strength/strength.css";
import { useMemo } from "react";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import type { SportScreen } from "../../navigation/sportScreens";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatCount, plural, t } from "../../i18n/core";
import { formatDurationSpan, getLocalHappenDayKey } from "../formatters";
import { useStrengthData } from "../../strength/useStrengthData";
import {
  buildStrengthAnalytics,
  formatVolumeKg,
} from "../../strength/strengthAnalytics";
import { StrengthHero } from "../../strength/StrengthHero";
import { OVERVIEW_DAYS, overviewActivities } from "./overviewModel";
import { OverviewSportSection } from "./OverviewSports";
import { OverviewStat } from "./OverviewParts";

export function OverviewStrength({
  api,
  connected,
  onOpen,
}: {
  api: HeraclesRecordsApi;
  connected: boolean;
  onOpen?: (sport: SportScreen) => void;
}) {
  const data = useStrengthData({
    api,
    corosConnected: connected,
    windowDays: OVERVIEW_DAYS,
  });
  const { unitSystem } = useUnitSystem();
  const today = getLocalHappenDayKey();
  const analytics = useMemo(
    () =>
      buildStrengthAnalytics(
        overviewActivities(data.sessions),
        OVERVIEW_DAYS,
      ),
    [data.sessions, today],
  );
  if (
    !data.initializing &&
    !data.error &&
    data.sessions.length === 0 &&
    data.pending === 0
  )
    return null;
  return (
    <OverviewSportSection sport="strength" onOpen={onOpen}>
      {data.error && data.sessions.length === 0 ? (
        <p className="overview-empty" role="alert">
          {data.error}
        </p>
      ) : (data.initializing || data.pending > 0) && data.sessions.length === 0 ? (
        <p className="overview-empty" role="status">
          {data.pending > 0 ? plural("strength.pending", data.pending) : t("strength.readingSessions")}
        </p>
      ) : (
        <>
          {data.error && (
            <p role="alert" className="strength-notice is-error">
              {data.error}
            </p>
          )}
          {data.pending > 0 && (
            <p role="status" className="strength-notice">
              {plural("strength.pending", data.pending)}
            </p>
          )}
          {data.warnings.map((warning) => (
            <p key={warning} role="status" className="strength-notice">{warning}</p>
          ))}
          <div className="overview-sport-metrics overview-strength-metrics">
            <OverviewStat
              label={`${t("strength.summary.lifted")} · ${t("overview.sleepTrend.lastDays", { days: OVERVIEW_DAYS })}`}
              value={formatVolumeKg(analytics.summary.volumeKg, unitSystem)}
            />
            <OverviewStat
              label={t("strength.summary.sets")}
              value={formatCount(analytics.summary.sets)}
            />
            <OverviewStat
              label={t("strength.summary.sessions")}
              value={formatCount(analytics.summary.sessions)}
            />
            <OverviewStat
              label={t("strength.summary.time")}
              value={formatDurationSpan(analytics.summary.durationSec)}
            />
          </div>
          <div className="overview-strength-distribution strength-theme">
            <StrengthHero analytics={analytics} source={data.source} />
          </div>
        </>
      )}
    </OverviewSportSection>
  );
}
