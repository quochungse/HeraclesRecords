import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatPaceSecondsPerKm
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatSpeedValue, formatVerticalRate, metersToElevation } from "../units/units";
import type { HikeLeg, TerrainKind, TerrainShare } from "./hikeAnalysis";

import { formatDecimal, plural, t } from "../i18n/core";
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

const TERRAIN_LABELS: Readonly<Record<TerrainKind, string>> = {
  get up() {
    return t("hike.terrain.up");
  },
  get flat() {
    return t("hike.terrain.flat");
  },
  get down() {
    return t("hike.terrain.down");
  }
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
      <p className="running-eyebrow">{t("hike.terrain.title")}</p>
      {totalSeconds > 0 ? (
        <div className="run-surface-bar">
          {terrain.map((share) => (
            <div
              key={share.kind}
              className={`terrain-${share.kind}`}
              style={{ flexGrow: Math.max(share.seconds / totalSeconds, 0.02) }}
              title={t("hike.terrain.share", { kind: TERRAIN_LABELS[share.kind], percent: Math.round((share.seconds / totalSeconds) * 100) })}
            />
          ))}
        </div>
      ) : null}
      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">{t("hike.terrain.ground")}</th>
              <th scope="col" className="is-numeric">{t("activity.m.distance")}</th>
              <th scope="col" className="is-numeric">{t("activity.m.time")}</th>
              <th scope="col" className="is-numeric">{pace ? t("activity.m.pace") : t("activity.m.speed")}</th>
              <th scope="col" className="is-numeric">{t("hike.terrain.height")}</th>
              <th
                scope="col"
                className="is-numeric"
                title={t("hike.terrain.verticalTitle")}
              >
                {t("hike.terrain.vertical")}
              </th>
              <th scope="col" className="is-numeric">{t("activity.m.avgHr")}</th>
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
          ? t("hike.terrain.noteTrail")
          : t("hike.terrain.noteHike")}
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
          ascents > 0 ? plural("hike.legs.ascents", ascents) : null,
          descents > 0 ? plural("hike.legs.descents", descents) : null
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">{t("hike.legs.leg")}</th>
              <th scope="col" className="is-numeric">{t("hike.legs.altitude")}</th>
              <th scope="col" className="is-numeric">{t("ride.climbs.length")}</th>
              <th scope="col" className="is-numeric">{t("hike.terrain.height")}</th>
              <th scope="col" className="is-numeric">{t("ride.climbs.grade")}</th>
              <th scope="col" className="is-numeric" title={t("hike.legs.timeTitle")}>
                {t("activity.m.time")}
              </th>
              <th scope="col" className="is-numeric" title={t("hike.legs.rateTitle")}>
                {t("hike.legs.rate")}
              </th>
              {withHr ? <th scope="col" className="is-numeric">{t("activity.m.avgHr")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr key={leg.startMeters}>
                <td>
                  <span className="terrain-leg-dir" data-direction={leg.direction}>
                    {leg.direction === "up" ? t("hike.legs.up") : t("hike.legs.down")}
                  </span>
                  {t("ride.climbs.from", { distance: formatDistanceMeters(leg.startMeters, unitSystem) })}
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
                <td className="is-numeric">{`${formatDecimal(leg.grade * 100, 0)}%`}</td>
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
