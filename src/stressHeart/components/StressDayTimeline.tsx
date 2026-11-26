import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Activity, Bike, Dumbbell, Moon, Mountain, Waves, type LucideIcon } from "lucide-react";
import { STRESS_SLOTS_PER_DAY, stressLevelOf } from "../../../electron/stressHeartParser";
import type { StressDaySeries } from "../../../electron/types";
import { resolveSportName } from "../../training/sportTypes";
import { sportColorCategory, type SportColorCategory } from "../../training/sportColors";
import { formatSleepDurationMinutes } from "../../training/formatters";
import { RunnerIcon } from "../../running/runnerIcon";
import { ClimbIcon } from "../../climbing/climbIcon";
import { useI18n } from "../../i18n/useI18n";
import {
  MINUTES_PER_SLOT,
  clockOf,
  lastReadingSlot,
  type LanePiece,
  type LaneSession
} from "../stressHeartModel";
import { stressLevelName } from "../stressLevelNames";

interface StressDayTimelineProps {
  series: StressDaySeries | undefined;
  sleep: LanePiece[];
  sessions: LaneSession[];
  /** A day still being lived: the readings stop at the last one, not at midnight. */
  live: boolean;
}

const LEFT = 32;
const RIGHT = 10;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 158;
/** The day's line runs between the plot and the clock. */
const LINE_Y = 180;
const BADGE_R = 9;
const CLOCK_Y = LINE_Y + BADGE_R + 20;
const HEIGHT = CLOCK_Y + 6;
const DAY_MINUTES = 24 * 60;

const SPORT_GLYPHS: Record<SportColorCategory, LucideIcon> = {
  run: RunnerIcon,
  bike: Bike,
  hiking: Mountain,
  swim: Waves,
  climb: ClimbIcon,
  strength: Dumbbell,
  other: Activity
};

type LineState = "sleep" | "session" | "measured" | "unmeasured";

interface LineRun {
  state: LineState;
  from: number;
  to: number;
  sport?: SportColorCategory;
}

/**
 * What each five minutes of the day was, as one line: asleep, in a session,
 * awake and read, or awake and not read. A session outranks sleep, and both
 * outrank a reading. On a day still being lived the line stops at the last
 * reading.
 */
function dayLine(
  series: StressDaySeries | undefined,
  sleep: LanePiece[],
  sessions: LaneSession[],
  untilSlot: number
): LineRun[] {
  const runs: LineRun[] = [];
  for (let slot = 0; slot < untilSlot; slot += 1) {
    const minute = slot * MINUTES_PER_SLOT + MINUTES_PER_SLOT / 2;
    const session = sessions.find((item) => minute >= item.from && minute < item.to);
    const reading = series?.slots[slot];
    const state: LineState = session
      ? "session"
      : sleep.some((piece) => minute >= piece.from && minute < piece.to)
        ? "sleep"
        : reading !== null && reading !== undefined
          ? "measured"
          : "unmeasured";
    const sport = session ? sportColorCategory(session.activity.sportType) : undefined;
    const last = runs[runs.length - 1];
    if (last && last.state === state && last.sport === sport) {
      last.to = (slot + 1) * MINUTES_PER_SLOT;
    } else {
      runs.push({ state, sport, from: slot * MINUTES_PER_SLOT, to: (slot + 1) * MINUTES_PER_SLOT });
    }
  }
  return runs;
}

interface Hover {
  x: number;
  y: number;
  text: string;
}

/**
 * A day of stress readings, one bar every five minutes in its level's colour,
 * over a line of what the day held — the sleep around it and the sessions in
 * it, each with its mark — and the clock under that. The line is dotted where
 * nothing was read: COROS reads stress only while the wearer is still, so the
 * gaps are the sessions and the hours the watch was off.
 *
 * Drawn by hand rather than through the chart library: 288 bars a level each
 * over a line of states is not a chart Recharts has.
 */
