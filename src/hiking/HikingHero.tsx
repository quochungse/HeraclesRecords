import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatVerticalRate } from "../units/units";
import { DeltaChip } from "../running/RunningHero";
import {
  CLIMBING_RATE_MIN_GAIN_M,
  biggestHike,
  buildHikeWeeks,
  climbingRate,
  hikeSeconds
} from "./hikeMetrics";

interface HikingHeroProps {
  /**
   * Hikes matching the kind filter, over the whole history — "this week", its
   * baseline and the twelve-week figures look back spans the period filter
   * must not cut short.
   */
  hikes: readonly TrainingHubActivity[];
  /** The page's clock, so every block agrees on which week is "this" one. */
  nowMs: number;
}

/** Weeks the baseline averages over, plus the current one being compared. */
const BASELINE_WEEKS = 4;
/** The window the biggest day and the ascent per hour are read over — a season of weekends. */
const RECENT_DAYS = 84;

/**
 * The four figures a walker opens the screen for.
 *
 * It borrows Running's hero layout and none of its cards. VO₂max and threshold
 * pace are running figures COROS takes from runs; the load ratio is a guard
 * against ramping a daily habit too fast, and hiking is not a daily habit —
 * a weekend in the mountains after three at home reads as a "sharp jump" every
 * time, which is the trip, not a warning. What a walker reads instead: the
 * week in hours on the trail and in metres climbed, the biggest day of the
 * season — the long day a multi-day hike is trained for — and how fast they
 * gain height, which is to walking what threshold pace is to running.
 */
export function HikingHero({ hikes, nowMs }: HikingHeroProps) {
  const { unitSystem } = useUnitSystem();

  const thisWeek = useMemo(() => {
    const weeks = buildHikeWeeks(hikes, { weeks: BASELINE_WEEKS + 1, nowMs });
    const current = weeks[weeks.length - 1];
    const past = weeks.slice(0, -1);
    if (!current) {
      return null;
    }
    // Weekends at home count as the zeros they were, or a week back on the
    // trail after a month off reads as business as usual.
    const average = (pick: (week: (typeof weeks)[number]) => number) =>
      past.length > 0 ? past.reduce((sum, week) => sum + pick(week), 0) / past.length : 0;
    const baseline = average((week) => week.duration);
    return {
      current,
      ascentBaseline: average((week) => week.elevationGain),
      ...(baseline > 0 ? { deltaRatio: (current.duration - baseline) / baseline } : {})
    };
  }, [hikes, nowMs]);

  const biggest = useMemo(
    () => biggestHike(hikes, { days: RECENT_DAYS, nowMs }),
    [hikes, nowMs]
  );
  const rate = useMemo(() => climbingRate(hikes, { days: RECENT_DAYS, nowMs }), [hikes, nowMs]);

  const count = thisWeek?.current.count ?? 0;

  return (
    <section className="run-hero">
      <div className="run-hero-card">
        <span className="run-hero-label">This week</span>
        <strong className="run-hero-value">
          {count > 0 ? formatDurationSpan(thisWeek?.current.duration) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {count} {count === 1 ? "hike" : "hikes"}
            {(thisWeek?.current.distance ?? 0) > 0
              ? ` · ${formatDistanceMeters(thisWeek?.current.distance, unitSystem)}`
              : ""}
          </span>
          {thisWeek?.deltaRatio !== undefined ? <DeltaChip ratio={thisWeek.deltaRatio} /> : null}
        </div>
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">Ascent this week</span>
        <strong className="run-hero-value">
          {(thisWeek?.current.elevationGain ?? 0) > 0
            ? formatElevationMeters(thisWeek?.current.elevationGain, unitSystem)
            : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {thisWeek && thisWeek.ascentBaseline > 0
              ? `4-week average ${formatElevationMeters(thisWeek.ascentBaseline, unitSystem)}`
              : "No climbing in the last four weeks"}
          </span>
        </div>
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">Biggest day · 12 weeks</span>
        <strong className="run-hero-value">
          {biggest ? formatDurationSpan(hikeSeconds(biggest)) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span className="hike-hero-name" title={biggest?.name}>
            {biggest
              ? `${biggest.name?.trim() || "Hike"}${
                  (biggest.elevationGain ?? 0) > 0
                    ? ` · +${formatElevationMeters(biggest.elevationGain, unitSystem)}`
                    : ""
                }`
              : "No hikes in the last twelve weeks"}
          </span>
        </div>
      </div>

      <div
        className="run-hero-card"
        title={`Median metres climbed an hour over the hikes of the last twelve weeks that climbed ${CLIMBING_RATE_MIN_GAIN_M} m or more — over the recorded time, stops included.`}
      >
        <span className="run-hero-label">Ascent per hour · 12 weeks</span>
        <strong className="run-hero-value">
          {rate.rate === undefined ? "—" : formatVerticalRate(rate.rate, unitSystem)}
        </strong>
        <div className="run-hero-foot">
          <span>
            {rate.rate === undefined
              ? `No hike over ${CLIMBING_RATE_MIN_GAIN_M} m of ascent yet`
              : `${rate.count} ${rate.count === 1 ? "hike" : "hikes"} over ${CLIMBING_RATE_MIN_GAIN_M} m`}
          </span>
          {rate.rate !== undefined && rate.previousRate !== undefined && rate.previousRate > 0 ? (
            <DeltaChip ratio={(rate.rate - rate.previousRate) / rate.previousRate} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
