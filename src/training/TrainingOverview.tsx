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
import { RecoveryRing } from "./components/RecoveryRing";
import { SleepSummaryPanel } from "./components/SleepSummaryPanel";
import { TrainingHeatmapPanel } from "./components/TrainingHeatmapPanel";
import { TrainingTrendCharts } from "./components/TrainingTrendChart";
import { TrainingZoneDistributionCharts } from "./components/TrainingZoneDistributionCharts";
import { UpcomingWorkoutsPanel } from "./components/UpcomingWorkoutsPanel";
import { mergeTrainingDayLists } from "./parsers";
import type { TrainingOverviewProps } from "./types";
import { useHeartRateZoneModel } from "./useHeartRateZoneModel";
import {
  buildWeekToDateTotals,
  enrichDayListWithActivityTotals
} from "./weeklyActivity";
import loginPageBackground from "../../public/assets/training-hub/Login-page-bg.png";

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
  rpeBackfill,
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
  onReconnect
}: TrainingOverviewProps) {
  const connected = Boolean(status?.authenticated);
  // The zone distribution is labelled with whichever heart-rate model the
  // Personal screen has selected, not LTHR by default.
  const hrZoneModel = useHeartRateZoneModel({ api, corosConnected: connected });
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
        staminaLevel: undefined,
        recoveryPct: undefined,
        todayLoad: undefined,
        weekLoadTotal: undefined,
        latestRhr: undefined,
        rhrDelta: undefined,
        mcpConnected: undefined
      },
    [snapshot]
  );
  // Built from the same enriched day list as the Weekly Activity chart, so a
  // tile and that chart's legend total never disagree about the same week.
  const weekTotals = useMemo(
    () =>
      buildWeekToDateTotals(
        enrichDayListWithActivityTotals(
          mergeTrainingDayLists(
            snapshot?.dailyMetrics ?? null,
            snapshot?.analytics ?? null
          ),
          activities
        ),
        snapshot?.dailyHealth?.records ?? []
      ),
    [snapshot, activities]
  );

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
                  <em>Training</em> Hub
                </span>
              </h2>
              <p className="training-signin-lead">
                Desktop access to training load, recovery, activity detail, and
                race readiness.
              </p>

              <div className="training-signin-feature-list">
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <ChartNoAxesColumnIncreasing size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Deep Insights</strong>
                    <p>
                      Track recovery, training load, VO2 max, and more with
                      advanced analytics.
                    </p>
                  </div>
                </div>
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <Trophy size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>All Your Data</strong>
                    <p>
                      Sync activities, view PRs, and analyze performance over
                      time.
                    </p>
                  </div>
                </div>
                <div className="training-signin-feature">
                  <span className="training-signin-feature-icon">
                    <ShieldCheck size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Secure &amp; Private</strong>
                    <p>
                      Remembered credentials are encrypted and stored locally
                      on this device.
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
                  Restoring your session
                </strong>
                <p>
                  {status?.email
                    ? `Signing ${status.email} back in to COROS.`
                    : "Signing back in to COROS."}
                </p>
              </div>

              <p className="training-login-footer">
                <ShieldCheck size={16} aria-hidden="true" />
                Signing in on another device ends this one&apos;s session, so
                this happens once each time the app starts. Nothing to do.
              </p>
            </div>
          ) : awaitingTwoFactor ? (
            <form
              className="training-login-panel"
              onSubmit={onVerifyTwoFactor}
            >
              <div className="training-login-panel-header">
                <strong>Verify it's you</strong>
                <p>
                  Enter the 6-digit code we emailed to{" "}
                  <strong>{twoFactorEmail}</strong>.
                </p>
              </div>

              <div className="training-login-fields">
                <label className="field training-login-field">
                  <span>Verification code</span>
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
                  Verify and sign in
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
                  Resend code
                </button>
                <button
                  className="training-login-text-button"
                  type="button"
                  onClick={onCancelTwoFactor}
                  disabled={verifying}
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  Use a different account
                </button>
              </div>

              <p className="training-login-footer">
                <ShieldCheck size={16} aria-hidden="true" />
                Your credentials are encrypted and never shared.
              </p>
            </form>
          ) : (
          <form className="training-login-panel" onSubmit={onLogin}>
            <div className="training-login-panel-header">
              <strong>Welcome back</strong>
              <p>Sign in to access your COROS Training Hub data</p>
            </div>

            {canReconnect ? (
              <div className="training-login-reconnect">
                <div className="training-login-reconnect-text">
                  <strong>Saved COROS account: {status?.email}</strong>
                  <small>
                    Create a Training Hub session using your saved COROS
                    credentials — no password needed.
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
                  Sign in
                </button>
              </div>
            ) : null}

            <div className="training-login-fields">
              <label className="field training-login-field">
                <span>Email</span>
                <div className="training-login-input">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="username"
                    disabled={busy === "training-login"}
                  />
                </div>
              </label>
              <label className="field training-login-field">
                <span>Password</span>
                <div className="training-login-input">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    placeholder="COROS password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    disabled={busy === "training-login"}
                  />
                  <button
                    className="training-login-visibility"
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
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
                Save this COROS account
                <small>
                  Securely stores an encrypted password digest so Training
                  Hub and Watch Face Studio can each create their own session.
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
                Sign in to COROS
              </button>
            </div>

            <div className="training-login-divider">
              <span>or</span>
            </div>

            <a
              className="training-login-browser-link"
              href="https://t.coros.com/"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} aria-hidden="true" />
              Open COROS Training Hub in Browser
            </a>

            <p className="training-login-footer">
              <ShieldCheck size={16} aria-hidden="true" />
              Your credentials are encrypted and never shared.
            </p>
          </form>
          )}
        </section>
      )}

      {connected ? (
        <>
          <section className="training-intelligence">
            <div className="training-intelligence-header">
              <p className="eyebrow">Training Intelligence</p>
              {busy === "training-refresh" ? (
                <span className="training-sync-pill is-syncing">
                  <span className="training-sync-dot" aria-hidden="true" />
                  Syncing data
                </span>
              ) : null}
            </div>
            <div className="training-intelligence-grid">
              <div className="training-intelligence-column">
                <RecoveryRing summary={summary} weekTotals={weekTotals} />
                <SleepSummaryPanel
                  sleep={snapshot?.sleep}
                  connecting={sleepConnecting}
                  refreshing={busy === "training-refresh"}
                  onOpenDetails={onOpenSleepDetails}
                />
              </div>
              <div className="training-intelligence-column">
                <FitnessTrendPanel snapshot={snapshot} activities={activities} />
                <UpcomingWorkoutsPanel
                  api={api}
                  workouts={upcomingWorkouts}
                  sportTypes={sportTypes}
                />
              </div>
            </div>
          </section>

          <div className="training-heatmap-wrap">
            <TrainingHeatmapPanel
              snapshot={snapshot}
              activities={activities}
              rpeBackfill={rpeBackfill}
            />
          </div>
          <TrainingTrendCharts
            points={snapshot?.trendPoints ?? []}
            activities={activities}
            mcpConnected={snapshot?.sleep?.mcpConnected}
          />
          <TrainingZoneDistributionCharts
            hrZoneModel={hrZoneModel}
            lthrZones={snapshot?.dashboard?.lthrZones ?? []}
            activities={activities}
            analytics={snapshot?.analytics ?? null}
          />
          <Suspense fallback={null}>
            <LazyStrengthDistributionSection api={api} status={status} />
          </Suspense>
        </>
      ) : null}
    </div>
  );
}

export type { TrainingOverviewProps };
