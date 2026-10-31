import type { MessageKey } from "../i18n/core";
import { useMemo, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatTrainingTableWhen
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatPer100,
  formatPoolLength,
  sessionSwolf,
  swimSeconds,
  swimSummaryFor,
  swimmingPace
} from "./swimMetrics";
import { SWIM_TYPE_LABELS, classifySwimType, type SwimType } from "./swimType";
import { formatDecimal, t } from "../i18n/core";

interface SwimListProps {
  swims: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** Kept by the parent: this unmounts while a swim is open, as Running's list does. */
  sort: SwimSort;
  onSortChange: (sort: SwimSort) => void;
  onOpenSwim: (activity: TrainingHubActivity) => void;
}

export interface SwimSort {
  key: SwimSortKey;
  descending: boolean;
}

export type SwimSortKey = "when" | "distance" | "duration" | "pace" | "swolf" | "avgHr" | "load";

interface SwimRow {
  activity: TrainingHubActivity;
  type: SwimType;
  /** The pool's length as its chip reads, or the kind in open water. */
  chip: string;
  when: number | undefined;
  distance: number | undefined;
  duration: number | undefined;
  pace: number | undefined;
  swolf: number | undefined;
  avgHr: number | undefined;
  load: number | undefined;
}

interface ColumnDefinition {
  key: SwimSortKey;
  label: string;
  numeric: boolean;
  title?: string;
}

/** A column whose words are read in the language on screen each time. */
function column(key: SwimSortKey, labelKey: MessageKey, numeric: boolean, titleKey?: MessageKey): ColumnDefinition {
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

/**
 * Pace per 100 and SWOLF stand where a run's pace and cadence do. A pool
 * swim's chip names its pool, because a SWOLF is only read against swims in
 * the same one. The columns a narrow panel hides are Running's positions
 * (running.css).
 */
const COLUMNS: readonly ColumnDefinition[] = [
  column("when", "run.list.when", false),
  column("distance", "activity.m.distance", true),
  column("duration", "activity.m.time", true, "swim.timeTitle"),
  column("pace", "activity.m.pace", true, "swim.avgPaceTitle"),
  column("swolf", "swim.m.swolf", true, "swim.m.swolfTitle"),
  column("avgHr", "activity.m.avgHr", true),
  column("load", "overview.tiles.load", true)
];

/** Faster is a smaller pace and a smaller SWOLF, so those open ascending. */
const FIRST_DIRECTION: Record<SwimSortKey, "asc" | "desc"> = {
  when: "desc",
  distance: "desc",
  duration: "desc",
  pace: "asc",
  swolf: "asc",
  avgHr: "desc",
  load: "desc"
};

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildRow(
  activity: TrainingHubActivity,
  summaries: ReadonlyMap<string, ActivityDetailSummary>
): SwimRow | null {
  const type = classifySwimType(activity.sportType);
  if (type === null) {
    return null;
  }
  const summary = swimSummaryFor(activity, summaries);
  return {
    activity,
    type,
    chip:
      type === "pool" && summary?.poolLength !== undefined
        ? formatPoolLength(summary.poolLength, summary.poolUnit)
        : SWIM_TYPE_LABELS[type],
    when: activity.startTime,
    distance: positive(activity.distance),
    duration: swimSeconds(activity),
    pace: swimmingPace(activity, summaries),
    swolf: summary ? sessionSwolf(summary) : undefined,
    avgHr: positive(activity.avgHr),
    load: positive(activity.trainingLoad)
  };
}

/** Every gap at the bottom, whichever way the column runs — see RunList. */
function compareRows(left: SwimRow, right: SwimRow, key: SwimSortKey, descending: boolean): number {
  const a = left[key];
  const b = right[key];
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return descending ? b - a : a - b;
}

export const DEFAULT_SWIM_SORT: SwimSort = { key: "when", descending: true };

export function SwimList({ swims, summaries, sort, onSortChange, onOpenSwim }: SwimListProps) {
  const { unitSystem } = useUnitSystem();
  const { key: sortKey, descending } = sort;

  const rows = useMemo(() => {
    const built = swims
      .map((activity) => buildRow(activity, summaries))
      .filter((row): row is SwimRow => row !== null);
    return built.sort((left, right) => compareRows(left, right, sortKey, descending));
  }, [descending, sortKey, summaries, swims]);

  const toggleSort = (key: SwimSortKey) => {
    onSortChange(
      key === sortKey ? { key, descending: !descending } : { key, descending: FIRST_DIRECTION[key] === "desc" }
    );
  };

  const openOnKey = (event: KeyboardEvent<HTMLTableRowElement>, activity: TrainingHubActivity) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenSwim(activity);
    }
  };

  return (
    <table className="run-list">
      <thead>
        <tr>
          {COLUMNS.map((entry) => {
            const active = entry.key === sortKey;
            return (
              <th
                key={entry.key}
                scope="col"
                className={[entry.numeric ? "is-numeric" : undefined, active ? "is-sorted" : undefined]
                  .filter(Boolean)
                  .join(" ")}
                aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(entry.key)}
                  title={entry.title ?? t("run.list.sortBy", { column: entry.label })}
                >
                  <span>{entry.label}</span>
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
            onClick={() => onOpenSwim(row.activity)}
            onKeyDown={(event) => openOnKey(event, row.activity)}
          >
            <td>
              <div className="run-list-when">
                <span className={`run-surface-chip swim-type-${row.type}`}>{row.chip}</span>
                <div>
                  <strong>{row.activity.name?.trim() || SWIM_TYPE_LABELS[row.type]}</strong>
                  <span>{formatTrainingTableWhen(row.when)}</span>
                </div>
              </div>
            </td>
            <td className="is-numeric">
              {row.distance === undefined ? "—" : formatDistanceMeters(row.distance, unitSystem, true)}
            </td>
            <td className="is-numeric">{formatDurationSeconds(row.duration)}</td>
            <td className="is-numeric">{formatPer100(row.pace, unitSystem)}</td>
            <td className="is-numeric">{row.swolf === undefined ? "—" : formatDecimal(row.swolf, 0)}</td>
            <td className="is-numeric">{row.avgHr === undefined ? "—" : `${row.avgHr}`}</td>
            <td className="is-numeric">{row.load === undefined ? "—" : Math.round(row.load)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
