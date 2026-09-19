import type { UnitSystem } from "./types.js";

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_YARD = 0.9144;
export const FEET_PER_METER = 3.280839895;
export const POUNDS_PER_KILOGRAM = 2.2046226218;
export const CENTIMETERS_PER_INCH = 2.54;

export function normalizeUnitSystem(value: unknown): UnitSystem {
  return value === "imperial" ? "imperial" : "metric";
}

/** Parses the persisted preference without trusting arbitrary storage values. */
export const parsePersistedUnitSystem = normalizeUnitSystem;

export function metersToDisplayDistance(
  meters: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? meters / METERS_PER_MILE : meters / 1000;
}

export function displayDistanceToMeters(
  value: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? value * METERS_PER_MILE : value * 1000;
}

export function metersToSwimDistance(
  meters: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? meters / METERS_PER_YARD : meters;
}

export function swimDistanceToMeters(
  value: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? value * METERS_PER_YARD : value;
}

export function metersToElevation(
  meters: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? meters * FEET_PER_METER : meters;
}

export function elevationToMeters(
  value: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? value / FEET_PER_METER : value;
}

export function kilogramsToDisplayWeight(
  kilograms: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial"
    ? kilograms * POUNDS_PER_KILOGRAM
    : kilograms;
}

export function displayWeightToKilograms(
  value: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? value / POUNDS_PER_KILOGRAM : value;
}

export function secondsPerKmToDisplayPace(
  secondsPerKm: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial"
    ? secondsPerKm * (METERS_PER_MILE / 1000)
    : secondsPerKm;
}

export function displayPaceToSecondsPerKm(
  seconds: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial"
    ? seconds / (METERS_PER_MILE / 1000)
    : seconds;
}

export function kmhToDisplaySpeed(
  kmh: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? kmh / 1.609344 : kmh;
}

export function displaySpeedToKmh(
  value: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? value * 1.609344 : value;
}

export function distanceUnit(unitSystem: UnitSystem): "km" | "mi" {
  return unitSystem === "imperial" ? "mi" : "km";
}

export function swimDistanceUnit(unitSystem: UnitSystem): "m" | "yd" {
  return unitSystem === "imperial" ? "yd" : "m";
}

export function elevationUnit(unitSystem: UnitSystem): "m" | "ft" {
  return unitSystem === "imperial" ? "ft" : "m";
}

/**
 * Body height. COROS stores it in centimetres whatever the athlete's unit is,
 * and shows inches on imperial — not feet-and-inches, which is two numbers and
 * cannot go in one number field.
 */
export function centimetersToDisplayHeight(
  centimeters: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial"
    ? centimeters / CENTIMETERS_PER_INCH
    : centimeters;
}

export function displayHeightToCentimeters(
  value: number,
  unitSystem: UnitSystem
): number {
  return unitSystem === "imperial" ? value * CENTIMETERS_PER_INCH : value;
}

export function heightUnit(unitSystem: UnitSystem): "cm" | "in" {
  return unitSystem === "imperial" ? "in" : "cm";
}

/**
 * Temperature is COROS's *other* display setting (`temperatureUnit`: 0 Celsius,
 * 1 Fahrenheit) and it does not follow `unit` — an athlete can measure in
 * kilometres and still read Fahrenheit, which is why COROS gives it its own
 * toggle and why this is not derived from `UnitSystem`.
 */
export type TemperatureUnit = "celsius" | "fahrenheit";

export function celsiusToDisplayTemperature(
  celsius: number,
  temperatureUnit: TemperatureUnit
): number {
  return temperatureUnit === "fahrenheit" ? celsius * 1.8 + 32 : celsius;
}

export function temperatureUnitLabel(
  temperatureUnit: TemperatureUnit
): "°C" | "°F" {
  return temperatureUnit === "fahrenheit" ? "°F" : "°C";
}

export function formatTemperatureValue(
  celsius: number,
  temperatureUnit: TemperatureUnit
): string {
  return `${Math.round(
    celsiusToDisplayTemperature(celsius, temperatureUnit)
  )}${temperatureUnitLabel(temperatureUnit)}`;
}

export function weightUnit(unitSystem: UnitSystem): "kg" | "lb" {
  return unitSystem === "imperial" ? "lb" : "kg";
}

export function speedUnit(unitSystem: UnitSystem): "km/h" | "mph" {
  return unitSystem === "imperial" ? "mph" : "km/h";
}

export function formatDistanceValue(
  meters: number | undefined,
  unitSystem: UnitSystem,
  options: { swim?: boolean; digits?: number } = {}
): string {
  if (!Number.isFinite(meters) || (meters ?? 0) <= 0) {
    return options.swim ? `0 ${swimDistanceUnit(unitSystem)}` : `0 ${distanceUnit(unitSystem)}`;
  }
  if (options.swim) {
    const value = metersToSwimDistance(meters ?? 0, unitSystem);
    const digits = options.digits ?? 0;
    return `${value.toFixed(digits)} ${swimDistanceUnit(unitSystem)}`;
  }
  const value = metersToDisplayDistance(meters ?? 0, unitSystem);
  const digits = options.digits ?? (Math.abs(value) >= 10 ? 1 : 2);
  return `${value.toFixed(digits)} ${distanceUnit(unitSystem)}`;
}

export function formatElevationValue(
  meters: number | undefined,
  unitSystem: UnitSystem,
  empty = "-"
): string {
  if (!Number.isFinite(meters) || !meters) return empty;
  return `${Math.round(metersToElevation(meters ?? 0, unitSystem))} ${elevationUnit(unitSystem)}`;
}

export function formatPaceValue(
  secondsPerKm: number | undefined,
  unitSystem: UnitSystem,
  compact = false
): string {
  if (!Number.isFinite(secondsPerKm) || !secondsPerKm || secondsPerKm <= 0) {
    return compact ? "" : "-";
  }
  const rounded = Math.round(secondsPerKmToDisplayPace(secondsPerKm, unitSystem));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  const clock = compact
    ? `${String(minutes).padStart(2, "0")}'${String(seconds).padStart(2, "0")}"`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${clock}${compact ? "" : ` /${distanceUnit(unitSystem)}`}`;
}

export function formatSpeedValue(
  kilometresPerHour: number | undefined,
  unitSystem: UnitSystem,
  digits = 1
): string {
  if (!Number.isFinite(kilometresPerHour) || kilometresPerHour! < 0) {
    return `- ${speedUnit(unitSystem)}`;
  }
  return `${kmhToDisplaySpeed(kilometresPerHour ?? 0, unitSystem).toFixed(digits)} ${speedUnit(unitSystem)}`;
}

export function formatWeightValue(
  kilograms: number,
  unitSystem: UnitSystem,
  digits = Number.isInteger(kilograms) ? 0 : 1
): string {
  return `${kilogramsToDisplayWeight(kilograms, unitSystem).toFixed(digits)} ${weightUnit(unitSystem)}`;
}
