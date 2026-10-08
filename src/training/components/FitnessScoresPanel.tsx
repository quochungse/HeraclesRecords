import { BarChart3 } from "lucide-react";
import type {
  TrainingHubDashboard,
  TrainingHubRacePredictor
} from "../../../electron/types";
import {
  buildRunningFitnessPaceLabels,
  formatOptionalNumber,
  formatPaceSecondsPerKm
} from "../formatters";
import { useUnitSystem } from "../../units/UnitSystemProvider";

import { t } from "../../i18n/core";
interface FitnessScoresPanelProps {
  dashboard: TrainingHubDashboard | null;
  racePredictor: TrainingHubRacePredictor | null;
}

interface ScoreItem {
  label: string;
  value?: number;
  paceLabel?: string;
}

interface MetricItem {
  label: string;
  value?: number;
  format: (value?: number) => string;
}

function hasValue(value?: number): value is number {
  return value !== undefined && Number.isFinite(value);
}

function ScoreBar({ label, value, paceLabel }: ScoreItem) {
  const percent =
    value !== undefined ? Math.max(0, Math.min(100, value)) : undefined;

  return (
    <div className="score-bar">
      <div className="score-bar-header">
        <div className="score-bar-label-group">
          <span>{label}</span>
          {paceLabel ? <span className="score-bar-pace">{paceLabel}</span> : null}
        </div>
        <strong>{formatOptionalNumber(value)}</strong>
      </div>
      <div className="score-bar-track">
        <span
          className="score-bar-fill"
          style={{ width: percent !== undefined ? `${percent}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function formatBpm(value?: number): string {
  return hasValue(value) ? `${Math.round(value)} bpm` : "-";
}

export function FitnessScoresPanel({
  dashboard,
  racePredictor
}: FitnessScoresPanelProps) {
  const { unitSystem } = useUnitSystem();
  const predictor = racePredictor ?? dashboard?.racePredictor ?? null;

  if (!dashboard && !predictor) {
    return (
      <section className="panel training-scores-panel">
        <header className="training-scores-header">
          <div className="training-scores-heading">
            <p className="eyebrow">{t("activity.scores.eyebrow")}</p>
            <h2>{t("activity.scores.notLoaded")}</h2>
          </div>
          <BarChart3 size={22} aria-hidden="true" />
        </header>
        <p className="training-empty-chart">{t("activity.scores.failed")}</p>
      </section>
    );
  }

  const paceLabels = buildRunningFitnessPaceLabels(
    dashboard?.ltspZones ?? [],
    unitSystem
  );
  const scores: ScoreItem[] = [
    {
      label: t("activity.scores.endurance"),
      value: predictor?.aerobicEnduranceScore,
      paceLabel: paceLabels.Endurance
    },
    {
      label: t("activity.scores.threshold"),
      value: predictor?.lactateThresholdCapacityScore,
      paceLabel: paceLabels.Threshold
    },
    {
      label: t("activity.scores.speed"),
      value: predictor?.anaerobicEnduranceScore,
      paceLabel: paceLabels.Speed
    },
    {
      label: t("activity.scores.sprint"),
      value: predictor?.anaerobicCapacityScore,
      paceLabel: paceLabels.Sprint
    }
  ].filter((score) => hasValue(score.value));

  const metrics: MetricItem[] = [
    { label: "LTHR", value: predictor?.lthr, format: formatBpm },
    {
      label: t("activity.scores.ltPace"),
      value: predictor?.ltsp,
      format: (value) => formatPaceSecondsPerKm(value, unitSystem)
    },
    { label: t("activity.m.maxHr"), value: dashboard?.fitnessMaxHr, format: formatBpm },
    { label: t("activity.scores.runLevelHr"), value: dashboard?.runningLevelHr, format: formatBpm }
  ];

  return (
    <section className="panel training-scores-panel">
      <header className="training-scores-header">
        <div className="training-scores-heading">
          <p className="eyebrow">{t("activity.scores.eyebrow")}</p>
          <h2>{scores.length > 0 ? t("activity.scores.running") : t("activity.scores.threshold.title")}</h2>
        </div>
        <BarChart3 size={22} aria-hidden="true" />
      </header>

      {scores.length > 0 ? (
        <div className="score-bar-list">
          {scores.map((score) => (
            <ScoreBar key={score.label} label={score.label} value={score.value} />
          ))}
        </div>
      ) : null}

      <div className="training-threshold-grid">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.format(metric.value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
