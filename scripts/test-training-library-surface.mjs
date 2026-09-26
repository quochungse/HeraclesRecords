/**
 * Four things about the Training Library that a typecheck cannot see, each of
 * which shipped broken and each of which fails silently.
 *
 * 1. `window.prompt` is not implemented in Electron. It throws
 *    `prompt() is not supported.` from the renderer — verified against a real
 *    BrowserWindow, not read off a changelog. Four flows reached for it
 *    (tagging a workout, tagging a plan, naming a duplicate, moving a missed
 *    session) and every one of them did nothing at all when clicked: an
 *    uncaught throw inside a React event handler is not caught by an error
 *    boundary, so there was no message anywhere, only a button that did not
 *    work. It typechecks, because `window.prompt` is in lib.dom.
 *
 * 2. A create action the index declares but never renders. `PlanIndex` took
 *    `onCreate` and `onGenerate` for a day and rendered neither — dropped as
 *    collateral when the layout switch moved to `OptionGroup` — so there was
 *    no way to make a plan or a template, and AI Plan — the generator then,
 *    a new plan conversation in Coach now — was unreachable. Unused props and unused imports both typecheck.
 *
 * 3. The "collection" concept is gone and must stay gone. COROS serves four
 *    training endpoints — program, plan, schedule and exercise — and not one
 *    of them knows about a collection; it was invented upstream, and in this
 *    fork it was write-only. `dropRetiredCollectionTable` removes the table
 *    and the column, so a control that wrote one again would be writing
 *    somewhere that no longer exists.
 *
 * 4. `training_plans` and its neighbours are `personal` tier and travel
 *    between machines, so the screen has to re-read on a pull that touches
 *    them. Without it a plan built on the laptop sits in SQLite here behind
 *    the list read on mount.
 *
 * 5. A grid row declares one track per cell it draws, at every width. The
 *    plan row hid three of its nine children below 900px and declared five
 *    tracks, so the actions cell fell into an implicit second row — on every
 *    narrow window, silently, because an implicit grid row is valid CSS.
 *
 * 6. Two entities, two tabs. A workout is one session with no date; a plan is
 *    a multi-week schedule of them. They share four attributes and not one
 *    figure, so they get two tabs rather than one list with a facet — and
 *    "template", which was a usage mode living in the field that answers
 *    where a plan came from, is gone with the third tab it forced.
 *
 * Static, so it runs anywhere: `node scripts/test-training-library-surface.mjs`.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const libraryRoot = path.join(srcRoot, "training-library");

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

const read = (file) => readFileSync(file, "utf8");

/**
 * Source with its comments taken out, for the scans that ask what the code
 * *does*. Prose explaining why something was removed names it, and a blunt
 * scan reads that as the thing coming back.
 */
const code = (file) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\r\n]*/g, "$1");

const rel = (file) => path.relative(repoRoot, file).replaceAll("\\", "/");

/** `<table>: "<tier>"` as syncPolicy.ts spells it, for one named table. */
const tierOf = (policy, table) =>
  policy.match(new RegExp(String.raw`\b${table}:\s*"(\w+)"`))?.[1];

