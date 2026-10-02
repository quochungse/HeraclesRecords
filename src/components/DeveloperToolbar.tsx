import { Sparkles } from "lucide-react";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { SampleDataControls } from "./SampleDataControls";

interface DeveloperToolbarProps {
  api: HeraclesRecordsApi | undefined;
  /** Dev view exposes development-only destinations and the tools below. */
  developmentViewActive: boolean;
  onDevelopmentViewToggle: () => void;
  /** Non-null while a fake "update available" state is being simulated. */
  updateSimulationActive: boolean;
  onToggleUpdateSimulation: () => void;
  /** The Strength screen's generated sample history. */
  strengthSampleActive: boolean;
  onStrengthSampleChange: (active: boolean) => void;
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
  developmentViewActive,
  onDevelopmentViewToggle,
  updateSimulationActive,
  onToggleUpdateSimulation,
  strengthSampleActive,
  onStrengthSampleChange,
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

            <SampleDataControls
              api={api}
              strengthSampleActive={strengthSampleActive}
              onStrengthSampleChange={onStrengthSampleChange}
              onError={onError}
            />
          </>
        ) : null}
      </div>
    </header>
  );
}
