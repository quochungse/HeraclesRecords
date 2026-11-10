/**
 * Figures that move when the athlete changes what they show.
 *
 * Only a change made with a control on the screen being looked at moves
 * anything: a period, a filter, a measure. A figure that changes because data
 * arrived, a sync landed, or a setting was changed on another screen (units,
 * Strength's load) just changes — there was nobody watching it, and a number
 * counting up on its own reads as one still loading.
 *
 * So a control says "this was me" before it changes anything
 * (`markFigureMotion`, which `OptionGroup` and `OptionChips` call when given a
 * `motion`), and a figure or chart that changes within `INTENT_WINDOW_MS` of
 * that moves. The kind of change picks the motion:
 *   - `roll`: the same measure over other data (a period, a filter). Digits
 *     roll up when the figure grows and down when it shrinks; digits that did
 *     not change stand still. A time axis zooms.
 *   - `slide`: another measure (time → distance). Counting from 517 km to 62 h
 *     would join two figures that have nothing to do with each other, so the
 *     old figure slides out and the new one in, from the side of the option
 *     pressed. Bars change height where they stand.
 *
 * Node-free: `npm run test:figure-motion` reads it with strip-types.
 */

export type FigureMotionKind = "roll" | "slide";

export interface FigureMotionIntent {
  kind: FigureMotionKind;
  /** 1 when the option pressed lies after the one it replaced, -1 before. */
  direction: 1 | -1;
  at: number;
}

/**
 * Lengths in milliseconds. `slide` is `--dur-slow` and `fade` `--dur-fast`;
 * `roll` is a designed length, long enough to read which way the digits went.
 */
export const FIGURE_MOTION_MS = { roll: 480, slide: 320, fade: 140 } as const;

/**
 * Each changing digit leaves a moment after the one to its right, as a
 * counter's wheels do — counted over the digits that change and capped, so a
 * long figure ("2,129 tonnes") does not trail its left end a fifth of a second.
 */
export const DIGIT_STAGGER_MS = 16;
export const DIGIT_STAGGER_STEPS = 4;

/** How long a figure takes to move, its stagger included: what a later change can still join. */
export function figureMotionLength(kind: FigureMotionKind | "fade"): number {
  return kind === "roll" ? FIGURE_MOTION_MS.roll + DIGIT_STAGGER_MS * DIGIT_STAGGER_STEPS : FIGURE_MOTION_MS[kind];
}

/**
 * `--ease`, for Web Animations and Recharts, which cannot read a custom
 * property. Written without spaces: that is the form Recharts' parser takes.
 */
export const FIGURE_MOTION_EASING = "cubic-bezier(0.2,0.8,0.2,1)" as const;

/**
 * How long after a press a change still counts as its answer: the click, the
 * state, the render and the commit, on a slow machine, with room to spare.
 */
export const INTENT_WINDOW_MS = 700;

let intent: FigureMotionIntent | null = null;

const clock = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export function markFigureMotion(kind: FigureMotionKind, direction: number = 1, now: number = clock()): void {
  intent = { kind, direction: direction < 0 ? -1 : 1, at: now };
}

/** The press a change answers, or null when nothing was pressed just now. */
export function freshFigureMotion(now: number = clock()): FigureMotionIntent | null {
  return intent !== null && now - intent.at >= 0 && now - intent.at <= INTENT_WINDOW_MS ? intent : null;
}

export function clearFigureMotion(): void {
  intent = null;
}

/**
 * How long a press waits for an answer read from the main process — Strength
 * reads the new window's sessions there. Past it the answer just appears.
 */
export const ANSWER_WINDOW_MS = 3000;

/**
 * The answer to a press landed: mark the press again, so the render it causes
 * moves. A screen that reads asynchronously keeps the press it was asked with
 * (`freshFigureMotion()` when the read starts) and calls this before setting
 * what came back.
 */
