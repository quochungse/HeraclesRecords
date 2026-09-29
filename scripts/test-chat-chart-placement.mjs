// Where an answer places the charts its turn drew (electron/chartPlacement.ts).
//
// The model names a chart by the handle its tool result gave it and places it
// with `[[chart:c1]]`. Everything here is the fallback that makes a wrong
// placeholder cost nothing: an unknown handle is dropped, a chart is placed
// once, a placeholder inside a sentence or a list waits for the block to end,
// and nothing reaches the screen half-typed.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const {
  chartHandle,
  chartHandleNote,
  holdBackPartialPlaceholder,
  placeCharts,
  stripChartPlaceholders
} = await import(
  pathToFileURL(path.join(repoRoot, "dist-electron", "chartPlacement.js")).href + `?cacheBust=${Date.now()}`
);

const known = (...handles) => (handle) => handles.includes(handle);
const text = (value) => ({ kind: "text", text: value });
const chart = (handle) => ({ kind: "chart", handle });

// --- handles ---------------------------------------------------------------
assert.equal(chartHandle(0), "c1");
assert.equal(chartHandle(2), "c3");
assert.equal(chartHandleNote(["c1"]), "[Drawn for the athlete as chart c1.]");
assert.equal(chartHandleNote(["c2", "c3", "c2"]), "[Drawn for the athlete as charts c2, c3.]");

// --- an answer with no placeholder is one piece of text ---------------------
assert.deepEqual(placeCharts("Easy week.\n\nKeep it so.", known("c1")), [text("Easy week.\n\nKeep it so.")]);

// --- a placeholder on its own line is placed there ---------------------------
assert.deepEqual(
  placeCharts("The pace fell away.\n\n[[chart:c2]]\n\nHR held flat.", known("c1", "c2")),
  [text("The pace fell away.\n"), chart("c2"), text("\nHR held flat.")]
);
// At the very start, and indented or padded.
assert.deepEqual(placeCharts("  [[chart:c1]]  \nAfter.", known("c1")), [chart("c1"), text("After.")]);

// --- an unknown handle is dropped, and so is its line ------------------------
assert.deepEqual(
  placeCharts("Before.\n[[chart:c9]]\nAfter.", known("c1")),
  [text("Before.\nAfter.")]
);

// --- a chart is placed once however often it is named -----------------------
assert.deepEqual(
  placeCharts("[[chart:c1]]\nOne.\n[[chart:c1]]\nTwo.", known("c1")),
  [chart("c1"), text("One.\nTwo.")]
);

// --- inside a sentence or a list, it waits for the block to end --------------
assert.deepEqual(
  placeCharts("Look at [[chart:c1]] the drift.\nStill this paragraph.\n\nNext.", known("c1")),
  [text("Look at the drift.\nStill this paragraph."), chart("c1"), text("\nNext.")]
);
assert.deepEqual(
  placeCharts("- lap 1 [[chart:c1]]\n- lap 2", known("c1")),
  [text("- lap 1\n- lap 2"), chart("c1")],
  "a list is not cut in two; the chart goes after it"
);

// --- a code fence is not read ------------------------------------------------
assert.deepEqual(
  placeCharts("```\n[[chart:c1]]\n```", known("c1")),
  [text("```\n[[chart:c1]]\n```")]
);

// --- as text, placeholders are taken out ---------------------------------------
assert.equal(stripChartPlaceholders("No charts here."), "No charts here.");
assert.equal(
  stripChartPlaceholders("[[chart:c1]]\nThe pace fell.\n\n[[chart:c2]]\n\nHR [[chart:c3]] held."),
  "The pace fell.\n\nHR held."
);

// --- streaming: what could still become a placeholder is held back ------------
for (const partial of ["[", "[[", "[[c", "[[chart", "[[chart:", "[[chart:c", "[[chart:c1", "[[chart:c12]"]) {
  assert.equal(holdBackPartialPlaceholder(`The pace fell.\n\n${partial}`), "The pace fell.\n\n", partial);
}
// Complete, or plainly something else, it is left alone.
assert.equal(holdBackPartialPlaceholder("Before\n[[chart:c1]]"), "Before\n[[chart:c1]]");
assert.equal(holdBackPartialPlaceholder("See [the notes]"), "See [the notes]");
assert.equal(holdBackPartialPlaceholder("A [[link]] here"), "A [[link]] here");
assert.equal(holdBackPartialPlaceholder(""), "");

console.log("chat chart placement tests passed");
