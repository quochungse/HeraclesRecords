/**
 * Takes the figures docs/ui-system-refinement.md cannot take from the
 * stylesheets: how deep containers nest on a rendered screen, how each layer is
 * drawn, and which boxes clip or spill their content. It drives the running app
 * over the Chrome DevTools Protocol.
 *
 * Not a test, like `measure-ui.mjs` beside it: nothing here knows what the app
 * should look like. What it gives a CSS change is a *before* to compare with —
 * the doc's line-height step counts an overflow as a regression only when the
 * same box did not already overflow on `main`, and that question has no answer
 * without a capture taken on `main` first. `compare` is the one mode with an
 * exit code worth reading: 2 when a box clips or spills that did not before.
 *
 *   npm run build
 *   env -u ELECTRON_RUN_AS_NODE -u VITE_DEV_SERVER_URL \
 *     ./node_modules/electron/dist/electron --ozone-platform=x11 --remote-debugging-port=9222 .
 *       ^ as a background task, never with a trailing `&` — see the doc, §7.
 *         XWayland, because a native Wayland window that is off screen gets no
 *         frames and every capture this makes then waits forever.
 *   node scripts/probe-ui-cdp.mjs capture --label baseline-main
 *   node scripts/probe-ui-cdp.mjs compare .work/ui-probe/baseline-main/probe.json \
 *                                         .work/ui-probe/phase-1/probe.json
 *
 * capture options: --port 9222  --out .work/ui-probe  --width 1600 --height 980
 *                  --screens "Overview,Sleep,..."  (sidebar labels, exact)
 *                  --themes dark,paper  --no-shots  --no-freeze
 *
 * `.work/` is git-ignored, and that matters: the screenshots are the athlete's
 * own training and sleep. The JSON holds class names and counts only.
 *
 * **It leaves nothing behind in the app, and the theme is why that took care.**
 * `coros-theme` is a `preference`-tier key, so switching theme the way the app
 * does — or the way an earlier throwaway probe did, `localStorage.setItem` and a
 * reload — publishes the switch to every other machine on the vault. So the
 * theme is flipped on the `data-theme` attribute alone, which is all CSS reads,
 * and put back afterwards. The cost: whatever paints from React's theme state
 * (map styles, the globe, chart palettes) stays in the stored theme, and the
 * JSON records which one that was. Everything else is undone the same way:
 * the viewport override is cleared, the injected motion freeze removed, and
 * the screen that was open reopened — account rows included, which are reached
 * by `data-nav-label` because one wears the athlete's name and the other is
 * icon-only. There is nothing else to put back: the rail's index stands open,
 * so no group has to be unfolded to reach a screen and none is left unfolded
 * afterwards.
 *
 * Why motion is frozen: a transition started by the theme flip runs on frames,
 * and a background window gets few or none, so it can sit at its first value
 * and `getComputedStyle` reports the old theme's colours. With durations forced
 * to 0 every element is measured, and shot, at its settled state.
 *
 * The container definition is the one the doc's §4.1 table was taken with, kept
 * so the numbers stay comparable: paints a surface (a background, a gradient, a
 * visible border or a visible box-shadow), padding summing to 8px or more, an
 * element child, and at least 80×32. A legend dot or a bar segment paints but
 * groups nothing, and counting those makes every chart look four deep.
 *
 * **`layers` counts a divider as a layer; `boxes` does not.** Under that
 * definition a column with a one-sided rule (`border-right` on a list pane,
 * `border-left` on a detail pane) is a container, so everything inside it is a
 * level deeper than anything beside it — Sleep's selected night and Activities'
 * detail tiles sat at layer 3 on a card with no box between them and it. The
 * ladder (doc §4.3) is about boxes inside boxes, so `boxes` counts only a
 * container that draws one — a background, a four-sided border or a shadow —
 * and walks past rules. `layers` is kept as it was, so older captures still
 * compare; read `boxes` for the ladder.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DEFAULT_SCREENS = ["Overview", "Sleep", "Settings", "Activities", "Running", "Strength", "Coach", "Calendar"];
const FREEZE_ID = "ui-probe-freeze";
const COMMAND_TIMEOUT_MS = 30_000;

// ------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const flags = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) flags._.push(arg);
    else if (arg.startsWith("--no-")) flags[arg.slice(5)] = false;
    else flags[arg.slice(2)] = rest[++i];
  }
  return { mode, flags };
}

// ------------------------------------------------------------------- CDP

async function connect(port) {
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    throw new Error(`nothing answers on :${port} — is the app running with --remote-debugging-port=${port}?`);
  }
  // A dev-server launch opens a detached DevTools, which is itself a CDP client
  // on the page; a second client then gets no reply to anything, ever.
  if (targets.some((t) => t.url?.startsWith("devtools://"))) {
    throw new Error("a DevTools window is attached — launch from dist/ without VITE_DEV_SERVER_URL");
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error(`no page target among ${targets.map((t) => t.type).join(", ")}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => fail(new Error("CDP socket failed to open")), { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(message.error)}`));
    else waiter.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolvePromise, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve: resolvePromise, reject, timer, method });
      ws.send(JSON.stringify({ id, method, params }));
    });

  /** Runs `fn(arg)` in the page. Never `awaitPromise`: one that does not settle wedges CDP for good. */
  const run = async (fn, arg) => {
    const result = await send("Runtime.evaluate", {
      expression: `(${fn})(${JSON.stringify(arg ?? null)})`,
      returnByValue: true,
      awaitPromise: false,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  /** A capture forces a frame, which is the only way this window gets one. */
  const pump = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await send("Page.captureScreenshot", { format: "jpeg", quality: 1, clip: { x: 0, y: 0, width: 8, height: 8, scale: 1 } });
    }
  };

  return { send, run, pump, close: () => ws.close() };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ------------------------------------------------------- in-page functions
// Each is stringified into the page, so each must be self-contained.

function pageState() {
  const activeRow = document.querySelector(".app-sidebar-nav-item.active .app-sidebar-nav-label");
  const activeAccount = document.querySelector(
    ".app-sidebar-identity-main.active, .app-sidebar-identity-settings.active",
  );
  const active =
    activeRow?.textContent.trim() ?? activeAccount?.getAttribute("data-nav-label") ?? null;
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem("coros-theme");
  } catch {}
  return {
    theme: document.documentElement.dataset.theme ?? "dark",
    accent: document.documentElement.dataset.accent ?? "gold",
    storedTheme: storedTheme ?? "dark",
    activeScreen: active,
    window: { width: innerWidth, height: innerHeight },
  };
}

