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
import { elevationUnit, metersToElevation } from "../units/units";
import { hikeAscentRate, hikeSeconds } from "./hikeMetrics";
import { HIKE_TYPE_LABELS, classifyHikeType, type HikeType } from "./hikeType";

interface HikeListProps {
  hikes: readonly TrainingHubActivity[];
  /** Kept by the parent: this unmounts while a hike is open, as Running's list does. */
  sort: HikeSort;
  onSortChange: (sort: HikeSort) => void;
  onOpenHike: (activity: TrainingHubActivity) => void;
}

export interface HikeSort {
  key: HikeSortKey;
  descending: boolean;
}

export type HikeSortKey =
  | "when"
  | "distance"
  | "duration"
  | "ascent"
  | "ascentRate"
  | "avgHr"
  | "load";

interface HikeRow {
  activity: TrainingHubActivity;
  type: HikeType;
  when: number | undefined;
  distance: number | undefined;
  duration: number | undefined;
  ascent: number | undefined;
  ascentRate: number | undefined;
  avgHr: number | undefined;
  load: number | undefined;
}

interface ColumnDefinition {
  key: HikeSortKey;
  label: string;
  numeric: boolean;
  title?: string;
}

/**
 * Ascent and the climbing rate stand where a run's pace does: a hike is told
 * by how much height it gained and how fast, and its speed along the trail
 * mostly says how steep the trail was. The columns a narrow panel hides are
 * Running's positions (running.css) — here the climbing rate and load, then
 * time.
 */
const COLUMNS: readonly ColumnDefinition[] = [
  { key: "when", label: "When", numeric: false },
  { key: "distance", label: "Distance", numeric: true },
  {
    key: "duration",
    label: "Time",
    numeric: true,
    title: "Recorded time — with auto-pause off, as COROS's hike mode ships, every stop is in it"
  },
  { key: "ascent", label: "Ascent", numeric: true, title: "Metres climbed" },
  {
    key: "ascentRate",
    label: "Ascent/h",
    numeric: true,
    title: "Metres climbed an hour of recorded time"
  },
  { key: "avgHr", label: "Avg HR", numeric: true },
  { key: "load", label: "Load", numeric: true, title: "COROS training load for the hike" }
];

const FIRST_DIRECTION: Record<HikeSortKey, "asc" | "desc"> = {
  when: "desc",
  distance: "desc",
  duration: "desc",
  ascent: "desc",
  ascentRate: "desc",
  avgHr: "desc",
  load: "desc"
};

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildRow(activity: TrainingHubActivity): HikeRow | null {
  const type = classifyHikeType(activity.sportType);
  if (type === null) {
    return null;
  }
  return {
    activity,
    type,
    when: activity.startTime,
    distance: positive(activity.distance),
    duration: hikeSeconds(activity),
    ascent: positive(activity.elevationGain),
    ascentRate: hikeAscentRate(activity),
    avgHr: positive(activity.avgHr),
    load: positive(activity.trainingLoad)
  };
}

/** Every gap at the bottom, whichever way the column runs — see RunList. */
function compareRows(left: HikeRow, right: HikeRow, key: HikeSortKey, descending: boolean): number {
  const a = left[key];
  const b = right[key];
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return descending ? b - a : a - b;
}

export const DEFAULT_HIKE_SORT: HikeSort = { key: "when", descending: true };

export function HikeList({ hikes, sort, onSortChange, onOpenHike }: HikeListProps) {
  const { unitSystem } = useUnitSystem();
  const { key: sortKey, descending } = sort;

  const rows = useMemo(() => {
    const built = hikes
      .map((activity) => buildRow(activity))
      .filter((row): row is HikeRow => row !== null);
    return built.sort((left, right) => compareRows(left, right, sortKey, descending));
  }, [descending, hikes, sortKey]);

  const toggleSort = (key: HikeSortKey) => {
    onSortChange(
      key === sortKey
        ? { key, descending: !descending }
        : { key, descending: FIRST_DIRECTION[key] === "desc" }
    );
  };

  const openOnKey = (event: KeyboardEvent<HTMLTableRowElement>, activity: TrainingHubActivity) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenHike(activity);
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
                className={[column.numeric ? "is-numeric" : undefined, active ? "is-sorted" : undefined]
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
            onClick={() => onOpenHike(row.activity)}
            onKeyDown={(event) => openOnKey(event, row.activity)}
          >
            <td>
              <div className="run-list-when">
                <span className={`run-surface-chip hike-type-${row.type}`}>
                  {HIKE_TYPE_LABELS[row.type]}
                </span>
                <div>
                  <strong>{row.activity.name?.trim() || HIKE_TYPE_LABELS[row.type]}</strong>
                  <span>{formatTrainingTableWhen(row.when)}</span>
                </div>
              </div>
            </td>
            <td className="is-numeric">
              {row.distance === undefined ? "—" : formatDistanceMeters(row.distance, unitSystem)}
            </td>
            <td className="is-numeric">{formatDurationSeconds(row.duration)}</td>
            <td className="is-numeric">
              {row.ascent === undefined ? "—" : formatElevationMeters(row.ascent, unitSystem)}
            </td>
            <td className="is-numeric">
              {row.ascentRate === undefined
                ? "—"
                : `${Math.round(metersToElevation(row.ascentRate, unitSystem))} ${elevationUnit(unitSystem)}`}
            </td>
            <td className="is-numeric">{row.avgHr === undefined ? "—" : `${row.avgHr}`}</td>
            <td className="is-numeric">{row.load === undefined ? "—" : Math.round(row.load)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
