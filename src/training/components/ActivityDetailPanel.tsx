import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, CloudOff, Loader2, RefreshCw, X } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubSportType
} from "../../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatOptionalNumber,
  formatPaceSecondsPerKm,
  formatTrainingTimestamp
} from "../formatters";
import { isSpeedSport, isSwimSportType, resolveSportName } from "../sportTypes";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import type { TrainingHubDetailRequest } from "../types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatSpeedValue } from "../../units/units";
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { StrengthDetailPanel } from "./StrengthDetailPanel";
import { t } from "../../i18n/core";

interface ActivityDetailPanelProps {
  detail: TrainingHubActivityDetail | null;
  listActivity: TrainingHubActivity | null;
  sportTypes: TrainingHubSportType[];
  busy?: string | null;
  embedded?: boolean;
  /**
   * Where the latest detail request stands. Optional because the Calendar's day
   * pane fetches its own detail and tracks it locally; without it the panel
   * falls back to reading `busy`, which cannot tell a failure from a load that
   * is still running.
   */
  detailRequest?: TrainingHubDetailRequest | null;
  /** Retries the activity whose detail failed. */
  onRetry?: (activity: TrainingHubActivity) => void;
  /**
   * Only the raw-JSON modal needs this, and only on a development build: the
   * payload is ~2.2 MB and no longer rides along on `detail`. Without an api
   * the button is not offered.
   */
  api?: HeraclesRecordsApi | null;
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="activity-detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function hasPopulatedLaps(detail: TrainingHubActivityDetail): boolean {
  return detail.laps.some(
    (lap) =>
      (lap.distance !== undefined && lap.distance > 0) ||
      (lap.duration !== undefined && lap.duration > 0)
  );
}

