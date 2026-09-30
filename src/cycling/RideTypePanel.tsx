import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import { formatDurationSpan } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  formatSpeedValue
} from "../units/units";
import { climbPerDistanceUnit, rideTypeBreakdown } from "./rideMetrics";
import { RIDE_TYPE_LABELS } from "./rideType";
import { rideTypeColors } from "./rideTypeColors";

interface RideTypePanelProps {
  /** Deliberately unfiltered by kind: this panel *is* the split by kind. */
  rides: readonly TrainingHubActivity[];
}

/**
 * Which bikes the riding was done on, and how it differed on each.
 *
 * The one block the kind filter does not narrow, for the reason Running's
 * surface panel is not: a breakdown of five things filtered to one of them is
 * a single bar, and the comparison is the content.
 */
export function RideTypePanel({ rides }: RideTypePanelProps) {
  const { unitSystem } = useUnitSystem();
  const palette = useMemo(() => rideTypeColors(), []);
  const breakdown = useMemo(() => rideTypeBreakdown(rides), [rides]);

  if (breakdown.length === 0) {
    return null;
  }

  return (
    <section className="panel run-block">
      <p className="running-eyebrow">Bikes</p>

      {breakdown.length > 1 ? (
        <div className="run-surface-bar">
          {breakdown.map((entry) => (
            <div
              key={entry.type}
              style={{ flexGrow: Math.max(entry.share, 0.02), background: palette[entry.type] }}
              title={`${RIDE_TYPE_LABELS[entry.type]}: ${Math.round(entry.share * 100)}% of riding time`}
            />
          ))}
        </div>
      ) : null}

      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">Bike</th>
              <th scope="col" className="is-numeric" title="Share of riding time">
                Share
              </th>
              <th scope="col" className="is-numeric">Rides</th>
              <th scope="col" className="is-numeric">Time</th>
              <th scope="col" className="is-numeric">Speed</th>
              <th scope="col" className="is-numeric">
                Climb/{distanceUnit(unitSystem)}
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((entry) => (
              <tr key={entry.type}>
                <td>
                  <span className="run-surface-swatch" style={{ background: palette[entry.type] }} />
                  {RIDE_TYPE_LABELS[entry.type]}
                </td>
                <td className="is-numeric">{Math.round(entry.share * 100)}%</td>
                <td className="is-numeric">{entry.count}</td>
                <td className="is-numeric">{formatDurationSpan(entry.duration)}</td>
                <td className="is-numeric">
                  {entry.speed === undefined ? "—" : formatSpeedValue(entry.speed, unitSystem)}
                </td>
                <td className="is-numeric">
                  {entry.elevationPerKm === undefined
                    ? "—"
                    : `${Math.round(climbPerDistanceUnit(entry.elevationPerKm, unitSystem))} ${elevationUnit(unitSystem)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">
        Share is of riding time, not distance: an hour off-road covers less
        ground than an hour on the road and is no less of the week. Speed is
        total distance over the time that recorded one, so a trainer that
        measured nothing does not pull it down. An indoor ride has no terrain,
        which is why its climb is blank rather than zero.
      </p>
    </section>
  );
}
