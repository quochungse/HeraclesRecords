// The app's unit system has one source — the COROS account — and one switch,
// the Measurement toggle in Personal. This suite holds both halves of that.
//
// It fails in four places against the shape this replaced, where Settings →
// Units set the unit independently and Personal wrote only to COROS: an athlete
// who set Imperial on the screen that is about them went on reading kilometres,
// and a unit changed in the COROS app reached this app never.
//
// Runs through Electron for `--experimental-strip-types`: the graph is renderer
// TypeScript, and the Linux box's distro Node is built without Amaro.
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const units = await import(
  `${pathToFileURL(path.join(root, "src/units/units.ts")).href}?cacheBust=${Date.now()}`
);

// --- 1. COROS's own encoding, and the third answer that is not a unit -------
// `unit` absent is not metric: an account COROS has never filled in says
// nothing about this machine, and resolving it to metric would drag an
// imperial athlete back every time the profile came up short.
assert.equal(units.unitSystemFromCorosUnit(0), "metric");
assert.equal(units.unitSystemFromCorosUnit(1), "imperial");
assert.equal(units.unitSystemFromCorosUnit(undefined), undefined);
assert.equal(units.unitSystemFromCorosUnit(7), undefined);

// Temperature is COROS's *other* display setting and does not follow the first:
// an athlete measures in kilometres and reads Fahrenheit if they say so.
assert.equal(units.temperatureUnitFromCoros(0), "celsius");
assert.equal(units.temperatureUnitFromCoros(1), "fahrenheit");
assert.equal(units.temperatureUnitFromCoros(undefined), undefined);

// --- 2. The cache is a cache, and survives a bad read ----------------------
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  }
};
assert.equal(units.readCachedUnitSystem(), "metric", "nothing cached reads metric");
units.cacheUnitSystem("imperial");
assert.equal(store.get(units.UNIT_SYSTEM_STORAGE_KEY), "imperial");
assert.equal(units.readCachedUnitSystem(), "imperial");
store.set(units.UNIT_SYSTEM_STORAGE_KEY, "furlongs");
assert.equal(units.readCachedUnitSystem(), "metric", "a junk value is not trusted");

assert.equal(units.readCachedTemperatureUnit(), "celsius");
units.cacheTemperatureUnit("fahrenheit");
assert.equal(units.readCachedTemperatureUnit(), "fahrenheit");

// --- 2b. Degrees are converted, never relabelled ---------------------------
assert.equal(units.formatTemperatureValue(0, "celsius"), "0°C");
assert.equal(units.formatTemperatureValue(0, "fahrenheit"), "32°F");
assert.equal(units.formatTemperatureValue(21, "fahrenheit"), "70°F");

// --- 3. One switch ---------------------------------------------------------
// Settings must not offer a second one. A unit control there and a Measurement
// toggle in Personal is two answers to one question, and they disagreed.
const settings = read("src/settings/SettingsView.tsx");
assert.ok(
  !/useUnitSystem|Unit system|UNIT_SYSTEMS/.test(settings),
  "Settings must not carry a unit switch of its own"
);

// The switch that remains writes to COROS and then tells the app, and it must
// pass `refresh`: the profile is otherwise served from the main process's
// hour-long cache, which still holds the unit as it was a moment ago.
const profile = read("src/profile/ProfileView.tsx");
assert.ok(
  /patch\.unit !== undefined[\s\S]{0,200}refreshUnitSystem\(\{ refresh: true \}\)/.test(profile),
  "saving Measurement must refresh the app's unit from the account"
);

// --- 4. The provider asks the account, and keeps what it has when it cannot -
const provider = read("src/units/UnitSystemProvider.tsx");
assert.ok(
  /getCorosProfileSnapshot/.test(provider),
  "the unit comes from the COROS profile"
);
assert.ok(
  /onTrainingHubSessionChanged/.test(provider),
  "signing in is when the account first becomes askable, so the unit is re-read then"
);
assert.ok(
  !/setUnitSystem\s*[:,)]/.test(provider.replace(/setUnitSystem\]/g, "")),
  "the provider exposes no setter — there is nothing in the app that sets a unit"
);

// --- 5. It is derived, so it does not travel -------------------------------
// Every machine of one account resolves the same answer from the account
// itself. Publishing the cache would let a machine that has not refreshed yet
// write a stale unit over one that has.
const policy = read("electron/sync/syncPolicy.ts");
assert.match(
  policy,
  /"coroslink\.unitSystem":\s*"derived"/,
  "the cached unit is derived, not a preference that syncs"
);
assert.match(
  policy,
  /"coroslink\.temperatureUnit":\s*"derived"/,
  "and so is the cached temperature unit"
);

// --- 6. No screen keeps a unit of its own ---------------------------------
// Each of these printed a fixed unit next to a figure that had already been
// converted, so one metric read as two numbers on one screen.
//
// The patterns match rendered markup, not prose: an earlier version grepped for
// the bare label and tripped on the comment in TriggerForm explaining this very
// bug, which is a test failing on its own documentation.
for (const [file, pattern, why] of [
  ["src/running/RunSurfacePanel.tsx", />\s*Climb\/km\s*</, "the surface table's climb header"],
  ["src/running/RunList.tsx", /label: "Climb\/km"/, "the run list's climb header"],
  ["src/chat/analyses/TriggerForm.tsx", /<span>Minimum distance \(km\)<\/span>/, "the trigger's distance field"],
  ["src/running/RunDetailView.tsx", /temperatureC\)\}°C/, "the run detail's temperature"],
  ["src/training/components/ActivityDetailPane.tsx", /(?:temperatureC|feelsLikeC)\)\}°C/, "the detail pane's temperature"]
]) {
  assert.ok(!pattern.test(read(file)), `${why} must follow the account, not a fixed unit`);
}

// Both climb tables share one conversion: the ratio has a unit top and bottom,
// and converting only the top gives feet per kilometre, which is no system.
assert.match(
  read("src/running/runMetrics.ts"),
  /export function climbPerDistanceUnit/,
  "the climb ratio is converted in one place"
);
for (const file of ["src/running/RunList.tsx", "src/running/RunSurfacePanel.tsx"]) {
  assert.match(read(file), /climbPerDistanceUnit/, `${file} uses it`);
}

console.log("unit-source tests passed");
