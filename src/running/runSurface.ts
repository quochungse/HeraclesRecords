import type { TrainingHubActivity } from "../../electron/types";

/**
 * The four surfaces a run happens on, kept apart because they answer different
 * questions.
 *
 * Volume is volume wherever it was run — the legs carry the same load — so the
 * totals on this screen add every surface together. Speed is not: a 6:30/km
 * trail kilometre and a 4:45/km road kilometre put on one axis say nothing, and
 * a treadmill records no climb at all. So pace, efficiency and records are read
 * one surface at a time.
 *
 * Codes are COROS `sportType`; keep them in sync with electron/corosSportTypes.ts.
 */
export type RunSurface = "road" | "trail" | "track" | "treadmill";

/** Render order: outdoors first, most common first. */
export const RUN_SURFACES: readonly RunSurface[] = [
  "road",
  "trail",
  "track",
  "treadmill"
];

const SPORT_TYPE_SURFACE: Record<number, RunSurface> = {
  100: "road", //      Run
  101: "treadmill", // Indoor Run
  102: "trail", //     Trail Run
  103: "track" //      Track Run
};

export const RUN_SURFACE_LABELS: Record<RunSurface, string> = {
  road: "Road",
  trail: "Trail",
  track: "Track",
  treadmill: "Treadmill"
};

/**
 * Hike and mountain climb are deliberately absent. They share the trail colour
 * elsewhere in the app, but a hiking pace in a running pace distribution is
 * noise, and the athlete asking "how is my running going" did not mean them.
 */
export function isRunSportType(sportType: number | undefined): boolean {
  return sportType !== undefined && sportType in SPORT_TYPE_SURFACE;
}

/** The surface a sport code runs on, or null when the code is not a run. */
export function classifyRunSurface(
  sportType: number | undefined
): RunSurface | null {
  if (sportType === undefined) {
    return null;
  }

  return SPORT_TYPE_SURFACE[sportType] ?? null;
}

/**
 * Whether a surface records the outdoors. A treadmill reports no climb and no
 * track, so elevation figures and maps must not count it as a zero — that would
 * drag every average down with data the watch never had.
 */
export function isOutdoorRunSurface(surface: RunSurface): boolean {
  return surface !== "treadmill";
}

/** Every run in a mixed activity list, newest first as COROS sends them. */
export function runsOnly(
  activities: readonly TrainingHubActivity[]
): TrainingHubActivity[] {
  return activities.filter((activity) => isRunSportType(activity.sportType));
}

/** Runs on one surface, or all of them when no surface is asked for. */
export function runsOnSurface(
  activities: readonly TrainingHubActivity[],
  surface: RunSurface | null
): TrainingHubActivity[] {
  const runs = runsOnly(activities);
  return surface === null
    ? runs
    : runs.filter((activity) => classifyRunSurface(activity.sportType) === surface);
}
