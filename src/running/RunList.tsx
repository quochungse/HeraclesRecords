import { useMemo, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type {
  ActivityDetailSummary,
  TrainingHubActivity
} from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatPaceSecondsPerKm,
  formatTrainingTableWhen
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  ascentPerHour,
  efficiencyIndex,
  climbPerDistanceUnit,
  elevationPerKm,
  paceSecondsPerKm,
  runSeconds
} from "./runMetrics";
import {
  RUN_SURFACE_LABELS,
  classifyRunSurface,
  type RunSurface
} from "./runSurface";
import {
  distanceUnit,
  elevationUnit,
  metersToElevation,
  type UnitSystem
} from "../units/units";

interface RunListProps {
  runs: readonly TrainingHubActivity[];
  /**
   * Per-run figures out of the detail payload, by activity id. Arrive after the
   * list does and fill in as they are computed, so the column reads "—" rather
   * than holding the table back.
   */
  summaries?: ReadonlyMap<string, ActivityDetailSummary>;
  /**
   * Sort lives in the parent for the same reason the scroll position does: this
   * component unmounts while a run is open, and a choice that survives the trip
   * out but not the trip back is worse than no choice at all.
   */
  sort: RunSort;
  onSortChange: (sort: RunSort) => void;
  onOpenRun: (activity: TrainingHubActivity) => void;
  /** Under the Trail filter: the columns a trail run is read by. */
  trail?: boolean;
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
  | "elevationGain"
  | "elevationPerKm"
  | "ascentRate"
  | "avgHr"
  | "efficiency"
  | "drift";

interface RunRow {
  activity: TrainingHubActivity;
  surface: RunSurface;
  when: number | undefined;
  distance: number | undefined;
  duration: number | undefined;
  pace: number | undefined;
  elevationGain: number | undefined;
  elevationPerKm: number | undefined;
  ascentRate: number | undefined;
  avgHr: number | undefined;
  efficiency: number | undefined;
  drift: number | undefined;
}

interface ColumnDefinition {
  key: SortKey;
  label: string;
  /** Numbers read right-aligned; the date and name do not. */
  numeric: boolean;
  title?: string;
}

/** The one column whose name carries a unit. */
function columnLabel(column: ColumnDefinition, unitSystem: UnitSystem): string {
  return column.key === "elevationPerKm"
    ? `${column.label}/${distanceUnit(unitSystem)}`
    : column.label;
}

function columnTitle(column: ColumnDefinition, unitSystem: UnitSystem): string {
  if (column.key === "elevationPerKm") {
    return unitSystem === "imperial"
      ? "Feet climbed per mile"
      : "Metres climbed per kilometre";
  }
  if (column.key === "ascentRate") {
    return `${unitSystem === "imperial" ? "Feet" : "Metres"} climbed an hour, over the whole run`;
  }
  return column.title ?? `Sort by ${column.label.toLowerCase()}`;
}

const COLUMNS: readonly ColumnDefinition[] = [
  { key: "when", label: "When", numeric: false },
  { key: "distance", label: "Distance", numeric: true },
  { key: "duration", label: "Time", numeric: true },
  { key: "pace", label: "Pace", numeric: true },
  {
    key: "elevationPerKm",
    // Both halves of this ratio are units, and both follow the athlete: metres
    // per kilometre on metric, feet per mile on imperial. Showing feet per
    // kilometre — which is what converting only the climb gave — is a figure
    // in no system at all, and it reads 1.6x low to anyone taking it for ft/mi.
    label: "Climb",
    numeric: true
  },
  { key: "avgHr", label: "Avg HR", numeric: true },
  {
    key: "efficiency",
    label: "EF",
    numeric: true,
    title:
      "Efficiency index — metres per minute per heartbeat. Higher is more ground for the same effort."
  },
  {
    key: "drift",
    label: "Drift",
    numeric: true,
    title:
      "Aerobic decoupling — how much further apart pace and heart rate moved after the first ten minutes. Under 5% is a session held together; runs under 30 minutes get none."
  }
];

/**
 * A trail run's columns. Efficiency and drift go: both are pace against heart
 * rate, and on a trail the gradient moves the pace far more than the runner's
 * fitness does — a hilly run reads as a bad day and a flat one as a
 * breakthrough. The height takes their place, whole and by the hour.
 */
const TRAIL_COLUMNS: readonly ColumnDefinition[] = [
  { key: "when", label: "When", numeric: false },
  { key: "distance", label: "Distance", numeric: true },
  { key: "duration", label: "Time", numeric: true },
  { key: "pace", label: "Pace", numeric: true },
  { key: "elevationGain", label: "Climb", numeric: true, title: "Sort by the height climbed" },
  { key: "elevationPerKm", label: "Climb", numeric: true },
  { key: "ascentRate", label: "Climb/h", numeric: true },
  { key: "avgHr", label: "Avg HR", numeric: true }
];

/** Which way a column wants to sort the first time it is pressed. */
const FIRST_DIRECTION: Record<SortKey, "asc" | "desc"> = {
  when: "desc",
  distance: "desc",
  duration: "desc",
  // A faster run is a *smaller* number of seconds, so pace opens ascending or
  // the first press buries the best run at the bottom.
  pace: "asc",
  elevationGain: "desc",
  elevationPerKm: "desc",
  ascentRate: "desc",
  avgHr: "desc",
  efficiency: "desc",
  // Least drift first: the question this column answers is which runs held
  // together, and the worst one leading is the answer to a different one.
  drift: "asc"
};

function buildRow(
  activity: TrainingHubActivity,
  summaries?: ReadonlyMap<string, ActivityDetailSummary>
): RunRow | null {
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
    elevationGain: activity.elevationGain,
    elevationPerKm: elevationPerKm(activity),
    ascentRate: ascentPerHour(activity),
    avgHr: activity.avgHr,
    efficiency: efficiencyIndex(activity),
    drift: summaries?.get(activity.activityId)?.decouplingPercent
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

/** One cell's text, by its column. */
function cellText(row: RunRow, key: SortKey, unitSystem: UnitSystem): string {
  switch (key) {
    case "when":
      return formatTrainingTableWhen(row.when);
    case "distance":
      return formatDistanceMeters(row.distance, unitSystem);
    case "duration":
      return formatDurationSeconds(row.duration);
    case "pace":
      return formatPaceSecondsPerKm(row.pace, unitSystem);
    case "elevationGain":
      return row.elevationGain === undefined
        ? "—"
        : formatElevationMeters(row.elevationGain, unitSystem);
    case "elevationPerKm":
      return row.elevationPerKm === undefined
        ? "—"
        : `${Math.round(climbPerDistanceUnit(row.elevationPerKm, unitSystem))} ${elevationUnit(unitSystem)}`;
    case "ascentRate":
      return row.ascentRate === undefined
        ? "—"
        : `${Math.round(metersToElevation(row.ascentRate, unitSystem))} ${elevationUnit(unitSystem)}`;
    case "avgHr":
      return row.avgHr === undefined ? "—" : `${row.avgHr}`;
    case "efficiency":
      // Two decimals, not one: efficiency moves in hundredths, so a single
      // decimal rounds a block's whole progress into three values and the
      // column stops saying anything.
      return row.efficiency === undefined ? "—" : row.efficiency.toFixed(2);
    case "drift":
      // Signed, because a negative reading is a real result — the second half
      // cost less than the first — and an unsigned 3% would read as drift the
      // run did not have.
      return row.drift === undefined
        ? "—"
        : `${row.drift > 0 ? "+" : ""}${row.drift.toFixed(1)}%`;
  }
}

export function RunList({
  runs,
  summaries,
  sort,
  onSortChange,
  onOpenRun,
  trail = false
}: RunListProps) {
  const { unitSystem } = useUnitSystem();
  const columns = trail ? TRAIL_COLUMNS : COLUMNS;
  // A sort on a column this layout does not draw — efficiency, picked before
  // the Trail filter was — would order the rows by a figure nobody can see.
  const { key: sortKey, descending } = columns.some((column) => column.key === sort.key)
    ? sort
    : DEFAULT_RUN_SORT;

  const rows = useMemo(() => {
    const built = runs
      .map((activity) => buildRow(activity, summaries))
      .filter((row): row is RunRow => row !== null);
    return built.sort((left, right) => compareRows(left, right, sortKey, descending));
  }, [descending, runs, sortKey, summaries]);

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
          {columns.map((column) => {
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
                  title={columnTitle(column, unitSystem)}
                >
                  <span>{columnLabel(column, unitSystem)}</span>
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
            {columns
              .filter((column) => column.key !== "when")
              .map((column) => (
                <td key={column.key} className="is-numeric">
                  {cellText(row, column.key, unitSystem)}
                </td>
              ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