// ---------------------------------------------------------------------------
// 1. Nothing in the renderer calls window.prompt
// ---------------------------------------------------------------------------
{
  const offenders = walk(srcRoot)
    .filter((file) => /\bwindow\.prompt\s*\(/.test(read(file)))
    .map(rel);
  assert.deepEqual(
    offenders,
    [],
    `window.prompt throws in Electron; these files still call it: ${offenders.join(", ")}`
  );
}

// ---------------------------------------------------------------------------
// 2. The plan index renders the create actions it declares
// ---------------------------------------------------------------------------
{
  const view = read(path.join(libraryRoot, "TrainingLibraryView.tsx"));
  // To the end of the file rather than to whatever declaration happens to
   // follow: a named end marker is a second thing that has to stay true, and
   // this check already lost once to a boundary that was deleted.
  const start = view.indexOf("function PlanIndex(");
  assert.ok(start > 0, "PlanIndex must be findable to be checked");
  const planIndex = view.slice(start);

  for (const handler of ["onCreate", "onGenerate"]) {
    assert.ok(
      planIndex.includes(`onClick={${handler}}`),
      `PlanIndex declares ${handler} but never renders a control that calls it — ` +
        "there is then no way to make a plan, or to reach the generator"
    );
  }

  // AI Plan opens Coach on a blank brief (P2.5): the generator dialog it used
  // to open is gone, and must not come back beside the conversation.
  assert.ok(
    view.includes("onGenerate={() => onOpenCoach({ newPlan: true })}"),
    "AI Plan must open a new plan conversation in Coach"
  );
  assert.ok(!view.includes("TrainingPlanGenerator"), "the generator dialog is gone");
}

// ---------------------------------------------------------------------------
// 3. The collection concept is gone from the renderer and the contract
// ---------------------------------------------------------------------------
{
  const offenders = walk(srcRoot)
    .filter((file) => /collectionId|TrainingCollection/.test(read(file)))
    .map(rel);
  assert.deepEqual(
    offenders,
    [],
    "COROS has no collection endpoint and the table is dropped on open; these " +
      `files still name one: ${offenders.join(", ")}`
  );

  const policy = read(path.join(repoRoot, "electron", "sync", "syncPolicy.ts"));
  assert.ok(
    !/^\s*training_collections:/m.test(policy),
    "syncPolicy must not classify training_collections — a classified name lets " +
      "a row from a machine still on the old build recreate the table on merge"
  );

  const schema = read(path.join(repoRoot, "electron", "database.ts"));
  assert.ok(
    schema.includes("dropRetiredCollectionTable"),
    "the drop migration has to run on open, or an upgraded machine keeps the table"
  );
  assert.ok(
    !/CREATE TABLE IF NOT EXISTS training_collections/.test(schema),
    "the schema block must not recreate what the migration drops"
  );
}

// ---------------------------------------------------------------------------
// 4. The screen re-reads when a pull touches the tables it is built from
// ---------------------------------------------------------------------------
{
  const view = read(path.join(libraryRoot, "TrainingLibraryView.tsx"));
  assert.ok(
    view.includes("api.onSyncChanged("),
    "the library's tables are personal tier and travel; a pull that touches " +
      "them must reach this screen, or it keeps the list it read on mount"
  );

  const setStart = view.indexOf("LIBRARY_SYNCED_TABLES");
  const setEnd = view.indexOf("]);", setStart);
  assert.ok(setStart > 0 && setEnd > setStart, "the watched set must be findable");
  const watched = view
    .slice(setStart, setEnd)
    .match(/"([a-z_]+)"/g)
    .map((value) => value.slice(1, -1));
  assert.ok(watched.length >= 3, "the watched set must name the library's tables");

  // The tables it watches must be ones sync actually carries, spelled the same.
  const policy = read(path.join(repoRoot, "electron", "sync", "syncPolicy.ts"));
  for (const table of watched) {
    const tier = tierOf(policy, table);
    assert.ok(
      tier,
      `${table} is watched for sync changes but syncPolicy.ts does not classify it — ` +
        "an unclassified table syncs nowhere, so the subscription would never fire"
    );
    assert.notEqual(
      tier,
      "device",
      `${table} is device tier, so it never arrives from another machine — ` +
        "watching it claims something that cannot happen"
    );
  }

  // `tables`, not a count: reloading on every pull costs a COROS round trip.
  assert.ok(
    view.includes("change.tables.some("),
    "the subscription must select on change.tables rather than reloading on every pull"
  );
}

// ---------------------------------------------------------------------------
// 5. Every width declares one grid track per cell the row draws
// ---------------------------------------------------------------------------
{
  /* Comments out first: a rule's selector is whatever precedes its brace,
     and the prose above these rules is long. */
  const css = read(path.join(libraryRoot, "trainingLibrary.css")).replace(
    /\/\*[\s\S]*?\*\//g,
    " "
  );

  /** Top-level tracks: `minmax(0, 1fr)` and `var(--x)` are one each. */
  const countTracks = (value) => {
    let depth = 0;
    let tracks = 0;
    let inToken = false;
    for (const char of value) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      if (depth === 0 && /\s/.test(char)) inToken = false;
      else if (!inToken) {
        inToken = true;
        tracks += 1;
      }
    }
    return tracks;
  };

  /*
   * The file as regions: the base rules, then one per `@media`. A max-width
   * query applies on top of every wider one, so what a narrow window hides is
   * the union of the blocks at and above its width.
   */
  const regions = [];
  let cursor = 0;
  for (;;) {
    const at = css.indexOf("@media", cursor);
    const head = css.slice(cursor, at === -1 ? undefined : at);
    if (head.trim()) regions.push({ width: Number.POSITIVE_INFINITY, css: head });
    if (at === -1) break;
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}" && (depth -= 1) === 0) break;
    }
    const width = Number(css.slice(at, open).match(/max-width:\s*(\d+)px/)?.[1] ?? NaN);
    regions.push({ width: Number.isNaN(width) ? Number.POSITIVE_INFINITY : width, css: css.slice(open + 1, end) });
    cursor = end + 1;
  }
  regions.sort((left, right) => right.width - left.width);

  /*
   * A row's cell count is what its widest declaration says, and every
   * narrower block has to add back up to it: tracks declared plus children
   * hidden at or above that width.
   */
  /*
   * `.tl-plan-row` stood here beside it and is gone with the table layout the
   * Plans tab used to offer: a plan is a shape across weeks, which a tile
   * draws at tile width, and the one thing a table could do that tiles cannot
   * — sort by clicking a heading — was already a dropdown above it.
   */
  for (const row of [".tl-workout-row"]) {
    let cells;
    let declared;
    const hidden = new Set();

    for (const region of regions) {
      for (const [, selector, body] of region.css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = selector
          .split(",")
          .map((part) => part.replace(/\s+/g, " ").trim());
        const tracks = body.match(/grid-template-columns:\s*([^;]+);/);
        if (tracks && selectors.includes(row)) declared = countTracks(tracks[1]);
        if (!/display:\s*none/.test(body)) continue;
        for (const part of selectors) {
          if (!part.startsWith(`${row} > :nth-child(`)) continue;
          hidden.add(Number(part.slice(part.indexOf("(") + 1, part.indexOf(")"))));
        }
      }

      if (declared === undefined) continue;
      if (region.width === Number.POSITIVE_INFINITY) {
        cells = declared + hidden.size;
        continue;
      }
      assert.equal(
        declared + hidden.size,
        cells,
        `${row} below ${region.width}px declares ${declared} grid tracks and hides ` +
          `${hidden.size} of its ${cells} cells. The leftover cells land in an implicit ` +
          "second row, which is valid CSS, renders as a broken table, and is what the " +
          "actions column did on every window under 900px"
      );
    }

    /* Found at all, rather than found with some minimum width: the workout
       row is two columns now, and a floor is a second claim that goes stale. */
    assert.notEqual(cells, undefined, `${row} must declare its columns somewhere`);
  }
}

