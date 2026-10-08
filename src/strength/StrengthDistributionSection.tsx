import { Loader2 } from "lucide-react";
import type { TrainingHubStatus } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { StrengthHero } from "./StrengthHero";
import { activeStrengthWindow, useStrengthData } from "./useStrengthData";
import "./strength.css";

import { t } from "../i18n/core";
interface StrengthDistributionSectionProps {
  api: HeraclesRecordsApi;
  status: TrainingHubStatus | null;
}

/**
 * Overview's strength counterpart to Training Distribution: the body heat map
 * and its muscle breakdown, read over whatever window the Strength screen is
 * set to. The preference is shared, so the two screens never disagree.
 */
export function StrengthDistributionSection({
  api,
  status
}: StrengthDistributionSectionProps) {
  const { analytics, days, source, error, initializing } = useStrengthData({
    api,
    corosConnected: Boolean(status?.authenticated)
  });
  const window = activeStrengthWindow(days);

  return (
    <section className="training-load-profile">
      <div className="training-load-profile-header">
        <p className="eyebrow">{t("overview.zones.loadProfile")}</p>
        <h2>
          {t("strength.distribution")} <span>({window.label})</span>
        </h2>
      </div>
      <div className="strength-view">
        {error ? (
          <p className="strength-notice is-error" role="alert">
            {error}
          </p>
        ) : null}
        {/* A body map built from an empty history is a body map saying "no
            sets in this window" — which is a claim, and the wrong one, until
            the history has actually been read. */}
        {initializing ? (
          <p className="strength-notice" role="status">
            <Loader2 className="spin" size={14} aria-hidden="true" />
            {t("strength.readingSessions")}
          </p>
        ) : (
          <StrengthHero analytics={analytics} source={source} />
        )}
      </div>
    </section>
  );
}
