import { Activity, CloudOff, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { ActivityDetailPanel } from "./components/ActivityDetailPanel";
import { TrainingActivityTable } from "./components/TrainingActivityTable";
import type { ActivitiesViewProps } from "./types";

export function ActivitiesView({
  api,
  status,
  activities,
  activitiesStatus,
  sportTypes,
  activityDetail,
  selectedActivity,
  detailRequest,
  busy,
  onLoadDetail,
  onExportFile,
  onConnect,
  onRetry
}: ActivitiesViewProps) {
  const connected = Boolean(status?.authenticated);
  const activityCountLabel = `${activities.length} ${
    activities.length === 1 ? "activity" : "activities"
  }`;

  if (!connected) {
    return (
      <section className="panel data-connect-panel">
        <LockKeyhole size={24} aria-hidden="true" />
        <div>
          <h3>Connect COROS first</h3>
          <p>
            Signing in to COROS lives on Overview. Connect there and your
            activities and their detail load here.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={onConnect}>
          Open Overview
        </button>
      </section>
    );
  }

  /*
   * Three states an empty array cannot tell apart, which is why the list is not
   * asked. Until this screen read `activitiesStatus` it answered all of them
   * with "No Training Hub activities loaded" — including the launch where
   * COROS simply had not replied yet.
   */
  function renderList() {
    if (activities.length > 0) {
      return (
        <TrainingActivityTable
          activities={activities}
          sportTypes={sportTypes}
          selectedActivityId={selectedActivity?.activityId ?? null}
          busy={busy}
          onLoadDetail={onLoadDetail}
          onExportFile={onExportFile}
        />
      );
    }

    if (activitiesStatus === "pending") {
      return (
        <div className="training-empty-state">
          <Loader2 className="spin" size={20} aria-hidden="true" />
          <p>Reading your activities from COROS…</p>
        </div>
      );
    }

    if (activitiesStatus === "failed") {
      return (
        <div className="training-empty-state">
          <CloudOff size={20} aria-hidden="true" />
          <p>COROS did not answer. Nothing was lost — try again.</p>
          <button type="button" className="secondary-button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="training-empty-state">
        <p>No activities yet. They appear here once your watch syncs.</p>
      </div>
    );
  }

  const countLabel =
    activities.length === 0 && activitiesStatus === "pending"
      ? "Loading…"
      : activityCountLabel;

  return (
    <div className="stack stack-fill training-dashboard activities-view">
      <section className="panel panel-flex training-activities-split-panel">
        <div className="training-activities-split">
          <div className="training-activities-list">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Activities</p>
                <h2>{countLabel}</h2>
              </div>
              <Activity size={22} aria-hidden="true" />
            </div>
            {renderList()}
          </div>
          <div className="training-activities-detail">
            <ActivityDetailPanel
              api={api}
              detail={activityDetail}
              listActivity={selectedActivity}
              sportTypes={sportTypes}
              detailRequest={detailRequest}
              busy={busy}
              onRetry={onLoadDetail}
              embedded
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export type { ActivitiesViewProps };