// ---------------------------------------------------------------------------
// 6. Two tabs, and no third entity hiding in `source`
// ---------------------------------------------------------------------------
{
  const view = read(path.join(libraryRoot, "TrainingLibraryView.tsx"));
  const sections = view.match(/type LibrarySection = ([^;]+);/);
  assert.ok(sections, "the tab list must be findable");
  assert.equal(
    sections[1].replace(/\s+/g, " ").trim(),
    '"workouts" | "plans"',
    "a workout and a plan are the two entities COROS serves; anything else here " +
      "is a usage mode or a view, and belongs in a filter"
  );

  /*
   * A plan is a COROS plan (docs/training-plan-coros-first.md): there is no
   * `source` to branch on and no local store behind it. The concepts that
   * came with local plans — a source field, calendar installs recorded by the
   * app, a template kind — must not come back in the types either.
   */
  const types = read(path.join(repoRoot, "electron", "types.ts"));
  for (const retired of ["TrainingPlanSource", "calendarInstalls", "TrainingPlanCalendarInstall", "TrainingPlanPhase"]) {
    assert.equal(types.includes(retired), false, `${retired} belonged to local plans and is retired`);
  }

  const offenders = walk(srcRoot)
    .filter((file) => /"template"/.test(code(file)))
    .map(rel);
  assert.deepEqual(offenders, [], `these still branch on a template source: ${offenders.join(", ")}`);
}

// ---------------------------------------------------------------------------
// 7. The view draws; planFilters decides
// ---------------------------------------------------------------------------
{
  const view = code(path.join(libraryRoot, "TrainingLibraryView.tsx"));

  for (const helper of [
    "filterPlans",
    "compareFavoriteThenName",
    "planEmptyState",
    "planScopeOptions",
    "planStartLabel"
  ]) {
    assert.ok(
      view.includes(helper),
      `the Plans tab must call ${helper} rather than carry its own copy — ` +
        "arithmetic inside a 1000-line view is arithmetic no test can reach"
    );
    assert.ok(
      !new RegExp(String.raw`function\s+${helper}\s*\(`).test(view),
      `${helper} is declared in the view as well as in planFilters; two ` +
        "answers to one question is the drift this move exists to stop"
    );
  }

  // The figure a plan does not have. Both were the workout list's.
  assert.ok(
    !view.includes("elapsedLabel"),
    "the plan row's Updated column is gone — when a file was last written is " +
      "a fact about the file, not about the training"
  );
}

// ---------------------------------------------------------------------------
// 8. The builder survives navigation, and asks its own questions
// ---------------------------------------------------------------------------
{
  /*
   * `window.confirm` is not the same trap as `window.prompt`. Electron does
   * implement it — verified against a real BrowserWindow, where the call
   * blocks past three seconds with no way to answer it from script. So this
   * is not a broken button; it is an unstyled OS box over a themed app,
   * blocking the renderer thread, saying one line of plain text, and
   * unreachable from any test. Seven calls remain elsewhere in `src/`
   * (App.tsx, chat, strength) and are another screen's to move.
   */
  const offenders = walk(libraryRoot)
    .filter((file) => /\bwindow\.confirm\s*\(/.test(code(file)))
    .map(rel);
  assert.deepEqual(
    offenders,
    [],
    `the Training Library asks in its own dialog; these still use the OS one: ${offenders.join(", ")}`
  );

  const view = code(path.join(libraryRoot, "TrainingLibraryView.tsx"));
  assert.ok(
    !/disabled=\{Boolean\(editingPlan/.test(view),
    "the tab strip must not be disabled while editing. It was, because the " +
      "draft died with the editor — the screen prevented navigation rather " +
      "than surviving it, so looking up a workout meant abandoning the plan"
  );

  const editor = code(path.join(libraryRoot, "PlanEditor.tsx"));
  assert.ok(
    editor.includes("draftPlan(draft)") && !editor.includes("useState<TrainingPlanDocument[]>"),
    "the editor draws the draft it is handed and keeps no history of its own — " +
      "history that lives in a component dies with it"
  );
}

console.log(
  "training library surface OK — no window.prompt, create actions wired, " +
    "no collections, two tabs, grid rows square at every width, " +
    "filters out of the view, no OS dialogs, drafts survive navigation, " +
    "sync watched"
);
