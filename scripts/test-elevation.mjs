/**
 * The elevation ladder, held statically.
 *
 * A card inside a card was drawn as the same card: `bg + border + 12px` was the
 * most common box at both layers the app has, so neither read as a level. And
 * the edge itself was smudged — 185 rules gave one box a border *and* a
 * shadow, two devices doing one job, while 303 `box-shadow` declarations
 * spelled 250 distinct shadows beside four shadow tokens nobody spent.
 * docs/ui-system-refinement.md §4 has the ladder and the measurements.
 *
 * Two rules, over every stylesheet under src/:
 *
 *   1. No rule draws a visible border *and* an outer shadow. An outer shadow is
 *      the device a card floats on; a border is the device a well sits in. An
 *      inset is neither — it is a highlight or a recess — so it does not count.
 *      A border spelled `var(--surface-line, …)` is the L1 recipe (transparent
 *      in paper, the glass border in dark) and is not a violation; nor is a
 *      transparent one, which only reserves the space.
 *   2. Every layer that **lifts** spends a token: `--shadow-soft`,
 *      `--shadow-card`, `--shadow-elevated` or `--shadow-inset`. A `box-shadow`
 *      draws four other things — a 1px inset highlight or gridline, a ring
 *      (`0 0 0 Npx`), a glow (no offset, and on this app a datum's colour), and
 *      the crisp 1–2px edge under a control — and those are not elevation, so
 *      they are judged by the rules that own them (the hairline, colour-is-data)
 *      rather than by this token set. `layerKind` below draws the line, and the
 *      sizes there are the decision: they were taken on 2026-09-17 when the
 *      survey found 157 of the 348 remaining shadows were not elevation at all.
 *      (The focus ring is an outline, so it never meets either rule.)
 *
 * A token is judged by what it resolves to, across every definition it has
 * (dark, paper, a feature scope): `var(--glass-shadow)` is an outer shadow even
 * though it does not say so.
 *
 * **Neither rule is met yet, and the allowlist is how that is honest.**
 * scripts/elevation-allowlist.json holds every rule that broke one when this
 * test was written, keyed by file and selector with a count — a selector
 * recurs under a media query or a theme scope. It can only shrink: a rule not
 * listed fails, a count above its entry fails, and **an entry above what the
 * stylesheets now hold fails too**, so a converted rule has to be taken off the
 * list in the same change. Rule 2's entries are grouped by what the shadow is
 * — elevation, glow, ring, inset, or a token outside the set — and the group
 * is recomputed here, so a label cannot drift from the shadow it describes.
 *
 * **An `exempt` entry is a decision, not a to-do.** A few rules break rule 1
 * and are right to: the recovery ring's halo is the datum, not a lift. Those
 * sit in `exempt` with the reason written out, are
 * counted nowhere, and still have to *apply* — an exempt entry matching no
 * violating rule fails, so a deleted or converted rule takes its reason with
 * it rather than leaving a claim nobody can check.
 *
 * `node scripts/test-elevation.mjs --dump` prints the violations as allowlist
 * JSON and asserts nothing. It exists to seed the list, not to refresh it: an
 * entry leaves the list by being deleted by hand.
 *
 * Run: npm run test:elevation
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
const ALLOWLIST_PATH = join(ROOT, "scripts/elevation-allowlist.json");

const SHADOW_TOKENS = new Set(["--shadow-soft", "--shadow-card", "--shadow-elevated", "--shadow-inset"]);

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out.sort();
}

/** Splits on `sep` at paren depth 0. */
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

/** Comments blanked in place, so offsets and line numbers survive. */
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/** Every innermost `selector { body }`, with keyframe steps named after their animation. */
function* rules(code) {
  for (const m of code.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    let selector = m[1].trim().replace(/\s+/g, " ");
    if (!selector || selector.startsWith("@")) continue;
    if (/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(selector)) {
      const name = code.slice(0, m.index).match(/@keyframes\s+([\w-]+)[^@]*$/)?.[1] ?? "?";
      selector = `@keyframes ${name} ${selector}`;
    }
    const start = m.index + m[1].search(/\S/);
    yield { selector, body: m[2], line: code.slice(0, start).split("\n").length };
  }
}

const declarations = (body, prop) =>
  [...body.matchAll(new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1].replace(/!important/g, "").trim());

const files = cssFiles(SRC).map((file) => ({ file, code: blankComments(readFileSync(file, "utf8")) }));

