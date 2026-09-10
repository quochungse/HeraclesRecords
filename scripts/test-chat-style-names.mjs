/**
 * Every class the Coach screens render must have a rule behind it.
 *
 * This suite exists because of how the Automation → Analysis rename failed.
 * The renderer was renamed thoroughly — `chat-automation-chip` became
 * `chat-analysis-chip`, `chat-session-row-automation-mark` became
 * `chat-session-row-analysis-mark`, nine class names in all — and
 * `src/styles.css` was not. Nothing noticed: a class with no rule is not an
 * error in CSS, it is simply an element with no styling. `tsc` cannot see
 * inside a string, `npm run build` passed, and every Coach suite passed with
 * the run-log chips, the ⚡ mark and the transcript attribution rendering as
 * unstyled text. Only opening the app showed it.
 *
 * So the invariant is written down here: a class used under `src/chat` is
 * defined in the stylesheet, and no rule is left addressing the old spelling.
 *
 * Scope is `src/chat` on purpose. The same sweep over the whole renderer
 * reports about forty classes that were already unstyled before this feature
 * existed — that is a separate clean-up, and folding it in here would leave a
 * suite that fails for reasons it is not about.
 *
 * Run: npm run test:chat-style-names
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const chatDir = path.join(repoRoot, "src", "chat");

/**
 * Classes that were already unstyled before the Coach analyses work and are
 * left to their own clean-up. Each is a class the renderer names and the
 * stylesheet has never had a rule for — harmless where it sits (a bare
 * semantic hook, or a leftover), but not something this suite should adopt.
 * Removing one from this list is only ever right once a rule exists for it.
 */
const KNOWN_UNSTYLED = new Set([
  "chat-bubble-tool-notice",
  "chat-local-field-key",
  "chat-view-login",
  // A modifier beside `chat-plan-card`; only its `-kicker` child has a rule.
  "chat-workout-card",
  "chat-workout-entries",
  "is-pinned",
  "is-url"
]);

/** The old spelling, which must not survive anywhere in the stylesheet. */
const RENAMED_AWAY = [
  "chat-automation-chip",
  "chat-automation-chip-static",
  "chat-automation-chip-trigger",
  "chat-automation-attribution",
  "chat-automation-attribution-trigger",
  "chat-automation-prompt",
  "chat-row-automation",
  "chat-session-row-automation-mark"
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const css = readFileSync(path.join(repoRoot, "src", "styles.css"), "utf8");
const defined = new Set(
  [...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1])
);

/**
 * Only literal class strings. A class assembled from a template is a decision
 * a reader can see; the ones that rot silently are the spelled-out names, and
 * those are what this reads.
 */
function classesIn(source) {
  const found = new Set();
  const collect = (text) => {
    for (const name of text.split(/\s+/)) {
      if (name && name.includes("-")) found.add(name);
    }
  };
  for (const match of source.matchAll(/className\s*=\s*"([^"{}]+)"/g)) {
    collect(match[1]);
  }
  // className={[...]} / className={cond ? "a" : "b"} — the string literals in
  // the expression, which are class names in every use under src/chat.
  for (const match of source.matchAll(/className=\{([^}]*)\}/gs)) {
    for (const literal of match[1].matchAll(/"([a-z][\w-]*(?:\s+[a-z][\w-]*)*)"/g)) {
      collect(literal[1]);
    }
  }
  return found;
}

const files = walk(chatDir);
assert.ok(files.length > 5, "expected the Coach renderer to be where it was");

const missing = [];
for (const file of files) {
  const relative = path.relative(repoRoot, file);
  for (const name of classesIn(readFileSync(file, "utf8"))) {
    if (defined.has(name) || KNOWN_UNSTYLED.has(name)) continue;
    missing.push(`${name}  (${relative})`);
  }
}

assert.deepEqual(
  missing,
  [],
  `Coach classes with no rule in src/styles.css:\n  ${missing.join("\n  ")}`
);

for (const name of RENAMED_AWAY) {
  assert.ok(
    !css.includes(`.${name}`),
    `src/styles.css still styles ".${name}", which no renderer names any more`
  );
}

// The stylesheet holding a rule nothing renders is the other half of the same
// mistake, and these are the ones the rename left behind.
for (const name of ["chat-coaches-manage", "chat-coaches-attach", "chat-coaches-create"]) {
  const styled = css.includes(`.${name}`);
  const rendered = files.some((file) =>
    readFileSync(file, "utf8").includes(name)
  );
  assert.equal(
    styled,
    rendered,
    `".${name}" must be styled exactly when it is rendered (styled: ${styled}, rendered: ${rendered})`
  );
}

console.log(
  `chat style names OK — ${files.length} Coach files, every class rendered has a rule and the pre-rename spellings are gone`
);
