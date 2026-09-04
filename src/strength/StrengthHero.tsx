import { useCallback, useEffect, useState } from "react";
import { Info, RotateCw } from "lucide-react";
import type { StrengthDataSource } from "../../electron/types";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { resolveMuscleView } from "./bodyFocus";
import { BodyMapV2, type BodyView } from "./BodyMapV2";
import { MusclePanel } from "./MusclePanel";
import { MUSCLE_BY_ID, type MuscleId } from "./muscles";
import type { HeatMetric, StrengthAnalytics } from "./strengthAnalytics";
import "./strength.css";

const METRIC_OPTIONS: { id: HeatMetric; label: string }[] = [
  { id: "sets", label: "Sets" },
  { id: "volume", label: "Volume" },
  { id: "time", label: "Time" }
];

const STRENGTH_BODY_VIEW_PREFERENCE = defineSelectionPreference<BodyView>({
  key: "strength.bodyView",
  defaultValue: "front",
  validate: selectionIsOneOf(["front", "back"])
});

const STRENGTH_METRIC_PREFERENCE = defineSelectionPreference<HeatMetric>({
  key: "strength.metric",
  defaultValue: "sets",
  validate: selectionIsOneOf(["sets", "volume", "time"])
});

interface StrengthHeroProps {
  analytics: StrengthAnalytics;
  /** COROS is the only source that reports time under load. */
  source: StrengthDataSource;
  /** Dev view unlocks the figure's layer controls. */
  showDevelopmentTools?: boolean;
}

/**
 * The body heat map and the muscle breakdown beside it — the pair the Strength
 * screen opens with, and the whole of the Overview's Strength Distribution.
 * Selection and hover are shared between the two halves, so they live here
 * rather than in either caller.
 */
export function StrengthHero({
  analytics,
  source,
  showDevelopmentTools = false
}: StrengthHeroProps) {
  const { unitSystem } = useUnitSystem();
  const [view, setView] = useSelectionPreference(STRENGTH_BODY_VIEW_PREFERENCE);
  const [viewRequest, setViewRequest] = useState(0);
  const [metric, setMetric] = useSelectionPreference(STRENGTH_METRIC_PREFERENCE);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleId | null>(null);
  const [figureHover, setFigureHover] = useState<MuscleId | null>(null);
  const [listHover, setListHover] = useState<MuscleId | null>(null);

  useEffect(() => {
    if (source !== "coros" && metric === "time") {
      setMetric("sets");
    }
  }, [metric, source]);

  const requestView = useCallback((next: BodyView) => {
    setSelectedMuscle(null);
    setFigureHover(null);
    setListHover(null);
    setView(next);
    setViewRequest((current) => current + 1);
  }, []);

  const selectMuscle = useCallback(
    (muscle: MuscleId | null) => {
      setFigureHover(null);
      setListHover(null);

      if (muscle === null || muscle === selectedMuscle) {
        setSelectedMuscle(null);
        return;
      }

      const nextView = resolveMuscleView(MUSCLE_BY_ID[muscle].view, view);
      if (nextView !== view) {
        setView(nextView);
        setViewRequest((current) => current + 1);
      }
      setSelectedMuscle(muscle);
    },
    [selectedMuscle, view]
  );

  const highlightedMuscle = figureHover ?? listHover ?? selectedMuscle;
  const heatMax = analytics.muscleMax[metric];
  const hasSessions = analytics.summary.sessions > 0;
  const genericSetCount = Math.round(analytics.genericSets);
  const workingSetCount = Math.round(
    analytics.attributedSets + analytics.genericSets + analytics.unmappedSets
  );

  return (
    <div
      className="strength-hero"
      onKeyDown={(event) => {
        if (event.key === "Escape" && selectedMuscle) {
          event.preventDefault();
          selectMuscle(null);
        }
      }}
    >
      <section className="panel strength-body-panel">
        <div className="strength-body-controls">
          <div className="strength-segmented" role="group" aria-label="Body view">
            <button
              type="button"
              className={view === "front" ? "is-active" : ""}
              aria-pressed={view === "front"}
              onClick={() => requestView("front")}
            >
              Front
            </button>
            <button
              type="button"
              className={view === "back" ? "is-active" : ""}
              aria-pressed={view === "back"}
              onClick={() => requestView("back")}
            >
              Back
            </button>
          </div>
          <button
            type="button"
            className="strength-flip"
            aria-label="Flip the figure"
            onClick={() => requestView(view === "front" ? "back" : "front")}
          >
            <RotateCw size={15} aria-hidden="true" />
          </button>
          <div className="strength-segmented is-quiet" role="group" aria-label="Heat metric">
            {METRIC_OPTIONS.filter(
              (option) => source === "coros" || option.id !== "time"
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                className={metric === option.id ? "is-active" : ""}
                aria-pressed={metric === option.id}
                onClick={() => setMetric(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <BodyMapV2
          view={view}
          viewRequest={viewRequest}
          metric={metric}
          muscleById={analytics.muscleById}
          max={heatMax}
          selected={selectedMuscle}
          hovered={highlightedMuscle}
          onHover={setFigureHover}
          onSelect={selectMuscle}
          onViewChange={requestView}
          showLayerControls={showDevelopmentTools}
        />

        <div className="strength-legend" aria-hidden="true">
          <span>Light</span>
          <span className="strength-legend-ramp">
            {[1, 2, 3, 4, 5].map((level) => (
              <i key={level} data-level={level} />
            ))}
          </span>
          <span>Hammered</span>
        </div>
      </section>

      <section className="panel strength-muscle-panel">
        {hasSessions && workingSetCount > 0 && analytics.attributedSets <= 0 ? (
          <div className="muscle-panel is-unattributed">
            <span className="muscle-panel-unattributed-icon" aria-hidden="true">
              <Info size={22} />
            </span>
            <p className="eyebrow">Muscle attribution</p>
            <h3>No specific muscle data</h3>
            <p>
              {genericSetCount > 0
                ? `COROS recorded ${genericSetCount.toLocaleString()} working ${
                    genericSetCount === 1 ? "set" : "sets"
                  } only as Full Body. Session totals remain available, but the map stays neutral because no specific muscles were identified.`
                : "None of the exercises in this window could be matched to specific muscles. Session totals remain available, but the map stays neutral."}
            </p>
          </div>
        ) : (
          <MusclePanel
            muscles={analytics.muscles}
            muscleById={analytics.muscleById}
            metric={metric}
            max={heatMax}
            active={selectedMuscle}
            onSelect={selectMuscle}
            onHover={setListHover}
            unitSystem={unitSystem}
          />
        )}
      </section>
    </div>
  );
}
