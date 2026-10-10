import { useId, useState } from "react";
import {
  Database,
  Eye,
  EyeOff,
  Globe2,
  Loader2,
  LogOut,
  RefreshCw,
  User
} from "lucide-react";
import type { TrainingHubStatus } from "../../../electron/types";
import { SettingsPrefRow } from "../../settings/SettingsPrefRow";
import { t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";

export interface CorosConnectionRowProps {
  status: TrainingHubStatus | null;
  busy: string | null;
  onRefresh: () => void;
  onLogout: () => void;
}

/**
 * The connected-account row for the COROS Training Hub session. It is the first
 * row of the Connections section in Settings; Overview only renders the sign-in
 * surface, so this row is the single place a connected session is reviewed,
 * refreshed, or dropped.
 *
 * Renders nothing while no session is authenticated — Settings shows its own
 * disconnected row in that case.
 */
export function CorosConnectionRow({
  status,
  busy,
  onRefresh,
  onLogout
}: CorosConnectionRowProps) {
  useI18n();
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const detailsId = useId();

  if (!status?.authenticated) {
    return null;
  }

  // The connected account, in the same shape as the two rows below it: a row
  // of the Connections card like every other, the dot before its title the
  // only thing saying it is connected, the line under it spent on the account.
  // Region and host are not on it: Details carries both, and the address is
  // the part worth reading at a glance. Details opens under the buttons, in the
  // control column, so the buttons do not move when it appears.
  const identity = status.email ?? t("common.connected");

  return (
    <SettingsPrefRow
      title={t("settings.coros.title")}
      detail={identity}
      tone="success"
      align={showConnectionDetails ? "start" : "center"}
    >
      <span className="settings-connection-actions">
        <button
          className="settings-row-button"
          type="button"
          aria-expanded={showConnectionDetails}
          aria-controls={detailsId}
          onClick={() => setShowConnectionDetails((current) => !current)}
        >
          {showConnectionDetails ? (
            <EyeOff size={15} aria-hidden="true" />
          ) : (
            <Eye size={15} aria-hidden="true" />
          )}
          {showConnectionDetails ? t("common.hide") : t("common.details")}
        </button>
        <button
          className="settings-row-button"
          type="button"
          disabled={busy === "training-refresh"}
          onClick={onRefresh}
        >
          {busy === "training-refresh" ? (
            <Loader2 className="spin" size={15} aria-hidden="true" />
          ) : (
            <RefreshCw size={15} aria-hidden="true" />
          )}
          {t("common.refresh")}
        </button>
        <button
          className="settings-row-button is-danger"
          type="button"
          disabled={busy === "training-logout"}
          onClick={onLogout}
        >
          <LogOut size={15} aria-hidden="true" />
          {t("common.disconnect")}
        </button>
      </span>
      {showConnectionDetails ? (
        <span className="settings-connection-meta" id={detailsId}>
          <span>
            <User size={13} aria-hidden="true" />
            {t("settings.coros.userId")}
            <strong>{status.userId ?? t("common.unknown")}</strong>
          </span>
          <span>
            <Globe2 size={13} aria-hidden="true" />
            {t("settings.coros.region")}
            <strong>{status.regionId ?? t("common.unknown")}</strong>
          </span>
          <span>
            <Database size={13} aria-hidden="true" />
            {t("settings.coros.apiHost")}
            <strong>{status.baseUrl ?? t("common.unknown")}</strong>
          </span>
        </span>
      ) : null}
    </SettingsPrefRow>
  );
}