function setThemeAttribute(theme) {
  const root = document.documentElement;
  if (theme === "dark") delete root.dataset.theme;
  else root.dataset.theme = theme;
  return root.dataset.theme ?? "dark";
}

function setFreeze({ id, on }) {
  document.getElementById(id)?.remove();
  if (!on) return false;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `*, *::before, *::after {
    transition-duration: 0s !important; transition-delay: 0s !important;
    animation-duration: 0s !important; animation-delay: 0s !important;
    animation-iteration-count: 1 !important; }`;
  document.head.append(style);
  return true;
}

/**
 * Every destination the rail offers: the index, whose rows carry their label as
 * text, plus the two account rows at its foot, which do not — one wears the
 * athlete's name and the other is icon-only — and carry `data-nav-label`
 * instead. Nothing has to be opened first: the index stands open, which is why
 * the group handling this replaced is gone.
 */
function clickNav(label) {
  const row = [...document.querySelectorAll(".app-sidebar-nav-item")].find(
    (b) => b.querySelector(".app-sidebar-nav-label")?.textContent.trim() === label,
  );
  if (row) {
    row.click();
    return true;
  }

  const account = document.querySelector(
    `.app-sidebar-identity [data-nav-label="${label}"]`,
  );
  if (!account) return false;
  account.click();
  return true;
}

function contentSignature() {
  const content = document.querySelector(".content") ?? document.body;
  return `${content.querySelectorAll("*").length}:${content.textContent.length}`;
}

