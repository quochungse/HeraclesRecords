/**
 * Re-takes every figure quoted in docs/ui-system-refinement.md.
 *
 * Not a test — it asserts nothing and is wired to no npm script. It exists so
 * that a plan written against a snapshot of the stylesheets can be checked
 * against the stylesheets as they are now, without anyone having to trust a
 * number in a document or reconstruct the regex that produced it.
 *
 * Run: node scripts/measure-ui.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out.sort();
}

const FILES = cssFiles(SRC);
const TEXT = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));

/**
 * Every `selector { body }` pair. Bodies here hold no nested braces. The text
 * before a `{` also holds whatever comment sits above the rule, so that is cut
 * off and `line` is where the selector itself starts — the line an editor link
 * should land on, not the blank line after the previous rule.
 */
function* rules() {
  for (const [file, src] of TEXT) {
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const lastComment = m[1].lastIndexOf("*/");
      const head = lastComment === -1 ? m[1] : m[1].slice(lastComment + 2);
      const selector = head.trim();
      if (!selector || selector.startsWith("@")) continue;
      const start = m.index + (m[1].length - head.length) + (head.length - head.trimStart().length);
      // A comment in the body is prose, and prose here quotes declarations.
      const body = m[2].replace(/\/\*[\s\S]*?\*\//g, "");
      yield { file, selector, body, line: src.slice(0, start).split("\n").length };
    }
  }
}

/** Every value of `prop`, counted per occurrence — not per line. */
/**
 * Declarations of `prop`, inside rule bodies only.
 *
 * Scanning the raw text counts a media query's own condition as a declaration:
 * `@media (max-width: 700px)` is not a rule setting a max-width, and counting
 * those put §5's figure at 245 uses over 170 values when the stylesheets hold
 * 119 over 71.
 */
function declarations(prop) {
  const out = [];
  const pattern = new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;}]+)`, "g");
  for (const [file, src] of TEXT) {
    for (const rule of src.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
      if (rule[1].trim().startsWith("@")) continue;
      for (const m of rule[2].matchAll(pattern)) {
        out.push({ file, value: m[1].replace(/!important/g, "").trim() });
      }
    }
  }
  return out;
}

const tally = (xs, key = (x) => x) => {
  const c = new Map();
  for (const x of xs) c.set(key(x), (c.get(key(x)) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]);
};
const head = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);

const hasBg = (b) => /(?<![-\w])background(-color)?\s*:/.test(b);
/** The `border` shorthand with a visible value. Deliberately narrow: a rule
 *  that only re-tints an inherited edge (`border-color` on a hover state) did
 *  not decide to draw one, so it is not the rule to go and fix. */
const hasBorder = (b) => /(?<![-\w])border\s*:\s*(?!none|0)/.test(b);
/** The wide reading, reported alongside so the narrow one is not mistaken for
 *  the number of elements that end up wearing both devices. */
const touchesBorder = (b) => /(?<![-\w])border(-color|-width)?\s*:\s*(?!none|0)/.test(b);
const hasShadow = (b) => /(?<![-\w])box-shadow\s*:\s*(?!none)/.test(b);
const hasRadius = (b) => /(?<![-\w])border-radius\s*:/.test(b);

// ---------------------------------------------------------------- boxes
const all = [...rules()];
const boxes = all.filter((r) => hasBg(r.body) && (touchesBorder(r.body) || hasShadow(r.body)) && hasRadius(r.body));
const boxesWithBorder = boxes.filter((r) => touchesBorder(r.body));
head("§4.2  Box-defining rules");
console.log(`  background + (border | shadow) + radius : ${boxes.length}`);
console.log(`  ... of which also carry a border        : ${boxesWithBorder.length}`);
console.log(`  mentioning .panel (the only shared one) : ${boxes.filter((r) => /\.panel\b/.test(r.selector)).length}`);

// ------------------------------------------------------- border + shadow
const both = all.filter((r) => hasBorder(r.body) && hasShadow(r.body));
head("§4.1  Rules painting a border AND a shadow (target: 0)");
const wide = all.filter((r) => touchesBorder(r.body) && hasShadow(r.body));
console.log(`  declaring \`border:\` outright : ${both.length}   (paper-scoped: ${both.filter((r) => r.selector.includes('data-theme="paper"')).length})`);
console.log(`  incl. border-color/-width    : ${wide.length}   (context only — not the fix list)`);
for (const [f, n] of tally(both, (r) => relative(ROOT, r.file)).slice(0, 6)) console.log(`   ${String(n).padStart(4)}  ${f}`);

// -------------------------------------------------------------- shadows
const shadows = declarations("box-shadow").filter((d) => d.value !== "none");
const literal = shadows.filter((d) => !d.value.startsWith("var("));
head("§4.1  box-shadow");
console.log(`  uses: ${shadows.length}   distinct: ${new Set(shadows.map((d) => d.value)).size}`);
console.log(`  literal (not a token) — uses: ${literal.length}   distinct: ${new Set(literal.map((d) => d.value)).size}`);

