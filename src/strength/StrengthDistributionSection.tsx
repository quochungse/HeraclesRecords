import { Loader2 } from "lucide-react";
import type { TrainingHubStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { StrengthHero } from "./StrengthHero";
import { activeStrengthWindow, useStrengthData } from "./useStrengthData";
import "./strength.css";

interface StrengthDistributionSectionProps {
  api: CorosLinkApi;
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
        <p className="eyebrow">Load Profile</p>
        <h2>
          Strength Distribution <span>({window.label})</span>
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
            Reading your strength sessions…
          </p>
        ) : (
          <StrengthHero analytics={analytics} source={source} />
        )}
      </div>
    </section>
  );
}