function measure() {
  const alpha = (color) => {
    if (!color || color === "transparent") return 0;
    const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)/);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const rgba = color.match(/^rgba\(([^)]+)\)/);
    if (rgba) {
      const parts = rgba[1].split(",");
      if (parts.length === 4) return Number(parts[3]);
    }
    return 1;
  };
  const splitTop = (value) => {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === "(") depth += 1;
      else if (value[i] === ")") depth -= 1;
      else if (value[i] === "," && depth === 0) {
        out.push(value.slice(start, i));
        start = i + 1;
      }
    }
    out.push(value.slice(start));
    return out.map((part) => part.trim());
  };
  /** outer / inset / null. A zero-size or transparent shadow is a transition resting state, not an edge. */
  const shadowKind = (value) => {
    if (!value || value === "none") return null;
    let outer = false;
    let inset = false;
    for (const layer of splitTop(value)) {
      const color = layer.match(/(rgba?|color|oklab|oklch|hsla?|lab|lch)\([^)]*\)/)?.[0] ?? "rgb(0,0,0)";
      const lengths = (layer.replace(color, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
      if (alpha(color) <= 0.02 || lengths.every((n) => n === 0)) continue;
      if (/\binset\b/.test(layer)) inset = true;
      else outer = true;
    }
    return outer && inset ? "shadow+inset" : outer ? "shadow" : inset ? "inset" : null;
  };
  const SIDES = ["Top", "Right", "Bottom", "Left"];
  const inMap = (el) => el.closest(".leaflet-container, .maplibregl-map");
  const name = (el) => {
    const first = String(el.className?.baseVal ?? el.className ?? "").trim().split(/\s+/)[0];
    return el.tagName.toLowerCase() + (first ? `.${first}` : "");
  };

  const drawn = new Map();
  /** How `el` paints its box, or null when it paints nothing or is not a container. */
  const container = (el) => {
    if (drawn.has(el)) return drawn.get(el);
    let result = null;
    const cs = getComputedStyle(el);
    if (cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0 && el.firstElementChild && !inMap(el)) {
      const bg = alpha(cs.backgroundColor) > 0.02 || /gradient\(/.test(cs.backgroundImage);
      const sides = SIDES.filter(
        (s) => parseFloat(cs[`border${s}Width`]) > 0 && !/none|hidden/.test(cs[`border${s}Style`]) && alpha(cs[`border${s}Color`]) > 0.02,
      );
      const shadow = shadowKind(cs.boxShadow);
      if (bg || sides.length || shadow) {
        const rect = el.getBoundingClientRect();
        const padding = SIDES.reduce((sum, s) => sum + parseFloat(cs[`padding${s}`] || 0), 0);
        if (rect.width >= 80 && rect.height >= 32 && padding >= 8) {
          const radius = parseFloat(cs.borderTopLeftRadius) || 0;
          const edge = sides.length === 4 ? "border" : sides.length ? `rule-${sides.map((s) => s[0].toLowerCase()).join("")}` : null;
          const corner = radius >= 999 || radius >= Math.min(rect.width, rect.height) / 2 - 1 ? "pill" : `r${Math.round(radius)}`;
          result = [bg ? "bg" : null, edge, shadow, corner].filter(Boolean).join(" + ");
        }
      }
    }
    drawn.set(el, result);
    return result;
  };

  const tally = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
  const histogram = new Map();
  const boxHistogram = new Map();
  const boxChains = new Map();
  /** A rule — one to three sides of border and nothing else — divides; it does not enclose. */
  const isBox = (treatment) => treatment.split(" + ").some((part) => part === "bg" || part === "border" || /shadow|inset/.test(part));
  const treatments = new Map();
  const chains = new Map();
  const all = document.body.querySelectorAll("*");
  for (const el of all) {
    const treatment = container(el);
    if (!treatment) continue;
    const path = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (container(node)) path.push(name(node));
    }
    const depth = path.length;
    tally(histogram, depth);
    tally(treatments, `${depth}|${treatment}`);
    if (depth >= 2) tally(chains, `${depth}|${path.reverse().join(" > ")}`);
    if (!isBox(treatment)) continue;
    const boxes = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const drawnAs = container(node);
      if (drawnAs && isBox(drawnAs)) boxes.push(name(node));
    }
    tally(boxHistogram, boxes.length);
    if (boxes.length >= 2) tally(boxChains, `${boxes.length}|${boxes.reverse().join(" > ")}`);
  }

  // Overflow. A scroll container overflowing is its job; an ellipsis or a line
  // clamp is a truncation somebody asked for. What is left either cuts content
  // off (`clip`) or draws it outside its own box (`spill`).
  const overflow = new Map();
  const label = (el) => {
    const classes = String(el.className?.baseVal ?? el.className ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return el.tagName.toLowerCase() + classes.map((c) => `.${c}`).join("");
  };
  for (const el of all) {
    if (el instanceof SVGElement || inMap(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.display === "inline" || cs.display === "contents" || cs.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 12) continue;
    for (const [axis, delta, flow] of [
      ["x", el.scrollWidth - el.clientWidth, cs.overflowX],
      ["y", el.scrollHeight - el.clientHeight, cs.overflowY],
    ]) {
      if (delta <= 2 || flow === "auto" || flow === "scroll") continue;
      const truncated = axis === "x" ? cs.textOverflow === "ellipsis" : cs.webkitLineClamp !== "none";
      const kind = truncated ? "trunc" : flow === "visible" ? "spill" : "clip";
      const parent = el.parentElement ? `${label(el.parentElement)} > ` : "";
      const key = `${kind}-${axis}|${parent}${label(el)}`;
      const entry = overflow.get(key) ?? { count: 0, maxPx: 0 };
      entry.count += 1;
      entry.maxPx = Math.max(entry.maxPx, delta);
      overflow.set(key, entry);
    }
  }

  const scroller = document.scrollingElement;
  return {
    elements: all.length,
    histogram: Object.fromEntries([...histogram].sort((a, b) => a[0] - b[0])),
    treatments: Object.fromEntries([...treatments].sort((a, b) => b[1] - a[1])),
    chains: Object.fromEntries([...chains].sort((a, b) => b[1] - a[1])),
    boxes: Object.fromEntries([...boxHistogram].sort((a, b) => a[0] - b[0])),
    boxChains: Object.fromEntries([...boxChains].sort((a, b) => b[1] - a[1])),
    overflow: Object.fromEntries([...overflow].sort()),
    pageOverflowX: Math.max(0, scroller.scrollWidth - scroller.clientWidth),
  };
}

// --------------------------------------------------------------- capture

function gitState() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  return {
    head: git("rev-parse", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    srcDirty: git("status", "--porcelain", "--", "src").length > 0,
  };
}

/** The app loads dist/, so a source file newer than the build means measuring code that is not there. */
function buildIsStale() {
  let built;
  try {
    built = statSync(join(ROOT, "dist/index.html")).mtimeMs;
  } catch {
    return "no dist/index.html — run npm run build";
  }
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (stat.mtimeMs > built) return relative(ROOT, full);
    }
    return null;
  };
  const newer = walk(join(ROOT, "src"));
  return newer ? `${newer} is newer than dist/ — run npm run build` : null;
}

