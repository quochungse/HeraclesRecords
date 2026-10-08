import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatPaceSecondsPerKm
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { distanceUnit, elevationUnit, formatVerticalRate } from "../units/units";
import { climbPerDistanceUnit, runSurfaceBreakdown } from "./runMetrics";
import { RUN_SURFACE_LABELS } from "./runSurface";
import { runSurfaceColors } from "./runSurfaceColors";

import { t } from "../i18n/core";
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
      <p className="running-eyebrow">{t("run.surface")}</p>

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
            <th scope="col">{t("run.surface")}</th>
            <th scope="col" className="is-numeric">{t("run.share")}</th>
            <th scope="col" className="is-numeric">{t("activity.m.distance")}</th>
            <th scope="col" className="is-numeric">{t("run.runs")}</th>
            <th scope="col" className="is-numeric">{t("activity.m.pace")}</th>
            <th scope="col" className="is-numeric">
              {t("run.climbPer", { unit: distanceUnit(unitSystem) })}
            </th>
            <th scope="col" className="is-numeric" title={t("run.vamTitle")}>
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
                  : `${Math.round(climbPerDistanceUnit(entry.elevationPerKm, unitSystem))} ${elevationUnit(unitSystem)}`}
              </td>
              <td className="is-numeric">
                {entry.verticalSpeed === undefined
                  ? "—"
                  : formatVerticalRate(entry.verticalSpeed, unitSystem)}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">
        {t("run.surfaceNote", { unit: distanceUnit(unitSystem) })}
      </p>
    </section>
  );
}
