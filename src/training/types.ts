import type { FormEvent } from "react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubAnalytics,
  TrainingHubDailyHealthSummary,
  TrainingHubDailyMetric,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubRacePredictor,
  TrainingHubSleepSummary,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

export interface TrainingTrendPoint {
  date: string;
  label: string;
  trainingLoad?: number;
  rpeLoad?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  rhr?: number;
  sleepMinutes?: number;
  sleepScore?: number;
}

export interface TrainingSummaryMetrics {
  staminaLevel?: number;
  recoveryPct?: number;
  todayLoad?: number;
  weekLoadTotal?: number;
  latestRhr?: number;
  rhrDelta?: number;
  steps?: number;
  calories?: number;
}

export interface TrainingHubSnapshot {
  summary: TrainingSummaryMetrics;
  trendPoints: TrainingTrendPoint[];
  racePredictor: TrainingHubRacePredictor | null;
  dashboard: TrainingHubDashboard | null;
  analytics: TrainingHubAnalytics | null;
  dailyMetrics: TrainingHubDailyMetrics | null;
  sleep?: TrainingHubSleepSummary | null;
  dailyHealth?: TrainingHubDailyHealthSummary | null;
}

export type HeatmapIntensityLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapMetric = "trainingLoad" | "rpeLoad";

export interface HeatmapCell {
  happenDay: string;
  trainingLoad?: number;
  rpeLoad?: number;
  /** Value of the currently selected metric — drives level and summary. */
  value?: number;
  distance?: number;
  duration?: number;
  level: HeatmapIntensityLevel;
  label: string;
}

export interface HeatmapSummary {
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  totalLoad: number;
}

export interface HeatmapMonthLabel {
  column: number;
  label: string;
}

export interface HeatmapGrid {
  cells: (HeatmapCell | null)[];
  weeks: number;
  monthLabels: HeatmapMonthLabel[];
}

/**
 * The full COROS training surface. No component takes this whole shape any
 * more — TrainingOverviewProps and ActivitiesViewProps below are carved out of
 * it, and it stays as the single place that spells the surface out.
 */
export interface TrainingHubViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  email: string;
  password: string;
  remember: boolean;
  activities: TrainingHubActivity[];
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  snapshot: TrainingHubSnapshot | null;
  sportTypes: TrainingHubSportType[];
  rpeBackfill?: { pending: number; running: boolean } | null;
  activityDetail: TrainingHubActivityDetail | null;
  selectedActivity: TrainingHubActivity | null;
  busy: string | null;
  sleepConnecting?: boolean;
  // Two-factor: non-null email means a verification code is being awaited.
  twoFactorEmail: string | null;
  twoFactorCode: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberChange: (value: boolean) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onTwoFactorCodeChange: (value: string) => void;
  onVerifyTwoFactor: (event: FormEvent<HTMLFormElement>) => void;
  onResendTwoFactor: () => void;
  onCancelTwoFactor: () => void;
  onReconnect: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onLoadDetail: (activity: TrainingHubActivity) => void;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

/**
 * Everything the old Training Hub screen rendered except the activity list and
 * its detail pane — sign-in included, since that surface now sits on Overview.
 * Refresh and disconnect are gone too: the connected-account card that owns
 * them moved into the Connections section of Settings (see CorosConnectionCard).
 */
export type TrainingOverviewProps = Omit<
  TrainingHubViewProps,
  | "api"
  | "sportTypes"
  | "activityDetail"
  | "selectedActivity"
  | "onLoadDetail"
  | "onExportFile"
  | "onLogout"
  | "onRefresh"
>;

/** The Activities screen: the recent-activity list plus its detail pane. */
export type ActivitiesViewProps = Pick<
  TrainingHubViewProps,
  | "status"
  | "activities"
  | "sportTypes"
  | "activityDetail"
  | "selectedActivity"
  | "busy"
  | "onLoadDetail"
  | "onExportFile"
> & {
  /** Sends the disconnected state to Overview, where signing in lives. */
  onConnect: () => void;
};

export type { TrainingHubDailyMetric };
