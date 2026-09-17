/**
 * The design vocabulary is a closed set, and this is what closes it.
 *
 * CSS here is plain and global (no Tailwind, no modules), so a type scale
 * exists only for as long as everyone keeps picking from it. Nobody breaks it
 * on purpose: you write `font-weight: 650` once because 600 looked a shade
 * light next to that heading, and a year later the file holds twenty weights
 * — 540, 550, 560, 580, 620, 640, 650, 660, 680, 720, 750, 760 — that no eye
 * can tell apart and no rule explains. That is the state this test was written
 * out of: 20 weights, 18 font sizes (thirteen of them between 9px and 15px,
 * half-pixels included), 45 spellings of letter-spacing down to -0.004em, and
 * ~150 hand-written radii between 1px and 22px alongside the five tokens.
 *
 * So: every literal in these four properties must come from the scale below.
 * The point is not the specific numbers — it is that adding a number is a
 * deliberate act that edits this file, rather than a decision taken alone at
 * the bottom of a 34k-line stylesheet.
 *
 * Deliberate exceptions, all narrow:
 *   - `var(...)`, `calc(...)` over a token, `inherit`, `initial`, `unset`.
 *   - `clamp()` for font-size, as long as its px endpoints are on the scale.
 *   - the relative `em` ladder below, for text that must follow whatever size
 *     its parent ended up at — a unit suffix on a figure, the heading ladder
 *     inside Markdown the coach renders at two different body sizes. A fixed
 *     px there stops tracking its parent the moment that parent changes.
 *   - `font-size: 0`, which is not a size: it is how a narrow layout drops a
 *     button's label and leaves the icon.
 *   - percentages and `50%` for radius — a circle is not a corner.
 *   - `clamp()` for letter-spacing in a container query: the watchface editor
 *     tracks a label against its own container width, which no fixed em can do.
 *
 * Run: npm run test:design-vocabulary
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

/** The whole vocabulary. Adding an entry is the deliberate act; see the header. */
const WEIGHTS = new Set([400, 500, 600, 700]);
const SIZES_PX = new Set([10, 11, 12, 13, 14, 18, 22, 28, 36]);
/**
 * The relative ladder. `em` is not a loophole here — it is the only thing that
 * works for text which has to follow whatever size its parent ended up at, and
 * two places need that. The coach renders the same Markdown at two body sizes
 * (`.chat-thinking-text .chat-markdown` re-bases to `inherit`), so its heading
 * ladder must be proportional: 1.3 / 1.15 / 1 for h1–h3, with h3 stating 1em
 * rather than omitting it so the UA's own 1.17em cannot win. And `0.6em` is
 * the unit suffix riding on a figure ("314 km"), which has to shrink and grow
 * with the number rather than beside it. `0.9em` serves both ends — h4, inline
 * code, a subtitle inside a heading.
 */
const RELATIVE = new Set(["1.3em", "1.15em", "1em", "0.9em", "0.6em"]);
/** Not a size: `font-size: 0` is how a narrow layout drops a button's label. */
const NO_TEXT = "0";
const TRACKING = new Set(["0", "-0.02em", "0.06em", "0.1em"]);
/** Radius is spent through tokens only, so the scale lives in styles.css. */
const RADIUS_TOKENS = new Set([
  "--radius-xs",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--radius-pill",
  // Feature aliases, each defined as one of the six above.
  "--sidebar-radius",
  "--sx-radius",
  "--wf-pane-radius",
  "--wf-control-radius",
  "--wf-dashboard-radius",
]);

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out.sort();
}

const violations = [];
function fail(file, line, prop, value, why) {
  violations.push(`${relative(ROOT, file)}:${line}  ${prop}: ${value}   — ${why}`);
}

const isPassthrough = (v) =>
  v.startsWith("var(") || v.startsWith("calc(") ||
  v === "inherit" || v === "initial" || v === "unset";

/**
 * A clamp() may bound a font size, but only between two px endpoints that are
 * themselves on the scale — the middle term is free to be vw or cqi. An
 * `every()` over the px it happens to contain is not enough: `clamp(1.35rem,
 * 2vw, 1.65rem)` contains none, so the test passed the very shape this scale
 * exists to remove.
 */