async function waitForSettle(cdp) {
  const started = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - started < 25_000) {
    await cdp.pump();
    await sleep(700);
    const signature = await cdp.run(contentSignature);
    stable = signature === last ? stable + 1 : 0;
    last = signature;
    if (stable >= 3 && Date.now() - started >= 2_500) return { settled: true, ms: Date.now() - started };
  }
  return { settled: false, ms: Date.now() - started };
}

async function capture(options) {
  const label = options.label;
  if (!label || !/^[\w.-]+$/.test(label)) throw new Error("--label <name> is required ([A-Za-z0-9._-])");
  const outDir = resolve(ROOT, options.out ?? ".work/ui-probe", label);
  const screens = options.screens ? options.screens.split(",").map((s) => s.trim()) : DEFAULT_SCREENS;
  const themes = options.themes ? options.themes.split(",") : ["dark", "paper"];
  const viewport = { width: Number(options.width ?? 1600), height: Number(options.height ?? 980) };
  const shots = options.shots !== false;
  const freeze = options.freeze !== false;

  const stale = buildIsStale();
  if (stale) console.warn(`\n!! ${stale}\n`);

  const cdp = await connect(Number(options.port ?? 9222));
  mkdirSync(outDir, { recursive: true });
  const before = await cdp.run(pageState);
  const report = {
    label,
    takenAt: new Date().toISOString(),
    git: gitState(),
    buildStale: stale,
    viewport,
    freeze,
    app: before,
    note: "Theme is flipped on data-theme only; React-painted colour (maps, globe, charts) stays in app.storedTheme.",
    screens: {},
  };
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
    await cdp.run(setFreeze, { id: FREEZE_ID, on: freeze });

    for (const screen of screens) {
      process.stdout.write(`${screen.padEnd(12)} `);
      if (!(await cdp.run(clickNav, screen))) {
        report.screens[screen] = { missing: true };
        console.log("not in the sidebar — skipped");
        continue;
      }
      const settle = await waitForSettle(cdp);
      report.screens[screen] = { settle };

      for (const theme of themes) {
        await cdp.run(setThemeAttribute, theme);
        await cdp.pump(2);
        const measured = await cdp.run(measure);
        if (shots) {
          await cdp.pump(3);
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
          const file = `${screen.toLowerCase().replace(/\W+/g, "-")}-${theme}.png`;
          writeFileSync(join(outDir, file), Buffer.from(data, "base64"));
          measured.screenshot = file;
        }
        report.screens[screen][theme] = measured;
        const clipOrSpill = Object.keys(measured.overflow).filter((k) => !k.startsWith("trunc")).length;
        process.stdout.write(`${theme} depth ${JSON.stringify(measured.histogram)} overflow ${clipOrSpill}  `);
      }
      console.log(settle.settled ? "" : `(never settled in ${settle.ms}ms)`);
    }
  } finally {
    await cdp.run(setThemeAttribute, before.theme).catch(() => {});
    await cdp.run(setFreeze, { id: FREEZE_ID, on: false }).catch(() => {});
    if (before.activeScreen) await cdp.run(clickNav, before.activeScreen).catch(() => {});
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    cdp.close();
  }

  const file = join(outDir, "probe.json");
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
  console.log(`\nwrote ${relative(process.cwd(), file)}`);
}

