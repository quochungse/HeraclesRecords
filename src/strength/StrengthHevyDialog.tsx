import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Link2, Loader2, X } from "lucide-react";
import type { HevyStatus } from "../../electron/types";
import { formatSyncTime } from "./strengthFormat";
import { toErrorMessage } from "./useStrengthData";
import "./strength.css";
import { t } from "../i18n/core";

interface StrengthHevyDialogProps {
  status: HevyStatus | null;
  connected: boolean;
  /** With COROS still signed in there is a source left after disconnecting, so the dialog stays open. */
  corosConnected: boolean;
  onConnect: (apiKey: string) => Promise<void>;
  onSetWarmups: (includeWarmups: boolean) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}

/**
 * Connecting Hevy, and what can be changed once it is connected. Mounted only
 * while open, so the key field and any failure it reported are gone by the next
 * time it is opened rather than needing to be cleared by the screen behind it.
 */
export function StrengthHevyDialog({
  status,
  connected,
  corosConnected,
  onConnect,
  onSetWarmups,
  onDisconnect,
  onClose
}: StrengthHevyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  /** Every action here is one request: run it, and keep what it says if it fails. */
  const run = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => onConnect(apiKey), () => setApiKey(""));
  };

  const disconnect = () => {
    if (!window.confirm(t("strength.hevy.confirmDisconnect"))) {
      return;
    }
    void run(onDisconnect, () => {
      if (!corosConnected) onClose();
    });
  };

  return (
    <div
      className="strength-hevy-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="strength-hevy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strength-hevy-title"
      >
        <header>
          <div>
            <p className="eyebrow">{t("strength.source")}</p>
            <h2 id="strength-hevy-title">{connected ? t("strength.hevy.connected") : t("strength.connectHevy")}</h2>
          </div>
          <button
            type="button"
            className="strength-hevy-close"
            aria-label={t("strength.hevy.close")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {connected ? (
          <>
            <div className="strength-hevy-account">
              <span className="strength-hevy-mark" aria-hidden="true">H</span>
              <div>
                <strong>{status?.displayName || t("strength.hevy.account")}</strong>
                <span>{formatSyncTime(status?.lastSyncedAt)}</span>
              </div>
              {status?.profileUrl ? (
                <a href={status.profileUrl} target="_blank" rel="noreferrer">
                  {t("strength.hevy.profile")} <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <label className="strength-hevy-toggle">
              <input
                type="checkbox"
                checked={Boolean(status?.includeWarmups)}
                disabled={busy}
                onChange={(event) => {
                  // Read now: the handler runs a request later, by which time
                  // the box may have been clicked again.
                  const includeWarmups = event.target.checked;
                  void run(() => onSetWarmups(includeWarmups));
                }}
              />
              <span>
                <strong>{t("strength.hevy.warmups")}</strong>
                <small>{t("strength.hevy.warmupsHint")}</small>
              </span>
            </label>
            <p className="strength-hevy-privacy">
              {t("strength.hevy.readOnly")}
            </p>
            <footer>
              <button
                type="button"
                className="secondary-button danger"
                disabled={busy}
                onClick={disconnect}
              >
                {t("strength.hevy.disconnect")}
              </button>
              <button type="button" className="primary-button" disabled={busy} onClick={onClose}>
                {t("common.done")}
              </button>
            </footer>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>
              {t("strength.hevy.pro")}
            </p>
            <a
              className="strength-hevy-developer-link"
              href="https://hevy.com/settings?developer"
              target="_blank"
              rel="noreferrer"
            >
              {t("strength.hevy.developer")}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
            <label className="field">
              <span>{t("strength.hevy.key")}</span>
              <input
                type="password"
                value={apiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("strength.hevy.keyPlaceholder")}
                disabled={busy}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <p className="strength-hevy-privacy">
              {t("strength.hevy.keyPrivacy")}
            </p>
            <button type="submit" className="primary-button" disabled={busy || !apiKey.trim()}>
              {busy ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Link2 size={16} aria-hidden="true" />
              )}
              {t("strength.connectHevy")}
            </button>
          </form>
        )}

        {error ? (
          <p className="strength-hevy-error" role="alert">{error}</p>
        ) : null}
      </section>
    </div>
  );
}