export function StressDayTimeline({ series, sleep, sessions, live }: StressDayTimelineProps) {
  const { t, locale } = useI18n();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    setWidth(frame.clientWidth);
    const observer = new ResizeObserver(() => setWidth(frame.clientWidth));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(0, width - LEFT - RIGHT);
  const x = (minute: number) => LEFT + (minute / DAY_MINUTES) * plotWidth;
  const y = (value: number) => PLOT_BOTTOM - (value / 100) * (PLOT_BOTTOM - PLOT_TOP);
  const lastSlot = lastReadingSlot(series);
  const until = live ? lastSlot + 1 : STRESS_SLOTS_PER_DAY;

  const drawing = useMemo(() => {
    if (width === 0) return null;
    const slotWidth = plotWidth / STRESS_SLOTS_PER_DAY;
    const line = dayLine(series, sleep, sessions, Math.max(0, until));
    const shade = (from: number, to: number) => ({
      x: x(from),
      y: PLOT_TOP,
      width: Math.max(1, x(to) - x(from)),
      height: LINE_Y + BADGE_R + 3 - PLOT_TOP,
      rx: 6
    });
    return (
      <>
        {sleep.map((piece) => (
          <rect key={`shade-${piece.kind}-${piece.from}`} className="stress-timeline-sleep-shade" {...shade(piece.from, piece.to)} />
        ))}
        {sessions.map((session) => (
          <rect
            key={`shade-${session.activity.activityId}`}
            className="stress-timeline-session-shade"
            style={{ "--stress-session-color": `var(--sport-${sportColorCategory(session.activity.sportType)})` } as CSSProperties}
            {...shade(session.from, session.to)}
          />
        ))}

        {[0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line
              className={value === 0 ? "stress-timeline-axis" : "stress-timeline-grid"}
              x1={LEFT}
              x2={width - RIGHT}
              y1={y(value)}
              y2={y(value)}
            />
            <text className="stress-timeline-tick" x={LEFT - 8} y={y(value) + 4} textAnchor="end">
              {value}
            </text>
          </g>
        ))}

        {series
          ? series.slots.map((value, slot) =>
              value === null ? null : (
                <rect
                  key={slot}
                  className={`stress-timeline-bar is-${stressLevelOf(value)}`}
                  x={x(slot * MINUTES_PER_SLOT) + 0.3}
                  y={y(value)}
                  width={Math.max(0.8, slotWidth - 0.6)}
                  height={PLOT_BOTTOM - y(value)}
                />
              )
            )
          : null}

        {line.map((run) => (
          <line
            key={`${run.state}-${run.from}`}
            className={`stress-timeline-line is-${run.state}`}
            style={
              run.sport ? ({ "--stress-session-color": `var(--sport-${run.sport})` } as CSSProperties) : undefined
            }
            x1={x(run.from) + (run.state === "unmeasured" ? 3 : 1.5)}
            x2={Math.max(x(run.from) + 1.5, x(run.to) - 1.5)}
            y1={LINE_Y}
            y2={LINE_Y}
          />
        ))}

        {sleep
          .filter((piece) => x(piece.to) - x(piece.from) >= BADGE_R * 2)
          .map((piece) => {
            const cx = (x(piece.from) + x(piece.to)) / 2;
            return (
              <g key={`badge-${piece.kind}-${piece.from}`} className="stress-timeline-badge is-sleep">
                <circle cx={cx} cy={LINE_Y} r={BADGE_R} />
                <Moon x={cx - 5.5} y={LINE_Y - 5.5} size={11} strokeWidth={2.4} aria-hidden="true" />
              </g>
            );
          })}
        {sessions.map((session) => {
          const sport = sportColorCategory(session.activity.sportType);
          const Glyph = SPORT_GLYPHS[sport];
          const cx = (x(session.from) + x(session.to)) / 2;
          return (
            <g
              key={`badge-${session.activity.activityId}`}
              className="stress-timeline-badge is-session"
              style={{ "--stress-session-color": `var(--sport-${sport})` } as CSSProperties}
            >
              <circle cx={cx} cy={LINE_Y} r={BADGE_R} />
              <Glyph x={cx - 5.5} y={LINE_Y - 5.5} size={11} strokeWidth={2.4} aria-hidden="true" />
            </g>
          );
        })}

        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
          <text
            key={hour}
            className="stress-timeline-tick"
            x={x(hour * 60)}
            y={CLOCK_Y}
            textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}
          >
            {`${String(hour).padStart(2, "0")}:00`}
          </text>
        ))}

        {live && lastSlot >= 0 ? (
          <g>
            <line
              className="stress-timeline-now"
              x1={x(until * MINUTES_PER_SLOT)}
              x2={x(until * MINUTES_PER_SLOT)}
              y1={PLOT_TOP - 4}
              y2={PLOT_BOTTOM}
            />
            <text
              className="stress-timeline-tick"
              x={x(until * MINUTES_PER_SLOT) + (until > STRESS_SLOTS_PER_DAY * 0.8 ? -6 : 6)}
              y={PLOT_TOP + 8}
              textAnchor={until > STRESS_SLOTS_PER_DAY * 0.8 ? "end" : "start"}
            >
              {t("stress.timeline.lastReading", { time: clockOf(lastSlot * MINUTES_PER_SLOT) })}
            </text>
          </g>
        ) : null}
      </>
    );
    // x and y read nothing but the width-derived numbers named here.
  }, [width, plotWidth, series, sleep, sessions, live, until, lastSlot, t, locale]);

  function describe(minute: number, onLine: boolean): string | null {
    const session = sessions.find((item) => minute >= item.from && minute < item.to);
    const piece = sleep.find((item) => minute >= item.from && minute < item.to);
    if (onLine && session) {
      const activity = session.activity;
      const parts = [
        `${clockOf(Math.round(session.from))}–${clockOf(Math.round(session.to))}`,
        activity.duration ? formatSleepDurationMinutes(activity.duration / 60) : undefined,
        activity.avgHr ? t("stress.tip.avgHr", { bpm: Math.round(activity.avgHr) }) : undefined
      ].filter(Boolean);
      return `${activity.name?.trim() || resolveSportName(activity) || ""} · ${parts.join(" · ")}`;
    }
    if (onLine && piece) {
      return t(piece.kind === "nap" ? "stress.tip.nap" : "stress.tip.asleep", { start: piece.start, end: piece.end });
    }
    const slot = Math.min(STRESS_SLOTS_PER_DAY - 1, Math.floor(minute / MINUTES_PER_SLOT));
    if (live && slot >= until) return null;
    const value = series?.slots[slot] ?? null;
    if (value === null) return t("stress.tip.notMeasured", { time: clockOf(slot * MINUTES_PER_SLOT) });
    return t("stress.tip.reading", {
      time: clockOf(slot * MINUTES_PER_SLOT),
      value,
      level: stressLevelName(stressLevelOf(value))
    });
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    const onLine = Math.abs(py - LINE_Y) <= BADGE_R + 4;
    if (px < LEFT || px > width - RIGHT || (py > PLOT_BOTTOM && !onLine)) {
      setHover(null);
      return;
    }
    const minute = ((px - LEFT) / plotWidth) * DAY_MINUTES;
    const text = describe(minute, onLine);
    setHover(text ? { x: px, y: py, text } : null);
  }

  return (
    <div className="stress-timeline" ref={frameRef}>
      <svg
        className="stress-timeline-svg"
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={t("stress.timeline.aria")}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        {drawing}
      </svg>
      {hover ? (
        <div
          className="stress-tip"
          style={{
            left: hover.x > width - 220 ? undefined : hover.x + 14,
            right: hover.x > width - 220 ? width - hover.x + 14 : undefined,
            top: Math.max(0, hover.y - 36)
          }}
          aria-hidden="true"
        >
          {hover.text}
        </div>
      ) : null}
    </div>
  );
}
