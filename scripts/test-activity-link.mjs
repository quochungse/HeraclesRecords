// The link a session's chart, route map and lap table share
// (`src/training/activityLink.ts`): its store, the laps as stretches, the
// clock against the distance, and a stretch's figures.
//
// node --experimental-strip-types scripts/test-activity-link.mjs
import assert from "node:assert/strict";
import {
  createActivityLink,
  distanceAtElapsed,
  elapsedAtDistance,
  lapAt,
  lapCover,
  lapSpans,
  linkClock,
  snapToLaps,
  stretchFigures,
  wholeLaps
} from "../src/training/activityLink.ts";

// ---- laps as stretches
const laps = [
  { index: 1, duration: 600, distance: 1500 },
  { index: 2, duration: 240, distance: 1000 },
  { index: 3, duration: 120, distance: 300 },
  { index: 4, distance: 1000 },
  { index: 5, duration: 240, distance: 1000 }
];
const spans = lapSpans(laps);
assert.deepEqual(
  spans,
  [
    { index: 1, from: 0, to: 600 },
    { index: 2, from: 600, to: 840 },
    { index: 3, from: 840, to: 960 }
  ],
  "a lap with no duration ends the sequence: every bound after it would be a guess"
);
assert.equal(lapAt(spans, 600)?.index, 2, "a boundary belongs to the lap it starts");
assert.equal(lapAt(spans, 960)?.index, 3, "the last lap takes its own end");
assert.equal(lapAt(spans, 2000), undefined);

assert.deepEqual(wholeLaps(spans, { from: 600, to: 960 }), { first: spans[1], last: spans[2] });
assert.equal(wholeLaps(spans, { from: 610, to: 960 }), null, "a stretch cut inside a lap is not whole laps");
assert.equal(lapCover(spans[1], { from: 600, to: 840 }), "whole");
assert.equal(lapCover(spans[1], { from: 700, to: 900 }), "part");
assert.equal(lapCover(spans[0], { from: 600, to: 840 }), "none", "a lap that only touches the stretch is outside it");
assert.equal(lapCover(spans[0], null), "none");

assert.equal(snapToLaps(spans, 596, 5), 600, "near an edge, the edge");
assert.equal(snapToLaps(spans, 590, 5), 590, "out of reach, the moment itself");
assert.equal(snapToLaps(spans, 3, 5), 0, "the start is an edge too");

// ---- the store
{
  const link = createActivityLink();
  link.setLaps(spans);
  let calls = 0;
  const off = link.subscribe(() => {
    calls += 1;
  });

  link.setCursor(42, "map");
  link.setCursor(42, "map");
  assert.equal(calls, 1, "the same cursor again tells nobody");
  assert.deepEqual(
    [link.getState().cursor, link.getState().cursorSource],
    [42, "map"]
  );
  link.setCursor(null);
  assert.equal(link.getState().cursorSource, null);

  link.selectLap(2);
  assert.deepEqual(link.getState().selection, { from: 600, to: 840 });
  link.selectLap(3, true);
  assert.deepEqual(link.getState().selection, { from: 600, to: 960 }, "Shift reaches from the lap pressed before");
  link.selectLap(1, true);
  assert.deepEqual(link.getState().selection, { from: 0, to: 840 }, "and back the other way, from the same lap");

  link.selectLap(3);
  link.selectLap(3);
  assert.equal(link.getState().selection, null, "a selected lap pressed again lets go");

  link.selectLap(2);
  link.setSelection({ from: 100, to: 200 });
  link.selectLap(3, true);
  assert.deepEqual(
    link.getState().selection,
    { from: 840, to: 960 },
    "a stretch dragged by hand is no lap to reach from"
  );

  const before = link.getState().selection;
  link.setPreview({ from: 0, to: 600 });
  assert.equal(link.getState().selection, before, "a preview leaves the selection's own object alone");

  link.reset();
  assert.deepEqual(link.getState(), { cursor: null, cursorSource: null, selection: null, preview: null });
  off();
}

