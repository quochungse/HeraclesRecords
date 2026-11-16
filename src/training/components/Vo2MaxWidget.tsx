import { Activity } from "lucide-react";
import {
  formatHappenDayLabel,
  formatSignedDelta
} from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import {
  buildVo2Trend,
  formatHappenDayNumeric,
  formatPlateauDuration,
  formatTrendSpan,
  type Vo2Reading,
  type Vo2Trend
} from "../vo2Trend";
import type { TrainingHubSnapshot } from "../types";
import { messageRecord, t } from "../../i18n/core";
import { ageOnDay, athleteSex } from "../../records/fitnessStandards";
import { useTodayKey } from "../useTodayKey";
import { VO2_LEVELS, vo2DialPosition, vo2LevelEdges, vo2LevelOf, type Vo2Level } from "../vo2Level";
import { SegmentedDial } from "./SegmentedDial";

interface Vo2MaxWidgetProps {
  snapshot: TrainingHubSnapshot | null;
  /** Whose ratings: VO2max is rated for age and sex. */
  profile: { birthday?: number; sex?: number } | null;
}

const VO2_LEVEL_NAMES = messageRecord<Vo2Level>({
  poor: "activity.vo2.poor",
  fair: "activity.vo2.fair",
  good: "activity.vo2.good",
  excellent: "activity.vo2.excellent",
  superior: "activity.vo2.superior"
});

/**
 * Smallest share of the bar that still fits "47 · 33d" under a segment. A
 * narrower plateau keeps its color and its tooltip and drops the caption,
 * rather than rendering one that collides with its neighbour.
 */
const PLATEAU_LABEL_MIN_SHARE = 0.14;

/** Tone share for the lowest level on the bar, so it stays legible. */
const PLATEAU_DIM = 0.32;

/**
 * A tooltip is centred on its segment, except near the ends of the bar: the
 * panel clips its overflow, so one centred on a segment whose middle sits
 * inside these margins would be cut off. Those anchor to the bar's edge
 * instead. Decided from the segment's own centre rather than `:first-child`,
 * which covers only the outermost two however many plateaus there are.
 */
const PLATEAU_TIP_EDGE = 0.28;

function latestVo2Readings(snapshot: TrainingHubSnapshot | null): Vo2Reading[] {
  return mergeTrainingDayLists(
    snapshot?.dailyMetrics ?? null,
    snapshot?.analytics ?? null
  )
    .map((day) => ({
      happenDay: day.happenDay,
      value: day.vo2max
    }))
    .filter(
      (reading): reading is Vo2Reading =>
        Number.isFinite(reading.value) && reading.value !== undefined
    );
}

/**
 * The bar is a picture of duration, not of magnitude: a segment's width is the
 * days the level held, so a long plateau reads as a long block. Height carries
 * nothing, which is why the level is told by opacity -- dimmest at the lowest
 * value observed, full at the highest -- rather than by a second axis.
 */
function Vo2PlateauBar({ trend }: { trend: Vo2Trend }) {
  const values = trend.plateaus.map((plateau) => plateau.value);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const span = highest - lowest;

  return (
    <div className="vo2-plateaus">
      <div className="vo2-plateaus-head">
        <span>{t("activity.vo2.last", { span: formatTrendSpan(trend.spanDays) })}</span>
        <strong
          className={`vo2-plateaus-delta${trend.delta > 0 ? " is-up" : trend.delta < 0 ? " is-down" : ""}`}
        >
          {formatSignedDelta(trend.delta)}
        </strong>
      </div>

      <div className="vo2-plateaus-bar">
        {trend.plateaus.map((plateau, index) => {
          const strength =
            span > 0
              ? PLATEAU_DIM + ((plateau.value - lowest) / span) * (1 - PLATEAU_DIM)
              : 1;
          // Running centre of this segment across the bar, 0..1.
          const centre =
            trend.plateaus
              .slice(0, index)
              .reduce((sum, earlier) => sum + earlier.share, 0) +
            plateau.share / 2;
          const range = `${formatHappenDayNumeric(plateau.startDay)} - ${formatHappenDayNumeric(plateau.endDay)}`;

          return (
            <span
              key={`${plateau.startDay}-${plateau.value}`}
              className={`vo2-plateau${index === trend.plateaus.length - 1 ? " is-current" : ""}`}
              style={{
                flexGrow: plateau.share,
                ["--plateau-strength" as string]: `${(strength * 100).toFixed(1)}%`
              }}
              data-tip-anchor={
                centre < PLATEAU_TIP_EDGE
                  ? "start"
                  : centre > 1 - PLATEAU_TIP_EDGE
                    ? "end"
                    : "centre"
              }
              tabIndex={0}
              role="img"
              aria-label={t("activity.vo2.plateau", { value: plateau.value, days: plateau.days, range })}
            >
              <span className="vo2-plateau-tip" role="tooltip">
                VO2 Max <strong>{plateau.value}</strong> · {range}
              </span>
            </span>
          );
        })}
      </div>

      <div className="vo2-plateaus-scale" aria-hidden="true">
        {trend.plateaus.map((plateau) => (
          <span
            key={`${plateau.startDay}-label`}
            className="vo2-plateau-label"
            style={{ flexGrow: plateau.share }}
          >
            {plateau.share >= PLATEAU_LABEL_MIN_SHARE
              ? `${plateau.value} · ${formatPlateauDuration(plateau.days)}`
              : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Vo2MaxWidget({ snapshot, profile }: Vo2MaxWidgetProps) {
  const today = useTodayKey();
  const readings = latestVo2Readings(snapshot);
  const latest = readings.at(-1);
  const trend = buildVo2Trend(readings, today);
  const displayValue = latest?.value;
  const edges = vo2LevelEdges(ageOnDay(profile?.birthday, today), athleteSex(profile?.sex));
  const level = displayValue !== undefined ? vo2LevelOf(displayValue, edges) : undefined;

  return (
    <section
      className={`panel training-scores-panel vo2-widget-panel${level ? ` level-${level}` : ""}`}
    >
      <header className="training-scores-header">
        <div className="training-scores-heading">
          <p className="eyebrow">VO2 Max</p>
          <h2>{t("activity.vo2.title")}</h2>
        </div>
        <Activity size={22} aria-hidden="true" />
      </header>

      <SegmentedDial
        weights={VO2_LEVELS.map(() => 1)}
        position={displayValue !== undefined ? vo2DialPosition(displayValue, edges) : undefined}
        value={displayValue !== undefined ? String(Math.round(displayValue)) : "-"}
        label={t("activity.vo2.gauge")}
      />

      <div className="vo2-widget-footer">
        <div>
          <span>{t("activity.vo2.level")}</span>
          <strong>{level ? VO2_LEVEL_NAMES[level] : t("activity.vo2.waiting")}</strong>
        </div>
        <div>
          <span>{t("activity.vo2.lastStep")}</span>
          <strong>
            {trend?.lastStep === undefined
              ? "-"
              : t("activity.vo2.ago", {
                  delta: formatSignedDelta(trend.lastStep),
                  duration: formatPlateauDuration(trend.daysAtCurrent)
                })}
          </strong>
        </div>
        <div>
          <span>{t("activity.vo2.updated")}</span>
          <strong>
            {latest ? formatHappenDayLabel(latest.happenDay) : "-"}
          </strong>
        </div>
      </div>

      {trend ? <Vo2PlateauBar trend={trend} /> : null}
    </section>
  );
}
