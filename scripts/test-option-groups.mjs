/**
 * The option control is a closed set, and this is what closes it.
 *
 * Before `OptionGroup` there were about thirty spellings of "choose one of
 * these" — a chip 13px on one screen and 12px on the next, four ways of
 * marking the chosen one (`.is-active`, `.is-selected`, `.active`,
 * `[data-active]`) and three ARIA roles for the same row of mutually exclusive
 * buttons. None of it was decided. It accumulated, one screen at a time,
 * because writing the markup again is easy and noticing that the control
 * already exists somewhere else is not.
 *
 * So this test fails when a screen grows its own again. Four passes:
 *
 *   1. No native `<select>`. It is the one control the operating system draws,
 *      so it never follows the theme — on paper it read as borrowed, and on
 *      a dark panel it read as broken.
 *   2. No hand-written option group: a list of buttons carrying `aria-pressed`
 *      or `aria-checked`, or a container with a `radiogroup` role, outside
 *      `OptionGroup` itself and the handful of decisions listed below.
 *   3. The period labels live in one place. Six screens used to answer "how
 *      far back" in their own words — ninety days was "3 months", "90 days"
 *      and "Last 90 days" depending on where you looked — so a screen that
 *      writes a period label of its own fails here.
 *   4. The component's own vocabulary is present: a chip states its size once,
 *      the chosen chip is marked the same way whether the group is open or
 *      folded, and the collapsible mode animates a grid column rather than a
 *      magic max-width.
 *   5. **A collapsible group's open row keeps the declared order, and its
 *      labels fade rather than travelling.** The order is the invariant: a
 *      version that lifted the chosen option out of the row to stop anything
 *      moving left an open row that no longer read in the order it was given.
 *
 * Run: npm run test:option-groups
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

/**
 * Controls that are deliberately not an OptionGroup. Each names the file and a
 * string from the element itself, so an exemption covers one control rather
 * than opening a whole file, and each says why.
 *
 * They fall into four kinds, and none of them is "a set of options laid out in
 * a row", which is the only thing OptionGroup is for:
 *   - a grid whose arrangement carries meaning, or cards that need a sentence;
 *   - a list of records — plans, places, search results — where the buttons
 *     come from data rather than from a fixed set of choices;
 *   - a menu, which has its own roles and its own popup;
 *   - a table's sort header, where the pressed state means "sorted by this".
 */
const EXEMPT = [
  {
    file: "src/mapBase/MapLayerControl.tsx",
    marker: "basemap-option",
    why: "The floating base-map popup mixes a base-map choice with overlay switches under a divider; it is a menu, not one group."
  },
  {
    file: "src/data/components/ActivityBackupPanel.tsx",
    marker: "Export format",
    why: "Each format carries a sentence describing it; nested in a chip there is nowhere for that to go."
  },
  {
    file: "src/data/components/ActivityBackupPanel.tsx",
    marker: "training-backup-format-option",
    why: "Same control as above — the cards themselves."
  },
  {
    file: "src/training-library/TrainingPlanGenerator.tsx",
    marker: "plan-generator-segmented",
    why: "A difficulty card is two lines: the name and what it means for the plan."
  },
  {
    file: "src/chat/analyses/AnalysisCreate.tsx",
    marker: "coach-analysis-starter",
    why: "Starter cards carry a description and the trigger they would set — a chip holds neither."
  },
  {
    file: "src/calendar/AddWorkoutModal.tsx",
    marker: "calendar-sport-card",
    why: "A searchable grid of every COROS activity type: the search box above it makes this a combobox, not a fixed set."
  },
  {
    file: "src/trainingMap/ActivityGlobeCard.tsx",
    marker: "recentPlaces.map",
    why: "Places visited, drawn from the data. Selecting one moves the globe; it does not choose a mode."
  },
  {
    file: "src/App.tsx",
    marker: "apple-podcast-result",
    why: "Search results. The pressed state marks which result is open, not which option is chosen."
  },
  {
    file: "src/components/StartupViewMenu.tsx",
    marker: "menuitemradio",
    why: "A menu, with the menu roles and a popup of its own."
  },
  {
    file: "src/training-library/MonthDayPicker.tsx",
    marker: "tl-daypick-day",
    why: "A month of days: the grid's arrangement is the control — a day is found by the week it sits in, which a row of chips cannot say."
  },
  {
    file: "src/calendar/ExercisePickerDialog.tsx",
    marker: "exercise-picker-facet",
    why: "The exercise library's value column: a scrolling column of up to sixteen muscles, each a picture of where it sits on the body, its anatomical name and how many movements are filed under it. A chip row holds none of that, and the picture is the point — it is what makes the column readable without knowing the words."
  },
  {
    file: "src/strength/BodyMapV2.tsx",
    marker: "layerPreferences.order.map",
    why: "Muscle layer visibility is a reorderable list, not a choice between options."
  }
];

