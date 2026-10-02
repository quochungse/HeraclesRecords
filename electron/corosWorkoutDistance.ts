import type { UnitSystem, WorkoutSport } from "./types";

/**
 * The `targetDisplayUnit` of a distance target: 1 = km, 2 = m, 3 = mi, 4 = yd.
 * The value itself stays in centimetres whatever the unit.
 *
 * A metric land target over 1,000 m is stated in kilometres: COROS's iOS app
 * was reported cutting a metre target to 1,000 m (upstream CorosLink #124), so
 * a 3 km step arrived on the watch as 1 km. Swimming keeps metres and yards.
 */
export function corosDistanceTargetDisplayUnit(
  meters: number,
  sport: WorkoutSport,
  unitSystem: UnitSystem = "metric",
  preferredUnit?: number
): number {
  const unit = preferredUnit ?? (unitSystem === "imperial"
    ? sport === "swim" ? 4 : 3
    : 2);
  return sport !== "swim" && unit === 2 && meters > 1000 ? 1 : unit;
}
