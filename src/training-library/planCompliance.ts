/**
 * How a plan on the calendar is going, as one figure on its row — the count
 * is `electron/planCompliance.ts`, which Coach reads too; this file puts it
 * into words.
 *
 * Renderer-side and pure, for the reason `activityFilters.ts` sits outside
 * `ActivitiesView`: it is the only part of this a test can reach.
 */
import type { PlanCompliance } from "../../electron/planCompliance";

export { planCompliance, planScheduleKeys } from "../../electron/planCompliance";
export type { PlanCompliance } from "../../electron/planCompliance";

/** `86%`, or nothing at all — never a zero standing in for "not yet asked". */
export function formatCompliance(compliance: PlanCompliance | undefined): string | null {
  if (compliance?.ratio === undefined) return null;
  return `${Math.round(compliance.ratio * 100)}%`;
}

/** The sentence under the figure: what the percentage is made of. */
export function describeCompliance(compliance: PlanCompliance | undefined): string | null {
  if (!compliance) return null;
  if (compliance.ratio === undefined) {
    return compliance.upcoming === 1
      ? "1 session ahead"
      : `${compliance.upcoming} sessions ahead`;
  }
  const parts = [`${compliance.done} done`];
  if (compliance.missed) parts.push(`${compliance.missed} missed`);
  if (compliance.skipped) parts.push(`${compliance.skipped} skipped`);
  if (compliance.upcoming) parts.push(`${compliance.upcoming} ahead`);
  return parts.join(" · ");
}