/** Every value each custom property is given, anywhere. */
const definitions = new Map();
for (const { code } of files) {
  for (const m of code.matchAll(/(?<![-\w])(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    if (!definitions.has(m[1])) definitions.set(m[1], []);
    definitions.get(m[1]).push(m[2].replace(/!important/g, "").trim());
  }
}

/** A layer with its function calls taken out: what is left is lengths, keywords and a bare colour. */
const outsideCalls = (layer) => layer.replace(/[\w-]*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, " ");
/**
 * Only the colour itself counts: `color-mix(in srgb, var(--x) 40%, transparent)`
 * mentions transparent and is a perfectly visible colour.
 */
const isTransparent = (layer) =>
  /(^|\s)transparent(\s|$)/.test(outsideCalls(layer)) || /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0\s*\)/.test(layer);
const lengths = (layer) => (outsideCalls(layer).match(/(?<![#\w.-])-?\d*\.?\d+(px|em|rem)?(?=\s|$)/g) ?? []).map(parseFloat);

/** Does this shadow value — resolved through tokens — lift the box off the page? */
function castsOuterShadow(value, seen = new Set()) {
  if (value === "none") return false;
  return splitTop(value, ",").some((layer) => {
    const token = layer.match(/^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/);
    if (token) {
      const [, name, fallback] = token;
      if (seen.has(name)) return false;
      const values = definitions.get(name) ?? (fallback ? [fallback] : []);
      return values.some((v) => castsOuterShadow(v, new Set([...seen, name])));
    }
    if (/\binset\b/.test(layer) || isTransparent(layer)) return false;
    return lengths(layer).some((n) => n !== 0);
  });
}

function drawsVisibleBorder(value) {
  if (/^(none|0)\b/.test(value) || isTransparent(value)) return false;
  return !/var\(--surface-line\b/.test(value);
}

/**
 * What one layer is *for*. Only `elevation` and `inner` lift a box off what is
 * under it, and only those have to spend a token; the rest are other devices
 * drawn with the same property, and the sizes below are what separates them:
 *
 *   hairline  an inset drawn as a line rather than a shadow: no blur at all (a
 *             top highlight, a gridline between cells, a 3px marker bar down
 *             one side), or a single blurred pixel at the edge
 *   ring      no offset and no blur: an edge drawn as a shadow, up to 8px
 *   glow      no offset, some blur: colour spreading from the box, which on
 *             this app means a datum (a sport, a tone, the accent)
 *   lift      an offset under 3px with a blur under 5px: the crisp edge under a
 *             control, below the smallest step the ladder has
 *   tint      an outer layer painted in a named signal colour — the accent, a
 *             sport, a sleep stage, a tone, a success or an error. Elevation is
 *             spelled in ink; a shadow carrying one of those is that colour
 *             bleeding out of the box, so the colour rules own it, not this
 *             token set. A neutral shadow behind a name (`--panel-floor`,
 *             `--bg-base`) is still elevation
 *   elevation anything further: the device a card floats on
 *   inner     an inset deeper than a hairline: elevation, inverted
 */
const TINTED = /var\(--[\w-]*(accent|glow|tone|sport|stage|signal|success|warning|error|zone)[\w-]*\)/;

function layerKind(layer) {
  const inset = /\binset\b/.test(layer);
  if (!inset && TINTED.test(layer)) return "tint";
  const [x = 0, y = 0, blur = 0, spread = 0] = lengths(layer);
  if (inset) return blur === 0 || (Math.abs(x) <= 1 && Math.abs(y) <= 1 && blur <= 2 && Math.abs(spread) <= 1) ? "hairline" : "inner";
  if (x === 0 && y === 0 && blur === 0) return Math.abs(spread) <= 8 ? "ring" : "elevation";
  if (x === 0 && y === 0) return "glow";
  if (Math.abs(x) < 3 && Math.abs(y) < 3 && blur < 5 && Math.abs(spread) <= 1) return "lift";
  return "elevation";
}

const SPENDS_NOTHING = new Set(["hairline", "ring", "glow", "lift", "tint"]);

/** A layer that lifts, resolved through every definition a token has. */
function liftsWithoutToken(layer, seen = new Set()) {
  const token = layer.match(/^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (token) {
    const [, name, fallback] = token;
    if (SHADOW_TOKENS.has(name)) return false;
    if (seen.has(name)) return false;
    const values = definitions.get(name) ?? (fallback ? [fallback] : []);
    return values.some((v) => splitTop(v, ",").some((inner) => liftsWithoutToken(inner, new Set([...seen, name]))));
  }
  if (isTransparent(layer)) return false;
  return !SPENDS_NOTHING.has(layerKind(layer));
}

/** What is left of a violation, so the list reads as a to-do rather than a heap. */
function shadowKind(value) {
  const layers = splitTop(value, ",").filter((l) => liftsWithoutToken(l));
  if (!layers.length) return "token-outside-set";
  return layers.some((l) => !l.startsWith("var(") && layerKind(l) === "inner") ? "inset" : "elevation";
}

const spendsTokens = (value) => value === "none" || !splitTop(value, ",").some((layer) => liftsWithoutToken(layer));

// ------------------------------------------------------------------ measure

const allowed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
const exempt = allowed.exempt ?? {};
/** Which exempt entries were actually met, so a stale reason cannot sit in the file. */
const exemptSeen = new Set();

const found = { borderAndShadow: {}, shadowOutsideTokens: {} };
/** Where each counted violation is, per rule — a rule can break both. */
const sites = new Map();
const bump = (label, bucket, key, site) => {
  bucket[key] = (bucket[key] ?? 0) + 1;
  const at = `${label}|${key}`;
  if (!sites.has(at)) sites.set(at, []);
  sites.get(at).push(site);
};

for (const { file, code } of files) {
  for (const rule of rules(code)) {
    const key = `${repoRelative(file)}|${rule.selector}`;
    const site = `${repoRelative(file)}:${rule.line}`;
    const shadows = declarations(rule.body, "box-shadow");
    const borders = declarations(rule.body, "border");
    const isExempt = key in exempt;
    if (borders.some(drawsVisibleBorder) && shadows.some((v) => castsOuterShadow(v))) {
      if (isExempt) exemptSeen.add(key);
      else bump("border+shadow", found.borderAndShadow, key, site);
    }
    for (const value of shadows) {
      if (spendsTokens(value)) continue;
      if (isExempt) { exemptSeen.add(key); continue; }
      const kind = shadowKind(value);
      found.shadowOutsideTokens[kind] ??= {};
      bump(`shadow:${kind}`, found.shadowOutsideTokens[kind], key, site);
    }
  }
}

const sortKeys = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, typeof v === "object" ? sortKeys(v) : v]));

if (process.argv.includes("--dump")) {
  console.log(JSON.stringify(sortKeys(found), null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------- compare

const problems = [];

for (const [key, reason] of Object.entries(exempt)) {
  if (!reason || typeof reason !== "string") problems.push(`exempt   ${key.replace("|", "  ")}  needs a reason, not ${JSON.stringify(reason)}`);
  else if (!exemptSeen.has(key)) problems.push(`exempt   ${key.replace("|", "  ")}  breaks neither rule any more — take the entry out`);
}

function ratchet(label, actual, listed) {
  for (const [key, count] of Object.entries(actual)) {
    const limit = listed[key] ?? 0;
    if (count > limit) {
      problems.push(`${label}  ${key.replace("|", "  ")}  ${count} (list allows ${limit})   at ${sites.get(`${label}|${key}`).join(", ")}`);
    }
  }
  for (const [key, limit] of Object.entries(listed)) {
    const count = actual[key] ?? 0;
    if (count < limit) {
      problems.push(`${label}  ${key.replace("|", "  ")}  listed ${limit}, now ${count} — ${count ? `lower the entry to ${count}` : "remove the entry"}`);
    }
  }
}

ratchet("border+shadow", found.borderAndShadow, allowed.borderAndShadow ?? {});
for (const kind of new Set([...Object.keys(found.shadowOutsideTokens), ...Object.keys(allowed.shadowOutsideTokens ?? {})])) {
  ratchet(`shadow:${kind}`, found.shadowOutsideTokens[kind] ?? {}, allowed.shadowOutsideTokens?.[kind] ?? {});
}

assert.deepEqual(
  problems,
  [],
  `elevation broken in ${problems.length} place(s) — a new violation, or an allowlist entry the stylesheets no longer need:\n\n${problems.join("\n")}\n`,
);

const total = (entries) => Object.values(entries).reduce((sum, n) => sum + n, 0);
const kinds = Object.entries(found.shadowOutsideTokens);
console.log(
  `elevation OK — ${files.length} stylesheets; ${Object.keys(exempt).length} exempt by decision; still allowlisted: ` +
    `${total(found.borderAndShadow)} rules with a border and an outer shadow, ` +
    `${kinds.reduce((sum, [, entries]) => sum + total(entries), 0)} shadows outside the tokens ` +
    `(${kinds.map(([kind, entries]) => `${kind} ${total(entries)}`).join(", ")})`,
);
