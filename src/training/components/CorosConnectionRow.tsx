import { useId, useState } from "react";
import {
  Database,
  Eye,
  EyeOff,
  Globe2,
  Loader2,
  LogOut,
  RefreshCw,
  User,
  Watch
} from "lucide-react";
import type { TrainingHubStatus } from "../../../electron/types";

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
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const detailsId = useId();

  if (!status?.authenticated) {
    return null;
  }

  // The connected account, in the same shape as the two rows below it.
  //
  // It used to be a bar of its own — a status dot, a "COROS account connected"
  // sentence, an "Authenticated" badge and three buttons, on its own glass
  // frame — sitting first in a list of otherwise identical nav rows, so the one
  // row that matters most was the one that looked like it belonged to another
  // screen. The state it was spending three elements on is binary and this
  // component only renders at all when it is true, so the tinted icon says it
  // and the line underneath spends its room on the account instead. Region and
  // host are not on it: Details already carries both, and the address is the
  // part worth reading at a glance.
  const identity = status.email ?? "Connected";

  return (
    <div className="settings-nav-row is-static">
      <span className="settings-nav-row-icon is-connected" aria-hidden="true">
        <Watch size={20} strokeWidth={1.9} />
      </span>
      <span className="settings-nav-row-copy">
        <strong>COROS account</strong>
        <span>{identity}</span>
      </span>
      <span className="settings-connection-actions">
        <button
          className="settings-row-button"
          type="button"
          aria-expanded={showConnectionDetails}
          aria-controls={detailsId}
          onClick={() => setShowConnectionDetails((current) => !current)}
        >
          {showConnectionDetails ? (
            <EyeOff size={14} aria-hidden="true" />
          ) : (
            <Eye size={14} aria-hidden="true" />
          )}
          {showConnectionDetails ? "Hide" : "Details"}
        </button>
        <button
          className="settings-row-button"
          type="button"
          disabled={busy === "training-refresh"}
          onClick={onRefresh}
        >
          {busy === "training-refresh" ? (
            <Loader2 className="spin" size={14} aria-hidden="true" />
          ) : (
            <RefreshCw size={14} aria-hidden="true" />
          )}
          Refresh
        </button>
        <button
          className="settings-row-button is-danger"
          type="button"
          disabled={busy === "training-logout"}
          onClick={onLogout}
        >
          <LogOut size={14} aria-hidden="true" />
          Disconnect
        </button>
      </span>
      {showConnectionDetails ? (
        // Same second-line slot the Sync panel's destination row uses, so an
        // expanded row grows downward instead of pushing its controls around.
        <span className="settings-connection-meta" id={detailsId}>
          <span>
            <User size={13} aria-hidden="true" />
            User ID
            <strong>{status.userId ?? "Unknown"}</strong>
          </span>
          <span>
            <Globe2 size={13} aria-hidden="true" />
            Region
            <strong>{status.regionId ?? "Unknown"}</strong>
          </span>
          <span>
            <Database size={13} aria-hidden="true" />
            API host
            <strong>{status.baseUrl ?? "Unknown"}</strong>
          </span>
        </span>
      ) : null}
    </div>
  );
}