export function answerFigureMotion(press: FigureMotionIntent | null, now: number = clock()): void {
  if (press !== null && now - press.at >= 0 && now - press.at <= ANSWER_WINDOW_MS) {
    markFigureMotion(press.kind, press.direction, now);
  }
}

/** Which way a choice moved along a row of options. */
export function optionDirection(values: readonly string[], from: string, to: string): 1 | -1 {
  return values.indexOf(to) < values.indexOf(from) ? -1 : 1;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** One character's place in a roll. */
export type RollCell =
  | { kind: "same"; char: string }
  | { kind: "roll"; from: string; to: string }
  | { kind: "in"; to: string }
  | { kind: "out"; from: string };

/**
 * The characters of two figures lined up as a counter's wheels are.
 *
 * When the same words and units sit around the numbers — "40h 8m" →
 * "168h 47m" — they keep their places and each number lines up at its own
 * right edge; aligned at the figure's edge, the "h" and the space would roll
 * through the digits' places. Otherwise the figures line up at their right
 * edge, where the units and decimals are: "533.7 km" → "2,192.0 km" keeps
 * " km" and the point, rolls four digits and brings in "2,".
 */
export function rollCells(from: string, to: string): RollCell[] {
  const runsFrom = from.match(/\d+|\D+/g) ?? [];
  const runsTo = to.match(/\d+|\D+/g) ?? [];
  const isNumber = (run: string) => /^\d/.test(run);
  if (
    runsFrom.length > 1 &&
    runsFrom.length === runsTo.length &&
    runsFrom.every((run, index) => (isNumber(run) ? isNumber(runsTo[index]!) : run === runsTo[index]))
  ) {
    return runsFrom.flatMap((run, index) =>
      isNumber(run)
        ? alignRight(run, runsTo[index]!)
        : Array.from(run).map((char): RollCell => ({ kind: "same", char }))
    );
  }
  return alignRight(from, to);
}

function alignRight(from: string, to: string): RollCell[] {
  const a = Array.from(from);
  const b = Array.from(to);
  // Words before the number stay put: "over 4 weeks" → "over 13 weeks" rolls
  // the number, not the letters. Never a digit, or "12" → "125" would keep "12".
  let lead = 0;
  while (lead < a.length && lead < b.length && a[lead] === b[lead] && !/\d/.test(a[lead]!)) lead += 1;
  if (lead > 0) {
    return [
      ...b.slice(0, lead).map((char): RollCell => ({ kind: "same", char })),
      ...rollCells(a.slice(lead).join(""), b.slice(lead).join(""))
    ];
  }
  const cells: RollCell[] = [];
  for (let back = 1; back <= Math.max(a.length, b.length); back += 1) {
    const was = a[a.length - back];
    const now = b[b.length - back];
    if (was !== undefined && now !== undefined) {
      cells.push(was === now ? { kind: "same", char: now } : { kind: "roll", from: was, to: now });
    } else if (now !== undefined) {
      cells.push({ kind: "in", to: now });
    } else if (was !== undefined) {
      cells.push({ kind: "out", from: was });
    }
  }
  return cells.reverse();
}

/**
 * Whether a figure grew (1) or shrank (-1): the values when the caller has
 * them, else the digits read in order — "1h 46m" → "2h 28m" grows, as does
 * "65:27:59" → "270:51:25". Figures written to a fixed number of decimals,
 * which the screens' are, compare that way without knowing the locale's
 * separators.
 */
export function figureTrend(fromText: string, toText: string, fromValue?: number, toValue?: number): 1 | -1 {
  if (fromValue !== undefined && toValue !== undefined && Number.isFinite(fromValue) && Number.isFinite(toValue) && fromValue !== toValue) {
    return toValue > fromValue ? 1 : -1;
  }
  const a = fromText.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const b = toText.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (a.length !== b.length) return b.length > a.length ? 1 : -1;
  return b < a ? -1 : 1;
}