/** True when this file exempts something matching `text`. */
function exempt(rel, text) {
  return EXEMPT.some(
    (entry) => entry.file === rel && text.includes(entry.marker)
  );
}

/** Where the component itself lives, and so may contain what it forbids. */
const COMPONENT = "src/components/OptionGroup.tsx";

/** The one place period labels are written. */
const PERIOD_SCALE = "src/preferences/periodScale.ts";

/**
 * Labels the scale owns. A screen spelling one of these itself is how the six
 * vocabularies grew, so it fails here even when it happens to match.
 */
const PERIOD_LABELS = [
  "4 weeks",
  "3 months",
  "6 months",
  "Last 30 days",
  "Last 90 days",
  "Last 365 days",
  "90 days",
  "30 days"
];

function sourceFiles(dir, extensions) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, extensions));
    else if (extensions.some((ext) => name.endsWith(ext))) out.push(full);
  }
  return out.sort();
}

const tsx = sourceFiles(SRC, [".tsx"]).map((file) => ({
  file,
  rel: repoRelative(file),
  text: readFileSync(file, "utf8")
}));

const violations = [];
const fail = (rel, line, why) => violations.push(`${rel}:${line}  ${why}`);
const lineAt = (text, index) => text.slice(0, index).split("\n").length;

// ---------------------------------------------------------------------------
// 1. No native select
// ---------------------------------------------------------------------------

let selects = 0;
for (const { rel, text } of tsx) {
  for (const match of text.matchAll(/<select[\s>]/g)) {
    selects += 1;
    fail(
      rel,
      lineAt(text, match.index),
      "a native <select> is drawn by the OS and never follows the theme — use OptionGroup in dropdown mode"
    );
  }
}

// ---------------------------------------------------------------------------
// 2. No hand-written option group
// ---------------------------------------------------------------------------

