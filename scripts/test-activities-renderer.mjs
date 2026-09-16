// The Activities summary strip, mounted for real in Electron's Chromium.
//
// The sport mix bar is the one figure no other screen can draw, and it now
// answers one band at a time on hover rather than carrying a permanent line of
// percentages. Everything asserted here is what that costs if it is got wrong,
// and none of it type-checks:
//
// - A tooltip in the flow pushes the filters and the whole list down the moment
//   the pointer crosses the bar. The strip's height has to be the same whether
//   a band is being pointed at or not.
// - A tooltip centred on its band runs off the end of the screen for the 1%
//   sliver at the far right. It has to stay inside the bar at both ends.
// - Hovering has to name *one* sport. A panel listing all four is the line that
//   was taken away.
// - The band being pointed at has to be the one that stands out.
// - Hover is a pointer affordance; the arrow keys are how the same figures are
//   reached without one, and the bar's own label is how they are read without
//   either.
//
// Layout is asserted in a hidden window, which lays out but does not paint:
// boxes are real there, animations are not. Every transition on the page is
// frozen before anything is measured — the bar's height and its bands' opacity
// are both transitioned, and a frame-driven value read in a window that gets no
// frames is whatever the last one left behind.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const HOUR = 3600;

/**
 * This athlete's own mix, rounded: a dominant sport, a substantial second, and
 * two slivers — the last of which is the case the tooltip's placement exists
 * for.
 */
const TOTALS = {
  count: 57,
  duration: 201_360,
  distance: 314_200,
  elevationGain: 124,
  trainingLoad: 7560,
  activeDays: 44,
  weeks: 11,
  sports: [
    { category: "run", count: 30, duration: 38 * HOUR, trainingLoad: 5000 },
    { category: "strength", count: 25, duration: 17 * HOUR, trainingLoad: 2000 },
    { category: "bike", count: 1, duration: HOUR, trainingLoad: 400 },
    { category: "other", count: 1, duration: 0.6 * HOUR, trainingLoad: 160 }
  ]
};

/** One sport only, so the bar is a single band running the whole width. */
const ONE_SPORT = {
  ...TOTALS,
  sports: [{ category: "run", count: 30, duration: 38 * HOUR, trainingLoad: 5000 }]
};

let win;

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return win.webContents
    .executeJavaScript(`window.__harness.${method}(${list})`, true)
    .catch((error) => {
      throw new Error(`harness ${method} failed: ${error.message}`);
    });
}

