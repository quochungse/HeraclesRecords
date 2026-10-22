/**
 * What this app reads off the body artwork in `bodyShapes.ts`, kept out of
 * the components that draw it so a suite can reach it: which shapes stand for
 * which muscle, which side of the body a muscle is read on, and how far a
 * picture has to zoom for a body part to fill it.
 *
 * Node-free and React-free: the exercise picker's glyphs, the Exercises
 * Library's body filter and its reader all draw from here.
 */
import type { MuscleId } from "../strength/muscles";
import { BODY_SHAPES, BODY_VIEW_BOX, type BodyView } from "./bodyShapes";

/**
 * This app's sixteen muscles against the artwork's own slugs.
 *
 * It is not one-to-one by name: the package calls the lats "upper-back" and
 * the hamstrings "hamstring", and it has no separate shape for the traps on
 * the front. A muscle with no slug at all would simply draw the bare figure,
 * which is why the map is exhaustive rather than partial.
 *
 * The artwork has no abductor of its own — gluteus medius sits under the
 * gluteal shape — so the abductors are drawn on the glutes' shape.
 */
export const MUSCLE_SLUG: Readonly<Record<MuscleId, string>> = {
  neck: "neck",
  traps: "trapezius",
  shoulders: "deltoids",
  chest: "chest",
  lats: "upper-back",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearm",
  abs: "abs",
  obliques: "obliques",
  lowerBack: "lower-back",
  glutes: "gluteal",
  quads: "quadriceps",
  hamstrings: "hamstring",
  adductors: "adductors",
  abductors: "gluteal",
  calves: "calves"
};

/**
 * Every muscle each of the artwork's slugs is drawn for, the one it is named
 * after first: the gluteal shape is the glutes' and the abductors'.
 */
export const SLUG_MUSCLES: Readonly<Record<string, readonly MuscleId[]>> = (() => {
  const bySlug: Record<string, MuscleId[]> = {};
  for (const [muscle, slug] of Object.entries(MUSCLE_SLUG) as [MuscleId, string][]) {
    (bySlug[slug] ??= []).push(muscle);
  }
  return bySlug;
})();

/** The muscle each of the artwork's slugs stands for. */
export const SLUG_MUSCLE: Readonly<Record<string, MuscleId>> = Object.fromEntries(
  Object.entries(SLUG_MUSCLES).map(([slug, muscles]) => [slug, muscles[0]!])
);

/**
 * The side of the body each muscle is drawn on.
 *
 * **Stated, not counted.** The artwork carries a sliver for most muscles on
 * both views — there is a triceps edge on the front figure and a trapezius
 * edge on it too — so choosing the view by "which one has a shape for this"
 * put the triceps on a chest and the traps on a pair of shoulders, both of
 * them a few pixels of green where the muscle is barely visible. A triceps is
 * a back muscle; that is a fact about anatomy, not about the path data.
 */
export const MUSCLE_VIEW: Readonly<Record<MuscleId, BodyView>> = {
  neck: "front",
  traps: "back",
  shoulders: "front",
  chest: "front",
  lats: "back",
  biceps: "front",
  triceps: "back",
  forearms: "front",
  abs: "front",
  obliques: "front",
  lowerBack: "back",
  glutes: "back",
  quads: "front",
  hamstrings: "back",
  adductors: "front",
  abductors: "back",
  calves: "back"
};

/** The slugs of these muscles the artwork can actually draw on a given view. */
export function drawableOn(view: BodyView, muscles: readonly MuscleId[]): string[] {
  const shapes = BODY_SHAPES[view];
  return muscles
    .map((muscle) => MUSCLE_SLUG[muscle])
    .filter((slug, index, all) => all.indexOf(slug) === index && Boolean(shapes[slug]));
}

/**
 * The muscles vote with the side they belong to, and the front wins a tie —
 * it is the figure a reader expects when nothing argues otherwise. So Back and
 * Legs draw the back, Arms and Core the front.
 */
export function chooseView(muscles: readonly MuscleId[]): BodyView {
  let back = 0;
  for (const muscle of muscles) {
    if (MUSCLE_VIEW[muscle] === "back") back += 1;
  }
  return back > muscles.length - back ? "back" : "front";
}

/** Every side a set of muscles is read on, front first. */
export function viewsOf(muscles: readonly MuscleId[]): BodyView[] {
  const sides = new Set(muscles.map((muscle) => MUSCLE_VIEW[muscle]));
  return (["front", "back"] as const).filter((view) => sides.has(view));
}

/** [minX, minY, maxX, maxY] in the artwork's own coordinates. */
export type Bounds = readonly [number, number, number, number];

const ARGUMENTS: Readonly<Record<string, number>> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0
};
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/**
 * The box an SVG path's points and control points lie in.
 *
 * Control points can stand a little outside a curve, so the box can be a
 * little loose; it is only ever padded and framed, never drawn. Arcs are
 * taken at their end points — the artwork's arcs are a few units across.
 * The one subtlety is the arc's two flags, which the artwork writes run
 * together with the next number (`a.71.71 0 011.2-.3`), so they are read a
 * character at a time.
 */
