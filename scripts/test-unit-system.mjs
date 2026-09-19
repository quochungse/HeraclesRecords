import assert from "node:assert/strict";
import {
  displayDistanceToMeters,
  displayPaceToSecondsPerKm,
  displayWeightToKilograms,
  elevationToMeters,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  formatSpeedValue,
  formatWeightValue,
  metersToDisplayDistance,
  metersToElevation,
  metersToSwimDistance,
  parsePersistedUnitSystem,
  secondsPerKmToDisplayPace,
  swimDistanceToMeters,
  centimetersToDisplayHeight,
  displayHeightToCentimeters,
  heightUnit
} from "../dist-electron/unitSystem.js";

assert.equal(parsePersistedUnitSystem(undefined), "metric");
assert.equal(parsePersistedUnitSystem(null), "metric");
assert.equal(parsePersistedUnitSystem("metric"), "metric");
assert.equal(parsePersistedUnitSystem("imperial"), "imperial");
assert.equal(parsePersistedUnitSystem("IMPERIAL"), "metric");
assert.equal(parsePersistedUnitSystem("broken"), "metric");

assert.equal(formatDistanceValue(1_000, "metric"), "1.00 km");
assert.equal(formatDistanceValue(1_000, "imperial"), "0.62 mi");
assert.equal(formatDistanceValue(100, "imperial", { swim: true }), "109 yd");
assert.equal(formatElevationValue(100, "imperial"), "328 ft");
assert.equal(formatWeightValue(10, "imperial", 1), "22.0 lb");
assert.equal(formatPaceValue(300, "metric"), "5:00 /km");
assert.equal(formatPaceValue(300, "imperial"), "8:03 /mi");
assert.equal(formatSpeedValue(16.09344, "imperial"), "10.0 mph");
assert.equal(formatSpeedValue(16.09344, "metric"), "16.1 km/h");

assert.equal(formatDistanceValue(0, "metric"), "0 km");
assert.equal(formatDistanceValue(-1, "imperial"), "0 mi");
assert.equal(formatDistanceValue(Number.NaN, "imperial"), "0 mi");
assert.equal(formatPaceValue(0, "imperial"), "-");
assert.equal(formatPaceValue(Number.NaN, "metric"), "-");

assert.ok(Math.abs(metersToDisplayDistance(1_609.344, "imperial") - 1) < 1e-12);
assert.ok(Math.abs(displayDistanceToMeters(5, "imperial") - 8_046.72) < 1e-9);
assert.ok(Math.abs(metersToSwimDistance(91.44, "imperial") - 100) < 1e-12);
assert.ok(Math.abs(swimDistanceToMeters(100, "imperial") - 91.44) < 1e-12);
assert.ok(Math.abs(metersToElevation(100, "imperial") - 328.0839895) < 1e-7);
assert.ok(Math.abs(elevationToMeters(328.0839895, "imperial") - 100) < 1e-7);
assert.ok(Math.abs(displayWeightToKilograms(22.046226218, "imperial") - 10) < 1e-9);
assert.ok(Math.abs(secondsPerKmToDisplayPace(300, "imperial") - 482.8032) < 1e-9);
assert.ok(Math.abs(displayPaceToSecondsPerKm(482.8032, "imperial") - 300) < 1e-9);

// Height: COROS stores centimetres whatever the athlete's unit, and the
// Personal screen edits in the displayed one, so the pair has to round-trip
// exactly or an untouched field would diff against itself and be written back.
assert.equal(heightUnit("metric"), "cm");
assert.equal(heightUnit("imperial"), "in");
assert.equal(centimetersToDisplayHeight(180, "metric"), 180);
assert.ok(Math.abs(centimetersToDisplayHeight(177.8, "imperial") - 70) < 1e-9);
assert.ok(Math.abs(displayHeightToCentimeters(70, "imperial") - 177.8) < 1e-9);
for (const cm of [150, 165.5, 177.8, 200]) {
  const back = displayHeightToCentimeters(
    centimetersToDisplayHeight(cm, "imperial"),
    "imperial"
  );
  assert.ok(Math.abs(back - cm) < 1e-9, `height round-trips at ${cm} cm`);
}

console.log("unit-system tests passed");
