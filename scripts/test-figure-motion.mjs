/**
 * Figures and chart marks move only when the athlete changes what they show,
 * and the motion follows the kind of change (`src/motion/figureMotion.ts`).
 * What can go wrong without a window to look at:
 *   - a change nobody pressed for moving (the press is stale, or never was);
 *   - a roll lining the two figures up at the wrong edge, or turning the
 *     wrong way;
 *   - a period change on a time axis reshuffling bars instead of zooming, or
 *     a week that one window lacks growing out of the floor;
 *   - the drawing a change ends on missing a mark, or keeping a removed one.
 *
 * Runs under Electron because this machine's Node has no Amaro.
 *
 * Run: npm run test:figure-motion
 */

import assert from "node:assert/strict";

const motion = await import("../src/motion/figureMotion.ts");
const chart = await import("../src/motion/chartMotion.ts");

// --- the press ------------------------------------------------------------

motion.clearFigureMotion();
assert.equal(motion.freshFigureMotion(1000), null, "nothing pressed, nothing moves");

motion.markFigureMotion("slide", -1, 1000);
assert.deepEqual(motion.freshFigureMotion(1200), { kind: "slide", direction: -1, at: 1000 });
assert.equal(
  motion.freshFigureMotion(1000 + motion.INTENT_WINDOW_MS + 1),
  null,
  "a change long after the press is not its answer"
);
assert.equal(motion.freshFigureMotion(900), null, "a clock before the press reads nothing");

motion.markFigureMotion("roll", 0, 5000);
assert.equal(motion.freshFigureMotion(5000).direction, 1, "no direction reads forward");
motion.clearFigureMotion();

// A press whose answer is read elsewhere: marked again when it lands, unless it took too long.
motion.markFigureMotion("roll", -1, 10_000);
const press = motion.freshFigureMotion(10_000);
motion.clearFigureMotion();
motion.answerFigureMotion(press, 10_000 + 1500);
assert.deepEqual(motion.freshFigureMotion(10_000 + 1600), { kind: "roll", direction: -1, at: 11_500 }, "the answer moves");
motion.clearFigureMotion();
motion.answerFigureMotion(press, 10_000 + motion.ANSWER_WINDOW_MS + 1);
assert.equal(motion.freshFigureMotion(10_000 + motion.ANSWER_WINDOW_MS + 2), null, "a late answer just appears");
motion.answerFigureMotion(null, 10_000);
assert.equal(motion.freshFigureMotion(10_000), null, "no press, no answer");

// A long figure's left end waits a few steps at most.
assert.equal(motion.figureMotionLength("roll"), motion.FIGURE_MOTION_MS.roll + motion.DIGIT_STAGGER_MS * motion.DIGIT_STAGGER_STEPS);
assert.equal(motion.figureMotionLength("slide"), motion.FIGURE_MOTION_MS.slide);

assert.equal(motion.optionDirection(["time", "distance", "load"], "time", "load"), 1);
assert.equal(motion.optionDirection(["time", "distance", "load"], "load", "distance"), -1);

// --- the roll's alignment -------------------------------------------------