function printSummary(report) {
  console.log(`\n${report.label} @ ${report.git.head.slice(0, 7)} (${report.git.branch}${report.git.srcDirty ? ", src dirty" : ""})`);
  for (const [screen, data] of Object.entries(report.screens)) {
    if (data.missing) continue;
    for (const theme of Object.keys(data).filter((k) => k !== "settle")) {
      const m = data[theme];
      const deep = Object.entries(m.chains).filter(([k]) => Number(k.split("|")[0]) >= 3);
      const deepBoxes = Object.entries(m.boxChains).filter(([k]) => Number(k.split("|")[0]) >= 3);
      console.log(`  ${screen.padEnd(11)} ${theme.padEnd(6)} layers ${JSON.stringify(m.histogram).padEnd(24)} 3+ chains ${String(deep.length).padStart(2)}${deep[0] ? `  e.g. ${deep[0][1]}× ${deep[0][0].split("|")[1]}` : ""}`);
      console.log(`  ${"".padEnd(18)} boxes  ${JSON.stringify(m.boxes).padEnd(24)} 3+ chains ${String(deepBoxes.length).padStart(2)}${deepBoxes[0] ? `  e.g. ${deepBoxes[0][1]}× ${deepBoxes[0][0].split("|")[1]}` : ""}`);
    }
  }
}

// --------------------------------------------------------------- compare

