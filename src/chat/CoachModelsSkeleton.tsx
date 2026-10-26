import { COACH_PROVIDER_ORDER } from "./coachProviders";
import { t } from "../i18n/core";

/** The same placeholder while provider code loads and while it reads settings. */
export function CoachModelsSkeleton() {
  return (
    <div className="chat-settings-panel coach-models-panel" aria-busy="true" aria-label={t("common.loading")}>
      {COACH_PROVIDER_ORDER.map((provider) => (
        <div className="coach-models-skeleton" key={provider} aria-hidden="true">
          <i className="coach-models-skeleton-title" />
          <i className="coach-models-skeleton-line" />
          <i className="coach-models-skeleton-field" />
        </div>
      ))}
    </div>
  );
}
