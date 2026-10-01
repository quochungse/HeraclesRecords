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
  // 7. The detail pane's route map: its layer menu inside a panel
  //
  // The map sits in panels that close on Escape from a capturing listener on
  // `document` — the Calendar's day panel — attached before the map's own. A
  // menu listening there too could not stop the key reaching the panel, so one
  // press closed the menu and the panel with it. And a map 200-300px tall
  // held its menu in a box that scrolled, the route's colouring out of sight.
  // Expand is a button on the map above the layer picker, with nothing under
  // the map.
  // -------------------------------------------------------------------------
  {
    const selectionKeys = [
      "heraclesrecords.selection.v1.training.activityRoute.colorMode",
      "heraclesrecords.selection.v1.training.activityRoute.metric"
    ];
    await win.webContents.executeJavaScript(
      `localStorage.setItem(${JSON.stringify(selectionKeys[0])}, '"performance"');
       localStorage.setItem(${JSON.stringify(selectionKeys[1])}, '"hr"');`,
      true
    );
    const route = Array.from({ length: 60 }, (_, index) => ({
      lat: 21 + index * 0.0004,
      lon: 105 + Math.sin(index / 8) * 0.001,
      elapsed: index * 10
    }));
    const series = Array.from({ length: 600 }, (_, t) => ({ elapsed: t, hr: 120 + Math.round(t / 12) }));
    const hrZones = [
      { index: 0, high: 133 },
      { index: 1, low: 133, high: 154 },
      { index: 2, low: 155, high: 168 },
      { index: 3, low: 169, high: 173 },
      { index: 4, low: 174, high: 183 },
      { index: 5, low: 183, high: 404 }
    ];
    await harness("mount", "ActivityRouteMap", {
      track: { points: route.map(({ elapsed, ...point }) => point), route },
      detail: { series, hrZones, sportType: 100 }
    });
    await waitFor(() => harness("appStylesReady"), "the app stylesheet loads");
    const layerButton = ".activity-route-map .basemap-control .basemap-toggle";
    await waitFor(() => harness("exists", layerButton), "the map renders");
    await settle();

    const corner = await win.webContents.executeJavaScript(
      `(() => {
        const root = document.querySelector(".activity-route-map");
        const box = (selector) => {
          const rect = root.querySelector(selector)?.getBoundingClientRect();
          return rect && { top: rect.top, bottom: rect.bottom, right: rect.right, width: rect.width, height: rect.height };
        };
        return {
          children: [...root.children].map((child) => child.matches(".activity-route-map-frame")),
          map: box(".activity-route-map-canvas"),
          expand: box(".map-frame > .map-expand.basemap-toggle"),
          layer: box(${JSON.stringify(layerButton.replace(".activity-route-map ", ""))}),
          label: root.querySelector(".map-expand")?.getAttribute("aria-label")
        };
      })()`,
      true
    );
    assert.deepEqual(corner.children, [true], `the map and nothing under it: ${corner.children}`);
    assert.ok(corner.expand && corner.layer, `Expand and the layer picker are on the map: ${JSON.stringify(corner)}`);
    assert.equal(corner.label, "Expand map", "Expand is named for a screen reader");
    assert.ok(
      corner.expand.top >= corner.map.top && corner.expand.bottom < corner.layer.top,
      `Expand sits inside the map, above the layer picker: ${JSON.stringify(corner)}`
    );
    assert.ok(
      corner.expand.right === corner.layer.right &&
        corner.expand.width === corner.layer.width &&
        corner.expand.height === corner.layer.height,
      `in the layer picker's look: ${JSON.stringify(corner)}`
    );

    // The line's neon: the line keeps its 4px, a whitened core runs down its
    // middle, and a faint halo sits in a pane of its own that is blurred as
    // one layer. None of it wears the pointer cursor: it answers no click.
    const neon = await win.webContents.executeJavaScript(
      `(() => {
        const map = document.querySelector(".activity-route-map");
        const widths = [...map.querySelectorAll(".leaflet-overlay-pane path")].map((path) => path.getAttribute("stroke-width"));
        const halo = map.querySelector(".leaflet-heraclesRouteHalo-pane");
        const haloPaths = halo ? [...halo.querySelectorAll("path")] : [];
        return {
          widths: [...new Set(widths)].sort(),
          haloPaths: haloPaths.length,
          haloWidth: haloPaths[0]?.getAttribute("stroke-width"),
          haloBlur: halo ? getComputedStyle(halo).filter : "",
          interactive: map.querySelectorAll(".leaflet-interactive").length
        };
      })()`,
      true
    );
    assert.deepEqual(neon.widths, ["1.6", "4"], `the body stays 4px with a 1.6px core: ${neon.widths}`);
    assert.ok(neon.haloPaths > 0 && neon.haloWidth === "8", `a halo under every run: ${JSON.stringify(neon)}`);
    assert.ok(neon.haloBlur.includes("blur"), `the halo is blurred: ${neon.haloBlur}`);
    assert.equal(neon.interactive, 0, "no route path wears the pointer cursor");

    const pressEscape = () => {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    };
    const menuOpen = () => harness("exists", ".activity-route-map .basemap-control.is-open");

    await harness("click", layerButton);
    await waitFor(menuOpen, "the layer menu opens");
    const menu = await win.webContents.executeJavaScript(
      `(() => {
        const menu = document.querySelector(".activity-route-map .basemap-menu");
        const map = document.querySelector(".activity-route-map .activity-route-map-canvas").getBoundingClientRect();
        const last = [...menu.querySelectorAll(".basemap-option")].at(-1);
        return {
          scrolls: menu.scrollHeight > menu.clientHeight + 1,
          lastLabel: last.textContent,
          menuBottom: menu.getBoundingClientRect().bottom,
          mapBottom: map.bottom
        };
      })()`,
      true
    );
    assert.equal(menu.scrolls, false, "the menu shows every option without scrolling");
    assert.ok(menu.lastLabel.includes("Heatmap"), `the route's colouring is in it: ${menu.lastLabel}`);
    assert.ok(menu.menuBottom > menu.mapBottom, "by hanging below a map too short to hold it");

    pressEscape();
    await waitFor(async () => !(await menuOpen()), "Escape closes the menu");
    await settle();
    assert.equal(await harness("callCount", "prop:onPanelEscape"), 0, "and only the menu");
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.activeElement?.matches(${JSON.stringify(layerButton)}) ?? false`,
        true
      ),
      true,
      "focus returns to the layer button"
    );
    pressEscape();
    await waitFor(
      async () => (await harness("callCount", "prop:onPanelEscape")) === 1,
      "the next Escape reaches the panel"
    );

    // A press anywhere else closes the menu too: it must not be left open
    // under the full map Expand opens.
    await harness("click", layerButton);
    await waitFor(menuOpen, "the layer menu opens again");
    await win.webContents.executeJavaScript(
      `document.querySelector(".activity-route-map .map-expand").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`,
      true
    );
    await waitFor(async () => !(await menuOpen()), "a press outside closes the menu");

    // Expand opens the full map, and Escape closes that and nothing else.
    await harness("click", ".activity-route-map .map-expand");
    await waitFor(() => harness("exists", ".activity-route-modal"), "Expand opens the full map");
    pressEscape();
    await waitFor(async () => !(await harness("exists", ".activity-route-modal")), "Escape closes the full map");
    assert.equal(await harness("callCount", "prop:onPanelEscape"), 1, "and not the panel under it");

    await win.webContents.executeJavaScript(
      selectionKeys.map((key) => `localStorage.removeItem(${JSON.stringify(key)});`).join(""),
      true
    );
  }

  // -------------------------------------------------------------------------
  // 8. Nothing to mix, nothing drawn
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
