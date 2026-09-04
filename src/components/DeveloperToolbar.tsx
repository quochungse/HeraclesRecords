import { Sparkles } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { WatchStatus } from "../../electron/types";
import { StatusDot } from "./StatusDot";
import { WatchConnectionSmokeControls } from "./WatchConnectionSmokeControls";

interface DeveloperToolbarProps {
  api: CorosLinkApi | undefined;
  watchStatus: WatchStatus | null;
  /** Dev view exposes development-only destinations and the tools below. */
  developmentViewActive: boolean;
  onDevelopmentViewToggle: () => void;
  /** Non-null while a fake "update available" state is being simulated. */
  updateSimulationActive: boolean;
  onToggleUpdateSimulation: () => void;
  onWatchStatusChange: (status: WatchStatus) => void;
  onError: (message: string) => void;
}

/**
 * The strip across the top of the window, kept for development and manual
 * testing only. App.tsx renders it exclusively in unpackaged builds, so
 * nothing here reaches a released app — see the drag-strip note in App.tsx for
 * what a packaged macOS build puts in its place.
 */
export function DeveloperToolbar({
  api,
  watchStatus,
  developmentViewActive,
  onDevelopmentViewToggle,
  updateSimulationActive,
  onToggleUpdateSimulation,
  onWatchStatusChange,
  onError,
}: DeveloperToolbarProps) {
  return (
    <header className="dev-toolbar">
      <div className="dev-toolbar-end">
        <button
          className="app-dev-view-toggle"
          type="button"
          aria-pressed={developmentViewActive}
          title={
            developmentViewActive
              ? "Switch to production view"
              : "Switch to developer view"
          }
          onClick={onDevelopmentViewToggle}
        >
          {developmentViewActive ? "Dev view" : "Prod view"}
        </button>

        {developmentViewActive ? (
          <>
            <button
              className="app-dev-view-toggle app-dev-update-test"
              type="button"
              aria-pressed={updateSimulationActive}
              title={
                updateSimulationActive
                  ? "Clear the simulated update"
                  : "Simulate an available update for this session"
              }
              onClick={onToggleUpdateSimulation}
            >
              <Sparkles size={13} aria-hidden="true" />
              {updateSimulationActive ? "Clear test" : "Test update"}
            </button>

            <WatchConnectionSmokeControls
              api={api}
              onWatchStatusChange={onWatchStatusChange}
              onError={onError}
            />
          </>
        ) : null}

        <div
          className={`watch-status-chip${watchStatus?.connected ? " connected" : ""}`}
          title={watchStatus?.rootPath ?? "No watch volume found"}
        >
          <StatusDot connected={Boolean(watchStatus?.connected)} />
          <span>
            {watchStatus?.connected
              ? (watchStatus.name ?? "Connected")
              : "No watch"}
          </span>
        </div>
      </div>
    </header>
  );
}
