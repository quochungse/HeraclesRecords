import { useMemo } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { DeltaChip } from "../running/RunningHero";
import { buildRideWeeks, rideLoadBalance } from "./rideMetrics";

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
  /** Whether a kind filter is narrowing the figures beside the ratio. */
  filtered: boolean;
  /** The page's clock, so every block agrees on which week is "this" one. */
  nowMs: number;
}

/** Weeks the baseline averages over, plus the current one being compared. */
const BASELINE_WEEKS = 4;

interface LoadBand {
  label: string;
  tone: "low" | "steady" | "high" | "spike";
}

/**
 * The acute-to-chronic bands, as Running draws them — a prompt to look, not a
 * diagnosis, so the copy says what the number is rather than what to do.
 */
function loadBand(ratio: number): LoadBand {
  if (ratio < 0.8) return { label: "Backing off", tone: "low" };
  if (ratio <= 1.3) return { label: "Steady", tone: "steady" };
  if (ratio <= 1.5) return { label: "Ramping up", tone: "high" };
  return { label: "Sharp jump", tone: "spike" };
}

/**
 * The four figures a rider opens the screen for. It borrows Running's hero
 * layout and replaces the two cards that are about running: VO₂max, which
 * COROS estimates from runs, gives way to FTP, and threshold pace to the week's
 * climbing, which is the other half of a cycling week's volume. The week itself
 * is read in hours, as a rider's training is counted, with the distance under
 * it: a run's week is kilometres, a ride's is not.
 */
export function CyclingHero({
  rides,
  allRides,
  ftp,
  weightKg,
  profileSettled,
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

  const thinHistory =
    balance.ratio !== undefined &&
    balance.oldestRideDaysAgo !== undefined &&
    balance.oldestRideDaysAgo < 21;

  const wattsPerKilo =
    ftp !== undefined && weightKg !== undefined && weightKg > 0
      ? ftp / weightKg
      : undefined;

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
            {count} {count === 1 ? "ride" : "rides"}
            {(thisWeek?.current.distance ?? 0) > 0
              ? ` · ${formatDistanceMeters(thisWeek?.current.distance, unitSystem)}`
              : ""}
          </span>
          {thisWeek?.deltaRatio !== undefined ? (
            <DeltaChip ratio={thisWeek.deltaRatio} />
          ) : null}
        </div>
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">
          Load ratio{filtered ? " · all rides" : ""}
        </span>
        {balance.ratio === undefined ? (
          <>
            <strong className="run-hero-value">—</strong>
            <div className="run-hero-foot">
              <span>No riding load in the last four weeks</span>
            </div>
          </>
        ) : (
          <>
            <strong className={`run-hero-value tone-${loadBand(balance.ratio).tone}`}>
              {balance.ratio.toFixed(2)}
            </strong>
            <div className="run-hero-foot">
              <span>{loadBand(balance.ratio).label}</span>
              {thinHistory ? (
                <span
                  className="run-hero-note"
                  title="The four-week average is being taken over history that is not there yet, so the ratio reads high."
                >
                  short history
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">FTP</span>
        <strong className="run-hero-value">
          {ftp === undefined ? "—" : `${Math.round(ftp)} W`}
        </strong>
        <div className="run-hero-foot">
          <span>
            {!profileSettled
              ? "Reading your profile"
              : ftp === undefined
                ? "No FTP on your COROS profile"
                : wattsPerKilo !== undefined
                  ? `${wattsPerKilo.toFixed(2)} W/kg`
                  : "No weight on file for W/kg"}
          </span>
        </div>
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">Climb this week</span>
        <strong className="run-hero-value">
          {(thisWeek?.current.elevationGain ?? 0) > 0
            ? formatElevationMeters(thisWeek?.current.elevationGain, unitSystem)
            : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {thisWeek && thisWeek.climbBaseline > 0
              ? `4-week average ${formatElevationMeters(thisWeek.climbBaseline, unitSystem)}`
              : "No climbing in the last four weeks"}
          </span>
        </div>
      </div>
    </section>
  );
}
