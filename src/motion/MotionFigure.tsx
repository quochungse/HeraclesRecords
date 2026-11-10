import { useLayoutEffect, useRef } from "react";
import {
  DIGIT_STAGGER_MS,
  DIGIT_STAGGER_STEPS,
  FIGURE_MOTION_EASING,
  FIGURE_MOTION_MS,
  figureMotionLength,
  figureTrend,
  freshFigureMotion,
  prefersReducedMotion,
  rollCells,
  type FigureMotionIntent
} from "./figureMotion";
import "./motion.css";

interface MotionFigureProps {
  /** The figure as the screen writes it, units and marks included: "28.5 km", "≈7.80 km". */
  text: string;
  /** What it measures, when the caller has it: tells a roll which way to turn. */
  value?: number | undefined;
  className?: string;
}

/**
 * A figure that rolls or slides when a control on the screen changes it, and
 * otherwise just changes (`figureMotion.ts` says which and when).
 *
 * React renders the text alone, so the element reads as the figure it shows
 * to every test and screen reader. While it moves, the element holds the new
 * characters in wheels and the old ones only in generated content
 * (`data-was`), so its text is still the new figure; when the motion ends or
 * is cut short it is plain text again. React writes a changed text with
 * `textContent`, which sweeps the wheels away, so a change mid-motion is safe.
 *
 * A change that lands while the figure is still moving joins that motion
 * instead of cutting it and starting over: it goes on from the figure the
 * motion started at to the newest one, as far along as it had got. A screen
 * whose figures settle in two steps (a window, then its last sessions) reads
 * as one movement, not a jerk and a second start.
 */
export function MotionFigure({ text, value, className }: MotionFigureProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<Shown | null>(null);
  const running = useRef<Running | null>(null);
  // Read through a ref: a value that moves under an unchanged text must not
  // cut a motion short, which a dependency on it would.
  const latestValue = useRef(value);
  latestValue.current = value;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const before = shown.current;
    shown.current = { text, value: latestValue.current };
    if (!before || before.text === text) return undefined;
    const now = performance.now();
    const fresh = freshFigureMotion(now);
    // A change joins the motion still running, when it is the same kind of motion.
    const last = running.current;
    running.current = null;
    const joined =
      last !== null && now - last.startedAt < last.length && (fresh === null || fresh.kind === last.intent.kind)
        ? last
        : null;
    const intent = fresh ?? joined?.intent ?? null;
    if (!intent) return undefined;
    const from = joined ? joined.from : before;
    // Back where it started: nothing left to move.
    if (from.text === text) return undefined;
    const reduced = prefersReducedMotion();
    const startedAt = joined ? joined.startedAt : now;
    const motion: Running = { from, intent, startedAt, length: figureMotionLength(reduced ? "fade" : intent.kind) };
    running.current = motion;
    return playFigure(element, {
      before: from,
      text,
      value: latestValue.current,
      intent,
      reduced,
      elapsed: now - startedAt,
      onFinish: () => {
        if (running.current === motion) running.current = null;
      }
    });
  }, [text]);

  return (
    <span ref={ref} className={className ? `motion-figure ${className}` : "motion-figure"}>
      {text}
    </span>
  );
}

interface Shown {
  text: string;
  value: number | undefined;
}

interface Running {
  /** What was on screen when the motion began, which a later change goes on from. */
  from: Shown;
  intent: FigureMotionIntent;
  startedAt: number;
  length: number;
}

interface Play {
  before: Shown;
  text: string;
  value: number | undefined;
  intent: FigureMotionIntent;
  reduced: boolean;
  /** How far along a motion this one continues, in milliseconds. */
  elapsed: number;
  onFinish: () => void;
}

/** Starts the motion on the element as React left it; returns what stops it. */
function playFigure(element: HTMLSpanElement, play: Play): () => void {
  const animations: Animation[] = [];
  const animate = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    if (typeof target.animate !== "function") return;
    animations.push(target.animate(keyframes, options));
  };
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    for (const animation of animations) animation.cancel();
    element.classList.remove("is-moving", "is-rising", "is-falling");
    // Still ours: React has not written a newer figure over it.
    if (element.querySelector(".motion-cell, .motion-slide")) element.textContent = play.text;
  };

  if (play.reduced) {
    animate(element, [{ opacity: 0 }, { opacity: 1 }], { duration: FIGURE_MOTION_MS.fade, easing: FIGURE_MOTION_EASING });
  } else if (play.intent.kind === "slide") {
    slide(element, play, animate);
  } else {
    roll(element, play, animate);
  }

  if (animations.length === 0) {
    play.onFinish();
    return end;
  }
  if (play.elapsed > 0) {
    for (const animation of animations) animation.currentTime = play.elapsed;
  }
  void Promise.all(animations.map((animation) => animation.finished)).then(() => {
    end();
    play.onFinish();
  }, () => undefined);
  return end;
}

