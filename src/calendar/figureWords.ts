import type { FigureMark } from "../../electron/workoutFigures";
import { t } from "../i18n/core";

/**
 * A marked figure in words, for its title and a screen reader: "≈" reads as
 * "almost equal to" and "+" as "plus", neither of which is what they say here.
 */
export function figureWords(text: string, mark: FigureMark): string | undefined {
  if (mark === "estimated") return t("workout.figure.about", { value: text });
  if (mark === "atLeast") return t("workout.figure.atLeast", { value: text });
  return undefined;
}
