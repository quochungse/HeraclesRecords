import { Activity, LockKeyhole } from "lucide-react";
import { ActivityDetailPanel } from "./components/ActivityDetailPanel";
import { TrainingActivityTable } from "./components/TrainingActivityTable";
import type { ActivitiesViewProps } from "./types";

export function ActivitiesView({
  status,
  activities,
  sportTypes,
  activityDetail,
  selectedActivity,
  busy,
  onLoadDetail,
  onExportFile,
  onConnect
}: ActivitiesViewProps) {
  const connected = Boolean(status?.authenticated);
  const activityCountLabel = `${activities.length} recent ${
    activities.length === 1 ? "activity" : "activities"
  }`;

  if (!connected) {
    return (
      <section className="panel data-connect-panel">
        <LockKeyhole size={24} aria-hidden="true" />
        <div>
          <h3>Connect COROS first</h3>
          <p>
            Signing in to COROS lives on Overview. Connect there and your recent
            activities and their detail load here.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={onConnect}>
          Open Overview
        </button>
      </section>
    );
  }

  return (
    <div className="stack stack-fill training-dashboard activities-view">
      <section className="panel panel-flex training-activities-split-panel">
        <div className="training-activities-split">
          <div className="training-activities-list">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recent Activities</p>
                <h2>{activityCountLabel}</h2>
              </div>
              <Activity size={22} aria-hidden="true" />
            </div>
            <TrainingActivityTable
              activities={activities}
              sportTypes={sportTypes}
              selectedActivityId={selectedActivity?.activityId ?? null}
              busy={busy}
              onLoadDetail={onLoadDetail}
              onExportFile={onExportFile}
            />
          </div>
          <div className="training-activities-detail">
            <ActivityDetailPanel
              detail={activityDetail}
              listActivity={selectedActivity}
              sportTypes={sportTypes}
              busy={busy}
              embedded
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export type { ActivitiesViewProps };
