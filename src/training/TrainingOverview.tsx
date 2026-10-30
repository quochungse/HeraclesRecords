import { Suspense, lazy, useMemo } from "react";
import { OverviewComingUp } from "./overview/OverviewComingUp";
import { OverviewDistribution } from "./overview/OverviewDistribution";
import { OverviewSports } from "./overview/OverviewSports";
import { OverviewToday } from "./overview/OverviewToday";
import { TrainingHeatmapPanel } from "./components/TrainingHeatmapPanel";
import { snapshotVo2Readings } from "./parsers";
import type { TrainingHubThresholdZone } from "../../electron/types";
import type { TrainingOverviewProps } from "./types";
import { useHeartRateZoneModel } from "./useHeartRateZoneModel";
import { TrainingSignIn } from "./TrainingSignIn";
import { t } from "../i18n/core";
import "./overview/overview.css";

// The body map drags in three.js and a GLTF mannequin. Overview is the default
// startup view, so that weight stays out of its first chunk.
const LazyOverviewStrength = lazy(() => import("./overview/OverviewStrength"));

// One empty list, not a new one each render: the sport sections memoise on it.
const NO_ZONES: TrainingHubThresholdZone[] = [];

export function TrainingOverview({
  api,
  status,
  email,
  password,
  remember,
  twoFactorEmail,
  twoFactorCode,
  activities,
  upcomingWorkouts,
  sportTypes,
  snapshot,
  snapshotStatus = "ready",
  activitiesStatus = "ready",
  busy,
  sleepConnecting,
  onOpenSleepDetails,
  onEmailChange,
  onPasswordChange,
  onRememberChange,
  onLogin,
  onTwoFactorCodeChange,
  onVerifyTwoFactor,
  onResendTwoFactor,
  onCancelTwoFactor,
  onReconnect,
  showStrength = true,
  hiddenSportScreens,
  onOpenActivity,
  onOpenView
}: TrainingOverviewProps) {
  const connected = Boolean(status?.authenticated);
  // Every panel below draws from one of these two loads, and each answers an
  // empty result with a sentence about the athlete's training. Neither may be
  // said before the load it describes has finished.
  const snapshotPending = snapshotStatus === "pending" && !snapshot;
  const activitiesPending = activitiesStatus === "pending" && activities.length === 0;
  // The zone distribution is labelled with whichever heart-rate model the
  // Personal screen has selected, not LTHR by default.
  // The same answer carries the profile the recovery figure is shaped from.
  const {
    model: hrZoneModel,
    profile: corosProfile,
    settled: corosProfileSettled
  } = useHeartRateZoneModel({ api, corosConnected: connected });
  const summary = useMemo(
    () =>
      snapshot?.summary ?? {
        recoveryPct: undefined,
        weekLoadTotal: undefined,
        rhrDelta: undefined,
        steps: undefined,
        mcpState: undefined
      },
    [snapshot]
  );
  // Every day COROS reported a VO2max for, which tones the figure.
  const vo2Readings = useMemo(() => snapshotVo2Readings(snapshot), [snapshot]);

  return (
    <div className="stack training-dashboard">
      {connected ? null : (
        <TrainingSignIn
          status={status}
          email={email}
          password={password}
          remember={remember}
          twoFactorEmail={twoFactorEmail}
          twoFactorCode={twoFactorCode}
          busy={busy}
          onEmailChange={onEmailChange}
          onPasswordChange={onPasswordChange}
          onRememberChange={onRememberChange}
          onLogin={onLogin}
          onReconnect={onReconnect}
          onTwoFactorCodeChange={onTwoFactorCodeChange}
          onVerifyTwoFactor={onVerifyTwoFactor}
          onResendTwoFactor={onResendTwoFactor}
          onCancelTwoFactor={onCancelTwoFactor}
        />
      )}

      {connected ? (
        <>
          <OverviewToday
            summary={summary}
            snapshot={snapshot}
            activities={activities}
            upcomingWorkouts={upcomingWorkouts}
            profile={corosProfile}
            profileSettled={corosProfileSettled}
            vo2Readings={vo2Readings}
            snapshotLoading={snapshotPending}
            weekLoading={snapshotPending || activitiesPending}
            sleepConnecting={sleepConnecting}
            refreshing={busy === "training-refresh"}
            onOpenSleepDetails={onOpenSleepDetails}
          />

          <OverviewComingUp
            api={api}
            upcomingWorkouts={upcomingWorkouts}
            activities={activities}
            sportTypes={sportTypes}
            onOpenActivity={onOpenActivity}
            onOpenCalendar={onOpenView ? () => onOpenView("calendar") : undefined}
          />

          <section className="overview-section" aria-labelledby="overview-heat-title">
            <h2 id="overview-heat-title" className="overview-section-title">
              {t("overview.heatmap.title")}
            </h2>
            <TrainingHeatmapPanel
              snapshot={snapshot}
              activities={activities}
              loading={snapshotPending || activitiesPending}
            />
          </section>
          <OverviewDistribution
            api={api}
            activities={activities}
            hrZoneModel={hrZoneModel}
            lthrZones={snapshot?.dashboard?.lthrZones ?? NO_ZONES}
            loading={snapshotPending || activitiesPending}
          />
          <OverviewSports
            api={api}
            connected={connected}
            activities={activities}
            upcomingWorkouts={upcomingWorkouts}
            profile={corosProfile}
            hrZoneModel={hrZoneModel}
            zonesSettled={corosProfileSettled}
            lthrZones={snapshot?.dashboard?.lthrZones ?? NO_ZONES}
            vo2Readings={vo2Readings}
            hiddenSportScreens={hiddenSportScreens}
            onOpenActivity={onOpenActivity}
            onOpenView={onOpenView}
          />
          {showStrength ? (
            <Suspense fallback={null}>
              <LazyOverviewStrength
                api={api}
                connected={connected}
                activities={activities}
                upcomingWorkouts={upcomingWorkouts}
                onOpenActivity={onOpenActivity}
                onOpenView={onOpenView}
              />
            </Suspense>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export type { TrainingOverviewProps };
