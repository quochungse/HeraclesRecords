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
 * Leading was left open by that first pass, and leading is half of a type
 * scale: 27 values across 365 declarations, with 1.35, 1.4 and 1.45 all in
 * common use where nobody had chosen between them.
 *
 * So: every literal in these five properties must come from the scale below.
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
 *   - `clamp()` for letter-spacing in a container query, where a label tracks
 *     its own container's width and no fixed em can follow it.
 *
 * Motion is held the same way, because it drifted the same way: 26 duration
 * steps, and 92% of every curve was the browser's `ease`, which nobody chose —
 * it is what you get for not choosing. So a `transition` spends `var(--ease)`
 * (or names another curve on purpose) and a `--dur-*` token; an `animation`
 * never spells bare `ease`. Exceptions, both narrow:
 *   - a duration of 10ms or less marked `!important` — a reduced-motion
 *     override switching transitions off, not a reaction time;
 *   - `DESIGNED_LENGTHS` below: a fill growing to its value, a staged reveal,
 *     a spring whose length belongs to its curve. Each entry names its rule and
 *     property, and an entry that no longer matches fails, so the list cannot
 *     outlive the transitions it excuses.
 *
 * Focus has one look too. 144 `:focus-visible` rules spelled 35 different
 * rings, and 46 shared a rule with `:hover` — so a keyboard user got the
 * mouse-over state and no way to tell the element was selected rather than
 * merely under a cursor. A rule whose subject is the focused element therefore
 * stands alone (no `:hover`, `.is-active` or `:focus` beside it, and not
 * grouped inside `:is()`) and draws `outline: var(--focus-ring)` at
 * `outline-offset: 2px` — or `-2px` where the container clips. A rule that
 * styles something else while focus is inside (`:focus-visible .tip`,
 * `::before`, `:has()`) is not a ring rule, and neither is a reduced-motion or
 * forced-colors override. Why an outline and not a box-shadow is written above
 * the `--focus-ring` definition in styles.css.
 *
 * Run: npm run test:design-vocabulary
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/* Paths are compared against literals written with "/" — the exemption
   lists, the allowlist keys, every reason string. `relative` hands back
   backslashes on Windows, so those never matched there and three of these
   suites reported the whole app as violations. */
const repoRelative = (file) => relative(ROOT, file).split(sep).join("/");

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
/**
 * Leading. Four steps and `1`, which is not leading but the absence of it: a
 * figure, a badge or an icon chip whose box is its own height.
 *   1.2  display type, 22px and up
 *   1.3  headings and dense UI rows
 *   1.45 body, the default
 *   1.6  long prose only — the coach's Markdown, settings explainers
 * Unitless only. A px leading does not scale with the text it spaces, and
 * `normal` is whatever the font's metrics say, which differs per platform.
 * A box that has to match a neighbour's height says so with a height, not
 * with a leading inflated to fit it.
 */
const LEADING = new Set(["1", "1.2", "1.3", "1.45", "1.6"]);
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

const DURATION_TOKENS = new Set(["--dur-fast", "--dur-base", "--dur-slow"]);
/**
 * Transitions whose length is designed rather than reactive — file, the rule's
 * selector, and the property. Each rule carries a comment saying which kind.
 */
const DESIGNED_LENGTHS = [
  // Springs: the curve overshoots, and its length is part of that shape.
  // Strength's header pickers had three of these — the bloom that opened them
  // on hover. They are gone with the pickers themselves: OptionGroup's
  // collapsible mode opens on a click and animates a grid column, which is a
  // reaction time and spends --dur-base like everything else.
  ["src/strength/strength.css", ".strength-flip", "transform"],
  // Fills growing to their value.
  ["src/strength/strength.css", ".muscle-ranking-fill", "transform"],
  ["src/strength/strength.css", ".muscle-ranking-fill", "background"],
  ["src/strength/strength.css", ".muscle-recovery-fill", "transform"],
  ["src/strength/strength.css", ".muscle-trend-bar-fill", "height"],
  ["src/strength/strength.css", ".strength-mix-bar > span", "flex-grow"],
  ["src/styles.css", ".storage-ring-progress", "stroke-dashoffset"],
  ["src/styles.css", ".watch-storage-bar", "width"],
  ["src/styles.css", ".training-fitness-bar", "height"],
  ["src/styles.css", ".training-fitness-bar", "background"],
  // Staged reveals on load, most of them behind a 220ms delay.
  ["src/strength/strength.css", ".anatomy-body-map::after", "opacity"],
  ["src/styles.css", ".vo2-widget-panel::before", "opacity"],
  ["src/styles.css", ".vo2-widget-panel::after", "opacity"],
  ["src/styles.css", ".vo2-gauge::before", "opacity"],
  ["src/styles.css", ".vo2-gauge::before", "transform"],
  ["src/styles.css", ".vo2-gauge-needle", "opacity"],
  ["src/styles.css", ".vo2-gauge-needle", "transform"],
  ["src/styles.css", ".training-recovery-ring::before", "opacity"],
  ["src/styles.css", ".training-recovery-ring::before", "transform"],
];

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out.sort();
}

