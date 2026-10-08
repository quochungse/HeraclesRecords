import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatVerticalRate } from "../units/units";
import { DeltaChip, LoadRatioCard } from "./RunningHero";
import {
  CLIMBING_RATE_MIN_GAIN_M,
  buildRunWeeks,
  climbingRateOf,
  runLoadBalance
} from "./runMetrics";
import { classifyRunSurface } from "./runSurface";

import { plural, t } from "../i18n/core";
interface TrailRunningHeroProps {
  /** Trail runs over the whole history: the week, its baseline and the twelve-week rate look back past the period. */
  trailRuns: readonly TrainingHubActivity[];
  /** Every run, whatever the filter: the load ratio is about the whole leg. */
  allRuns: readonly TrainingHubActivity[];
  nowMs: number;
}

/** Weeks the baseline averages over, plus the current one being compared. */
const BASELINE_WEEKS = 4;
/** The window the climbing rate is read over — long enough to hold a few hilly runs. */
const RECENT_DAYS = 84;

function isTrailRun(sportType: number | undefined): boolean {
  return classifyRunSurface(sportType) === "trail";
}

/**
 * The hero Running draws under the Trail filter.
 *
 * Two of the road hero's cards say nothing about a trail. Threshold pace is
 * COROS's estimate from the road, and a trail week read in kilometres puts an
 * hour over a ridge beside an hour on the flat as though one were half the
 * other. So the week is read in hours, its height stands beside it, and the
 * fitness figure is how fast the athlete gains height — Hiking's, over trail
 * runs. The load ratio stays, and stays over **every** run: a trail block
 * lands on the same legs as the road running around it, and a ratio of trail
 * load alone would call the week after a road race a rest.
 */
export function TrailRunningHero({ trailRuns, allRuns, nowMs }: TrailRunningHeroProps) {
  const { unitSystem } = useUnitSystem();

  const thisWeek = useMemo(() => {
    const weeks = buildRunWeeks(trailRuns, { weeks: BASELINE_WEEKS + 1, nowMs });
    const current = weeks[weeks.length - 1];
    const past = weeks.slice(0, -1);
    if (!current) {
      return null;
    }
    // A week off the trails counts as the zero it was, or a return reads as
    // business as usual.
    const average = (pick: (week: (typeof weeks)[number]) => number) =>
      past.length > 0 ? past.reduce((sum, week) => sum + pick(week), 0) / past.length : 0;
    const baseline = average((week) => week.duration);
    return {
      current,
      climbBaseline: average((week) => week.elevationGain),
      ...(baseline > 0 ? { deltaRatio: (current.duration - baseline) / baseline } : {})
    };
  }, [nowMs, trailRuns]);

  const balance = useMemo(() => runLoadBalance(allRuns, nowMs), [allRuns, nowMs]);
  const rate = useMemo(
    () => climbingRateOf(trailRuns, isTrailRun, { days: RECENT_DAYS, nowMs }),
    [nowMs, trailRuns]
  );

  const count = thisWeek?.current.count ?? 0;
  const climb = thisWeek?.current.elevationGain ?? 0;
  // The floor in the athlete's units, as the rate beside it is.
  const floor = formatElevationMeters(CLIMBING_RATE_MIN_GAIN_M, unitSystem);

  return (
    <section className="run-hero">
      <div className="run-hero-card">
        <span className="run-hero-label">{t("activity.hero.thisWeek")}</span>
        <strong className="run-hero-value">
          {count > 0 ? formatDurationSpan(thisWeek?.current.duration) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {plural("activity.trail.count", count)}
            {(thisWeek?.current.distance ?? 0) > 0
              ? ` · ${formatDistanceMeters(thisWeek?.current.distance, unitSystem)}`
              : ""}
          </span>
          {thisWeek?.deltaRatio !== undefined ? <DeltaChip ratio={thisWeek.deltaRatio} /> : null}
        </div>
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">{t("activity.trail.climbThisWeek")}</span>
        <strong className="run-hero-value">
          {climb > 0 ? formatElevationMeters(climb, unitSystem) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {thisWeek && thisWeek.climbBaseline > 0
              ? t("activity.hero.avg4w", { value: formatElevationMeters(thisWeek.climbBaseline, unitSystem) })
              : t("activity.trail.noClimb")}
          </span>
        </div>
      </div>

      <LoadRatioCard balance={balance} filtered sport="run" />

      <div
        className="run-hero-card"
        title={t(`activity.trail.rateTitle.${unitSystem === "imperial" ? "imperial" : "metric"}` as const, { floor })}
      >
        <span className="run-hero-label">{t("activity.trail.rate")}</span>
        <strong className="run-hero-value">
          {rate.rate === undefined ? "—" : formatVerticalRate(rate.rate, unitSystem)}
        </strong>
        <div className="run-hero-foot">
          <span>
            {rate.rate === undefined
              ? t("activity.trail.noRate", { floor })
              : plural("activity.trail.over", rate.count, { floor })}
          </span>
          {rate.rate !== undefined && rate.previousRate !== undefined && rate.previousRate > 0 ? (
            <DeltaChip ratio={(rate.rate - rate.previousRate) / rate.previousRate} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
