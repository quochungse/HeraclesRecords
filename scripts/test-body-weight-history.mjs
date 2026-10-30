// The body weight kept per day (`body_weight_history`), which Heracles Training
// Load scores a past strength session at. COROS keeps only the current weight,
// so three things are held down here:
//
//  1. **A reading that moves nothing is not written**, so a profile read on
//     every launch sends nothing to sync; a new weight is one row for its day,
//     and the same day read again is that row replaced.
//  2. **A session is scored at the weight of its day**: the newest reading on
//     or before it, the earliest one for a session older than every reading.
//  3. **It travels with the athlete** (`personal`).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-body-weight-"));
const database = await import(distUrl("database.js"));
const service = await import(distUrl("heraclesLoadService.js"));
const policy = await import(distUrl("sync/syncPolicy.js"));
const bridge = await import(distUrl("sync/syncBridge.js"));

database.initializeDatabase(tempRoot);
process.on("exit", () => {
  try {
    database.closeDatabase();
  } catch {
    // Already closed.
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

assert.equal(policy.TABLE_POLICY.body_weight_history, "personal");

// --- 1. Only a weight that moved is written ------------------------------------

const announced = [];
let clock = 0;
bridge.attachSyncSink({
  enqueue: (entries) => {
    for (const entry of entries) announced.push(JSON.stringify(entry));
  },
  nextHlc: () => `hlc-${String((clock += 1)).padStart(6, "0")}`
});
const outgoing = () => announced.filter((entry) => entry.includes("body_weight_history")).length;

const before = database.bodyWeightHistoryVersion();
assert.equal(database.recordBodyWeight(78, "20260301"), true);
assert.equal(database.recordBodyWeight(78.02, "20260410"), false, "the weight the newest row holds moves nothing");
assert.equal(outgoing(), 1, "and goes nowhere");
assert.equal(database.recordBodyWeight(75.5, "20260601"), true);
assert.equal(database.recordBodyWeight(75.8, "20260601"), true, "read again the same day, the day's row is replaced");
assert.equal(database.recordBodyWeight(0, "20260602"), false, "no weight is no reading");
assert.equal(database.recordBodyWeight(80, "2026-06-02"), false, "nor is a day in another spelling");
assert.deepEqual(database.listBodyWeights(), [
  { day: "20260301", weightKg: 78 },
  { day: "20260601", weightKg: 75.8 }
]);
assert.equal(outgoing(), 3);
assert.notEqual(database.bodyWeightHistoryVersion(), before, "Heracles Training Load reads again when it moves");
assert.ok(database.heraclesLoadInputsVersion().endsWith(`|${database.bodyWeightHistoryVersion()}`));
bridge.attachSyncSink(null);

// --- 2. The weight of a session's day -------------------------------------------

const at = (year, month, day) => Math.floor(new Date(year, month - 1, day, 12).valueOf() / 1000);
const readings = database.listBodyWeights();
assert.equal(service.bodyWeightOn([], at(2026, 5, 1)), undefined);
assert.equal(service.bodyWeightOn(readings, at(2026, 5, 1)), 78, "the newest reading on or before it");
assert.equal(service.bodyWeightOn(readings, at(2026, 6, 1)), 75.8, "its own day's");
assert.equal(service.bodyWeightOn(readings, at(2026, 9, 1)), 75.8);
assert.equal(service.bodyWeightOn(readings, at(2025, 12, 1)), 78, "older than every reading: the earliest");
assert.equal(service.bodyWeightOn(readings, undefined), 75.8, "no day: the latest");

// The default deps score each session at its own day's weight.
const deps = service.createDefaultDeps();
assert.equal(deps.bodyWeightKg(at(2026, 4, 1)), 78);
assert.equal(deps.bodyWeightKg(at(2026, 7, 1)), 75.8);
database.recordBodyWeight(74, "20260801");
assert.equal(deps.bodyWeightKg(at(2026, 8, 2)), 74, "a new reading is read without a restart");

console.log("body weight history: ok");
