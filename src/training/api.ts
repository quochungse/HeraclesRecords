import type {
  TrainingHubDashboard,
  TrainingHubUpcomingWorkout
} from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";

function fallbackDashboard(
  racePredictor: TrainingHubDashboard["racePredictor"]
): TrainingHubDashboard {
  return {
    racePredictor,
    recoveryPct: racePredictor.recoveryPct,
    lthrZones: [],
    ltspZones: [],
    personalRecords: []
  };
}

export async function fetchTrainingDashboard(
  api: HeraclesRecordsApi
): Promise<TrainingHubDashboard> {
  if (typeof api.getTrainingDashboard === "function") {
    return api.getTrainingDashboard();
  }

  return fallbackDashboard(await api.getRacePredictor());
}

export async function fetchUpcomingWorkouts(
  api: HeraclesRecordsApi,
  days = 14
): Promise<TrainingHubUpcomingWorkout[]> {
  if (typeof api.getUpcomingWorkouts === "function") {
    return api.getUpcomingWorkouts(days);
  }

  return [];
}
