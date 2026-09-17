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
 *   2. Every `box-shadow` spends a token: `--shadow-soft`, `--shadow-card`,
 *      `--shadow-elevated` or `--shadow-inset`, alone or as a comma list — or
 *      is `none`. (The focus ring is an outline, so it never meets either rule.)
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
 * and are right to: a watch face's bezel is a 9px border around a preview and
 * the ring beside it is the strap's edge, not a card's; the recovery ring's
 * halo is the datum. Those sit in `exempt` with the reason written out, are
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
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
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

/** What a shadow outside the token set is, so the list reads as a to-do rather than a heap. */
function shadowKind(value) {
  const layers = splitTop(value, ",");
  const literal = layers.filter((l) => !l.startsWith("var("));
  if (!literal.length) return "token-outside-set";
  const kinds = literal.map((layer) => {
    if (/\binset\b/.test(layer)) return "inset";
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths(layer);
    if (x === 0 && y === 0 && blur === 0 && spread !== 0) return "ring";
    if (x === 0 && y === 0) return "glow";
    return "elevation";
  });
  return ["elevation", "glow", "ring"].find((kind) => kinds.includes(kind)) ?? "inset";
}

const spendsTokens = (value) =>
  value === "none" ||
  splitTop(value, ",").every((layer) => {
    const name = layer.match(/^var\((--[\w-]+)\)$/)?.[1];
    return name !== undefined && SHADOW_TOKENS.has(name);
  });

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
    const key = `${relative(ROOT, file)}|${rule.selector}`;
    const site = `${relative(ROOT, file)}:${rule.line}`;
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
