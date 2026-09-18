import { useCallback, useEffect, useState } from "react";
import { Info, RotateCw } from "lucide-react";
import type { StrengthDataSource } from "../../electron/types";
import { OptionGroup } from "../components/OptionGroup";
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
import { analyticsCoverage, type SessionHeat } from "./sessionAnalytics";
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
  /** What the muscle panel reads, and by default what the figure draws. */
  analytics: StrengthAnalytics;
  /** COROS is the only source that reports time under load. */
  source: StrengthDataSource;
  /** Dev view unlocks the figure's layer controls. */
  showDevelopmentTools?: boolean;
  /**
   * What the figure draws and the scale it is read on, when that is not
   * `analytics` against its own busiest muscle — one session read against the
   * window, or a Full Body session drawn faintly. The panel shares the scale.
   */
  resolveHeat?: (metric: HeatMetric) => SessionHeat;
  /** Words the no-attribution note for one session rather than a stretch of time. */
  scope?: "window" | "session";
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
  showDevelopmentTools = false,
  resolveHeat,
  scope = "window"
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
  const heat = resolveHeat
    ? resolveHeat(metric)
    : { muscleById: analytics.muscleById, max: analytics.muscleMax[metric] };
  const hasSessions = analytics.summary.sessions > 0;
  const coverage = analyticsCoverage(analytics);
  const genericSetCount = Math.round(coverage.generic);

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
          <OptionGroup
            label="Body view"
            tone="quiet"
            value={view}
            options={[
              { value: "front", label: "Front" },
              { value: "back", label: "Back" }
            ]}
            onChange={(next) => requestView(next as BodyView)}
          />
          <button
            type="button"
            className="strength-flip"
            aria-label="Flip the figure"
            onClick={() => requestView(view === "front" ? "back" : "front")}
          >
            <RotateCw size={15} aria-hidden="true" />
          </button>
          <OptionGroup
            label="Heat metric"
            tone="quiet"
            value={metric}
            options={METRIC_OPTIONS.filter(
              (option) => source === "coros" || option.id !== "time"
            ).map((option) => ({ value: option.id, label: option.label }))}
            onChange={(next) => setMetric(next as HeatMetric)}
          />
        </div>

        <BodyMapV2
          view={view}
          viewRequest={viewRequest}
          metric={metric}
          muscleById={heat.muscleById}
          max={heat.max}
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
        {hasSessions && coverage.working > 0 && coverage.attributed <= 0 ? (
          <div className="muscle-panel is-unattributed">
            <span className="muscle-panel-unattributed-icon" aria-hidden="true">
              <Info size={22} />
            </span>
            <p className="eyebrow">Muscle attribution</p>
            <h3>No specific muscle data</h3>
            <p>
              {scope === "session"
                ? genericSetCount > 0
                  ? `COROS recorded this session only as Full Body, across ${genericSetCount.toLocaleString()} working ${
                      genericSetCount === 1 ? "set" : "sets"
                    }, so the whole figure is drawn at the lightest level. No specific muscle was identified.`
                  : "None of this session's exercises could be matched to specific muscles, so the map stays neutral."
                : genericSetCount > 0
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
            max={heat.max}
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
