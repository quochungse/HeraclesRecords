import { Suspense, lazy, type CSSProperties, useMemo, useState } from "react";
import {
  ArrowRightFromLine,
  ChartNoAxesColumnIncreasing,
  Eye,
  EyeOff,
  ExternalLink,
  ArrowLeft,
  KeyRound,
  LockKeyhole,
  Loader2,
  Mail,
  Monitor,
  ShieldCheck,
  Trophy,
  RefreshCw
} from "lucide-react";
import { FitnessTrendPanel } from "./components/FitnessTrendPanel";
import { RecoveryPanel } from "./components/RecoveryPanel";
import { SleepSummaryPanel } from "./components/SleepSummaryPanel";
import { TrainingHeatmapPanel } from "./components/TrainingHeatmapPanel";
import { TrainingTrendCharts } from "./components/TrainingTrendChart";
import { TrainingZoneDistributionCharts } from "./components/TrainingZoneDistributionCharts";
import { UpcomingWorkoutsPanel } from "./components/UpcomingWorkoutsPanel";
import { snapshotVo2Readings } from "./parsers";
import { renderRich } from "../i18n/useI18n";
import type { TrainingOverviewProps } from "./types";
import { useHeartRateZoneModel } from "./useHeartRateZoneModel";
import loginPageBackground from "../assets/training-hub/login-bg.webp";
import { t } from "../i18n/core";

