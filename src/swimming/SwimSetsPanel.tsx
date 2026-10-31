import { Fragment, useMemo } from "react";
import type { TrainingHubSwimInterval } from "../../electron/types";
import { secondsPer100m } from "../../electron/swimDetail";
import { formatDistanceMeters, formatDurationSeconds } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatClock, formatPer100, swimSets } from "./swimMetrics";
import { SWIM_STYLE_LABELS } from "./swimType";
import { formatDecimal, t } from "../i18n/core";

const COLUMNS = 10;

/**
 * The intervals as the watch split them at each rest, under the sets they
 * make: each one's stroke, distance, time, pace, strokes a length, SWOLF,
 * stroke rate, heart rate, and the rest taken after it.
 */
export function SwimSetsPanel({
  intervals,
  openWater = false
}: {
  intervals: readonly TrainingHubSwimInterval[];
  /** Open water's intervals are the watch's distance laps: no stroke, no lengths. */
  openWater?: boolean;
}) {
  const { unitSystem } = useUnitSystem();
  const sets = useMemo(() => (openWater ? [] : swimSets(intervals)), [intervals, openWater]);
  const setAt = new Map(sets.map((set) => [set.start, set]));

  return (
    <section className="panel run-detail-panel">
      <p className="running-eyebrow">{openWater ? t("swim.sets.splits") : t("swim.sets.title")}</p>
      <div className="run-table-scroll">
        <table className="run-list run-lap-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              {openWater ? null : <th scope="col">{t("swim.m.stroke")}</th>}
              <th scope="col" className="is-numeric">{t("activity.m.distance")}</th>
              <th scope="col" className="is-numeric">{t("activity.m.time")}</th>
              <th scope="col" className="is-numeric">{t("activity.m.pace")}</th>
              {openWater ? null : (
                <>
                  <th scope="col" className="is-numeric" title={t("swim.m.strokesTitle")}>
                    {t("swim.m.strokesPerLength")}
                  </th>
                  <th scope="col" className="is-numeric" title={t("swim.m.swolfTitle")}>
                    {t("swim.m.swolf")}
                  </th>
                </>
              )}
              <th scope="col" className="is-numeric" title={t("swim.m.strokeRateTitle")}>
                {t("swim.m.strokeRate")}
              </th>
              <th scope="col" className="is-numeric">{t("activity.m.avgHr")}</th>
              {openWater ? null : (
                <th scope="col" className="is-numeric" title={t("swim.sets.restTitle")}>
                  {t("swim.sets.rest")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {intervals.map((interval, position) => {
              const set = setAt.get(position);
              const strokesPerLength =
                interval.strokes !== undefined && interval.lengths ? interval.strokes / interval.lengths : undefined;
              return (
                <Fragment key={interval.index}>
                  {set ? (
                    <tr className="swim-set-row">
                      <th scope="rowgroup" colSpan={COLUMNS}>
                        {t("swim.sets.set", {
                          count: set.count,
                          distance: formatDistanceMeters(set.distance, unitSystem, true),
                          style: SWIM_STYLE_LABELS[set.style]
                        })}
                        <span>
                          {[
                            set.pace !== undefined ? formatPer100(set.pace, unitSystem) : null,
                            set.rest !== undefined ? t("swim.sets.setRest", { rest: formatDurationSeconds(set.rest) }) : null
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </th>
                    </tr>
                  ) : null}
                  <tr className="run-lap-row">
                    <td>{interval.index}</td>
                    {openWater ? null : (
                      <td>
                        <span className={`swim-style-tag swim-style-${interval.style}`}>
                          {SWIM_STYLE_LABELS[interval.style]}
                        </span>
                      </td>
                    )}
                    <td className="is-numeric">{formatDistanceMeters(interval.distance, unitSystem, true)}</td>
                    <td className="is-numeric">{formatClock(interval.seconds)}</td>
                    <td className="is-numeric">
                      {formatPer100(secondsPer100m(interval.seconds, interval.distance), unitSystem)}
                    </td>
                    {openWater ? null : (
                      <>
                        <td className="is-numeric">
                          {strokesPerLength === undefined ? "—" : formatDecimal(strokesPerLength, 1)}
                        </td>
                        <td className="is-numeric">{interval.swolf ?? "—"}</td>
                      </>
                    )}
                    <td className="is-numeric">
                      {interval.strokeRate === undefined ? "—" : t("swim.rateValue", { value: interval.strokeRate })}
                    </td>
                    <td className="is-numeric">{interval.avgHr ?? "—"}</td>
                    {openWater ? null : (
                      <td className="is-numeric swim-rest-cell">
                        {interval.restAfter === undefined ? "—" : formatDurationSeconds(Math.round(interval.restAfter))}
                      </td>
                    )}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">{openWater ? t("swim.sets.splitsNote") : t("swim.sets.note")}</p>
    </section>
  );
}
