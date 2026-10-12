import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import type { RecordsSamplePreset } from "../records/sampleRecords";
import { OptionGroup, type OptionGroupOption } from "./OptionGroup";
import { SampleDataControls } from "./SampleDataControls";
import {
  UPDATE_SCENARIO_ORDER,
  UPDATE_SCENARIOS,
  type UpdateScenario,
} from "./updateSimulation";

type UpdateScenarioChoice = UpdateScenario | "off";

const UPDATE_SCENARIO_OPTIONS: readonly OptionGroupOption<UpdateScenarioChoice>[] = [
  { value: "off", label: "Test update", detail: "Show the real update status." },
  ...UPDATE_SCENARIO_ORDER.map((value) => ({
    value,
    label: `Test: ${UPDATE_SCENARIOS[value].label}`,
    detail: UPDATE_SCENARIOS[value].detail,
  })),
];

interface DeveloperToolbarProps {
  api: HeraclesRecordsApi | undefined;
  /** Dev view exposes development-only destinations and the tools below. */
  developmentViewActive: boolean;
  onDevelopmentViewToggle: () => void;
  /**
   * The Test update scenario running, or null. Picking one starts it from the
   * available prompt; picking it again restarts it; "Test update" clears it.
   */
  updateScenario: UpdateScenario | null;
  onUpdateScenarioChange: (scenario: UpdateScenario | null) => void;
  /** The Strength screen's generated sample history. */
  strengthSampleActive: boolean;
  onStrengthSampleChange: (active: boolean) => void;
  /** The Hall of Records' sample history, one preset at a time. */
  recordsSample: RecordsSamplePreset | null;
  onRecordsSampleChange: (preset: RecordsSamplePreset | null) => void;
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
  updateScenario,
  onUpdateScenarioChange,
  strengthSampleActive,
  onStrengthSampleChange,
  recordsSample,
  onRecordsSampleChange,
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
            <OptionGroup
              mode="dropdown"
              label="Simulate an app update"
              options={UPDATE_SCENARIO_OPTIONS}
              value={updateScenario ?? "off"}
              minMenuWidth={320}
              onChange={(next) =>
                onUpdateScenarioChange(next === "off" ? null : next)
              }
            />

            <SampleDataControls
              api={api}
              strengthSampleActive={strengthSampleActive}
              onStrengthSampleChange={onStrengthSampleChange}
              recordsSample={recordsSample}
              onRecordsSampleChange={onRecordsSampleChange}
              onError={onError}
            />
          </>
        ) : null}
      </div>
    </header>
  );
}
