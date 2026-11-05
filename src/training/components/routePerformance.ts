import type { TrainingHubActivityDetail } from "../../../electron/types";
import { t } from "../../i18n/core";
import type { RouteReplay } from "./routeReplay";
import {
  elevationColor,
  elevationColoring,
  performanceColoring,
  performanceZones,
  routeRamp,
  stretchValues,
  zoneColor,
  zoneColoring,
  type RouteColoring,
  type RouteMetric,
  type RouteZoneColoring
} from "./routeColoring";

/** What a route is coloured by: the samples, COROS's zones and the sport. */
export type RouteDetail = Partial<
  Pick<
    TrainingHubActivityDetail,
    "series" | "hrZones" | "paceZones" | "sportType" | "sportName"
  >
>;

/**
 * What Performance shows for one metric: pace and heart rate by the activity's
 * own zones where COROS scored it against some, else a ramp from its slowest
 * stretch to its fastest; elevation by fixed heights. Or why it shows nothing
 * — `recorded` when the metric was recorded but cannot be placed on the route.
 */
export type PerformanceView =
  | { kind: "zones"; coloring: RouteZoneColoring }
  | { kind: "ramp"; coloring: RouteColoring }
  | { kind: "elevation"; heights: (number | null)[] }
  | { kind: "none"; reason: string; recorded: boolean };

export type ShownView = Exclude<PerformanceView, { kind: "none" }>;

/** Heights are coloured to the nearest 5 m, so a flat road is one line, not hundreds. */
const ELEVATION_COLOR_STEP_M = 5;

/** The metric's own key for a sentence about it: "pace", "speed", "hr" or "elevation". */
function metricKey(metric: RouteMetric, speed: boolean): "pace" | "speed" | "hr" | "elevation" {
  return metric === "pace" ? (speed ? "speed" : "pace") : metric;
}

/**
 * What Performance can show for each metric on this route. `speed` is a ride
 * or a hike, whose pace is read out as speed and has no pace zones.
 */
export function routePerformance(
  route: RouteReplay,
  detail: RouteDetail | undefined,
  speed: boolean
): Record<RouteMetric, PerformanceView> {
  const series = detail?.series ?? [];
  const timed = (metric: "pace" | "hr"): PerformanceView => {
    const key = metricKey(metric, speed);
    const stretches = stretchValues(route, series, metric);
    if ("missing" in stretches) {
      return stretches.missing === "unrecorded"
        ? { kind: "none", reason: t(`activity.route.none.${key}` as const), recorded: false }
        : {
            kind: "none",
            reason: t(`activity.route.untimed.${key}` as const),
            recorded: true
          };
    }
    const zones = zoneColoring(
      stretches.values,
      metric,
      performanceZones(metric, detail, speed)
    );
    return zones
      ? { kind: "zones", coloring: zones }
      : { kind: "ramp", coloring: performanceColoring(stretches.values, metric) };
  };
  const heights = elevationColoring(route);
  return {
    pace: timed("pace"),
    hr: timed("hr"),
    elevation: heights
      ? { kind: "elevation", heights }
      : { kind: "none", reason: t("activity.route.none.elevation"), recorded: false }
  };
}

/** The colour of each stretch of a shown view on its ground; null where nothing was recorded. */
export function performanceStretchColors(
  view: ShownView,
  lightGround: boolean
): (string | null)[] {
  if (view.kind === "elevation") {
    return view.heights.map((meters) =>
      meters === null
        ? null
        : elevationColor(
            Math.round(meters / ELEVATION_COLOR_STEP_M) * ELEVATION_COLOR_STEP_M,
            lightGround
          )
    );
  }
  const ramp = routeRamp(lightGround);
  const colorOf = view.kind === "zones" ? zoneColor : (step: number) => ramp[step]!;
  return view.coloring.steps.map((step) => (step === null ? null : colorOf(step)));
}
