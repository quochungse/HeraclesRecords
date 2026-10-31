import type { Translation } from "../../types.ts";

/** Figures every screen writes: durations, counts and the words that go with them. */
const units = {
  "units.duration.hm": "{h}h {m}m",
  "units.duration.h": "{h}h",
  "units.duration.m": "{m}m",
  "units.duration.s": "{s}s",
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
  "units.load.pair": "Heracles TL {heracles} · COROS TL {coros}",
  "units.load.estimate": "Estimated: the sets could not be read",
  "units.load.pending": "Not calculated yet: the session's sets are still loading",
  "units.load.planned": "Estimated from the plan's sets",
  "units.load.plannedFromLength": "Estimated from the plan's length: it states no sets",
  "units.load.pairFigure": "Heracles {heracles} · COROS {coros}",
  "units.load.rangePair": "Recommended range: Heracles {heracles} · COROS {coros}",
  "units.load.fitnessPartial": "Approximate: some strength sessions' sets are still loading",
};

export default units;
export type UnitsMessages = Translation<typeof units>;
