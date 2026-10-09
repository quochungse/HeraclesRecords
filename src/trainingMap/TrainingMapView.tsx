import { LockKeyhole } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
} from "../../electron/types";
import type { LabourState } from "../records/labours";
import { ActivityGlobeCard } from "./ActivityGlobeCard";
import { t } from "../i18n/core";

interface TrainingMapViewProps {
  activities: TrainingHubActivity[];
  connected: boolean;
  detail: TrainingHubActivityDetail | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  onOpenActivity: (activityId: string) => void;
  labour?: LabourState;
  onOpenLabours: () => void;
  onOpenOverview: () => void;
}

/**
 * The training map on a screen of its own.
 *
 * On Overview the map was simply withheld until a session existed, because the
 * sign-in panel sat directly above it and said the same thing better. A
 * destination the athlete navigated to cannot stay blank like that, so the
 * signed-out case gets the same connect panel the other COROS-backed screens
 * show, under a header that names the screen either way. A start-up restore
 * reads as signed out here; that is the panel telling them to sit tight, and it
 * turns into the map on its own.
 *
 * The globe is imported eagerly rather than behind a second lazy boundary: this
 * whole view is already a chunk of its own, and it is only fetched once the
 * athlete asks for the map.
 */
export function TrainingMapView({
  activities,
  connected,
  detail,
  onSelectActivity,
  onOpenActivity,
  labour,
  onOpenLabours,
  onOpenOverview,
}: TrainingMapViewProps) {
  if (!connected) {
    return (
      <section className="training-map-disconnected">
        <header className="training-map-page-header">
          <div>
            <h1>{t("map.title")}</h1>
            <p>{t("map.subtitle")}</p>
          </div>
        </header>

        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{t("common.connectFirst.title")}</h3>
            <p>{t("map.connectBody")}</p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={onOpenOverview}
          >
            {t("common.openOverview")}
          </button>
        </section>
      </section>
    );
  }

  return (
    <ActivityGlobeCard
      activities={activities}
      connected={connected}
      detail={detail}
      onSelectActivity={onSelectActivity}
      onOpenActivity={onOpenActivity}
      labour={labour}
      onOpenLabours={onOpenLabours}
    />
  );
}
