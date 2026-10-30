import { useEffect } from "react";
import { Dumbbell, Watch, X } from "lucide-react";
import type { HevyStatus, StrengthDataSource, StrengthLoadSource } from "../../electron/types";
import { OptionGroup } from "../components/OptionGroup";
import { formatSyncTime } from "./strengthFormat";
import "./strength.css";
import { t } from "../i18n/core";

interface StrengthSettingsDialogProps {
  source: StrengthDataSource;
  onSourceChange: (source: StrengthDataSource) => void;
  corosConnected: boolean;
  hevyStatus: HevyStatus | null;
  hevyConnected: boolean;
  /** Opens the Hevy dialog, which connects, changes and disconnects Hevy. */
  onOpenHevy: () => void;
  loadSource: StrengthLoadSource;
  onLoadSourceChange: (source: StrengthLoadSource) => void;
  onClose: () => void;
}

/**
 * What the Strength screen is set by, in one place: where sessions are read
 * from, and the formula their training load is counted with. Each account
 * states where it stands; Hevy is connected and managed in its own dialog.
 */
export function StrengthSettingsDialog({
  source,
  onSourceChange,
  corosConnected,
  hevyStatus,
  hevyConnected,
  onOpenHevy,
  loadSource,
  onLoadSourceChange,
  onClose
}: StrengthSettingsDialogProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="strength-settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="strength-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strength-settings-title"
      >
        <header className="strength-settings-head">
          <h2 id="strength-settings-title">{t("strength.settings.title")}</h2>
          <button
            type="button"
            className="strength-settings-close"
            aria-label={t("strength.settings.close")}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <section className="strength-settings-section" aria-labelledby="strength-settings-source">
          <div className="strength-settings-section-head">
            <h3 id="strength-settings-source">{t("strength.settings.dataSource")}</h3>
            <p>{t("strength.settings.dataSourceHint")}</p>
          </div>
          <OptionGroup
            label={t("strength.settings.dataSource")}
            size="md"
            fill
            value={source}
            options={[
              { value: "combined", label: t("strength.combined"), disabled: !(corosConnected && hevyConnected) },
              { value: "coros", label: "COROS", disabled: !corosConnected },
              { value: "hevy", label: "Hevy", disabled: !hevyConnected }
            ]}
            onChange={onSourceChange}
          />

          <ul className="strength-settings-accounts">
            <li className="strength-settings-account">
              <span className="strength-settings-mark" aria-hidden="true">
                <Watch size={16} />
              </span>
              <span className="strength-settings-account-copy">
                <strong>COROS</strong>
                <span className={corosConnected ? "is-on" : undefined}>
                  {corosConnected ? t("common.connected") : t("strength.settings.corosSignedOut")}
                </span>
              </span>
            </li>

            <li className="strength-settings-account">
              <span className="strength-settings-mark" aria-hidden="true">
                <Dumbbell size={16} />
              </span>
              <span className="strength-settings-account-copy">
                <strong>{hevyConnected ? hevyStatus?.displayName || t("strength.hevy.account") : "Hevy"}</strong>
                <span className={hevyConnected ? "is-on" : undefined}>
                  {hevyConnected ? formatSyncTime(hevyStatus?.lastSyncedAt) : t("strength.settings.hevyOff")}
                </span>
              </span>
              {/* Hevy's key, warm-ups and disconnect keep their own dialog. */}
              <button type="button" className="strength-settings-button" onClick={onOpenHevy}>
                {hevyConnected ? t("common.manage") : t("common.connect")}
              </button>
            </li>
          </ul>
        </section>

        <section className="strength-settings-section" aria-labelledby="strength-settings-formula">
          <div className="strength-settings-section-head">
            <h3 id="strength-settings-formula">{t("strength.settings.formula")}</h3>
            <p>{t("strength.settings.formulaHint")}</p>
          </div>
          <OptionGroup
            label={t("strength.settings.formula")}
            size="md"
            fill
            value={loadSource}
            options={[
              { value: "coros", label: t("strength.loadSource.coros") },
              { value: "heracles", label: t("strength.loadSource.heracles") }
            ]}
            onChange={onLoadSourceChange}
          />
          <p className="strength-settings-formula">
            {loadSource === "heracles" ? t("strength.loadSource.explain") : t("strength.loadSource.corosExplain")}
          </p>
        </section>

        <footer className="strength-settings-foot">
          <button type="button" className="strength-settings-button is-primary" onClick={onClose}>
            {t("common.done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
