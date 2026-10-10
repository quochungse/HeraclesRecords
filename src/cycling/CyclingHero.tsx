import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import type { TrainingHubSnapshot } from "../training/types";
import { mergeTrainingDayLists } from "../training/parsers";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters,
  getLocalHappenDayKey
} from "../training/formatters";
import { buildVo2Trend, formatPlateauDuration, type Vo2Reading } from "../training/vo2Trend";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { DeltaChip, LoadRatioCard } from "../running/RunningHero";
import { buildRideWeeks, rideLoadBalance } from "./rideMetrics";
import { formatDecimal, plural, t } from "../i18n/core";

interface CyclingHeroProps {
  /**
   * Rides matching the kind filter, over the whole history — "this week" and
   * its four-week baseline look back a fixed span the period filter must not
   * cut short.
   */
  rides: readonly TrainingHubActivity[];
  /** Every ride, whatever the filter: the load ratio is about the whole rider. */
  allRides: readonly TrainingHubActivity[];
  /** Functional threshold power from the COROS profile, watts. */
  ftp?: number;
  /** Kilograms, for watts per kilo. */
  weightKg?: number;
  /** Whether the profile has answered — "no FTP" and "not yet" differ. */
  profileSettled: boolean;
  /** For COROS's cycling VO₂max, read off the day list beside the running one. */
  snapshot: TrainingHubSnapshot | null;
  /** Whether a kind filter is narrowing the figures beside the ratio. */
  filtered: boolean;
  /** The page's clock, so every block agrees on which week is "this" one. */
  nowMs: number;
}

/** Weeks the baseline averages over, plus the current one being compared. */
const BASELINE_WEEKS = 4;

/**
 * The four figures a rider opens the screen for. It borrows Running's hero
 * layout and replaces the two cards that are about running: the running
 * VO₂max gives way to FTP, and threshold pace to the week's climbing, which is
 * the other half of a cycling week's volume. The week itself is read in hours,
 * as a rider's training is counted, with the distance under it: a run's week is
 * kilometres, a ride's is not.
 *
 * COROS's cycling VO₂max is a fifth card beside FTP, where COROS shows it, and
 * only once COROS has given one: it needs rides COROS can estimate from, and
 * an athlete without them would otherwise carry a card that never fills.
 */
export function CyclingHero({
  rides,
  allRides,
  ftp,
  weightKg,
  profileSettled,
  snapshot,
  filtered,
  nowMs
}: CyclingHeroProps) {
  const { unitSystem } = useUnitSystem();

  const thisWeek = useMemo(() => {
    const weeks = buildRideWeeks(rides, { weeks: BASELINE_WEEKS + 1, nowMs });
    const current = weeks[weeks.length - 1];
    const past = weeks.slice(0, -1);
    if (!current) {
      return null;
    }

    // Weeks off count as the zeros they were, or a comeback week reads as
    // business as usual.
    const average = (pick: (week: (typeof weeks)[number]) => number) =>
      past.length > 0 ? past.reduce((sum, week) => sum + pick(week), 0) / past.length : 0;
    // Time, not distance: an hour on the trainer may have measured no
    // distance at all, and an hour off-road covers half the road's — both
    // would read as a week cut short.
    const baseline = average((week) => week.duration);
    const climbBaseline = average((week) => week.elevationGain);

    return {
      current,
      climbBaseline,
      ...(baseline > 0
        ? { deltaRatio: (current.duration - baseline) / baseline }
        : {})
    };
  }, [nowMs, rides]);

  const balance = useMemo(() => rideLoadBalance(allRides, nowMs), [allRides, nowMs]);

  // Sparse like the running one, so it is read as plateaus carried forward.
  const vo2 = useMemo(() => {
    const readings = mergeTrainingDayLists(
      snapshot?.dailyMetrics ?? null,
      snapshot?.analytics ?? null
    )
      .map((day) => ({ happenDay: day.happenDay, value: day.cycleVo2max }))
      .filter(
        (reading): reading is Vo2Reading =>
          reading.value !== undefined && Number.isFinite(reading.value)
      );
    return buildVo2Trend(readings, getLocalHappenDayKey());
  }, [snapshot]);

  const wattsPerKilo =
    ftp !== undefined && weightKg !== undefined && weightKg > 0
      ? ftp / weightKg
      : undefined;

  const count = thisWeek?.current.count ?? 0;

  return (
    <section className="run-hero">
      <div className="run-hero-card">
        <span className="run-hero-label">{t("activity.hero.thisWeek")}</span>
        <strong className="run-hero-value">
          {count > 0 ? formatDurationSpan(thisWeek?.current.duration) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {plural("activity.ride.count", count)}
            {(thisWeek?.current.distance ?? 0) > 0
              ? ` · ${formatDistanceMeters(thisWeek?.current.distance, unitSystem)}`
              : ""}
          </span>
          {thisWeek?.deltaRatio !== undefined ? (
            <DeltaChip ratio={thisWeek.deltaRatio} />
          ) : null}
        </div>
      </div>

      <LoadRatioCard balance={balance} filtered={filtered} sport="ride" />

      <div className="run-hero-card">
        <span className="run-hero-label">FTP</span>
        <strong className="run-hero-value">
          {ftp === undefined ? "—" : `${Math.round(ftp)} W`}
        </strong>
        <div className="run-hero-foot">
          <span>
            {!profileSettled
              ? t("ride.hero.readingProfile")
              : ftp === undefined
                ? t("ride.hero.noFtp")
                : wattsPerKilo !== undefined
                  ? `${formatDecimal(wattsPerKilo, 2)} W/kg`
                  : t("ride.hero.noWeight")}
          </span>
        </div>
      </div>

      {vo2 ? (
        <div className="run-hero-card">
          <span className="run-hero-label">VO₂max</span>
          <strong className="run-hero-value">{vo2.latest}</strong>
          <div className="run-hero-foot">
            <span>{t("activity.hero.held", { duration: formatPlateauDuration(vo2.daysAtCurrent) })}</span>
          </div>
        </div>
      ) : null}

      <div className="run-hero-card">
        <span className="run-hero-label">{t("activity.trail.climbThisWeek")}</span>
        <strong className="run-hero-value">
          {(thisWeek?.current.elevationGain ?? 0) > 0
            ? formatElevationMeters(thisWeek?.current.elevationGain, unitSystem)
            : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {thisWeek && thisWeek.climbBaseline > 0
              ? t("activity.hero.avg4w", { value: formatElevationMeters(thisWeek.climbBaseline, unitSystem) })
              : t("activity.trail.noClimb")}
          </span>
        </div>
      </div>
    </section>
  );
}
