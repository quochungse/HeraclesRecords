import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatPaceSecondsPerKm
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { distanceUnit, elevationUnit, metersToElevation } from "../units/units";
import { runSurfaceBreakdown } from "./runMetrics";
import { RUN_SURFACE_LABELS } from "./runSurface";
import { runSurfaceColors } from "./runSurfaceColors";

interface RunSurfacePanelProps {
  /** Deliberately unfiltered by surface: this panel *is* the surface split. */
  runs: readonly TrainingHubActivity[];
}

/**
 * Where the running happened, and how it differed there.
 *
 * The one block the surface filter does not narrow — a breakdown of four things
 * filtered to one of them is a single bar, and the comparison is the content.
 */
export function RunSurfacePanel({ runs }: RunSurfacePanelProps) {
  const { unitSystem } = useUnitSystem();
  const palette = useMemo(() => runSurfaceColors(), []);
  const breakdown = useMemo(() => runSurfaceBreakdown(runs), [runs]);

  if (breakdown.length === 0) {
    return null;
  }

  return (
    <section className="panel run-block">
      <p className="running-eyebrow">Surface</p>

      {/* A proportion bar of one thing is a full-width rectangle saying 100%,
          which the table below already says in a word. */}
      {breakdown.length > 1 ? (
        <div className="run-surface-bar">
          {breakdown.map((entry) => (
            <div
              key={entry.surface}
              style={{ flexGrow: Math.max(entry.share, 0.02), background: palette[entry.surface] }}
              title={`${RUN_SURFACE_LABELS[entry.surface]}: ${Math.round(entry.share * 100)}%`}
            />
          ))}
        </div>
      ) : null}

      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
        <thead>
          <tr>
            <th scope="col">Surface</th>
            <th scope="col" className="is-numeric">Share</th>
            <th scope="col" className="is-numeric">Distance</th>
            <th scope="col" className="is-numeric">Runs</th>
            <th scope="col" className="is-numeric">Pace</th>
            <th scope="col" className="is-numeric">Climb/km</th>
            <th scope="col" className="is-numeric" title="Metres climbed per hour">
              VAM
            </th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((entry) => (
            <tr key={entry.surface}>
              <td>
                <span className="run-surface-swatch" style={{ background: palette[entry.surface] }} />
                {RUN_SURFACE_LABELS[entry.surface]}
              </td>
              <td className="is-numeric">{Math.round(entry.share * 100)}%</td>
              <td className="is-numeric">
                {formatDistanceMeters(entry.distance, unitSystem)}
              </td>
              <td className="is-numeric">{entry.count}</td>
              <td className="is-numeric">
                {formatPaceSecondsPerKm(entry.pace, unitSystem)}
              </td>
              <td className="is-numeric">
                {entry.elevationPerKm === undefined
                  ? "—"
                  : `${Math.round(metersToElevation(entry.elevationPerKm, unitSystem))} ${elevationUnit(unitSystem)}`}
              </td>
              <td className="is-numeric">
                {entry.verticalSpeed === undefined
                  ? "—"
                  : `${Math.round(metersToElevation(entry.verticalSpeed, unitSystem))} ${elevationUnit(unitSystem)}/h`}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">
        Pace is total time over total distance, so it is the surface's own
        average rather than the mean of its runs. A treadmill records no terrain,
        which is why its climb columns are blank rather than zero.
        {" "}Distances are shown in {distanceUnit(unitSystem)}.
      </p>
    </section>
  );
}
