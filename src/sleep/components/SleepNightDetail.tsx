import { AlarmClock, Info, Moon } from "lucide-react";
import {
  formatHappenDayLabel,
  formatSleepClockRange,
  formatSleepDurationMinutes
} from "../../training/formatters";
import {
  sleepEfficiencyPercent,
  stageBreakdown,
  timeInBedMinutes
} from "../sleepStages";
import { SleepStageDonut } from "./SleepStageDonut";
import type { TrainingHubSleepRecord } from "../../../electron/types";

interface SleepNightDetailProps {
  record: TrainingHubSleepRecord | null;
}

function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function scoreLabel(score?: number): string {
  if (score === undefined || !Number.isFinite(score)) return "No score";
  if (score < 60) return "Poor";
  if (score < 75) return "Fair";
  if (score < 90) return "Good";
  return "Excellent";
}

function scoreTone(score?: number): "low" | "mid" | "good" | "high" | "neutral" {
  if (score === undefined || !Number.isFinite(score)) return "neutral";
  if (score < 60) return "low";
  if (score < 75) return "mid";
  if (score < 90) return "good";
  return "high";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sleep-detail-metric">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

export function SleepNightDetail({ record }: SleepNightDetailProps) {
  if (!record) {
    return (
      <div className="sleep-detail-empty">
        <Moon size={28} aria-hidden="true" />
        <p>Pick a night on the left to see how it broke down.</p>
      </div>
    );
  }

  const window = formatSleepClockRange(record.sleepStart, record.sleepEnd);
  const stages = stageBreakdown(record);
  const inBed = timeInBedMinutes(record);
  const efficiency = sleepEfficiencyPercent(record);

  return (
    <div className={`sleep-detail tone-${scoreTone(record.score)}`}>
      <header className="sleep-detail-header">
        <div>
          <p className="eyebrow">{formatHappenDayLabel(record.happenDay)}</p>
          <h2>{formatSleepDurationMinutes(record.totalMinutes)}</h2>
          <p className="sleep-detail-window">
            {window ? (
              <>
                <Moon size={13} aria-hidden="true" />
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
          <span>{scoreLabel(record.score)}</span>
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
                <span>({formatPercent(stage.percent)})</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/*
        COROS's own card draws a hypnogram here — the stage-by-stage line across
        the night. The MCP feed this app reads sends per-night totals only: no
        segment list, no per-epoch stages, nothing with a time on it beyond the
        window's two ends. Drawing a shape from the totals would be inventing
        the order the stages came in, so the space says what is missing instead.
      */}
      <p className="sleep-detail-note">
        <Info size={13} aria-hidden="true" />
        COROS sends per-night totals, not a stage-by-stage timeline, so the
        hypnogram from the watch app cannot be drawn here yet.
      </p>

      <dl className="sleep-detail-metrics" aria-label="Night details">
        <Metric label="Time in bed" value={formatSleepDurationMinutes(inBed)} />
        <Metric
          label="Efficiency"
          value={efficiency !== undefined ? formatPercent(efficiency) : "–"}
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
        <Metric
          label="Avg HR"
          value={record.avgHr !== undefined ? `${Math.round(record.avgHr)} bpm` : "No data"}
        />
      </dl>
    </div>
  );
}
