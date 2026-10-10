import { renderRich } from "../i18n/useI18n";
import { exerciseLabel } from "./strengthAnalytics";
import type { CSSProperties } from "react";
import type { UnitSystem } from "../../electron/types";
import { ChevronLeft, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { MUSCLE_BY_ID, MUSCLES, type MuscleId } from "./muscles";
import {
  daysSince,
  formatSets,
  formatVolumeKg,
  heatLevel,
  metricValue,
  type HeatMetric,
  type MuscleStat,
  type MuscleWeekPoint
} from "./strengthAnalytics";
import { formatDurationSeconds } from "../training/formatters";
import { formatDecimal, plural, t } from "../i18n/core";

interface MusclePanelProps {
  muscles: MuscleStat[];
  muscleById: Record<MuscleId, MuscleStat>;
  metric: HeatMetric;
  max: number;
  active: MuscleId | null;
  onSelect: (muscle: MuscleId | null) => void;
  onHover: (muscle: MuscleId | null) => void;
  unitSystem: UnitSystem;
}

interface FormattedMetric {
  value: string;
  unit?: string;
}

function formatMetric(
  value: number,
  metric: HeatMetric,
  unitSystem: UnitSystem
): FormattedMetric {
  if (metric === "volume") return { value: formatVolumeKg(value, unitSystem) };
  if (metric === "time") {
    return { value: formatDurationSeconds(Math.round(value)) };
  }
  return { value: formatSets(value), unit: t("strength.unit.sets") };
}

function emptyMetricLabel(metric: HeatMetric): string {
  if (metric === "volume") return t("strength.empty.volume");
  if (metric === "time") return t("strength.empty.time");
  return t("strength.empty.sets");
}

/** Ranked list of every muscle, doubling as the body map's legend. */
function MuscleRanking({
  muscles,
  metric,
  max,
  onSelect,
  onHover,
  unitSystem
}: Pick<MusclePanelProps, "muscles" | "metric" | "max" | "onSelect" | "onHover" | "unitSystem">) {
  const ranked = [...muscles].sort(
    (a, b) => metricValue(b, metric) - metricValue(a, metric)
  );

  return (
    <ul className="muscle-ranking">
      {ranked.map((stat) => {
        const value = metricValue(stat, metric);
        const share = max > 0 ? Math.min(1, value / max) : 0;
        const meta = MUSCLE_BY_ID[stat.muscle];
        const level = heatLevel(value, max);
        const formatted = formatMetric(value, metric, unitSystem);
        const emptyLabel = emptyMetricLabel(metric);
        const accessibleValue =
          value > 0
            ? `${formatted.value}${formatted.unit ? ` ${formatted.unit}` : ""}`
            : emptyLabel;
        return (
          <li key={stat.muscle}>
            <button
              type="button"
              className={`muscle-ranking-row${value <= 0 ? " is-empty" : ""}`}
              data-level={level}
              aria-label={t("strength.ranking.row", { muscle: meta.label, value: accessibleValue })}
              onClick={() => onSelect(stat.muscle)}
              onPointerEnter={() => onHover(stat.muscle)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(stat.muscle)}
              onBlur={() => onHover(null)}
            >
              <span className="muscle-ranking-name">{meta.label}</span>
              <span className="muscle-ranking-track" aria-hidden="true">
                <span
                  className="muscle-ranking-fill"
                  data-level={level}
                  style={{ transform: `scaleX(${share})` }}
                />
              </span>
              <span className="muscle-ranking-value">
                {value > 0 ? (
                  <>
                    <strong>{formatted.value}</strong>
                    {formatted.unit ? <small>{formatted.unit}</small> : null}
                  </>
                ) : (
                  <span>{emptyLabel}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const PATTERN_LABEL: Readonly<Record<string, string>> = {
  get push() {
    return t("strength.pattern.push");
  },
  get pull() {
    return t("strength.pattern.pull");
  },
  get legs() {
    return t("strength.pattern.legs");
  },
  get core() {
    return t("strength.pattern.core");
  }
};

interface Recovery {
  days: number;
  /** Mean days between sessions across the window, once there are two to span. */
  cadenceDays?: number;
  tone: "fresh" | "due" | "stale";
  state: string;
}

/**
 * Freshness read against the muscle's own habit rather than a fixed calendar.
 * Something trained every third day is already due on day four; something
 * trained weekly is not. Without two sessions to measure a cadence from, fall
 * back to a generic 2/6-day rule.
 */
function recoveryOf(stat: MuscleStat): Recovery | undefined {
  const days = daysSince(stat.lastTrained);
  if (days === undefined) {
    return undefined;
  }
  const weeks = stat.weekly.length;
  const cadenceDays =
    stat.sessions > 1 && weeks > 0 ? (weeks * 7) / stat.sessions : undefined;

  const dueAt = cadenceDays !== undefined ? cadenceDays * 0.75 : 2;
  const lateAt = cadenceDays !== undefined ? cadenceDays * 1.35 : 6;

  if (days <= dueAt) {
    return { days, cadenceDays, tone: "fresh", state: t("strength.recovery.fresh") };
  }
  if (days <= lateAt) {
    return { days, cadenceDays, tone: "due", state: t("strength.recovery.due") };
  }
  return { days, cadenceDays, tone: "stale", state: t("strength.recovery.stale") };
}

/** Days since last set, measured against the muscle's usual turnaround. */
function MuscleRecovery({ recovery }: { recovery: Recovery | undefined }) {
  if (!recovery) {
    return (
      <section className="muscle-recovery is-empty">
        <p className="eyebrow">{t("strength.recovery.title")}</p>
        <p className="muscle-recovery-value">
          <span>{t("strength.recovery.none")}</span>
        </p>
      </section>
    );
  }

  const { days, cadenceDays, tone, state } = recovery;
  // Give the track enough room that an overdue muscle still runs past its own
  // cadence tick instead of pinning to the end.
  const span = Math.max(days, cadenceDays ?? 7) * 1.35 + 1;
  const fill = Math.min(1, days / span);
  const tick =
    cadenceDays !== undefined
      ? Math.min(0.92, Math.max(0.08, cadenceDays / span))
      : undefined;

  return (
    <section className="muscle-recovery" data-tone={tone}>
      <div className="muscle-section-head">
        <p className="eyebrow">{t("strength.recovery.title")}</p>
        <span className="muscle-recovery-state">{state}</span>
      </div>
      <p className="muscle-recovery-value">
        {renderRich(plural("strength.recovery.days", days), {
          b: (chunk) => <strong>{chunk}</strong>,
          s: (chunk) => <span>{chunk}</span>
        })}
      </p>
      <div className="muscle-recovery-track">
        <span
          className="muscle-recovery-fill"
          style={{ transform: `scaleX(${fill})` }}
        />
        {tick !== undefined ? (
          <span
            className="muscle-recovery-tick"
            style={{ left: `${tick * 100}%` }}
          >
            <i aria-hidden="true" />
            <em>{t("strength.recovery.usually", { days: formatDecimal(cadenceDays!, 1) })}</em>
          </span>
        ) : null}
      </div>
    </section>
  );
}

interface StatCell {
  id: string;
  label: string;
  value: string;
  unit?: string;
  note?: string;
  /** Shown under the note in the hero, when the number needs an asterisk. */
  caveat?: string;
}

/** What a rep range is training for, in words that need no glossary. */
function repRangeNote(repsPerSet: number): string {
  if (repsPerSet <= 5) return t("strength.repNote.strength");
  if (repsPerSet <= 12) return t("strength.repNote.growth");
  return t("strength.repNote.endurance");
}

/**
 * Every headline number the panel can show. The toolbar's metric picks which
 * one gets the hero slot; the rest fall into the row beneath it, so the panel
 * always answers the question the body map is currently coloured by.
 *
 * Raw rep and volume totals are deliberately absent as standalone cells. Both
 * are credited by activation share, which makes a muscle's rep count a
 * fraction of work rather than anything performed — the reps-per-set ratio
 * survives that scaling intact, so it is the one worth showing. Sets per week
 * replaces share-of-all-sets for the same reason: it is the number a lifter
 * actually programmes against.
 */
function statCells(
  stat: MuscleStat,
  weeks: number,
  unitSystem: UnitSystem
): Record<string, StatCell> {
  const setsPerWeek = weeks > 0 ? stat.sets / weeks : 0;
  const repsPerSet = stat.sets > 0 ? Math.round(stat.reps / stat.sets) : 0;

  return {
    sets: {
      id: "sets",
      label: t("strength.summary.sets"),
      value: formatSets(stat.sets),
      note: setsPerWeek > 0 ? t("strength.cell.perWeek", { value: formatSets(setsPerWeek) }) : undefined
    },
    volume: {
      id: "volume",
      label: t("strength.metric.volume"),
      value: stat.volumeKg > 0 ? formatVolumeKg(stat.volumeKg, unitSystem) : t("strength.bodyweight"),
      note:
        stat.volumeKg > 0 && stat.sessions > 0
          ? t("strength.cell.perSession", { value: formatVolumeKg(stat.volumeKg / stat.sessions, unitSystem) })
          : undefined,
      // Volume is reps × weight, so unweighted work is silently missing from
      // it. Say how much rather than letting the total read as the whole story.
      caveat:
        stat.bodyweightSets >= 0.5
          ? t("strength.cell.excludes", { value: formatSets(stat.bodyweightSets) })
          : undefined
    },
    time: {
      id: "time",
      label: t("strength.metric.time"),
      value: formatDurationSeconds(Math.round(stat.workSec)),
      note:
        stat.workSec > 0 && stat.sessions > 0
          ? t("strength.cell.perSession", { value: formatDurationSeconds(Math.round(stat.workSec / stat.sessions)) })
          : undefined
    },
    repRange: {
      id: "repRange",
      label: t("strength.cell.repsPerSet"),
      value: repsPerSet > 0 ? String(repsPerSet) : "—",
      note: repsPerSet > 0 ? repRangeNote(repsPerSet) : undefined
    },
    // How much work lands per visit, rather than a bare session count — how
    // often you train this is already the point of the recovery meter, and a
    // token two sets is a different problem from a genuine one.
    perSession: {
      id: "perSession",
      label: t("strength.cell.setsPerSession"),
      value: stat.sessions > 0 ? formatSets(stat.sets / stat.sessions) : "—",
      note: stat.sessions > 0 ? plural("strength.cell.across", stat.sessions) : undefined
    }
  };
}

const SECONDARY_BY_METRIC: Record<HeatMetric, string[]> = {
  sets: ["repRange", "perSession"],
  volume: ["sets", "repRange", "perSession"],
  time: ["sets", "repRange", "perSession"]
};

interface WeeklyTrend {
  direction: "up" | "down" | "flat";
  label: string;
}

/**
 * Compare the most recent weeks against the same number before them, so the
 * sparkline gets a headline the eye can trust. Anything under four weeks of
 * history is too short to call a direction on.
 */
function weeklyTrend(weekly: MuscleWeekPoint[]): WeeklyTrend | undefined {
  if (weekly.length < 4) {
    return undefined;
  }
  const span = Math.min(4, Math.floor(weekly.length / 2));
  const mean = (points: MuscleWeekPoint[]) =>
    points.reduce((total, point) => total + point.sets, 0) / points.length;
  const recent = mean(weekly.slice(-span));
  const prior = mean(weekly.slice(-span * 2, -span));

  if (recent <= 0 && prior <= 0) {
    return undefined;
  }
  if (prior <= 0) {
    return { direction: "up", label: t("strength.trend.new", { weeks: span }) };
  }
  if (recent <= 0) {
    return { direction: "down", label: t("strength.trend.dropped", { weeks: span }) };
  }
  const delta = (recent - prior) / prior;
  if (Math.abs(delta) < 0.08) {
    return { direction: "flat", label: t("strength.trend.steady", { weeks: span }) };
  }
  return {
    direction: delta > 0 ? "up" : "down",
    label: t("strength.trend.change", {
      change: `${delta > 0 ? "+" : "−"}${Math.round(Math.abs(delta) * 100)}%`,
      weeks: span
    })
  };
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Weekly credited sets, scaled against this muscle's own busiest week and
 * painted in the muscle's own colour. Columns take their strength from their
 * height rather than a second ramp — running the heat scale off a private peak
 * would paint a consistently trained muscle red every week, which says the
 * opposite of what the figure means by red. The mean is drawn across so a
 * single spike cannot pass for a habit.
 */
function MuscleTrend({ weekly }: { weekly: MuscleWeekPoint[] }) {
  const peak = Math.max(0, ...weekly.map((point) => point.sets));
  if (weekly.length < 2 || peak <= 0) {
    return null;
  }
  const trend = weeklyTrend(weekly);
  const TrendIcon =
    trend?.direction === "up"
      ? TrendingUp
      : trend?.direction === "down"
        ? TrendingDown
        : Minus;

  const mean = weekly.reduce((total, point) => total + point.sets, 0) / weekly.length;
  const nowSec = Date.now() / 1000;

  return (
    <section className="muscle-trend">
      <div className="muscle-section-head">
        <p className="eyebrow">{t("strength.trend.title")}</p>
        {trend ? (
          <span className="muscle-trend-delta" data-direction={trend.direction}>
            <TrendIcon size={12} aria-hidden="true" />
            {trend.label}
          </span>
        ) : null}
      </div>
      <div
        className="muscle-trend-plot"
        role="img"
        aria-label={t("strength.trend.label", { weeks: weekly.length, peak: formatSets(peak), average: formatSets(mean) })}
      >
        <span className="muscle-trend-scale" aria-hidden="true">
          <b>{formatSets(peak)}</b>
          <b>0</b>
        </span>
        <div className="muscle-trend-bars">
          <span
            className="muscle-trend-mean"
            style={{ bottom: `${(mean / peak) * 100}%` }}
            aria-hidden="true"
          >
            <em>{t("strength.trend.avg", { value: formatSets(mean) })}</em>
          </span>
          {weekly.map((point, index) => {
            // The last bucket is only a partial week when today still sits
            // inside it — otherwise it is a finished week like any other.
            const inProgress =
              index === weekly.length - 1 &&
              nowSec >= point.weekStart &&
              nowSec < point.weekStart + WEEK_SECONDS;
            const share = point.sets / peak;
            return (
              <span
                key={point.weekStart}
                className="muscle-trend-bar"
                data-progress={inProgress ? "" : undefined}
                style={{ "--i": index, "--v": share } as CSSProperties}
              >
                <span className="muscle-trend-readout">
                  {formatSets(point.sets)}
                  <em>{point.label}</em>
                </span>
                <span
                  className="muscle-trend-bar-fill"
                  style={{ height: `${Math.max(point.sets > 0 ? 4 : 0, (point.sets / peak) * 100)}%` }}
                />
              </span>
            );
          })}
        </div>
      </div>
      <div className="muscle-trend-axis" aria-hidden="true">
        <span>{weekly[0].label}</span>
        <span>{weekly[weekly.length - 1].label}</span>
      </div>
    </section>
  );
}

interface Driver {
  name: string;
  sets: number;
  share: number;
  rest?: boolean;
}

/**
 * Which lifts actually built this muscle. The stacked bar answers the question
 * the list cannot at a glance — whether the work is concentrated in one lift or
 * spread across the session — and the untracked remainder is shown rather than
 * quietly dropped, so the shares always total the muscle's real set count.
 */
function MuscleDrivers({ stat }: { stat: MuscleStat }) {
  if (stat.topExercises.length === 0) {
    return (
      <p className="muscle-panel-gap">
        {t("strength.drivers.none")}
      </p>
    );
  }

  const listed = stat.topExercises.reduce((total, entry) => total + entry.sets, 0);
  const rest = Math.max(0, stat.sets - listed);
  const total = listed + rest;
  const drivers: Driver[] = stat.topExercises.map((exercise) => ({
    name: exercise.name,
    sets: exercise.sets,
    share: total > 0 ? exercise.sets / total : 0
  }));
  if (rest > 0.5) {
    drivers.push({ name: t("strength.drivers.rest"), sets: rest, share: rest / total, rest: true });
  }
  const leadShare = drivers[0]?.share ?? 0;

  return (
    <section className="muscle-drivers">
      <div className="muscle-section-head">
        <p className="eyebrow">{t("strength.drivers.title")}</p>
        <span className="muscle-section-note">
          {t("strength.drivers.lead", { percent: Math.round(leadShare * 100) })}
        </span>
      </div>

      <div className="muscle-driver-stack" aria-hidden="true">
        {drivers.map((driver, index) => (
          <span
            key={driver.name}
            className="muscle-driver-segment"
            data-rest={driver.rest ? "" : undefined}
            style={{ "--i": index, flexGrow: driver.share } as CSSProperties}
          />
        ))}
      </div>

      <ol className="muscle-driver-list">
        {drivers.map((driver, index) => (
          <li
            key={driver.name}
            data-rest={driver.rest ? "" : undefined}
            style={{ "--i": index, "--w": driver.share } as CSSProperties}
          >
            <span className="muscle-driver-rank" aria-hidden="true">
              {driver.rest ? "·" : index + 1}
            </span>
            <span className="muscle-driver-name">{driver.rest ? driver.name : exerciseLabel(driver.name)}</span>
            <span className="muscle-driver-sets">
              {formatSets(driver.sets)}
              <em>{t("strength.unit.sets")}</em>
            </span>
            <span className="muscle-driver-share">{Math.round(driver.share * 100)}%</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function HeroStat({ cell, level }: { cell: StatCell; level: number }) {
  return (
    <div className="muscle-hero" data-level={level}>
      <p
        className="muscle-hero-label"
        title={
          cell.id === "sets"
            ? t("strength.hero.setsTitle")
            : undefined
        }
      >
        {cell.label}
      </p>
      <p className="muscle-hero-value">
        <strong>{cell.value}</strong>
        {cell.unit ? <small>{cell.unit}</small> : null}
      </p>
      {cell.note ? <p className="muscle-hero-note">{cell.note}</p> : null}
      {cell.caveat ? <p className="muscle-hero-caveat">{cell.caveat}</p> : null}
    </div>
  );
}

export function MusclePanel({
  muscles,
  muscleById,
  metric,
  max,
  active,
  onSelect,
  onHover,
  unitSystem
}: MusclePanelProps) {
  if (!active) {
    const untrained = MUSCLES.filter(
      (muscle) => muscleById[muscle.id].sets <= 0
    );
    const trainedCount = MUSCLES.length - untrained.length;
    return (
      <div className="muscle-panel">
        <header className="muscle-panel-head">
          <div className="muscle-panel-title">
            <p className="muscle-panel-kicker">{t(`strength.coverage.kicker.${metric}` as const)}</p>
            <h3>{t("strength.coverage.title")}</h3>
            <p className="muscle-panel-lead">{t("strength.coverage.lead")}</p>
          </div>
          <p
            className="muscle-panel-summary"
            aria-label={t("strength.coverage.trainedLabel", { trained: trainedCount, total: MUSCLES.length })}
          >
            <strong>{trainedCount}</strong>
            <span>{t("strength.coverage.trained", { total: MUSCLES.length })}</span>
          </p>
        </header>
        <MuscleRanking
          muscles={muscles}
          metric={metric}
          max={max}
          onSelect={onSelect}
          onHover={onHover}
          unitSystem={unitSystem}
        />
      </div>
    );
  }

  const stat = muscleById[active];
  const meta = MUSCLE_BY_ID[active];

  const value = metricValue(stat, metric);
  const level = heatLevel(value, max);
  const ranked = [...muscles].sort(
    (a, b) => metricValue(b, metric) - metricValue(a, metric)
  );
  const rank = ranked.findIndex((entry) => entry.muscle === active) + 1;

  const cells = statCells(stat, stat.weekly.length, unitSystem);
  const hero = cells[metric];
  const secondary = SECONDARY_BY_METRIC[metric].map((id) => cells[id]);

  return (
    <div className="muscle-panel is-detail" data-level={level}>
      <button
        type="button"
        className="muscle-panel-back"
        onClick={() => onSelect(null)}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        {t("strength.allMuscles")}
      </button>

      <header className="muscle-detail-head">
        <div className="muscle-detail-title">
          {/* The movement pattern is the one label that changes what you do
              next; the Latin name and which side of the figure it sits on are
              trivia the user just clicked past. */}
          <p className="muscle-detail-taxonomy">
            <span>{PATTERN_LABEL[meta.pattern]}</span>
          </p>
          <h3>{meta.label}</h3>
        </div>
        {value > 0 ? (
          <div
            className="muscle-detail-rank"
            data-level={level}
            aria-label={t(`strength.rank.${metric}` as const, { rank, total: muscles.length })}
          >
            <strong>{rank}</strong>
            <span>{t("strength.rank.of", { total: muscles.length })}</span>
          </div>
        ) : null}
      </header>

      <MuscleRecovery recovery={recoveryOf(stat)} />

      <div className="muscle-readout">
        <HeroStat cell={hero} level={level} />
        <div className="muscle-readout-row">
          {secondary.map((cell) => (
            <div key={cell.id} className="muscle-readout-cell">
              <p className="muscle-readout-label">{cell.label}</p>
              <strong>{cell.value}</strong>
              {cell.note ? <span>{cell.note}</span> : null}
            </div>
          ))}
        </div>
      </div>

      <MuscleTrend weekly={stat.weekly} />

      <MuscleDrivers stat={stat} />
    </div>
  );
}
