import { useMemo } from "react";
import type {
  TrainingHubActivity,
  TrainingHubThresholdZone
} from "../../electron/types";
import { formatDurationSeconds } from "../training/formatters";
import { runIntensityMix, type RunIntensityMix } from "./runMetrics";

interface RunIntensityPanelProps {
  runs: readonly TrainingHubActivity[];
  zones: readonly TrainingHubThresholdZone[];
}

type Band = "easy" | "moderate" | "hard";

const BANDS: readonly { key: Band; label: string }[] = [
  { key: "easy", label: "Easy" },
  { key: "moderate", label: "Moderate" },
  { key: "hard", label: "Hard" }
];

/** The share the 80/20 rule is stated about: easy time, not easy sessions. */
const EASY_TIME_TARGET = 0.8;

function shares(mix: RunIntensityMix, by: "count" | "duration") {
  const total = BANDS.reduce((sum, band) => sum + mix[band.key][by], 0);
  return {
    total,
    values: BANDS.map((band) => ({
      ...band,
      value: mix[band.key][by],
      share: total > 0 ? mix[band.key][by] / total : 0
    }))
  };
}

/**
 * How the week's running splits between easy and hard.
 *
 * Read from each session's **average** heart rate, which is a deliberately
 * coarse instrument: an interval session averages into the middle and lands
 * under "moderate" when it was neither. It is right about the steady running
 * that makes up most of a week — which is the mix the 80/20 rule is asking
 * about — and per-session zone buckets are what would sharpen it, once a run's
 * detail is cached rather than fetched.
 */
export function RunIntensityPanel({ runs, zones }: RunIntensityPanelProps) {
  const mix = useMemo(() => runIntensityMix(runs, zones), [runs, zones]);
  const byTime = useMemo(() => shares(mix, "duration"), [mix]);
  const byCount = useMemo(() => shares(mix, "count"), [mix]);

  if (zones.length < 3) {
    return (
      <section className="panel run-block">
        <p className="running-eyebrow">Intensity mix</p>
        <p className="run-block-empty">
          This needs your threshold heart-rate zones, which COROS has not sent
          for this account yet.
        </p>
      </section>
    );
  }

  if (byTime.total === 0) {
    return (
      <section className="panel run-block">
        <p className="running-eyebrow">Intensity mix</p>
        <p className="run-block-empty">
          No runs with a heart rate in this window, so none of them can be
          placed in a zone.
        </p>
      </section>
    );
  }

  const easyTimeShare = byTime.values[0]?.share ?? 0;
  const offTarget = Math.round((easyTimeShare - EASY_TIME_TARGET) * 100);

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">Intensity mix</p>
          <h3>
            {Math.round(easyTimeShare * 100)}%
            <span className="run-block-sub"> of running time is easy</span>
          </h3>
        </div>
        <p className="run-block-aside">
          {Math.abs(offTarget) <= 5
            ? "On the 80/20 mark"
            : offTarget > 0
              ? `${offTarget} points above the 80/20 mark`
              : `${Math.abs(offTarget)} points below the 80/20 mark`}
        </p>
      </header>

      <IntensityBar title="By time" split={byTime} format={formatDurationSeconds} />
      <IntensityBar
        title="By session"
        split={byCount}
        format={(value) => `${value} ${value === 1 ? "run" : "runs"}`}
      />

      {mix.unrated.count > 0 ? (
        <p className="run-block-note">
          {mix.unrated.count} {mix.unrated.count === 1 ? "run" : "runs"} recorded
          no heart rate and {mix.unrated.count === 1 ? "is" : "are"} left out.
        </p>
      ) : null}
    </section>
  );
}

interface IntensityBarProps {
  title: string;
  split: ReturnType<typeof shares>;
  format: (value: number) => string;
}

function IntensityBar({ title, split, format }: IntensityBarProps) {
  return (
    <div className="run-intensity-row">
      <span className="run-intensity-title">{title}</span>
      <div className="run-intensity-bar">
        {split.values.map((band) =>
          band.share > 0 ? (
            <div
              key={band.key}
              className={`run-intensity-seg tone-${band.key}`}
              style={{ flexGrow: band.share }}
              title={`${band.label}: ${format(band.value)}`}
            >
              {/* The band is named inside the segment wherever it fits. A bare
                  "80%" is genuinely ambiguous here: an athlete whose moderate
                  running happens to fill 80% of the bar reads it as having hit
                  the 80/20 target they have in fact missed entirely. */}
              {band.share >= 0.28
                ? `${band.label} ${Math.round(band.share * 100)}%`
                : band.share >= 0.12
                  ? `${Math.round(band.share * 100)}%`
                  : null}
            </div>
          ) : null
        )}
      </div>
      <div className="run-intensity-legend">
        {split.values.map((band) => (
          <span key={band.key}>
            <i className={`tone-${band.key}`} />
            {band.label} {format(band.value)}
          </span>
        ))}
      </div>
    </div>
  );
}
