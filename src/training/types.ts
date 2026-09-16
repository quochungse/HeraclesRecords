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

/**
 * What Overview's recovery panel and the greeting read. Only those two consume
 * it, so a figure with no reader on either is not carried: the weekly tiles are
 * built from {@link WeekToDateTotals} instead, and the profile reads the COROS
 * dashboard directly.
 */
export interface TrainingSummaryMetrics {
  recoveryPct?: number;
  /** Training load over the last seven days — the greeting's line. */
  weekLoadTotal?: number;
  /** Today's resting HR against the prior six days' average. */
  rhrDelta?: number;
  /** Today's step count, from the MCP daily-health feed. */
  steps?: number;
  /** Whether MCP served the feed `steps` came from. */
  mcpConnected?: boolean;
}

/**
 * Whether the activity list has arrived.
 *
 * The list itself cannot say: it starts as `[]`, a failed load resets it to
 * `[]`, and an athlete who has never run also has `[]`. A screen reading only
 * the array tells all three apart by guessing, and the guess it made was "no
 * runs" — shown, with a row of zeros, for every launch until COROS answered.
 * `pending` holds until the first load of a session settles; a later refresh
 * does not go back to it, so data already on screen stays there meanwhile.
 */
export type TrainingHubLoadStatus = "pending" | "ready" | "failed";

/**
 * Where the most recent activity-detail request stands, and for which activity.
 *
 * `busy` cannot answer this: it is one string for the whole app, so a refresh
 * started while a detail loads overwrites it, and a screen that reads "not
 * busy" as "finished" then reports a load that is still running as failed.
 */
export interface TrainingHubDetailRequest {
  activityId: string;
  status: TrainingHubLoadStatus;
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
  /** Opens the Sleep screen from the Overview's sleep card. */
  onOpenSleepDetails?: () => void;
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
  | "activityDetail"
  | "selectedActivity"
  | "onLoadDetail"
  | "onExportFile"
  | "onLogout"
  | "onRefresh"
>;

/** The Activities screen: the activity list plus its detail pane. */
export type ActivitiesViewProps = Pick<
  TrainingHubViewProps,
  | "api"
  | "status"
  | "activities"
  | "sportTypes"
  | "activityDetail"
  | "selectedActivity"
  | "busy"
  | "onLoadDetail"
  | "onExportFile"
> & {
  /**
   * Whether `activities` has arrived. `busy` cannot say: it is one string for
   * the whole app, and an empty array is equally "still loading", "load
   * failed" and "never trained" — the screen used to answer all three with
   * "No Training Hub activities loaded."
   */
  activitiesStatus: TrainingHubLoadStatus;
  /** Where the latest detail request stands, and which activity it was for. */
  detailRequest: TrainingHubDetailRequest | null;
  /** Sends the disconnected state to Overview, where signing in lives. */
  onConnect: () => void;
  /** Reloads the COROS data after the activity list failed to arrive. */
  onRetry: () => void;
  /**
   * Hands a session to the screen built for its sport. Activities is the log
   * every sport lands in; the depth belongs on Running and Strength, and this
   * is the door between them.
   */
  onOpenSportScreen?: (request: SportScreenRequest) => void;
};

/**
 * One session, handed from Activities to the screen built for its sport.
 *
 * It carries the session rather than only the screen name because arriving on
 * Running's list with nothing open is not what the button says it does: the
 * athlete was already looking at that run. Running opens its full-page detail;
 * Strength selects the session in its list.
 */
export interface SportScreenRequest {
  view: "running" | "strength";
  activityId: string;
  /**
   * Epoch seconds, as COROS sends it. Strength keeps a window of its own — 30
   * days by default — so a session older than that would not be in the list it
   * is asked to select from; this is what lets it widen first.
   */
  startTime?: number;
}

export type { TrainingHubDailyMetric };
