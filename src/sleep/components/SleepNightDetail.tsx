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
import { MCP_UNAVAILABLE_SHORT, mcpTextOr, type McpConnectionState } from "../../mcp/mcpNotice";
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
  /** `false` explains the "no nights" case. */
  mcpConnected?: McpConnectionState;
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sleep-detail-metric">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

export function SleepNightDetail({
  record,
  series,
  seriesLoading,
  pending = false,
  hasNights = true,
  mcpConnected
}: SleepNightDetailProps) {
  if (!record) {
    const empty = hasNights
      ? "Pick a night on the left to see how it broke down."
      : mcpTextOr(
          mcpConnected,
          `No nights to show. ${MCP_UNAVAILABLE_SHORT}`,
          "Once a night syncs from your watch it shows up here."
        );

    return (
      <div className="sleep-detail-empty">
        <Moon size={28} aria-hidden="true" />
        <p>{pending ? "Loading your nights…" : empty}</p>
      </div>
    );
  }

  const window = formatSleepClockRange(record.sleepStart, record.sleepEnd);
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
          <h2>{formatSleepDurationMinutes(record.totalMinutes)}</h2>
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

      <section className="sleep-detail-stages">
        <SleepStageDonut record={record} />
        <dl className="sleep-stage-table">
          {stages.map((stage) => (
            <div key={stage.key} className="sleep-stage-row">
              <dt>
                <span className={`sleep-stage-dot ${stage.className}`} aria-hidden="true" />
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

      {/*
        COROS's own card draws a hypnogram here. Its feed carries no stages, so
        what stands in this space is the pair of series it does send inside the
        window — measured, not inferred from the totals above.
      */}
      <SleepNightCurve series={series} loading={seriesLoading} />

      <dl className="sleep-detail-metrics" aria-label="Night details">
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
        <Metric
          label="Naps"
          value={
            record.napMinutes !== undefined
              ? formatSleepDurationMinutes(record.napMinutes)
              : "No data"
          }
        />
        <Metric label="Sleep HR" value={formatSleepHeartRate(record)} />
      </dl>
    </div>
  );
}
