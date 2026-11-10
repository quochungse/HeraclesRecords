import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import type { ActivityLapSection } from "../../../electron/types";
import { t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import {
  MIN_SELECTION_SECONDS,
  lapAt,
  lapCover,
  sameSpan,
  snapToLaps,
  wholeLaps,
  type ActivityLink,
  type LapSpan,
  type LinkSpan
} from "../activityLink";
import { formatDurationSeconds } from "../formatters";
import { useLinkValue } from "../useActivityLink";
import { lapSectionLabel } from "./LapSections";

/*
 * The pieces a session's page draws the link with (`activityLink.ts`): the
 * layer over a plot that shows and sets the cursor and the selection, the lap
 * ruler above the chart, and a lap table's row. Each reads only what it draws,
 * so a moving cursor redraws a line and two dots, not a page.
 */

/** What a stretch is called: its lap or laps when it is exactly those, else its two times. */
export function stretchTitle(spans: readonly LapSpan[], stretch: LinkSpan): string {
  const laps = wholeLaps(spans, stretch);
  if (!laps) {
    return `${formatDurationSeconds(stretch.from)} – ${formatDurationSeconds(stretch.to)}`;
  }
  return laps.first.index === laps.last.index
    ? t("activity.chart.selection.lap", { n: laps.first.index })
    : t("activity.chart.selection.laps", { from: laps.first.index, to: laps.last.index });
}

/** A lap's standing as class names, one string so a row redraws only when it changes. */
function lapFlags(link: ActivityLink, lap: LapSpan | undefined): string {
  if (!lap) {
    return "";
  }
  const { selection, preview, cursor } = link.getState();
  const cover = lapCover(lap, selection);
  return [
    cover === "whole" ? "is-lap-selected" : cover === "part" ? "is-lap-partial" : "",
    lapCover(lap, preview) === "whole" ? "is-lap-preview" : "",
    cursor !== null && lapAt(link.laps(), cursor)?.index === lap.index ? "is-lap-cursor" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function useLapFlags(link: ActivityLink, lapIndex: number): { lap: LapSpan | undefined; flags: string } {
  const lap = link.laps().find((entry) => entry.index === lapIndex);
  const flags = useLinkValue(link, () => lapFlags(link, lap));
  return { lap, flags };
}

/** What every lap control does with the pointer and the keys. */
function lapHandlers(link: ActivityLink, lap: LapSpan) {
  const show = () => link.setPreview({ from: lap.from, to: lap.to });
  const hide = () => link.setPreview(null);
  return {
    onPointerEnter: show,
    onPointerLeave: hide,
    onFocus: show,
    onBlur: hide
  };
}

/**
 * A lap table's row, tied to the chart and the map: under the pointer it shows
 * its stretch on both, pressed it selects it (Shift reaches from the lap
 * pressed before), and it marks itself while the cursor is inside it.
 */
export function LinkedLapRow({
  link,
  lapIndex,
  className,
  children
}: {
  /** Absent where there is no chart to tie the row to: a plain row. */
  link?: ActivityLink;
  lapIndex: number;
  className?: string;
  children: ReactNode;
}) {
  return link ? (
    <TiedLapRow link={link} lapIndex={lapIndex} className={className}>
      {children}
    </TiedLapRow>
  ) : (
    <tr className={className}>{children}</tr>
  );
}

function TiedLapRow({
  link,
  lapIndex,
  className,
  children
}: {
  link: ActivityLink;
  lapIndex: number;
  className?: string;
  children: ReactNode;
}) {
  useI18n();
  const { lap, flags } = useLapFlags(link, lapIndex);
  if (!lap) {
    // Past a lap COROS timed nothing for, the bounds are not known.
    return <tr className={className}>{children}</tr>;
  }
  return (
    <tr
      tabIndex={0}
      className={["lap-link-row", className, flags].filter(Boolean).join(" ")}
      title={t("activity.lap.select")}
      onClick={(event) => link.selectLap(lapIndex, event.shiftKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          link.selectLap(lapIndex, event.shiftKey);
        } else if (event.key === "Escape" && link.getState().selection) {
          event.stopPropagation();
          link.setSelection(null);
        }
      }}
      {...lapHandlers(link, lap)}
    >
      {children}
    </tr>
  );
}

/** Where a plot's own area sits inside its stage, in pixels. */
export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function measurePlot(stage: HTMLElement): PlotRect | null {
  const svg = stage.querySelector("svg.recharts-surface");
  if (!svg) {
    return null;
  }
  const stageBox = stage.getBoundingClientRect();
  const svgBox = svg.getBoundingClientRect();
  // Recharts clips its lines to the plot area; that rectangle is the area.
  const clip = svg.querySelector("defs clipPath rect");
  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (clip) {
    x = Number(clip.getAttribute("x"));
    y = Number(clip.getAttribute("y"));
    width = Number(clip.getAttribute("width"));
    height = Number(clip.getAttribute("height"));
  } else {
    const grid = svg.querySelector(".recharts-cartesian-grid");
    if (!grid) {
      return null;
    }
    const box = grid.getBoundingClientRect();
    x = box.left - svgBox.left;
    y = box.top - svgBox.top;
    width = box.width;
    height = box.height;
  }
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    left: Math.round(svgBox.left - stageBox.left + x),
    top: Math.round(svgBox.top - stageBox.top + y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

const sameRect = (a: PlotRect | null, b: PlotRect | null) =>
  a === b ||
  (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** How near a lap's edge, in pixels, a dragged edge takes it. */
const SNAP_PX = 7;
/** How far the pointer travels before a press is a drag. */
const DRAG_PX = 4;

interface PlotStageProps {
  link: ActivityLink;
  /** The x values at the plot's two edges, on the axis it is drawn over. */
  domain: readonly [number, number];
  /** A moment as an x on that axis, and back. */
  toAxis: (elapsed: number) => number | undefined;
  toElapsed: (value: number) => number | undefined;
  /** Told where the plot's area is, so the lap ruler above stands on the same x. */
  onPlotRect?: (rect: PlotRect) => void;
  children: ReactNode;
}

/**
 * A plot with the link drawn over it. The chart library draws the lines and
 * its own tooltip; this stands over it, lets every pointer event through, and
 * adds what the link needs: the cursor set from here and drawn when it is set
 * elsewhere, a drag that selects, and the selection's two edges to pull.
 */
export function LinkedPlotStage({ link, domain, toAxis, toElapsed, onPlotRect, children }: PlotStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<PlotRect | null>(null);
  const rectRef = useRef<PlotRect | null>(null);
  const onPlotRectRef = useRef(onPlotRect);
  onPlotRectRef.current = onPlotRect;

  const remeasure = useCallback(() => {
    const stage = stageRef.current;
    const next = stage ? measurePlot(stage) : null;
    if (next && !sameRect(next, rectRef.current)) {
      rectRef.current = next;
      setRect(next);
      onPlotRectRef.current?.(next);
    }
  }, []);

  // After every render: an axis gained or let go moves the plot's edges.
  useLayoutEffect(remeasure);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    // The chart lays itself out a frame after its box is known.
    const observer = new ResizeObserver(() => window.requestAnimationFrame(remeasure));
    observer.observe(stage);
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(remeasure));
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [remeasure]);

  const geometry = useRef({ domain, toAxis, toElapsed });
  geometry.current = { domain, toAxis, toElapsed };

  /** The pointer as a moment, and whether it is over the plot's own area. */
  const locate = (event: { clientX: number; clientY: number }) => {
    const stage = stageRef.current;
    const plot = rectRef.current;
    if (!stage || !plot) {
      return null;
    }
    const box = stage.getBoundingClientRect();
    const x = event.clientX - box.left - plot.left;
    const y = event.clientY - box.top - plot.top;
    const [low, high] = geometry.current.domain;
    const share = Math.min(1, Math.max(0, x / plot.width));
    const elapsed = geometry.current.toElapsed(low + (high - low) * share);
    if (elapsed === undefined) {
      return null;
    }
    const lowElapsed = geometry.current.toElapsed(low) ?? 0;
    const highElapsed = geometry.current.toElapsed(high) ?? lowElapsed;
    return {
      elapsed,
      x: event.clientX,
      inside: x >= 0 && x <= plot.width && y >= 0 && y <= plot.height,
      /** `SNAP_PX` in seconds, at this plot's scale. */
      snap: ((highElapsed - lowElapsed) / plot.width) * SNAP_PX
    };
  };

  const drag = useRef<
    | { kind: "new"; anchor: number; x: number; moved: boolean }
    | { kind: "edge"; edge: "from" | "to" }
    | null
  >(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const at = locate(event);
    if (!at) {
      return;
    }
    const edge = (event.target as HTMLElement).dataset.edge;
    if (edge === "from" || edge === "to") {
      drag.current = { kind: "edge", edge };
    } else if (at.inside) {
      drag.current = {
        kind: "new",
        anchor: snapToLaps(link.laps(), at.elapsed, at.snap),
        x: at.x,
        moved: false
      };
    } else {
      return;
    }
    try {
      // So a drag that leaves the plot is still this plot's.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured still drags while it stays over the plot.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const at = locate(event);
    if (!at) {
      return;
    }
    const held = drag.current;
    if (!held) {
      link.setCursor(at.inside ? at.elapsed : null, "chart");
      return;
    }
    const moment = snapToLaps(link.laps(), at.elapsed, at.snap);
    if (held.kind === "new") {
      if (!held.moved && Math.abs(at.x - held.x) < DRAG_PX) {
        return;
      }
      held.moved = true;
      const from = Math.min(held.anchor, moment);
      const to = Math.max(held.anchor, moment);
      if (to - from >= MIN_SELECTION_SECONDS) {
        link.setSelection({ from, to });
      }
    } else {
      const selection = link.getState().selection;
      if (selection) {
        link.setSelection(
          held.edge === "from"
            ? { from: Math.min(moment, selection.to - MIN_SELECTION_SECONDS), to: selection.to }
            : { from: selection.from, to: Math.max(moment, selection.from + MIN_SELECTION_SECONDS) }
        );
      }
    }
    link.setCursor(at.elapsed, "chart");
  };

  const endDrag = () => {
    const held = drag.current;
    drag.current = null;
    // A press that went nowhere, on the open plot, lets the selection go.
    if (held?.kind === "new" && !held.moved) {
      link.setSelection(null);
    }
  };

  return (
    <div
      ref={stageRef}
      className="activity-chart-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        if (!drag.current) {
          link.setCursor(null);
        }
      }}
      onDoubleClick={(event) => {
        const at = locate(event);
        const lap = at?.inside ? lapAt(link.laps(), at.elapsed) : undefined;
        if (lap) {
          link.selectLap(lap.index);
        }
      }}
    >
      {children}
      {rect ? <PlotLinkLayer link={link} rect={rect} domain={domain} toAxis={toAxis} /> : null}
    </div>
  );
}

function PlotLinkLayer({
  link,
  rect,
  domain,
  toAxis
}: {
  link: ActivityLink;
  rect: PlotRect;
  domain: readonly [number, number];
  toAxis: (elapsed: number) => number | undefined;
}) {
  const selection = useLinkValue(link, (state) => state.selection);
  const preview = useLinkValue(link, (state) => state.preview);
  // Drawn only when another view set it: the chart draws its own under the pointer.
  const cursor = useLinkValue(link, (state) => (state.cursorSource === "chart" ? null : state.cursor));

  const [low, high] = domain;
  const span = high - low;
  /** A moment as pixels from the plot's left edge; may fall outside it. */
  const px = (elapsed: number) => {
    const value = toAxis(elapsed);
    return value === undefined || span <= 0 ? undefined : ((value - low) / span) * rect.width;
  };
  const band = (stretch: LinkSpan | null) => {
    if (!stretch) {
      return null;
    }
    const from = px(stretch.from);
    const to = px(stretch.to);
    if (from === undefined || to === undefined || to <= 0 || from >= rect.width) {
      return null;
    }
    const left = Math.max(0, from);
    return {
      style: { left, width: Math.min(rect.width, to) - left } as CSSProperties,
      // An edge cut off by the zoom is not one to pull.
      fromShown: from >= 0,
      toShown: to <= rect.width
    };
  };

  const selected = band(selection);
  const previewed = sameSpan(preview, selection) ? null : band(preview);
  const cursorAt = cursor === null ? undefined : px(cursor);

  return (
    <div
      className="activity-chart-link"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {previewed ? <div className="activity-chart-band is-preview" style={previewed.style} /> : null}
      {selected ? (
        <div className="activity-chart-band is-selected" style={selected.style}>
          {selected.fromShown ? <span className="activity-chart-band-edge is-from" data-edge="from" /> : null}
          {selected.toShown ? <span className="activity-chart-band-edge is-to" data-edge="to" /> : null}
        </div>
      ) : null}
      {cursorAt !== undefined && cursorAt >= 0 && cursorAt <= rect.width ? (
        <div className="activity-chart-cursor" style={{ left: cursorAt }} />
      ) : null}
    </div>
  );
}

/** A lap ruler is for a session of a few laps; a hundred auto-laps would be a row of slivers. */
export const LAP_RULER_MOST = 60;

interface LapRulerProps {
  link: ActivityLink;
  /** Where the plot under it runs, so a lap stands over its own stretch of the lines. */
  rect: PlotRect;
  domain: readonly [number, number];
  toAxis: (elapsed: number) => number | undefined;
  /** By lap position: the part of the workout, and whether it is a recovery. */
  sections: readonly (ActivityLapSection | undefined)[];
  recoveries: readonly boolean[];
}

/**
 * The laps as a strip above the chart, each over its own stretch: the parts of
 * a structured workout named above them, recoveries faint, and every lap a
 * button that shows and selects it like its row in the table below.
 */
export function LapRuler({ link, rect, domain, toAxis, sections, recoveries }: LapRulerProps) {
  useI18n();
  const laps = link.laps();
  const [low, high] = domain;
  const span = high - low;
  if (span <= 0) {
    return null;
  }
  /** A stretch as a share of the ruler, clipped to it; null when it is off the zoom. */
  const place = (stretch: LinkSpan) => {
    const from = toAxis(stretch.from);
    const to = toAxis(stretch.to);
    if (from === undefined || to === undefined) {
      return null;
    }
    const left = Math.max(0, (from - low) / span);
    const right = Math.min(1, (to - low) / span);
    return left < right ? { left, width: right - left } : null;
  };

  // The parts, each over the laps it holds.
  const parts: { section: ActivityLapSection; stretch: LinkSpan }[] = [];
  laps.forEach((lap, position) => {
    const section = sections[position];
    if (!section) {
      return;
    }
    const last = parts[parts.length - 1];
    if (last && last.section === section && sections[position - 1] === section) {
      last.stretch.to = lap.to;
    } else {
      parts.push({ section, stretch: { from: lap.from, to: lap.to } });
    }
  });

  return (
    <div className="activity-lap-ruler" style={{ marginLeft: rect.left, width: rect.width }}>
      {parts.length > 0 ? (
        <div className="activity-lap-ruler-parts" aria-hidden="true">
          {parts.map((part) => {
            const at = place(part.stretch);
            return at ? (
              <span
                key={`${part.section}-${part.stretch.from}`}
                style={{ left: `${at.left * 100}%`, width: `${at.width * 100}%` }}
              >
                {lapSectionLabel(part.section)}
              </span>
            ) : null;
          })}
        </div>
      ) : null}
      <div className="activity-lap-ruler-track" role="group" aria-label={t("activity.m.laps")}>
        {laps.map((lap, position) => {
          const at = place(lap);
          return at ? (
            <LapRulerBlock
              key={lap.index}
              link={link}
              lap={lap}
              recovery={recoveries[position] ?? false}
              style={{ left: `${at.left * 100}%`, width: `${at.width * 100}%` }}
              // The number is written only where the block is wide enough to hold it.
              numbered={at.width * rect.width >= 18}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

function LapRulerBlock({
  link,
  lap,
  recovery,
  style,
  numbered
}: {
  link: ActivityLink;
  lap: LapSpan;
  recovery: boolean;
  style: CSSProperties;
  numbered: boolean;
}) {
  const { flags } = useLapFlags(link, lap.index);
  return (
    <button
      type="button"
      className={["activity-lap-ruler-block", recovery ? "is-recovery" : "", flags].filter(Boolean).join(" ")}
      style={style}
      aria-pressed={flags.includes("is-lap-selected")}
      aria-label={t("activity.chart.selection.lap", { n: lap.index })}
      onClick={(event) => link.selectLap(lap.index, event.shiftKey)}
      {...lapHandlers(link, lap)}
    >
      {numbered ? lap.index : null}
    </button>
  );
}
