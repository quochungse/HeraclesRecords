// Renderer preferences on their way out.
//
// Theme, units, sport colours and every view selection live only in
// localStorage, which the main process cannot read. They are published by
// comparison instead: the renderer hands over everything policy allows, and the
// main process works out what moved.
//
// The claim worth a suite is the one that was wrong. `publishSyncedLocalStorage`
// answers `syncing: false` when no loop is running — an honest, cheap answer,
// and not delivery. Recorded as delivery, switching sync on mid-session
// published nothing at all: none of these preferences would have changed since
// the answer that was mistaken for it, so nothing looked new, and a machine's
// theme and units simply never reached the other one.
//
// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types; the module graph has extensionless imports, so the
// resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Minimal DOM the publisher needs.
const store = new Map();
const timers = [];
globalThis.window = {
  localStorage: {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  setInterval: (fn) => { timers.push(fn); return timers.length; },
  clearInterval: () => {}
};
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: "visible"
};

const { startLocalStoragePublisher } = await import(
  pathToFileURL(
    path.join(repoRoot, "src/settings/localStoragePublisher.ts")
  ).href
);

store.set("coros-theme", "paper");
store.set("coroslink.unitSystem", "metric");

const calls = [];
let syncing = false;
const api = {
  publishSyncedLocalStorage: (entries) => {
    calls.push(entries);
    return Promise.resolve({ syncing, published: syncing ? 1 : 0 });
  }
};

const tick = async () => {
  for (const fn of timers) fn();
  await new Promise((r) => setTimeout(r, 0));
};

const stop = startLocalStoragePublisher(api);
await new Promise((r) => setTimeout(r, 0));
assert.equal(calls.length, 1, "publishes once on start");

// Sync is still off. Nothing has changed, but the answer was not delivery.
await tick();
assert.equal(
  calls.length, 2,
  "with sync off it keeps offering, rather than recording a non-delivery as sent"
);

// Sync comes on mid-session. The preferences have not changed — this is the
// exact case that used to publish nothing at all.
syncing = true;
await tick();
assert.equal(calls.length, 3, "and the moment sync is on, it hands them over");
assert.deepEqual(
  calls[2],
  { "coros-theme": "paper", "coroslink.unitSystem": "metric" },
  "with every preference in it, none of which had changed"
);

// Now that it has been delivered, an unchanged set is silent again.
await tick();
assert.equal(calls.length, 3, "an unchanged set after delivery costs nothing");

// A real edit still goes.
store.set("coros-theme", "dark");
await tick();
assert.equal(calls.length, 4, "a real edit is published");

stop();
console.log("ok  preferences reach a vault switched on mid-session");
console.log("\nsync preference publishing tests passed");
