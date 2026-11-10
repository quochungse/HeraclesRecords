import L from "leaflet";
import type { TrainingHubActivityPause } from "../../../electron/types";
import { activeElapsed } from "../../../electron/activityMetrics";
import { MIN_SELECTION_SECONDS, lapAt, sameSpan, type ActivityLink, type LinkSpan } from "../activityLink";
import type { RouteReplay } from "./routeReplay";

/*
 * A route map's side of the link (`activityLink.ts`): the cursor as a dot on
 * the route, the selection and a previewed lap as stretches of it, and the
 * pointer on the route setting all three — over it the cursor follows, a press
 * selects the lap there, a drag along it selects what it passes.
 */

/** Above the route's lines, below the start and finish. */
const LINK_PANE = "heraclesRouteLink";
/** Above the start and finish: the cursor is what the eye is following. */
const CURSOR_PANE = "heraclesRouteCursor";

/** How near the route, in pixels, the pointer takes it. */
const REACH_PX = 14;
/** How far the pointer travels before a press is a drag. */
const DRAG_PX = 4;

export interface RouteLinkStyle {
  routeColor: string;
  lightGround: boolean;
}

/**
 * How the route under the link is coloured: runs of one colour each between
 * point indices (a route coloured by pace, heart rate or height), `"glow"` for
 * the heatmap's canvas, or nothing for the plain line.
 */
export type RouteLinkColours = readonly { from: number; to: number; color: string }[] | "glow" | null;

export interface RouteLinkBinding {
  restyle: (style: RouteLinkStyle) => void;
  /** The route was drawn again in other colours: the stretch takes them. */
  recolour: () => void;
  remove: () => void;
}

/**
 * Each located point's moment on the link's clock, or null when the route
 * carries no clock (a track merged from two sources): such a map is not tied.
 * The route is stamped by the wall clock; `pauses` are what the page took out
 * of the chart's.
 */
export function routeMoments(
  route: RouteReplay,
  pauses: readonly TrainingHubActivityPause[] | undefined
): number[] | null {
  const ordered = (pauses ?? [])
    .filter((pause) => pause.start >= 0 && pause.duration > 0)
    .sort((left, right) => left.start - right.start);
  const moments: number[] = [];
  for (const point of route.points) {
    if (point.elapsed === undefined) {
      return null;
    }
    const moment = activeElapsed(point.elapsed, ordered);
    // Never backwards: a moment is looked up by bisection.
    moments.push(moments.length > 0 ? Math.max(moments[moments.length - 1]!, moment) : moment);
  }
  return moments.length > 1 ? moments : null;
}

/** Where a moment is along the route: the point before it and how far towards the next. */
export function routePosition(moments: readonly number[], elapsed: number): { index: number; fraction: number } {
  const last = moments.length - 1;
  if (elapsed <= moments[0]!) {
    return { index: 0, fraction: 0 };
  }
  if (elapsed >= moments[last]!) {
    return { index: last, fraction: 0 };
  }
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (moments[mid]! <= elapsed) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const span = moments[high]! - moments[low]!;
  return { index: low, fraction: span > 0 ? (elapsed - moments[low]!) / span : 0 };
}

