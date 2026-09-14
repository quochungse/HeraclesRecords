import { useMemo, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatPaceSecondsPerKm,
  formatTrainingTableWhen
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  efficiencyIndex,
  elevationPerKm,
  paceSecondsPerKm,
  runSeconds
} from "./runMetrics";
import {
  RUN_SURFACE_LABELS,
  classifyRunSurface,
  type RunSurface
} from "./runSurface";
import { elevationUnit, metersToElevation } from "../units/units";

interface RunListProps {
  runs: readonly TrainingHubActivity[];
  /**
   * Sort lives in the parent for the same reason the scroll position does: this
   * component unmounts while a run is open, and a choice that survives the trip
   * out but not the trip back is worse than no choice at all.
   */
  sort: RunSort;
  onSortChange: (sort: RunSort) => void;
  onOpenRun: (activity: TrainingHubActivity) => void;
}

export interface RunSort {
  key: SortKey;
  descending: boolean;
}

export type SortKey =
  | "when"
  | "distance"
  | "duration"
  | "pace"
  | "elevationPerKm"
  | "avgHr"
  | "efficiency";

interface RunRow {
  activity: TrainingHubActivity;
  surface: RunSurface;
  when: number | undefined;
  distance: number | undefined;
  duration: number | undefined;
  pace: number | undefined;
  elevationPerKm: number | undefined;
  avgHr: number | undefined;
  efficiency: number | undefined;
}

interface ColumnDefinition {
  key: SortKey;
  label: string;
  /** Numbers read right-aligned; the date and name do not. */
  numeric: boolean;
  title?: string;
}

const COLUMNS: readonly ColumnDefinition[] = [
  { key: "when", label: "When", numeric: false },
  { key: "distance", label: "Distance", numeric: true },
  { key: "duration", label: "Time", numeric: true },
  { key: "pace", label: "Pace", numeric: true },
  {
    key: "elevationPerKm",
    label: "Climb/km",
    numeric: true,
    title: "Metres climbed per kilometre"
  },
  { key: "avgHr", label: "Avg HR", numeric: true },
  {
    key: "efficiency",
    label: "EF",
    numeric: true,
    title:
      "Efficiency index — metres per minute per heartbeat. Higher is more ground for the same effort."
  }
];

/** Which way a column wants to sort the first time it is pressed. */
const FIRST_DIRECTION: Record<SortKey, "asc" | "desc"> = {
  when: "desc",
  distance: "desc",
  duration: "desc",
  // A faster run is a *smaller* number of seconds, so pace opens ascending or
  // the first press buries the best run at the bottom.
  pace: "asc",
  elevationPerKm: "desc",
  avgHr: "desc",
  efficiency: "desc"
};

function buildRow(activity: TrainingHubActivity): RunRow | null {
  const surface = classifyRunSurface(activity.sportType);
  if (surface === null) {
    return null;
  }

  return {
    activity,
    surface,
    when: activity.startTime,
    distance: activity.distance,
    duration: runSeconds(activity),
    pace: paceSecondsPerKm(activity),
    elevationPerKm: elevationPerKm(activity),
    avgHr: activity.avgHr,
    efficiency: efficiencyIndex(activity)
  };
}

/**
 * Sort with every gap at the bottom, whichever way the column runs.
 *
 * A run with no heart rate is not the slowest run of the block and must not
 * lead the table when the athlete asks for the hardest ones; treating it as 0
 * or Infinity does exactly that.
 */
function compareRows(left: RunRow, right: RunRow, key: SortKey, descending: boolean): number {
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

export const DEFAULT_RUN_SORT: RunSort = { key: "when", descending: true };

export function RunList({ runs, sort, onSortChange, onOpenRun }: RunListProps) {
  const { unitSystem } = useUnitSystem();
  const { key: sortKey, descending } = sort;

  const rows = useMemo(() => {
    const built = runs
      .map(buildRow)
      .filter((row): row is RunRow => row !== null);
    return built.sort((left, right) => compareRows(left, right, sortKey, descending));
  }, [descending, runs, sortKey]);

  const toggleSort = (key: SortKey) => {
    onSortChange(
      key === sortKey
        ? { key, descending: !descending }
        : { key, descending: FIRST_DIRECTION[key] === "desc" }
    );
  };

  const openOnKey = (event: KeyboardEvent<HTMLTableRowElement>, activity: TrainingHubActivity) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenRun(activity);
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
                  title={column.title ?? `Sort by ${column.label.toLowerCase()}`}
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
            onClick={() => onOpenRun(row.activity)}
            onKeyDown={(event) => openOnKey(event, row.activity)}
          >
            <td>
              <div className="run-list-when">
                <span className={`run-surface-chip run-surface-${row.surface}`}>
                  {RUN_SURFACE_LABELS[row.surface]}
                </span>
                <div>
                  <strong>{row.activity.name?.trim() || RUN_SURFACE_LABELS[row.surface]}</strong>
                  <span>{formatTrainingTableWhen(row.when)}</span>
                </div>
              </div>
            </td>
            <td className="is-numeric">{formatDistanceMeters(row.distance, unitSystem)}</td>
            <td className="is-numeric">{formatDurationSeconds(row.duration)}</td>
            <td className="is-numeric">{formatPaceSecondsPerKm(row.pace, unitSystem)}</td>
            <td className="is-numeric">
              {row.elevationPerKm === undefined
                ? "—"
                : `${Math.round(metersToElevation(row.elevationPerKm, unitSystem))} ${elevationUnit(unitSystem)}`}
            </td>
            <td className="is-numeric">
              {row.avgHr === undefined ? "—" : `${row.avgHr}`}
            </td>
            <td className="is-numeric">
              {/* Two decimals, not one: efficiency moves in hundredths, so a
                  single decimal rounds a block's whole progress into three
                  values and the column stops saying anything. */}
              {row.efficiency === undefined ? "—" : row.efficiency.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
