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
}

/**
 * The night's heart rate as COROS reports it: an average, and the range it
 * moved through. The range is the half worth having — an average of 50 over a
 * night that touched 44 and 71 is a different night to a flat 50.
 */
function formatSleepHeartRate(record: TrainingHubSleepRecord): string {
  const avg = record.avgHr;
  const low = record.minHr;
  const high = record.maxHr;

  if (avg === undefined && low === undefined && high === undefined) {
    return "No data";
  }

  const average = avg !== undefined ? `${Math.round(avg)} bpm` : "–";
  const range =
    low !== undefined && high !== undefined
      ? ` · ${Math.round(low)}–${Math.round(high)}`
      : "";

  return `${average}${range}`;
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
  mcpState
}: SleepNightDetailProps) {
  if (!record) {
    const empty = hasNights
      ? "Pick a night on the left to see how it broke down."
      : mcpShortTextOr(
          mcpState,
          "No nights to show.",
          "Once a night syncs from your watch it shows up here."
        );

    return (
      <div className="sleep-detail-empty">
        <Moon size={28} aria-hidden="true" />
        <p>{pending ? "Loading your nights…" : empty}</p>
      </div>
    );
  }

  const napOnly = isNapOnlyRecord(record);
  const window = formatSleepClockRange(record.sleepStart, record.sleepEnd);
  // A day with no main sleep has no window of its own, so the naps' own clocks
  // stand where it would have been — the one line on the card with room for
  // all of them.
  const napWindowLine = napOnly ? napClocks(record).join(" · ") : "";
  // COROS dates both ends of the window, so a night that began the evening
  // before can say so instead of leaving "23:48 – 05:30" to be worked out.
  const startedYesterday =
    record.sleepStartDay !== undefined &&
    record.sleepEndDay !== undefined &&
    record.sleepStartDay !== record.sleepEndDay;
  const stages = stageBreakdown(record);
  const inBed = timeInBedMinutes(record);
  const efficiency = sleepEfficiencyPercent(record);

  return (
    <div className={`sleep-detail tone-${sleepScoreTone(record.score)}`}>
      <header className="sleep-detail-header">
        <div>
          <p className="eyebrow">{formatHappenDayLabel(record.happenDay)}</p>
          {/* The whole day's sleep. The stage split below is the main sleep's,
              which is why the naps are named rather than silently added. */}
          <h2>{formatSleepDurationMinutes(totalSleepMinutes(record))}</h2>
          <p className="sleep-detail-window">
            {window ? (
              <>
                <Moon size={13} aria-hidden="true" />
                {startedYesterday ? (
                  <span className="sleep-detail-window-day">
                    {formatHappenDayLabel(record.sleepStartDay ?? "")}
                  </span>
                ) : null}
                {window}
                <AlarmClock size={13} aria-hidden="true" />
              </>
            ) : napOnly ? (
              // Deliberately without the moon-and-alarm pair the window line
              // wears: those read "went to bed" and "woke up", which is not
              // what a nap is.
              `Naps only — no main sleep${napWindowLine ? ` · ${napWindowLine}` : ""}`
            ) : (
              "Sleep window not reported"
            )}
          </p>
        </div>
        <div className="sleep-detail-score">
          <strong>{record.score !== undefined ? Math.round(record.score) : "–"}</strong>
          <span>{sleepScoreLabel(record.score)}</span>
        </div>
      </header>

      {record.completeness === "partial" ? (
        <p className="sleep-detail-partial">
          Partial data: {record.partialReason ?? "COROS is still syncing this sleep."}
        </p>
      ) : null}

      {napOnly ? (
        <p className="sleep-detail-naps-only">
          COROS sends no score and no stage breakdown for a day without a main
          sleep — only how long the naps were and when.
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

      <dl className="sleep-detail-metrics" aria-label="Night details">
        <Metric
          label="Main sleep"
          value={formatSleepDurationMinutes(record.totalMinutes)}
        />
        <Metric label="Time in bed" value={formatSleepDurationMinutes(inBed)} />
        <Metric
          label="Efficiency"
          value={efficiency !== undefined ? formatSleepPercent(efficiency) : "–"}
        />
        <Metric
          label="Wake-ups > 5m"
          value={
            record.awakeCountOverFiveMinutes !== undefined
              ? String(record.awakeCountOverFiveMinutes)
              : "No data"
          }
        />
        <Metric label="Naps" value={formatNapValue(record)} hover={napHover(record)} />
        <Metric label="Sleep HR" value={formatSleepHeartRate(record)} />
      </dl>
    </div>
  );
}