async function waitFor(read, what, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (last) return last;
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for: ${what} (last saw ${JSON.stringify(last)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Long enough for the bar's 0.14s height transition to have finished. */
async function settle() {
  for (let pass = 0; pass < 5; pass += 1) {
    await win.webContents.executeJavaScript(
      "new Promise((resolve) => setTimeout(resolve, 60))",
      true
    );
  }
}

async function mountSummary(options) {
  await harness("mount", "ActivitiesSummary", options);
  await waitFor(() => harness("appStylesReady"), "the app stylesheet loads");
  await waitFor(() => harness("exists", ".activities-mix-bar"), "the mix bar renders");
  await settle();
}

async function hoverBand(index) {
  assert.equal(await harness("hover", ".activities-mix-bar i", index), true);
  await settle();
}

/**
 * Takes the pointer off, from the band it was on.
 *
 * Not from the bar: React synthesises `onMouseLeave` from the delegated
 * `mouseout`, and a pointer never leaves a bar without leaving the band it was
 * standing on first. Dispatching on the band is both the faithful move and the
 * one whose leave chain reaches every handler a real pointer would.
 */
async function leaveBar(bandIndex) {
  assert.equal(await harness("unhover", ".activities-mix-bar i", bandIndex), true);
  await settle();
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false }
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");
  assert.equal(await harness("freezeAnimations"), true);

  // -------------------------------------------------------------------------
  // 1. At rest the bar is a bar, and nothing else
  // -------------------------------------------------------------------------
  {
    await mountSummary({ totals: TOTALS, width: 1200 });

    assert.equal(await harness("count", ".activities-mix-bar i"), 4, "one band per sport");
    assert.equal(
      await harness("exists", ".activities-mix-tip"),
      false,
      "no tooltip until a band is pointed at"
    );
    assert.equal(
      await harness("exists", ".activities-mix-legend"),
      false,
      "the permanent legend is gone — that is the line this replaced"
    );

    // Everything the legend used to say is still said, once, on the bar itself,
    // so a reader who cannot hover loses nothing.
    const label = await harness("attr", ".activities-mix-bar", "aria-label");
    for (const phrase of [
      "Running 67%, 30 sessions",
      "Strength / Gym 30%, 25 sessions",
      "Cycling 2%, 1 session",
      "Other 1%, 1 session"
    ]) {
      assert.ok(label.includes(phrase), `the bar's label carries "${phrase}" — got ${label}`);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Pointing at a band names that band, and only that band
  // -------------------------------------------------------------------------
  {
    await hoverBand(1);

    assert.equal(await harness("count", ".activities-mix-tip"), 1, "one tooltip");
    assert.equal(await harness("text", ".activities-mix-tip-name"), "Strength / Gym");
    const figures = await harness("text", ".activities-mix-tip-figures");
    assert.match(figures, /30%/, "the band's share");
    assert.match(figures, /25 sessions/, "the band's sessions");
    assert.match(figures, /17h/, "the band's time");

    // The whole point: the other three sports are not in it.
    for (const other of ["Running", "Cycling", "Other"]) {
      assert.ok(
        !(await harness("text", ".activities-mix-tip")).includes(other),
        `the tooltip names one sport, not ${other}`
      );
    }

    await hoverBand(0);
    assert.equal(
      await harness("text", ".activities-mix-tip-name"),
      "Running",
      "moving to the next band swaps the tooltip rather than adding one"
    );
    assert.equal(await harness("count", ".activities-mix-tip"), 1);
  }

  // -------------------------------------------------------------------------
  // 3. The band being pointed at is the one that stands out
  // -------------------------------------------------------------------------
  {
    await hoverBand(2);

    assert.equal(
      await harness("count", ".activities-mix-bar i.is-active"),
      1,
      "exactly one band is raised"
    );
    assert.equal(
      await harness("exists", ".activities-mix-bar.is-probing"),
      true,
      "and the bar knows it is being pointed at"
    );

    const fallenBack = Number(await harness("style", ".activities-mix-bar i", "opacity", 0));
    assert.ok(
      fallenBack < 0.5,
      `its neighbours fall back — sibling opacity was ${fallenBack}, which is no contrast at all`
    );
    assert.equal(
      Number(await harness("style", ".activities-mix-bar i", "opacity", 2)),
      1,
      "the band pointed at stays at full strength"
    );

    await leaveBar(2);
    assert.equal(
      await harness("exists", ".activities-mix-bar.is-probing"),
      false,
      "taking the pointer off puts every band back"
    );
    assert.equal(await harness("count", ".activities-mix-bar i.is-active"), 0);
    assert.equal(await harness("exists", ".activities-mix-tip"), false);
    assert.equal(
      Number(await harness("style", ".activities-mix-bar i", "opacity", 0)),
      1,
      "including the ones that had fallen back"
    );
  }

  // -------------------------------------------------------------------------
  // 4. Revealing it moves nothing
  // -------------------------------------------------------------------------
  {
    await mountSummary({ totals: TOTALS, width: 1200 });
    const resting = await harness("rect", ".activities-summary");
    const restingBar = await harness("rect", ".activities-mix-bar");

    await hoverBand(0);
    const probing = await harness("rect", ".activities-summary");
    const probingBar = await harness("rect", ".activities-mix-bar");

    assert.equal(
      probing.height,
      resting.height,
      "the strip is the same height either way — a tooltip in the flow would " +
        "push the filters and the whole list down on every pointer crossing"
    );
    assert.ok(
      probingBar.height > restingBar.height,
      `the bar swells when pointed at — ${restingBar.height}px to ${probingBar.height}px`
    );
    assert.equal(
      await harness("overflowX", ".activities-summary"),
      0,
      "and nothing of it hangs off the side"
    );
  }

  // -------------------------------------------------------------------------
  // 5. The tooltip stays inside the bar, at either end
  // -------------------------------------------------------------------------
  {
    const bar = await harness("rect", ".activities-mix-bar");

    // The 1% sliver at the far right is the case that put it off the screen.
    await hoverBand(3);
    const atTheEnd = await harness("rect", ".activities-mix-tip");
    assert.equal(await harness("text", ".activities-mix-tip-name"), "Other");
    assert.ok(
      atTheEnd.right <= bar.right,
      `the last band's tooltip ends at ${atTheEnd.right}, past the bar's ${bar.right}`
    );
    assert.ok(atTheEnd.left >= bar.left);

    await hoverBand(0);
    const atTheStart = await harness("rect", ".activities-mix-tip");
    assert.ok(
      atTheStart.left >= bar.left,
      `the first band's tooltip starts at ${atTheStart.left}, before the bar's ${bar.left}`
    );
    assert.ok(atTheStart.right <= bar.right);

    // The caret is what ties the panel to the band, so it has to be over the
    // band — and inside the panel, not hanging off its corner.
    const caret = await harness("rect", ".activities-mix-caret");
    const band = await harness("rect", ".activities-mix-bar i", 0);
    const caretMid = (caret.left + caret.right) / 2;
    assert.ok(
      caretMid >= band.left && caretMid <= band.right,
      `the caret sits at ${caretMid}, outside its band's ${band.left}..${band.right}`
    );
    assert.ok(
      caretMid >= atTheStart.left && caretMid <= atTheStart.right,
      `the caret sits at ${caretMid}, off the panel's ${atTheStart.left}..${atTheStart.right}`
    );

    // A single-sport history is one band running the whole width: its centre is
    // the bar's centre, and the tooltip has to fit from there in either
    // direction.
    await mountSummary({ totals: ONE_SPORT, width: 1200 });
    await hoverBand(0);
    const wideBar = await harness("rect", ".activities-mix-bar");
    const only = await harness("rect", ".activities-mix-tip");
    assert.equal(await harness("text", ".activities-mix-tip-name"), "Running");
    assert.ok(only.left >= wideBar.left && only.right <= wideBar.right);
  }

  // -------------------------------------------------------------------------
  // 6. The arrows reach the same figures without a pointer
  // -------------------------------------------------------------------------
  {
    await mountSummary({ totals: TOTALS, width: 1200 });

    assert.equal(await harness("focus", ".activities-mix-bar"), true, "the bar takes focus");
    await settle();
    assert.equal(
      await harness("text", ".activities-mix-tip-name"),
      "Running",
      "focus opens on the first band rather than on nothing"
    );

    await harness("keyDown", ".activities-mix-bar", "ArrowRight");
    await settle();
    assert.equal(await harness("text", ".activities-mix-tip-name"), "Strength / Gym");

    await harness("keyDown", ".activities-mix-bar", "ArrowLeft");
    await settle();
    assert.equal(await harness("text", ".activities-mix-tip-name"), "Running");

    // Walking off the end stays on the end rather than wrapping into the
    // opposite sport, which would read as the list having moved under you.
    await harness("keyDown", ".activities-mix-bar", "ArrowLeft");
    await settle();
    assert.equal(await harness("text", ".activities-mix-tip-name"), "Running");

    assert.equal(await harness("blur", ".activities-mix-bar"), true);
    await settle();
    assert.equal(
      await harness("exists", ".activities-mix-tip"),
      false,
      "leaving the bar closes it, the same as taking the pointer off"
    );
  }

  // -------------------------------------------------------------------------
  // 7. Nothing to mix, nothing drawn
  // -------------------------------------------------------------------------
  {
    await harness("mount", "ActivitiesSummary", {
      totals: { ...TOTALS, count: 0, duration: 0, sports: [] }
    });
    await waitFor(() => harness("exists", ".activities-summary"), "the strip renders");
    assert.equal(
      await harness("exists", ".activities-mix-bar"),
      false,
      "an empty period draws no bar rather than an empty one"
    );
  }

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors, [], `the page complained: ${errors.join("\n")}`);

  console.log("activities renderer tests passed");
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