function clampSizesOk(value) {
  if (/\d(?:rem|em|pt|%)/.test(value)) return false;
  const px = value.match(/(\d+(?:\.\d+)?)px/g) ?? [];
  return px.length > 0 && px.every((p) => SIZES_PX.has(Number(p.slice(0, -2))));
}

/**
 * Declarations anywhere on the line, not just at its start. Single-line rules
 * are written throughout (`.chat-markdown h1 { font-size: 1.32em; }`), and 41
 * declarations — four of them off-scale — sat behind a `^` anchor, unseen by
 * the test whose whole job is to see all of them. The lookbehind keeps
 * `-webkit-border-radius` and a custom property named `--card-font-size` out.
 */
function declarations(line, prop) {
  return [...line.matchAll(new RegExp(`(?<![-\\w])${prop}:\\s*([^;}]+)[;}]`, "g"))]
    .map((m) => m[1].trim());
}

for (const file of cssFiles(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((raw, i) => {
    const line = i + 1;
    const text = raw.replace(/!important/g, "").trim();

    for (const v of declarations(text, "font-weight")) {
      if (!isPassthrough(v) && !["normal", "bold"].includes(v)) {
        if (!WEIGHTS.has(Number(v))) {
          fail(file, line, "font-weight", v, `use one of ${[...WEIGHTS].join(", ")}`);
        }
      }
    }

    for (const v of declarations(text, "font-size")) {
      if (isPassthrough(v) || RELATIVE.has(v) || v === NO_TEXT) continue;
      if (v.startsWith("clamp(")) {
        if (!clampSizesOk(v)) {
          fail(file, line, "font-size", v, "clamp must bound two on-scale px endpoints");
        }
        continue;
      }
      const px = v.match(/^(\d+(?:\.\d+)?)px$/);
      if (!px || !SIZES_PX.has(Number(px[1]))) {
        fail(file, line, "font-size", v,
          `use one of ${[...SIZES_PX].join(", ")}px, or ${[...RELATIVE].join(" / ")} where it must follow its parent (rem is not on the scale)`);
      }
    }

    for (const v of declarations(text, "letter-spacing")) {
      if (isPassthrough(v) || v === "normal" || v.startsWith("clamp(")) continue;
      if (!TRACKING.has(v)) {
        fail(file, line, "letter-spacing", v,
          `use ${[...TRACKING].join(" | ")} — negative tightens display type, 0.06em tracks uppercase, 0.1em tracks it at 11px and under`);
      }
    }

    for (const v of declarations(text, "border-radius")) {
      if (v === "inherit" || v.includes("%") || v.startsWith("clamp(")) continue;
      // Every custom property named must be a radius token, and once the
      // var()/calc() machinery is stripped no bare length may be left. That
      // order matters: `calc(var(--radius-lg) - 2px)` is the correct way to
      // inset a child's corner inside its parent's, so the px inside a calc
      // is a legitimate offset rather than a radius picked by hand.
      const unknown = [...v.matchAll(/var\((--[a-z-]+)/g)]
        .map((m) => m[1])
        .filter((n) => !RADIUS_TOKENS.has(n));
      if (unknown.length) {
        fail(file, line, "border-radius", v, `${unknown.join(", ")} is not a radius token`);
        continue;
      }
      // var() first: `calc(var(--radius-lg) - 1px)` has a nested paren, so
      // stripping calc() first would stop at var()'s closing bracket.
      const bare = v
        .replace(/var\([^)]*\)/g, "")
        .replace(/calc\([^)]*\)/g, "")
        .replace(/\b0\b/g, "");
      if (/\d/.test(bare)) {
        fail(file, line, "border-radius", v,
          "spend a --radius-* token, not a literal (0, a percentage and calc() over a token are fine)");
      }
    }
  });
}

assert.deepEqual(
  violations,
  [],
  `design vocabulary broken in ${violations.length} place(s):\n\n${violations.join("\n")}\n`
);

const files = cssFiles(SRC).length;
console.log(
  `design vocabulary OK — ${files} stylesheets, ` +
    `${WEIGHTS.size} weights, ${SIZES_PX.size} sizes (+${RELATIVE.size} relative), ${TRACKING.size} tracking steps, ` +
    `${RADIUS_TOKENS.size} radius tokens and no literal outside them`
);
