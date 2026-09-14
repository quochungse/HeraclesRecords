import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubThresholdZone
} from "../../electron/types";
import type { TrainingHubSnapshot } from "../training/types";
import { mergeTrainingDayLists } from "../training/parsers";
import {
  formatDistanceMeters,
  formatPaceSecondsPerKm,
  getLocalHappenDayKey
} from "../training/formatters";
import { buildVo2Trend, formatPlateauDuration, type Vo2Reading } from "../training/vo2Trend";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { buildRunWeeks, runLoadBalance } from "./runMetrics";

interface RunningHeroProps {
  /** Runs matching the surface filter — what "this week" is counted from. */
  runs: readonly TrainingHubActivity[];
  /** Every run, whatever the filter: the load ratio is about the whole leg. */
  allRuns: readonly TrainingHubActivity[];
  snapshot: TrainingHubSnapshot | null;
  /** Whether a surface filter is narrowing the figures above the ratio. */
  filtered: boolean;
}

/** Weeks the baseline averages over, plus the current one being compared. */
const BASELINE_WEEKS = 4;

interface LoadBand {
  label: string;
  tone: "low" | "steady" | "high" | "spike";
}

/**
 * The acute-to-chronic bands, as they are usually drawn.
 *
 * These are a prompt to look, not a diagnosis — the ratio is a crude measure
 * and the bands around it are cruder still, so the copy says what the number
 * is rather than what the athlete should do about it.
 */
function loadBand(ratio: number): LoadBand {
  if (ratio < 0.8) return { label: "Backing off", tone: "low" };
  if (ratio <= 1.3) return { label: "Steady", tone: "steady" };
  if (ratio <= 1.5) return { label: "Ramping up", tone: "high" };
  return { label: "Sharp jump", tone: "spike" };
}

function thresholdPace(
  snapshot: TrainingHubSnapshot | null
): number | undefined {
  const predictor = snapshot?.dashboard?.racePredictor ?? snapshot?.racePredictor;
  return predictor?.ltsp;
}

function thresholdHeartRate(
  snapshot: TrainingHubSnapshot | null
): number | undefined {
  const predictor = snapshot?.dashboard?.racePredictor ?? snapshot?.racePredictor;
  return predictor?.lthr;
}

export function runningThresholdZones(
  snapshot: TrainingHubSnapshot | null
): TrainingHubThresholdZone[] {
  return snapshot?.dashboard?.lthrZones ?? [];
}

export function RunningHero({ runs, allRuns, snapshot, filtered }: RunningHeroProps) {
  const { unitSystem } = useUnitSystem();

  const thisWeek = useMemo(() => {
    const weeks = buildRunWeeks(runs, { weeks: BASELINE_WEEKS + 1 });
    const current = weeks[weeks.length - 1];
    const past = weeks.slice(0, -1);
    if (!current) {
      return null;
    }

    // The baseline counts weeks off as the zeros they were. Dropping them would
    // flatter a comeback week into looking like business as usual.
    const baseline =
      past.length > 0
        ? past.reduce((sum, week) => sum + week.distance, 0) / past.length
        : 0;

    return {
      current,
      baseline,
      ...(baseline > 0
        ? { deltaRatio: (current.distance - baseline) / baseline }
        : {})
    };
  }, [runs]);

  const balance = useMemo(() => runLoadBalance(allRuns), [allRuns]);

  const vo2 = useMemo(() => {
    const readings = mergeTrainingDayLists(
      snapshot?.dailyMetrics ?? null,
      snapshot?.analytics ?? null
    )
      .map((day) => ({ happenDay: day.happenDay, value: day.vo2max }))
      .filter(
        (reading): reading is Vo2Reading =>
          reading.value !== undefined && Number.isFinite(reading.value)
      );
    return buildVo2Trend(readings, getLocalHappenDayKey());
  }, [snapshot]);

  const ltsp = thresholdPace(snapshot);
  const lthr = thresholdHeartRate(snapshot);

  // Under three of the four weeks, the chronic figure is averaging over history
  // that does not exist, so the ratio reads high for a reason that is not
  // training. Saying so beats showing an alarming number with no explanation.
  const thinHistory =
    balance.ratio !== undefined &&
    (balance.oldestRunDaysAgo === undefined || balance.oldestRunDaysAgo < 21);

  return (
    <section className="run-hero">
      <div className="run-hero-card">
        <span className="run-hero-label">This week</span>
        <strong className="run-hero-value">
          {formatDistanceMeters(thisWeek?.current.distance ?? 0, unitSystem)}
        </strong>
        <div className="run-hero-foot">
          <span>
            {thisWeek?.current.count ?? 0}{" "}
            {thisWeek?.current.count === 1 ? "run" : "runs"}
          </span>
          {thisWeek?.deltaRatio !== undefined ? (
            <DeltaChip ratio={thisWeek.deltaRatio} />
          ) : null}
        </div>
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">
          Load ratio{filtered ? " · all runs" : ""}
        </span>
        {balance.ratio === undefined ? (
          <>
            <strong className="run-hero-value">—</strong>
            <div className="run-hero-foot">
              <span>No running load in the last four weeks</span>
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
        <span className="run-hero-label">VO₂max</span>
        <strong className="run-hero-value">{vo2 ? vo2.latest : "—"}</strong>
        <div className="run-hero-foot">
          <span>
            {vo2
              ? `Held ${formatPlateauDuration(vo2.daysAtCurrent)}`
              : "No readings yet"}
          </span>
        </div>
      </div>

      <div className="run-hero-card">
        <span className="run-hero-label">Threshold</span>
        <strong className="run-hero-value">
          {ltsp === undefined ? "—" : formatPaceSecondsPerKm(ltsp, unitSystem)}
        </strong>
        <div className="run-hero-foot">
          <span>{lthr === undefined ? "No threshold HR" : `${lthr} bpm`}</span>
        </div>
      </div>
    </section>
  );
}

function DeltaChip({ ratio }: { ratio: number }) {
  const percent = Math.round(ratio * 100);
  // Within a couple of percent a delta is noise dressed as news.
  if (Math.abs(percent) < 2) {
    return (
      <span className="run-delta tone-flat">
        <Minus size={12} aria-hidden="true" /> level
      </span>
    );
  }

  const up = percent > 0;
  return (
    <span className={`run-delta ${up ? "tone-up" : "tone-down"}`}>
      {up ? (
        <ArrowUpRight size={12} aria-hidden="true" />
      ) : (
        <ArrowDownRight size={12} aria-hidden="true" />
      )}
      {Math.abs(percent)}%
    </span>
  );
}
