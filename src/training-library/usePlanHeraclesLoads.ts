/** Asks the main process for the estimates `planHeraclesLoads.ts` describes. */
import { useEffect, useMemo, useState } from "react";
import type { TrainingPlanDocument } from "../../electron/types";
import { useLoadSource } from "../training/loadSource";
import { strengthEntries, type PlanHeraclesLoads } from "./planHeraclesLoads";

const EMPTY: PlanHeraclesLoads = new Map();

export function usePlanHeraclesLoads(plans: readonly TrainingPlanDocument[]): PlanHeraclesLoads | undefined {
  const { source } = useLoadSource();
  const heracles = source === "heracles";
  const entries = useMemo(() => (heracles ? strengthEntries(plans) : []), [heracles, plans]);
  // The request follows what the sessions say, not the array holding them.
  const signature = useMemo(() => JSON.stringify(entries), [entries]);
  const [loads, setLoads] = useState<PlanHeraclesLoads>(EMPTY);

  useEffect(() => {
    const api = window.heraclesRecords;
    if (!heracles || !entries.length || !api) return;
    let current = true;
    api
      .estimatePlanLoads(entries)
      .then((answer) => {
        if (current) setLoads(new Map(Object.entries(answer)));
      })
      .catch(() => {
        // No estimate: the sessions keep COROS's planned figures.
      });
    return () => {
      current = false;
    };
    // `entries` changes only with `signature`.
  }, [heracles, signature]);

  // Until the first answer, and between an edit and its answer, the sessions
  // keep the last estimates: an edit in the editor must not flicker every load.
  return heracles ? loads : undefined;
}