// The body map drags in three.js and a GLTF mannequin. Overview is the default
// startup view, so that weight stays out of its first chunk.
const LazyStrengthDistributionSection = lazy(() =>
  import("../strength/StrengthDistributionSection").then(
    ({ StrengthDistributionSection }) => ({
      default: StrengthDistributionSection
    })
  )
);

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
  showStrength = true
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
  // Signed out because a start-up re-login is still in the air, which is a very
  // different thing to say than "sign in": nobody has to do anything, and it
  // resolves on its own in a second or two.
  const restoring = Boolean(status?.restoring);
  const canReconnect =
    !connected &&
    !restoring &&
    Boolean(status?.rememberCredentials) &&
    Boolean(status?.email);
  const reconnecting = busy === "training-reconnect";
  const awaitingTwoFactor = Boolean(twoFactorEmail);
  const verifying = busy === "training-verify";
  const resending = busy === "training-resend";
  const [showPassword, setShowPassword] = useState(false);
  const signInBackgroundStyle = connected
    ? undefined
    : ({
        "--training-signin-bg": `url(${loginPageBackground})`
      } as CSSProperties);
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
        <section
          className="panel training-command-center is-disconnected"
          style={signInBackgroundStyle}
        >
          <div className="training-command-copy">
            <div className="training-signin-copy-inner">
              <div className="training-command-kicker">
                <Monitor size={18} aria-hidden="true" />
                <p className="eyebrow">Training Hub</p>
              </div>
              <h2>
                <span>COROS</span>
                <span>
                  <em>Training</em> Hub{/* i18n-ignore: the product's name */}
                </span>
              </h2>
              <p className="training-signin-lead">
                {t("overview.signin.lead")}
              </p>

              <div className="training-signin-feature-list">
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <ChartNoAxesColumnIncreasing size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{t("overview.signin.insights")}</strong>
                    <p>
                      {t("overview.signin.insightsBody")}
                    </p>
                  </div>
                </div>
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <Trophy size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{t("overview.signin.allData")}</strong>
                    <p>
                      {t("overview.signin.allDataBody")}
                    </p>
                  </div>
                </div>
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <ShieldCheck size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{t("overview.signin.secure")}</strong>
                    <p>
                      {t("overview.signin.secureBody")}
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {restoring ? (
            <div className="training-login-panel training-login-restoring">
              <div className="training-login-panel-header">
                <strong>
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                  {t("overview.signin.restoring")}
                </strong>
                <p>
                  {status?.email
                    ? t("overview.signin.signingAs", { email: status.email })
                    : t("overview.signin.signingBack")}
                </p>
              </div>

              <p className="training-login-footer">
                <ShieldCheck size={16} aria-hidden="true" />
                {t("overview.signin.onceNote")}
              </p>
            </div>
          ) : awaitingTwoFactor ? (
            <form
              className="training-login-panel"
              onSubmit={onVerifyTwoFactor}
            >
              <div className="training-login-panel-header">
                <strong>{t("overview.signin.verify")}</strong>
                <p>
                  {renderRich(t("overview.signin.enterCode", { email: twoFactorEmail ?? "" }), {
                    b: (chunk) => <strong>{chunk}</strong>
                  })}
                </p>
              </div>

              <div className="training-login-fields">
                <label className="field training-login-field">
                  <span>{t("overview.signin.code")}</span>
                  <div className="training-login-input">
                    <KeyRound size={18} aria-hidden="true" />
                    <input
                      value={twoFactorCode}
                      onChange={(event) =>
                        onTwoFactorCodeChange(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      placeholder="123456"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      disabled={verifying}
                    />
                  </div>
                </label>
              </div>

              <div className="settings-actions training-login-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={twoFactorCode.trim().length < 6 || verifying}
                >
                  {verifying ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <ArrowRightFromLine size={17} aria-hidden="true" />
                  )}
                  {t("overview.signin.verifyAndSignIn")}
                </button>
              </div>

              <div className="training-login-2fa-actions">
                <button
                  className="training-login-text-button"
                  type="button"
                  onClick={onResendTwoFactor}
                  disabled={resending || verifying}
                >
                  {resending ? (
                    <Loader2 className="spin" size={15} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={15} aria-hidden="true" />
                  )}
                  {t("overview.signin.resend")}
                </button>
                <button
                  className="training-login-text-button"
                  type="button"
                  onClick={onCancelTwoFactor}
                  disabled={verifying}
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  {t("overview.signin.differentAccount")}
                </button>
              </div>

              <p className="training-login-footer">
                <ShieldCheck size={16} aria-hidden="true" />
                {t("overview.signin.neverShared")}
              </p>
            </form>
          ) : (
          <form className="training-login-panel" onSubmit={onLogin}>
            <div className="training-login-panel-header">
              {/* "Welcome back" only to someone this machine has seen sign in. */}
              <strong>
                {canReconnect || status?.email
                  ? t("overview.signin.welcomeBack")
                  : t("overview.signin.connectAccount")}
              </strong>
              <p>{t("overview.signin.subtitle")}</p>
            </div>

            {canReconnect ? (
              <div className="training-login-reconnect">
                <div className="training-login-reconnect-text">
                  <strong>{t("overview.signin.savedAccount", { email: status?.email ?? "" })}</strong>
                  <small>
                    {t("overview.signin.reconnectBody")}
                  </small>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={onReconnect}
                  disabled={reconnecting}
                >
                  {reconnecting ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={17} aria-hidden="true" />
                  )}
                  {t("common.signIn")}
                </button>
              </div>
            ) : null}

            <div className="training-login-fields">
              <label className="field training-login-field">
                <span>{t("overview.signin.email")}</span>
                <div className="training-login-input">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                    placeholder="you@example.com" // i18n-ignore: an address
                    type="email"
                    autoComplete="username"
                    disabled={busy === "training-login"}
                  />
                </div>
              </label>
              <label className="field training-login-field">
                <span>{t("overview.signin.password")}</span>
                <div className="training-login-input">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    placeholder={t("overview.signin.passwordPlaceholder")}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    disabled={busy === "training-login"}
                  />
                  <button
                    className="training-login-visibility"
                    type="button"
                    aria-label={showPassword ? t("overview.signin.hidePassword") : t("overview.signin.showPassword")}
                    onClick={() => setShowPassword((current) => !current)}
                    disabled={busy === "training-login"}
                  >
                    {showPassword ? (
                      <EyeOff size={17} aria-hidden="true" />
                    ) : (
                      <Eye size={17} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
            </div>

            <label className="training-login-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => onRememberChange(event.target.checked)}
                disabled={busy === "training-login"}
              />
              <span>
                {t("overview.signin.remember")}
                <small>
                  {t("overview.signin.rememberBody")}
                </small>
              </span>
            </label>

            <div className="settings-actions training-login-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={!email.trim() || !password || busy === "training-login"}
              >
                {busy === "training-login" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <ArrowRightFromLine size={17} aria-hidden="true" />
                )}
                {t("overview.signin.submit")}
              </button>
            </div>

            <div className="training-login-divider">
              <span>{t("overview.signin.or")}</span>
            </div>

            <a
              className="training-login-browser-link"
              href="https://t.coros.com/"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} aria-hidden="true" />
              {t("overview.signin.openBrowser")}
            </a>

            <p className="training-login-footer">
              <ShieldCheck size={16} aria-hidden="true" />
              {t("overview.signin.neverShared")}
            </p>
          </form>
          )}
        </section>
      )}

      {connected ? (
        <>
          <section className="training-intelligence">
            <div className="training-intelligence-header">
              <p className="eyebrow">{t("overview.intelligence")}</p>
              {busy === "training-refresh" ? (
                <span className="training-sync-pill is-syncing">
                  <span className="training-sync-dot" aria-hidden="true" />
                  {t("overview.syncing")}
                </span>
              ) : null}
            </div>
            <div className="training-intelligence-grid">
              <div className="training-intelligence-column">
                <RecoveryPanel
                  summary={summary}
                  loading={snapshotPending}
                  profile={corosProfile}
                  profileSettled={corosProfileSettled}
                  vo2Readings={vo2Readings}
                />
              </div>
              <div className="training-intelligence-column">
                <FitnessTrendPanel
                  snapshot={snapshot}
                  activities={activities}
                  loading={snapshotPending || activitiesPending}
                />
                <SleepSummaryPanel
                  sleep={snapshot?.sleep}
                  points={snapshot?.trendPoints}
                  connecting={sleepConnecting}
                  refreshing={busy === "training-refresh"}
                  onOpenDetails={onOpenSleepDetails}
                />
              </div>
            </div>
          </section>

          {/* Its own row, directly under Training Intelligence. The panel
              renders nothing when the calendar is empty, so a week with no
              scheduled sessions leaves no gap here. */}
          <UpcomingWorkoutsPanel
            api={api}
            workouts={upcomingWorkouts}
            sportTypes={sportTypes}
          />

          <div className="training-heatmap-wrap">
            <TrainingHeatmapPanel
              snapshot={snapshot}
              activities={activities}
              loading={snapshotPending || activitiesPending}
            />
          </div>
          <TrainingZoneDistributionCharts
            hrZoneModel={hrZoneModel}
            lthrZones={snapshot?.dashboard?.lthrZones ?? []}
            activities={activities}
            analytics={snapshot?.analytics ?? null}
            loading={snapshotPending || activitiesPending}
          />
          {showStrength ? (
            <Suspense fallback={null}>
              <LazyStrengthDistributionSection api={api} status={status} />
            </Suspense>
          ) : null}
          <TrainingTrendCharts
            points={snapshot?.trendPoints ?? []}
            mcpState={snapshot?.sleep?.mcpState}
            loading={snapshotPending}
            sleepLoading={sleepConnecting && !snapshot?.sleep}
          />
        </>
      ) : null}
    </div>
  );
}

export type { TrainingOverviewProps };
