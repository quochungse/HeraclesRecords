/**
 * How one activity's movement is read, for the Coach's card and the text its
 * tools hand the model. Both used to ask one question — is it a ride? — so
 * everything that was not a ride was read as a run: a strength session drew a
 * lap table of empty Distance and Pace columns, a hike read 19:40 /km where its
 * own screen reads km/h, and a swim read a pace per kilometre.
 *
 * - `pace`: a run or a walk, seconds per km, cadence in steps.
 * - `speed`: a ride, km/h, cadence in rpm.
 * - `hike`: a hike or mountain climb, km/h as Hiking reads it, cadence in steps.
 * - `swim`: a pace per 100 m (or yd), the distance in pool units.
 * - `sets`: a gym session — heart rate over time and nothing about movement.
 * - `effort`: any other sport. Speed where it covered ground, no pace.
 *
 * The renderer imports this directly, so it must stay free of `node:` imports.
 */
export type ActivityReading = "pace" | "speed" | "hike" | "swim" | "sets" | "effort";

export const ACTIVITY_READINGS: readonly ActivityReading[] = [
  "pace",
  "speed",
  "hike",
  "swim",
  "sets",
  "effort"
];

/** Gym Cardio, Strength and Custom Indoor Strength. */
const SETS_SPORT_TYPES: ReadonlySet<number> = new Set([400, 402, 9901]);

/** Run, Indoor Run, Trail Run, Track Run, Walk. */
const PACE_SPORT_TYPES: ReadonlySet<number> = new Set([100, 101, 102, 103, 900]);

/** Hike and Mountain Climb, as `isHikeSportType` reads them. */
const HIKE_SPORT_TYPES: ReadonlySet<number> = new Set([104, 105]);

export function activityReading(sportType?: number, sportName?: string): ActivityReading {
  if (sportType !== undefined) {
    if (sportType === 300 || sportType === 301) return "swim";
    if (sportType >= 200 && sportType <= 299) return "speed";
    if (SETS_SPORT_TYPES.has(sportType)) return "sets";
    if (HIKE_SPORT_TYPES.has(sportType)) return "hike";
    if (PACE_SPORT_TYPES.has(sportType)) return "pace";
  }
  // A custom sport carries the athlete's own name, which is all there is to go on.
  const name = sportName ?? "";
  if (/swim/i.test(name)) return "swim";
  if (/bike|cycl|ride/i.test(name)) return "speed";
  if (/strength|gym/i.test(name)) return "sets";
  if (/hike/i.test(name)) return "hike";
  if (/\brun|walk/i.test(name)) return "pace";
  return "effort";
}

/** Whether a distance over time is read as a speed rather than a pace. */
export function readsSpeed(reading: ActivityReading): boolean {
  return reading === "speed" || reading === "hike" || reading === "effort";
}

/** Whether the activity moved at all in a sense a distance or a pace describes. */
export function readsMovement(reading: ActivityReading): boolean {
  return reading !== "sets";
}

/**
 * Seconds per 100 swim units (m, or yd in imperial) from seconds per km — the
 * pace a swimmer reads. A yard is 0.9144 m, so 100 yd is 0.09144 km.
 */
export function swimPacePer100(secondsPerKm: number, unitSystem: "metric" | "imperial"): number {
  return secondsPerKm * (unitSystem === "imperial" ? 0.09144 : 0.1);
}

/** `1:52` — seconds per 100 swim units as a clock. */
export function formatSwimPaceClock(secondsPer100: number): string {
  const rounded = Math.round(secondsPer100);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

/** `1:52 /100m` from seconds per km; `-` for a pace that is not one. */
export function formatSwimPace(
  secondsPerKm: number | undefined,
  unitSystem: "metric" | "imperial"
): string {
  if (!secondsPerKm || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) {
    return "-";
  }
  return `${formatSwimPaceClock(swimPacePer100(secondsPerKm, unitSystem))} /100${
    unitSystem === "imperial" ? "yd" : "m"
  }`;
}
