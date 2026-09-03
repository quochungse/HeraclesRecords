import { useState } from "react";
import {
  Database,
  Eye,
  EyeOff,
  Globe2,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  User
} from "lucide-react";
import type { TrainingHubStatus } from "../../../electron/types";

export interface CorosConnectionCardProps {
  status: TrainingHubStatus | null;
  busy: string | null;
  onRefresh: () => void;
  onLogout: () => void;
}

/**
 * The connected-account bar for the COROS Training Hub session. It lives at the
 * top of Settings; Overview only renders the sign-in surface, so this card is
 * the single place a connected session is reviewed, refreshed, or dropped.
 *
 * Renders nothing while no session is authenticated.
 */
export function CorosConnectionCard({
  status,
  busy,
  onRefresh,
  onLogout
}: CorosConnectionCardProps) {
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);

  if (!status?.authenticated) {
    return null;
  }

  return (
    <section className="panel training-command-center is-connected is-compact">
      <div className="training-connection-shell">
        <div className="training-connection-bar">
          <div className="training-connection-primary">
            <span
              className="training-status-dot is-connected"
              aria-hidden="true"
            />
            <span className="training-connection-label">
              COROS account connected
            </span>
            <span className="badge ready">
              <ShieldCheck size={12} aria-hidden="true" />
              Authenticated
            </span>
          </div>
          <div className="training-connection-actions settings-actions">
            <button
              className="training-details-button"
              type="button"
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
              className="secondary-button training-connection-button"
              type="button"
              disabled={busy === "training-refresh"}
              onClick={onRefresh}
            >
              {busy === "training-refresh" ? (
                <Loader2 className="spin" size={15} aria-hidden="true" />
              ) : (
                <RefreshCw size={15} aria-hidden="true" />
              )}
              Refresh
            </button>
            <button
              className="secondary-button danger-button training-connection-button"
              type="button"
              disabled={busy === "training-logout"}
              onClick={onLogout}
            >
              <LogOut size={15} aria-hidden="true" />
              Disconnect
            </button>
          </div>
        </div>
        {showConnectionDetails ? (
          <div className="training-connection-meta">
            <span className="training-connection-meta-item">
              <User size={14} aria-hidden="true" />
              <span>User ID</span>
              <strong>{status.userId ?? "Unknown"}</strong>
            </span>
            <span className="training-connection-meta-item">
              <Globe2 size={14} aria-hidden="true" />
              <span>Region</span>
              <strong>{status.regionId ?? "Unknown"}</strong>
            </span>
            <span className="training-connection-meta-item">
              <Database size={14} aria-hidden="true" />
              <span>API host</span>
              <strong>{status.baseUrl ?? "Unknown"}</strong>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