function compare(beforePath, afterPath) {
  if (!beforePath || !afterPath) {
    console.error("compare needs <before.json> <after.json>");
    return 1;
  }
  const a = JSON.parse(readFileSync(beforePath, "utf8"));
  const b = JSON.parse(readFileSync(afterPath, "utf8"));
  console.log(`before ${a.label} @ ${a.git.head.slice(0, 7)}   after ${b.label} @ ${b.git.head.slice(0, 7)}${b.git.srcDirty ? " (src dirty)" : ""}`);
  if (JSON.stringify(a.viewport) !== JSON.stringify(b.viewport)) console.log(`!! viewports differ: ${JSON.stringify(a.viewport)} vs ${JSON.stringify(b.viewport)}`);
  if (a.app.storedTheme !== b.app.storedTheme) console.log("!! stored theme differs, so React-painted colour differs too");

  let regressions = 0;
  for (const screen of new Set([...Object.keys(a.screens), ...Object.keys(b.screens)])) {
    const sa = a.screens[screen];
    const sb = b.screens[screen];
    const measured = (s) => Boolean(s && !s.missing);
    if (!measured(sa) || !measured(sb)) {
      const where = measured(sa) ? "before only" : measured(sb) ? "after only" : "neither capture";
      console.log(`\n${screen}: measured in ${where}`);
      continue;
    }
    for (const theme of new Set([...Object.keys(sa), ...Object.keys(sb)].filter((k) => k !== "settle"))) {
      const ma = sa[theme];
      const mb = sb[theme];
      if (!ma || !mb) continue;
      const lines = [];
      const depths = new Set([...Object.keys(ma.histogram), ...Object.keys(mb.histogram)]);
      const histogram = [...depths].sort().map((d) => `${d}:${ma.histogram[d] ?? 0}→${mb.histogram[d] ?? 0}`).join(" ");
      // Captures older than the `boxes` count have none; say so rather than print zeros.
      const boxDepths = new Set([...Object.keys(ma.boxes ?? {}), ...Object.keys(mb.boxes ?? {})]);
      const boxes = ma.boxes && mb.boxes
        ? [...boxDepths].sort().map((d) => `${d}:${ma.boxes[d] ?? 0}→${mb.boxes[d] ?? 0}`).join(" ")
        : "n/a (a capture predates the count)";
      if (ma.boxChains && mb.boxChains) {
        for (const [key, n] of Object.entries(mb.boxChains)) {
          if (Number(key.split("|")[0]) >= 3 && !(key in ma.boxChains)) lines.push(`   + deep box  ${n}× B${key.replace("|", "  ")}`);
        }
        for (const [key, n] of Object.entries(ma.boxChains)) {
          if (Number(key.split("|")[0]) >= 3 && !(key in mb.boxChains)) lines.push(`   - deep box  ${n}× B${key.replace("|", "  ")}`);
        }
      }
      for (const [key, n] of Object.entries(mb.chains)) {
        if (Number(key.split("|")[0]) >= 3 && !(key in ma.chains)) lines.push(`   + deep  ${n}× L${key.replace("|", "  ")}`);
      }
      for (const [key, n] of Object.entries(ma.chains)) {
        if (Number(key.split("|")[0]) >= 3 && !(key in mb.chains)) lines.push(`   - deep  ${n}× L${key.replace("|", "  ")}`);
      }
      for (const [key, entry] of Object.entries(mb.overflow)) {
        const old = ma.overflow[key];
        const serious = !key.startsWith("trunc");
        if (!old) {
          lines.push(`   ${serious ? "NEW " : "new "} ${key.replace("|", "  ")}  (${entry.count}×, ${entry.maxPx}px)`);
          if (serious) regressions += 1;
        } else if (entry.maxPx > old.maxPx + 2) {
          lines.push(`   ${serious ? "GREW" : "grew"} ${key.replace("|", "  ")}  (${old.maxPx}px → ${entry.maxPx}px)`);
          if (serious) regressions += 1;
        }
      }
      for (const key of Object.keys(ma.overflow)) {
        if (!(key in mb.overflow)) lines.push(`   gone ${key.replace("|", "  ")}`);
      }
      if (mb.pageOverflowX > ma.pageOverflowX) {
        lines.push(`   NEW  page scrolls sideways by ${mb.pageOverflowX}px`);
        regressions += 1;
      }
      console.log(`\n${screen} / ${theme}   layers ${histogram}   boxes ${boxes}`);
      for (const line of lines) console.log(line);
    }
  }
  console.log(`\n${regressions} clip/spill regression(s)`);
  return regressions ? 2 : 0;
}

// ------------------------------------------------------------------ main
// Last, so every top-level `const` above is initialised before capture awaits.

const { mode, flags } = parseArgs(process.argv.slice(2));
try {
  if (mode === "capture") await capture(flags);
  else if (mode === "compare") process.exitCode = compare(flags._[0], flags._[1]);
  else {
    console.error("usage: probe-ui-cdp.mjs capture --label <name> [options] | compare <before.json> <after.json>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`probe-ui-cdp: ${error.message}`);
  process.exitCode = 1;
}
