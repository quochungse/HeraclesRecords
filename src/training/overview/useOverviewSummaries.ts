import { useEffect, useState } from "react";
import type {
  ActivityDetailSummary,
  TrainingHubActivity,
} from "../../../electron/types";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";

const EMPTY_SUMMARIES: ReadonlyMap<string, ActivityDetailSummary> = new Map();

/** Read cached splits only; Overview must not initiate a detail backfill. */
export function useOverviewSummaries(
  api: HeraclesRecordsApi,
  activities: readonly TrainingHubActivity[],
) {
  const ids = JSON.stringify(
    [...new Set(activities.map((a) => a.activityId))].sort(),
  );
  const [answer, setAnswer] = useState<{
    api: HeraclesRecordsApi;
    ids: string;
    summaries: ReadonlyMap<string, ActivityDetailSummary>;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const activityIds: string[] = JSON.parse(ids);
    if (!activityIds.length) {
      setAnswer(null);
      return;
    }
    void api
      .getActivityDetailSummaries(activityIds)
      .then((rows) => {
        if (active) {
          setAnswer({
            api,
            ids,
            summaries: new Map(rows.map((row) => [row.activityId, row])),
          });
        }
      })
      .catch(() => {
        if (active) setAnswer({ api, ids, summaries: EMPTY_SUMMARIES });
      });
    return () => {
      active = false;
    };
  }, [api, ids]);
  // Never expose the preceding window's answer while its replacement is pending.
  const current = answer?.api === api && answer.ids === ids;
  return {
    summaries: current ? answer.summaries : EMPTY_SUMMARIES,
    loading: ids !== "[]" && !current,
  };
}
