import type { TrainingPlanDocument } from "../../electron/types";
import { formatPlanDay, mondayOf, parsePlanDay } from "../../electron/trainingPlanDomain";

/**
 * A plan whose every session is dated, read as starting on the Monday of its
 * first date, so a drawing names the days it will fall on. The date is only
 * for the drawing: a plan has no start date of its own.
 */
export function datedForReading(document: TrainingPlanDocument): TrainingPlanDocument {
  const dated = document.entries
    .map((entry) => parsePlanDay(entry.workout.schedule_date))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.valueOf() - right.valueOf());
  return dated.length === document.entries.length && dated[0]
    ? { ...document, startDate: formatPlanDay(mondayOf(dated[0]), true) }
    : document;
}
