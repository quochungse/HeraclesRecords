import { createContext, useContext, useMemo, type ReactNode } from "react";
import { labourShort, labourStage } from "../records/labourWords";
import type { RecordsResult } from "../records/milestones";
import { placeLabelFor } from "../trainingMap/placeSummaries";
import { knownPlaceLabels } from "../trainingMap/placeLabels";
import type { ShareLabour } from "./shareTypes";

/**
 * What the Hall of Records knows about one session, for its share image: the
 * record it set, the Labour stage it reached, and the place it started from.
 * The hall is worked out in App, so the sport screens read it through here
 * rather than having it threaded through every page.
 */
export interface ShareFacts {
  record?: string;
  labour?: ShareLabour;
  place?: string;
}

type ShareFactsLookup = (activityId: string | undefined) => ShareFacts;

const NO_FACTS: ShareFactsLookup = () => ({});
const ShareFactsContext = createContext<ShareFactsLookup>(NO_FACTS);

function shareFactsLookup(result: RecordsResult): ShareFactsLookup {
  const records = new Map<string, string>();
  const labours = new Map<string, ShareLabour>();
  for (const milestone of result.milestones) {
    const id = milestone.activity?.activityId;
    if (!id) continue;
    if (milestone.category === "record" && !records.has(id)) {
      records.set(id, milestone.title);
    }
    const labour = milestone.labour;
    if (labour && (labours.get(id)?.stage ?? 0) < labour.stage) {
      labours.set(id, {
        id: labour.id,
        stage: labour.stage,
        name: labourShort(labour.id),
        goal: labourStage(labour.id, labour.stage)
      });
    }
  }
  const clusters = new Map<string, (typeof result.places)[number]>();
  for (const cluster of result.places) {
    for (const id of cluster.activityIds) clusters.set(id, cluster);
  }
  return (activityId) => {
    if (!activityId) return {};
    const cluster = clusters.get(activityId);
    return {
      record: records.get(activityId),
      labour: labours.get(activityId),
      place: cluster ? placeLabelFor(cluster, knownPlaceLabels()).full : undefined
    };
  };
}

export function ShareFactsProvider({ result, children }: { result: RecordsResult; children: ReactNode }) {
  const lookup = useMemo(() => shareFactsLookup(result), [result]);
  return <ShareFactsContext.Provider value={lookup}>{children}</ShareFactsContext.Provider>;
}

export function useShareFacts(): ShareFactsLookup {
  return useContext(ShareFactsContext);
}
