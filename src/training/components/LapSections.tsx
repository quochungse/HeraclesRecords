import type { ActivityLapSection } from "../../../electron/types";
import { t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";

/*
 * A structured workout's parts over its laps (`lapSections`), as every lap
 * table draws them: a heading row where a part begins, and a recovery between
 * repeats marked where its number is. One component, so the Coach's card and
 * the run, ride, hike and activity pages say the same thing the same way.
 */

/** The part's name, as the workout builder names the step kind. */
export function lapSectionLabel(section: ActivityLapSection): string {
  switch (section) {
    case "warmup":
      return t("workout.step.warmup");
    case "cooldown":
      return t("workout.step.cooldown");
    case "after":
      return t("activity.lap.afterWorkout");
    default:
      return t("workout.step.training");
  }
}

/** The heading row before the lap at `index`, when a part begins there. */
export function LapSectionRow({
  sections,
  index,
  colSpan
}: {
  sections: readonly (ActivityLapSection | undefined)[];
  index: number;
  colSpan: number;
}) {
  useI18n();
  const section = sections[index];
  if (!section || section === sections[index - 1]) return null;
  return (
    <tr className="lap-section-row">
      <th scope="rowgroup" colSpan={colSpan}>
        {lapSectionLabel(section)}
      </th>
    </tr>
  );
}

/** Beside a recovery lap's number. */
export function LapRecoveryMark() {
  useI18n();
  return <span className="lap-step-mark">{t("workout.step.rest")}</span>;
}
