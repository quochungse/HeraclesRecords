// The zone tables, against the COROS app's own Settings screens.
//
// Every number below was read off COROS on 2026-09-22 for an account with
// Max HR 190, resting 52, LTHR 168, threshold pace 5'22" (322 s/km) and FTP
// 180 — the Heart Rate Zone screen in each of its three modes, the Pace Zone
// screen and the Cycling Power Zone screen. The zone entries are the payload
// `/account/query` serves those same screens from.
//
// Three things it holds down, each of which was wrong:
//
//   * **A zone entry is the zone's ceiling, not its floor.** `configuredZones`
//     read `ratio` as the floor, which shifted every zone down one band.
//   * **COROS names its zones twice** — the Max HR family uses Warm Up / Fat
//     Burn / Aerobic, every other family uses Aerobic Endurance / Aerobic
//     Power / Threshold / Anaerobic Endurance / Anaerobic Power. This file
//     used the first set everywhere, so on HR Reserve and LTHR the band COROS
//     calls Threshold was labelled "Aerobic Endurance".
//   * **The pace table was wrong in all six rows**, and could not be noticed
//     because `parseWorkoutEditorContext` asked for `ltspZone` under two names
//     COROS does not send, so the table was all anyone ever saw.
//
// Run with:
//   npm run test:coros-zone-presets

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;
const bust = `?cacheBust=${Date.now()}`;

const {
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  FTP_PRESETS,
  zoneOptionLabel,
  zonePercentLabel
} = await import(`${distUrl("workoutCapabilities.js")}${bust}`);
const { parseWorkoutEditorContext } = await import(
  `${distUrl("corosWorkoutEditor.js")}${bust}`
);

