import type { Translation } from "../../types.ts";

/** Figures every screen writes: durations, counts and the words that go with them. */
const units = {
  "units.duration.hm": "{h}h {m}m",
  "units.duration.h": "{h}h",
  "units.duration.m": "{m}m",
  "units.min": "{m} min",
  "units.unknown": "Unknown",
  "units.today": "Today",
  "units.notRecorded": "Not recorded",
  "units.workouts_one": "{count} workout",
  "units.workouts_other": "{count} workouts",
  "units.trainingLoadShort": "{value} TL",
  "units.category.run": "Run",
  "units.category.race": "Race",
  "units.category.long": "Long",
  "units.category.easy": "Easy",
  "units.category.intervals": "Intervals",
  "units.category.speed": "Speed",
  "units.weekly.unattributed": "Unattributed",
  "units.weekly.distanceUnit": "Distance ({unit})",
  "units.exercises_one": "{count} exercise",
  "units.exercises_other": "{count} exercises",
};

export default units;
export type UnitsMessages = Translation<typeof units>;
