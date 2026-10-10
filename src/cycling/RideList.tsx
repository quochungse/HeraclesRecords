import type { MessageKey } from "../i18n/core";
import { useMemo, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatTrainingTableWhen
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatSpeedValue } from "../units/units";
import { positive, rideSeconds, speedKmh } from "./rideMetrics";
import { untitledRide, RIDE_TYPE_LABELS, classifyRideType, type RideType } from "./rideType";
import { t } from "../i18n/core";

interface RideListProps {
  rides: readonly TrainingHubActivity[];
  /**
   * Sort lives in the parent for the reason Running's does: this component
   * unmounts while a ride is open, and a choice that survives the trip out but
   * not the trip back is worse than no choice at all.
   */
  sort: RideSort;
  onSortChange: (sort: RideSort) => void;
  onOpenRide: (activity: TrainingHubActivity) => void;
}

export interface RideSort {
  key: RideSortKey;
  descending: boolean;
}

export type RideSortKey =
  | "when"
  | "distance"
  | "duration"
  | "speed"
  | "climb"
  | "avgHr"
  | "load";

interface RideRow {
  activity: TrainingHubActivity;
  type: RideType;
  when: number | undefined;
  distance: number | undefined;
  duration: number | undefined;
  speed: number | undefined;
  climb: number | undefined;
  avgHr: number | undefined;
  load: number | undefined;
}

interface ColumnDefinition {
  key: RideSortKey;
  label: string;
  numeric: boolean;
  title?: string;
}

/**
 * Climb is the ride's total, not metres per kilometre as on a run: a ride's
 * distance is long enough that the total is the figure riders quote — "a
 * 1,200 m day" — and the per-kilometre rate lives in the bikes table.
 *
 * The columns hidden on a narrow panel are the same positions Running hides
 * (running.css), which here are climb and load, then time.
 */
/** A column whose words are read in the language on screen each time. */
function column(
  key: RideSortKey,
  labelKey: MessageKey,
  numeric: boolean,
  titleKey?: MessageKey
): ColumnDefinition {
  return {
    key,
    get label() {
      return t(labelKey);
    },
    numeric,
    ...(titleKey
      ? {
          get title() {
            return t(titleKey);
          }
        }
      : {})
  };
}

const COLUMNS: readonly ColumnDefinition[] = [
  column("when", "run.list.when", false),
  column("distance", "activity.m.distance", true),
  column("duration", "activity.m.time", true),
  column("speed", "activity.m.speed", true, "ride.list.speedTitle"),
  column("climb", "activity.m.climb", true, "ride.list.climbTitle"),
  column("avgHr", "activity.m.avgHr", true),
  column("load", "overview.tiles.load", true, "ride.list.loadTitle")
];

/** Which way a column wants to sort the first time it is pressed. */
const FIRST_DIRECTION: Record<RideSortKey, "asc" | "desc"> = {
  when: "desc",
  distance: "desc",
  duration: "desc",
  // Faster is a bigger number on a bike, so speed opens descending — the
  // opposite of a run's pace column.
  speed: "desc",
  climb: "desc",
  avgHr: "desc",
  load: "desc"
};

function buildRow(activity: TrainingHubActivity): RideRow | null {
  const type = classifyRideType(activity.sportType);
  if (type === null) {
    return null;
  }

  return {
    activity,
    type,
    when: activity.startTime,
    distance: positive(activity.distance),
    duration: rideSeconds(activity),
    speed: speedKmh(activity),
    climb: positive(activity.elevationGain),
    avgHr: positive(activity.avgHr),
    load: positive(activity.trainingLoad)
  };
}

/** Every gap at the bottom, whichever way the column runs — see RunList. */
function compareRows(
  left: RideRow,
  right: RideRow,
  key: RideSortKey,
  descending: boolean
): number {
  const a = left[key];
  const b = right[key];

  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }

  return descending ? b - a : a - b;
}

export const DEFAULT_RIDE_SORT: RideSort = { key: "when", descending: true };

export function RideList({ rides, sort, onSortChange, onOpenRide }: RideListProps) {
  const { unitSystem } = useUnitSystem();
  const { key: sortKey, descending } = sort;

  const rows = useMemo(() => {
    const built = rides
      .map((activity) => buildRow(activity))
      .filter((row): row is RideRow => row !== null);
    return built.sort((left, right) => compareRows(left, right, sortKey, descending));
  }, [descending, rides, sortKey]);

  const toggleSort = (key: RideSortKey) => {
    onSortChange(
      key === sortKey
        ? { key, descending: !descending }
        : { key, descending: FIRST_DIRECTION[key] === "desc" }
    );
  };

  const openOnKey = (event: KeyboardEvent<HTMLTableRowElement>, activity: TrainingHubActivity) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenRide(activity);
    }
  };

  return (
    <table className="run-list">
      <thead>
        <tr>
          {COLUMNS.map((column) => {
            const active = column.key === sortKey;
            return (
              <th
                key={column.key}
                scope="col"
                className={[
                  column.numeric ? "is-numeric" : undefined,
                  active ? "is-sorted" : undefined
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  title={column.title ?? t("run.list.sortBy", { column: column.label })}
                >
                  <span>{column.label}</span>
                  {active ? (
                    descending ? (
                      <ArrowDown size={12} aria-hidden="true" />
                    ) : (
                      <ArrowUp size={12} aria-hidden="true" />
                    )
                  ) : null}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.activity.activityId}
            tabIndex={0}
            onClick={() => onOpenRide(row.activity)}
            onKeyDown={(event) => openOnKey(event, row.activity)}
          >
            <td>
              <div className="run-list-when">
                <span className={`run-surface-chip ride-type-${row.type}`}>
                  {RIDE_TYPE_LABELS[row.type]}
                </span>
                <div>
                  <strong>
                    {row.activity.name?.trim() || untitledRide(row.type)}
                  </strong>
                  <span>{formatTrainingTableWhen(row.when)}</span>
                </div>
              </div>
            </td>
            <td className="is-numeric">
              {row.distance === undefined ? "—" : formatDistanceMeters(row.distance, unitSystem)}
            </td>
            <td className="is-numeric">{formatDurationSeconds(row.duration)}</td>
            <td className="is-numeric">
              {row.speed === undefined ? "—" : formatSpeedValue(row.speed, unitSystem)}
            </td>
            <td className="is-numeric">
              {row.climb === undefined ? "—" : formatElevationMeters(row.climb, unitSystem)}
            </td>
            <td className="is-numeric">{row.avgHr === undefined ? "—" : `${row.avgHr}`}</td>
            <td className="is-numeric">
              {row.load === undefined ? "—" : Math.round(row.load)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
