import { useCallback, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
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
import { plural, t } from "../i18n/core";

const metricOptions = (): { id: HeatMetric; label: string }[] => [
  { id: "sets", label: t("strength.summary.sets") },
  { id: "volume", label: t("strength.metric.volume") },
  { id: "time", label: t("activity.m.time") }
];

// Turning is remembered on this machine, and is where a new install starts;
// front or back only for the session, so a launch after the turn was stopped
// opens on the front.
const BODY_ROTATE_STORAGE_KEY = "heraclesrecords.strength.bodyRotate";

function readStoredRotating(): boolean {
  try {
    return localStorage.getItem(BODY_ROTATE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredRotating(rotating: boolean): void {
  try {
    localStorage.setItem(BODY_ROTATE_STORAGE_KEY, String(rotating));
  } catch {
    // Storage unavailable: the choice lasts the session.
  }
}

let sessionBodyView: BodyView = "front";
let sessionRotating: boolean | null = null;

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
 * screen opens with, and the one Overview's Strength section reads over four
 * weeks.
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
  const [view, setViewState] = useState<BodyView>(() => sessionBodyView);
  const setView = useCallback((next: BodyView) => {
    sessionBodyView = next;
    setViewState(next);
  }, []);
  const [rotating, setRotatingState] = useState(
    () => (sessionRotating ??= readStoredRotating())
  );
  const setRotating = useCallback((next: boolean) => {
    sessionRotating = next;
    writeStoredRotating(next);
    setRotatingState(next);
  }, []);
  // Where the turning body faces, so a muscle picked mid-turn stops on the
  // side it is seen from rather than on the side last chosen.
  const facingRef = useRef<BodyView>(view);
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
    setRotating(false);
    setView(next);
    setViewRequest((current) => current + 1);
  }, []);

  const startRotating = useCallback(() => {
    setSelectedMuscle(null);
    setFigureHover(null);
    setListHover(null);
    setRotating(true);
  }, []);

  const selectMuscle = useCallback(
    (muscle: MuscleId | null) => {
      setFigureHover(null);
      setListHover(null);

      if (muscle === null || muscle === selectedMuscle) {
        setSelectedMuscle(null);
        return;
      }

      // Zooming in pauses the turn rather than ending it: the body settles on
      // the side the muscle is on, and turns again once it is let go. Only the
      // first muscle is picked from a turning body; after that the camera
      // stands on `view`.
      const facing =
        rotating && selectedMuscle === null ? facingRef.current : view;
      const nextView = resolveMuscleView(MUSCLE_BY_ID[muscle].view, facing);
      if (nextView !== view) {
        setView(nextView);
        setViewRequest((current) => current + 1);
      }
      setSelectedMuscle(muscle);
    },
    [rotating, selectedMuscle, setView, view]
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
      className="panel strength-hero"
      onKeyDown={(event) => {
        if (event.key === "Escape" && selectedMuscle) {
          event.preventDefault();
          selectMuscle(null);
        }
      }}
    >
      <section className="strength-body-panel">
        {/* The whole figure's controls: with a muscle in focus they step
            aside, and the way back is the panel's "All muscles". */}
        <div
          className={`strength-body-view${selectedMuscle ? " is-hidden" : ""}`}
          inert={selectedMuscle !== null}
        >
          <OptionGroup
            label={t("strength.bodyView")}
            tone="quiet"
            value={rotating ? "rotate" : view}
            options={[
              { value: "front", label: t("strength.front") },
              { value: "back", label: t("strength.back") },
              { value: "rotate", label: t("strength.rotate") }
            ]}
            onChange={(next) =>
              next === "rotate" ? startRotating() : requestView(next as BodyView)
            }
          />
        </div>

        <BodyMapV2
          view={view}
          viewRequest={viewRequest}
          rotating={rotating}
          facingRef={facingRef}
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
      </section>

      <section className="strength-muscle-panel">
        {hasSessions && coverage.working > 0 && coverage.attributed <= 0 ? (
          <div className="muscle-panel is-unattributed">
            <span className="muscle-panel-unattributed-icon" aria-hidden="true">
              <Info size={22} />
            </span>
            <p className="eyebrow">{t("strength.attribution.eyebrow")}</p>
            <h3>{t("strength.attribution.none")}</h3>
            <p>
              {scope === "session"
                ? genericSetCount > 0
                  ? plural("strength.attribution.sessionFullBody", genericSetCount)
                  : t("strength.attribution.sessionUnmatched")
                : genericSetCount > 0
                  ? plural("strength.attribution.windowFullBody", genericSetCount)
                  : t("strength.attribution.windowUnmatched")}
            </p>
          </div>
        ) : (
          <MusclePanel
            muscles={analytics.muscles}
            muscleById={analytics.muscleById}
            metric={metric}
            metricSwitch={
              <OptionGroup
                label={t("strength.heatMetric")}
                tone="quiet"
                className="muscle-panel-metric"
                value={metric}
                options={metricOptions()
                  .filter((option) => source === "coros" || option.id !== "time")
                  .map((option) => ({ value: option.id, label: option.label }))}
                onChange={(next) => setMetric(next as HeatMetric)}
              />
            }
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