/**
 * Every stylesheet, read once. `code` is the text with comments blanked in
 * place — every offset kept, so a reported line is still right — for the passes
 * that read whole declarations and must not mistake prose quoting `ease` or a
 * selector for CSS.
 */
const stylesheets = cssFiles(SRC).map((file) => {
  const text = readFileSync(file, "utf8");
  return { file, text, code: text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")) };
});
const lineAt = (code, index) => code.slice(0, index).split("\n").length;

const violations = [];
function fail(file, line, prop, value, why) {
  violations.push(`${repoRelative(file)}:${line}  ${prop}: ${value}   — ${why}`);
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

/** Splits on `sep` at paren depth 0 — `var(--x, cubic-bezier(…))` nests two deep. */
function splitTop(value, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && (sep === "," ? ch === "," : /\s/.test(ch))) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

/** The last compound of a selector, at paren depth 0. */
function lastCompound(selector) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(ch)) cut = i + 1;
  }
  return selector.slice(cut);
}

/** `:focus-visible` on the element the rule paints — not inside :is()/:has(), not on a pseudo-element. */
function targetsFocusedElement(selector) {
  const last = lastCompound(selector);
  if (last.includes("::")) return false;
  let depth = 0;
  for (let i = 0; i < last.length; i += 1) {
    if (last[i] === "(") depth += 1;
    else if (last[i] === ")") depth -= 1;
    else if (depth === 0 && last.startsWith(":focus-visible", i)) return true;
  }
  return false;
}

/** The at-rule a position sits inside, if any. */
function enclosingAtRule(code, index) {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (code[i] === "}") depth += 1;
    else if (code[i] === "{") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const head = code.slice(code.lastIndexOf("}", i - 1) + 1, i).trim();
      if (head.startsWith("@")) return head;
    }
  }
  return "";
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

