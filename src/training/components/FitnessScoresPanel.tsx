import { BarChart3 } from "lucide-react";
import type {
  TrainingHubDashboard,
  TrainingHubRacePredictor
} from "../../../electron/types";
import { buildRunningFitnessPaceLabels, formatOptionalNumber } from "../formatters";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { t } from "../../i18n/core";
import { SegmentedDial } from "./SegmentedDial";

interface FitnessScoresPanelProps {
  dashboard: TrainingHubDashboard | null;
  racePredictor: TrainingHubRacePredictor | null;
}

interface AbilityItem {
  label: string;
  value?: number;
  paceLabel?: string;
}

/**
 * COROS's six Running Fitness levels, as the upper bound of each — its
 * Training Hub's `RunningAbility` card cuts both the dial and the bars at
 * [0, 40, 60, 75, 85, 95, 100], each part as long as its range.
 */
const FITNESS_LEVEL_BOUNDS = [40, 60, 75, 85, 95, 100];
const FITNESS_LEVELS = FITNESS_LEVEL_BOUNDS.map((to, index) => ({
  from: index === 0 ? 0 : FITNESS_LEVEL_BOUNDS[index - 1],
  to
}));

function hasValue(value?: number): value is number {
  return value !== undefined && Number.isFinite(value);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** A score on the six levels: each level filled as far as the score reaches into it. */
function LevelBar({ value }: { value?: number }) {
  const score = hasValue(value) ? clampScore(value) : 0;

  return (
    <div className="running-fitness-levels" aria-hidden="true">
      {FITNESS_LEVELS.map((level) => {
        const share = Math.max(0, Math.min(1, (score - level.from) / (level.to - level.from)));

        return (
          <span
            key={level.to}
            className="running-fitness-level"
            style={{ flexGrow: level.to - level.from }}
          >
            <span className="running-fitness-level-fill" style={{ width: `${share * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}

function Ability({ label, value, paceLabel }: AbilityItem) {
  return (
    <div className="running-fitness-ability">
      <div className="running-fitness-ability-head">
        <span>{label}</span>
        <strong className="figure">{formatOptionalNumber(value)}</strong>
      </div>
      <LevelBar value={value} />
      {paceLabel ? <span className="running-fitness-ability-pace">{paceLabel}</span> : null}
    </div>
  );
}

export function FitnessScoresPanel({
  dashboard,
  racePredictor
}: FitnessScoresPanelProps) {
  const { unitSystem } = useUnitSystem();
  const predictor = racePredictor ?? dashboard?.racePredictor ?? null;
  const paceLabels = buildRunningFitnessPaceLabels(
    dashboard?.ltspZonesDefault ?? [],
    unitSystem
  );
  const abilities: AbilityItem[] = [
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
  ].filter((ability) => hasValue(ability.value));
  // COROS's Running Fitness score is `staminaLevel`; it sends no other total.
  const total = predictor?.staminaLevel;
  const loaded = Boolean(dashboard || predictor);
  const hasFitness = abilities.length > 0 || hasValue(total);

  return (
    <section className="panel training-scores-panel running-fitness-panel">
      <header className="training-scores-header">
        <div className="training-scores-heading">
          <p className="eyebrow">{t("activity.scores.eyebrow")}</p>
          <h2>{loaded ? t("activity.scores.running") : t("activity.scores.notLoaded")}</h2>
        </div>
        <BarChart3 size={22} aria-hidden="true" />
      </header>

      {hasValue(total) ? (
        <SegmentedDial
          weights={FITNESS_LEVELS.map((level) => level.to - level.from)}
          position={clampScore(total) / 100}
          value={formatOptionalNumber(total)}
          label={t("activity.scores.total", { value: formatOptionalNumber(total) })}
        />
      ) : null}

      {abilities.length > 0 ? (
        <div className="running-fitness-abilities">
          {abilities.map((ability) => (
            <Ability key={ability.label} {...ability} />
          ))}
        </div>
      ) : null}

      {hasFitness ? null : (
        <p className="training-empty-chart">{t("activity.scores.failed")}</p>
      )}
    </section>
  );
}
