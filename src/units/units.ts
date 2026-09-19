import type { UnitSystem } from "../../electron/types";
import type { TemperatureUnit } from "../../electron/unitSystem";
import { parsePersistedUnitSystem } from "../../electron/unitSystem";
export { parsePersistedUnitSystem };
export {
  CENTIMETERS_PER_INCH,
  FEET_PER_METER,
  METERS_PER_MILE,
  METERS_PER_YARD,
  POUNDS_PER_KILOGRAM,
  displayDistanceToMeters,
  displayPaceToSecondsPerKm,
  displaySpeedToKmh,
  displayWeightToKilograms,
  distanceUnit,
  celsiusToDisplayTemperature,
  centimetersToDisplayHeight,
  displayHeightToCentimeters,
  elevationToMeters,
  elevationUnit,
  heightUnit,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  formatSpeedValue,
  formatWeightValue,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  metersToSwimDistance,
  normalizeUnitSystem,
  secondsPerKmToDisplayPace,
  speedUnit,
  swimDistanceToMeters,
  swimDistanceUnit,
  formatTemperatureValue,
  temperatureUnitLabel,
  weightUnit
} from "../../electron/unitSystem";
export type { TemperatureUnit } from "../../electron/unitSystem";
export type { UnitSystem } from "../../electron/types";

/**
 * The last unit the COROS account reported, kept so the first paint of the next
 * launch is already in it. This is a cache of the account, not a preference:
 * the switch that decides it is the Measurement toggle in Personal, which
 * writes to COROS. Reading it back gives the right answer on every machine of
 * one account, which is why it is classified `derived` in `syncPolicy.ts`
 * rather than travelling as a setting of its own.
 */
export const UNIT_SYSTEM_STORAGE_KEY = "coroslink.unitSystem";

export function readCachedUnitSystem(): UnitSystem {
  try {
    return parsePersistedUnitSystem(
      window.localStorage.getItem(UNIT_SYSTEM_STORAGE_KEY)
    );
  } catch {
    return "metric";
  }
}

export function cacheUnitSystem(unitSystem: UnitSystem): void {
  try {
    window.localStorage.setItem(UNIT_SYSTEM_STORAGE_KEY, unitSystem);
  } catch {
    // localStorage can be unavailable in restricted renderer environments.
  }
}

/**
 * COROS's `unit` field: 0 metric, 1 imperial. Anything else — the field absent
 * on an account COROS has not filled in, a value neither code — is `undefined`
 * rather than metric, so a caller can tell "the account says metric" from "the
 * account did not say", and leave what is on screen alone in the second case.
 */
/** Where the last temperature unit the account reported is kept. See above. */
export const TEMPERATURE_UNIT_STORAGE_KEY = "coroslink.temperatureUnit";

export function readCachedTemperatureUnit(): TemperatureUnit {
  try {
    return window.localStorage.getItem(TEMPERATURE_UNIT_STORAGE_KEY) ===
      "fahrenheit"
      ? "fahrenheit"
      : "celsius";
  } catch {
    return "celsius";
  }
}

export function cacheTemperatureUnit(temperatureUnit: TemperatureUnit): void {
  try {
    window.localStorage.setItem(TEMPERATURE_UNIT_STORAGE_KEY, temperatureUnit);
  } catch {
    // localStorage can be unavailable in restricted renderer environments.
  }
}

/** COROS's `temperatureUnit`: 0 Celsius, 1 Fahrenheit. Unstated is undefined,
 *  for the reason `unitSystemFromCorosUnit` gives. */
export function temperatureUnitFromCoros(
  temperatureUnit: number | undefined
): TemperatureUnit | undefined {
  if (temperatureUnit === 1) return "fahrenheit";
  if (temperatureUnit === 0) return "celsius";
  return undefined;
}

export function unitSystemFromCorosUnit(
  unit: number | undefined
): UnitSystem | undefined {
  if (unit === 1) return "imperial";
  if (unit === 0) return "metric";
  return undefined;
}
