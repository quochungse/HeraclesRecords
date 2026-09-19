import {
  Activity,
  Bike,
  Dumbbell,
  Mountain,
  Snowflake,
  Waves,
  type LucideIcon
} from "lucide-react";
import type { WorkoutSport } from "../../electron/types";
import { RunnerIcon } from "../running/runnerIcon";
import type { SportColorCategory } from "../training/sportColors";
import { WORKOUT_SPORT_COLOR_CATEGORY } from "../training/workoutSport";

const WORKOUT_SPORT_ICON: Record<WorkoutSport, LucideIcon> = {
  run: RunnerIcon,
  trailRun: Mountain,
  bike: Bike,
  swim: Waves,
  strength: Dumbbell,
  hyrox: Activity,
  indoorClimb: Mountain,
  bouldering: Mountain,
  xcSki: Snowflake
};

/** How a scheduled workout's sport is drawn: its colour category and its icon. */
export function workoutSportView(sport: WorkoutSport): {
  category: SportColorCategory;
  icon: LucideIcon;
} {
  return {
    category: WORKOUT_SPORT_COLOR_CATEGORY[sport],
    icon: WORKOUT_SPORT_ICON[sport]
  };
}
