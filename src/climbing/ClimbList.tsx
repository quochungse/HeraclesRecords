import type { MessageKey } from "../i18n/core";
import { useMemo, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ActivityDetailSummary, ClimbStyle, TrainingHubActivity } from "../../electron/types";
import { climbGradeOf, type ClimbFamily } from "../../electron/climbGrades";
import { climbFamilyOfSport, isSend } from "../../electron/climbDetail";
import { formatDurationSeconds, formatTrainingTableWhen } from "../training/formatters";
import { climbSummaryFor, gradeName, styleGroupOf, type ClimbScales } from "./climbMetrics";
import { CLIMB_KIND_LABELS, CLIMB_STYLE_LABELS, classifyClimbKind, type ClimbKind } from "./climbType";
import { t } from "../i18n/core";

interface ClimbListProps {
  sessions: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  scales: ClimbScales;
  /** Kept by the parent: this unmounts while a session is open, as Running's list does. */
  sort: ClimbSort;
  onSortChange: (sort: ClimbSort) => void;
  onOpenSession: (activity: TrainingHubActivity) => void;
}

export interface ClimbSort {
  key: ClimbSortKey;
  descending: boolean;
}

export type ClimbSortKey = "when" | "climbs" | "hardest" | "sent" | "duration" | "avgHr" | "load";

interface ClimbRow {
  activity: TrainingHubActivity;
  kind: ClimbKind;
  family: ClimbFamily;
  when: number | undefined;
  climbs: number | undefined;
  /** The hardest send's step on its ladder: the sort key; `hardestName` is what is shown. */
  hardest: number | undefined;
  hardestName?: string;
  sent: number | undefined;
  duration: number | undefined;
  avgHr: number | undefined;
  load: number | undefined;
  styles: ClimbStyle[];
}

interface ColumnDefinition {
  key: ClimbSortKey;
  label: string;
  numeric: boolean;
  title?: string;
}

/** A column whose words are read in the language on screen each time. */
function column(key: ClimbSortKey, labelKey: MessageKey, numeric: boolean, titleKey?: MessageKey): ColumnDefinition {
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
 * The climbs a session held, its hardest send and the share it sent stand
 * where a run's distance and pace do; each row also draws its climbs in the
 * order they were climbed, one mark each in how it went. The columns a narrow
 * panel hides are Running's positions (running.css).
 */
const COLUMNS: readonly ColumnDefinition[] = [
  column("when", "run.list.when", false),
  column("climbs", "climb.climbs", true, "climb.climbsTitle"),
  column("hardest", "climb.list.hardest", true),
  column("sent", "climb.list.sent", true, "climb.list.sentTitle"),
  column("duration", "activity.m.time", true),
  column("avgHr", "activity.m.avgHr", true),
  column("load", "overview.tiles.load", true)
];

const FIRST_DIRECTION: Record<ClimbSortKey, "asc" | "desc"> = {
  when: "desc",
  climbs: "desc",
  hardest: "desc",
  sent: "desc",
  duration: "desc",
  avgHr: "desc",
  load: "desc"
};

/** A session's marks beyond this many are left out of its row: the count says how many. */
const STRIP_MAX = 24;

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildRow(
  activity: TrainingHubActivity,
  summaries: ReadonlyMap<string, ActivityDetailSummary>,
  scales: ClimbScales
): ClimbRow | null {
  const kind = classifyClimbKind(activity.sportType);
  if (kind === null) return null;
  const summary = climbSummaryFor(activity, summaries);
  const family = climbFamilyOfSport(activity.sportType);
  let hardest: number | undefined;
  let sent = 0;
  let marked = 0;
  for (const entry of summary?.climbs ?? []) {
    if (entry.style !== "unrecorded") {
      marked += 1;
      if (isSend(entry.style)) sent += 1;
    }
    const grade = climbGradeOf(activity.sportType, entry.system, entry.gradeIndex);
    if (grade && grade.family === family && isSend(entry.style)) {
      hardest = Math.max(hardest ?? 0, grade.ladder);
    }
  }
  return {
    activity,
    kind,
    family,
    when: activity.startTime,
    climbs: summary?.climbs.length,
    hardest,
    ...(hardest !== undefined ? { hardestName: gradeName(family, hardest, scales) } : {}),
    sent: marked > 0 ? sent / marked : undefined,
    duration: positive(activity.duration),
    avgHr: positive(activity.avgHr),
    load: positive(activity.trainingLoad),
    styles: (summary?.climbs ?? []).map((entry) => entry.style)
  };
}

/** Every gap at the bottom, whichever way the column runs — see RunList. */
function compareRows(left: ClimbRow, right: ClimbRow, key: ClimbSortKey, descending: boolean): number {
  const a = left[key];
  const b = right[key];
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return descending ? b - a : a - b;
}

export const DEFAULT_CLIMB_SORT: ClimbSort = { key: "when", descending: true };

export function ClimbList({ sessions, summaries, scales, sort, onSortChange, onOpenSession }: ClimbListProps) {
  const { key: sortKey, descending } = sort;

  const rows = useMemo(() => {
    const built = sessions
      .map((activity) => buildRow(activity, summaries, scales))
      .filter((row): row is ClimbRow => row !== null);
    return built.sort((left, right) => compareRows(left, right, sortKey, descending));
  }, [descending, scales, sessions, sortKey, summaries]);

  const toggleSort = (key: ClimbSortKey) => {
    onSortChange(
      key === sortKey ? { key, descending: !descending } : { key, descending: FIRST_DIRECTION[key] === "desc" }
    );
  };

  const openOnKey = (event: KeyboardEvent<HTMLTableRowElement>, activity: TrainingHubActivity) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenSession(activity);
    }
  };

  return (
    <table className="run-list climb-list">
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
            onClick={() => onOpenSession(row.activity)}
            onKeyDown={(event) => openOnKey(event, row.activity)}
          >
            <td>
              <div className="run-list-when">
                <span className={`run-surface-chip climb-kind-${row.kind}`}>{CLIMB_KIND_LABELS[row.kind]}</span>
                <div>
                  <strong>{row.activity.name?.trim() || CLIMB_KIND_LABELS[row.kind]}</strong>
                  <span>{formatTrainingTableWhen(row.when)}</span>
                </div>
              </div>
            </td>
            <td className="is-numeric">
              <div className="climb-list-climbs">
                {row.styles.length > 0 ? (
                  <span className="climb-strip" aria-hidden="true">
                    {row.styles.slice(0, STRIP_MAX).map((style, index) => (
                      <i key={index} className={`climb-group-${styleGroupOf(style)}`} title={CLIMB_STYLE_LABELS[style]} />
                    ))}
                  </span>
                ) : null}
                <span>{row.climbs ?? "—"}</span>
              </div>
            </td>
            <td className="is-numeric">{row.hardestName ?? "—"}</td>
            <td className="is-numeric">{row.sent === undefined ? "—" : `${Math.round(row.sent * 100)}%`}</td>
            <td className="is-numeric">{formatDurationSeconds(row.duration)}</td>
            <td className="is-numeric">{row.avgHr === undefined ? "—" : `${row.avgHr}`}</td>
            <td className="is-numeric">{row.load === undefined ? "—" : Math.round(row.load)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