let handWritten = 0;
for (const { rel, text } of tsx) {
  if (rel === COMPONENT) continue;

  for (const match of text.matchAll(/role="radiogroup"[^>]*>/g)) {
    // The class usually sits before the role, so the whole opening tag is what
    // an exemption has to be matched against.
    const open = text.lastIndexOf("<", match.index);
    if (exempt(rel, text.slice(open, match.index + match[0].length))) continue;
    handWritten += 1;
    fail(
      rel,
      lineAt(text, match.index),
      "a radiogroup is what OptionGroup builds — declare the options, not the markup"
    );
  }

  // The shape every one of the thirty copies had: one `<button>` that is both
  // rendered from a list (it has a `key`) and carries a chosen state. Both
  // halves are load-bearing. Without `key` this catches a lone toggle, which
  // is one thing on or off and not an option group; without the state it
  // catches every list of rows in the app. The test reads the button's own
  // tag rather than a window of following text, which is what made a list of
  // podcast results and a list of visited places read as option groups.
  for (const match of text.matchAll(/<button\b[^>]*>/g)) {
    const tag = match[0];
    if (!/\bkey=\{/.test(tag)) continue;
    if (!/aria-(?:pressed|checked)=\{/.test(tag)) continue;
    // The marker may sit on the button or in the few lines that produced it —
    // a `.map(` over records, a container class one level up.
    if (exempt(rel, text.slice(Math.max(0, match.index - 400), match.index + tag.length)))
      continue;
    handWritten += 1;
    fail(
      rel,
      lineAt(text, match.index),
      "a list of buttons carrying a chosen state is an option group — use OptionGroup or OptionChips"
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Period labels come from the scale
// ---------------------------------------------------------------------------

let strayLabels = 0;
for (const { rel, text } of [
  ...tsx,
  ...sourceFiles(SRC, [".ts"]).map((file) => ({
    file,
    rel: repoRelative(file),
    text: readFileSync(file, "utf8")
  }))
]) {
  if (rel === PERIOD_SCALE) continue;
  // Comments explain the history and may quote the old spellings.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
                   .replace(/\/\/[^\n]*/g, (c) => " ".repeat(c.length));
  for (const label of PERIOD_LABELS) {
    for (const match of code.matchAll(new RegExp(`["\`']${label}["\`']`, "g"))) {
      strayLabels += 1;
      fail(
        rel,
        lineAt(code, match.index),
        `"${label}" is the scale's word — take it from periodScale.ts, or the app grows a seventh vocabulary`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. The component's own vocabulary
// ---------------------------------------------------------------------------

const styles = readFileSync(join(SRC, "styles.css"), "utf8");

assert.match(
  styles,
  /\.option-group button \{[^}]*min-height: 28px;/,
  "the chip states its height once, on .option-group button"
);
assert.match(
  styles,
  /\.option-group button\[aria-checked="true"\] \{\s*background: var\(--accent-soft\);\s*color: var\(--accent-strong\);/,
  "the chosen chip is a wash of the accent with the accent's own ink — the Calendar's Month/Week mark"
);

/*
 * A folded group shows one chip, and it is the chosen one, so it has to be
 * marked as chosen. The rule has to outrank `.option-group button` (a class
 * and an element) or it loses outright and the collapsed state says nothing —
 * which is what a bare `.option-group-trigger` did.
 */
const component = readFileSync(join(ROOT, COMPONENT), "utf8");

assert.match(
  styles,
  /\.option-group \.option-group-trigger \{\s*background: var\(--accent-soft\);\s*color: var\(--accent-strong\);/,
  "the collapsed group's lead chip wears the chosen mark, at a specificity that beats .option-group button"
);

assert.doesNotMatch(
  styles,
  /--accent-ink/,
  "--accent-ink is gone: the chosen chip is a wash now, so there is no filled accent to find ink for"
);
/*
 * **Collapsible animates one measured width, and holds one copy of each
 * option.**
 *
 * Three shapes have stood here. A `max-width` needed a number picked in
 * advance and silently clipped any label longer than it. Two grid columns —
 * a lead chip and the row beside it — drew the chosen option twice and
 * collapsed one while growing the other, so the row's first chip slid the
 * lead's whole width on the way open, under a copy of itself being clipped
 * away; lining the endpoints up did not touch the path between them. What
 * holds now is the group's own width, from the chosen chip's to the row's,
 * both **measured** in the component — so nothing is clipped that was meant
 * to be read, and nothing inside the row moves except when the chosen option
 * is not the first and has to travel to its own place in the order.
 */
assert.match(
  styles,
  /\.option-group--collapsible \{[^}]*transition: width var\(--dur-base\)/,
  "collapsible animates its own width, between the two measured ends"
);
assert.match(
  styles,
  /\.option-group--collapsible \{[^}]*width: var\(--og-folded/,
  "folded, that width is the chosen chip's"
);
assert.match(
  styles,
  /\.option-group--collapsible\[data-open="true"\] \{[^}]*width: var\(--og-open/,
  "open, it is the whole row's"
);
assert.doesNotMatch(
  component,
  /option-group-lead/,
  "there is no lead element: it was a second copy of the chosen option, and the " +
    "two could not be animated without one sliding past the other"
);
assert.match(
  component,
  /setProperty\("--og-folded"/,
  "and the widths are measured rather than chosen"
);

/*
 * **A revealed label fades; it does not travel.**
 *
 * The row's labels came in from `translateX(-5px)`, which is a 5px shove to
 * the right on every one of them at the end of the open — and on the row's
 * first chip that was the whole of what could be seen to move: "All" settling
 * sideways a beat after it appeared. The clipping edge is already doing the
 * reveal; the text does not have to go anywhere.
 *
 * The open row still holds every option at its declared place, which is what
 * `option-group-rest` renders. A version of this filtered the chosen option
 * out of that row so that nothing could move at all, and the cost was an open
 * row whose order no longer matched the order the caller gave — so the order
 * is the invariant and the movement is what gets fixed around it.
 */
assert.doesNotMatch(
  styles,
  /\.option-group--collapsible[^{]*\.option-group-label \{[^}]*translateX/,
  "a revealed label fades and does not travel — a translateX is a shove to the " +
    "side on every label at the end of the open"
);
assert.match(
  component,
  /\{options\.map\(\(option\) => renderOption\(option, true\)\)\}/,
  "the collapsible row renders every option, in the order it was given"
);
assert.doesNotMatch(
  styles,
  /\.option-group[^{]*\{[^}]*max-width: \d+px/,
  "no magic max-width on the option control: that is what clipped labels in the version it replaces"
);

assert.match(
  component,
  /aria-checked=\{isSelected\}/,
  "single-select states the chosen option with aria-checked inside a radiogroup"
);
assert.match(
  component,
  /aria-pressed=\{pressed\}/,
  "multi-select states each chip with aria-pressed — they are independent toggles, not one radiogroup"
);
assert.doesNotMatch(
  component,
  /option-group-caret/,
  "a collapsible chip carries no caret: at rest it reads as the current value first"
);

// ---------------------------------------------------------------------------

if (violations.length > 0) {
  console.error(`\noption groups — ${violations.length} problem(s):\n`);
  for (const line of violations) console.error("  " + line);
  console.error(
    "\nThe exemptions are listed at the top of this file, each with its reason.\n"
  );
  process.exit(1);
}

console.log(
  `option groups OK — ${tsx.length} components, ${selects} native selects, ` +
    `${handWritten} hand-written groups, ${strayLabels} stray period labels, ` +
    `${EXEMPT.length} exempt by decision`
);