// ---------------------------------------------------------------- per line
for (const { file, text: source } of stylesheets) {
  // `@font-face` describes a file, it does not choose from the scale: a
  // variable font's `font-weight: 300 700` is the range that file carries.
  // Marked in one pass; asking `enclosingAtRule` per line is quadratic over a
  // 34k-line stylesheet and took this from a second to minutes.
  const lines = source.split("\n");
  const inFontFace = [];
  let openFace = false;
  lines.forEach((raw, i) => {
    if (/@font-face/.test(raw)) openFace = true;
    inFontFace[i] = openFace;
    if (openFace && raw.includes("}")) openFace = false;
  });
  lines.forEach((raw, i) => {
    if (inFontFace[i]) return;
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

    for (const v of declarations(text, "line-height")) {
      if (isPassthrough(v)) continue;
      if (!LEADING.has(v)) {
        fail(file, line, "line-height", v,
          `use ${[...LEADING].join(" | ")} — 1 for figures and chips, 1.2 display, 1.3 headings and dense rows, 1.45 body, 1.6 long prose`);
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

// ------------------------------------------------------------------ motion
// A transition list runs over several lines, so motion is read per declaration.
const BARE_EASE = /(?<![-\w])ease\b(?!-)/;
const TIME = /^(\d*\.?\d+)(ms|s)$/;
const CURVE = /^(var\(--[\w-]*ease[\w-]*|cubic-bezier\(|steps\(|linear|ease-in|ease-out|ease-in-out|step-start|step-end)/;
const designedUnused = new Set(DESIGNED_LENGTHS.map((entry) => entry.join("|")));

for (const { file, code } of stylesheets) {
  const where = repoRelative(file);
  for (const m of code.matchAll(/(?<![-\w])(transition|transition-duration|transition-timing-function|animation|animation-timing-function):\s*([^;}]+)/g)) {
    const line = lineAt(code, m.index);
    const [prop, raw] = [m[1], m[2]];
    const important = raw.includes("!important");
    const value = raw.replace(/!important/g, "").trim();
    if (BARE_EASE.test(value)) {
      fail(file, line, prop, value.replace(/\s+/g, " "), "spend var(--ease): bare `ease` is the browser default, not a choice");
      continue;
    }
    if (prop.startsWith("animation") || prop === "transition-timing-function") continue;

    const open = code.lastIndexOf("{", m.index);
    const before = Math.max(code.lastIndexOf("}", open - 1), code.lastIndexOf("{", open - 1), code.lastIndexOf(";", open - 1));
    const selector = code.slice(before + 1, open).trim().replace(/\s+/g, " ");

    for (const item of splitTop(value, ",")) {
      if (item === "none") continue;
      const tokens = splitTop(item, " ");
      const property = prop === "transition-duration" ? null : tokens[0];
      const duration = prop === "transition-duration" ? tokens[0] : tokens.find((t) => TIME.test(t) || t.startsWith("var(--dur-"));
      const shown = item.replace(/\s+/g, " ");
      if (prop === "transition" && !tokens.some((t) => CURVE.test(t))) {
        fail(file, line, prop, shown, "name the curve — an item without one is `ease` by omission");
      }
      if (!duration) continue;
      const token = duration.match(/^var\((--[\w-]+)\)$/)?.[1];
      if (token) {
        if (!DURATION_TOKENS.has(token)) fail(file, line, prop, shown, `${token} is not a duration token`);
        continue;
      }
      const time = duration.match(TIME);
      const msValue = time ? Number(time[1]) * (time[2] === "ms" ? 1 : 1000) : NaN;
      if (important && msValue <= 10) continue;
      const key = [where, selector, property].join("|");
      if (property && designedUnused.has(key)) {
        designedUnused.delete(key);
        continue;
      }
      fail(file, line, prop, shown,
        `spend ${[...DURATION_TOKENS].join(" / ")} — fast for a state, base for movement, slow for a drawer; a designed length goes in DESIGNED_LENGTHS`);
    }
  }
}
// ------------------------------------------------------------------- focus
const RING_OUTLINE = /(?<![-\w])outline\s*:\s*var\(--focus-ring\)\s*(;|$)/;
const RING_OFFSET = /(?<![-\w])outline-offset\s*:\s*-?2px\s*(;|$)/;

for (const { file, code } of stylesheets) {
  for (const m of code.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const selectorText = m[1].trim().replace(/\s+/g, " ");
    // The rule that defines the ring is not a ring rule.
    if (!selectorText.includes(":focus-visible") || /(?<![-\w])--focus-ring\s*:/.test(m[2])) continue;
    if (/prefers-reduced-motion|forced-colors/.test(enclosingAtRule(code, m.index))) continue;
    const selectors = splitTop(selectorText, ",");
    const line = lineAt(code, m.index + m[1].search(/\S/));
    // `:is(:hover, :focus-visible)` is the same collapse, spelled inside one selector.
    const grouped = selectors.find((sel) => !lastCompound(sel).includes("::") && /:(is|where)\([^()]*:focus-visible/.test(lastCompound(sel)));
    if (grouped) {
      fail(file, line, "selector", grouped.slice(0, 90), "give :focus-visible its own rule rather than grouping it with another state in :is()");
    }
    const focused = selectors.filter(targetsFocusedElement);
    if (!focused.length) continue;
    const body = m[2].trim();
    if (focused.length < selectors.length) {
      fail(file, line, "selector", selectorText.slice(0, 90),
        "give :focus-visible its own rule — sharing one with :hover (or .is-active, or :focus) makes focus look like hover");
    }
    if (!RING_OUTLINE.test(body) || !RING_OFFSET.test(body)) {
      fail(file, line, ":focus-visible", selectorText.slice(0, 90),
        "draw outline: var(--focus-ring) at outline-offset: 2px (or -2px where the container clips)");
    }
  }
}

for (const key of designedUnused) {
  violations.push(`DESIGNED_LENGTHS  ${key.replaceAll("|", "  ")}   — no such literal transition any more; remove the entry`);
}

assert.deepEqual(
  violations,
  [],
  `design vocabulary broken in ${violations.length} place(s):\n\n${violations.join("\n")}\n`
);

console.log(
  `design vocabulary OK — ${stylesheets.length} stylesheets, ` +
    `${WEIGHTS.size} weights, ${SIZES_PX.size} sizes (+${RELATIVE.size} relative), ${TRACKING.size} tracking steps, ` +
    `${LEADING.size} leading steps, ` +
    `${DURATION_TOKENS.size} duration tokens (+${DESIGNED_LENGTHS.length} designed lengths), ` +
    `${RADIUS_TOKENS.size} radius tokens and no literal outside them`
);
