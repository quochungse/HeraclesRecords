import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, Loader2, X } from "lucide-react";
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
import { isCyclingSportType, isSwimSportType, resolveSportName } from "../sportTypes";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatSpeedValue } from "../../units/units";
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { StrengthDetailPanel } from "./StrengthDetailPanel";

interface ActivityDetailPanelProps {
  detail: TrainingHubActivityDetail | null;
  listActivity: TrainingHubActivity | null;
  sportTypes: TrainingHubSportType[];
  busy?: string | null;
  embedded?: boolean;
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
  embedded = false
}: ActivityDetailPanelProps) {
  const { unitSystem } = useUnitSystem();
  const [showRaw, setShowRaw] = useState(false);
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

  const isLoading =
    listActivity &&
    busy === `training-detail:${listActivity.activityId}` &&
    !detail;

  const panelClassName = embedded
    ? "training-activities-detail-inner"
    : "panel training-detail-panel";

  if (isLoading) {
    return (
      <div className={panelClassName}>
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Activity Detail</p>
            <h2>{listActivity?.name ?? "Selected activity"}</h2>
          </div>
        </div>
        <div className="training-detail-loading">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <p>Loading activity…</p>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={panelClassName}>
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Activity Detail</p>
            <h2>Select an activity</h2>
          </div>
        </div>
        <div className="training-empty-state">
          <p>Click a row to view route, elevation, and lap data.</p>
        </div>
      </div>
    );
  }

  const startTime = detail.startTime ?? listActivity?.startTime;
  const showLaps = hasPopulatedLaps(detail);
  const swim = isSwimSportType(detail.sportType ?? listActivity?.sportType);
  const cycling =
    isCyclingSportType(detail.sportType ?? listActivity?.sportType) ||
    /bike|cycl|ride/i.test(sportName ?? "");
  const distance = detail.distance ?? listActivity?.distance;
  const duration = detail.duration ?? listActivity?.duration;
  const performance = distance && duration
    ? cycling
      ? formatSpeedValue((distance / 1000) / (duration / 3600), unitSystem)
      : !swim
        ? formatPaceSecondsPerKm(duration / (distance / 1000), unitSystem)
        : undefined
    : undefined;

  return (
    <div className={panelClassName}>
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Activity Detail</p>
          <h2>{detail.name ?? listActivity?.name ?? "Selected activity"}</h2>
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
              label="Duration"
              value={formatDurationSeconds(detail.duration)}
            />
            <DetailStat
              label="Distance"
              value={formatDistanceMeters(detail.distance, unitSystem, swim)}
            />
            {performance ? (
              <DetailStat label={cycling ? "Avg Speed" : "Avg Pace"} value={performance} />
            ) : null}
            <DetailStat label="Avg HR" value={formatOptionalNumber(detail.avgHr)} />
            <DetailStat label="Max HR" value={formatOptionalNumber(detail.maxHr)} />
            <DetailStat
              label="Calories"
              value={formatOptionalNumber(detail.calories)}
            />
            <DetailStat
              label="Elevation"
              value={formatElevationMeters(detail.elevationGain, unitSystem)}
            />
            <DetailStat
              label="Training Load"
              value={formatOptionalNumber(detail.trainingLoad)}
            />
          </div>

          <div className="activity-detail-visuals">
            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>Route</h3>
              </div>
              <ActivityRouteMap track={detail.track} />
            </section>

            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>Elevation</h3>
              </div>
              <ActivityElevationChart track={detail.track} />
            </section>
          </div>

          {showLaps ? (
            <div className="training-laps-section">
              <h3>Laps</h3>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Duration</th>
                      <th>Distance</th>
                      <th>Avg HR</th>
                      <th>Max HR</th>
                      <th>Elev.</th>
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

      <div className="training-raw-toggle">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setShowRaw(true)}
        >
          Show raw JSON
        </button>
      </div>

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
                  <h2 id="training-raw-modal-title">Raw JSON</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close raw JSON"
                  onClick={() => setShowRaw(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div className="training-raw-modal-body">
                <pre className="training-raw-json">
                  {JSON.stringify(detail.raw, null, 2)}
                </pre>
              </div>
            </section>
          </div>,
          document.body
        )}
    </div>
  );
}
