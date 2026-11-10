import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { TrainingHubActivityLap } from "../../electron/types";
import {
  createActivityLink,
  lapSpans,
  type ActivityLink,
  type ActivityLinkState
} from "./activityLink";

/**
 * The link a session's page hands to its chart, its route map and its lap
 * table. One per page; `sessionKey` changing — another session opened in the
 * same pane — lets go of the cursor and the selection.
 */
export function useActivityLink(
  laps: readonly TrainingHubActivityLap[],
  sessionKey?: string | number
): ActivityLink {
  const [link] = useState(createActivityLink);
  const spans = useMemo(() => lapSpans(laps), [laps]);
  // Set while rendering: a child reads the laps in its first render.
  link.setLaps(spans);
  useEffect(() => link.reset, [link, sessionKey]);
  return link;
}

/**
 * One reading of the link. `select` returns a primitive, or an object the link
 * itself holds (`selection`, `preview`), so a move of the cursor redraws only
 * what reads the cursor.
 */
export function useLinkValue<T>(link: ActivityLink, select: (state: ActivityLinkState) => T): T {
  return useSyncExternalStore(link.subscribe, () => select(link.getState()));
}
