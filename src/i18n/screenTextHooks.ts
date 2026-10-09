/**
 * Puts the shared modules' sentences on screen in the language on screen.
 *
 * `electron/screenText.ts` answers in English until a translator is installed,
 * and only this file installs one — so a plan's checks, an outline's problems
 * and a version's changes read in the athlete's language here, and in English
 * in the main process, where they are handed to the model. Imported once, by
 * `main.tsx`; a suite that does not import it gets the English the model gets.
 */
import { setScreenTranslator } from "../../electron/screenText";
import { COROS_WEEK_STAGES } from "../../electron/trainingPlanDomain";
import type { WorkoutSport } from "../../electron/types";
import { plural, t, weekdayNames, type MessageKey, type PluralKey } from "./core";
import { planStageLabel } from "./workoutWords";
import { workoutSportLabel } from "../training/workoutSport";

setScreenTranslator({
  text: (key, vars, count) =>
    count === undefined ? t(key as MessageKey, vars) : plural(key as PluralKey, count, vars),
  weekday: (index, style) => weekdayNames(style)[index] ?? "",
  sport: (sport) => workoutSportLabel(sport as WorkoutSport),
  stage: (value) => planStageLabel(COROS_WEEK_STAGES.find((stage) => stage.value === value)?.slug ?? "none")
});