// ---- the clock against the distance
{
  const series = [
    { elapsed: 0, distance: 0 },
    { elapsed: 10, distance: 30 },
    { elapsed: 10, distance: 31 }, // a repeated second
    { elapsed: 20 }, // no fix
    { elapsed: 30, distance: 90 },
    { elapsed: 40, distance: 80 }, // the distance steps back
    { elapsed: 50, distance: 150 }
  ];
  const clock = linkClock(series);
  assert.deepEqual(clock.elapsed, [0, 10, 30, 50], "only samples where both rise are kept");
  assert.equal(distanceAtElapsed(clock, 20), 60);
  assert.equal(elapsedAtDistance(clock, 120), 40);
  assert.equal(distanceAtElapsed(clock, -5), 0, "before the first sample, the first");
  assert.equal(elapsedAtDistance(clock, 1000), 50, "past the last, the last");
  assert.equal(distanceAtElapsed(linkClock([]), 10), undefined);
}

// ---- a stretch's figures
{
  // One sample a second for ten minutes: 3 m/s, then 5 m/s from 300 s on.
  const series = [];
  let distance = 0;
  for (let second = 0; second <= 600; second += 1) {
    const fast = second > 300;
    if (second > 0) distance += fast ? 5 : 3;
    series.push({
      elapsed: second,
      distance,
      hr: fast ? 170 : 130,
      cadence: second % 2 === 0 ? 0 : 90,
      power: 200,
      // A 1 m wobble on the flat, then a steady climb of 0.1 m a second.
      altitude: fast ? 100 + (second - 300) * 0.1 : 100 + (second % 2)
    });
  }
  const reading = { power: true, cadenceSkipsZeros: true, gain: true };
  const bands = [0, 120, 150, 165];

  const fast = stretchFigures(series, "elapsed", 301, 600, reading, bands);
  assert.equal(fast.duration, 299);
  assert.equal(fast.distance, 1495);
  assert.ok(Math.abs(fast.pace - 200) < 1e-9, "pace is the stretch's own distance over its own clock");
  assert.ok(Math.abs(fast.speed - 18) < 1e-9);
  assert.equal(fast.hr, 170);
  assert.equal(fast.hrMax, 170);
  assert.equal(fast.cadence, 90, "a ride's cadence is averaged over the pedalling");
  assert.equal(fast.power, 200);
  // Counted 2 m at a time, so the last metre or two of the 29.9 is still pending.
  assert.ok(fast.gain > 26 && fast.gain <= 30, "a held rise is counted");
  assert.deepEqual(fast.zoneSeconds, [0, 0, 0, 299], "each second goes to the band its heart rate sits in");

  const slow = stretchFigures(series, "elapsed", 0, 300, { power: false, cadenceSkipsZeros: false, gain: true }, bands);
  assert.equal(slow.power, undefined, "a run's power is left out");
  assert.ok(Math.abs(slow.cadence - 45) < 0.5, "a run's cadence counts every sample, the zeros too");
  assert.equal(slow.gain, 0, "the altimeter's wobble on the flat adds nothing");
  assert.deepEqual(slow.zoneSeconds, [0, 300, 0, 0]);

  const whole = stretchFigures(series, "elapsed", -Infinity, Infinity, reading);
  assert.equal(whole.distance, 2400);
  assert.equal(whole.zoneSeconds, undefined, "no bands, no zones");
  assert.equal(stretchFigures(series, "elapsed", 10, 10.5, reading), null, "under two samples there is no stretch");

  const byDistance = stretchFigures(series, "distance", 0, 900, reading);
  assert.equal(byDistance.duration, 300, "a series cut on distance still times itself on its clock");

  // A recorder that stopped for five minutes leaves one sample standing for at most ten seconds.
  const gapped = [
    { elapsed: 0, hr: 130 },
    { elapsed: 1, hr: 130 },
    { elapsed: 301, hr: 130 },
    { elapsed: 302, hr: 130 }
  ];
  assert.deepEqual(stretchFigures(gapped, "elapsed", 0, 400, reading, [0, 120]).zoneSeconds, [0, 12]);
}

console.log("activity link: ok");
