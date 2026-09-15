import { useMemo, type CSSProperties } from "react";
import { MUSCLE_BY_ID } from "./muscles";
import type { StrengthAnalytics } from "./strengthAnalytics";
import {
  WEEKLY_SET_LANDMARK,
  buildWeeklyVolumeLandmarks,
  type LandmarkStatus
} from "./strengthLandmarks";

const STATUS_WORD: Record<LandmarkStatus, string> = {
  below: "Under",
  within: "",
  above: "Over"
};

/** Never narrower than a little past the landmark, so an all-light history still shows the band. */
const MIN_SCALE_SETS = 25;

/**
 * Deliberately not `formatSets` from the analytics, which rounds anything from
 * 10 up to a whole number: this panel's whole job is the distance to 10 and to
 * 20, and "20 Over" reads as a contradiction where "20.4 Over" reads as a fact.
 */
function formatLandmarkSets(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

interface StrengthVolumeLandmarksProps {
  analytics: StrengthAnalytics;
  windowDays: number;
}

/**
 * Average weekly sets per muscle over the last whole weeks, against the 10–20
 * a week most hypertrophy guidance lands on. One series, so one colour: the
 * band carries the target and the words carry the verdict.
 */
export function StrengthVolumeLandmarks({ analytics, windowDays }: StrengthVolumeLandmarksProps) {
  // The day only moves the result at midnight, so the window length and the
  // history are the only real inputs.
  const landmarks = useMemo(
    () => buildWeeklyVolumeLandmarks(analytics, windowDays, Date.now()),
    [analytics, windowDays]
  );

  if (!landmarks) {
    return null;
  }

  const peak = Math.max(...landmarks.muscles.map((muscle) => muscle.average));
  const scaleMax = Math.max(MIN_SCALE_SETS, Math.ceil(peak / 5) * 5);
  const at = (sets: number) => `${Math.min(100, (sets / scaleMax) * 100)}%`;
  const weekCount = landmarks.weeks.length;
  const ticks = [0, WEEKLY_SET_LANDMARK.low, WEEKLY_SET_LANDMARK.high, scaleMax];

  return (
    <section className="panel strength-card strength-volume-card">
      <div className="strength-card-head">
        <div>
          <h3>Weekly sets per muscle</h3>
          <p>
            Average of your last {weekCount} full
            week{weekCount === 1 ? "" : "s"}, against the {WEEKLY_SET_LANDMARK.low}–
            {WEEKLY_SET_LANDMARK.high} sets a week most muscles grow on.
          </p>
        </div>
        <p className="strength-volume-summary">
          <span>
            <strong>{landmarks.counts.within}</strong> in range
          </span>
          <span>
            <strong>{landmarks.counts.below}</strong> under
          </span>
          <span>
            <strong>{landmarks.counts.above}</strong> over
          </span>
        </p>
      </div>

      <div className="strength-volume-chart">
        <div className="strength-volume-scale" aria-hidden="true">
          <span />
          <span className="strength-volume-ticks">
            {ticks.map((tick) => (
              <i
                key={tick}
                style={{ left: at(tick) }}
                data-landmark={
                  tick === WEEKLY_SET_LANDMARK.low || tick === WEEKLY_SET_LANDMARK.high || undefined
                }
              >
                {tick}
              </i>
            ))}
          </span>
          <span />
        </div>

        <ul className="strength-volume-rows">
          {landmarks.muscles.map((entry, index) => {
            const meta = MUSCLE_BY_ID[entry.muscle];
            const previous = landmarks.muscles[index - 1];
            const regionStart =
              previous !== undefined && MUSCLE_BY_ID[previous.muscle].region !== meta.region;
            const tipId = `strength-volume-tip-${entry.muscle}`;
            return (
              <li
                key={entry.muscle}
                className="strength-volume-row"
                data-status={entry.status}
                data-region-start={regionStart || undefined}
                tabIndex={0}
                aria-describedby={tipId}
              >
                <span className="strength-volume-name">{meta.label}</span>
                <span className="strength-volume-track">
                  <span
                    className="strength-volume-band"
                    style={{
                      left: at(WEEKLY_SET_LANDMARK.low),
                      width: `calc(${at(WEEKLY_SET_LANDMARK.high)} - ${at(WEEKLY_SET_LANDMARK.low)})`
                    }}
                  />
                  {entry.average > 0 ? (
                    <span className="strength-volume-bar" style={{ width: at(entry.average) }} />
                  ) : null}
                  <span
                    className="strength-volume-tip"
                    id={tipId}
                    role="tooltip"
                    style={{ "--tip-at": at(entry.average) } as CSSProperties}
                  >
                    {landmarks.weeks.map((week, weekIndex) => (
                      <span key={week.weekStart}>
                        <strong>{formatLandmarkSets(entry.weekly[weekIndex] ?? 0)}</strong>
                        <em>{week.label}</em>
                      </span>
                    ))}
                  </span>
                </span>
                <span className="strength-volume-value">
                  <strong>{formatLandmarkSets(entry.average)}</strong>
                  {STATUS_WORD[entry.status] ? <em>{STATUS_WORD[entry.status]}</em> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="strength-volume-note">
        Sets are credited, so a helper muscle counts for part of a set — a bench press gives your
        triceps some of every set. Guidance usually counts direct sets only.
      </p>

      <details className="strength-volume-table">
        <summary>Show as a table</summary>
        <div className="strength-volume-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Muscle</th>
                {landmarks.weeks.map((week) => (
                  <th scope="col" key={week.weekStart}>
                    {week.label}
                  </th>
                ))}
                <th scope="col">Average</th>
              </tr>
            </thead>
            <tbody>
              {landmarks.muscles.map((entry) => (
                <tr key={entry.muscle}>
                  <th scope="row">{MUSCLE_BY_ID[entry.muscle].label}</th>
                  {entry.weekly.map((sets, weekIndex) => (
                    <td key={landmarks.weeks[weekIndex]!.weekStart}>{formatLandmarkSets(sets)}</td>
                  ))}
                  <td>
                    {formatLandmarkSets(entry.average)}
                    {STATUS_WORD[entry.status] ? ` · ${STATUS_WORD[entry.status].toLowerCase()}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