const cells = motion.rollCells("533.7 km", "2,192.0 km");
assert.equal(
  cells.map((cell) => (cell.kind === "same" ? cell.char : cell.kind === "in" ? `+${cell.to}` : cell.kind === "out" ? `-${cell.from}` : `${cell.from}>${cell.to}`)).join("|"),
  "+2|+,|5>1|3>9|3>2|.|7>0| |k|m",
  "the right edge, where the units and decimals are, lines up"
);
assert.equal(
  motion.rollCells("1,034 km", "517 km").filter((cell) => cell.kind === "out").map((cell) => cell.from).join(""),
  "1,",
  "a shorter figure lets go of its left end"
);
assert.deepEqual(
  motion.rollCells("over 4 weeks", "over 13 weeks").filter((cell) => cell.kind !== "same"),
  [{ kind: "in", to: "1" }, { kind: "roll", from: "4", to: "3" }],
  "words before the number stay put"
);
assert.deepEqual(
  motion.rollCells("12 km", "125 km").filter((cell) => cell.kind !== "same"),
  [{ kind: "in", to: "1" }, { kind: "roll", from: "1", to: "2" }, { kind: "roll", from: "2", to: "5" }],
  "but a number's own digits still line up at the right"
);
assert.deepEqual(
  motion.rollCells("40h 8m", "168h 47m").map((cell) => (cell.kind === "same" ? cell.char : cell.kind === "in" ? `+${cell.to}` : `${cell.from}>${cell.to}`)),
  ["+1", "4>6", "0>8", "h", " ", "+4", "8>7", "m"],
  "units between the numbers keep their places; each number lines up at its own right edge"
);
assert.deepEqual(
  motion.rollCells("433 tonnes", "2,129 tonnes").filter((cell) => cell.kind !== "same").map((cell) => cell.kind),
  ["in", "in", "roll", "roll", "roll"],
  "a separator that appears falls back to the figure's right edge"
);
// Whatever the cells, the new figure reads left to right in them.
for (const [from, to] of [["65:27:59", "270:51:25"], ["—", "28.5 km"], ["7:22 /km", "11:56 /mi"], ["12", ""], ["≈7.80 km", "≈12.4 km"]]) {
  const text = motion
    .rollCells(from, to)
    .map((cell) => (cell.kind === "same" ? cell.char : cell.kind === "out" ? "" : cell.to))
    .join("");
  assert.equal(text, to, `${from} → ${to}`);
}

// --- which way it turns ---------------------------------------------------

assert.equal(motion.figureTrend("517 km", "1,034 km"), 1);
assert.equal(motion.figureTrend("1,034 km", "517 km"), -1);
assert.equal(motion.figureTrend("1h 46m", "2h 28m"), 1);
assert.equal(motion.figureTrend("65:27:59", "270:51:25"), 1);
assert.equal(motion.figureTrend("7:25 /km", "7:22 /km"), -1);
assert.equal(motion.figureTrend("—", "28.5 km"), 1, "a figure appearing grows");
assert.equal(motion.figureTrend("9.6", "12.0", 9.6, 12), 1);
assert.equal(motion.figureTrend("1.234,5", "999,0", 1234.5, 999), -1, "the values outrank the digits");

// Figures whose decimals or parts change with their size, read off the text alone.
for (const [from, to] of [
  ["9.85 km", "12.3 km"],
  ["9h 55m", "10h"],
  ["45h 30m", "120h"],
  ["59m", "1h 2m"],
  ["59:30", "1:02:10"],
  ["999,0", "1.234,5"],
  // Thousands grouped by a narrow no-break space, as fr and ru write them.
  ["12\u202f345", "1\u202f234\u202f567"],
  ["0.95", "1.2"],
  ["4:59 /100 m", "5:02 /100 m"]
]) {
  assert.equal(motion.figureTrend(from, to), 1, `${from} → ${to} grows`);
  assert.equal(motion.figureTrend(to, from), -1, `${to} → ${from} shrinks`);
}
assert.equal(motion.figureTrend("−5%", "−3%"), 1, "below zero, the smaller number is the larger figure");
assert.equal(motion.figureTrend("−3%", "−5%"), -1);
assert.equal(motion.figureTrend("28.5 km", "—"), -1, "a figure giving way to a dash shrinks");

// --- chart marks ----------------------------------------------------------

const bar = (week, x, y, height, width = 10) => ({ x, y, width, height, payload: { weekStartMs: week } });

