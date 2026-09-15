import { useMemo, type KeyboardEvent } from "react";
import { Layers, Trophy } from "lucide-react";
import type { StrengthSession } from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import type { StrengthSessionIndex } from "./sessionAnalytics";
import { startOfWeekMs } from "./strengthAnalytics";
import { formatSpan, formatTotalWeight, sessionSourceLabel } from "./strengthFormat";
import "./strengthSession.css";

/** The list's first row: every session in the window at once, rather than one of them. */
export const AGGREGATE_SELECTION = "aggregate";

const MS_PER_DAY = 86_400_000;

const PATTERNS = ["push", "pull", "legs", "core"] as const;

interface WeekGroup {
  /** Epoch ms of the Monday, or undefined for sessions with no start time. */
  weekStart?: number;
  sessions: StrengthSession[];
}

/** Newest week first, newest session first within it; undated sessions last. */
function groupByWeek(sessions: StrengthSession[]): WeekGroup[] {
  const ordered = [...sessions].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  const groups: WeekGroup[] = [];
  const undated: StrengthSession[] = [];
  for (const session of ordered) {
    if (session.startTime === undefined) {
      undated.push(session);
      continue;
    }
    const weekStart = startOfWeekMs(session.startTime * 1000);
    const last = groups[groups.length - 1];
    if (last?.weekStart === weekStart) {
      last.sessions.push(session);
    } else {
      groups.push({ weekStart, sessions: [session] });
    }
  }
  if (undated.length > 0) {
    groups.push({ sessions: undated });
  }
  return groups;
}

function weekHeading(weekStart: number | undefined, nowMs: number): string {
  if (weekStart === undefined) {
    return "Undated";
  }
  const thisWeek = startOfWeekMs(nowMs);
  if (weekStart === thisWeek) return "This week";
  // Seven days back can cross a daylight-saving change; startOfWeekMs re-snaps it.
  if (weekStart === startOfWeekMs(thisWeek - 7 * MS_PER_DAY + MS_PER_DAY / 2)) {
    return "Last week";
  }
  const date = new Date(weekStart);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return `Week of ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  })}`;
}

interface StrengthSessionListProps {
  sessions: StrengthSession[];
  index: StrengthSessionIndex;
  selected: string;
  onSelect: (selection: string) => void;
  /** The window's short label, e.g. "3 months". */
  windowLabel: string;
  /** Tag each row with where it came from — only worth saying when sources are combined. */
  showSource: boolean;
}

/**
 * Every session in the window, grouped by week, with the whole window as the
 * first row. Arrow keys walk the rows the way they walk any list of documents.
 */
export function StrengthSessionList({
  sessions,
  index,
  selected,
  onSelect,
  windowLabel,
  showSource
}: StrengthSessionListProps) {
  const { unitSystem } = useUnitSystem();
  const groups = useMemo(() => groupByWeek(sessions), [sessions]);
  const order = useMemo(
    () => [
      AGGREGATE_SELECTION,
      ...groups.flatMap((group) => group.sessions.map((session) => session.activityId))
    ],
    [groups]
  );
  const nowMs = Date.now();

  const moveSelection = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(selected) + step))];
    if (next === undefined || next === selected) return;
    onSelect(next);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-selection="${CSS.escape(next)}"]`)
      ?.focus();
  };

  return (
    <nav className="strength-session-nav" aria-label="Strength sessions" onKeyDown={moveSelection}>
      <button
        type="button"
        className="strength-session-row is-aggregate"
        data-selection={AGGREGATE_SELECTION}
        aria-current={selected === AGGREGATE_SELECTION ? "true" : undefined}
        onClick={() => onSelect(AGGREGATE_SELECTION)}
      >
        <span className="strength-session-row-icon" aria-hidden="true">
          <Layers size={16} />
        </span>
        <span className="strength-session-row-main">
          <strong>All sessions</strong>
          <span className="strength-session-row-facts">
            <span>{windowLabel}</span>
            <span>
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </span>
          </span>
        </span>
      </button>

      {groups.map((group) => (
        <section className="strength-session-week" key={group.weekStart ?? "undated"}>
          <h4 className="strength-session-week-head">
            <span>{weekHeading(group.weekStart, nowMs)}</span>
            <span>{group.sessions.length}</span>
          </h4>
          <ul>
            {group.sessions.map((session) => {
              const entry = index.byId.get(session.activityId);
              const summary = entry?.analytics.summary;
              const date = session.startTime ? new Date(session.startTime * 1000) : undefined;
              const balance = entry?.analytics.balance;
              const balanceTotal = balance
                ? PATTERNS.reduce((total, pattern) => total + balance[pattern], 0)
                : 0;
              const records = entry?.records.length ?? 0;
              const source = showSource ? sessionSourceLabel(session) : undefined;
              return (
                <li key={session.activityId}>
                  <button
                    type="button"
                    className="strength-session-row"
                    data-selection={session.activityId}
                    aria-current={selected === session.activityId ? "true" : undefined}
                    onClick={() => onSelect(session.activityId)}
                  >
                    <span className="strength-session-row-date" aria-hidden="true">
                      <em>
                        {date?.toLocaleDateString(undefined, { weekday: "short" }) ?? "—"}
                      </em>
                      <strong>{date?.getDate() ?? ""}</strong>
                    </span>
                    <span className="strength-session-row-main">
                      <span className="strength-session-row-title">
                        <strong>{session.name?.trim() || "Strength session"}</strong>
                        {records > 0 ? (
                          <span
                            className="strength-record-badge"
                            title={`${records} record${records === 1 ? "" : "s"} in this session`}
                          >
                            <Trophy size={10} aria-hidden="true" />
                            PR
                          </span>
                        ) : null}
                      </span>
                      <span className="strength-session-row-facts">
                        <span>{Math.round(summary?.sets ?? 0)} sets</span>
                        <span>
                          {summary && summary.volumeKg > 0
                            ? formatTotalWeight(summary.volumeKg, unitSystem)
                            : "Bodyweight"}
                        </span>
                        <span>{formatSpan(summary?.durationSec ?? session.duration ?? 0)}</span>
                        {source ? <span className="strength-session-row-source">{source}</span> : null}
                      </span>
                      {balance && balanceTotal > 0 ? (
                        <span className="strength-session-row-mix" aria-hidden="true">
                          {PATTERNS.filter((pattern) => balance[pattern] > 0).map((pattern) => (
                            <i
                              key={pattern}
                              data-pattern={pattern}
                              style={{ flexGrow: balance[pattern] / balanceTotal }}
                            />
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