type Animate = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;

function roll(element: HTMLSpanElement, play: Play, animate: Animate) {
  const rising = figureTrend(play.before.text, play.text, play.before.value, play.value) > 0;
  const cells = rollCells(play.before.text, play.text);
  const fragment = document.createDocumentFragment();
  const moving: { cell: HTMLSpanElement; wheel: HTMLSpanElement; kind: "roll" | "in" | "out"; fromRight: number }[] = [];
  cells.forEach((cell) => {
    if (cell.kind === "same") {
      fragment.append(cell.char);
      return;
    }
    const box = document.createElement("span");
    box.className = cell.kind === "roll" ? "motion-cell" : `motion-cell is-${cell.kind}`;
    const wheel = document.createElement("span");
    wheel.className = "motion-wheel";
    if (cell.kind !== "in") wheel.dataset.was = cell.from;
    if (cell.kind !== "out") wheel.textContent = cell.to;
    box.append(wheel);
    fragment.append(box);
    moving.push({ cell: box, wheel, kind: cell.kind, fromRight: 0 });
  });
  element.classList.add("is-moving", rising ? "is-rising" : "is-falling");
  element.replaceChildren(fragment);

  const away = rising ? "-100%" : "100%";
  const toward = rising ? "100%" : "-100%";
  // The stagger counts the characters that move, from the right, and stops at
  // a few steps: units and unchanged digits do not hold the left end back.
  moving.forEach((entry, index) => {
    entry.fromRight = Math.min(moving.length - 1 - index, DIGIT_STAGGER_STEPS);
  });
  // Every width read before any motion starts: one layout, not one per character.
  const widths = moving.map(({ cell }) => cell.getBoundingClientRect().width);
  moving.forEach(({ cell, wheel, kind, fromRight }, index) => {
    const timing: KeyframeAnimationOptions = {
      duration: FIGURE_MOTION_MS.roll,
      delay: fromRight * DIGIT_STAGGER_MS,
      easing: FIGURE_MOTION_EASING,
      fill: "both"
    };
    const width = `${widths[index]}px`;
    if (kind === "out") {
      animate(wheel, [{ transform: "translateY(0)" }, { transform: `translateY(${away})` }], timing);
      animate(cell, [{ width }, { width: "0px" }], timing);
      return;
    }
    animate(wheel, [{ transform: `translateY(${toward})` }, { transform: "translateY(0)" }], timing);
    if (kind === "in") animate(cell, [{ width: "0px" }, { width }], timing);
  });
}

function slide(element: HTMLSpanElement, play: Play, animate: Animate) {
  const direction = play.intent.direction;
  const frame = document.createElement("span");
  frame.className = "motion-slide";
  frame.dataset.was = play.before.text;
  const now = document.createElement("span");
  now.className = "motion-slide-now";
  frame.append(now);
  element.classList.add("is-moving");
  element.replaceChildren(frame);
  // The frame's width goes from the old figure's to the new one's, so what
  // follows on the line moves with it. Measured here, the one motion that
  // needs it, rather than on every change of every figure.
  now.textContent = play.before.text;
  const fromWidth = frame.getBoundingClientRect().width;
  now.textContent = play.text;
  const toWidth = frame.getBoundingClientRect().width;

  const timing: KeyframeAnimationOptions = {
    duration: FIGURE_MOTION_MS.slide,
    easing: FIGURE_MOTION_EASING,
    fill: "both"
  };
  const travel = 0.9 * direction;
  animate(now, [
    { opacity: 0, transform: `translateX(${travel}em)` },
    { opacity: 1, transform: "translateX(0)" }
  ], timing);
  animate(frame, [
    { opacity: 1, transform: "translateX(0)" },
    { opacity: 0, transform: `translateX(${-travel}em)` }
  ], { ...timing, pseudoElement: "::before" });
  if (Math.abs(fromWidth - toWidth) > 0.5) {
    animate(frame, [{ width: `${fromWidth}px` }, { width: `${toWidth}px` }], timing);
  }
}
