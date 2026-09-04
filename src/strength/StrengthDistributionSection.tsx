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
 * Overview's strength counterpart to Running Distribution: the body heat map
 * and its muscle breakdown, read over whatever window the Strength screen is
 * set to. The preference is shared, so the two screens never disagree.
 */
export function StrengthDistributionSection({
  api,
  status
}: StrengthDistributionSectionProps) {
  const { analytics, days, source, error } = useStrengthData({
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
        <StrengthHero analytics={analytics} source={source} />
      </div>
    </section>
  );
}