// --------------------------------------------------------------- motion
const durations = [], easings = [];
for (const d of [...declarations("transition"), ...declarations("transition-duration")]) {
  for (const [, n, u] of d.value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) durations.push(Math.round(Number(n) * (u === "ms" ? 1 : 1000)));
  for (const [, e] of d.value.matchAll(/(cubic-bezier\([^)]*\)|ease-in-out|ease-out|ease-in|linear|\bease\b)/g)) easings.push(e);
}
const inBand = durations.filter((d) => d >= 120 && d <= 240).length;
const bareEase = easings.filter((e) => e === "ease").length;
head("§2  Motion");
console.log(`  transition durations — uses: ${durations.length}  distinct: ${new Set(durations).size}  in 120-240ms: ${(100 * inBand / durations.length).toFixed(1)}%`);
console.log(`  >= 300ms (keep as --dur-slow): ${durations.filter((d) => d >= 300).length}`);
console.log(`  easings — uses: ${easings.length}  distinct: ${new Set(easings).size}  bare \`ease\`: ${bareEase} (${(100 * bareEase / easings.length).toFixed(1)}%)`);
let easeTokens = 0, easeInNames = 0, easeKeyword = 0;
for (const src of TEXT.values()) {
  easeTokens += [...src.matchAll(/\bease\b(?!-)/g)].length;
  // `-` is not a word character, so `\b` also fires inside `var(--map-ease)`:
  // a replace written with the loose pattern produces `var(--map-var(--ease))`,
  // and every `var(--ease)` it writes still matches it afterwards.
  easeInNames += [...src.matchAll(/--[\w-]*\bease\b(?!-)/g)].length;
  easeKeyword += [...src.matchAll(/(?<![-\w])ease\b(?!-)/g)].length;
}
console.log(`  \`\\bease\\b(?!-)\` across all CSS (occurrences, not lines): ${easeTokens}`);
console.log(`    ... inside a custom property name (--map-ease): ${easeInNames}`);
console.log(`    ... the keyword itself, \`(?<![-\\w])ease\\b(?!-)\`: ${easeKeyword}   (after §2: 0)`);
console.log(`  prefers-reduced-motion blocks: ${[...TEXT.values()].join("").match(/prefers-reduced-motion/g)?.length ?? 0}`);

// The figures above count a delay as a duration. Split per list item: the
// first time in an item is its duration, the second its delay.
const splitList = (v) => v.split(/,(?![^(]*\))/).map((x) => x.trim());
const itemDurations = [], delays = [];
const ms = ([, n, u]) => Math.round(Number(n) * (u === "ms" ? 1 : 1000));
for (const [file, src] of TEXT) {
  for (const m of src.matchAll(/(?<![-\w])(transition(?:-duration|-delay)?)\s*:\s*([^;}]+)/g)) {
    const line = src.slice(0, m.index).split("\n").length;
    for (const item of splitList(m[2])) {
      const times = [...item.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map(ms);
      if (m[1] === "transition-delay") times.forEach((t) => delays.push(t));
      else {
        if (times[0] !== undefined) itemDurations.push({ file, line, t: times[0], item, important: /!important/.test(item) });
        if (m[1] === "transition" && times[1] !== undefined) delays.push(times[1]);
      }
    }
  }
}
const outOfBand = itemDurations.filter(({ t, important }) => !important && !(t >= 120 && t <= 240) && !(t >= 300 && t <= 330));
console.log(`  per list item — durations: ${itemDurations.length}   delays: ${delays.length}  ${tally(delays).map(([v, n]) => `${v}ms(${n})`).join(" ")}`);
console.log(`  durations outside 120-240 and 300-330ms (§2 maps neither): ${outOfBand.length}  ${tally(outOfBand, (d) => d.t).sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v}ms(${n})`).join(" ")}`);
console.log(`  reduced-motion \`!important\` durations (must stay literal): ${itemDurations.filter((d) => d.important).length}`);
let animationEase = 0;
for (const d of declarations("animation")) if (/(?<![-\w])ease\b(?!-)/.test(d.value)) animationEase += 1;
console.log(`  \`animation\` declarations timed with bare \`ease\` (a §2 replace changes them too): ${animationEase}`);

// ---------------------------------------------------------- line-height
const lh = declarations("line-height");
head("§1  line-height");
console.log(`  uses: ${lh.length}   distinct: ${new Set(lh.map((d) => d.value)).size}`);
console.log("  " + tally(lh, (d) => d.value).map(([v, n]) => `${v}(${n})`).join("  "));

