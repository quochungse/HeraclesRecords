import { useMemo } from "react";
import { withPausesRemoved } from "../../electron/activityMetrics";
import type { CorosProfileZoneFamily, TrainingHubActivityDetail } from "../../electron/types";
import { useActivityLink } from "./useActivityLink";
import { heartRateZoneFamily } from "./zoneTime";

/**
 * What a session's Performance chart, its route map and its lap table are
 * handed, worked out in one place so no screen can leave a part out: the
 * samples on activity time, the link the three share, and the pauses the link's
 * clock leaves out, which the route — stamped by the wall clock — still counts.
 * A screen that put its series on activity time and forgot the pauses lit an
 * earlier stretch of road for every lap after one.
 *
 * `chart` is spread onto `ActivitySeriesChart` and `map` onto an
 * `ActivityRouteMap` the screen draws itself; a sport's page, whose chart docks
 * the map, adds `page`. `sessionKey` is the session the screen has open when
 * that is known before its detail is (the Activities pane's selection).
 */
export function useSessionChart(
  detail: TrainingHubActivityDetail | null | undefined,
  accountZoneFamily?: CorosProfileZoneFamily,
  sessionKey: string | number | undefined = detail?.activityId
) {
  const laps = useMemo(() => detail?.laps ?? [], [detail]);
  // On activity time, which is what the laps, the headline and every figure
  // read off the chart are stated in. See `withPausesRemoved`.
  const series = useMemo(() => withPausesRemoved(detail?.series ?? [], detail?.pauses), [detail]);
  const link = useActivityLink(laps, sessionKey);
  const pauses = detail?.pauses;
  return {
    laps,
    series,
    link,
    chart: { series, laps, hrZones: detail?.hrZones ?? [], link, pauses },
    map: { link, pauses },
    page: {
      track: detail?.track,
      routeDetail: detail ?? undefined,
      zoneFamily: heartRateZoneFamily(detail?.hrZoneType, accountZoneFamily)
    }
  };
}
