import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { Layers, Trophy } from "lucide-react";
import type { StrengthSession } from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { SessionBodyGlyph, SessionBodySprite } from "./SessionBodyGlyph";
import { sessionHeat, type StrengthSessionIndex } from "./sessionAnalytics";
import { previousWeekStartMs, startOfWeekMs, type StrengthAnalytics } from "./strengthAnalytics";
import { formatSpan, formatTotalWeight, sessionSourceLabel } from "./strengthFormat";
import "./strengthSession.css";
import { getIntlLocale, plural, t } from "../i18n/core";

/** The list's first row: every session in the window at once, rather than one of them. */
export const AGGREGATE_SELECTION = "aggregate";

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
    return t("activity.week.undated");
  }
  const thisWeek = startOfWeekMs(nowMs);
  if (weekStart === thisWeek) return t("activity.week.this");
  if (weekStart === previousWeekStartMs(thisWeek)) return t("activity.week.last");
  const date = new Date(weekStart);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return t("activity.week.of", {
    date: date.toLocaleDateString(getIntlLocale(), {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" })
    })
  });
}

interface StrengthSessionListProps {
  sessions: StrengthSession[];
  index: StrengthSessionIndex;
  selected: string;
  onSelect: (selection: string) => void;
  /** The window as a whole, for the first row's figures and its body figure. */
  windowAnalytics: StrengthAnalytics;
  /** Tag each row with where it came from — only worth saying when sources are combined. */
  showSource: boolean;
}

/**
 * Every session in the window, grouped by week, with the whole window as the
 * first row. Arrow keys walk the rows the way they walk any list of documents.
 *
 * The first row is drawn in the sessions' own grammar — a mark where the date
 * sits, a name, a line of figures, the same body figure — because it is picked
 * the way they are. Drawn as a card with a filled icon above the weeks, it read
 * as the list's heading, and nobody pressed it.
 */
export function StrengthSessionList({
  sessions,
  index,
  selected,
  onSelect,
  windowAnalytics,
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
  const navRef = useRef<HTMLElement>(null);
  // An id for the figures' shared artwork; `useId`'s own is not safe in a URL fragment.
  const sprite = `strength-body-${useId().replace(/[^\w-]/g, "")}`;

  /*
   * Whether rows wait past the bottom edge, so the list fades there: the
   * scrollbar is a faint pill, and a list cut at a hard line with nothing to
   * say it goes on reads as finished. Measured, not assumed — at the end, or
   * with everything in view, nothing is fogged. The top needs no fade: a
   * week's sticky heading is the edge there once anything scrolls.
   */
  const [moreBelow, setMoreBelow] = useState(false);
  const measureMoreBelow = useCallback(() => {
    const node = navRef.current;
    if (!node) return;
    const more = node.scrollTop + node.clientHeight < node.scrollHeight - 2;
    setMoreBelow((held) => (held === more ? held : more));
  }, []);
  useLayoutEffect(() => {
    const node = navRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureMoreBelow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureMoreBelow]);
  // More sessions arriving lengthen the list without resizing its box.
  useLayoutEffect(measureMoreBelow, [groups, measureMoreBelow]);

  // The selection can come from outside the list — Activities hands a session
  // over — so the chosen row is scrolled to rather than left for the athlete to
  // find somewhere down a window's worth of weeks.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-selection="${CSS.escape(selected)}"]`
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

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
    <nav
      className={`strength-session-nav${moreBelow ? " has-fade-bottom" : ""}`}
      onScroll={measureMoreBelow}
      aria-label={t("strength.list.label")}
      ref={navRef}
      onKeyDown={moveSelection}
    >
      <SessionBodySprite id={sprite} />
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
          <strong>{t("strength.allSessions")}</strong>
          {/* Two figures, not a session's three: beside the body figure a third
              wrapped onto a line of its own, and the band states the time. */}
          <span className="strength-session-row-facts">
            <span>{plural("activity.sessions", sessions.length)}</span>
            <span>
              {windowAnalytics.summary.volumeKg > 0
                ? formatTotalWeight(windowAnalytics.summary.volumeKg, unitSystem)
                : plural("strength.sets", Math.round(windowAnalytics.summary.sets))}
            </span>
          </span>
        </span>
        <SessionBodyGlyph
          sprite={sprite}
          muscleById={windowAnalytics.muscleById}
          max={windowAnalytics.muscleMax.sets}
        />
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
              const heat = entry ? sessionHeat(entry, "sets") : undefined;
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
                        {date?.toLocaleDateString(getIntlLocale(), { weekday: "short" }) ?? "—"}
                      </em>
                      <strong>{date?.getDate() ?? ""}</strong>
                    </span>
                    <span className="strength-session-row-main">
                      <span className="strength-session-row-title">
                        <strong>{session.name?.trim() || t("strength.untitled")}</strong>
                        {records > 0 ? (
                          // The trophy alone: "PR" beside it cost a long name
                          // the width it was cut at.
                          <span
                            className="strength-session-record-mark"
                            role="img"
                            aria-label={plural("strength.list.records", records)}
                            title={plural("strength.list.records", records)}
                          >
                            <Trophy size={13} aria-hidden="true" />
                          </span>
                        ) : null}
                      </span>
                      <span className="strength-session-row-facts">
                        <span>{plural("strength.sets", Math.round(summary?.sets ?? 0))}</span>
                        <span>
                          {summary && summary.volumeKg > 0
                            ? formatTotalWeight(summary.volumeKg, unitSystem)
                            : t("strength.bodyweight")}
                        </span>
                        <span>{formatSpan(summary?.durationSec ?? session.duration ?? 0)}</span>
                        {source ? <span className="strength-session-row-source">{source}</span> : null}
                      </span>
                    </span>
                    {heat ? <SessionBodyGlyph sprite={sprite} muscleById={heat.muscleById} max={heat.max} /> : null}
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