export function ActivityDetailPanel({
  detail,
  listActivity,
  sportTypes,
  busy = null,
  embedded = false,
  detailRequest = null,
  onRetry,
  api = null
}: ActivityDetailPanelProps) {
  const { unitSystem } = useUnitSystem();
  const [showRaw, setShowRaw] = useState(false);
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const rawAvailable = import.meta.env.DEV && Boolean(api);
  const detailActivityId = detail?.activityId ?? listActivity?.activityId;
  const detailSportType = detail?.sportType ?? listActivity?.sportType;

  const openRaw = useCallback(async () => {
    if (!api || detailActivityId === undefined) {
      return;
    }

    setShowRaw(true);
    setRaw(null);
    setRawError(null);
    try {
      setRaw(
        await api.getTrainingHubActivityDetailRaw(
          detailActivityId,
          detailSportType ?? 0
        )
      );
    } catch (caught) {
      setRawError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [api, detailActivityId, detailSportType]);
  const sportName = useMemo(() => {
    if (detail) {
      return resolveSportName(detail, sportTypes);
    }

    if (listActivity) {
      return resolveSportName(listActivity, sportTypes);
    }

    return undefined;
  }, [detail, listActivity, sportTypes]);

  useEffect(() => {
    if (!showRaw) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRaw(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showRaw]);

  const request =
    detailRequest && detailRequest.activityId === listActivity?.activityId
      ? detailRequest
      : null;
  const isLoading = listActivity
    ? request
      ? request.status === "pending" && !detail
      : busy === `training-detail:${listActivity.activityId}` && !detail
    : false;
  const hasFailed = Boolean(listActivity) && request?.status === "failed";

  const panelClassName = embedded
    ? "training-activities-detail-inner"
    : "panel training-detail-panel";

  if (hasFailed && listActivity) {
    return (
      <div className={panelClassName}>
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">{t("activity.panel.eyebrow")}</p>
            <h2>{listActivity.name ?? t("activity.selected")}</h2>
          </div>
        </div>
        <div className="training-empty-state">
          <CloudOff size={20} aria-hidden="true" />
          <p>{t("activity.detailMissing")}</p>
          {onRetry ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onRetry(listActivity)}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t("common.tryAgain")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={panelClassName}>
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">{t("activity.panel.eyebrow")}</p>
            <h2>{listActivity?.name ?? t("activity.selected")}</h2>
          </div>
        </div>
        <div className="training-detail-loading">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <p>{t("activity.panel.loading")}</p>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={panelClassName}>
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">{t("activity.panel.eyebrow")}</p>
            <h2>{t("activity.panel.select")}</h2>
          </div>
        </div>
        <div className="training-empty-state">
          <p>{t("activity.panel.hint")}</p>
        </div>
      </div>
    );
  }

  const startTime = detail.startTime ?? listActivity?.startTime;
  const showLaps = hasPopulatedLaps(detail);
  const swim = isSwimSportType(detail.sportType ?? listActivity?.sportType);
  // A ride and a hike are read in km/h; see `isSpeedSport`.
  const readsSpeed = isSpeedSport(detail.sportType ?? listActivity?.sportType, sportName);
  const distance = detail.distance ?? listActivity?.distance;
  const duration = detail.duration ?? listActivity?.duration;
  const performance = distance && duration
    ? readsSpeed
      ? formatSpeedValue((distance / 1000) / (duration / 3600), unitSystem)
      : !swim
        ? formatPaceSecondsPerKm(duration / (distance / 1000), unitSystem)
        : undefined
    : undefined;

  return (
    <div className={panelClassName}>
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">{t("activity.panel.eyebrow")}</p>
          <h2>{detail.name ?? listActivity?.name ?? t("activity.selected")}</h2>
          {(sportName || startTime) && (
            <div className="activity-detail-meta">
              {sportName ? (
                <span className="activity-detail-sport">{sportName}</span>
              ) : null}
              {startTime ? (
                <span>{formatTrainingTimestamp(startTime)}</span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {detail.strength ? (
        <StrengthDetailPanel strength={detail.strength} />
      ) : (
        <>
          <div className="activity-detail-grid">
            <DetailStat
              label={t("activity.m.duration")}
              value={formatDurationSeconds(detail.duration)}
            />
            <DetailStat
              label={t("activity.m.distance")}
              value={formatDistanceMeters(detail.distance, unitSystem, swim)}
            />
            {performance ? (
              <DetailStat label={readsSpeed ? t("activity.m.avgSpeed") : t("activity.m.avgPace")} value={performance} />
            ) : null}
            <DetailStat label={t("activity.m.avgHr")} value={formatOptionalNumber(detail.avgHr)} />
            <DetailStat label={t("activity.m.maxHr")} value={formatOptionalNumber(detail.maxHr)} />
            <DetailStat
              label={t("activity.m.calories")}
              value={formatOptionalNumber(detail.calories)}
            />
            <DetailStat
              label={t("activity.m.elevation")}
              value={formatElevationMeters(detail.elevationGain, unitSystem)}
            />
            <DetailStat
              label={t("activity.m.trainingLoad")}
              value={formatOptionalNumber(detail.trainingLoad)}
            />
          </div>

          <div className="activity-detail-visuals">
            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>{t("activity.m.route")}</h3>
              </div>
              <ActivityRouteMap track={detail.track} detail={detail} />
            </section>

            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>{t("activity.m.elevation")}</h3>
              </div>
              <ActivityElevationChart track={detail.track} />
            </section>
          </div>

          {showLaps ? (
            <div className="training-laps-section">
              <h3>{t("activity.m.laps")}</h3>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("activity.m.duration")}</th>
                      <th>{t("activity.m.distance")}</th>
                      <th>{t("activity.m.avgHr")}</th>
                      <th>{t("activity.m.maxHr")}</th>
                      <th>{t("activity.m.elevShort")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.laps.map((lap) => (
                      <tr key={lap.index}>
                        <td>{lap.index}</td>
                        <td>{formatDurationSeconds(lap.duration)}</td>
                        <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                        <td>{formatOptionalNumber(lap.avgHr)}</td>
                        <td>{formatOptionalNumber(lap.maxHr)}</td>
                        <td>{formatElevationMeters(lap.elevationGain, unitSystem)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}

      {rawAvailable ? (
        <div className="training-raw-toggle">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void openRaw()}
          >
            {t("activity.raw.show")}
          </button>
        </div>
      ) : null}

      {showRaw &&
        createPortal(
          <div
            className="training-raw-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-raw-modal-title"
            onClick={() => setShowRaw(false)}
          >
            <section
              className="panel training-raw-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="training-raw-modal-header">
                <div className="training-raw-modal-title">
                  <Braces size={16} aria-hidden="true" />
                  <h2 id="training-raw-modal-title">{t("activity.raw.title")}</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("activity.raw.close")}
                  onClick={() => setShowRaw(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div className="training-raw-modal-body">
                {rawError ? (
                  <p className="training-raw-json">{rawError}</p>
                ) : raw ? (
                  <pre className="training-raw-json">
                    {JSON.stringify(raw, null, 2)}
                  </pre>
                ) : (
                  <div className="training-detail-loading">
                    <Loader2 className="spin" size={18} aria-hidden="true" />
                    <p>{t("activity.raw.fetching")}</p>
                  </div>
                )}
              </div>
            </section>
          </div>,
          document.body
        )}
    </div>
  );
}