// ----------------------------------------------------------------- focus
const focus = all.filter((r) => r.selector.includes(":focus-visible"));
const stripped = focus.filter((r) => /outline\s*:\s*none/.test(r.body) && !hasShadow(r.body));
head("§3  Focus");
console.log(`  :focus-visible rules: ${focus.length}   distinct ring recipes: ${new Set(focus.map((r) => (r.body.match(/outline\s*:\s*([^;}]+)/)?.[1] ?? "-") + "|" + (r.body.match(/box-shadow\s*:\s*([^;}]+)/)?.[1] ?? "-"))).size}`);
console.log(`  drop the outline with no ring: ${stripped.length}`);
// What each of those does instead. A rule is read alone, so one that removes
// the outline can still sit beside another styling the same focus state.
for (const r of stripped) {
  const own = r.selector.split(",").map((x) => x.trim()).filter((x) => x.includes(":focus-visible"));
  const elsewhere = focus.filter((o) => o !== r && o.file === r.file &&
    o.selector.split(",").some((x) => own.some((sel) => x.trim().startsWith(sel))));
  const why = /:hover/.test(r.selector) ? "same rule as :hover"
    : elsewhere.length ? `styled in ${elsewhere.length} other rule(s), e.g. :${elsewhere[0].line}`
    : /border(-color)?\s*:/.test(r.body) ? "re-tints its border"
    : "nothing replaces it";
  console.log(`   ${relative(ROOT, r.file)}:${r.line}  ${r.selector.replace(/\s+/g, " ").slice(0, 58).padEnd(58)}  ${why}`);
}

// A custom property holding `var()` is resolved where it is declared, and its
// descendants inherit the result. So a token built on :root out of --accent
// ignores every scope below that redefines --accent.
head("§3/§4.4  Tokens redefined below :root");
const rootOnly = /^:root(\[[^\]]*\])*(\s*,\s*:root(\[[^\]]*\])*)*$/;
for (const name of ["--accent", "--glass-border", "--bg-base"]) {
  const scoped = all.filter((r) => new RegExp(`(?<![-\\w])${name}\\s*:`).test(r.body) && !rootOnly.test(r.selector.replace(/\s+/g, " ")));
  console.log(`  ${name.padEnd(15)} ${scoped.length}  ${scoped.map((r) => `${relative(ROOT, r.file)}:${r.line}`).join("  ")}`);
}
const paperEdges = all.filter((r) => r.selector.includes('data-theme="paper"') && touchesBorder(r.body));
console.log(`  paper-scoped rules setting border/-color/-width: ${paperEdges.length}   ... also a shadow: ${paperEdges.filter((r) => hasShadow(r.body)).length}`);
console.log("    (these outrank a shared rule, so a --surface-line swap in that rule does not reach them)");

// --------------------------------------------------------------- spacing
const space = [];
for (const p of ["padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
                 "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
                 "gap", "row-gap", "column-gap"]) {
  for (const d of declarations(p)) for (const [, n] of d.value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) space.push(Math.abs(Number(n)));
}
const ranked = tally(space);
const top16 = ranked.slice(0, 16).reduce((a, [, n]) => a + n, 0);
head("§6  Spacing (withdrawn from the plan — see the section)");
console.log(`  uses: ${space.length}   distinct: ${ranked.length}   top-16 covers ${(100 * top16 / space.length).toFixed(1)}%`);
console.log("  " + ranked.slice(0, 12).map(([v, n]) => `${v}px(${n})`).join("  "));

// ----------------------------------------------------------- composition
const grid = declarations("grid-template-columns");
const maxw = declarations("max-width");
head("§5  Composition");
console.log(`  grid-template-columns — uses: ${grid.length}  distinct patterns: ${new Set(grid.map((d) => d.value)).size}`);
console.log(`  max-width — uses: ${maxw.length}  distinct: ${new Set(maxw.map((d) => d.value)).size}  distinct \`ch\`: ${new Set([...[...TEXT.values()].join("").matchAll(/\b\d+ch\b/g)].map((m) => m[0])).size}`);
const upper = all.filter((r) => /text-transform\s*:\s*uppercase/.test(r.body));
console.log(`  uppercase rules: ${upper.length}  at weight 700: ${upper.filter((r) => /font-weight\s*:\s*700/.test(r.body)).length}`);
console.log(`  tabular-nums sites: ${[...TEXT.values()].join("").match(/tabular-nums/g)?.length ?? 0}`);

// --------------------------------------------------------------- deferred
const z = declarations("z-index");
head("§6  Deferred");
console.log(`  z-index — uses: ${z.length}  distinct: ${new Set(z.map((d) => d.value)).size}`);
const bp = [...[...TEXT.values()].join("").matchAll(/@media[^{]*?(\d+)px/g)].map((m) => m[1]);
console.log(`  media queries: ${bp.length}  distinct breakpoints: ${new Set(bp).size}`);
console.log(`\n${FILES.length} stylesheets under src/\n`);
