import { renderRich, useI18n } from "../i18n/useI18n";
import { useMemo } from "react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import { formatDurationSeconds } from "../training/formatters";
import { intensityMix, type RunIntensityMix, type RunZoneScale } from "./runMetrics";
import { plural, t } from "../i18n/core";

/** The sports this panel is drawn for, which change its words and its target. */
export type IntensitySport = "run" | "ride" | "hike";

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
  /**
   * Whether the 80/20 mark is held up against it. It is an endurance-training
   * rule for runners and riders building a season; a walker is not trying to
   * keep four fifths of a mountain easy — the climb decides — so a hike is
   * shown its split and not measured against a target it never had.
   */
  target: boolean;
}

const WORDS: Record<IntensitySport, SportWords> = {
  run: { target: true },
  ride: { target: true },
  hike: { target: false }
};

const BANDS: readonly { key: Band; readonly label: string }[] = [
  {
    key: "easy",
    get label() {
      return t("activity.intensity.easy");
    }
  },
  {
    key: "moderate",
    get label() {
      return t("activity.intensity.moderate");
    }
  },
  {
    key: "hard",
    get label() {
      return t("activity.intensity.hard");
    }
  }
];

/** The share the 80/20 rule is stated about: easy time, not easy sessions. */
const EASY_TIME_TARGET = 0.8;

function shares(mix: RunIntensityMix, by: "count" | "duration") {
  const total = BANDS.reduce((sum, band) => sum + mix[band.key][by], 0);
  return {
    total,
    values: BANDS.map((band) => ({
      key: band.key,
      label: band.label,
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
  const { locale } = useI18n();
  const mix = useMemo(
    () => intensityMix(sessions, zoneScale, summaries),
    [sessions, summaries, zoneScale]
  );
  // The bands carry their names, so a new language rebuilds them.
  const byTime = useMemo(() => shares(mix, "duration"), [mix, locale]);
  const byCount = useMemo(() => shares(mix, "count"), [mix, locale]);

  if (zoneScale.zones.length < 3) {
    return (
      <section className="panel run-block">
        <p className="running-eyebrow">{t("activity.intensity.title")}</p>
        <p className="run-block-empty">
          {t("activity.intensity.noZones")}
        </p>
      </section>
    );
  }

  if (byTime.total === 0) {
    return (
      <section className="panel run-block">
        <p className="running-eyebrow">{t("activity.intensity.title")}</p>
        <p className="run-block-empty">
          {t(`activity.intensity.none.${sport}` as const)}
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
          <p className="running-eyebrow">{t("activity.intensity.title")}</p>
          <h3>
            {renderRich(
              t(`activity.intensity.easyShare.${sport}` as const, { percent: Math.round(easyTimeShare * 100) }),
              { s: (chunk) => <span className="run-block-sub"> {chunk}</span> }
            )}
          </h3>
        </div>
        {words.target ? (
          <p className="run-block-aside">
            {Math.abs(offTarget) <= 5
              ? t("activity.intensity.onMark")
              : offTarget > 0
                ? t("activity.intensity.above", { points: offTarget })
                : t("activity.intensity.below", { points: Math.abs(offTarget) })}
          </p>
        ) : null}
      </header>

      <IntensityBar title={t("activity.intensity.byTime")} split={byTime} format={formatDurationSeconds} />
      <IntensityBar
        title={t("activity.intensity.bySession")}
        split={byCount}
        format={(value) => plural(`activity.${sport}.count` as const, value)}
      />

      <p className="run-block-note">
        {zoneModelLabel ? t("activity.intensity.zonesOf", { model: zoneModelLabel }) : ""}
        {placed === 0
          ? t(`activity.intensity.byAverage.${sport}` as const)
          : placed === byCount.total
            ? t(`activity.intensity.byZone.${sport}` as const)
            : t(`activity.intensity.mixed.${sport}` as const, { placed, total: byCount.total })}
        {mix.unrated.count > 0
          ? plural(`activity.intensity.unrated.${sport}` as const, mix.unrated.count)
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
