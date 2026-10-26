import { COACH_PROVIDER_LABELS, type CoachModelsSummary } from "./coachProviders";
import { ProviderIcon } from "./ProviderIcon";
import { t } from "../i18n/core";

/** Connected providers in app Settings. */
export function CoachProviderSummary({ summary }: { summary: CoachModelsSummary | null }) {
  if (!summary) return <span>{t("settings.mcp.checking")}</span>;
  if (summary.connected === 0) return <span>{t("settings.coachModels.none")}</span>;

  return (
    <span className="coach-provider-summary" role="list">
      {summary.connectedProviders.map((provider) => (
        <span className="coach-provider-summary-row" role="listitem" data-provider={provider} key={provider}>
          <span className="coach-provider-summary-icon">
            <ProviderIcon provider={provider} />
          </span>
          <span>{COACH_PROVIDER_LABELS[provider]}</span>
        </span>
      ))}
    </span>
  );
}
