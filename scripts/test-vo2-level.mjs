import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Runs under `node --experimental-strip-types`.
const repoRoot = path.resolve(import.meta.dirname, "..");
const url = pathToFileURL(path.join(repoRoot, "src", "training", "vo2Level.ts"));
const { vo2LevelEdges, vo2LevelOf, vo2DialPosition } = await import(`${url.href}?cacheBust=${Date.now()}`);

// Garmin's "VO2 Max. Standard Ratings" (The Cooper Institute): a man of 31.
const man = vo2LevelEdges(31, 0);
assert.deepEqual(man.slice(1, 5), [40.5, 44, 48.3, 54]);
assert.equal(vo2LevelOf(40.4, man), "poor");
assert.equal(vo2LevelOf(40.5, man), "fair");
assert.equal(vo2LevelOf(47, man), "good");
assert.equal(vo2LevelOf(49, man), "excellent");
assert.equal(vo2LevelOf(54, man), "superior");
assert.equal(vo2LevelOf(70, man), "superior");

// A woman of the same age reads the same number higher.
const woman = vo2LevelEdges(31, 1);
assert.deepEqual(woman.slice(1, 5), [34.4, 37.8, 42.4, 47.4]);
assert.equal(vo2LevelOf(47, woman), "excellent");

// The dial: five equal parts, the value placed inside its own.
assert.equal(vo2DialPosition(44, man), 0.4);
assert.ok(Math.abs(vo2DialPosition(46.15, man) - 0.5) < 1e-9);
assert.equal(vo2DialPosition(10, man), 0);
assert.equal(vo2DialPosition(90, man), 1);

// Past 79 and under 20 read as the nearest decade.
assert.deepEqual(vo2LevelEdges(85, 0).slice(1, 5), [29.4, 32.3, 36.7, 42.1]);
assert.deepEqual(vo2LevelEdges(16, 1).slice(1, 5), [36.1, 39.5, 43.9, 49.6]);

console.log("vo2 level tests passed");
