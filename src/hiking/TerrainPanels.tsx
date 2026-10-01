import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatPaceSecondsPerKm
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatSpeedValue, formatVerticalRate, metersToElevation } from "../units/units";
import type { HikeLeg, TerrainKind, TerrainShare } from "./hikeAnalysis";

/**
 * The hike page's two readings of the ground, drawn for a trail run too.
 *
 * Both come out of `hikeAnalysis.ts`, which never asked what sport it was
 * reading: it splits a day into climbing, flat and descending by the grade of
 * every 25 m, and names the ascents and descents in it. What differs is only
 * how movement along the ground is stated — a walker's km/h, a runner's pace —
 * and the sentence under the terrain table, which says what the way down means
 * to each of them.
 */
export type TerrainReading = "hike" | "trail";

const TERRAIN_LABELS: Record<TerrainKind, string> = {
  up: "Climbing",
  flat: "Flat",
  down: "Descending"
};

/**
 * Climbing, flat and descending, by the grade of every 25 m and on the moving
 * clock. The bar is time, because time is what the ground cost.
 */
export function TerrainPanel({
  terrain,
  reading
}: {
  terrain: readonly TerrainShare[];
  reading: TerrainReading;
}) {
  const { unitSystem } = useUnitSystem();
  const totalSeconds = terrain.reduce((sum, share) => sum + share.seconds, 0);
  const pace = reading === "trail";

  return (
    <section className="panel run-detail-panel">
      <p className="running-eyebrow">Terrain</p>
      {totalSeconds > 0 ? (
        <div className="run-surface-bar">
          {terrain.map((share) => (
            <div
              key={share.kind}
              className={`terrain-${share.kind}`}
              style={{ flexGrow: Math.max(share.seconds / totalSeconds, 0.02) }}
              title={`${TERRAIN_LABELS[share.kind]}: ${Math.round((share.seconds / totalSeconds) * 100)}% of the moving time`}
            />
          ))}
        </div>
      ) : null}
      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">Ground</th>
              <th scope="col" className="is-numeric">Distance</th>
              <th scope="col" className="is-numeric">Time</th>
              <th scope="col" className="is-numeric">{pace ? "Pace" : "Speed"}</th>
              <th scope="col" className="is-numeric">Height</th>
              <th
                scope="col"
                className="is-numeric"
                title="Metres gained an hour on the climbs, lost an hour on the descents"
              >
                Vertical rate
              </th>
              <th scope="col" className="is-numeric">Avg HR</th>
            </tr>
          </thead>
          <tbody>
            {terrain.map((share) => (
              <tr key={share.kind}>
                <td>
                  <span className={`run-surface-swatch terrain-${share.kind}`} />
                  {TERRAIN_LABELS[share.kind]}
                </td>
                <td className="is-numeric">{formatDistanceMeters(share.distance, unitSystem)}</td>
                <td className="is-numeric">{formatDurationSeconds(share.seconds)}</td>
                <td className="is-numeric">
                  {share.speed === undefined || share.speed <= 0
                    ? "—"
                    : pace
                      ? formatPaceSecondsPerKm(3600 / share.speed, unitSystem)
                      : formatSpeedValue(share.speed, unitSystem)}
                </td>
                <td className="is-numeric">
                  {share.kind === "flat"
                    ? "—"
                    : `${share.kind === "up" ? "+" : "−"}${formatElevationMeters(share.height, unitSystem)}`}
                </td>
                <td className="is-numeric">
                  {share.verticalRate === undefined ? "—" : formatVerticalRate(share.verticalRate, unitSystem)}
                </td>
                <td className="is-numeric">
                  {share.avgHr === undefined ? "—" : Math.round(share.avgHr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">
        {pace
          ? "Steeper than 4% either way is climbing or descending, timed on the moving clock. On a trail the way down is where a race is won or lost: a descending pace close to the flat one is technical ground, or legs holding back."
          : "Steeper than 4% either way is climbing or descending. On a mountain the way down is half the day: a descending rate close to the climbing one is steep, technical ground rather than a slow walker."}
      </p>
    </section>
  );
}

/** The ascents and descents of the day, in the order they were covered. */
export function ClimbsPanel({ legs }: { legs: readonly HikeLeg[] }) {
  const { unitSystem } = useUnitSystem();
  const ascents = legs.filter((leg) => leg.direction === "up").length;
  const descents = legs.length - ascents;
  const withHr = legs.some((leg) => leg.avgHr !== undefined);

  return (
    <section className="panel run-detail-panel">
      <p className="running-eyebrow">
        {[
          ascents > 0 ? `${ascents} ${ascents === 1 ? "ascent" : "ascents"}` : null,
          descents > 0 ? `${descents} ${descents === 1 ? "descent" : "descents"}` : null
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col" className="is-numeric">Altitude</th>
              <th scope="col" className="is-numeric">Length</th>
              <th scope="col" className="is-numeric">Height</th>
              <th scope="col" className="is-numeric">Grade</th>
              <th scope="col" className="is-numeric" title="Moving time on it">
                Time
              </th>
              <th scope="col" className="is-numeric" title="Metres gained or lost an hour">
                Rate
              </th>
              {withHr ? <th scope="col" className="is-numeric">Avg HR</th> : null}
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr key={leg.startMeters}>
                <td>
                  <span className="terrain-leg-dir" data-direction={leg.direction}>
                    {leg.direction === "up" ? "Up" : "Down"}
                  </span>
                  from {formatDistanceMeters(leg.startMeters, unitSystem)}
                </td>
                <td className="is-numeric">
                  {Math.round(metersToElevation(leg.fromAltitude, unitSystem))}→
                  {formatElevationMeters(leg.toAltitude, unitSystem)}
                </td>
                <td className="is-numeric">{formatDistanceMeters(leg.lengthMeters, unitSystem)}</td>
                <td className="is-numeric">
                  {leg.direction === "up" ? "+" : "−"}
                  {formatElevationMeters(leg.height, unitSystem)}
                </td>
                <td className="is-numeric">{`${(leg.grade * 100).toFixed(0)}%`}</td>
                <td className="is-numeric">{formatDurationSeconds(leg.seconds)}</td>
                <td className="is-numeric">
                  {leg.verticalRate === undefined ? "—" : formatVerticalRate(leg.verticalRate, unitSystem)}
                </td>
                {withHr ? (
                  <td className="is-numeric">
                    {leg.avgHr === undefined ? "—" : Math.round(leg.avgHr)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">
        A leg runs from a low point to the next high one, or back, carried
        through any dip of less than 30 m; one that gains or loses under 60 m
        is the ground rolling, and is left out. Time is moving time.
      </p>
    </section>
  );
}