export function pathBounds(d: string): Bounds {
  let index = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = "M";
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (px: number, py: number) => {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  const skip = () => {
    while (index < d.length && /[\s,]/.test(d[index]!)) index += 1;
  };
  const number = (): number => {
    skip();
    NUMBER.lastIndex = index;
    const match = NUMBER.exec(d);
    if (!match) throw new Error(`pathBounds: no number at ${index}`); // i18n-ignore: a malformed artwork path, for the log
    index = NUMBER.lastIndex;
    return Number(match[0]);
  };

  for (;;) {
    skip();
    if (index >= d.length) break;
    if (/[a-zA-Z]/.test(d[index]!)) {
      command = d[index]!;
      index += 1;
    }
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === "Z") {
      x = startX;
      y = startY;
      continue;
    }
    const count = ARGUMENTS[upper];
    if (count === undefined) throw new Error(`pathBounds: unknown command ${command}`); // i18n-ignore: a malformed artwork path, for the log
    const values: number[] = [];
    for (let argument = 0; argument < count; argument += 1) {
      if (upper === "A" && (argument === 3 || argument === 4)) {
        skip();
        values.push(Number(d[index]));
        index += 1;
      } else {
        values.push(number());
      }
    }
    if (upper === "H") {
      x = relative ? x + values[0]! : values[0]!;
    } else if (upper === "V") {
      y = relative ? y + values[0]! : values[0]!;
    } else if (upper === "A") {
      x = relative ? x + values[5]! : values[5]!;
      y = relative ? y + values[6]! : values[6]!;
    } else {
      let lastX = x;
      let lastY = y;
      for (let pair = 0; pair < values.length; pair += 2) {
        lastX = relative ? x + values[pair]! : values[pair]!;
        lastY = relative ? y + values[pair + 1]! : values[pair + 1]!;
        take(lastX, lastY);
      }
      x = lastX;
      y = lastY;
    }
    take(x, y);
    if (upper === "M") {
      startX = x;
      startY = y;
      command = relative ? "l" : "L";
    }
  }
  return [minX, minY, maxX, maxY];
}

function union(boxes: readonly Bounds[]): Bounds | null {
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3]))
  ];
}

const boundsCache = new Map<string, Bounds | null>();

/** The box a muscle's shapes fill on one view, or null where it has none. */
export function muscleBounds(view: BodyView, muscle: MuscleId): Bounds | null {
  const key = `${view}:${muscle}`;
  if (boundsCache.has(key)) return boundsCache.get(key)!;
  const shapes = BODY_SHAPES[view][MUSCLE_SLUG[muscle]] ?? [];
  const bounds = union(shapes.map(pathBounds));
  boundsCache.set(key, bounds);
  return bounds;
}

/** Room left around a zoomed group, in the artwork's units (the figure is 1448 tall). */
const ZOOM_PADDING = 34;

/**
 * The view box that frames a group of muscles on one side of the body, at
 * the aspect of the box it is drawn in.
 *
 * `oneSide` frames the figure's left half only, for a group that sits out on
 * both sides with nothing between — the arms: the box around both reaches
 * across the whole wingspan, and an arm read that way is as small as it was
 * before the zoom. Null when the view has none of the muscles, which a caller
 * reads as "draw the whole figure".
 */
export function zoomViewBox(
  view: BodyView,
  muscles: readonly MuscleId[],
  width: number,
  height: number,
  oneSide = false
): string | null {
  const boxes = muscles.flatMap((muscle) => {
    const bounds = muscleBounds(view, muscle);
    return bounds ? [bounds] : [];
  });
  const found = union(boxes);
  if (!found) return null;
  const [viewX, , viewWidth] = BODY_VIEW_BOX[view].split(" ").map(Number) as [number, number, number, number];
  const middle = viewX + viewWidth / 2;
  let [minX, minY, maxX, maxY] = found;
  if (oneSide) maxX = Math.min(maxX, middle - ZOOM_PADDING);
  minX -= ZOOM_PADDING;
  minY -= ZOOM_PADDING;
  maxX += ZOOM_PADDING;
  maxY += ZOOM_PADDING;
  let boxWidth = maxX - minX;
  let boxHeight = maxY - minY;
  const aspect = width / height;
  if (boxWidth / boxHeight < aspect) {
    const wider = boxHeight * aspect;
    minX -= (wider - boxWidth) / 2;
    boxWidth = wider;
  } else {
    const taller = boxWidth / aspect;
    minY -= (taller - boxHeight) / 2;
    boxHeight = taller;
  }
  return [minX, minY, boxWidth, boxHeight].map((value) => Math.round(value)).join(" ");
}
