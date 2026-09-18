/**
 * Every `var(--x)` names a token that exists, and every token is spent.
 *
 * This is the one CSS failure the design-vocabulary and elevation tests cannot
 * see, because it is not a value they can read: a `var()` pointing at a custom
 * property nobody declares resolves to the *guaranteed-invalid value*, which
 * makes the **whole declaration** invalid at computed-value time. Not the one
 * layer — the declaration. Measured in Chromium:
 *
 *   background: radial-gradient(…, var(--missing), …), var(--real)  →  transparent
 *   border: 1px solid var(--missing)                                →  no border
 *   color: var(--missing)                                           →  inherited
 *
 * So a stale token name does not degrade a rule, it deletes it, and nothing
 * anywhere says so: the stylesheet parses, the build passes, the screen just
 * quietly loses its ground. Twelve dead token names across twenty-four uses
 * were found on 2026-09-18, each alive for months — the Training Library's
 * whole background stack (`--bg-ambient-green`, a name from a palette that
 * predates the accent tokens), the Hevy dialog's fill, the backup-restore
 * cards, two Watch Face device panels, the Gear screen's error tint and its
 * sign-in panel, and a `--danger` nothing has ever declared.
 * `--wf-shadow-soft` was the same bug found by hand one phase earlier, which
 * is what suggested the sweep.
 *
 * Two assertions, both at zero and meant to stay there:
 *
 *   1. A `var(--x)` names a token declared in some stylesheet, or written from
 *      the renderer (`style.setProperty("--x", …)`, `style={{ "--x": … }}`).
 *      A fallback does not excuse it: `var(--phantom, 12px)` renders correctly
 *      and still claims a token that does not exist, which is how four of them
 *      survived a reader's eye.
 *   2. A token that is declared is read somewhere — by CSS or by the renderer.
 *      A name built at runtime (`--m3d-heat-${level}`) counts through its
 *      prefix, so the whole family stays.
 *
 * Neither list has an allowlist. If one has to grow, say why in the change
 * that grows it.
 *
 * Run: npm run test:css-tokens
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

function filesUnder(dir, test) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, test));
    else if (test(name)) out.push(full);
  }
  return out.sort();
}

const cssFiles = filesUnder(SRC, (name) => name.endsWith(".css"));
const codeFiles = filesUnder(SRC, (name) => /\.(ts|tsx)$/.test(name));

/** Comments blanked in place, so line numbers survive. */
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

// --- what the stylesheets declare and read ---------------------------------

const declared = new Map(); // name -> "file:line"
const read = new Map(); // name -> ["file:line", …]
const varUses = []; // { name, where, hasFallback }

for (const file of cssFiles) {
  const where = relative(ROOT, file);
  blankComments(readFileSync(file, "utf8"))
    .split("\n")
    .forEach((line, index) => {
      for (const m of line.matchAll(/(?:^|[;{]|^\s*)\s*(--[\w-]+)\s*:/g)) {
        if (!declared.has(m[1])) declared.set(m[1], `${where}:${index + 1}`);
      }
      for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*(,?)/g)) {
        varUses.push({ name: m[1], where: `${where}:${index + 1}`, hasFallback: m[2] === "," });
        if (!read.has(m[1])) read.set(m[1], []);
        read.get(m[1]).push(`${where}:${index + 1}`);
      }
    });
}

// --- what the renderer writes and reads ------------------------------------

/** Names the renderer spells in full, and the heads of the ones it builds. */
const fromCode = new Set();
const codePrefixes = new Set();

for (const file of codeFiles) {
  const text = readFileSync(file, "utf8");
  // "--x" / '--x' / `--x`, and the head of `--x-${…}`.
  for (const m of text.matchAll(/["'`](--[\w-]+)(["'`]|\$\{)/g)) {
    if (m[2] === "${") codePrefixes.add(m[1]);
    else fromCode.add(m[1]);
  }
  // "--x" + something, the other way a name is built.
  for (const m of text.matchAll(/["'`](--[\w-]+)["'`]\s*\+/g)) codePrefixes.add(m[1]);
}

const knownToCode = (name) =>
  fromCode.has(name) || [...codePrefixes].some((prefix) => name.startsWith(prefix));

// --- 1. no var() names a token that does not exist -------------------------

const missing = varUses
  .filter(({ name }) => !declared.has(name) && !knownToCode(name))
  .map(({ name, where, hasFallback }) => `${where}  ${name}${hasFallback ? "  (has a fallback, still a phantom)" : ""}`);

assert.deepEqual(
  missing,
  [],
  `var() naming a token nothing declares — the whole declaration is dropped at computed-value time:\n  ${missing.join("\n  ")}\n`,
);

// --- 2. no token is declared and never spent -------------------------------

const unused = [...declared]
  .filter(([name]) => !read.has(name) && !knownToCode(name))
  .map(([name, where]) => `${where}  ${name}`);

assert.deepEqual(
  unused,
  [],
  `custom properties declared and never read:\n  ${unused.join("\n  ")}\n`,
);

console.log(
  `css tokens OK — ${cssFiles.length} stylesheets, ${declared.size} tokens, ${varUses.length} var() uses, none phantom and none unspent`,
);