let failures = 0;
const check = (label, run) => {
  try {
    run();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}\n      ${error.message}`);
  }
};

/** What COROS draws, family by family: label, then the band as it is written. */
const SCREENS = {
  maxHr: [
    ["Recovery", "<50%"],
    ["Warm Up", "50-60%"],
    ["Fat Burn", "61-70%"],
    ["Aerobic", "71-80%"],
    ["Threshold", "81-90%"],
    ["Anaerobic", ">90%"]
  ],
  reserve: [
    ["Recovery", "<59%"],
    ["Aerobic Endurance", "59-74%"],
    ["Aerobic Power", "75-84%"],
    ["Threshold", "85-88%"],
    ["Anaerobic Endurance", "89-95%"],
    ["Anaerobic Power", ">95%"]
  ],
  lthr: [
    ["Recovery", "<80%"],
    ["Aerobic Endurance", "80-90%"],
    ["Aerobic Power", "91-95%"],
    ["Threshold", "96-102%"],
    ["Anaerobic Endurance", "103-106%"],
    ["Anaerobic Power", ">106%"]
  ]
};

const PACE_SCREEN = [
  ["Recovery", "<69%"],
  ["Aerobic Endurance", "69-82%"],
  ["Aerobic Power", "83-91%"],
  ["Threshold", "92-102%"],
  ["Anaerobic Endurance", "103-113%"],
  ["Anaerobic Power", ">113%"]
];

const POWER_SCREEN = [
  ["Recovery", "<56%"],
  ["Aerobic Endurance", "56-75%"],
  ["Aerobic Power", "76-90%"],
  ["Threshold", "91-105%"],
  ["Anaerobic Endurance", "106-120%"],
  ["Anaerobic Power", "121-150%"],
  ["Sprint", ">150%"]
];

/** The bands a table draws with no account zones behind it. */
function tableLabels(table) {
  return table.map((zone, index) =>
    zoneOptionLabel(zone, index, table.length).split(" · ")
  );
}

console.log("1. The shipped tables match COROS's own defaults");
for (const [basis, expected] of Object.entries(SCREENS)) {
  check(`heart rate — ${basis}`, () => {
    assert.deepEqual(tableLabels(HEART_RATE_PRESETS[basis]), expected);
  });
}
check("pace", () => {
  assert.deepEqual(tableLabels(PACE_PRESETS), PACE_SCREEN);
});
check("cycling power", () => {
  assert.deepEqual(tableLabels(FTP_PRESETS), POWER_SCREEN);
});

console.log("2. COROS names its zones twice, and the split is the point");
check("Max HR keeps the consumer wording, the rest the training wording", () => {
  const maxHrNames = HEART_RATE_PRESETS.maxHr.map((zone) => zone.label);
  assert.ok(maxHrNames.includes("Warm Up") && maxHrNames.includes("Fat Burn"));
  for (const basis of ["reserve", "lthr"]) {
    const names = HEART_RATE_PRESETS[basis].map((zone) => zone.label);
    assert.ok(
      !names.includes("Warm Up") && !names.includes("Fat Burn"),
      `${basis} must not borrow the Max HR wording`
    );
    assert.equal(
      names[3],
      "Threshold",
      `${basis} zone 4 is Threshold on COROS; calling it anything else`
      + " prescribes a threshold session as an easy one"
    );
  }
});

console.log("3. There is no running-power family");
check("nothing exports a running-power table any more", async () => {
  const capabilities = await import(`${distUrl("workoutCapabilities.js")}${bust}`);
  assert.equal(
    capabilities.RUNNING_POWER_PRESETS,
    undefined,
    "COROS publishes Heart Rate, Pace and Cycling Power and nothing else"
  );
});

console.log("4. A zone entry states the ceiling");
// The payload behind the HR Reserve screen above: ceilings, then a sentinel.
const ACCOUNT = {
  maxHr: 190,
  rhr: 52,
  zoneData: {
    maxHr: 190,
    rhr: 52,
    lthr: 168,
    ltsp: 322,
    ftp: 180,
    maxHrZone: [
      { index: 0, hr: 95, ratio: 50 },
      { index: 1, hr: 114, ratio: 60 },
      { index: 2, hr: 133, ratio: 70 },
      { index: 3, hr: 152, ratio: 80 },
      { index: 4, hr: 171, ratio: 90 },
      { index: 5, hr: 404, ratio: 255 }
    ],
    rhrZone: [
      { index: 0, hr: 133, ratio: 59 },
      { index: 1, hr: 154, ratio: 74 },
      { index: 2, hr: 168, ratio: 84 },
      { index: 3, hr: 173, ratio: 88 },
      { index: 4, hr: 183, ratio: 95 },
      { index: 5, hr: 404, ratio: 255 }
    ],
    lthrZone: [
      { index: 0, hr: 134, ratio: 80 },
      { index: 1, hr: 151, ratio: 90 },
      { index: 2, hr: 160, ratio: 95 },
      { index: 3, hr: 171, ratio: 102 },
      { index: 4, hr: 178, ratio: 106 },
      { index: 5, hr: 404, ratio: 255 }
    ],
    ltspZone: [
      { index: 0, pace: 466, ratio: 69 },
      { index: 1, pace: 392, ratio: 82 },
      { index: 2, pace: 353, ratio: 91 },
      { index: 3, pace: 315, ratio: 102 },
      { index: 4, pace: 285, ratio: 113 },
      { index: 5, pace: 161, ratio: 200 }
    ],
    cyclePowerZone: [
      { index: 0, power: 101, ratio: 56 },
      { index: 1, power: 135, ratio: 75 },
      { index: 2, power: 162, ratio: 90 },
      { index: 3, power: 189, ratio: 105 },
      { index: 4, power: 216, ratio: 120 },
      { index: 5, power: 270, ratio: 150 },
      { index: 6, power: 900, ratio: 500 }
    ]
  }
};

const context = parseWorkoutEditorContext(ACCOUNT, "metric");

check("the account's own heart-rate family is what the context carries", () => {
  // `hrZoneType` sits on the account, not inside `zoneData` — 1 Max HR,
  // 2 Heart Rate Reserve, 3 Lactate Threshold. The builder reads it rather
  // than asking, because COROS scores every activity against this one model.
  assert.equal(
    parseWorkoutEditorContext({ ...ACCOUNT, hrZoneType: 1 }, "metric").heartRateBasis,
    "maxHr"
  );
  assert.equal(
    parseWorkoutEditorContext({ ...ACCOUNT, hrZoneType: 2 }, "metric").heartRateBasis,
    "reserve"
  );
  assert.equal(
    parseWorkoutEditorContext({ ...ACCOUNT, hrZoneType: 3 }, "metric").heartRateBasis,
    "lthr"
  );
  assert.equal(
    context.heartRateBasis,
    "maxHr",
    "an account that states no model reads as Max HR, which is COROS's own default"
  );
});

check("the thresholds are read under COROS's own field names", () => {
  assert.equal(context.maxHr, 190);
  assert.equal(context.restingHr, 52, "resting heart rate arrives as `rhr`");
  assert.equal(context.lthrBpm, 168);
  assert.equal(
    context.thresholdPaceSecondsPerKm,
    322,
    "threshold pace arrives as `ltsp`"
  );
  assert.equal(context.ftp, 180);
});

check("every family is parsed, and the pace family at all", () => {
  for (const family of ["maxHr", "reserve", "lthr", "thresholdPace", "ftp"]) {
    assert.ok(
      context.zones[family]?.length > 0,
      `${family} came back empty, so the builder would draw the shipped table`
    );
  }
  assert.equal(context.zones.thresholdPace.length, 6);
  assert.equal(context.zones.ftp.length, 7);
});

check("the parsed bands are the ones COROS prints", () => {
  const drawn = (family) =>
    context.zones[family].map((zone) => zonePercentLabel(zone));
  assert.deepEqual(drawn("maxHr"), SCREENS.maxHr.map(([, band]) => band));
  assert.deepEqual(drawn("reserve"), SCREENS.reserve.map(([, band]) => band));
  assert.deepEqual(drawn("lthr"), SCREENS.lthr.map(([, band]) => band));
  assert.deepEqual(drawn("thresholdPace"), PACE_SCREEN.map(([, band]) => band));
  assert.deepEqual(drawn("ftp"), POWER_SCREEN.map(([, band]) => band));
});

check("the bpm bounds are the ones COROS prints", () => {
  // HR Reserve, from the screen: <133, 133-154, 155-168, 169-173, 174-183, >183.
  const reserve = context.zones.reserve;
  assert.equal(reserve[0].highBpm, 133);
  assert.deepEqual([reserve[1].lowBpm, reserve[1].highBpm], [133, 154]);
  assert.deepEqual([reserve[2].lowBpm, reserve[2].highBpm], [155, 168]);
  assert.deepEqual([reserve[3].lowBpm, reserve[3].highBpm], [169, 173]);
  assert.deepEqual([reserve[4].lowBpm, reserve[4].highBpm], [174, 183]);
  assert.equal(reserve[5].lowBpm, 184);
  assert.equal(
    reserve[5].highBpm,
    undefined,
    "the top zone's ceiling is a 404 bpm sentinel and must never be printed"
  );
});

check("the ends are open, and no sentinel reaches the screen", () => {
  for (const family of ["maxHr", "reserve", "lthr", "thresholdPace", "ftp"]) {
    const zones = context.zones[family];
    assert.equal(zones[0].openEnd, "low", `${family} zone 1 is written "<X"`);
    assert.equal(
      zones[zones.length - 1].openEnd,
      "high",
      `${family} top zone is written ">Y"`
    );
    for (const zone of zones) {
      assert.doesNotMatch(
        zonePercentLabel(zone),
        /255|500|404/,
        `${family} printed a sentinel`
      );
    }
  }
});

console.log("5. The athlete's own zones outrank the shipped table");
check("a configured zone is what the option shows", () => {
  const label = zoneOptionLabel(
    PACE_PRESETS[3],
    3,
    PACE_PRESETS.length,
    context.zones.thresholdPace[3]
  );
  assert.equal(label, "Threshold · 92-102%");
});

if (failures > 0) {
  console.error(`\n${failures} zone preset check(s) failed.`);
  process.exit(1);
}
console.log("\nAll COROS zone preset checks passed.");
