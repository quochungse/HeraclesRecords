/**
 * How a plan on the calendar is going, as one figure on its row — the count
 * is `electron/planCompliance.ts`, which Coach reads too; this file puts it
 * into words.
 *
 * Renderer-side and pure, for the reason `activityFilters.ts` sits outside
 * `ActivitiesView`: it is the only part of this a test can reach.
 */
import type { PlanCompliance } from "../../electron/planCompliance";
import { plural, t } from "../i18n/core";

export { planCompliance, planScheduleKeys } from "../../electron/planCompliance";
export type { PlanCompliance } from "../../electron/planCompliance";

/**
 * `9/26` — sessions trained of the sessions the plan put on the calendar — or
 * nothing at all, never a zero standing in for "not yet asked".
 *
 * It was the ratio, `done / settled`, under the word "done": two weeks into
 * four with nothing missed, a plan read "100% done". The ratio answers "am I
 * keeping up", and the word asks "how far am I"; the count answers the word.
 * The total is `sessions`, not `planned`, which counts only the sessions the
 * matcher has looked at — the days the calendar has been read for.
 */
export function formatCompliance(compliance: PlanCompliance | undefined): string | null {
  const count = complianceCount(compliance);
  return count ? `${count.done}/${count.of}` : null;
}

/** The two halves of `formatCompliance`, for a tile that draws the total quieter. */
export function complianceCount(
  compliance: PlanCompliance | undefined
): { done: number; of: number } | null {
  if (compliance?.ratio === undefined) return null;
  return { done: compliance.done, of: compliance.sessions };
}

/** The sentence under the figure: what the percentage is made of. */
export function describeCompliance(compliance: PlanCompliance | undefined): string | null {
  if (!compliance) return null;
  if (compliance.ratio === undefined) {
    return plural("library.compliance.ahead", compliance.upcoming);
  }
  const parts = [t("library.compliance.done", { n: compliance.done })];
  if (compliance.missed) parts.push(t("library.compliance.missed", { n: compliance.missed }));
  if (compliance.skipped) parts.push(t("library.compliance.skipped", { n: compliance.skipped }));
  if (compliance.upcoming) parts.push(t("library.compliance.upcoming", { n: compliance.upcoming }));
  return parts.join(" · ");
}