// Zooming out from weeks 3–4 drawn wide to weeks 1–4 drawn narrow.
const zoomOut = [
  { status: "matched", prev: bar(3, 0, 50, 50, 40), next: bar(3, 50, 60, 40, 20) },
  { status: "matched", prev: bar(4, 50, 20, 80, 40), next: bar(4, 75, 30, 70, 20) },
  { status: "added", next: bar(1, 0, 70, 30, 20) },
  { status: "added", next: bar(2, 25, 40, 60, 20) }
];
const fit = chart.axisFit(zoomOut);
assert.equal(fit.scale, 0.5);
assert.equal(fit.shift, 50);
const start = chart.movingBars(zoomOut, 0);
assert.deepEqual(start.slice(0, 2).map((mark) => [mark.x, mark.width, mark.height]), [[0, 40, 50], [50, 40, 80]], "paired weeks start where they were");
assert.deepEqual(
  start.slice(2).map((mark) => [mark.x, mark.width, mark.height]),
  [[-100, 40, 30], [-50, 40, 60]],
  "an older week comes in from off the left edge at its own height, not out of the floor"
);
const halfway = chart.movingBars(zoomOut, 0.5);
assert.deepEqual([halfway[0].x, halfway[0].width, halfway[0].height], [25, 30, 45]);
assert.deepEqual(chart.movingBars(zoomOut, 1).map((mark) => mark.payload.weekStartMs), [3, 4, 1, 2]);

// Zooming in drops the older weeks off the left.
const zoomIn = [
  { status: "removed", prev: bar(1, 0, 70, 30, 20) },
  { status: "matched", prev: bar(3, 50, 60, 40, 20), next: bar(3, 0, 50, 50, 40) },
  { status: "matched", prev: bar(4, 75, 30, 70, 20), next: bar(4, 50, 20, 80, 40) }
];
const leaving = chart.movingBars(zoomIn, 1 - 1e-9)[0];
assert.ok(leaving.x < -99 && leaving.width > 39, "a dropped week leaves for where it would stand off the edge");
assert.equal(chart.movingBars(zoomIn, 1).length, 2, "and is gone at the end");

// No pair to zoom by: a new series grows out of the floor, an old one sinks into it.
const alone = chart.movingBars([{ status: "added", next: bar(1, 0, 40, 60) }], 0.5)[0];
assert.deepEqual([alone.y, alone.height], [70, 30]);
const sinking = chart.movingBars([{ status: "removed", prev: bar(1, 0, 40, 60) }], 0.5)[0];
assert.deepEqual([sinking.y, sinking.height], [70, 30]);

// A change nobody pressed for: the end, at every frame.
assert.deepEqual(chart.settledMarks(zoomIn).map((mark) => mark.payload.weekStartMs), [3, 4]);
assert.deepEqual(chart.settledMarks(null), []);

// Line points: a gap stays a gap, and paired points move.
const point = (week, x, y) => ({ x, y, value: y, payload: { weekStartMs: week } });
const line = chart.movingPoints(
  [
    { status: "matched", prev: point(3, 0, 10), next: point(3, 50, 30) },
    { status: "matched", prev: point(4, 50, null), next: point(4, 75, 20) },
    { status: "added", next: point(2, 25, 40) }
  ],
  0.5
);
// The pairs say next = 0.5 × prev + 50, so week 2 starts at (25 − 50) / 0.5 = −50.
assert.deepEqual(line.map((mark) => [mark.x, mark.y]), [[25, 20], [62.5, 20], [-12.5, 40]]);
const dropped = chart.movingPoints(
  [
    { status: "removed", prev: point(1, 0, 5) },
    { status: "matched", prev: point(3, 50, 10), next: point(3, 0, 10) },
    { status: "matched", prev: point(4, 75, 10), next: point(4, 50, 10) }
  ],
  0.5
);
assert.deepEqual([dropped[0].x, dropped[0].y], [-50, 5], "a dropped point heads off the left edge");
assert.equal(chart.movingPoints([{ status: "removed", prev: point(1, 0, 5) }], 0.5).length, 0, "without a pair it just goes");

console.log("figure motion: ok");
