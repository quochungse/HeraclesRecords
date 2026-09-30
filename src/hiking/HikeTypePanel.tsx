import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import { formatDurationSpan } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { distanceUnit, elevationUnit, metersToElevation } from "../units/units";
import { climbPerDistanceUnit, hikeTypeBreakdown } from "./hikeMetrics";
import { HIKE_TYPE_LABELS } from "./hikeType";
import { hikeTypeColors } from "./hikeTypeColors";

interface HikeTypePanelProps {
  /** Deliberately unfiltered by kind: this panel *is* the split by kind. */
  hikes: readonly TrainingHubActivity[];
}

/**
 * Hikes against mountain climbs: how the time on the trail divided, and how
 * the ground differed. The one block the kind filter does not narrow — the
 * comparison is the content, as on Running's surfaces and Cycling's bikes.
 */
export function HikeTypePanel({ hikes }: HikeTypePanelProps) {
  const { unitSystem } = useUnitSystem();
  const palette = useMemo(() => hikeTypeColors(), []);
  const breakdown = useMemo(() => hikeTypeBreakdown(hikes), [hikes]);

  if (breakdown.length === 0) {
    return null;
  }

  return (
    <section className="panel run-block">
      <p className="running-eyebrow">Kinds</p>

      {breakdown.length > 1 ? (
        <div className="run-surface-bar">
          {breakdown.map((entry) => (
            <div
              key={entry.type}
              style={{ flexGrow: Math.max(entry.share, 0.02), background: palette[entry.type] }}
              title={`${HIKE_TYPE_LABELS[entry.type]}: ${Math.round(entry.share * 100)}% of recorded time`}
            />
          ))}
        </div>
      ) : null}

      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col" className="is-numeric" title="Share of recorded time">
                Share
              </th>
              <th scope="col" className="is-numeric">Hikes</th>
              <th scope="col" className="is-numeric">Time</th>
              <th scope="col" className="is-numeric">
                Ascent/{distanceUnit(unitSystem)}
              </th>
              <th scope="col" className="is-numeric" title="Metres climbed an hour of recorded time">
                Ascent/h
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((entry) => (
              <tr key={entry.type}>
                <td>
                  <span className="run-surface-swatch" style={{ background: palette[entry.type] }} />
                  {HIKE_TYPE_LABELS[entry.type]}
                </td>
                <td className="is-numeric">{Math.round(entry.share * 100)}%</td>
                <td className="is-numeric">{entry.count}</td>
                <td className="is-numeric">{formatDurationSpan(entry.duration)}</td>
                <td className="is-numeric">
                  {entry.elevationPerKm === undefined
                    ? "—"
                    : `${Math.round(climbPerDistanceUnit(entry.elevationPerKm, unitSystem))} ${elevationUnit(unitSystem)}`}
                </td>
                <td className="is-numeric">
                  {entry.ascentRate === undefined
                    ? "—"
                    : `${Math.round(metersToElevation(entry.ascentRate, unitSystem))} ${elevationUnit(unitSystem)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">
        Share is of recorded time, not distance: a mountain day covers
        little ground and is no less of the season. Ascent an hour is over the
        recorded time with every stop in it, as COROS records a hike with
        auto-pause off — a hike's own page works out its moving time.
      </p>
    </section>
  );
}
