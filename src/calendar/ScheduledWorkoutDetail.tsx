import { motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Clock,
  Gauge,
  Layers,
  ListChecks,
  Route,
  type LucideIcon
} from "lucide-react";
import { useMemo } from "react";
import type {
  TrainingHubScheduledWorkoutEntry,
  TrainingHubSportType,
  UnitSystem
} from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { useWorkoutExerciseCatalog } from "./useWorkoutExerciseCatalog";
import {
  workoutSportFromType
} from "../../electron/workoutCapabilities";
import {
  formatDurationSeconds,
  formatUpcomingWorkoutLoad,
  formatUpcomingWorkoutVolumeDisplay,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import { sportColorCategory } from "../training/sportColors";
import { resolveSportName } from "../training/sportTypes";
import { workoutSportView } from "./workoutSportIcons";
import { isStrengthStyleWorkout, workoutSportLabel } from "../training/workoutSport";
import {
  buildScheduledWorkoutView,
  formatPlannedVolume,
  formatStepDistanceLabel
} from "./scheduledStructure";
import { WorkoutStructure } from "./WorkoutStructureView";

import { plural, t } from "../i18n/core";
interface ScheduledWorkoutDetailProps {
  entry: TrainingHubScheduledWorkoutEntry;
  sportTypes: TrainingHubSportType[];
  /**
   * Only so a strength session can be named.
   *
   * COROS sends its steps under localization keys — `T1041` for a bench
   * press — so without the exercise catalog every exercise here read as its
   * step kind, "Training" nine times down one session, while the same workout
   * opened from the Calendar's library named all nine. Omit it and the panel
   * draws exactly as it did before; the clips go with it.
   */
  api?: HeraclesRecordsApi;
}

function formatDetailVolume(volume: string | undefined, unitSystem: UnitSystem): string {
  const value = formatUpcomingWorkoutVolumeDisplay(volume, unitSystem);
  const setCount = value.match(/^(\d+(?:\.\d+)?)\s+set\(s\)$/i);
  if (!setCount) return value;

  return plural("workout.sets", Number(setCount[1]));
}

function formatDetailLoad(load?: number): string {
  return formatUpcomingWorkoutLoad(load);
}

export function ScheduledWorkoutDetail({
  entry,
  sportTypes,
  api
}: ScheduledWorkoutDetailProps) {
  const { unitSystem } = useUnitSystem();
  const reduceMotion = useReducedMotion();
  const sport = workoutSportFromType(entry.sportType);
  const { byId: exercises } = useWorkoutExerciseCatalog(api, sport);
  const view = useMemo(
    () => buildScheduledWorkoutView(entry, unitSystem, exercises),
    [entry, exercises, unitSystem]
  );
  const sportMeta = sport ? workoutSportView(sport) : undefined;
  const category =
    sportMeta?.category ?? sportColorCategory(entry.sportType);
  const sportName = sport
    ? workoutSportLabel(sport)
    : (resolveSportName({ sportType: entry.sportType }, sportTypes) ??
      t("workout.untitled"));
  const workoutCategory = inferUpcomingWorkoutCategory(entry.name);
  // The name classifier is run-centric — only surface its chip when it found
  // a real intent (or the sport actually is running) to avoid a bogus "Run"
  // badge on swims/rides/strength sessions.
  const showCategoryChip =
    category === "run" || workoutCategory !== "Run";
  const isStrength = isStrengthStyleWorkout(sport);
  const SportIcon = sportMeta?.icon ?? Activity;

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.28, delay, ease: "easeOut" as const }
        };

  const stats: Array<{ icon: LucideIcon; label: string; value: string }> = [
    {
      icon: Route,
      label: t("workout.detail.volume"),
      value: formatPlannedVolume(view.totals, unitSystem, sport === "swim", () =>
        formatDetailVolume(entry.volume, unitSystem)
      )
    },
    {
      icon: Gauge,
      label: t("workout.detail.plannedLoad"),
      value: formatDetailLoad(entry.trainingLoad)
    }
  ];
  if (view.totals.durationSeconds) {
    stats.push({
      icon: Clock,
      label: t("workout.detail.estDuration"),
      value: formatDurationSeconds(view.totals.durationSeconds)
    });
  }
  const structureSummary = view.totals.stepCount > 0
    ? [
        plural("workout.steps", view.totals.stepCount),
        view.totals.repeatGroups > 0 ? plural("workout.repeatGroups", view.totals.repeatGroups) : null
      ].filter(Boolean).join(", ")
    : undefined;

  return (
    <div className={`sched-detail is-${category}`}>
      <motion.div className="sched-hero" {...rise(0)}>
        <div className="sched-hero-top">
          <span className="sched-hero-icon" aria-hidden="true">
            <SportIcon size={20} />
          </span>
          <div className="sched-hero-title">
            <div className="sched-hero-heading">
              <span className="sched-hero-sport">{sportName}</span>
              {showCategoryChip ? (
                <span className="sched-hero-chip">{workoutCategory}</span>
              ) : null}
            </div>
            {structureSummary ? (
              <span className="sched-hero-context">
                <Layers size={12} aria-hidden="true" />
                {structureSummary}
              </span>
            ) : null}
          </div>
        </div>
        <dl className={`sched-hero-stats is-${stats.length}`}>
          {stats.map((stat) => (
            <div className="sched-stat" key={stat.label}>
              <dt className="sched-stat-label">
                <stat.icon size={12} aria-hidden="true" />
                {stat.label}
              </dt>
              <dd className="sched-stat-value">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </motion.div>

      {view.nodes.length > 0 ? (
        <motion.div className="sched-structure" {...rise(0.06)}>
          <div className="sched-structure-head">
            <h4>
              <ListChecks size={14} aria-hidden="true" />
              {t("workout.detail.structure")}
            </h4>
            {view.totals.distanceMeters ? (
              <span className="sched-structure-total">
                {t("workout.detail.total", {
                  value: formatStepDistanceLabel(view.totals.distanceMeters, unitSystem, sport === "swim")
                })}
              </span>
            ) : null}
          </div>
          <WorkoutStructure
            view={view}
            unitSystem={unitSystem}
            strength={isStrength}
            swim={sport === "swim"}
            exercises={exercises}
          />
        </motion.div>
      ) : (
        <motion.div className="sched-empty" {...rise(0.06)}>
          <ListChecks size={18} aria-hidden="true" />
          <p>{t("workout.detail.noSteps")}</p>
        </motion.div>
      )}
    </div>
  );
}
