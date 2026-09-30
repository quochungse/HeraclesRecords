import { useMemo } from "react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import { formatDurationSeconds } from "../training/formatters";
import { intensityMix, type RunIntensityMix, type RunZoneScale } from "./runMetrics";

/** The sports this panel is drawn for, which change its words and nothing else. */
export type IntensitySport = "run" | "ride";

interface RunIntensityPanelProps {
  /** Sessions of one sport, already narrowed by the screen's own filters. */
  sessions: readonly TrainingHubActivity[];
  /** Defaults to running, the screen this panel was built for. */
  sport?: IntensitySport;
  zoneScale: RunZoneScale;
  /** The account's zone model, named — "Heart Rate Reserve". */
  zoneModelLabel?: string;
  /** COROS's own time-in-zone per run, where it has been fetched. */
  summaries?: ReadonlyMap<string, ActivityDetailSummary>;
}

type Band = "easy" | "moderate" | "hard";

interface SportWords {
  /** One session. */
  one: string;
  many: string;
  /** The activity itself, as in "of running time". */
  doing: string;
}

const WORDS: Record<IntensitySport, SportWords> = {
  run: { one: "run", many: "runs", doing: "running" },
  ride: { one: "ride", many: "rides", doing: "riding" }
};

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
 * A run whose detail has been summarised is split by COROS's own time in each
 * zone, so an interval session lands partly in each band. The rest are read
 * from the session **average** against the zones the account is actually scored
 * on, which is a coarser instrument — that same interval session averages into
 * the middle and reads "moderate" when it was neither — but it is all the
 * activity list carries, and it is right about the steady running that makes up
 * most of a week.
 */
export function RunIntensityPanel({
  sessions,
  sport = "run",
  zoneScale,
  zoneModelLabel,
  summaries
}: RunIntensityPanelProps) {
  const words = WORDS[sport];
  const mix = useMemo(
    () => intensityMix(sessions, zoneScale, summaries),
    [sessions, summaries, zoneScale]
  );
  const byTime = useMemo(() => shares(mix, "duration"), [mix]);
  const byCount = useMemo(() => shares(mix, "count"), [mix]);

  if (zoneScale.zones.length < 3) {
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
          No {words.many} with a heart rate in this window, so none of them can
          be placed in a zone.
        </p>
      </section>
    );
  }

  const easyTimeShare = byTime.values[0]?.share ?? 0;
  const offTarget = Math.round((easyTimeShare - EASY_TIME_TARGET) * 100);
  // Counted against the rated runs only: an unrated one is in neither method.
  const placed = Math.min(mix.zoneTimed, byCount.total);

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">Intensity mix</p>
          <h3>
            {Math.round(easyTimeShare * 100)}%
            <span className="run-block-sub"> of {words.doing} time is easy</span>
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
        format={(value) => `${value} ${value === 1 ? words.one : words.many}`}
      />

      <p className="run-block-note">
        {zoneModelLabel ? `${zoneModelLabel} zones. ` : ""}
        {placed === 0
          ? `Each ${words.one} is placed by its average heart rate.`
          : placed === byCount.total
            ? `Every ${words.one} is split by its time in each zone.`
            : `${placed} of ${byCount.total} ${words.many} are split by their time in each zone; the rest are placed by their average heart rate.`}
        {mix.unrated.count > 0
          ? ` ${mix.unrated.count} ${mix.unrated.count === 1 ? words.one : words.many} recorded no heart rate and ${
              mix.unrated.count === 1 ? "is" : "are"
            } left out.`
          : ""}
      </p>
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
