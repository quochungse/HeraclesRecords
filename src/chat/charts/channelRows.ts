import {
  distanceUnit,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  metersToSwimDistance,
  swimDistanceUnit
} from "../../units/units";
import { formatDecimal } from "../../i18n/core";
import { readsSpeed, swimPacePer100, type ActivityReading } from "../../../electron/activityReading";
import type {
  TrainingHubActivitySeriesPoint,
  TrainingHubTrackPoint,
  UnitSystem
} from "../../../electron/types";

/** Activity time as `m:ss` or `h:mm:ss`, for a chart with no distance to run along. */
function formatElapsedLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** The channels a card can lay over one another: one recording, one clock. */
export type CardChannel = "pace" | "speed" | "hr" | "cadence" | "power" | "altitude";

export interface ChannelRow {
  x: number;
  label: string;
  pace?: number;
  speed?: number;
  hr?: number;
  cadence?: number;
  power?: number;
  altitude?: number;
}

export interface ChatChannelSeries {
  hr?: TrainingHubActivitySeriesPoint[];
  pace?: TrainingHubActivitySeriesPoint[];
  power?: TrainingHubActivitySeriesPoint[];
  cadence?: TrainingHubActivitySeriesPoint[];
  elevation?: TrainingHubTrackPoint[];
}

type Axis = "distance" | "elapsed" | "index";

/**
 * The card's sample channels joined into one row per sample. Every channel was
 * cut from the same downsampled recording and placed by the same distance (or
 * the activity time, where none was covered), so a shared position is the same
 * sample. Elevation comes from the track instead, and is read onto those rows
 * by distance — so only a chart that runs along a distance can carry it.
 *
 * A card stored before its samples carried a clock has neither, and only their
 * order to go by. Each channel kept only the samples it had a value for, so an
 * index in one is not the same sample in another: each is placed by how far
 * through its own points it is, which is the same place for channels with no
 * gaps and close to it for one with a few.
 */
export function joinChannelRows(
  series: ChatChannelSeries,
  reading: ActivityReading,
  unitSystem: UnitSystem
): { rows: ChannelRow[]; joinsElevation: boolean } {
  const swim = reading === "swim";
  const asSpeed = readsSpeed(reading);
  const sources: [CardChannel, keyof TrainingHubActivitySeriesPoint, TrainingHubActivitySeriesPoint[] | undefined][] = [
    ["hr", "hr", series.hr],
    [asSpeed ? "speed" : "pace", "pace", series.pace],
    ["power", "power", series.power],
    ["cadence", "cadence", series.cadence]
  ];
  const all = sources.flatMap(([, , points]) => points ?? []);
  const axis: Axis = all.some((point) => (point.distance ?? 0) > 0)
    ? "distance"
    : all.some((point) => point.elapsed !== undefined)
      ? "elapsed"
      : "index";

  const byX = new Map<number, ChannelRow>();
  for (const [key, field, points] of sources) {
    const last = Math.max(1, (points?.length ?? 0) - 1);
    (points ?? []).forEach((point, index) => {
      const raw = point[field];
      if (typeof raw !== "number" || !Number.isFinite(raw)) return;
      const x = axis === "distance" ? point.distance : axis === "elapsed" ? point.elapsed : index / last;
      if (x === undefined) return;
      const value =
        key === "speed"
          ? kmhToDisplaySpeed(3600 / raw, unitSystem)
          : key === "pace" && swim
            ? swimPacePer100(raw, unitSystem)
            : raw;
      const row = byX.get(x) ?? { x, label: "" };
      row[key] = value;
      byX.set(x, row);
    });
  }
  const rows = [...byX.values()].sort((a, b) => a.x - b.x);
  for (const row of rows) {
    row.label =
      axis === "distance"
        ? `${formatDecimal(
            swim ? metersToSwimDistance(row.x, unitSystem) : metersToDisplayDistance(row.x, unitSystem),
            swim ? 0 : 1
          )} ${swim ? swimDistanceUnit(unitSystem) : distanceUnit(unitSystem)}`
        : axis === "elapsed"
          ? formatElapsedLabel(row.x)
          : "";
  }

  const profile = (series.elevation ?? [])
    .filter(
      (point): point is TrainingHubTrackPoint & { distance: number; elevation: number } =>
        point.distance !== undefined &&
        point.elevation !== undefined &&
        Number.isFinite(point.elevation)
    )
    .sort((a, b) => a.distance - b.distance);
  const joinsElevation = axis === "distance" && !swim && profile.length >= 2 && rows.length >= 2;
  if (joinsElevation) {
    let at = 0;
    for (const row of rows) {
      while (at < profile.length - 2 && profile[at + 1]!.distance < row.x) at += 1;
      const from = profile[at]!;
      const to = profile[at + 1]!;
      const span = to.distance - from.distance;
      const share = span > 0 ? Math.min(1, Math.max(0, (row.x - from.distance) / span)) : 0;
      row.altitude = metersToElevation(from.elevation + (to.elevation - from.elevation) * share, unitSystem);
    }
  }
  return { rows, joinsElevation };
}