export function bindRouteLink(
  map: L.Map,
  route: RouteReplay,
  link: ActivityLink,
  pauses: readonly TrainingHubActivityPause[] | undefined,
  initialStyle: RouteLinkStyle,
  /** Told the selected stretch's two ends, or null once it is let go. */
  onStretchEnds?: (ends: { start: [number, number]; end: [number, number] } | null) => void,
  /** What the route is coloured by now, asked each time the stretch is drawn. */
  colours?: () => RouteLinkColours
): RouteLinkBinding | null {
  const moments = routeMoments(route, pauses);
  if (!moments) {
    return null;
  }
  const { latLngs } = route;
  const container = map.getContainer();
  if (!map.getPane(LINK_PANE)) {
    map.createPane(LINK_PANE).style.zIndex = "440";
  }
  if (!map.getPane(CURSOR_PANE)) {
    map.createPane(CURSOR_PANE).style.zIndex = "460";
  }

  const spot = (elapsed: number): [number, number] => {
    const { index, fraction } = routePosition(moments, elapsed);
    const from = latLngs[index]!;
    const next = latLngs[index + 1];
    return next && fraction > 0
      ? [from[0] + (next[0] - from[0]) * fraction, from[1] + (next[1] - from[1]) * fraction]
      : from;
  };
  /** The spot at a position along the points: 12.5 is half way from the thirteenth to the next. */
  const spotAt = (position: number): [number, number] => {
    const index = Math.min(latLngs.length - 1, Math.max(0, Math.floor(position)));
    const fraction = position - index;
    const from = latLngs[index]!;
    const next = latLngs[index + 1];
    return next && fraction > 0
      ? [from[0] + (next[0] - from[0]) * fraction, from[1] + (next[1] - from[1]) * fraction]
      : from;
  };
  /** The route between two positions. */
  const between = (from: number, to: number): [number, number][] =>
    to > from
      ? [spotAt(from), ...latLngs.slice(Math.floor(from) + 1, Math.ceil(to)), spotAt(to)]
      : [];
  const positionOf = (elapsed: number) => {
    const { index, fraction } = routePosition(moments, elapsed);
    return index + fraction;
  };
  const stretch = (span: LinkSpan | null): [number, number][] =>
    span ? between(positionOf(span.from), positionOf(span.to)) : [];

  let style = initialStyle;
  const casingColor = () => (style.lightGround ? "#ffffff" : "#05080b");
  const brightColor = () => (style.lightGround ? "#0a5c44" : "#c2f7d4");
  const line = (options: L.PolylineOptions) =>
    L.polyline([], {
      pane: LINK_PANE,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
      ...options
    }).addTo(map);
  const previewLine = line({ color: style.routeColor, weight: 8, opacity: 0.55 });
  // The route outside a selected stretch steps back under a veil in the
  // ground's colour, so what is left showing is the stretch as the route is
  // drawn: in its pace, its heart rate, its heat. Dimming the route's own
  // panes dimmed the stretch with them, and a line of one colour laid over it
  // hid the colours the athlete had asked for.
  const veilBefore = line({ color: casingColor(), weight: 13, opacity: 0.68 });
  const veilAfter = line({ color: casingColor(), weight: 13, opacity: 0.68 });
  // On the plain route the stretch is also lifted: a casing and a brighter line.
  const casing = line({ color: casingColor(), weight: 9, opacity: 1 });
  const selected = line({ color: brightColor(), weight: 5, opacity: 1 });
  // On a coloured route it is drawn again over the veil, run by run, so a pass
  // the veil crosses — out and back on one road — still shows its colours.
  const runs = L.layerGroup().addTo(map);
  const cursor = L.marker(latLngs[0]!, {
    pane: CURSOR_PANE,
    icon: L.divIcon({
      className: "activity-route-cursor",
      html: "<span></span>",
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    }),
    interactive: false,
    keyboard: false
  });

  const drawStretch = (selection: LinkSpan | null) => {
    const how = colours?.() ?? null;
    runs.clearLayers();
    if (!selection) {
      for (const layer of [veilBefore, veilAfter, casing, selected]) {
        layer.setLatLngs([]);
      }
      return;
    }
    const from = positionOf(selection.from);
    const to = positionOf(selection.to);
    veilBefore.setLatLngs(between(0, from));
    veilAfter.setLatLngs(between(to, latLngs.length - 1));
    const plain = how === null;
    casing.setLatLngs(plain ? between(from, to) : []);
    selected.setLatLngs(plain ? between(from, to) : []);
    if (Array.isArray(how)) {
      for (const run of how) {
        const start = Math.max(run.from, from);
        const end = Math.min(run.to, to);
        if (end > start) {
          L.polyline(between(start, end), {
            pane: LINK_PANE,
            color: run.color,
            weight: 5,
            opacity: 1,
            lineCap: "round",
            lineJoin: "round",
            interactive: false
          }).addTo(runs);
        }
      }
    }
  };

  let drawn: { selection: LinkSpan | null; preview: LinkSpan | null } = { selection: null, preview: null };
  const draw = () => {
    const { selection, preview, cursor: at } = link.getState();
    if (!sameSpan(selection, drawn.selection)) {
      drawStretch(selection);
      onStretchEnds?.(selection ? { start: spot(selection.from), end: spot(selection.to) } : null);
    }
    const shownPreview = sameSpan(preview, selection) ? null : preview;
    if (!sameSpan(shownPreview, drawn.preview)) {
      previewLine.setLatLngs(stretch(shownPreview));
    }
    drawn = { selection, preview: shownPreview };
    if (at === null) {
      cursor.remove();
    } else {
      cursor.setLatLng(spot(at));
      if (!map.hasLayer(cursor)) {
        cursor.addTo(map);
      }
    }
  };
  const unsubscribe = link.subscribe(draw);
  draw();

  // The route in layer pixels, which a pan leaves alone and a zoom does not.
  let pixels: L.Point[] = [];
  const project = () => {
    pixels = latLngs.map((latLng) => map.latLngToLayerPoint(latLng));
  };
  project();
  map.on("zoomend viewreset", project);

  /**
   * The moment on the route nearest the pointer, within reach. Where the route
   * passes the same spot twice — out and back on one road — the pass nearest
   * the moment already under the cursor wins, so the dot does not jump laps.
   */
  const momentAt = (event: MouseEvent): number | null => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".leaflet-control")) {
      return null;
    }
    const at = map.mouseEventToLayerPoint(event);
    const near: { distance: number; moment: number }[] = [];
    let best = Infinity;
    for (let index = 0; index < pixels.length - 1; index += 1) {
      const a = pixels[index]!;
      const b = pixels[index + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const share = length > 0 ? Math.min(1, Math.max(0, ((at.x - a.x) * dx + (at.y - a.y) * dy) / length)) : 0;
      const distance = Math.hypot(at.x - (a.x + dx * share), at.y - (a.y + dy * share));
      if (distance > REACH_PX) {
        continue;
      }
      best = Math.min(best, distance);
      near.push({ distance, moment: moments[index]! + (moments[index + 1]! - moments[index]!) * share });
    }
    if (near.length === 0) {
      return null;
    }
    const held = link.getState().cursor;
    const candidates = near.filter((entry) => entry.distance <= best + 3);
    candidates.sort((left, right) =>
      held === null ? left.distance - right.distance : Math.abs(left.moment - held) - Math.abs(right.moment - held)
    );
    return candidates[0]!.moment;
  };

  let drag: { anchor: number; x: number; y: number; moved: boolean } | null = null;

  const onMove = (event: MouseEvent) => {
    if (drag) {
      return;
    }
    const moment = momentAt(event);
    container.classList.toggle("is-on-route", moment !== null);
    link.setCursor(moment, "map");
  };
  const onLeave = () => {
    if (!drag) {
      container.classList.remove("is-on-route");
      link.setCursor(null);
    }
  };
  const onDragMove = (event: MouseEvent) => {
    if (!drag) {
      return;
    }
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_PX) {
      return;
    }
    drag.moved = true;
    const moment = momentAt(event);
    if (moment === null) {
      return;
    }
    const from = Math.min(drag.anchor, moment);
    const to = Math.max(drag.anchor, moment);
    if (to - from >= MIN_SELECTION_SECONDS) {
      link.setSelection({ from, to });
    }
    link.setCursor(moment, "map");
  };
  const onDragEnd = () => {
    window.removeEventListener("mousemove", onDragMove, true);
    window.removeEventListener("mouseup", onDragEnd, true);
    const held = drag;
    drag = null;
    if (held && !held.moved) {
      const lap = lapAt(link.laps(), held.anchor);
      if (lap) {
        link.selectLap(lap.index);
      }
    }
  };
  // Captured, and stopped when it lands on the route: the map would otherwise
  // take the same press as the start of a pan.
  const onDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    const moment = momentAt(event);
    if (moment === null) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    drag = { anchor: moment, x: event.clientX, y: event.clientY, moved: false };
    window.addEventListener("mousemove", onDragMove, true);
    window.addEventListener("mouseup", onDragEnd, true);
  };
  container.addEventListener("mousemove", onMove);
  container.addEventListener("mouseleave", onLeave);
  container.addEventListener("mousedown", onDown, true);

  return {
    restyle: (next) => {
      style = next;
      previewLine.setStyle({ color: next.routeColor });
      veilBefore.setStyle({ color: casingColor() });
      veilAfter.setStyle({ color: casingColor() });
      casing.setStyle({ color: casingColor() });
      selected.setStyle({ color: brightColor() });
    },
    recolour: () => drawStretch(link.getState().selection),
    remove: () => {
      unsubscribe();
      onDragEnd();
      map.off("zoomend viewreset", project);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("mousedown", onDown, true);
      container.classList.remove("is-on-route");
      link.setCursor(null);
    }
  };
}
