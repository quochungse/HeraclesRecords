import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserRound
} from "lucide-react";
import appLogo from "../../build/icons/128x128.png";
import contoursArt from "../assets/signin/contours.webp";
import type { TrainingHubStatus } from "../../electron/types";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/core";
import "./signIn.css";

export type TrainingSignInProps = {
  status: TrainingHubStatus | null;
  email: string;
  password: string;
  remember: boolean;
  twoFactorEmail: string | null;
  twoFactorCode: string;
  busy: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberChange: (value: boolean) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onReconnect: () => void;
  onTwoFactorCodeChange: (value: string) => void;
  onVerifyTwoFactor: (event: FormEvent<HTMLFormElement>) => void;
  onResendTwoFactor: () => void;
  onCancelTwoFactor: () => void;
};

const FEATURES: ReadonlyArray<{ icon: typeof Trophy; key: MessageKey }> = [
  { icon: ChartNoAxesColumnIncreasing, key: "overview.signin.featureSessions" },
  { icon: MessageCircle, key: "overview.signin.featureCoach" },
  { icon: Trophy, key: "overview.signin.featureRecords" }
];

// The artwork is a mask the stylesheet paints in the accent.
const ART_STYLE = { "--signin-art-mask": `url(${contoursArt})` } as CSSProperties;

/**
 * Overview before COROS is connected: the app introduced over its artwork,
 * and beside it the sheet that signs the athlete in, in whichever of its four
 * states the session is (restoring, the emailed code, a saved account, the form).
 */
