import { Check } from "lucide-react";
import type { UnitSystem } from "../../electron/types";
import type { PlannedActualPair } from "./calendarTypes";
import { formatDistanceMeters, formatDurationSpan } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { t } from "../i18n/core";

/**
 * How much of its plan a done session covered, as its panel says it, with
 * what the figure was read from for the hover: COROS's own completion, or
 * the session against the plan in the plan's own terms (`completion` in
 * `pairing.ts`).
 */
export function completionLine(
  pair: PlannedActualPair,
  unitSystem: UnitSystem
): { text: string; note: string } | undefined {
  const basis = pair.completionBasis;
  if (pair.completionPct === undefined || !basis) return undefined;
  const text = t("calendar.chip.completion", { percent: pair.completionPct });
  if (basis.kind === "coros") return { text, note: t("calendar.plan.byCoros") };
  const figure = (value: number) =>
    basis.kind === "distance"
      ? formatDistanceMeters(value, unitSystem)
      : basis.kind === "time"
        ? formatDurationSpan(value)
        : t("units.trainingLoadShort", { value: Math.round(value) });
  return { text, note: t("calendar.plan.ofPlanned", { done: figure(basis.done), planned: figure(basis.planned) }) };
}

/**
 * The plan a done session answered, at the head of its panel: which plan,
 * and how much of it was done. The Calendar's card says neither.
 */
export function PlanCompletionBlock({ pair }: { pair: PlannedActualPair }) {
  const { unitSystem } = useUnitSystem();
  const line = completionLine(pair, unitSystem);
  return (
    <section className="calendar-plan-status" aria-label={t("calendar.match.label")}>
      <header>
        <span className="calendar-plan-status-icon" aria-hidden="true">
          <Check size={14} />
        </span>
        <span>
          <strong>{t("calendar.plan.answers", { name: pair.scheduled.name })}</strong>
          {line ? <small title={line.note}>{line.text}</small> : null}
        </span>
      </header>
    </section>
  );
}
