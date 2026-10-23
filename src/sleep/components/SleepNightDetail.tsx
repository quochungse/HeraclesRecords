import { AlarmClock, Moon } from "lucide-react";
import {
  formatHappenDayLabel,
  formatSleepClockRange,
  formatSleepDurationMinutes,
  formatSleepPercent
} from "../../training/formatters";
import { sleepScoreLabel, sleepScoreTone } from "../sleepScore";
import {
  sleepEfficiencyPercent,
  stageBreakdown,
  timeInBedMinutes
} from "../sleepStages";
import { SleepNightCurve } from "./SleepNightCurve";
import { SleepStageDonut } from "./SleepStageDonut";
import { mcpShortTextOr, type McpConnectionState } from "../../mcp/mcpNotice";
import {
  isNapOnlyRecord,
  totalSleepMinutes
} from "../../../electron/sleepMetrics";
import { formatNapValue, napClocks, napHover } from "../napSummary";
import { SleepMetricValue } from "./SleepMetricValue";
import type {
  SleepNightSeries,
  TrainingHubSleepRecord
} from "../../../electron/types";
import type { TrainingTrendPoint } from "../../training/types";
import { t } from "../../i18n/core";

interface SleepNightDetailProps {
  record: TrainingHubSleepRecord | null;
  series: SleepNightSeries | null;
  seriesLoading: boolean;
  /** The night list is still loading, so there is nothing to pick yet. */
  pending?: boolean;
  /** False when COROS returned no nights at all — a different empty to a
   *  night simply not being picked. */
  hasNights?: boolean;
  /** Explains the "no nights" case when the server is the reason. */
  mcpState?: McpConnectionState;
  /**
   * The training snapshot's row for this night's morning, whose HRV and
   * baseline stand in until the night's own series has answered — the
   * figure is in the header, and it should not wait on the curve.
   */
  trendPoint?: TrainingTrendPoint;
}

function finite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** "+4", "−2", "±0": a whole-number change, signed as the eye reads it. */
function signedDelta(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : "±0";
}

/**
 * One cell of the header's figure box: a label, the figure, and a line under
 * it. A missing figure is a dash, so the three cells keep their places.
 */
function Figure({
  kind,
  label,
  value,
  unit,
  note,
  hover
}: {
  kind: "hrv" | "hr" | "score";
  label: string;
  value?: number;
  unit?: string;
  note?: string;
  hover?: string;
}) {
  return (
    <div className={`sleep-detail-figure is-${kind}`} title={hover}>
      <dt>{label}</dt>
      <dd>
        <strong>{value !== undefined ? Math.round(value) : "–"}</strong>
        {value !== undefined && unit ? <span> {unit}</span> : null}
      </dd>
      <dd className="sleep-detail-figure-note">{note ?? "\u00a0"}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  hover
}: {
  label: string;
  value: string;
  hover?: string;
}) {
  return (
    <div className="sleep-detail-metric">
      <dt>{label}</dt>
      <SleepMetricValue label={label} value={value} hover={hover} />
    </div>
  );
}