export function TrainingSignIn(props: TrainingSignInProps) {
  const { t } = useI18n();
  return (
    <section className="signin" aria-label={t("overview.signin.connectAccount")}>
      <div className="signin-frame">
        <div className="signin-art" aria-hidden="true" style={ART_STYLE} />
        <div className="signin-intro">
          <div className="signin-intro-name">
            <img className="signin-intro-logo" src={appLogo} alt="" width={44} height={44} />
            <h2 className="signin-intro-title">Heracles Records{/* i18n-ignore: the app's name */}</h2>
          </div>
          <p className="signin-intro-tagline">{t("overview.signin.tagline")}</p>
          <p className="signin-intro-body">{t("overview.signin.intro")}</p>
          <ul className="signin-list">
            {FEATURES.map(({ icon: Icon, key }) => (
              <li key={key}>
                <Icon size={16} aria-hidden="true" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
        <div className="signin-pane">
          <SignInSheet {...props} />
        </div>
      </div>
      <p className="signin-foot">
        <span>{t("overview.signin.independent")}</span>
        {/* Restoring offers nothing to press: it resolves on its own. */}
        {props.status?.restoring ? null : (
          <a className="signin-browser" href="https://t.coros.com/" target="_blank" rel="noreferrer">
            {t("overview.signin.openBrowser")}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </p>
    </section>
  );
}

function SignInHead({ icon, title, lead }: { icon?: ReactNode; title: string; lead: ReactNode }) {
  return (
    <header className="signin-head">
      {icon}
      <h2 className="signin-title">{title}</h2>
      <p className="signin-lead">{lead}</p>
    </header>
  );
}

function SignInNote({ children }: { children: ReactNode }) {
  return (
    <p className="signin-note">
      <ShieldCheck size={14} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function SignInSheet({
  status,
  email,
  password,
  remember,
  twoFactorEmail,
  twoFactorCode,
  busy,
  onEmailChange,
  onPasswordChange,
  onRememberChange,
  onLogin,
  onReconnect,
  onTwoFactorCodeChange,
  onVerifyTwoFactor,
  onResendTwoFactor,
  onCancelTwoFactor
}: TrainingSignInProps) {
  const { t, rich } = useI18n();
  const [showPassword, setShowPassword] = useState(false);
  // A saved account is offered on its own; the form is one press away.
  const [otherAccount, setOtherAccount] = useState(false);
  // Signed out because a start-up re-login is still in the air, which is a very
  // different thing to say than "sign in": nobody has to do anything, and it
  // resolves on its own in a second or two.
  const restoring = Boolean(status?.restoring);
  const savedEmail = status?.rememberCredentials ? status.email : undefined;
  const canReconnect = !restoring && Boolean(savedEmail);
  const signingIn = busy === "training-login";

  if (restoring) {
    return (
      <div className="signin-sheet" aria-busy="true">
        <SignInHead
          icon={
            <span className="signin-spinner">
              <Loader2 className="spin" size={22} aria-hidden="true" />
            </span>
          }
          title={t("overview.signin.restoring")}
          lead={
            status?.email
              ? t("overview.signin.signingAs", { email: status.email })
              : t("overview.signin.signingBack")
          }
        />
        <SignInNote>{t("overview.signin.onceNote")}</SignInNote>
      </div>
    );
  }

  if (twoFactorEmail) {
    const verifying = busy === "training-verify";
    const resending = busy === "training-resend";
    return (
      <form className="signin-sheet" onSubmit={onVerifyTwoFactor}>
        <SignInHead
          title={t("overview.signin.verify")}
          lead={rich("overview.signin.enterCode", { b: (chunk) => <strong>{chunk}</strong> }, { email: twoFactorEmail })}
        />
        <label className="signin-field">
          <span>{t("overview.signin.code")}</span>
          <div className="signin-input is-code">
            <KeyRound size={16} aria-hidden="true" />
            <input
              value={twoFactorCode}
              onChange={(event) =>
                onTwoFactorCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              disabled={verifying}
            />
          </div>
        </label>
        <button
          className="primary-button signin-submit"
          type="submit"
          disabled={twoFactorCode.trim().length < 6 || verifying}
        >
          {verifying ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
          {t("overview.signin.verifyAndSignIn")}
        </button>
        <div className="signin-links">
          <button
            className="signin-text-button"
            type="button"
            onClick={onResendTwoFactor}
            disabled={resending || verifying}
          >
            {resending ? (
              <Loader2 className="spin" size={14} aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            {t("overview.signin.resend")}
          </button>
          <button
            className="signin-text-button"
            type="button"
            onClick={onCancelTwoFactor}
            disabled={verifying}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {t("overview.signin.differentAccount")}
          </button>
        </div>
      </form>
    );
  }

  if (canReconnect && !otherAccount) {
    const reconnecting = busy === "training-reconnect";
    return (
      <div className="signin-sheet">
        <SignInHead title={t("overview.signin.welcomeBack")} lead={t("overview.signin.savedLead")} />
        <div className="signin-account">
          <span className="signin-account-mark">
            <UserRound size={18} aria-hidden="true" />
          </span>
          <span className="signin-account-email">{savedEmail}</span>
        </div>
        <button
          className="primary-button signin-submit"
          type="button"
          onClick={onReconnect}
          disabled={reconnecting}
        >
          {reconnecting ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
          {t("common.signIn")}
          {reconnecting ? null : <ArrowRight size={16} aria-hidden="true" />}
        </button>
        <div className="signin-links">
          <button
            className="signin-text-button"
            type="button"
            onClick={() => setOtherAccount(true)}
            disabled={reconnecting}
          >
            {t("overview.signin.differentAccount")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="signin-sheet" onSubmit={onLogin}>
      {/* "Welcome back" only to someone this machine has seen sign in. */}
      <SignInHead
        title={status?.email ? t("overview.signin.welcomeBack") : t("overview.signin.connectAccount")}
        lead={t("overview.signin.formLead")}
      />
      {canReconnect ? (
        <button className="signin-text-button signin-back" type="button" onClick={() => setOtherAccount(false)}>
          <ArrowLeft size={14} aria-hidden="true" />
          {t("overview.signin.savedAccount", { email: savedEmail ?? "" })}
        </button>
      ) : null}
      <div className="signin-fields">
        <label className="signin-field">
          <span>{t("overview.signin.email")}</span>
          <div className="signin-input">
            <Mail size={16} aria-hidden="true" />
            <input
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@example.com" // i18n-ignore: an address
              type="email"
              autoComplete="username"
              disabled={signingIn}
            />
          </div>
        </label>
        <label className="signin-field">
          <span>{t("overview.signin.password")}</span>
          <div className="signin-input">
            <LockKeyhole size={16} aria-hidden="true" />
            <input
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={t("overview.signin.passwordPlaceholder")}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              disabled={signingIn}
            />
            <button
              className="signin-visibility"
              type="button"
              aria-label={showPassword ? t("overview.signin.hidePassword") : t("overview.signin.showPassword")}
              onClick={() => setShowPassword((current) => !current)}
              disabled={signingIn}
            >
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
        </label>
      </div>
      <label className="signin-remember">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => onRememberChange(event.target.checked)}
          disabled={signingIn}
        />
        <span>
          <strong>{t("overview.signin.staySignedIn")}</strong>
          <small>{t("overview.signin.staySignedInBody")}</small>
        </span>
      </label>
      <button
        className="primary-button signin-submit"
        type="submit"
        disabled={!email.trim() || !password || signingIn}
      >
        {signingIn ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
        {t("overview.signin.submit")}
        {signingIn ? null : <ArrowRight size={16} aria-hidden="true" />}
      </button>
      <SignInNote>{t("overview.signin.sentOnly")}</SignInNote>
    </form>
  );
}
