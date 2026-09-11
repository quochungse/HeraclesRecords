import { CalendarDays, ChevronRight, Moon } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  TrainingHubSportType,
  TrainingHubUpcomingWorkout
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  filterUpcomingWorkoutsFromToday,
  formatUpcomingWorkoutDate,
  formatUpcomingWorkoutDetailLine,
  formatUpcomingWorkoutRowStats,
  formatUpcomingWorkoutStats,
  inferUpcomingWorkoutCategory,
  isUpcomingWorkoutToday
} from "../formatters";
import { UpcomingWorkoutDetailPanel } from "./UpcomingWorkoutDetailPanel";

interface UpcomingWorkoutsPanelProps {
  api: CorosLinkApi | undefined;
  workouts: TrainingHubUpcomingWorkout[];
  sportTypes: TrainingHubSportType[];
}

export function UpcomingWorkoutsPanel({
  api,
  workouts,
  sportTypes
}: UpcomingWorkoutsPanelProps) {
  const { unitSystem } = useUnitSystem();
  const [selected, setSelected] = useState<TrainingHubUpcomingWorkout | null>(
    null
  );
  const scheduledWorkouts = useMemo(
    () => filterUpcomingWorkoutsFromToday(workouts),
    [workouts]
  );
  const todayWorkouts = scheduledWorkouts.filter((workout) =>
    isUpcomingWorkoutToday(workout.happenDay)
  );
  const laterWorkouts = scheduledWorkouts.filter(
    (workout) => !isUpcomingWorkoutToday(workout.happenDay)
  );
  const nextWorkout = laterWorkouts[0];
  const countLabel = `${scheduledWorkouts.length} upcoming ${
    scheduledWorkouts.length === 1 ? "workout" : "workouts"
  }`;
  const statsLabel = formatUpcomingWorkoutStats(scheduledWorkouts, unitSystem);

  return (
    <section className="panel training-upcoming-panel">
      <header className="training-upcoming-header">
        <div className="training-upcoming-heading">
          <p className="eyebrow">Training Calendar</p>
          <h2>Upcoming Workouts</h2>
          {scheduledWorkouts.length > 0 ? (
            <p className="training-upcoming-count">{countLabel}</p>
          ) : null}
        </div>
        {scheduledWorkouts.length > 0 ? (
          <p className="training-upcoming-stats">{statsLabel}</p>
        ) : null}
      </header>

      {scheduledWorkouts.length === 0 ? (
        <div className="training-empty-state">
          <p>No scheduled workouts in the next two weeks.</p>
        </div>
      ) : (
        <div className="training-upcoming-body">
          {todayWorkouts.length > 0 ? (
            <div className="training-upcoming-today-stack">
              {todayWorkouts.map((workout, index) => (
                <TodayWorkoutCard
                  key={`today-${workout.happenDay}-${workout.sortNo ?? index}-${workout.name}`}
                  workout={workout}
                  onOpen={() => setSelected(workout)}
                />
              ))}
            </div>
          ) : (
            <RestDayCard nextWorkout={nextWorkout} />
          )}

          {laterWorkouts.length > 0 ? (
            <ul className="training-upcoming-list">
              {laterWorkouts.map((workout, index) => {
                const rowStats = formatUpcomingWorkoutRowStats(
                  workout.volume,
                  workout.trainingLoad,
                  unitSystem
                );

                return (
                  <li
                    className="training-upcoming-item"
                    key={`${workout.happenDay}-${workout.sortNo ?? index}-${workout.name}`}
                  >
                    <button
                      type="button"
                      className="training-upcoming-row"
                      onClick={() => setSelected(workout)}
                    >
                      <span className="training-upcoming-rail" aria-hidden="true">
                        <span className="training-upcoming-dot" />
                      </span>
                      <span className="training-upcoming-date">
                        {formatUpcomingWorkoutDate(workout.happenDay)}
                      </span>
                      <span className="training-upcoming-main">
                        <span className="training-upcoming-title-row">
                          <strong className="training-upcoming-title">
                            {workout.name}
                          </strong>
                          <span className="training-upcoming-tag">
                            {inferUpcomingWorkoutCategory(workout.name)}
                          </span>
                        </span>
                        {rowStats ? (
                          <span className="training-upcoming-row-stats">
                            {rowStats}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="training-upcoming-chevron"
                        aria-hidden="true"
                      >
                        <ChevronRight size={18} strokeWidth={2.2} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}

      <UpcomingWorkoutDetailPanel
        api={api}
        workout={selected}
        sportTypes={sportTypes}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}

function TodayWorkoutCard({
  workout,
  onOpen
}: {
  workout: TrainingHubUpcomingWorkout;
  onOpen: () => void;
}) {
  const { unitSystem } = useUnitSystem();
  const category = inferUpcomingWorkoutCategory(workout.name);
  const detailLine = formatUpcomingWorkoutDetailLine(
    category,
    workout.volume,
    workout.trainingLoad,
    unitSystem
  );

  return (
    <button
      type="button"
      className="training-upcoming-today training-upcoming-today-button"
      onClick={onOpen}
    >
      <span className="training-upcoming-today-icon" aria-hidden="true">
        <CalendarDays size={22} strokeWidth={2.2} />
      </span>
      <span className="training-upcoming-today-copy">
        <span className="training-upcoming-today-heading">
          <span className="training-upcoming-today-pill">Today</span>
          <span className="training-upcoming-today-tag">{category}</span>
        </span>
        <span className="training-upcoming-today-title">{workout.name}</span>
        <span className="training-upcoming-today-meta">{detailLine}</span>
      </span>
      <span className="training-upcoming-chevron" aria-hidden="true">
        <ChevronRight size={18} strokeWidth={2.2} />
      </span>
    </button>
  );
}

function RestDayCard({
  nextWorkout
}: {
  nextWorkout: TrainingHubUpcomingWorkout | undefined;
}) {
  return (
    <article className="training-upcoming-today training-upcoming-today-empty">
      <div className="training-upcoming-today-icon" aria-hidden="true">
        <Moon size={20} strokeWidth={2.2} />
      </div>
      <div className="training-upcoming-today-copy">
        <span className="training-upcoming-today-pill">Today</span>
        <h3 className="training-upcoming-today-title">Rest day</h3>
        <p className="training-upcoming-today-meta">
          No workout scheduled for today.
        </p>
        {nextWorkout ? (
          <p className="training-upcoming-today-next">
            Next up{" "}
            <strong>
              {formatUpcomingWorkoutDate(nextWorkout.happenDay)} — {nextWorkout.name}
            </strong>
          </p>
        ) : null}
      </div>
    </article>
  );
}