export function SleepNightDetail({
  record,
  series,
  seriesLoading,
  pending = false,
  hasNights = true,
  mcpState,
  trendPoint
}: SleepNightDetailProps) {
  if (!record) {
    const empty = hasNights
      ? t("sleep.detail.pick")
      : mcpShortTextOr(
          mcpState,
          t("sleep.detail.noNightsShort"),
          t("sleep.detail.noNights")
        );

    return (
      <div className="sleep-detail-empty">
        <Moon size={28} aria-hidden="true" />
        <p>{pending ? t("sleep.detail.loading") : empty}</p>
      </div>
    );
  }

  const napOnly = isNapOnlyRecord(record);
  const window = formatSleepClockRange(record.sleepStart, record.sleepEnd);
  // A day with no main sleep has no window of its own, so the naps' own clocks
  // stand where it would have been — the one line on the card with room for
  // all of them.
  const napWindowLine = napOnly ? napClocks(record).join(" · ") : "";
  // The night's own assessment once its series has answered for this night —
  // a series still on screen from the night before must not lend its figure.
  const assessment =
    series?.happenDay === record.happenDay ? series.assessment : undefined;
  const hrvAvg = finite(assessment?.avg) ?? finite(trendPoint?.avgSleepHrv);
  const hrvBaseline = finite(assessment?.baseline) ?? finite(trendPoint?.sleepHrvBase);
  const hrvHover = [
    assessment?.evaluation,
    assessment?.normalLow !== undefined && assessment.normalHigh !== undefined
      ? t("sleep.curve.normal", {
          low: Math.round(assessment.normalLow),
          high: Math.round(assessment.normalHigh)
        })
      : undefined
  ]
    .filter(Boolean)
    .join(" · ");
  const sleepHr = finite(record.avgHr);
  const sleepHrLow = finite(record.minHr);
  const sleepHrHigh = finite(record.maxHr);
  const stages = stageBreakdown(record);
  const inBed = timeInBedMinutes(record);
  const efficiency = sleepEfficiencyPercent(record);

  return (
    <div className={`sleep-detail tone-${sleepScoreTone(record.score)}`}>
      <header className="sleep-detail-header">
        <div>
          <p className="sleep-detail-date">{formatHappenDayLabel(record.happenDay)}</p>
          {/* The whole day's sleep. The stage split below is the main sleep's,
              which is why the naps are named rather than silently added. */}
          <h2>{formatSleepDurationMinutes(totalSleepMinutes(record))}</h2>
          <p className="sleep-detail-window">
            {window ? (
              <>
                <Moon size={13} aria-hidden="true" />
                {window}
                <AlarmClock size={13} aria-hidden="true" />
              </>
            ) : napOnly ? (
              // Deliberately without the moon-and-alarm pair the window line
              // wears: those read "went to bed" and "woke up", which is not
              // what a nap is.
              `${t("sleep.detail.napsOnly")}${napWindowLine ? ` · ${napWindowLine}` : ""}`
            ) : (
              t("sleep.detail.noWindow")
            )}
          </p>
        </div>
        {/* What the night did for recovery, beside how it scored — one box,
            so it reads as one glance and never outweighs the night's length. */}
        <dl className="sleep-detail-figures">
          <Figure
            kind="hrv"
            label={t("sleep.curve.hrvAvg")}
            value={hrvAvg}
            unit="ms"
            note={
              hrvAvg !== undefined && hrvBaseline !== undefined
                ? t("sleep.figure.vsBaseline", { delta: signedDelta(hrvAvg - hrvBaseline) })
                : assessment?.evaluation
            }
            hover={hrvHover || undefined}
          />
          <Figure
            kind="hr"
            label={t("sleep.m.hr")}
            value={sleepHr}
            unit="bpm"
            note={
              sleepHrLow !== undefined
                ? t("sleep.figure.lowest", { bpm: Math.round(sleepHrLow) })
                : undefined
            }
            hover={
              sleepHrLow !== undefined && sleepHrHigh !== undefined
                ? `${Math.round(sleepHrLow)}–${Math.round(sleepHrHigh)} bpm`
                : undefined
            }
          />
          <Figure
            kind="score"
            label={t("sleep.trend.score")}
            value={record.score}
            note={sleepScoreLabel(record.score)}
          />
        </dl>
      </header>

      {record.completeness === "partial" ? (
        <p className="sleep-detail-partial">
          {t("sleep.detail.partial", { reason: record.partialReason ?? t("sleep.detail.stillSyncing") })}
        </p>
      ) : null}

      {napOnly ? (
        <p className="sleep-detail-naps-only">
          {t("sleep.detail.napsOnlyNote")}
        </p>
      ) : (
        <section className="sleep-detail-stages">
          <SleepStageDonut record={record} />
          <dl className="sleep-stage-table">
            {stages.map((stage) => (
              <div key={stage.key} className="sleep-stage-row">
                <dt>
                  <span
                    className={`sleep-stage-dot ${stage.className}`}
                    aria-hidden="true"
                  />
                  {stage.label}
                </dt>
                <dd>
                  <strong>{formatSleepDurationMinutes(stage.minutes)}</strong>
                  <span>({formatSleepPercent(stage.percent)})</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/*
        COROS's own card draws a hypnogram here. Its feed carries no stages, so
        what stands in this space is the pair of series it does send inside the
        window — measured, not inferred from the totals above.
      */}
      <SleepNightCurve series={series} loading={seriesLoading} />

      <dl className="sleep-detail-metrics" aria-label={t("sleep.detail.aria")}>
        <Metric
          label={t("sleep.m.main")}
          value={formatSleepDurationMinutes(record.totalMinutes)}
        />
        <Metric label={t("sleep.m.inBed")} value={formatSleepDurationMinutes(inBed)} />
        <Metric
          label={t("sleep.m.efficiency")}
          value={efficiency !== undefined ? formatSleepPercent(efficiency) : "–"}
        />
        <Metric
          label={t("sleep.m.wakeUps")}
          value={
            record.awakeCountOverFiveMinutes !== undefined
              ? String(record.awakeCountOverFiveMinutes)
              : t("sleep.noData")
          }
        />
        <Metric label={t("sleep.m.naps")} value={formatNapValue(record)} hover={napHover(record)} />
      </dl>
    </div>
  );
}
