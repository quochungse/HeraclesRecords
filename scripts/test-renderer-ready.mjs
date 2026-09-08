// The handshake that lets the main process push anything at all.
//
// Main pushes two kinds of thing nobody asked for: sync writes merged from
// another machine, and a COROS session that came back on its own. Both are held
// behind `rendererReady` — `webContents.send` before React has subscribed
// reaches nobody, and both carry the only copy of what they say.
//
// The flag was raised from inside `watchfaces:consumeCommunityOpenRequest`,
// which App.tsx only calls on a development build. So no packaged build ever
// raised it: `trainingHub:sessionChanged` was never delivered to a real user,
// and a start-up re-login minted a session the window never heard about —
// leaving it with no data, no sign-in form, and nothing to do but restart.
//
// It typechecks either way and no runtime error is raised, so what holds it
// down is this: the flag is set from exactly one channel, that channel is
// registered, the renderer invokes it, and it does so unconditionally.
//
// Usage:
//   npm run test:renderer-ready

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

const main = read("electron/main.ts");
const preload = read("electron/preload.ts");
const api = read("src/coroslink-api.ts");
const app = read("src/App.tsx");

const CHANNEL = "app:rendererReady";
const METHOD = "notifyRendererReady";

const cases = [];
const test = (name, run) => cases.push([name, run]);

test("the flag is raised from one place, and that place is its own channel", () => {
  const callers = main.match(/markRendererReady\(\)/g) ?? [];
  assert.equal(
    callers.length,
    2,
    "expected exactly the declaration's own body and one call site; " +
      "another caller means the handshake has a second, unpoliced entrance"
  );
  assert.match(
    main,
    new RegExp(
      `ipcMain\\.handle\\(\\s*"${CHANNEL}"[\\s\\S]{0,200}?markRendererReady\\(\\)`
    ),
    `${CHANNEL} has to be the channel that raises it`
  );
});

test("no build-conditional handler raises it", () => {
  // The original bug in one line: the call sat in a handler the renderer only
  // reaches on a development build.
  assert.equal(
    /consumeCommunityOpenRequest"[\s\S]{0,200}?markRendererReady/.test(main),
    false,
    "the watchfaces deep-link handler is development-only; the flag cannot " +
      "depend on it again"
  );
});

test("the channel is wired through all three files", () => {
  assert.match(preload, new RegExp(`${METHOD}[\\s\\S]{0,120}?"${CHANNEL}"`));
  assert.match(api, new RegExp(`${METHOD}:`), "the renderer API has to declare it");
});

test("the renderer announces itself, and not only in development", () => {
  const call = app.indexOf(`api.${METHOD}()`);
  assert.notEqual(call, -1, "App.tsx never tells the main process it is ready");

  // Walk back to the effect this call sits in and check nothing on the way
  // makes it conditional on the build.
  const effect = app.lastIndexOf("useEffect(", call);
  assert.notEqual(effect, -1);
  assert.equal(
    /IS_DEVELOPMENT_BUILD|import\.meta\.env\.DEV/.test(app.slice(effect, call)),
    false,
    "gating this on the build is the exact bug it replaced: packaged builds " +
      "would go on dropping every push main makes"
  );
});

test("the announcement waits for the effects declared after it", () => {
  const call = app.indexOf(`api.${METHOD}()`);
  const effect = app.lastIndexOf("useEffect(", call);
  assert.match(
    app.slice(effect, call),
    /setTimeout/,
    "mount effects all run in one commit, so announcing from inside one can " +
      "beat a subscription declared below it — and the push it releases would " +
      "then arrive before anything was listening"
  );
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log("ok ", name);
  } catch (error) {
    failed += 1;
    console.error("not ok ", name);
    console.error(error.message);
  }
}

if (failed > 0) {
  console.error(`\n${failed} renderer-ready test(s) failed`);
  process.exit(1);
}
console.log("\nrenderer ready handshake tests passed");
