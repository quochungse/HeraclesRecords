import { useMemo } from "react";
import type { TrainingHubActivitySeriesPoint } from "../../electron/types";
import { formatDistanceMeters, formatDurationSeconds, formatElevationMeters } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatVerticalRate } from "../units/units";
import { rideClimbs, type ClimbCategory } from "./rideAnalysis";

interface RideClimbsPanelProps {
  /** The ride's samples on activity time. */
  series: readonly TrainingHubActivitySeriesPoint[];
}

const CATEGORY_LABELS: Record<ClimbCategory, string> = {
  HC: "HC",
  "1": "Cat 1",
  "2": "Cat 2",
  "3": "Cat 3",
  "4": "Cat 4"
};

function percent(grade: number): string {
  return `${(grade * 100).toFixed(1)}%`;
}

/**
 * The climbs on the ride, bottom to top — what a rider tells a ride by, and
 * nothing a run's page needs: a run's hills are a few hundred metres, a ride's
 * are the story of the day.
 *
 * Each is found in the samples (`rideClimbs`), categorised as Strava scores a
 * climb, and read in what riders compare climbs by: length, average and
 * steepest grade, and VAM — metres climbed an hour, which, unlike time, can be
 * set against a different hill.
 */
export function RideClimbsPanel({ series }: RideClimbsPanelProps) {
  const { unitSystem } = useUnitSystem();
  const climbs = useMemo(() => rideClimbs(series), [series]);

  if (climbs.length === 0) {
    return null;
  }

  const withPower = climbs.some((climb) => climb.avgPower !== undefined);
  const withHr = climbs.some((climb) => climb.avgHr !== undefined);

  return (
    <section className="panel run-detail-panel">
      <p className="running-eyebrow">
        {climbs.length === 1 ? "Climb" : `Climbs · ${climbs.length}`}
      </p>
      <div className="run-table-scroll">
        <table className="run-list run-surface-table ride-climb-table">
          <thead>
            <tr>
              <th scope="col">Climb</th>
              <th scope="col" className="is-numeric">Length</th>
              <th scope="col" className="is-numeric">Grade</th>
              <th scope="col" className="is-numeric" title="The steepest 200 m of it">
                Steepest
              </th>
              <th scope="col" className="is-numeric">Gain</th>
              <th scope="col" className="is-numeric">Time</th>
              <th
                scope="col"
                className="is-numeric"
                title="Vertical metres climbed an hour — the climbing rate, comparable across hills"
              >
                VAM
              </th>
              {withPower ? <th scope="col" className="is-numeric">Power</th> : null}
              {withHr ? <th scope="col" className="is-numeric">Avg HR</th> : null}
            </tr>
          </thead>
          <tbody>
            {climbs.map((climb) => (
              <tr key={climb.startMeters}>
                <td>
                  <span className="ride-climb-cat" data-category={climb.category}>
                    {CATEGORY_LABELS[climb.category]}
                  </span>
                  from {formatDistanceMeters(climb.startMeters, unitSystem)}
                </td>
                <td className="is-numeric">{formatDistanceMeters(climb.lengthMeters, unitSystem)}</td>
                <td className="is-numeric">{percent(climb.grade)}</td>
                <td className="is-numeric">
                  {climb.maxGrade === undefined ? "—" : percent(climb.maxGrade)}
                </td>
                <td className="is-numeric">{formatElevationMeters(climb.gainMeters, unitSystem)}</td>
                <td className="is-numeric">
                  {climb.seconds === undefined ? "—" : formatDurationSeconds(climb.seconds)}
                </td>
                <td className="is-numeric">
                  {climb.vam === undefined
                    ? "—"
                    : formatVerticalRate(climb.vam, unitSystem)}
                </td>
                {withPower ? (
                  <td className="is-numeric">
                    {climb.avgPower === undefined ? "—" : `${Math.round(climb.avgPower)} W`}
                  </td>
                ) : null}
                {withHr ? (
                  <td className="is-numeric">
                    {climb.avgHr === undefined ? "—" : Math.round(climb.avgHr)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">
        Found in the elevation samples: a rise is a climb once its length times
        its grade reaches a category, as Strava scores them — a kilometre at 8%
        is the least that makes Cat 4.
      </p>
    </section>
  );
}
