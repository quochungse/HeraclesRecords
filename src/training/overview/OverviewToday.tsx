import type {
  CorosProfile,
  TrainingHubActivity,
  TrainingHubUpcomingWorkout
} from "../../../electron/types";
import type { Vo2Reading } from "../body/physique";
import type { TrainingHubSnapshot, TrainingSummaryMetrics } from "../types";
import { t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { TodayPhysique } from "./TodayPhysique";
import { TodaySleep } from "./TodaySleep";
import { TodayWeek } from "./TodayWeek";

/**
 * Readiness: the body, last night and this week in one panel — what decides
 * how ready the athlete is today, which is more than today itself. One grid
 * rather than three cards, so the Sleep and This week columns share their
 * rows — the night's figures beside the week's status, the ring beside the
 * week's columns, footer beside footer — and the figure's column takes
 * whatever height they come to.
 */
export function OverviewToday({
  summary,
  snapshot,
  activities,
  upcomingWorkouts,
  profile,
  profileSettled,
  vo2Readings,
  snapshotLoading,
  weekLoading,
  sleepConnecting,
  refreshing,
  onOpenSleepDetails
}: {
  summary: TrainingSummaryMetrics;
  snapshot: TrainingHubSnapshot | null;
  activities: TrainingHubActivity[];
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  profile: CorosProfile | null;
  profileSettled: boolean;
  vo2Readings: readonly Vo2Reading[];
  snapshotLoading: boolean;
  weekLoading: boolean;
  sleepConnecting?: boolean;
  refreshing?: boolean;
  onOpenSleepDetails?: () => void;
}) {
  useI18n();
  return (
    <section className="overview-section" aria-labelledby="overview-today-title">
      <h2 id="overview-today-title" className="overview-section-title">
        {t("overview.readiness.title")}
      </h2>
      <div className="panel overview-today">
        <TodayPhysique
          summary={summary}
          loading={snapshotLoading}
          profile={profile}
          profileSettled={profileSettled}
          vo2Readings={vo2Readings}
        />
        <TodaySleep
          sleep={snapshot?.sleep}
          points={snapshot?.trendPoints}
          connecting={sleepConnecting}
          // The first snapshot still on its way is not "no sleep recorded".
          refreshing={refreshing || snapshotLoading}
          onOpenDetails={onOpenSleepDetails}
        />
        <TodayWeek
          snapshot={snapshot}
          activities={activities}
          upcomingWorkouts={upcomingWorkouts}
          loading={weekLoading}
        />
      </div>
    </section>
  );
}
